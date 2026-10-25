// Bookings (brief 1B: BKG-01..06, D-83).
//
// What this is *not*: a second roster. The standing roster is how a client's own staff travel every
// day, and adding a visitor to it would outlive the visit. A booking names **one rider on one run**
// — a visitor, a new hire before the roster is updated, somebody from another site. Seats are
// counted as roster + live bookings, so a booking can never push a run over the vehicle's seats, and
// a rider who is already sitting on that route's roster is refused rather than counted twice.
//
// Nothing is confirmed by the system on its own. A seat that frees up is **offered** to the oldest
// waiter and stays offered until a person confirms it (BKG-05): an automatic confirmation would
// promise a seat to someone who may have stopped waiting.
import { can } from "./permissions";
import { bookingContractProblem } from "./contracts";
import { allocateReference } from "./references";
import { confinedPassengerId } from "./scope";
import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import {
  BOOKING_TYPES,
  type Booking,
  type BookingHistoryEntry,
  type BookingStatus,
  type BookingType,
  type Database,
  type Passenger,
  type Trip,
} from "./types";

export const BOOKING_COMMAND_TYPES = ["create_booking", "confirm_booking", "reject_booking", "cancel_booking"] as const;

export interface BookingRequestInput {
  passengerId: string;
  /** The route whose run is being booked. A visitor often has no route of their own. */
  routeId: string;
  /** One journey books this date; recurring books every operating day from here to `toDate`. */
  serviceDate: string;
  toDate: string;
  type: BookingType;
  note: string;
}

export type BookingCommand =
  | { type: "create_booking"; input: BookingRequestInput }
  | { type: "confirm_booking"; id: string }
  | { type: "reject_booking"; id: string; reason: string }
  | { type: "cancel_booking"; id: string; reason: string };

export function isBookingCommand(command: { type: string }): command is BookingCommand {
  return (BOOKING_COMMAND_TYPES as readonly string[]).includes(command.type);
}

// ---------- helpers ----------

const dayMs = 86_400_000;
const addDays = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** A booking that still holds (or may still hold) a seat. Rejected and cancelled ones do not. */
export const LIVE_BOOKING_STATUSES: readonly BookingStatus[] = ["requested", "confirmed", "waitlisted", "offered"];
export const SEAT_HOLDING_STATUSES: readonly BookingStatus[] = ["confirmed", "offered"];

/** Seats held by bookings on a run, which is what the capacity check has to subtract. */
export function seatsHeld(db: Database, tripId: string): number {
  return db.bookings.filter((booking) => booking.tripId === tripId && SEAT_HOLDING_STATUSES.includes(booking.status)).length;
}

/**
 * One person the run is expected to carry (D-85).
 *
 * The roster alone is not the manifest any more: a visitor holding a confirmed seat travels on the
 * same bus and has to be recorded getting on or not, or the office never learns they were left
 * behind. `source` lets the screen say which is which without a second lookup.
 */
export interface ManifestRider {
  passenger: Passenger;
  source: "roster" | "booking";
  /** The booking that put them on this run; null for a roster rider. */
  bookingReference: string | null;
  /** Where they get on: their roster stop, or the stop named on the booking. */
  pickupStopId: string;
}

/**
 * Everyone the run is expected to carry: the active roster plus every booked seat that still holds
 * one (confirmed or offered). A requested or waitlisted booking holds nothing and is not expected
 * aboard; a cancelled or rejected one has gone.
 *
 * A booked rider whose stop cannot be found on this route gets on at the first stop, because a seat
 * with no stop would leave the driver with a name and nowhere to collect them.
 */
