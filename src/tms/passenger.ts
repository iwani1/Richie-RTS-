// The passenger portal's reading of the records (brief 1C: PAX-01, D-97).
//
// A passenger asks three questions: where do I get on and at what time, is my seat really mine, and
// what happened to the run I was on. All three are answerable from records this system already
// keeps — a route's stop times, a booking's status, a run's status and the boarding outcome recorded
// at the door.
//
// What it deliberately does **not** answer is where the bus is right now. Nothing in this build
// records a position, a traffic delay or an arrival estimate (PAX-02 says exactly this: do not show a
// live map or a live ETA when only manually entered statuses exist). So the portal says "the driver
// has started this run" and never "the bus is 6 minutes away", and `PASSENGER_LIMITS` states the
// difference on the screen rather than leaving a rider to assume the silence is a bug.
//
// The distinction the brief asks for — requested, confirmed, assigned to trip, picked up, completed,
// cancelled — is kept exactly, and each one is derived from a record rather than inferred.
import { bookingContractProblem } from "./contracts";
import { capacityOf, minutesToDeparture, seatErrors, LIVE_BOOKING_STATUSES } from "./bookings";
import { toMinutes } from "./busing";
import type { Booking, BusRoute, Database, Passenger, RouteStop, Trip } from "./types";

/**
 * What a rider is told, in one word plus one sentence.
 *
 * `assigned` and `en_route` are the brief's words for "a bus and driver are on this run" and "the
 * run has started"; there is no separate "driver en route" state in the data, and calling a started
 * run "en route" would be guessing about the road, so the label says the run has started instead.
 */
export type JourneyPhase =
  | "requested"
  | "waitlisted"
  | "offered"
  | "confirmed_no_bus"
  | "confirmed_assigned"
  | "under_way"
  | "boarded"
  | "not_boarded"
  | "completed"
  | "run_cancelled"
  | "cancelled"
  | "rejected";

export interface JourneyPhaseView {
  phase: JourneyPhase;
  /** Three or four words for a badge. */
  label: string;
  /** The sentence that qualifies the label. Never a promise the records cannot keep. */
  detail: string;
  tone: "success" | "warning" | "error" | "info" | "neutral";
}

export interface Journey {
  trip: Trip;
  route: BusRoute;
  /** The day of travel, YYYY-MM-DD. */
  date: string;
  /** The stop this rider gets on at, if the route still has it. */
  pickupStop: RouteStop | null;
  /** The time the timetable promises at that stop. */
  pickupTime: string | null;
  /** The last stop's time: when the run is expected to arrive. */
  arrivalTime: string | null;
  /** The registration of the bus on this run, once one is assigned. */
  vehicle: string | null;
  /** Set when the seat was booked rather than rostered: the reference the rider quotes. */
  booking: Booking | null;
  source: "roster" | "booking";
  state: JourneyPhaseView;
}

/**
 * What the portal cannot show, and why. Printed on the screen itself: a rider who cannot see a
 * moving bus should know that nothing is broken, rather than assume the page is stale.
 */
export const PASSENGER_LIMITS: readonly string[] = [
  "The bus's live position is not tracked, so no map and no arrival countdown are shown.",
  "A delay is not recorded anywhere, so the portal cannot tell you the bus is late — ring the office.",
  "Times are the timetable's, not a measurement of the road.",
  "Your seat is confirmed by the office, never automatically, because a seat promised to somebody who stopped waiting is worse than no seat at all.",
];

/** How the office explains its own rules, taken from the company's settings rather than written here. */
export interface TravelPolicy {
  requestCutoffMinutes: number | null;
  cancellationCutoffMinutes: number | null;
}

export function travelPolicy(db: Database): TravelPolicy {
  return {
    requestCutoffMinutes: db.settings.booking.requestCutoffMinutes,
    cancellationCutoffMinutes: db.settings.booking.cancellationCutoffMinutes,
  };
}

const ymd = (iso: string) => iso.slice(0, 10);

