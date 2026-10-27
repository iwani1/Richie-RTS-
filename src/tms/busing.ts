// Staff busing: routes, passenger rosters, trip generation, assignment, dispatch,
// completion (actual stop times and boarding outcomes) and cancellation.
// Every write goes through executeBusing(), which checks permissions, validates input,
// enforces the trip state machine and writes an audit entry.

import { manifestAtStop, manifestFor, seatsHeld } from "./bookings";
import { isActiveRental } from "./rentalWorkflow";
import { describeDocumentGaps, requiredDocumentGaps } from "./compliance";
import { overdueServiceFor } from "./maintenance";
import { audit, authorise, fail, isValidDate, makeId, norm, TIME_RE, type Actor, type CommandResult, type Errors } from "./service";
import { licenceClassProblem } from "./driving";
import { readStopDetail, type StopDetailInput } from "./stops";
import { allocateReference } from "./references";
import { delayLine, minutesLabel, readDelayInput } from "./delays";
import { mayActOnTrip } from "./scope";
import {
  DIRECTIONS,
  PASSENGER_STATUSES,
  ROUTE_STATUSES,
  VEHICLE_STATUS_LABELS,
  type BoardingOutcome,
  type BoardingRecord,
  type BusRoute,
  type Database,
  type Direction,
  type Passenger,
  type PassengerStatus,
  type RosterChange,
  type RouteStatus,
  type Trip,
  type TripCorrection,
  type TripCorrectionField,
  type TripDelay,
} from "./types";

export const BUSING_COMMAND_TYPES = [
  "create_route",
  "update_route",
  "create_passenger",
  "update_passenger",
  "generate_trips",
  "create_adhoc_trip",
  "assign_trip",
  "dispatch_trip",
  "start_trip",
  "record_trip_stop",
  "complete_trip",
  "cancel_trip",
  "correct_trip_record",
  "record_trip_delay",
] as const;

export interface StopInput extends StopDetailInput {
  id?: string;
  name: string;
  scheduledTime: string;
}

export interface RouteInput {
  name: string;
  clientId: string;
  direction: Direction;
  shiftId: string;
  vehicleCategoryId: string;
  weekdays: number[];
  startDate: string;
  endDate: string;
  stops: StopInput[];
  status: RouteStatus;
}

export interface PassengerInput {
  fullName: string;
  employeeRef: string;
  phone: string;
  clientId: string;
  routeId: string;
  stopId: string;
  status: PassengerStatus;
}

export interface TripAssignInput {
  vehicleId: string;
  driverId: string;
}

export interface CompleteTripInput {
  stopTimes: { stopId: string; actualTime: string }[];
  boardings: { passengerId: string; outcome: BoardingOutcome }[];
}

/**
 * A run that the schedule did not produce (DSP-03, D-82). The reason is not optional: an out-of-
 * schedule run is an exception, and the record has to say why it happened while the people who know
 * are still in the room.
 */
export interface AdhocTripInput {
  routeId: string;
  serviceDate: string;
  reason: string;
  /** Both or neither. A run can be created before a vehicle is free and assigned later. */
  vehicleId: string;
  driverId: string;
}

export interface ProgressiveStopInput {
  stopId: string;
  actualTime: string;
  boardings: { passengerId: string; outcome: BoardingOutcome }[];
}

/**
 * A correction to something already recorded (D-74).
 *
 * `field` says which value moved; `passengerId` is required only for a boarding outcome. `reason`
 * is not optional: a correction without a stated reason is an edit with extra steps.
 */
export interface TripCorrectionInput {
  field: TripCorrectionField;
  stopId: string;
  passengerId?: string;
  newValue: string;
  reason: string;
}

/**
 * A run that is late, reported while it is still out (DSP-04, D-105).
 *
 * Not a correction: the run is not finished, and nothing already recorded is being changed. It is a
 * statement about the road, made by the person who can see it, so the office can answer the phone
 * with a number instead of a guess.
 */
export interface TripDelayInput {
  /** Minutes behind. Arrives as a string from a number input; `readDelayInput` decides. */
  minutes: number | string;
  reason: string;
}

export type BusingCommand =
  | { type: "create_route"; input: RouteInput }
  | { type: "update_route"; id: string; input: RouteInput }
  | { type: "create_passenger"; input: PassengerInput }
  | { type: "update_passenger"; id: string; input: PassengerInput }
  | { type: "generate_trips"; routeId: string; fromDate: string; toDate: string }
  | { type: "create_adhoc_trip"; input: AdhocTripInput }
  | { type: "assign_trip"; id: string; input: TripAssignInput }
  | { type: "dispatch_trip"; id: string }
  | { type: "start_trip"; id: string }
  | { type: "record_trip_stop"; id: string; input: ProgressiveStopInput }
  | { type: "complete_trip"; id: string; input?: CompleteTripInput }
  | { type: "cancel_trip"; id: string; reason: string; incidentId?: string }
  | { type: "correct_trip_record"; id: string; input: TripCorrectionInput }
  | { type: "record_trip_delay"; id: string; input: TripDelayInput };

export const MAX_GENERATE_DAYS = 62;

export function isBusingCommand(command: { type: string }): command is BusingCommand {
  return (BUSING_COMMAND_TYPES as readonly string[]).includes(command.type);
}

// ---------- time helpers ----------

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

const inclusiveDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

// A trip occupies the time from its route's first stop to its last stop on the service date.
export function tripWindow(route: BusRoute): [number, number] {
  return [toMinutes(route.stops[0].scheduledTime), toMinutes(route.stops[route.stops.length - 1].scheduledTime)];
}

// On time: every stop's actual time is no later than its scheduled time plus the threshold.
// Early arrivals count as on time.
export function tripOnTime(trip: Trip, route: BusRoute, thresholdMinutes: number): boolean {
  return trip.stopLogs.every((log) => {
    const stop = route.stops.find((s) => s.id === log.stopId);
    return !!stop && toMinutes(log.actualTime) - toMinutes(stop.scheduledTime) <= thresholdMinutes;
  });
}

// ---------- validators ----------