export function manifestFor(db: Database, trip: Trip): ManifestRider[] {
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);
  const firstStopId = route?.stops[0]?.id ?? "";
  const stopOnRoute = (stopId: string) => (route?.stops.some((stop) => stop.id === stopId) ? stopId : firstStopId);

  const roster: ManifestRider[] = db.passengers
    .filter((passenger) => passenger.routeId === trip.routeId && passenger.status === "active")
    .map((passenger) => ({
      passenger,
      source: "roster" as const,
      bookingReference: null,
      pickupStopId: passenger.stopId ? stopOnRoute(passenger.stopId) : firstStopId,
    }));

  const booked: ManifestRider[] = db.bookings
    .filter((booking) => booking.tripId === trip.id && SEAT_HOLDING_STATUSES.includes(booking.status))
    .flatMap((booking) => {
      const passenger = db.passengers.find((candidate) => candidate.id === booking.passengerId);
      // A seat whose rider record has gone is not a person to collect; the booking screen still shows it.
      if (!passenger) return [];
      // A rider who is already on the roster is one person, not two: the roster entry is the seat.
      if (roster.some((entry) => entry.passenger.id === passenger.id)) return [];
      return [{ passenger, source: "booking" as const, bookingReference: booking.reference, pickupStopId: stopOnRoute(booking.stopId ?? "") }];
    });

  return [...roster, ...booked];
}

/** Just the people expected at one stop of the run. */
export function manifestAtStop(db: Database, trip: Trip, stopId: string): ManifestRider[] {
  return manifestFor(db, trip).filter((entry) => entry.pickupStopId === stopId);
}

/** The route roster's active headcount: the seats already spoken for before any booking exists. */
function rosterCount(db: Database, routeId: string): number {
  return db.passengers.filter((passenger) => passenger.routeId === routeId && passenger.status === "active").length;
}

export interface CapacityView {
  seats: number;
  roster: number;
  booked: number;
  free: number;
  /** Null when no vehicle is assigned yet: capacity cannot be promised without one. */
  vehicle: string | null;
}

export function capacityOf(db: Database, trip: Trip): CapacityView {
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);
  const roster = route ? rosterCount(db, route.id) : 0;
  const booked = seatsHeld(db, trip.id);
  const vehicle = trip.vehicleId ? db.vehicles.find((candidate) => candidate.id === trip.vehicleId) ?? null : null;
  const seats = vehicle?.seatCapacity ?? 0;
  return { seats, roster, booked, free: vehicle ? Math.max(seats - roster - booked, 0) : 0, vehicle: vehicle?.registration ?? null };
}

/** Minutes from now until the run's first stop departs. Negative once it has gone. */
export function minutesToDeparture(db: Database, trip: Trip, now: string): number | null {
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);
  const first = route?.stops[0];
  if (!first) return null;
  const departure = Date.parse(`${trip.serviceDate}T${first.scheduledTime}:00.000Z`);
  if (Number.isNaN(departure)) return null;
  return Math.round((departure - Date.parse(now)) / 60_000);
}

const entry = (actor: Actor | null, now: string, action: string, note: string): BookingHistoryEntry => ({
  at: now,
  by: actor?.fullName ?? "System",
  action,
  note,
});

const statusWord = (booking: Booking) => booking.status.charAt(0).toUpperCase() + booking.status.slice(1);

/** The trip for a route and date that a booking may still target: not cancelled, not finished. */
function bookableTrip(db: Database, routeId: string, date: string): Trip | undefined {
  return db.trips.find(
    (trip) => trip.routeId === routeId && trip.serviceDate === date && (trip.status === "planned" || trip.status === "dispatched" || trip.status === "in_progress"),
  );
}

/**
 * Everything that has to be true before a booking may hold a seat: a real rider, a route the rider's
 * company owns, a run that exists and has not left, a vehicle whose seats can be counted, and room
 * for one more. Each message says why, because the person reading it usually has to fix it.
 */
