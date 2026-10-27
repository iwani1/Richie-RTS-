// The planning aid (RTE-04, D-96).
//
// What this is: a reading of the records that answers one question — "who can take this run, and why
// is that the answer?" — for the runs a dispatcher still has to crew. It ranks the pairs the office
// could actually use and states, in words, what makes each one workable or impossible.
//
// What this is **not**: a solver, and not an autopilot. It assigns nothing. It reads the same rule the
// save reads (`assessResources`), so a suggestion it offers cannot then be refused, and a pair it
// rules out is ruled out by the code that would have refused the save.
//
// It is also honest about its blind spots. The brief (RTE-04) asks a planning aid to weigh pickup
// locations, destinations, travel durations and required arrival times. This build records a stop's
// *name* and its *scheduled time* — there are no coordinates and no travel time anywhere in the data
// (RTE-01 is partial: see `PLANNING_LIMITS`). Rather than invent a distance, the aid says what it
// cannot see and plans on what is on file: capacity, category, availability, the pair's existing
// commitments that day, papers, licence and service intervals.
import { seatsHeld } from "./bookings";
import { isActiveRental } from "./rentalWorkflow";
import { assessResources, rosterCount, toMinutes, tripWindow } from "./busing";
import { overdueServiceFor } from "./maintenance";
import type { BusRoute, Database, Driver, Trip, Vehicle } from "./types";

/** How many candidates the screen shows before it starts summarising. */
export const PLAN_SHORTLIST = 3;

/**
 * What the aid cannot consider, stated on the screen rather than left to be discovered.
 *
 * Each line names a fact the brief expects a planning aid to hold and this build does not. They are
 * limits of the *records*, not of the arithmetic: adding coordinates to a stop would lift the first
 * three, and nothing here pretends a guess is a measurement.
 */
export const PLANNING_LIMITS: readonly string[] = [
  "Stops carry a name and a scheduled time, not a map position, so the aid cannot measure how far apart a pickup and the office are.",
  "No travel time is recorded, so a run's window is its first scheduled stop to its last — the timetable, not the road.",
  "There is no separate \"required arrival time\": the last stop's scheduled time is the arrival the timetable promises.",
  "A driver's hours on duty, traffic and weather are not recorded anywhere, so the aid cannot weigh them.",
];

export interface PlanCandidate {
  vehicleId: string;
  driverId: string;
  /** "GT-4821-24", as the office says it. */
  vehicleLabel: string;
  driverLabel: string;
  vehicleSeats: number;
  /** Seats left once the roster and every booked seat are aboard. Zero means full, not over. */
  spareSeats: number;
  /** True when `assessResources` would accept this pair — the aid never offers what the save refuses. */
  workable: boolean;
  /** Why it works, or why it cannot. Sentences the office can act on. */
  reasons: string[];
  /** True facts that do not stop the assignment but should be read before choosing (overdue service, a licence about to lapse). */
  notes: string[];
  /** How many runs that day already carry this vehicle and this driver, including hires. */
  load: { vehicleRuns: number; driverRuns: number };
}

export interface RunPlan {
  tripId: string;
  reference: string;
  routeName: string;
  serviceDate: string;
  /** "06:00–06:30", the timetable window the vehicle has to be free for. */
  window: string;
  needs: { riders: number; roster: number; booked: number };
  /** The pairs the office could use, best first. Empty when nothing can take the run. */
  workable: PlanCandidate[];
  /** The nearest refusals — one per reason, so the screen can say why nobody is available. */
  refusals: PlanCandidate[];
  /** How many vehicle-and-driver combinations were examined, and how many of those were refused. */
  examined: number;
  refused: number;
  /** One sentence for the desk: who to send, or why there is nobody to send. */
  headline: string;
  /** Set when the run cannot be planned at all (already finished, cancelled, or no route on file). */
  closed: string | null;
}

const LABEL_ORDER = (a: string, b: string) => a.localeCompare(b);

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Runs that day already carrying this vehicle or driver — the load the ranking sorts on. */
function loadThatDay(db: Database, serviceDate: string, vehicleId: string, driverId: string, tripId: string) {
  const trips = db.trips.filter(
    (trip) =>
      trip.id !== tripId &&
      trip.serviceDate === serviceDate &&
      (trip.status === "planned" || trip.status === "dispatched" || trip.status === "in_progress"),
  );
  const hires = db.rentals.filter(
    (rental) =>
      isActiveRental(rental.status) &&
      rental.startDate <= serviceDate &&
      serviceDate <= rental.endDate,
  );
  return {
    vehicleRuns: trips.filter((trip) => trip.vehicleId === vehicleId).length + hires.filter((r) => r.assignedVehicleId === vehicleId).length,
    driverRuns: trips.filter((trip) => trip.driverId === driverId).length + hires.filter((r) => r.assignedDriverId === driverId).length,
  };
}

