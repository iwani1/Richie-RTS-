// What state a vehicle is in, and why (FLT-02, D-109).
//
// The brief names seven states: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of
// Service, Pending Inspection. Four of them were already records — the office says a vehicle is
// available, in the workshop, off the road or retired, and that stored word is its *condition*.
//
// The other three are not conditions at all: Reserved, Assigned and On Trip are facts about what the
// day's runs and hires are doing with the bus. Storing them would create a second copy of a fact the
// trips already hold, and the two copies would disagree the first time a run was cancelled in a hurry
// — the fault this codebase has refused elsewhere (D-103: a driver's availability is read from the
// runs, never stored). So they are derived, here, from the records that already mean them:
//
//   * a run **dispatched** and not yet started holds a crew and a vehicle → Assigned
//   * a run **in progress** → On Trip
//   * a run **planned** with this vehicle, or a confirmed hire covering the day → Reserved
//
// Precedence, and why it is this order: a vehicle that is retired is not in the fleet, and one the
// office has taken off the road cannot be used, whatever the runs say. Work in the workshop outranks
// work on the road, because a bus with its wheels off cannot be driving. Waiting for a release
// outranks a commitment, because the repair is finished but nobody has signed the bus back. Only then
// does what the day is doing with it decide.
//
// A blocking state does not hide a commitment, it names it: a bus in the workshop that is still on
// today's run sheet is a broken plan, and the register says so in the same sentence rather than
// leaving the dispatcher to find out at the gate.
//
// This module decides what is *true* about a vehicle. It blocks nothing: the rules that stop a
// vehicle being assigned live in `assessResources` (busing.ts) and read the stored condition, which
// is the office's word and the only thing a person can change.
import type { BusRoute, Database, Rental, Trip, Vehicle } from "./types";
import { VEHICLE_STATUS_LABELS } from "./types";

export const FLEET_STATES = [
  "available",
  "reserved",
  "assigned",
  "on_trip",
  "pending_inspection",
  "maintenance",
  "out_of_service",
  "retired",
] as const;
export type FleetState = (typeof FLEET_STATES)[number];

export const FLEET_STATE_LABELS: Record<FleetState, string> = {
  available: "Available",
  reserved: "Reserved",
  assigned: "Assigned",
  on_trip: "On trip",
  pending_inspection: "Pending inspection",
  maintenance: "Under maintenance",
  out_of_service: "Out of service",
  retired: "Retired",
};

/** The workflow order the brief lists, which is also the order a dispatcher reads a screen in. */
export const FLEET_STATE_ORDER: readonly FleetState[] = [
  "available",
  "reserved",
  "assigned",
  "on_trip",
  "pending_inspection",
  "maintenance",
  "out_of_service",
  "retired",
];

/**
 * The rule for each state and what takes a vehicle out of it, in the words the screen prints.
 *
 * Held here rather than only in the documentation because the person reading the register is the
 * person who needs to know why a bus says "Pending inspection" — and a rule that is only in a
 * markdown file is a rule nobody at the desk has read.
 */
export const FLEET_STATE_RULES: readonly { state: FleetState; rule: string; leaves: string }[] = [
  {
    state: "available",
    rule: "Nothing is wrong with it and nothing today is holding it: no run of this day is planned, dispatched or running, and no confirmed hire covers the day.",
    leaves: "The office books it to a run or a hire (Reserved), sends a run out with it (Assigned), or takes it off the road.",
  },
  {
    state: "reserved",
    rule: "It is being held for something that has not happened yet on this day: a run planned with this vehicle, or a confirmed hire whose dates cover the day.",
    leaves: "The run is dispatched (Assigned), or the hire starts (On trip). Cancelling the run or the hire frees it again.",
  },
  {
    state: "assigned",
    rule: "A run has been dispatched with this vehicle and its crew, and has not left yet.",
    leaves: "The crew starts the run (On trip), or the run is cancelled or completed.",
  },
  {
    state: "on_trip",
    rule: "A run on this day is in progress, or a hire with this vehicle has started.",
    leaves: "The run completes or is cancelled; it is the run's own end that frees the vehicle, not a clock.",
  },
  {
    state: "pending_inspection",
    rule: "A work order on this vehicle has reached completed and has not been released back into service by somebody holding maintenance:release.",
    leaves: "The work order is released (closed), which is the act that signs the vehicle back in.",
  },
  {
    state: "maintenance",
    rule: "A work order on this vehicle is open, in progress or on hold, or the office has recorded it as in the workshop with no work order open.",
    leaves: "The work order is finished, or the office sets the vehicle back to Available.",
  },
  {
    state: "out_of_service",
    rule: "The office has taken it off the road — a safety defect from an incident, or a decision recorded with a reason.",
    leaves: "The office sets it back to Available or to Maintenance, with a reason.",
  },
  {
    state: "retired",
    rule: "It has left the fleet: sold, scrapped or written off.",
    leaves: "Nothing. A retired vehicle does not come back.",
  },
];

