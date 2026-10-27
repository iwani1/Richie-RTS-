// The dispatch board (DSP-01, D-115).
//
// One day, read the way a supervisor reads it at half past six: what is leaving, what nobody is
// driving, what is over its seats, what is standing in the workshop when it should be on the road, and
// who is still free. The busing screen already carries the *run sheet* — the next action on each run —
// and this does not replace it. It answers the other question, "what is wrong with today?", across the
// whole day at once, and it changes nothing: every action stays where the commands are.
//
// Three rules, because a board that overstates its own knowledge is worse than no board:
//
//   * **Every figure is counted from the records** — the runs on the date, the roster, the seats sold,
//     the work orders, the licence dates. Nothing is estimated and no rate is assumed.
//   * **A capacity warning is a blocker, not a statistic.** The seats on the bus are a safety limit,
//     and a run whose roster plus booked seats exceed them is reported as such.
//   * **What the records cannot answer is printed on the page.** A run has no *service type* in this
//     build (TRP-01), and a stop has no map position, so the board cannot filter by service and cannot
//     give a travel time. It says so rather than offering a filter that quietly does nothing.
import { capacityOf, minutesToDeparture } from "./bookings";
import { isActiveRental } from "./rentalWorkflow";
import { toMinutes } from "./busing";
import { delayLine, liveDelay } from "./delays";
import { FLEET_STATE_LABELS, fleetStateOf, type FleetState } from "./fleetState";
import type { Database, Driver, Trip, TripStatus } from "./types";

/** The states a vehicle can be in and still carry people today. */
const USABLE: readonly FleetState[] = ["available", "reserved", "assigned", "on_trip"];

/** The states that explain why an assigned vehicle is not going anywhere. */
const BLOCKING: readonly FleetState[] = ["maintenance", "pending_inspection", "out_of_service", "retired"];

export interface BoardFilters {
  date: string;
  /** Empty means every status. */
  status?: TripStatus | "";
  routeId?: string;
  driverId?: string;
  vehicleId?: string;
  /** The corporate customer the route runs for. */
  clientId?: string;
}

/** Why a run cannot leave as it stands. Kept apart from the sentence, so a count is never a string match. */
export type BoardBlocker = "no_vehicle" | "no_driver" | "vehicle_unusable" | "driver_unusable" | "over_capacity";

export interface BoardAlert {
  /** `blocker` stops the run leaving as it stands; `warning` is a fact to read before it does. */
  level: "blocker" | "warning";
  text: string;
}

export interface BoardRun {
  tripId: string;
  reference: string;
  routeName: string;
  routeReference: string;
  clientName: string;
  origin: "schedule" | "adhoc";
  /** The first and last scheduled stop times: the timetable window, not the road. */
  departsAt: string;
  endsAt: string;
  status: TripStatus;
  vehicleLabel: string | null;
  driverLabel: string | null;
  /** The vehicle's state today, in the fleet's own words, or null when nothing is assigned. */
  vehicleState: string | null;
  seats: number;
  riders: number;
  free: number;
  /** Riders beyond the seats. Zero means everyone fits; above zero is a safety problem. */
  overCapacity: number;
  delay: string | null;
  /** Why it cannot leave as it stands, empty when it can. */
  blockers: BoardBlocker[];
  alerts: BoardAlert[];
}

export interface BoardCandidate {
  id: string;
  label: string;
  /** Why it is free, or what to know before using it. */
  note: string;
}

export interface DispatchBoard {
  date: string;
  /** The day the board was read, so "today" is not guessed by the screen. */
  today: string;
  filters: BoardFilters;
  /** The runs on the date after the filters, in departure order. */
  runs: BoardRun[];
  /** How many runs the date holds before the filters — so a filtered list is never mistaken for a quiet day. */
  dayRuns: number;
  filtersApplied: boolean;
  counts: Record<TripStatus, number>;
  totals: { runs: number; unassigned: number; overCapacity: number; blocked: number; late: number };
  /** The day's problems in sentences, worst first. Empty when nothing needs attention. */
  alerts: string[];
  /** Vehicles and drivers with nothing on them today, and what to know about each. */
  available: { vehicles: BoardCandidate[]; drivers: BoardCandidate[] };
  /** The next run still to leave, relative to now. */
  next: { reference: string; departsAt: string; minutes: number } | null;
  /** What the records cannot answer, printed rather than left to be discovered. */
  limits: string[];
}