/**
 * Why a workable pair works, in the order a dispatcher checks it: does everyone fit, is the vehicle
 * free, is the driver legal and free, and what is already in their day.
 */
function workableReasons(candidate: {
  vehicle: Vehicle;
  driver: Driver;
  riders: number;
  spareSeats: number;
  window: string;
  load: { vehicleRuns: number; driverRuns: number };
}): string[] {
  const { vehicle, driver, riders, spareSeats, window, load } = candidate;
  const seats =
    spareSeats === 0
      ? `${vehicle.registration} seats ${vehicle.seatCapacity}, exactly the ${riders} the run must carry — no spare seat.`
      : `${vehicle.registration} seats ${vehicle.seatCapacity} for ${riders}, leaving ${spareSeats} spare.`;

  // The overlap rule already cleared this pair, so the sentence can state it as a fact.
  const free = `Vehicle and driver are both free ${window}: no other run or hire that day overlaps.`;
  const loaded = load.vehicleRuns + load.driverRuns;
  const day =
    loaded === 0
      ? "It is the first thing either of them has on that date."
      : `${vehicle.registration} is already on ${load.vehicleRuns} other run(s) that day and ${driver.fullName} on ${load.driverRuns}.`;

  return [seats, free, day];
}

/** Notes are facts the rules allow but a person should see: a service overdue, a licence about to lapse. */
function notesFor(db: Database, vehicle: Vehicle, driver: Driver, serviceDate: string, today: string): string[] {
  const notes: string[] = [];
  const overdue = overdueServiceFor(db, vehicle.id, today);
  if (overdue) notes.push(overdue);
  const leadDays = db.settings.documentReminderLeadDays;
  if (leadDays !== null && driver.licenceExpiry >= serviceDate) {
    const days = Math.round((Date.parse(`${driver.licenceExpiry}T00:00:00Z`) - Date.parse(`${serviceDate}T00:00:00Z`)) / 86_400_000);
    if (days <= leadDays)
      notes.push(
        days === 0
          ? `This is the last day of ${driver.fullName}'s licence.`
          : `${driver.fullName}'s licence expires in ${days} day(s), inside the ${leadDays}-day reminder window.`,
      );
  }
  return notes;
}

/**
 * The ranking. Deliberately explainable: each key is a sentence the screen could print.
 *
 *   1. pairs the save would accept before pairs it would refuse;
 *   2. fewer notes (an overdue service is not a reason to send the big bus);
 *   3. the smallest vehicle that still fits, so the large buses stay free for the runs that need them;
 *   4. the least loaded driver, then the least loaded vehicle — spreading the day rather than
 *      leaning on whoever was first in the list;
 *   5. registration, then name, so the same records always produce the same order.
 */
function rank(a: PlanCandidate, b: PlanCandidate): number {
  if (a.workable !== b.workable) return a.workable ? -1 : 1;
  if (a.notes.length !== b.notes.length) return a.notes.length - b.notes.length;
  if (a.spareSeats !== b.spareSeats) return a.spareSeats - b.spareSeats;
  if (a.load.driverRuns !== b.load.driverRuns) return a.load.driverRuns - b.load.driverRuns;
  if (a.load.vehicleRuns !== b.load.vehicleRuns) return a.load.vehicleRuns - b.load.vehicleRuns;
  return LABEL_ORDER(a.vehicleLabel, b.vehicleLabel) || LABEL_ORDER(a.driverLabel, b.driverLabel);
}

/** The first refusal of each kind, so the screen can explain a shortage without listing every pair. */
function nearestRefusals(refused: PlanCandidate[]): PlanCandidate[] {
  const seen = new Set<string>();
  const out: PlanCandidate[] = [];
  for (const candidate of refused) {
    const key = candidate.reasons[0] ?? "refused";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length === 4) break;
  }
  return out;
}

function headlineFor(plan: Omit<RunPlan, "headline">): string {
  if (plan.closed) return plan.closed;
  const best = plan.workable[0];
  if (best) return `Send ${best.vehicleLabel} with ${best.driverLabel}: ${best.reasons[0]}`;
  if (plan.examined === 0)
    return "Nothing in the fleet can take this run yet: no vehicle of the route's category and no active driver is on file.";
  const first = plan.refusals[0];
  return first
    ? `No pair can take this run (${plan.refused} of ${plan.examined} checked). Closest: ${first.reasons[0]}`
    : `No pair can take this run (${plan.refused} of ${plan.examined} checked).`;
}

/**
 * One run, ranked.
 *
 * A run that is already on the road or finished is not a planning question, so it comes back closed
 * with the reason rather than an empty list that reads like a shortage.
 */