export interface FleetStateReading {
  state: FleetState;
  label: string;
  /** The run, hire or work order behind the state — "" when nothing is. */
  reference: string;
  /** One sentence for the row: what is true, and which record says so. */
  sentence: string;
  /** The run or hire behind a working state, else "". Used by tests and by the panel. */
  commitment: string;
  /** A commitment this vehicle's blocking state is overriding, else "". */
  conflict: string;
}

const WORKING_TRIP_STATUSES: readonly Trip["status"][] = ["planned", "dispatched", "in_progress"];
const WORKING_RENTAL_STATUSES: readonly Rental["status"][] = ["confirmed", "dispatched"];
const ACTIVE_WORK_ORDER_STATUSES = ["open", "in_progress", "on_hold"] as const;

const routeOf = (db: Database, trip: Trip): BusRoute | undefined => db.routes.find((route) => route.id === trip.routeId);
const routeLabel = (db: Database, trip: Trip): string => {
  const route = routeOf(db, trip);
  return route ? `${trip.reference} (${route.name})` : trip.reference;
};

function hireSpan(rental: Rental): string {
  return rental.startDate === rental.endDate ? rental.startDate : `${rental.startDate} to ${rental.endDate}`;
}

/**
 * What the day is doing with this vehicle, highest level first.
 *
 * A run on the day outranks a hire on the same day because a run carries named passengers and a hire
 * does not; when both exist the register names the run, and the hire is a conflict the dispatcher has
 * to resolve rather than a second sentence in a table cell.
 */
function commitmentOf(db: Database, vehicleId: string, onDate: string): { level: FleetState; text: string; reference: string } | null {
  const trips = db.trips
    .filter(
      (trip) =>
        trip.vehicleId === vehicleId &&
        trip.serviceDate === onDate &&
        WORKING_TRIP_STATUSES.includes(trip.status),
    )
    .sort((a, b) => (a.status === "in_progress" ? -1 : b.status === "in_progress" ? 1 : 0));

  const rental = db.rentals
    .filter(
      (candidate) =>
        candidate.assignedVehicleId === vehicleId &&
        WORKING_RENTAL_STATUSES.includes(candidate.status) &&
        candidate.startDate <= onDate &&
        onDate <= candidate.endDate,
    )
    .sort((a, b) => (a.status === "dispatched" ? -1 : b.status === "dispatched" ? 1 : 0))[0];

  const group: { level: FleetState; text: string; reference: string }[] = trips.map((trip) => {
    if (trip.status === "in_progress")
      return { level: "on_trip" as const, text: `${routeLabel(db, trip)} is under way`, reference: trip.reference };
    if (trip.status === "dispatched") {
      const driver = db.drivers.find((candidate) => candidate.id === trip.driverId);
      return {
        level: "assigned" as const,
        text: driver ? `${routeLabel(db, trip)}, dispatched with ${driver.fullName}` : `${routeLabel(db, trip)}, dispatched`,
        reference: trip.reference,
      };
    }
    return { level: "reserved" as const, text: `${routeLabel(db, trip)} is planned`, reference: trip.reference };
  });

  if (rental) {
    const text = `${rental.reference} (${rental.customerName}, ${hireSpan(rental)})`;
    group.push({
      level: rental.status === "dispatched" ? "on_trip" : rental.startDate < onDate || rental.startDate === onDate ? "assigned" : "reserved",
      text: rental.status === "dispatched" ? `hire ${text} is under way` : rental.startDate === onDate ? `hire ${text} starts today` : `hire ${text}`,
      reference: rental.reference,
    });
  }

  if (group.length === 0) return null;
  const rank: Record<string, number> = { on_trip: 0, assigned: 1, reserved: 2 };
  group.sort((a, b) => rank[a.level] - rank[b.level]);
  return group[0];
}

/**
 * The state of one vehicle on one day.
 *
 * Returns null when the id is not on the register — a caller that has an id from a record has a
 * dangling reference, and inventing "available" for it would be a lie.
 */