export const BOARD_LIMITS: readonly string[] = [
  "A run carries no service type in this build, so the board cannot filter by service; the timetable and the hire register are separate records.",
  "Stops have a name and a scheduled time, not a map position, so every time on this board is the timetable's, not a travel estimate.",
  "Nothing records a driver's hours on duty, so \"free today\" means no run or hire holds the driver, not that they have rested.",
];

const TRIP_STATUS_ORDER: readonly TripStatus[] = ["planned", "dispatched", "in_progress", "completed", "cancelled"];

const ymd = (value: string) => value.slice(0, 10);

/** Whole days from `earlier` to `later`, in UTC so a daylight-saving hour cannot move a date. */
function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** A hire covering the date, confirmed or under way — a vehicle or driver spoken for. */
function hireOn(db: Database, date: string) {
  return db.rentals.filter(
    (rental) =>
      isActiveRental(rental.status) && rental.startDate <= date && date <= rental.endDate,
  );
}

/** True when the driver may legally drive on the date, with the reason when not. */
function driverProblem(driver: Driver, date: string): string | null {
  if (driver.status !== "active") return `${driver.fullName} is not an active driver.`;
  const expiry = ymd(driver.licenceExpiry);
  if (expiry && expiry < date) return `${driver.fullName}'s licence expired on ${expiry}, so they cannot drive on ${date}.`;
  return null;
}

function runAlerts(
  db: Database,
  trip: Trip,
  label: { vehicle: string | null; driver: string | null },
  capacity: { seats: number; roster: number; booked: number },
  date: string,
): { alerts: BoardAlert[]; blockers: BoardBlocker[] } {
  const alerts: BoardAlert[] = [];
  const blockers: BoardBlocker[] = [];
  if (!trip.vehicleId) {
    alerts.push({ level: "blocker", text: "No vehicle assigned." });
    blockers.push("no_vehicle");
  }
  if (!trip.driverId) {
    alerts.push({ level: "blocker", text: "No driver assigned." });
    blockers.push("no_driver");
  }

  if (trip.vehicleId && label.vehicle) {
    const reading = fleetStateOf(db, trip.vehicleId, date);
    if (reading && BLOCKING.includes(reading.state)) {
      alerts.push({ level: "blocker", text: `${label.vehicle} is ${FLEET_STATE_LABELS[reading.state].toLowerCase()}: ${reading.sentence}` });
      blockers.push("vehicle_unusable");
    }
  }

  if (trip.driverId) {
    const driver = db.drivers.find((candidate) => candidate.id === trip.driverId);
    const problem = driver ? driverProblem(driver, date) : "The assigned driver is no longer on the register.";
    if (problem) {
      alerts.push({ level: "blocker", text: problem });
      blockers.push("driver_unusable");
    }
  }

  const riders = capacity.roster + capacity.booked;
  if (capacity.seats > 0 && riders > capacity.seats) {
    alerts.push({
      level: "blocker",
      text: `${riders} riders for ${capacity.seats} seats: ${capacity.roster} on the roster and ${capacity.booked} booked.`,
    });
    blockers.push("over_capacity");
  }

  const delay = liveDelay(trip);
  if (delay) alerts.push({ level: "warning", text: delayLine(delay) });
  return { alerts, blockers };
}

/**
 * The board for one day.
 *
 * The **filters narrow the list only**: the counts, the alerts and the crew lists are the whole day's,
 * because that is what a supervisor is reading the board for. `dayRuns` says how many runs the day
 * holds, so a filtered list of two is never mistaken for a day with two runs.
 */