/** The booking a rider holds on a run, if any: a rejected or cancelled one is no longer a seat. */
function liveBookingFor(bookings: Booking[], tripId: string): Booking | null {
  const live = bookings.filter((booking) => booking.tripId === tripId && LIVE_BOOKING_STATUSES.includes(booking.status));
  // The newest wins: a rider whose earlier request was refused and who asked again holds the later one.
  return live.sort((a, b) => (a.createdAt === b.createdAt ? a.reference.localeCompare(b.reference) : a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

/** The boarding outcome recorded for this rider on this run, if the door was recorded at all. */
function boardingOf(trip: Trip, passengerId: string): "boarded" | "no_show" | null {
  return trip.boardings.find((boarding) => boarding.passengerId === passengerId)?.outcome ?? null;
}

/**
 * One run, read from the rider's side.
 *
 * The order matters and is the honest one: **what happened to the seat** first (a cancelled booking
 * is not a cancelled bus), then **what happened to the run**, then whether anybody saw the rider get
 * on. A run that was stopped mid-way is reported as cancelled with its recorded reason, because that
 * is the fact, even where a booking still says "confirmed".
 */
export function journeyStateOf(trip: Trip, booking: Booking | null, passengerId: string): JourneyPhaseView {
  if (booking) {
    switch (booking.status) {
      case "requested":
        return {
          phase: "requested",
          label: "Seat requested",
          detail: "The office has not confirmed this seat yet. Keep the reference: it is how they find your request.",
          tone: "info",
        };
      case "waitlisted":
        return {
          phase: "waitlisted",
          label: "On the waiting list",
          detail: "The run was full when you asked. If a seat frees up the office offers it to you — nobody is confirmed automatically.",
          tone: "warning",
        };
      case "offered":
        return {
          phase: "offered",
          label: "Seat offered",
          detail: "A seat has freed up and it is being held for you until the office confirms it.",
          tone: "warning",
        };
      case "rejected":
        return {
          phase: "rejected",
          label: "Not accepted",
          detail: booking.note ? `The office did not take this request: ${booking.note}` : "The office did not take this request.",
          tone: "error",
        };
      case "cancelled":
        return {
          phase: "cancelled",
          label: "Cancelled",
          detail: booking.note ? `Cancelled: ${booking.note}` : "This seat was cancelled.",
          tone: "neutral",
        };
      default:
        break;
    }
  }

  // From here the seat is either held (confirmed) or the rider travels on the standing roster.
  if (trip.status === "cancelled") {
    return {
      phase: "run_cancelled",
      label: "Run cancelled",
      detail: trip.cancelReason
        ? `This run was cancelled: ${trip.cancelReason}. The office arranges another way in; nothing is owed by you.`
        : "This run was cancelled. The office arranges another way in.",
      tone: "error",
    };
  }

  if (trip.status === "completed") {
    const boarded = boardingOf(trip, passengerId);
    if (boarded === "boarded")
      return { phase: "completed", label: "Travelled", detail: "You were recorded as aboard and this run is finished.", tone: "success" };
    if (boarded === "no_show")
      return { phase: "not_boarded", label: "Not recorded aboard", detail: "This run is finished and the driver recorded that you did not board. Tell the office if that is wrong.", tone: "warning" };
    return { phase: "completed", label: "Completed", detail: "This run is finished. No boarding outcome was recorded for you.", tone: "neutral" };
  }

  if (trip.status === "in_progress") {
    const boarded = boardingOf(trip, passengerId);
    if (boarded === "boarded")
      return { phase: "boarded", label: "Picked up", detail: "You were recorded as aboard. The run is under way; its live position is not tracked.", tone: "success" };
    if (boarded === "no_show")
      return { phase: "not_boarded", label: "Recorded as not boarding", detail: "The driver recorded that you did not board. Ring the office if that is wrong.", tone: "error" };
    return {
      phase: "under_way",
      label: "Under way",
      detail: "The driver has started this run. The bus's position is not tracked, so no arrival time is shown.",
      tone: "info",
    };
  }

  // Planned or dispatched: the seat is real, and the bus may not be.
  if (!trip.vehicleId)
    return {
      phase: "confirmed_no_bus",
      label: "Seat held",
      detail: "Your seat is held. A bus has not been assigned to this run yet, so no registration is shown.",
      tone: "info",
    };

  if (trip.status === "planned")
    return {
      phase: "confirmed_assigned",
      label: "Bus assigned",
      detail: "A bus and a driver are on this run. It has not been released to leave yet.",
      tone: "info",
    };

  return {
    phase: "confirmed_assigned",
    label: "Ready to leave",
    detail: "The office has released this run. Be at your stop a few minutes early.",
    tone: "success",
  };
}

function stopOf(route: BusRoute, stopId: string | null): RouteStop | null {
  if (!stopId) return null;
  return route.stops.find((stop) => stop.id === stopId) ?? null;
}

/**
 * Every run this rider is expected on: the runs of its own route and any run it holds a seat on.
 *
 * `bookings` is passed in rather than read from `db` so the portal can work from the payload it was
 * given (which the server has already narrowed) and a test can describe one rider's bookings exactly.
 */
export function journeysOf(db: Database, passenger: Passenger, bookings: Booking[]): Journey[] {
  const routeIds = new Set<string>(bookings.map((booking) => booking.routeId));
  if (passenger.routeId) routeIds.add(passenger.routeId);

  const mine = bookings.filter((booking) => booking.passengerId === passenger.id);

  return db.trips
    .filter((trip) => routeIds.has(trip.routeId))
    .flatMap((trip) => {
      const route = db.routes.find((candidate) => candidate.id === trip.routeId);
      if (!route) return [];
      const booking = liveBookingFor(mine, trip.id);
      const onRoster = passenger.routeId === trip.routeId && passenger.status === "active";
      // A run on a route the rider is neither rostered on nor holding a seat for is not a journey.
      if (!booking && !onRoster) return [];
      const pickupStop = stopOf(route, booking?.stopId ?? passenger.stopId);
      return [
        {
          trip,
          route,
          date: trip.serviceDate,
          pickupStop,
          pickupTime: pickupStop?.scheduledTime ?? route.stops[0]?.scheduledTime ?? null,
          arrivalTime: route.stops[route.stops.length - 1]?.scheduledTime ?? null,
          vehicle: db.vehicles.find((vehicle) => vehicle.id === trip.vehicleId)?.registration ?? null,
          booking,
          source: booking ? ("booking" as const) : ("roster" as const),
          state: journeyStateOf(trip, booking, passenger.id),
        },
      ];
    })
    .sort((a, b) => (a.date === b.date ? (a.pickupTime ?? "").localeCompare(b.pickupTime ?? "") : a.date < b.date ? -1 : 1));
}

export interface EligibleRun {
  trip: Trip;
  route: BusRoute;
  date: string;
  departureTime: string;
  seatsFree: number;
  /** True when the office's own rules would accept a request for this run right now. */
  bookable: boolean;
  /** Why not, in the words the command would use. Null when it is bookable. */
  why: string | null;
}

/**
 * The runs this rider could ask for a seat on, and why some of them are refused.
 *
 * It reads the same rules the command enforces — `seatErrors` and the booking contract gate — so a
 * run offered here cannot then be refused by `create_booking`. The one rule a rider meets most often
 * is that **its own route needs no booking**: the roster is the seat, and asking twice would count
 * the same person against the bus twice.
 */
export function eligibleRunsFor(db: Database, passenger: Passenger, now: string, from: string, to: string): EligibleRun[] {
  const today = ymd(now);
  const requestCutoff = db.settings.booking.requestCutoffMinutes;
  const routes = db.routes.filter((route) => route.clientId === passenger.clientId && route.status === "active");

  return db.trips
    .filter((trip) => trip.serviceDate >= (from || today) && trip.serviceDate <= (to || today))
    .filter((trip) => routes.some((route) => route.id === trip.routeId))
    .flatMap((trip) => {
      const route = routes.find((candidate) => candidate.id === trip.routeId)!;
      const refusal = (why: string): EligibleRun => ({
        trip,
        route,
        date: trip.serviceDate,
        departureTime: route.stops[0]?.scheduledTime ?? "",
        seatsFree: capacityOf(db, trip).free,
        bookable: false,
        why,
      });

      if (passenger.status !== "active") return [refusal("Your rider record is inactive. The office reactivates it before a seat can be booked.")];
      if (trip.routeId === passenger.routeId)
        return [refusal(`${route.reference} is your own route — your seat on it is automatic, so there is nothing to book. A booking is for a different run.`)];
      if (db.bookings.some((booking) => booking.tripId === trip.id && booking.passengerId === passenger.id && LIVE_BOOKING_STATUSES.includes(booking.status)))
        return [refusal("You already hold a seat (or a request) on this run.")];

      const contractIssue = bookingContractProblem(db, route.clientId, trip.serviceDate, today);
      if (contractIssue) return [refusal(contractIssue)];

      const seat = seatErrors(db, trip, passenger.id, now);
      if (Object.keys(seat).length) return [refusal(Object.values(seat)[0] as string)];

      if (requestCutoff !== null) {
        const minutes = minutesToDeparture(db, trip, now);
        if (minutes !== null && minutes < requestCutoff)
          return [refusal(`Requests for this run close ${requestCutoff} minutes before it leaves.`)];
      }

      return [
        {
          trip,
          route,
          date: trip.serviceDate,
          departureTime: route.stops[0]?.scheduledTime ?? "",
          seatsFree: capacityOf(db, trip).free,
          bookable: true,
          why: null,
        },
      ];
    })
    .sort((a, b) => (a.date === b.date ? a.departureTime.localeCompare(b.departureTime) : a.date < b.date ? -1 : 1));
}

/** Whether a rider may still cancel this seat, and what stops it when it cannot. */
export function cancellationProblem(db: Database, booking: Booking, now: string): string | null {
  if (booking.status === "cancelled") return `${booking.reference} is already cancelled.`;
  if (booking.status === "rejected") return `${booking.reference} was not accepted; there is nothing to cancel.`;
  const trip = db.trips.find((candidate) => candidate.id === booking.tripId);
  if (!trip) return "The run this seat was booked on no longer exists.";
  if (trip.status === "completed") return `${trip.reference} has finished; a seat on it cannot be cancelled.`;
  if (trip.status === "in_progress") return `${trip.reference} is already running; its list of riders is fixed. Ring the office.`;
  const cutoff = db.settings.booking.cancellationCutoffMinutes;
  if (cutoff !== null) {
    const minutes = minutesToDeparture(db, trip, now);
    if (minutes !== null && minutes < cutoff)
      return `The office closes changes ${cutoff} minutes before a run leaves, and this one leaves in ${Math.max(0, minutes)} minutes. Ring them instead.`;
  }
  return null;
}

/** The rider's own next journey, or null when there is not one. Used for the portal's headline. */
export function nextJourney(journeys: Journey[], today: string): Journey | null {
  return journeys.find((journey) => journey.date >= today && journey.trip.status !== "cancelled" && journey.trip.status !== "completed") ?? null;
}

/** Journeys already travelled, newest first. */
export function pastJourneys(journeys: Journey[], today: string): Journey[] {
  return journeys
    .filter((journey) => journey.date < today || journey.trip.status === "completed" || journey.trip.status === "cancelled")
    .reverse();
}

/** Journeys still to come, soonest first. */
export function upcomingJourneys(journeys: Journey[], today: string): Journey[] {
  return journeys.filter((journey) => journey.date >= today && journey.trip.status !== "completed" && journey.trip.status !== "cancelled");
}

/** Minutes until the pickup, for the "leaves at 06:40" line. Null once it has gone. */
export function minutesUntilPickup(journey: Journey, now: string): number | null {
  if (!journey.pickupTime) return null;
  const at = Date.parse(`${journey.date}T${journey.pickupTime}:00.000Z`);
  if (Number.isNaN(at)) return null;
  return Math.round((at - Date.parse(now)) / 60_000);
}

/** The order a rider reads a day in: by pickup time, then by reference. */
export function sortByPickup(journeys: Journey[]): Journey[] {
  return [...journeys].sort((a, b) => {
    const aTime = a.pickupTime ? toMinutes(a.pickupTime) : Number.MAX_SAFE_INTEGER;
    const bTime = b.pickupTime ? toMinutes(b.pickupTime) : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.trip.reference.localeCompare(b.trip.reference);
  });
}