export function fleetStateOf(db: Database, vehicleId: string, onDate: string): FleetStateReading | null {
  const vehicle: Vehicle | undefined = db.vehicles.find((candidate) => candidate.id === vehicleId);
  if (!vehicle) return null;
  const commitment = commitmentOf(db, vehicleId, onDate);
  const conflict = commitment ? `It is still committed to ${commitment.text}.` : "";

  const reading = (state: FleetState, sentence: string, reference = ""): FleetStateReading => ({
    state,
    label: FLEET_STATE_LABELS[state],
    reference,
    sentence: conflict && state !== "available" && state !== "reserved" && state !== "assigned" && state !== "on_trip" ? `${sentence} ${conflict}` : sentence,
    commitment: commitment?.text ?? "",
    conflict,
  });

  if (vehicle.status === "retired") return reading("retired", "Retired: it is no longer part of the fleet.");
  if (vehicle.status === "out_of_service")
    return reading("out_of_service", `The office has taken it off the road (${VEHICLE_STATUS_LABELS.out_of_service.toLowerCase()}, recorded on the register).`);

  const orders = db.workOrders.filter((order) => order.vehicleId === vehicleId);
  const active = orders.find((order) => (ACTIVE_WORK_ORDER_STATUSES as readonly string[]).includes(order.status));
  // `closed` is how a release is recorded, so a completed order is waiting. The `releasedAt` check
  // is belt and braces for a row that says both: if somebody has already signed the vehicle back,
  // it is not waiting for a signature, whatever the status column says.
  const finished = orders.find((order) => order.status === "completed" && !order.releasedAt);

  if (active) {
    const workshop = active.workshop ? ` at ${active.workshop}` : "";
    return reading("maintenance", `Work order ${active.reference} is ${active.status.replace("_", " ")}${workshop}.`, active.reference);
  }
  if (finished) {
    // The repair is done; what is missing is a signature. This is the brief's Pending Inspection,
    // and it is deliberately not folded into "Under maintenance": the bus is not being worked on,
    // it is waiting for somebody to say it may carry people again.
    return reading("pending_inspection", `Work order ${finished.reference} is repaired and waiting to be released back into service.`, finished.reference);
  }
  if (vehicle.status === "maintenance")
    return reading("maintenance", "The register says it is in the workshop, and no work order is open.");

  if (commitment) {
    if (commitment.level === "on_trip")
      return reading("on_trip", `${commitment.text.replace(/ is under way$/, "")} — the run has started.`, commitment.reference);
    if (commitment.level === "assigned") return reading("assigned", `${commitment.text}.`, commitment.reference);
    return reading("reserved", `${commitment.text}.`, commitment.reference);
  }

  return reading("available", "Free: no run or hire is holding it, and nothing is wrong with it.");
}

/**
 * The next day this vehicle is already spoken for, from `fromDate` onwards.
 *
 * The per-day state answers "what is it doing today"; this answers the dispatcher's other question,
 * "when do I lose it?". A bus that is free today but booked for Friday is the bus to plan around,
 * and counting it as Reserved today would make almost every vehicle reserved and the word useless.
 */
export function nextCommitmentOf(db: Database, vehicleId: string, fromDate: string): { onDate: string; text: string } | null {
  const days: { onDate: string; text: string }[] = [];

  for (const trip of db.trips) {
    if (trip.vehicleId !== vehicleId) continue;
    if (trip.status !== "planned" && trip.status !== "dispatched") continue;
    if (trip.serviceDate < fromDate) continue;
    days.push({ onDate: trip.serviceDate, text: routeLabel(db, trip) });
  }
  for (const candidate of db.rentals) {
    if (candidate.assignedVehicleId !== vehicleId || candidate.status !== "confirmed") continue;
    if (candidate.endDate < fromDate) continue;
    const onDate = candidate.startDate < fromDate ? fromDate : candidate.startDate;
    days.push({ onDate, text: `${candidate.reference} (${candidate.customerName}, ${hireSpan(candidate)})` });
  }

  if (days.length === 0) return null;
  days.sort((a, b) => a.onDate.localeCompare(b.onDate));
  return days[0];
}

/** The state line for a table cell, or "" when the vehicle is not on the register. */
export function fleetStateLine(db: Database, vehicleId: string, onDate: string): string {
  return fleetStateOf(db, vehicleId, onDate)?.sentence ?? "";
}

export interface FleetStateCounts extends Record<FleetState, number> {
  total: number;
}

/**
 * How many vehicles are in each state on a day.
 *
 * Every vehicle is counted once, including the retired ones: a fleet screen that quietly drops them
 * cannot answer "we had twelve buses in June", which is the question an owner asks when a bus is
 * written off.
 */
export function fleetStateCounts(db: Database, onDate: string): FleetStateCounts {
  const counts = { available: 0, reserved: 0, assigned: 0, on_trip: 0, pending_inspection: 0, maintenance: 0, out_of_service: 0, retired: 0, total: db.vehicles.length } as FleetStateCounts;
  for (const vehicle of db.vehicles) {
    const reading = fleetStateOf(db, vehicle.id, onDate);
    if (reading) counts[reading.state] += 1;
  }
  return counts;
}

/**
 * The vehicles in a state, in registration order — what a dispatcher wants when the number says
 * "2 pending inspection" and they need to know which two.
 */
export function vehiclesInState(db: Database, state: FleetState, onDate: string): Vehicle[] {
  return db.vehicles
    .filter((vehicle) => fleetStateOf(db, vehicle.id, onDate)?.state === state)
    .sort((a, b) => a.registration.localeCompare(b.registration));
}