export function validateRoute(db: Database, input: RouteInput, excludeId?: string) {
  const errors: Errors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Route name is required.";

  const client = db.clients.find((c) => c.id === input.clientId);
  if (!input.clientId) errors.clientId = "Select the client this route serves.";
  else if (!client) errors.clientId = "Unknown client.";
  else if (client.status !== "active") errors.clientId = "This client is inactive.";

  if (!DIRECTIONS.includes(input.direction)) errors.direction = "Select a direction.";
  if (input.shiftId && !db.settings.shifts.some((s) => s.id === input.shiftId)) errors.shiftId = "Unknown shift.";

  if (!input.vehicleCategoryId) errors.vehicleCategoryId = "Select a vehicle category.";
  else if (!db.settings.vehicleCategories.some((c) => c.id === input.vehicleCategoryId)) errors.vehicleCategoryId = "Unknown vehicle category.";

  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    errors.weekdays = "Select at least one operating day.";

  if (!isValidDate(input.startDate)) errors.startDate = "Enter the start date.";
  if (input.endDate && !isValidDate(input.endDate)) errors.endDate = "Enter a valid end date, or leave it blank.";
  else if (input.endDate && isValidDate(input.startDate) && input.endDate < input.startDate)
    errors.endDate = "End date cannot be before the start date.";

  if (!ROUTE_STATUSES.includes(input.status)) errors.status = "Invalid status.";

  const stops = input.stops.map((s, i) => {
    // Directions are checked beside the name and time (RTE-01), and their errors are keyed to the
    // stop so the form can point at the one that needs fixing.
    const detail = readStopDetail(s, i);
    Object.assign(errors, detail.errors);
    return { id: s.id || makeId(), name: s.name.trim(), scheduledTime: s.scheduledTime.trim(), ...detail.value };
  });
  if (stops.length < 2) errors.stops = "A route needs at least two stops (a start and a destination).";
  const seen = new Set<string>();
  stops.forEach((s, i) => {
    if (!s.name) errors[`stops.${i}.name`] = "Stop name is required.";
    else if (seen.has(norm(s.name))) errors[`stops.${i}.name`] = "Duplicate stop name.";
    seen.add(norm(s.name));
    if (!TIME_RE.test(s.scheduledTime)) errors[`stops.${i}.scheduledTime`] = "Use HH:MM (24-hour).";
    else if (i > 0 && TIME_RE.test(stops[i - 1].scheduledTime) && s.scheduledTime < stops[i - 1].scheduledTime)
      errors[`stops.${i}.scheduledTime`] = "Times must not go backwards along the route.";
  });

  // Once trips exist, the stop list, client and vehicle category are locked so completed
  // trip records always point at stops that still exist. The *directions* are deliberately not part
  // of that lock (RTE-01): a wrong landmark is a typo to be corrected, and refusing it would leave
  // a driver following a wrong one for the life of the route. The identity of a stop is its name,
  // its time and its id — those are what a recorded trip points at.
  if (excludeId && db.trips.some((t) => t.routeId === excludeId)) {
    const existing = db.routes.find((r) => r.id === excludeId);
    const sameStops =
      !!existing &&
      existing.stops.length === stops.length &&
      existing.stops.every((s, i) => s.id === stops[i].id && s.name === stops[i].name && s.scheduledTime === stops[i].scheduledTime);
    if (existing && (!sameStops || existing.clientId !== input.clientId || existing.vehicleCategoryId !== input.vehicleCategoryId))
      errors.stops = "Stops, client and vehicle category are locked because trips already exist for this route. Create a new route instead.";
  }

  return {
    errors,
    value: {
      name,
      clientId: input.clientId,
      direction: input.direction,
      shiftId: input.shiftId || null,
      vehicleCategoryId: input.vehicleCategoryId,
      weekdays,
      startDate: input.startDate,
      endDate: input.endDate || null,
      stops,
      status: input.status,
    },
  };
}

export function validatePassenger(db: Database, input: PassengerInput, excludeId?: string) {
  const errors: Errors = {};
  const fullName = input.fullName.trim();
  if (!fullName) errors.fullName = "Full name is required.";

  const client = db.clients.find((c) => c.id === input.clientId);
  if (!input.clientId) errors.clientId = "Select the client.";
  else if (!client) errors.clientId = "Unknown client.";
  else if (client.status !== "active") errors.clientId = "This client is inactive.";

  const employeeRef = input.employeeRef.trim();
  if (employeeRef && db.passengers.some((p) => p.id !== excludeId && p.clientId === input.clientId && norm(p.employeeRef) === norm(employeeRef)))
    errors.employeeRef = "This employee reference already exists for this client.";

  if (!PASSENGER_STATUSES.includes(input.status)) errors.status = "Invalid status.";

  const routeId: string | null = input.routeId || null;
  const stopId: string | null = routeId ? input.stopId || null : null;
  if (routeId) {
    const route = db.routes.find((r) => r.id === routeId);
    if (!route) errors.routeId = "Unknown route.";
    else if (route.clientId !== input.clientId) errors.routeId = "This route belongs to a different client.";
    else if (route.status === "ended") errors.routeId = "This route has ended.";
    if (route && !errors.routeId) {
      if (!stopId) errors.stopId = "Select the pickup stop.";
      else if (!route.stops.some((s) => s.id === stopId)) errors.stopId = "This stop does not belong to the selected route.";
    }
  }

  return {
    errors,
    value: { fullName, clientId: input.clientId, employeeRef, phone: input.phone.trim(), routeId, stopId, status: input.status },
  };
}

// Phase 11: mid-trip passenger changes. Stops already recorded on any in-progress trip on
// the route are immutable; future stops may gain, lose, or move passengers.
function inProgressTripsForRoute(db: Database, routeId: string | null): Trip[] {
  if (!routeId) return [];
  return db.trips.filter((trip) => trip.routeId === routeId && trip.status === "in_progress");
}

/** The name of a stop, for a sentence a driver can read. */
function stopNameOf(db: Database, routeId: string | null, stopId: string | null): string {
  if (!routeId || !stopId) return "an unassigned stop";
  return db.routes.find((route) => route.id === routeId)?.stops.find((stop) => stop.id === stopId)?.name ?? "an unknown stop";
}

/**
 * Marks a roster change on every run of this route that is already under way (Q-48, D-79).
 *
 * Nothing is pushed anywhere: there is no notification channel, and pretending one exists would be
 * worse than silence. The marker waits on the run, so the driver sees it on the next stop form.
 * A run that has not started needs no marker — its roster is simply the roster it will start with.
 */
function markRosterChange(db: Database, routeId: string | null, entry: RosterChange, now: string): Database {
  if (!routeId) return db;
  if (!db.trips.some((trip) => trip.routeId === routeId && trip.status === "in_progress")) return db;
  return {
    ...db,
    trips: db.trips.map((trip) =>
      trip.routeId === routeId && trip.status === "in_progress"
        ? { ...trip, rosterChanges: [...trip.rosterChanges, entry], updatedAt: now }
        : trip,
    ),
  };
}

const rosterChangeEntry = (actor: Actor | null, now: string, summary: string): RosterChange => ({
  id: makeId(),
  at: now,
  by: actor?.fullName ?? "System",
  summary,
});

// In-progress trips on this route that already recorded the given stop.
function tripsWithRecordedStop(trips: Trip[], stopId: string): Trip[] {
  return trips.filter((trip) => trip.stopLogs.some((log) => log.stopId === stopId));
}