export function dispatchBoard(db: Database, filters: BoardFilters, today: string): DispatchBoard {
  const date = filters.date || today;
  const routeOf = (routeId: string) => db.routes.find((route) => route.id === routeId);
  const vehicleOf = (id: string | null) => (id ? db.vehicles.find((vehicle) => vehicle.id === id) ?? null : null);
  const driverOf = (id: string | null) => (id ? db.drivers.find((driver) => driver.id === id) ?? null : null);

  const dayTrips = db.trips.filter((trip) => trip.serviceDate === date);

  const boardRun = (trip: Trip): BoardRun => {
    const route = routeOf(trip.routeId);
    const vehicle = vehicleOf(trip.vehicleId);
    const driver = driverOf(trip.driverId);
    const capacity = capacityOf(db, trip);
    const reading = trip.vehicleId ? fleetStateOf(db, trip.vehicleId, date) : null;
    const riders = capacity.roster + capacity.booked;
    const { alerts, blockers } = runAlerts(db, trip, { vehicle: vehicle?.registration ?? null, driver: driver?.fullName ?? null }, capacity, date);
    return {
      tripId: trip.id,
      reference: trip.reference,
      routeName: route?.name ?? "Route missing",
      routeReference: route?.reference ?? "—",
      clientName: (route?.clientId ? db.clients.find((client) => client.id === route.clientId)?.name : null) ?? "No company recorded",
      origin: trip.origin === "adhoc" ? "adhoc" : "schedule",
      departsAt: route?.stops[0]?.scheduledTime ?? "",
      endsAt: route?.stops[route.stops.length - 1]?.scheduledTime ?? "",
      status: trip.status,
      vehicleLabel: vehicle?.registration ?? null,
      driverLabel: driver?.fullName ?? null,
      vehicleState: reading?.label ?? null,
      seats: capacity.seats,
      riders,
      free: capacity.free,
      overCapacity: capacity.seats > 0 ? Math.max(riders - capacity.seats, 0) : 0,
      delay: liveDelay(trip) ? delayLine(liveDelay(trip)!) : null,
      blockers,
      alerts,
    };
  };

  // Departure order, with the reference breaking a tie so two runs at 06:00 never shuffle between
  // renders (and a test can assert the order).
  const byDeparture = (a: Trip, b: Trip) => {
    const first = (trip: Trip) => toMinutes(routeOf(trip.routeId)?.stops[0]?.scheduledTime ?? "");
    const [left, right] = [first(a), first(b)];
    return left === right ? a.reference.localeCompare(b.reference) : left - right;
  };

  const dayRuns = [...dayTrips].sort(byDeparture).map(boardRun);

  const runs = dayRuns.filter((run) => {
    const trip = dayTrips.find((candidate) => candidate.id === run.tripId)!;
    if (filters.status && run.status !== filters.status) return false;
    if (filters.routeId && trip.routeId !== filters.routeId) return false;
    if (filters.driverId && trip.driverId !== filters.driverId) return false;
    if (filters.vehicleId && trip.vehicleId !== filters.vehicleId) return false;
    if (filters.clientId && routeOf(trip.routeId)?.clientId !== filters.clientId) return false;
    return true;
  });

  const counts = Object.fromEntries(TRIP_STATUS_ORDER.map((status) => [status, dayTrips.filter((trip) => trip.status === status).length])) as Record<
    TripStatus,
    number
  >;

  // Cancelled and finished runs cannot be blocked: there is nothing left for them to do. Their alerts
  // were still computed (a cancelled run with no vehicle is a true fact about that record), so the
  // totals count only the runs that still have to leave.
  const live = dayRuns.filter((run) => run.status === "planned" || run.status === "dispatched" || run.status === "in_progress");
  const totals = {
    runs: dayRuns.length,
    unassigned: live.filter((run) => !run.vehicleLabel || !run.driverLabel).length,
    overCapacity: live.filter((run) => run.overCapacity > 0).length,
    blocked: live.filter((run) => run.blockers.length > 0).length,
    late: dayRuns.filter((run) => run.delay !== null).length,
  };

  // The day's problems, worst first: a bus in the workshop is a run that will not happen, a run with
  // no crew is the same, capacity is a safety limit, and a late run is news the client is waiting for.
  const alerts: string[] = [];
  // Safety first: more people than seats is the one problem that cannot wait for a phone call.
  const overCapacity = live.filter((run) => run.blockers.includes("over_capacity"));
  if (overCapacity.length > 0) {
    alerts.push(
      `${overCapacity.length} run${overCapacity.length === 1 ? "" : "s"} over the seats on the bus: ${overCapacity
        .map((run) => `${run.reference} (${run.riders} for ${run.seats})`)
        .join(", ")}.`,
    );
  }
  // Then the runs that cannot leave at all, with the reason a dispatcher has to act on.
  const crewless = live.filter((run) => run.blockers.some((blocker) => blocker !== "over_capacity"));
  if (crewless.length > 0) {
    alerts.push(
      `${crewless.length} run${crewless.length === 1 ? "" : "s"} cannot leave as they stand: ${crewless
        .map((run) => `${run.reference} at ${run.departsAt || "no time"} (${run.alerts.find((alert) => alert.level === "blocker")!.text.replace(/\.$/, "").toLowerCase()})`)
        .join("; ")}.`,
    );
  }
  if (totals.late > 0) {
    alerts.push(`${totals.late} run${totals.late === 1 ? "" : "s"} behind schedule: ${dayRuns.filter((run) => run.delay).map((run) => run.reference).join(", ")}.`);
  }

  // Who is free: no run on the date and no hire that covers it. A vehicle in the workshop is not free,
  // and its own state is the sentence that says why.
  const hires = hireOn(db, date);
  const vehicleBusy = new Set(dayTrips.map((trip) => trip.vehicleId).filter(Boolean) as string[]);
  for (const hire of hires) if (hire.assignedVehicleId) vehicleBusy.add(hire.assignedVehicleId);
  const driverBusy = new Set(dayTrips.map((trip) => trip.driverId).filter(Boolean) as string[]);
  for (const hire of hires) if (hire.assignedDriverId) driverBusy.add(hire.assignedDriverId);

  const availableVehicles: BoardCandidate[] = db.vehicles
    .filter((vehicle) => !vehicleBusy.has(vehicle.id))
    .map((vehicle) => {
      const reading = fleetStateOf(db, vehicle.id, date);
      return { vehicle, reading };
    })
    .filter(({ reading }) => reading !== null)
    .filter(({ reading }) => USABLE.includes(reading!.state) || BLOCKING.includes(reading!.state))
    .map(({ vehicle, reading }) => ({
      id: vehicle.id,
      label: `${vehicle.registration} · ${vehicle.seatCapacity} seats`,
      note:
        reading && BLOCKING.includes(reading.state)
          ? `${FLEET_STATE_LABELS[reading.state]}: it cannot take a run today.`
          : reading?.sentence ?? "Free: nothing on it today.",
    }))
    // A bus that cannot move is listed last: the free ones are what a dispatcher is choosing from.
    .sort((a, b) => Number(a.note.includes("cannot take")) - Number(b.note.includes("cannot take")) || a.label.localeCompare(b.label));

  const availableDrivers: BoardCandidate[] = db.drivers
    .filter((driver) => !driverBusy.has(driver.id))
    .map((driver) => {
      const problem = driverProblem(driver, date);
      return {
        id: driver.id,
        label: driver.fullName,
        note: problem ?? "Free: no run or hire is holding them today.",
        blocked: Boolean(problem),
      };
    })
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.label.localeCompare(b.label))
    .map(({ id, label, note }) => ({ id, label, note }));

  const now = new Date().toISOString();
  const nextTrip = [...dayTrips]
    .filter((trip) => trip.status === "planned" || trip.status === "dispatched")
    .sort(byDeparture)
    .find((trip) => {
      const minutes = minutesToDeparture(db, trip, now);
      return minutes !== null && minutes >= 0;
    });
  const next = nextTrip
    ? {
        reference: nextTrip.reference,
        departsAt: routeOf(nextTrip.routeId)?.stops[0]?.scheduledTime ?? "",
        minutes: minutesToDeparture(db, nextTrip, now) ?? 0,
      }
    : null;

  return {
    date,
    today,
    filters,
    runs,
    dayRuns: dayRuns.length,
    filtersApplied: Boolean(
      Boolean(filters.status) || Boolean(filters.routeId) || Boolean(filters.driverId) || Boolean(filters.vehicleId) || Boolean(filters.clientId),
    ),
    counts,
    totals,
    alerts,
    available: { vehicles: availableVehicles, drivers: availableDrivers },
    next,
    limits: [...BOARD_LIMITS],
  };
}

/**
 * Whole days a driver's licence has left on a date: negative once it has expired.
 *
 * The board states the date itself; this is for the count a supervisor asks for out loud.
 */
export function licenceDaysLeft(driver: Driver, date: string): number {
  return daysBetween(date, ymd(driver.licenceExpiry));
}