export function seatErrors(db: Database, trip: Trip, passengerId: string, now: string, ignoreBookingId?: string): Errors {
  const errors: Errors = {};
  const passenger = db.passengers.find((candidate) => candidate.id === passengerId);
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);

  if (!passenger) errors.passengerId = "Unknown rider.";
  else if (passenger.status !== "active") errors.passengerId = `${passenger.fullName} is inactive on the roster; reactivate the rider before booking a seat.`;
  else if (passenger.routeId === trip.routeId)
    errors.passengerId = `${passenger.fullName} is already on ${route?.reference ?? "this route"}'s roster. Nothing needs booking; the roster is the seat.`;

  if (trip.status === "cancelled") errors.tripId = `${trip.reference} was cancelled. Book a seat on another run.`;
  else if (trip.status === "completed") errors.tripId = `${trip.reference} has already finished.`;
  // D-85: a seat is sold before the bus leaves. Once a run is under way its manifest is fixed —
  // a rider added now would be a name nobody was told to collect.
  else if (trip.status === "in_progress") errors.tripId = `${trip.reference} is already under way; its list of riders is fixed. Book another run.`;
  else {
    const minutes = minutesToDeparture(db, trip, now);
    if (minutes !== null && minutes < 0) errors.tripId = `${trip.reference} has already departed (${route?.stops[0]?.scheduledTime ?? "—"}).`;
  }

  if (!errors.tripId) {
    const capacity = capacityOf(db, trip);
    // A booking that is already holding a seat is inside `booked`, so re-confirming it needs nothing.
    const alreadyHolding = ignoreBookingId ? db.bookings.some((booking) => booking.id === ignoreBookingId && booking.status === "offered") : false;
    if (!capacity.vehicle) errors.tripId = `No vehicle is assigned to ${trip.reference} yet, so its seats cannot be counted. Assign one first.`;
    else if (capacity.free <= 0 && !alreadyHolding)
      errors.tripId = `${trip.reference} is full: ${capacity.seats} seats, ${capacity.roster} on the roster and ${capacity.booked} booked.`;
  }

  return errors;
}

/**
 * A passenger requesting a seat may only request one for itself (PAX-01, D-97).
 *
 * The portal hides the rider field entirely, so this is not what makes the screen work — it is what
 * stops a hand-made request (or a future screen) from booking a seat in someone else's name.
 */
function notMyOwnRider(db: Database, actor: Actor | null, passengerId: string): boolean {
  const mine = confinedPassengerId(db, actor);
  return mine !== null && mine !== passengerId;
}

/** A client's own contact may only touch its own company's riders (D-60, BKG-02). */
function outsideOwnClient(db: Database, actor: Actor | null, clientId: string): boolean {
  if (!actor || actor.role !== "client_contact") return false;
  const user = db.users.find((candidate) => candidate.id === actor.id);
  return !user?.clientId || user.clientId !== clientId;
}

// ---------- command execution ----------