// Field errors when a passenger edit would disturb an in-progress run, or {} when safe.
// A passenger with a boarding outcome on any in-progress trip keeps only personal-detail
// edits; otherwise the new effective assignment must be future on every in-progress trip.
function midTripPassengerErrors(
  db: Database,
  existing: Passenger,
  value: { routeId: string | null; stopId: string | null; status: PassengerStatus; clientId: string },
): Errors {
  const errors: Errors = {};
  const boardedTrips = db.trips.filter(
    (trip) => trip.status === "in_progress" && trip.boardings.some((record) => record.passengerId === existing.id),
  );
  if (boardedTrips.length > 0) {
    const refs = boardedTrips.map((trip) => trip.reference).join(", ");
    if (value.routeId !== existing.routeId) errors.routeId = `This passenger already boarded on ${refs}; the route cannot be changed mid-run.`;
    if (value.stopId !== existing.stopId) errors.stopId = `This passenger already boarded on ${refs}; the pickup stop cannot be changed mid-run.`;
    if (value.status !== existing.status) errors.status = `This passenger already has a boarding outcome on ${refs}; the status cannot be changed mid-run.`;
    if (value.clientId !== existing.clientId) errors.clientId = `This passenger already boarded on ${refs}; the client cannot be changed mid-run.`;
    return errors;
  }
  if (value.status === "active" && value.routeId && value.stopId) {
    const recorded = tripsWithRecordedStop(inProgressTripsForRoute(db, value.routeId), value.stopId);
    if (recorded.length > 0)
      errors.stopId = `That stop was already recorded on ${recorded.map((trip) => trip.reference).join(", ")}. Assign a stop the run has not reached yet.`;
  }
  return errors;
}

/**
 * How many people the run must carry: every active passenger on the route. A passenger outside
 * the vehicle's seats is a refusal, never a warning — capacity is a safety limit, not a metric
 * (brief 5.1 and 12). The number is recomputed at assign, dispatch and start, so a roster that
 * grew after the vehicle was chosen cannot slip through.
 */
export function rosterCount(db: Database, routeId: string): number {
  return db.passengers.filter((passenger) => passenger.routeId === routeId && passenger.status === "active").length;
}

/**
 * A run that is already on the road cannot be re-planned, so the roster check that happens at
 * assign, dispatch and start has nothing to say about a rider added mid-run. Without this, a
 * vehicle could leave the yard with a seat for every passenger and finish the trip over capacity.
 * Capacity is a safety limit (brief 5.1, 12), so the addition is refused rather than warned about.
 */
function midRunCapacityErrors(db: Database, routeId: string | null, extraActive: number): Errors {
  if (!routeId || extraActive <= 0) return {};
  const running = db.trips.filter((trip) => trip.routeId === routeId && trip.status === "in_progress" && trip.vehicleId);
  for (const trip of running) {
    // D-85: the seats sold for this run are already on the bus, so a rider added mid-run is measured
    // against them too.
    const count = rosterCount(db, routeId) + extraActive + seatsHeld(db, trip.id);
    const vehicle = db.vehicles.find((candidate) => candidate.id === trip.vehicleId);
    if (vehicle && vehicle.seatCapacity < count) {
      return {
        routeId: `${trip.reference} is already running and ${vehicle.registration} seats ${vehicle.seatCapacity}. ${count} active passengers would not fit; move someone to another run or take the request after it returns.`,
      };
    }
  }
  return {};
}

/**
 * Q-43 (D-80). An overdue routine service does not stop the work while the strict rule is off, so the
 * only place to say it is the message the office reads after pressing the button. Naming the vehicle
 * and the interval it has passed is the difference between a warning and noise.
 */
function serviceNotice(db: Database, vehicleId: string | null, today: string): string {
  if (!vehicleId) return "";
  const overdue = overdueServiceFor(db, vehicleId, today);
  return overdue ? ` Note: ${overdue} Settings allows this because an overdue service only warns.` : "";
}

/** Dispatch and start have no fields to point at, so the reason has to be in the message itself. */
function blockedReason(label: string, errors: Errors): string {
  const details = Object.values(errors).filter((text): text is string => Boolean(text));
  return details.length ? `${label} blocked: ${details.join(" ")}` : `${label} blocked: the assigned resources are no longer valid.`;
}

/**
 * Vehicle and driver checks for a trip, including same-day time overlaps and rental clashes.
 *
 * Exported because the planning aid (RTE-04, D-96) asks exactly this question of every pair it can
 * offer: the aid may only suggest an assignment this function would accept, so a dispatcher who takes
 * a suggestion cannot be refused by the save that follows.
 */
export function assessResources(db: Database, route: BusRoute, trip: Trip, vehicleId: string, driverId: string, today: string): Errors {
  const errors: Errors = {};

  const vehicle = db.vehicles.find((v) => v.id === vehicleId);
  if (!vehicleId) errors.vehicleId = "Select a vehicle.";
  else if (!vehicle) errors.vehicleId = "Unknown vehicle.";
  else if (vehicle.categoryId !== route.vehicleCategoryId) errors.vehicleId = "Vehicle category does not match the route.";
  else if (vehicle.status !== "available") errors.vehicleId = `Vehicle must be Available to be assigned (currently ${VEHICLE_STATUS_LABELS[vehicle.status].toLowerCase()}).`;
  else if (vehicle.seatCapacity < rosterCount(db, route.id) + seatsHeld(db, trip.id))
    // D-85: the roster and the seats sold for this run are carried by the same vehicle, so the
    // vehicle is judged against both. Without this, reassigning to a smaller bus would strand a
    // booked visitor whose seat the office has already promised.
    errors.vehicleId = `This vehicle seats ${vehicle.seatCapacity}; ${route.reference} has ${rosterCount(db, route.id)} active passengers and ${seatsHeld(db, trip.id)} booked seat(s). Use a larger vehicle, or take staff off the roster first.`;
  else {
    // Mandatory papers are checked against the service date of the run (Q-16, D-76).
    const gaps = requiredDocumentGaps(db, "vehicle", vehicle.id, trip.serviceDate);
    if (gaps.length) errors.vehicleId = describeDocumentGaps(`Vehicle ${vehicle.registration}`, gaps);
    else if (db.settings.maintenance.blockOnOverdueService) {
      // Q-43 (D-80): a safety defect already took the vehicle out of service, so the only thing left
      // to decide is a *routine* service. Overdue is judged as at today: it is a fact about the
      // vehicle now, and a run arranged for next week is re-checked on the day it is dispatched.
      const overdue = overdueServiceFor(db, vehicle.id, today);
      if (overdue) errors.vehicleId = `${overdue} The vehicle cannot be used until it is serviced: Settings blocks an overdue service.`;
    }
  }

  const driver = db.drivers.find((d) => d.id === driverId);
  if (!driverId) errors.driverId = "Select a driver.";
  else if (!driver) errors.driverId = "Unknown driver.";
  else if (driver.status !== "active") errors.driverId = `Driver is ${driver.status} and cannot be assigned.`;
  else if (driver.licenceExpiry < trip.serviceDate) errors.driverId = "Driver's licence expires before the service date.";
  // FLT-04: the licence has to cover the *class* of vehicle, not merely be in date. Checked against
  // the vehicle actually being signed to the run, because that is what will be driven.
  else if (vehicle && licenceClassProblem(db, driver, vehicle.categoryId))
    errors.driverId = licenceClassProblem(db, driver, vehicle.categoryId)!;
  else {
    const gaps = requiredDocumentGaps(db, "driver", driver.id, trip.serviceDate);
    if (gaps.length) errors.driverId = describeDocumentGaps(`Driver ${driver.fullName}`, gaps);
  }

  if (errors.vehicleId || errors.driverId) return errors;

  const [start, end] = tripWindow(route);
  for (const other of db.trips) {
    if (other.id === trip.id || other.serviceDate !== trip.serviceDate) continue;
    if (other.status !== "planned" && other.status !== "dispatched" && other.status !== "in_progress") continue;
    const otherRoute = db.routes.find((r) => r.id === other.routeId);
    if (!otherRoute) continue;
    const [oStart, oEnd] = tripWindow(otherRoute);
    if (!(start < oEnd && oStart < end)) continue; // back-to-back or separate runs are allowed
    if (other.vehicleId === vehicleId) errors.vehicleId = `Vehicle is already on ${other.reference} at an overlapping time that day.`;
    if (other.driverId === driverId) errors.driverId = `Driver is already on ${other.reference} at an overlapping time that day.`;
  }

  for (const rental of db.rentals) {
    if (!isActiveRental(rental.status)) continue;
    if (trip.serviceDate < rental.startDate || trip.serviceDate > rental.endDate) continue;
    if (rental.assignedVehicleId === vehicleId) errors.vehicleId = `Vehicle is assigned to rental ${rental.reference} on this date.`;
    if (rental.assignedDriverId === driverId) errors.driverId = `Driver is assigned to rental ${rental.reference} on this date.`;
  }

  return errors;
}