export function planRun(db: Database, tripId: string, today: string): RunPlan | null {
  const trip = db.trips.find((candidate) => candidate.id === tripId);
  if (!trip) return null;
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);
  return planTrip(db, trip, route, today);
}

function planTrip(db: Database, trip: Trip, route: BusRoute | undefined, today: string): RunPlan {
  const window = route ? tripWindow(route) : [0, 0];
  const roster = route ? rosterCount(db, route.id) : 0;
  const booked = seatsHeld(db, trip.id);
  const riders = roster + booked;

  const base = {
    tripId: trip.id,
    reference: trip.reference,
    routeName: route?.name ?? "Unknown route",
    serviceDate: trip.serviceDate,
    window: `${hhmm(window[0])}–${hhmm(window[1])}`,
    needs: { riders, roster, booked },
  };

  const closed =
    !route
      ? `${trip.reference} has no route on file, so there is nothing to plan against.`
      : trip.status === "in_progress"
        ? `${trip.reference} is already running; who is on it can no longer be planned.`
        : trip.status === "completed"
          ? `${trip.reference} is finished, so there is nothing left to crew.`
          : trip.status === "cancelled"
            ? `${trip.reference} is cancelled, so nobody needs to be sent.`
            : null;

  if (closed) {
    const plan: Omit<RunPlan, "headline"> = { ...base, workable: [], refusals: [], examined: 0, refused: 0, closed };
    return { ...plan, headline: headlineFor(plan) };
  }

  // A retired vehicle is not a candidate at all: it is not in service, and offering it would be a
  // suggestion nobody could act on. Everything else is offered and then judged by the same rule the
  // save uses, so the refusal says *why* rather than the vehicle quietly disappearing from the list.
  const vehicles = db.vehicles.filter((vehicle) => vehicle.categoryId === route!.vehicleCategoryId && vehicle.status !== "retired");
  const drivers = db.drivers.filter((driver) => driver.status === "active");

  const candidates: PlanCandidate[] = [];
  for (const vehicle of vehicles) {
    for (const driver of drivers) {
      const problems = assessResources(db, route!, trip, vehicle.id, driver.id, today);
      const reasons = Object.values(problems).filter((text): text is string => Boolean(text));
      const spareSeats = vehicle.seatCapacity - riders;
      const load = loadThatDay(db, trip.serviceDate, vehicle.id, driver.id, trip.id);
      candidates.push({
        vehicleId: vehicle.id,
        driverId: driver.id,
        vehicleLabel: vehicle.registration,
        driverLabel: driver.fullName,
        vehicleSeats: vehicle.seatCapacity,
        spareSeats,
        workable: reasons.length === 0,
        // A workable pair explains itself; a refused one is explained by the rule that refused it,
        // which also names the vehicle's state when that is the problem.
        reasons: reasons.length
          ? reasons
          : workableReasons({ vehicle, driver, riders, spareSeats, window: `${hhmm(window[0])}–${hhmm(window[1])}`, load }),
        notes: notesFor(db, vehicle, driver, trip.serviceDate, today),
        load,
      });
    }
  }

  candidates.sort(rank);
  const workable = candidates.filter((candidate) => candidate.workable);
  const refused = candidates.filter((candidate) => !candidate.workable);
  const plan: Omit<RunPlan, "headline"> = {
    ...base,
    workable,
    refusals: nearestRefusals(refused),
    examined: candidates.length,
    refused: refused.length,
    closed: null,
  };
  return { ...plan, headline: headlineFor(plan) };
}

/**
 * A day's worth: every run that still needs a crew, each with its own ranking.
 *
 * Only runs that are still to be crewed are returned — a finished or cancelled run is not a planning
 * question, and a run that already has both people is not one either. The desk reads this list as
 * "what still needs my attention", so an empty list is meaningful.
 */
export function planDay(db: Database, serviceDate: string, today: string): RunPlan[] {
  return db.trips
    .filter((trip) => trip.serviceDate === serviceDate && trip.status === "planned" && (!trip.vehicleId || !trip.driverId))
    .sort((a, b) => {
      const routeA = db.routes.find((route) => route.id === a.routeId);
      const routeB = db.routes.find((route) => route.id === b.routeId);
      const startA = routeA ? toMinutes(routeA.stops[0].scheduledTime) : Number.MAX_SAFE_INTEGER;
      const startB = routeB ? toMinutes(routeB.stops[0].scheduledTime) : Number.MAX_SAFE_INTEGER;
      return startA - startB || a.reference.localeCompare(b.reference);
    })
    .map((trip) => planTrip(db, trip, db.routes.find((route) => route.id === trip.routeId), today));
}