export function executeBookings(db: Database, actor: Actor | null, command: BookingCommand, now: string = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "create_booking": {
      const denied = authorise(actor, "bookings:create");
      if (denied) return denied;
      const { passengerId, routeId, serviceDate, toDate, type, note } = command.input;
      const errors: Errors = {};

      if (!BOOKING_TYPES.includes(type)) errors.type = "Choose one journey or every operating day.";
      const passenger = db.passengers.find((candidate) => candidate.id === passengerId);
      const route = db.routes.find((candidate) => candidate.id === routeId);
      if (!passengerId) errors.passengerId = "Choose the person travelling.";
      else if (!passenger) errors.passengerId = "Unknown rider.";
      if (!routeId) errors.routeId = "Choose the route to travel on.";
      else if (!route) errors.routeId = "Unknown route.";
      else if (passenger && passenger.clientId !== route.clientId) errors.routeId = `${route.name} belongs to a different client than ${passenger.fullName}.`;
      else if (route.status === "ended") errors.routeId = "This route has ended.";

      if (!isValidDate(serviceDate)) errors.serviceDate = "Enter the date of travel.";
      const end = type === "recurring" ? toDate || serviceDate : serviceDate;
      if (type === "recurring") {
        if (!isValidDate(toDate)) errors.toDate = "Enter the last date of the series.";
        else if (toDate < serviceDate) errors.toDate = "The last date is before the first.";
        else if (daysBetween(serviceDate, toDate) > 62) errors.toDate = "Book at most 62 days of a series in one go.";
      }
      if (passenger && outsideOwnClient(db, actor, passenger.clientId)) errors.passengerId = "Your account is confined to your own company's staff.";
      if (passengerId && notMyOwnRider(db, actor, passengerId)) errors.passengerId = "Your account can request a seat for yourself only.";
      if (Object.keys(errors).length) return fail("This booking cannot be made yet.", errors);

      const dates: string[] = [];
      for (let date = serviceDate; date <= end; date = addDays(date, 1)) dates.push(date);
      const runs = dates.map((date) => bookableTrip(db, routeId, date));
      if (runs.every((trip) => trip === undefined))
        return fail(
          `No run exists for ${route!.reference} on ${dates.length === 1 ? serviceDate : `${serviceDate} to ${end}`}. Generate the trips first, or book another date.`,
          { serviceDate: "Nothing is scheduled for that date." },
        );

      // BKG-02: a request cut-off applies only when management has set one (D-83).
      const requestCutoff = db.settings.booking.requestCutoffMinutes;

      const created: Booking[] = [];
      const skipped: string[] = [];
      // D-95: a contract that covers the date and is not active stops a new seat, and so does a
      // contract that ran out. A client with no contract on file is unaffected — the system does not
      // invent an agreement in order to refuse work under it.
      let contractRefusal: string | null = null;
      // A single-date request that fails the seat checks reports the reason on the field the person
      // can fix, not only in a sentence; a series reports each date it could not take.
      let seatRefusal: Errors | null = null;
      let counters = db.referenceCounters;
      dates.forEach((date, index) => {
        const trip = runs[index];
        if (!trip) {
          skipped.push(`${date} (nothing scheduled)`);
          return;
        }
        const contractIssue = route ? bookingContractProblem(db, route.clientId, date, now.slice(0, 10)) : null;
        if (contractIssue) {
          contractRefusal = contractIssue;
          skipped.push(`${date} (no active contract covering that date)`);
          return;
        }
        if (db.bookings.some((booking) => booking.tripId === trip.id && booking.passengerId === passengerId && LIVE_BOOKING_STATUSES.includes(booking.status))) {
          skipped.push(`${date} (already booked)`);
          return;
        }
        const seat = seatErrors(db, trip, passengerId, now);
        if (Object.keys(seat).length) {
          seatRefusal = seat;
          skipped.push(`${date} (${Object.values(seat)[0]})`);
          return;
        }
        if (requestCutoff !== null) {
          const minutes = minutesToDeparture(db, trip, now);
          if (minutes !== null && minutes < requestCutoff) {
            skipped.push(`${date} (inside the ${requestCutoff}-minute booking cut-off)`);
            return;
          }
        }
        if (created.filter((booking) => booking.tripId === trip.id).length > 0) {
          skipped.push(`${date} (already booked)`);
          return;
        }
        // A recurring request asks for one seat per run, so each run is checked against the seats
        // this same submission has already claimed.
        const capacity = capacityOf(db, trip);
        const claimed = created.filter((booking) => booking.tripId === trip.id).length;
        if (capacity.vehicle && capacity.free - claimed <= 0) {
          skipped.push(`${date} (${trip.reference} is full)`);
          return;
        }
        const allocated = allocateReference({ ...db, referenceCounters: counters }, "booking", now.slice(0, 4));
        counters = allocated.counters;
        created.push({
          id: makeId(),
          reference: allocated.reference,
          passengerId,
          clientId: passenger!.clientId,
          routeId,
          stopId: passenger!.stopId,
          tripId: trip.id,
          serviceDate: date,
          type,
          status: "requested",
          note: note.trim(),
          seriesId: type === "recurring" ? `series-${created[0]?.reference ?? allocated.reference}` : null,
          offeredAt: null,
          cancelledAt: null,
          cancelledBy: null,
          history: [entry(actor, now, "Requested", note.trim() || `Seat requested on ${trip.reference}.`)],
          createdAt: now,
          updatedAt: now,
        });
      });

      if (created.length === 0) {
        if (dates.length === 1 && contractRefusal) return fail(contractRefusal, { serviceDate: contractRefusal });
        if (dates.length === 1 && seatRefusal) return fail(`No seat could be requested: ${skipped.join("; ")}.`, seatRefusal);
        return fail(`No seat could be requested: ${skipped.join("; ")}.`, { serviceDate: skipped[0] ?? "Nothing to book." });
      }

      const next = audit(
        { ...db, referenceCounters: counters, bookings: [...db.bookings, ...created] },
        actor,
        {
          action: "bookings:create",
          entity: "booking",
          entityId: created[0].id,
          summary:
            `${created.length} booking(s) requested for ${passenger!.fullName}` +
            `${created.length === 1 ? ` on ${created[0].serviceDate}` : ` (${created[0].serviceDate} to ${created[created.length - 1].serviceDate})`}.` +
            (skipped.length ? ` Not booked: ${skipped.join("; ")}.` : ""),
        },
        now,
      );
      return {
        ok: true,
        db: next,
        message:
          `${created.length} booking${created.length === 1 ? "" : "s"} requested for ${passenger!.fullName}` +
          `${created.length === 1 ? ` on ${created[0].serviceDate}` : ""}.` +
          (skipped.length ? ` Not booked: ${skipped.join("; ")}.` : ""),
      };
    }

    case "confirm_booking": {
      const denied = authorise(actor, "bookings:manage");
      if (denied) return denied;
      const existing = db.bookings.find((booking) => booking.id === command.id);
      if (!existing) return fail("Booking not found.");
      if (existing.status !== "requested" && existing.status !== "offered" && existing.status !== "waitlisted")
        return fail(`Only a requested, offered or waitlisted booking can be confirmed (this one is ${statusWord(existing).toLowerCase()}).`);
      const trip = db.trips.find((candidate) => candidate.id === existing.tripId);
      if (!trip) return fail("The run this seat was booked on no longer exists.");

      // A contract can be suspended or run out between the request and the confirmation, so the check
      // is repeated here rather than trusted from the day the seat was asked for (D-95).
      const contractIssue = bookingContractProblem(db, existing.clientId, existing.serviceDate, now.slice(0, 10));
      if (contractIssue) return fail(contractIssue, { tripId: contractIssue });

      const seat = seatErrors(db, trip, existing.passengerId, now, existing.id);
      if (Object.keys(seat).length) {
        // A full run does not lose the request: it goes to the waiting list, in arrival order.
        if (seat.tripId && /is full/.test(seat.tripId) && existing.status !== "waitlisted") {
          const moved: Booking = {
            ...existing,
            status: "waitlisted",
            offeredAt: null,
            updatedAt: now,
            history: [...existing.history, entry(actor, now, "Waitlisted", seat.tripId)],
          };
          const next = audit({ ...db, bookings: db.bookings.map((booking) => (booking.id === moved.id ? moved : booking)) }, actor, {
            action: "bookings:waitlist",
            entity: "booking",
            entityId: moved.id,
            summary: `${existing.reference} put on the waiting list for ${trip.reference}: the run is full.`,
          }, now);
          return { ok: true, db: next, message: `${existing.reference} is on the waiting list for ${trip.reference}: the run is full. Nobody is confirmed.` };
        }
        return fail("This seat cannot be confirmed.", seat);
      }

      const updated: Booking = {
        ...existing,
        status: "confirmed",
        offeredAt: null,
        updatedAt: now,
        history: [...existing.history, entry(actor, now, "Confirmed", `Seat held on ${trip.reference}.`)],
      };
      const next = audit({ ...db, bookings: db.bookings.map((booking) => (booking.id === updated.id ? updated : booking)) }, actor, {
        action: "bookings:confirm",
        entity: "booking",
        entityId: updated.id,
        summary: `${updated.reference} confirmed on ${trip.reference}.`,
      }, now);
      const capacity = capacityOf(next, trip);
      return { ok: true, db: next, message: `${updated.reference} confirmed on ${trip.reference}. ${capacity.free} seat(s) left.` };
    }

    case "reject_booking": {
      const denied = authorise(actor, "bookings:manage");
      if (denied) return denied;
      const existing = db.bookings.find((booking) => booking.id === command.id);
      if (!existing) return fail("Booking not found.");
      if (existing.status === "cancelled" || existing.status === "rejected") return fail(`${existing.reference} is already ${statusWord(existing).toLowerCase()}.`);
      const reason = command.reason.trim();
      if (!reason) return fail("Say why the request is refused. The reason is kept with the booking.", { reason: "A reason is required." });
      const updated: Booking = {
        ...existing,
        status: "rejected",
        note: reason,
        offeredAt: null,
        updatedAt: now,
        history: [...existing.history, entry(actor, now, "Rejected", reason)],
      };
      const next = audit({ ...db, bookings: db.bookings.map((booking) => (booking.id === updated.id ? updated : booking)) }, actor, {
        action: "bookings:reject",
        entity: "booking",
        entityId: updated.id,
        summary: `${updated.reference} rejected: ${reason}`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} rejected.` };
    }

    case "cancel_booking": {
      const existing = db.bookings.find((booking) => booking.id === command.id);
      if (!existing) return fail("Booking not found.");

      // The office may cancel anything; a client's own contact may cancel its own people's seats; a
      // passenger may cancel the seat it holds and nobody else's (PAX-01, D-97).
      const ownClientCancel = actor?.role === "client_contact" && can(actor.role, "bookings:create");
      const ownSeatCancel = actor?.role === "passenger" && can(actor.role, "bookings:create") && existing.passengerId === confinedPassengerId(db, actor);
      if (!ownClientCancel && !ownSeatCancel) {
        const denied = authorise(actor, "bookings:manage");
        if (denied) return denied;
      }
      if (outsideOwnClient(db, actor, existing.clientId)) return fail("Your account is confined to your own company's bookings.");
      if (existing.status === "cancelled") return fail(`${existing.reference} is already cancelled.`);
      if (existing.status === "rejected") return fail(`${existing.reference} was rejected; there is nothing to cancel.`);

      const reason = command.reason.trim();
      if (!reason) return fail("Say why the booking is cancelled.", { reason: "A reason is required." });

      const trip = db.trips.find((candidate) => candidate.id === existing.tripId);
      // BKG-05: a cut-off applies only when management has set one (D-83).
      const cutoff = db.settings.booking.cancellationCutoffMinutes;
      if (cutoff !== null && trip) {
        const minutes = minutesToDeparture(db, trip, now);
        if (minutes !== null && minutes < cutoff)
          return fail(
            `Too late to cancel: ${trip.reference} departs in ${Math.max(minutes, 0)} minute(s) and the cut-off is ${cutoff}. Ring the office.`,
            { reason: "The cancellation cut-off has passed." },
          );
      }

      const cancelled: Booking = {
        ...existing,
        status: "cancelled",
        note: reason,
        offeredAt: null,
        cancelledAt: now,
        cancelledBy: actor?.fullName ?? "System",
        updatedAt: now,
        history: [...existing.history, entry(actor, now, "Cancelled", reason)],
      };
      let nextDb: Database = { ...db, bookings: db.bookings.map((booking) => (booking.id === cancelled.id ? cancelled : booking)) };

      // A held seat is offered to the oldest waiter on that run. Offered, never confirmed.
      let offeredReference: string | null = null;
      if (SEAT_HOLDING_STATUSES.includes(existing.status) && trip) {
        const capacity = capacityOf(nextDb, trip);
        if (capacity.vehicle && capacity.free > 0) {
          const waiter = nextDb.bookings
            .filter((booking) => booking.tripId === existing.tripId && booking.status === "waitlisted")
            .sort((a, b) => (a.createdAt === b.createdAt ? a.reference.localeCompare(b.reference) : a.createdAt < b.createdAt ? -1 : 1))[0];
          if (waiter) {
            const offered: Booking = {
              ...waiter,
              status: "offered",
              offeredAt: now,
              updatedAt: now,
              history: [...waiter.history, entry(actor, now, "Seat offered", `A seat freed on ${trip.reference}. Confirm it before departure.`)],
            };
            nextDb = { ...nextDb, bookings: nextDb.bookings.map((booking) => (booking.id === offered.id ? offered : booking)) };
            offeredReference = offered.reference;
          }
        }
      }

      const next = audit(nextDb, actor, {
        action: "bookings:cancel",
        entity: "booking",
        entityId: cancelled.id,
        summary: `${cancelled.reference} cancelled: ${reason}${offeredReference ? ` Seat offered to ${offeredReference}.` : ""}`,
      }, now);
      return {
        ok: true,
        db: next,
        message: `${cancelled.reference} cancelled.${offeredReference ? ` The freed seat was offered to ${offeredReference}; nobody is confirmed yet.` : ""}`,
      };
    }
  }
}