// ---------- command execution ----------

export function executeBusing(db: Database, actor: Actor | null, command: BusingCommand, now: string = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "create_route": {
      const denied = authorise(actor, "routes:create");
      if (denied) return denied;
      const { errors, value } = validateRoute(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const { reference, counters } = allocateReference(db, "route", now.slice(0, 4));
      const created: BusRoute = {
        id: makeId(),
        reference,
        ...value,
        createdAt: now,
        updatedAt: now,
      };
      const next = audit({ ...db, referenceCounters: counters, routes: [...db.routes, created] }, actor, {
        action: "routes:create",
        entity: "route",
        entityId: created.id,
        summary: `Route ${created.reference} created with ${created.stops.length} stops (${created.status}).`,
      }, now);
      return { ok: true, db: next, message: `Route ${created.reference} created.` };
    }

    case "update_route": {
      const denied = authorise(actor, "routes:update");
      if (denied) return denied;
      const existing = db.routes.find((r) => r.id === command.id);
      if (!existing) return fail("Route not found.");
      const { errors, value } = validateRoute(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: BusRoute = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, routes: db.routes.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "routes:update",
        entity: "route",
        entityId: updated.id,
        summary: `Route ${updated.reference} updated (${updated.status}).`,
      }, now);
      return { ok: true, db: next, message: `Route ${updated.reference} updated.` };
    }

    case "create_passenger": {
      const denied = authorise(actor, "passengers:create");
      if (denied) return denied;
      const { errors, value } = validatePassenger(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      // A new active passenger may only join a stop still in the future on every
      // in-progress trip on the route. Inactive or unassigned records affect no run.
      if (value.status === "active" && value.routeId && value.stopId) {
        const recorded = tripsWithRecordedStop(inProgressTripsForRoute(db, value.routeId), value.stopId);
        if (recorded.length > 0)
          return fail(
            `That stop was already recorded on ${recorded.map((trip) => trip.reference).join(", ")}. New riders can only join a stop the run has not reached yet.`,
            { stopId: "This stop is already recorded on a run in progress." },
          );
      }
      const capacity = value.status === "active" ? midRunCapacityErrors(db, value.routeId, 1) : {};
      if (Object.keys(capacity).length)
        return fail(capacity.routeId ?? "This would exceed the vehicle's seats on a run in progress.", capacity);
      const created: Passenger = { id: makeId(), ...value, createdAt: now, updatedAt: now };
      const running = inProgressTripsForRoute(db, value.routeId);
      const midTrip = running.length > 0 ? ` Mid-trip addition during ${running.map((trip) => trip.reference).join(", ")}.` : "";
      // Personal data is deliberately kept out of the audit summary, but the driver's own roster
      // marker names the rider: that is what he needs in order to pick the right person up (Q-48).
      const withChange =
        created.status === "active" && created.routeId
          ? markRosterChange(
              { ...db, passengers: [...db.passengers, created] },
              created.routeId,
              rosterChangeEntry(actor, now, `${created.fullName} joined this roster at ${stopNameOf(db, created.routeId, created.stopId)}.`),
              now,
            )
          : { ...db, passengers: [...db.passengers, created] };
      const next = audit(withChange, actor, {
        action: "passengers:create",
        entity: "passenger",
        entityId: created.id,
        summary: `Passenger record created (${created.status}${created.routeId ? ", on a route" : ", no route"}).${midTrip}`,
      }, now);
      return { ok: true, db: next, message: "Passenger record created." };
    }

    case "update_passenger": {
      const denied = authorise(actor, "passengers:update");
      if (denied) return denied;
      const existing = db.passengers.find((p) => p.id === command.id);
      if (!existing) return fail("Passenger not found.");
      const { errors, value } = validatePassenger(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const midTripErrors = midTripPassengerErrors(db, existing, value);
      if (Object.keys(midTripErrors).length)
        return fail("This change would disturb a run in progress. Only future stops can be changed mid-trip.", midTripErrors);
      const stillOnSameRoute = existing.status === "active" && existing.routeId === value.routeId;
      const capacity = value.status === "active" && value.routeId && !stillOnSameRoute ? midRunCapacityErrors(db, value.routeId, 1) : {};
      if (Object.keys(capacity).length)
        return fail(capacity.routeId ?? "This would exceed the vehicle's seats on a run in progress.", capacity);
      const updated: Passenger = { ...existing, ...value, updatedAt: now };
      const affectedRefs = [...new Set([...inProgressTripsForRoute(db, existing.routeId), ...inProgressTripsForRoute(db, value.routeId)].map((trip) => trip.reference))];
      const midTrip = affectedRefs.length > 0 ? ` Mid-trip change during ${affectedRefs.join(", ")}.` : "";

      // What the driver has to be told, in the words he would use (Q-48). Each entry is marked on
      // the run of the route it affects, so a rider moving between routes leaves one marker behind
      // and one where he arrives.
      const wasOn = existing.status === "active" && existing.routeId !== null;
      const nowOn = updated.status === "active" && updated.routeId !== null;
      const entries: { routeId: string | null; summary: string }[] = [];
      if (wasOn && !nowOn) entries.push({ routeId: existing.routeId, summary: `${existing.fullName} was taken off this roster.` });
      else if (!wasOn && nowOn)
        entries.push({ routeId: updated.routeId, summary: `${updated.fullName} joined this roster at ${stopNameOf(db, updated.routeId, updated.stopId)}.` });
      else if (wasOn && nowOn && existing.routeId !== updated.routeId) {
        entries.push({ routeId: existing.routeId, summary: `${existing.fullName} moved to another route.` });
        entries.push({ routeId: updated.routeId, summary: `${updated.fullName} joined this roster at ${stopNameOf(db, updated.routeId, updated.stopId)}.` });
      } else if (wasOn && nowOn && existing.stopId !== updated.stopId)
        entries.push({
          routeId: updated.routeId,
          summary: `${updated.fullName} moved from ${stopNameOf(db, existing.routeId, existing.stopId)} to ${stopNameOf(db, updated.routeId, updated.stopId)}.`,
        });
      if (existing.fullName !== updated.fullName)
        entries.push({
          routeId: updated.routeId ?? existing.routeId,
          summary: `Name corrected: ${existing.fullName} is now recorded as ${updated.fullName}.`,
        });

      let afterUpdate: Database = { ...db, passengers: db.passengers.map((p) => (p.id === updated.id ? updated : p)) };
      for (const entry of entries) afterUpdate = markRosterChange(afterUpdate, entry.routeId, rosterChangeEntry(actor, now, entry.summary), now);

      const next = audit(afterUpdate, actor, {
        action: "passengers:update",
        entity: "passenger",
        entityId: updated.id,
        summary: `Passenger record updated (${updated.status}).${midTrip}${entries.length ? ` ${entries.length} roster marker(s) left on the run.` : ""}`,
      }, now);
      return { ok: true, db: next, message: "Passenger record updated." };
    }

    case "generate_trips": {
      const denied = authorise(actor, "trips:generate");
      if (denied) return denied;
      const route = db.routes.find((r) => r.id === command.routeId);
      if (!route) return fail("Route not found.");
      if (route.status !== "active") return fail(`Trips cannot be generated for a ${route.status} route.`);
      if (!isValidDate(command.fromDate) || !isValidDate(command.toDate))
        return fail("Enter a valid from and to date.", { fromDate: "Enter a valid date.", toDate: "Enter a valid date." });
      if (command.toDate < command.fromDate) return fail("The end date is before the start date.", { toDate: "Must be on or after the from date." });
      const span = inclusiveDays(command.fromDate, command.toDate);
      if (span > MAX_GENERATE_DAYS) return fail(`Generate at most ${MAX_GENERATE_DAYS} days at a time.`, { toDate: `Range is ${span} days. Generate at most ${MAX_GENERATE_DAYS} days at a time.` });

      const created: Trip[] = [];
      // Each trip takes the next number in the series, and the counters move along with it: a
      // generation of five days allocates five numbers in one transaction.
      let counters = db.referenceCounters;
      for (let i = 0; i < span; i += 1) {
        const date = addDays(command.fromDate, i);
        if (date < route.startDate) continue;
        if (route.endDate && date > route.endDate) continue;
        if (!route.weekdays.includes(weekdayOf(date))) continue;
        // Only a scheduled run blocks generation. An ad hoc run on that date was created for a
        // reason (DSP-03) and must not suppress the day's normal service.
        if (db.trips.some((t) => t.routeId === route.id && t.serviceDate === date && t.origin === "schedule")) continue;
        const allocated = allocateReference({ ...db, referenceCounters: counters }, "trip", now.slice(0, 4));
        counters = allocated.counters;
        created.push({
          id: makeId(),
          reference: allocated.reference,
          routeId: route.id,
          serviceDate: date,
          status: "planned",
          vehicleId: null,
          driverId: null,
          dispatchedAt: null,
          startedAt: null,
          completedAt: null,
          cancelReason: null,
          cancelledAt: null,
          cancelledBy: null,
          incidentId: null,
          stopLogs: [],
          boardings: [],
          onTimeThresholdMinutes: null,
          corrections: [],
          delays: [],
          rosterChanges: [],
          origin: "schedule",
          originReason: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (created.length === 0)
        return fail(`No trips generated: ${route.reference} has no operating dates in this range, or trips already exist for them.`);
      const next = audit({ ...db, referenceCounters: counters, trips: [...db.trips, ...created] }, actor, {
        action: "trips:generate",
        entity: "route",
        entityId: route.id,
        summary: `${created.length} trip(s) generated for ${route.reference} (${command.fromDate} to ${command.toDate}).`,
      }, now);
      return { ok: true, db: next, message: `${created.length} trip(s) generated for ${route.reference}.` };
    }

    case "create_adhoc_trip": {
      // Dispatch work, not planning work: the person who has to get people to work today creates it.
      const denied = authorise(actor, "trips:dispatch");
      if (denied) return denied;
      const { routeId, serviceDate, reason, vehicleId, driverId } = command.input;
      const errors: Errors = {};

      const route = db.routes.find((r) => r.id === routeId);
      if (!routeId) errors.routeId = "Choose the route this run serves.";
      else if (!route) errors.routeId = "Unknown route.";
      else if (route.status !== "active") errors.routeId = `Route is ${route.status}; a run cannot be created for it.`;

      // Today or later. Yesterday's work is recorded as it happened, not invented afterwards.
      if (!isValidDate(serviceDate)) errors.serviceDate = "Enter a valid date.";
      else if (serviceDate < now.slice(0, 10)) errors.serviceDate = "A run cannot be created for a date that has passed.";
      else if (inclusiveDays(now.slice(0, 10), serviceDate) > MAX_GENERATE_DAYS)
        errors.serviceDate = `Create a run at most ${MAX_GENERATE_DAYS} days ahead.`;

      const why = reason.trim();
      if (!why) errors.reason = "Say why this run is needed. The reason is part of the record.";

      if (vehicleId || driverId) {
        if (!vehicleId) errors.vehicleId = "Choose a vehicle, or leave both blank and assign one later.";
        if (!driverId) errors.driverId = "Choose a driver, or leave both blank and assign one later.";
      }

      if (Object.keys(errors).length) return fail("This run cannot be created yet.", errors);

      // One ad hoc run per route per date: a second press of the button, or a second dispatcher on
      // the same problem, must not quietly produce two runs and two sets of drivers' instructions.
      const twin = db.trips.find((t) => t.routeId === routeId && t.serviceDate === serviceDate && t.origin === "adhoc");
      if (twin)
        return fail(
          `${twin.reference} is already an ad hoc run for ${route!.reference} on ${serviceDate}. Use that run rather than creating another.`,
          { routeId: "An ad hoc run already exists for this route and date." },
        );

      // A run created with a vehicle is checked exactly as a planned run would be: papers, capacity,
      // licence, overlaps and rental clashes all apply on the day, not at the moment of creation.
      const draft: Trip = {
        id: makeId(),
        reference: "-",
        routeId,
        serviceDate,
        status: "planned",
        origin: "adhoc",
        originReason: why,
        vehicleId: vehicleId || null,
        driverId: driverId || null,
        dispatchedAt: null,
        startedAt: null,
        completedAt: null,
        cancelReason: null,
        cancelledAt: null,
        cancelledBy: null,
        incidentId: null,
        stopLogs: [],
        boardings: [],
        onTimeThresholdMinutes: null,
        corrections: [],
        delays: [],
        rosterChanges: [],
        createdAt: now,
        updatedAt: now,
      };
      if (vehicleId && driverId && route) {
        const resourceErrors = assessResources(db, route, draft, vehicleId, driverId, now.slice(0, 10));
        if (Object.keys(resourceErrors).length) return fail("This run cannot be created with that vehicle and driver.", resourceErrors);
      }

      const allocated = allocateReference(db, "trip", now.slice(0, 4));
      const created: Trip = { ...draft, reference: allocated.reference };
      const vehicle = vehicleId ? db.vehicles.find((v) => v.id === vehicleId) : null;
      const next = audit(
        { ...db, referenceCounters: allocated.counters, trips: [...db.trips, created] },
        actor,
        {
          action: "trips:adhoc",
          entity: "trip",
          entityId: created.id,
          summary: `${created.reference} created outside the schedule for ${route!.reference} on ${serviceDate}: ${why}${
            vehicle ? ` Vehicle ${vehicle.registration}.` : ""
          }`,
        },
        now,
      );
      return { ok: true, db: next, message: `${created.reference} created as an ad hoc run for ${route!.reference} on ${serviceDate}.` };
    }

    case "assign_trip": {
      const denied = authorise(actor, "trips:assign");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      if (existing.status !== "planned") return fail(`Only planned trips can be assigned (this trip is ${existing.status}).`);
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");
      const today = now.slice(0, 10);
      const errors = assessResources(db, route, existing, command.input.vehicleId, command.input.driverId, today);
      if (Object.keys(errors).length) return fail("Assignment blocked. See the highlighted fields.", errors);
      const vehicle = db.vehicles.find((v) => v.id === command.input.vehicleId);
      const updated: Trip = { ...existing, vehicleId: command.input.vehicleId, driverId: command.input.driverId, updatedAt: now };
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:assign",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference} assigned vehicle ${vehicle?.registration ?? "-"} and a driver.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} assigned.${serviceNotice(db, updated.vehicleId, today)}` };
    }

    case "dispatch_trip": {
      const denied = authorise(actor, "trips:dispatch");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      if (existing.status !== "planned") return fail(`Only planned trips can be dispatched (this trip is ${existing.status}).`);
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");
      if (route.status !== "active") return fail(`Route is ${route.status}; its trips cannot be dispatched.`);
      if (!existing.vehicleId || !existing.driverId) return fail("Assign a vehicle and a driver before dispatch.");
      const today = now.slice(0, 10);
      const errors = assessResources(db, route, existing, existing.vehicleId, existing.driverId, today);
      if (Object.keys(errors).length) return fail(blockedReason("Dispatch", errors), errors);
      const updated: Trip = { ...existing, status: "dispatched", dispatchedAt: now, updatedAt: now };
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:dispatch",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference} dispatched.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} dispatched.${serviceNotice(db, updated.vehicleId, today)}` };
    }

    case "start_trip": {
      const denied = authorise(actor, "trips:start");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      // Check ownership before status so a driver cannot probe another run.
      if (!mayActOnTrip(db, actor, existing.id)) return fail("You can only start a run assigned to you.");
      if (existing.status !== "dispatched") return fail(`Only a dispatched trip can be started (this trip is ${existing.status}).`);
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");
      if (route.status !== "active") return fail(`Route is ${route.status}; its trip cannot be started.`);
      // A run is worked on its service day (an overnight shift may finish after midnight, so the
      // following day is tolerated). Starting a future run — or reviving a stale one — is refused;
      // the record stays honest about when the work actually happened (brief 5.5, TRP-01).
      const today = now.slice(0, 10);
      if (today < existing.serviceDate)
        return fail(`${existing.reference} is scheduled for ${existing.serviceDate}. It cannot be started before that day.`);
      if (new Date(today).getTime() - new Date(existing.serviceDate).getTime() > 86_400_000)
        return fail(`${existing.reference} was scheduled for ${existing.serviceDate}. Cancel it and generate the run you actually worked.`);
      if (!existing.vehicleId || !existing.driverId) return fail("The trip has no assigned vehicle and driver.");
      const errors = assessResources(db, route, existing, existing.vehicleId, existing.driverId, today);
      if (Object.keys(errors).length) return fail(blockedReason("Start", errors), errors);
      const updated: Trip = { ...existing, status: "in_progress", startedAt: now, updatedAt: now };
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:start",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference} started by its assigned driver.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} started. Record each stop as you reach it.${serviceNotice(db, updated.vehicleId, today)}` };
    }

    case "record_trip_stop": {
      const denied = authorise(actor, "trips:record");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      // Own-record scope is checked before trip status (Q-42, no cross-run probing).
      if (!mayActOnTrip(db, actor, existing.id)) return fail("You can only record a stop on a run assigned to you.");
      if (existing.status !== "in_progress") return fail(`Stops can only be recorded while a trip is in progress (this trip is ${existing.status}).`);
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");
      const nextStop = route.stops[existing.stopLogs.length];
      if (!nextStop) return fail("All route stops are already recorded.");
      if (command.input.stopId !== nextStop.id)
        return fail("Stops must be recorded in route order.", { stopId: `The next stop is ${nextStop.name}.` });

      const errors: Errors = {};
      const actualTime = command.input.actualTime.trim();
      if (!TIME_RE.test(actualTime)) errors.actualTime = "Enter the actual arrival time (HH:MM).";
      const previousTime = existing.stopLogs[existing.stopLogs.length - 1]?.actualTime;
      if (TIME_RE.test(actualTime) && previousTime && actualTime < previousTime)
        errors.actualTime = `Actual time cannot go backwards from the previous stop (${previousTime}).`;

      // D-85: the people to account for at this stop are the roster *and* whoever holds a booked
      // seat here. A visitor left off the list is a visitor nobody records.
      const expected = manifestAtStop(db, existing, nextStop.id)
        .map((entry) => entry.passenger)
        .filter((passenger) => !existing.boardings.some((record) => record.passengerId === passenger.id));
      const seen = new Set<string>();
      const newBoardings: BoardingRecord[] = [];
      for (const item of command.input.boardings) {
        const passenger = expected.find((p) => p.id === item.passengerId);
        if (!passenger) {
          errors.boardings = "A rider is not expected at this stop on this run.";
          continue;
        }
        if (seen.has(passenger.id) || existing.boardings.some((record) => record.passengerId === passenger.id)) {
          errors.boardings = "A passenger can have only one outcome on a run.";
          continue;
        }
        if (item.outcome !== "boarded" && item.outcome !== "no_show") {
          errors.boardings = "Select boarded or did not board.";
          continue;
        }
        seen.add(passenger.id);
        newBoardings.push({ passengerId: passenger.id, stopId: nextStop.id, outcome: item.outcome });
      }
      if (!errors.boardings && seen.size !== expected.length)
        errors.boardings = `Record an outcome for every rider expected at ${nextStop.name} (${expected.length}).`;
      if (Object.keys(errors).length) return fail("This stop record is incomplete. See the highlighted fields.", errors);

      const updated: Trip = {
        ...existing,
        stopLogs: [...existing.stopLogs, { stopId: nextStop.id, actualTime }],
        boardings: [...existing.boardings, ...newBoardings],
        updatedAt: now,
      };
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:record_stop",
        entity: "trip",
        entityId: updated.id,
        // Do not put passenger names in the general audit log.
        summary: `${updated.reference}: ${nextStop.name} recorded at ${actualTime}; ${newBoardings.length} boarding outcome(s).`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference}: ${nextStop.name} recorded.` };
    }

    case "complete_trip": {
      const denied = authorise(actor, "trips:complete");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      // Own-record scope is checked before anything else so a driver cannot learn
      // another run's state by probing it (D-25).
      if (!mayActOnTrip(db, actor, existing.id))
        return fail("You can only complete a run assigned to you.");
      if (existing.status !== "dispatched" && existing.status !== "in_progress")
        return fail(`Only a dispatched or in-progress trip can be completed (this trip is ${existing.status}).`);
      if (existing.status === "in_progress" && command.input)
        return fail("This run already has progressive stop records. Completion will use those records; they cannot be replaced here.");
      if (existing.status === "dispatched" && !command.input)
        return fail("No stop-by-stop records exist. Record the full completion or start the run first.");
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");

      const errors: Errors = {};
      const times = new Map<string, string>(existing.stopLogs.map((stop) => [stop.stopId, stop.actualTime]));
      if (command.input) {
        for (const stop of command.input.stopTimes) {
          if (!route.stops.some((routeStop) => routeStop.id === stop.stopId)) errors.stopTimes = "A stop does not belong to this route.";
          times.set(stop.stopId, stop.actualTime.trim());
        }
      }
      route.stops.forEach((s, i) => {
        if (!TIME_RE.test(times.get(s.id) ?? "")) errors[`stopTimes.${i}`] = "Enter the actual time at this stop (HH:MM).";
      });

      // D-85: the manifest is the roster plus the seats that were sold for this run.
      const manifest = manifestFor(db, existing);
      const expected = new Map(manifest.map((entry) => [entry.passenger.id, entry]));
      const boardings: BoardingRecord[] = [...existing.boardings];
      const seen = new Set<string>();
      for (const b of command.input?.boardings ?? []) {
        const entry = expected.get(b.passengerId);
        if (!entry) {
          errors.boardings = "A recorded rider is not expected on this run.";
          continue;
        }
        if (seen.has(b.passengerId) || boardings.some((record) => record.passengerId === b.passengerId)) {
          errors.boardings = "A rider has more than one outcome recorded.";
          continue;
        }
        if (b.outcome !== "boarded" && b.outcome !== "no_show") {
          errors.boardings = "Invalid boarding outcome.";
          continue;
        }
        seen.add(b.passengerId);
        boardings.push({ passengerId: b.passengerId, stopId: entry.pickupStopId, outcome: b.outcome });
      }
      // Every rider expected on the run must be accounted for. A record already on the run counts:
      // it was made when that rider was expected, and a roster or a booking change since then does
      // not turn a recorded boarding into a missing one.
      const unaccounted = manifest.filter((entry) => !boardings.some((record) => record.passengerId === entry.passenger.id));
      if (!errors.boardings && unaccounted.length > 0)
        errors.boardings = `Record an outcome for every rider expected on this run (${unaccounted.length} still to record).`;
      if (Object.keys(errors).length) return fail("The trip record is incomplete. See the highlighted fields.", errors);

      const threshold = db.settings.onTimeThresholdMinutes;
      const updated: Trip = {
        ...existing,
        status: "completed",
        stopLogs: route.stops.map((s) => ({ stopId: s.id, actualTime: times.get(s.id) ?? "" })),
        boardings,
        completedAt: now,
        onTimeThresholdMinutes: threshold,
        updatedAt: now,
      };
      const timing =
        threshold === null
          ? "On-time not computed: the threshold is not configured (Q-06)."
          : `On time: ${tripOnTime(updated, route, threshold) ? "yes" : "no"} (threshold ${threshold} min).`;
      const boarded = boardings.filter((b) => b.outcome === "boarded").length;
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:complete",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference} completed: ${boarded} boarded, ${boardings.length - boarded} no-show. ${timing}`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} completed. ${timing}` };
    }

    case "correct_trip_record": {
      const denied = authorise(actor, "trips:correct");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      const route = db.routes.find((r) => r.id === existing.routeId);
      if (!route) return fail("Route not found.");

      const field = command.input.field;
      const reason = command.input.reason.trim();
      const errors: Errors = {};
      if (field !== "stop_time" && field !== "boarding_outcome") errors.field = "Choose what is being corrected.";
      if (!reason) errors.reason = "Say why this record is being corrected.";
      else if (reason.length > 200) errors.reason = "Keep the reason to 200 characters.";

      const logIndex = existing.stopLogs.findIndex((log) => log.stopId === command.input.stopId);
      const stop = route.stops.find((candidate) => candidate.id === command.input.stopId);
      if (!stop) errors.stopId = "That stop is not on this route.";
      else if (logIndex < 0) errors.stopId = `${stop.name} has no recorded time on ${existing.reference}, so there is nothing to correct.`;

      let previousValue: string | null = null;
      let newStopLogs = existing.stopLogs;
      let newBoardings = existing.boardings;

      if (!Object.keys(errors).length && field === "stop_time") {
        previousValue = existing.stopLogs[logIndex].actualTime;
        const value = command.input.newValue.trim();
        if (!TIME_RE.test(value)) errors.newValue = "Enter the corrected arrival time (HH:MM).";
        else if (value === previousValue) errors.newValue = `${stop!.name} is already recorded at ${value}.`;
        else {
          // The run's own order has to survive the correction: a stop cannot be earlier than the one
          // before it, nor later than the one after it, or the log stops describing a journey.
          const before = existing.stopLogs[logIndex - 1]?.stopId;
          const after = existing.stopLogs[logIndex + 1]?.stopId;
          const beforeTime = before ? existing.stopLogs.find((log) => log.stopId === before)?.actualTime : undefined;
          const afterTime = after ? existing.stopLogs.find((log) => log.stopId === after)?.actualTime : undefined;
          if (beforeTime && value < beforeTime)
            errors.newValue = `Cannot be earlier than ${route.stops.find((s2) => s2.id === before)?.name ?? "the previous stop"} at ${beforeTime}.`;
          else if (afterTime && value > afterTime)
            errors.newValue = `Cannot be later than ${route.stops.find((s2) => s2.id === after)?.name ?? "the next stop"} at ${afterTime}.`;
          else newStopLogs = existing.stopLogs.map((log, index) => (index === logIndex ? { ...log, actualTime: value } : log));
        }
      }

      if (!Object.keys(errors).length && field === "boarding_outcome") {
        const passengerId = command.input.passengerId ?? "";
        const recordIndex = existing.boardings.findIndex((record) => record.passengerId === passengerId && record.stopId === command.input.stopId);
        if (!passengerId) errors.passengerId = "Choose the rider whose outcome is wrong.";
        else if (recordIndex < 0) errors.passengerId = "That rider has no boarding outcome recorded at this stop.";
        previousValue = recordIndex >= 0 ? existing.boardings[recordIndex].outcome : null;
        const value = command.input.newValue.trim();
        if (recordIndex >= 0) {
          if (value !== "boarded" && value !== "no_show") errors.newValue = "Choose boarded or did not board.";
          else if (value === previousValue) errors.newValue = `That outcome is already recorded as ${previousValue === "boarded" ? "boarded" : "did not board"}.`;
          else newBoardings = existing.boardings.map((record, index) => (index === recordIndex ? { ...record, outcome: value as BoardingOutcome } : record));
        }
      }

      if (Object.keys(errors).length) return fail("That correction cannot be applied. See the highlighted fields.", errors);

      if (field === "stop_time") {
        const ordered = route.stops.map((s2) => newStopLogs.find((log) => log.stopId === s2.id)).filter((log) => log !== undefined);
        for (let index = 1; index < ordered.length; index += 1) {
          if (ordered[index]!.actualTime < ordered[index - 1]!.actualTime)
            return fail("That time would put this stop before the one recorded ahead of it. Correct that stop first.", {
              newValue: "The recorded stops must stay in time order.",
            });
        }
      }

      const correction: TripCorrection = {
        id: makeId(),
        field,
        stopId: command.input.stopId,
        passengerId: field === "boarding_outcome" ? (command.input.passengerId ?? null) : null,
        previousValue,
        newValue: command.input.newValue.trim(),
        reason,
        correctedAt: now,
        correctedBy: actor?.fullName ?? "System",
      };

      const updated: Trip = {
        ...existing,
        stopLogs: newStopLogs,
        boardings: newBoardings,
        corrections: [...existing.corrections, correction],
        updatedAt: now,
      };

      // Nothing else is recomputed: the on-time judgement is derived from the stop log at read time
      // against the threshold snapshotted at completion, so a corrected time flows into the report on
      // its own and the historical threshold is not quietly replaced by today's setting.

      // The audit entry names the stop and the field but never a rider's name (data minimisation).
      const what = field === "stop_time" ? `${stop!.name} arrival time` : `boarding outcome at ${stop!.name}`;
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:correct",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference}: ${what} corrected from ${previousValue ?? "nothing"} to ${correction.newValue}. Reason: ${reason}`,
      }, now);

      // The rider is not named in the message either: the screen already knows which row was opened.
      return {
        ok: true,
        db: next,
        message: `${updated.reference}: ${what} corrected to ${correction.newValue}. ${updated.corrections.length} correction(s) now recorded on this run.`,
      };
    }

    case "record_trip_delay": {
      const denied = authorise(actor, "trips:record");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      // Own-record scope first, as on every other run action: a driver reports the delay on their
      // own run, and cannot learn another run's state by probing its id (D-25).
      if (!mayActOnTrip(db, actor, existing.id)) return fail("You can only report a delay on a run assigned to you.");
      // Out, and only out. A planned run is not late yet, and a finished one is not late *now* —
      // its lateness lives in its stop times, which is what the transport report measures (D-105).
      if (existing.status !== "dispatched" && existing.status !== "in_progress")
        return fail(`A delay can only be reported while a run is out (this trip is ${existing.status}).`);

      // Zero is allowed only once a delay exists: "back on time" answers an earlier report. It is
      // not a way to record a run that was never late.
      const { errors, value, reason } = readDelayInput(command.input, existing.delays.length > 0);
      if (Object.keys(errors).length || value === null)
        return fail("This delay report is incomplete. See the highlighted fields.", errors);

      const delay: TripDelay = {
        id: makeId(),
        at: now,
        minutes: value,
        reason,
        reportedBy: actor?.fullName ?? "System",
      };
      const updated: Trip = { ...existing, delays: [...existing.delays, delay], updatedAt: now };
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:delay",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference}: delay reported — ${delayLine(delay)}`,
      }, now);
      return {
        ok: true,
        db: next,
        message:
          value === 0
            ? `${updated.reference}: recorded as back on time — ${reason}`
            : `${updated.reference}: recorded as ${minutesLabel(value)} late. The dispatch desk, the driver and the client now show it.`,
      };
    }

    case "cancel_trip": {
      const denied = authorise(actor, "trips:cancel");
      if (denied) return denied;
      const existing = db.trips.find((t) => t.id === command.id);
      if (!existing) return fail("Trip not found.");
      if (existing.status !== "planned" && existing.status !== "dispatched" && existing.status !== "in_progress")
        return fail(`A ${existing.status} trip cannot be cancelled.`);
      const reason = command.reason.trim();
      if (!reason) return fail("A reason is required.", { reason: "Give a short reason for cancelling this trip." });

      // A run that has started is stopped by something: a breakdown, a safety event, a driver who
      // cannot continue. Q-47 said operations must be able to record that instead of being stuck with
      // a run it cannot close. Where the cause is already recorded as an incident, the cancellation
      // has to name it, so the two records cannot describe different events (D-75).
      const midRun = existing.status === "in_progress";
      const live = (incident: { status: string; type: string }) =>
        incident.status !== "resolved" && incident.status !== "closed";
      const causes = db.incidents.filter(
        (incident) =>
          live(incident) &&
          (incident.type === "breakdown" || incident.type === "accident" || incident.type === "safety_concern") &&
          (incident.tripId === existing.id || (!!existing.vehicleId && incident.vehicleId === existing.vehicleId)),
      );

      let incidentId: string | null = null;
      if (midRun && command.incidentId) {
        const incident = db.incidents.find((candidate) => candidate.id === command.incidentId);
        if (!incident) return fail("That incident was not found.", { incidentId: "Choose the incident that stopped this run." });
        if (incident.tripId !== existing.id && (!existing.vehicleId || incident.vehicleId !== existing.vehicleId))
          return fail("That incident is not about this run or its vehicle.", { incidentId: "Choose an incident recorded for this run." });
        if (!live(incident)) return fail(`${incident.reference} is ${incident.status}, so it is not what stopped this run.`);
        incidentId = incident.id;
      } else if (midRun && causes.length > 0) {
        // Do not let a run be stopped "for a reason" while an unresolved breakdown sits on the same
        // vehicle unmentioned: that is how two records end up disagreeing about the same morning.
        const first = causes[0];
        return fail(
          `${first.reference} is recorded against this run's vehicle. Link it when cancelling so the two records agree.`,
          { incidentId: `Select ${first.reference}.` },
        );
      }

      const boarded = existing.boardings.filter((record) => record.outcome === "boarded").length;
      const withoutOutcome = midRun ? Math.max(
        db.passengers.filter((p) => p.routeId === existing.routeId && p.status === "active").length - existing.boardings.length,
        0,
      ) : 0;

      const updated: Trip = {
        ...existing,
        status: "cancelled",
        cancelReason: reason,
        cancelledAt: now,
        cancelledBy: actor?.fullName ?? "System",
        incidentId,
        updatedAt: now,
      };
      const incidentRef = incidentId ? db.incidents.find((candidate) => candidate.id === incidentId)?.reference : null;
      const stopped = midRun ? ` Stopped after ${existing.stopLogs.length} stop(s) were recorded.` : "";
      const riders = midRun
        ? ` ${boarded} rider outcome(s) kept; ${withoutOutcome} without an outcome.`
        : "";
      const next = audit({ ...db, trips: db.trips.map((t) => (t.id === updated.id ? updated : t)) }, actor, {
        action: "trips:cancel",
        entity: "trip",
        entityId: updated.id,
        summary: `${updated.reference} cancelled${incidentRef ? ` (${incidentRef})` : ""}.${stopped}${riders} Reason: ${reason}`,
      }, now);
      return {
        ok: true,
        db: next,
        message: `${updated.reference} cancelled${incidentRef ? ` and linked to ${incidentRef}` : ""}.${stopped}${riders}`,
      };
    }
  }
}
