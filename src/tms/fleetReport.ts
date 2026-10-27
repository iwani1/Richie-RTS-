// What the fleet actually did (FLT-05, D-112).
//
// Three questions an owner asks, and why each is answered from records rather than from a stored
// figure:
//
//   * **How many buses do we have, and where are they today?** `fleetStateCounts` already answers
//     this and is reused here unchanged, so the dashboard and the register cannot disagree.
//   * **How much of the fleet was working over a period?** In **vehicle-days**: one vehicle on one
//     calendar day. The headline figure is the definition the owner approved in Q-29 (D-78) and the
//     one `docs/KPIS.md` prints — committed vehicle-days over available vehicle-days — so the
//     dashboard and the document cannot quote different numbers. A stricter second figure, days
//     actually worked, sits beside it, because a day that was sold and never ran is not a day the
//     bus earned anything. Neither is hours: nothing in the program records an hour of a vehicle's
//     time, and a figure built on a guess about hours would be the one number on the screen nobody
//     could check.
//   * **What did standing still cost?** Idle days × the company's own daily standing cost. That
//     figure is a business fact, so it is a setting with no default; until it is set the dashboard
//     counts the days and says plainly that it has no money to put on them.
//
// Every vehicle-day falls in exactly one of four buckets, in this order, and the order is the point:
//
//   worked   — a run that started or finished on the day, or a hire that was under way or finished
//              covering it. Real work outranks everything: a bus that carried passengers and went
//              into the workshop the same afternoon worked that day.
//   workshop — a work order was open against it (created, not yet released). "Under maintenance" and
//              "pending inspection" are both downtime: the repair being finished is not the same as
//              somebody signing the bus back into service.
//   booked   — a planned or dispatched run, or a confirmed hire, that never actually ran. Counted
//              separately from idle, because a day that was sold and lost is a different problem.
//   idle     — everything else.
//
// `committed` is worked + booked: every day a run or hire held the vehicle. That is the numerator of
// the approved utilisation, so the two figures on the screen are the same arithmetic said twice.
//
// A retired vehicle is left out of every day of the period, because the program does not record the
// date it left the fleet — and saying so is better than pretending it worked until an arbitrary
// date. `coverage` carries that and the other gaps.
import { toCsv } from "./csv";
import { fromMinor, toMinor } from "./money";
import { daysInRange } from "./rentalReport";
import { fleetStateCounts, type FleetStateCounts } from "./fleetState";
import type { Database, Rental, Trip, Vehicle, WorkOrder } from "./types";

export type FleetDayBucket = "worked" | "booked" | "workshop" | "idle";

export interface VehicleUsage {
  vehicleId: string;
  registration: string;
  categoryName: string;
  /** Days of the period the vehicle was on the register. */
  inFleetDays: number;
  /** Worked or booked: every day a run or hire held it. */
  committedDays: number;
  workedDays: number;
  bookedDays: number;
  workshopDays: number;
  idleDays: number;
  /** The last day it worked, on or before the period end. Null when it never has. */
  lastWorkedOn: string | null;
}

export interface FleetReport {
  from: string;
  to: string;
  /** Calendar days in the range, inclusive. */
  dayCount: number;
  /** True when the range was longer than the two years this function will walk. */
  truncated: boolean;
  totals: { vehicles: number; inService: number; retired: number };
  /** Today, from the one function the register uses. */
  today: FleetStateCounts;
  /** Buses a run or hire is holding today (assigned or on trip). */
  workingToday: number;
  availableToday: number;
  /** Committed vehicle-days: the numerator of the approved utilisation (Q-29, D-78). */
  committedVehicleDays: number;
  /** Vehicles in service × days in the period: the approved denominator. */
  availableVehicleDays: number;
  /** Committed ÷ available, 0–1. Null when there are no available vehicle-days. */
  utilisation: number | null;
  vehicleDays: { inFleet: number; worked: number; booked: number; workshop: number; idle: number };
  /** Worked ÷ (in fleet − workshop), 0–1. The stricter measure, not the approved KPI. */
  workedShare: number | null;
  idleCost: {
    /** The company's own figure, from settings. Null until somebody states it. */
    perDay: number | null;
    currencyCode: string | null;
    idleDays: number;
    /** idle days × per day. Null when there is no figure to multiply by. */
    total: number | null;
  };
  byVehicle: VehicleUsage[];
  coverage: {
    /** Retired vehicles, left out of every day because the day they left is not recorded. */
    retiredExcluded: number;
    /** Vehicles the register says are in the workshop, with no work order to date the days by. */
    workshopWithoutRecord: number;
    /** Vehicles taken off the road by hand: counted today, undatable in the past. */
    undatedOutOfService: number;
    /** Vehicles in the fleet that did not work a single day of the period. */
    vehiclesWithNoWork: number;
    /** Days where a run was planned or dispatched and never started (they are `booked` above). */
    bookedNotWorked: number;
  };
  status: "ok" | "empty";
  message: string;
}

const ymd = (iso: string) => iso.slice(0, 10);
const MAX_DAYS = 366 * 2;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Does this hire cover the day? A one-day hire covers its start date and nothing else. */
function coversDay(rental: Rental, day: string): boolean {
  return rental.startDate <= day && day <= rental.endDate;
}

const WORKED_TRIP = (trip: Trip) => trip.status === "in_progress" || trip.status === "completed";
const BOOKED_TRIP = (trip: Trip) => trip.status === "planned" || trip.status === "dispatched";
const HELD_TRIP = (trip: Trip) => WORKED_TRIP(trip) || BOOKED_TRIP(trip);
// A hire that has left the yard is `dispatched` (D-120); "worked" is the same idea the trips use.
const WORKED_RENTAL = (rental: Rental) => rental.status === "dispatched" || rental.status === "completed";
const BOOKED_RENTAL = (rental: Rental) => rental.status === "confirmed";
const HELD_RENTAL = (rental: Rental) => WORKED_RENTAL(rental) || BOOKED_RENTAL(rental);

/**
 * The days a work order keeps a vehicle out of service: the day it was raised to the day it was
 * released. An order completed but not released still holds the bus — that is the brief's "pending
 * inspection" — so an unreleased order runs to the end of the period.
 */
function downtimeSpans(db: Database): Map<string, { from: string; to: string | null }[]> {
  const spans = new Map<string, { from: string; to: string | null }[]>();
  for (const order of db.workOrders as WorkOrder[]) {
    const from = ymd(order.createdAt);
    const to = order.releasedAt ? ymd(order.releasedAt) : null;
    const list = spans.get(order.vehicleId) ?? [];
    list.push({ from, to });
    spans.set(order.vehicleId, list);
  }
  return spans;
}

const inSpan = (spans: { from: string; to: string | null }[] | undefined, day: string) =>
  (spans ?? []).some((span) => span.from <= day && (span.to === null || day < span.to));

/**
 * The fleet report for a period.
 *
 * A range longer than two years is walked for its first two years only, and `truncated` says so:
 * silently reporting a different period from the one somebody typed is the kind of quiet lie the
 * rest of this codebase refuses.
 */
export function fleetReport(db: Database, from: string, to: string): FleetReport {
  const allDays = daysInRange(from, to);
  const days = allDays.slice(0, MAX_DAYS);
  const spans = downtimeSpans(db);

  // Indexed once, so a long period does not rescan every record for every day of every vehicle.
  const worked = new Map<string, Set<string>>();
  const booked = new Map<string, Set<string>>();
  const committed = new Map<string, Set<string>>();
  const mark = (map: Map<string, Set<string>>, vehicleId: string, day: string) => {
    const set = map.get(vehicleId) ?? new Set<string>();
    set.add(day);
    map.set(vehicleId, set);
  };

  for (const trip of db.trips) {
    if (!trip.vehicleId) continue;
    if (WORKED_TRIP(trip)) mark(worked, trip.vehicleId, trip.serviceDate);
    else if (BOOKED_TRIP(trip)) mark(booked, trip.vehicleId, trip.serviceDate);
    if (HELD_TRIP(trip)) mark(committed, trip.vehicleId, trip.serviceDate);
  }
  for (const rental of db.rentals) {
    if (!rental.assignedVehicleId) continue;
    if (!HELD_RENTAL(rental)) continue;
    for (const day of days) {
      if (!coversDay(rental, day)) continue;
      // A hire that ran was work even if nobody marked it started — its dates are the record of it
      // being out. A confirmed hire that never started is a booked day.
      mark(WORKED_RENTAL(rental) ? worked : booked, rental.assignedVehicleId, day);
      mark(committed, rental.assignedVehicleId, day);
    }
  }

  const byVehicle: VehicleUsage[] = [];
  const vehicleDays = { inFleet: 0, worked: 0, booked: 0, workshop: 0, idle: 0 };
  let bookedNotWorked = 0;
  let committedVehicleDays = 0;

  for (const vehicle of db.vehicles as Vehicle[]) {
    if (vehicle.status === "retired") continue;
    const registeredOn = ymd(vehicle.createdAt);
    const category = db.settings.vehicleCategories.find((candidate) => candidate.id === vehicle.categoryId);
    const usage: VehicleUsage = {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      categoryName: category?.name ?? "Unknown",
      inFleetDays: 0,
      committedDays: 0,
      workedDays: 0,
      bookedDays: 0,
      workshopDays: 0,
      idleDays: 0,
      lastWorkedOn: null,
    };

    for (const day of days) {
      if (day < registeredOn) continue;
      usage.inFleetDays += 1;
      vehicleDays.inFleet += 1;
      const held = committed.get(vehicle.id)?.has(day) ?? false;
      if (held) {
        usage.committedDays += 1;
        committedVehicleDays += 1;
      }
      const bucket: FleetDayBucket = (worked.get(vehicle.id)?.has(day) ?? false)
        ? "worked"
        : inSpan(spans.get(vehicle.id), day)
          ? "workshop"
          : (booked.get(vehicle.id)?.has(day) ?? false)
            ? "booked"
            : "idle";
      if (bucket === "worked") usage.workedDays += 1;
      else if (bucket === "workshop") usage.workshopDays += 1;
      else if (bucket === "booked") usage.bookedDays += 1;
      else usage.idleDays += 1;
      if (bucket === "booked") bookedNotWorked += 1;
      if (bucket === "worked") usage.lastWorkedOn = day;
    }

    if (usage.lastWorkedOn === null) {
      // No worked day in the period: look for the last day it worked before it, so the row can say
      // "last worked 3 March" instead of repeating that it did nothing.
      usage.lastWorkedOn = lastWorkedBefore(db, vehicle.id, from);
    }

    vehicleDays.worked += usage.workedDays;
    vehicleDays.booked += usage.bookedDays;
    vehicleDays.workshop += usage.workshopDays;
    vehicleDays.idle += usage.idleDays;
    byVehicle.push(usage);
  }

  byVehicle.sort((a, b) =>
    b.idleDays === a.idleDays ? a.registration.localeCompare(b.registration) : b.idleDays - a.idleDays,
  );

  const today = fleetStateCounts(db, todayYmd());
  const inService = (db.vehicles as Vehicle[]).filter((vehicle) => vehicle.status !== "retired").length;
  // The approved denominator (Q-29, D-78): the fleet in service × the days in the period. It is not
  // prorated for a vehicle registered halfway through, which is why it can exceed `vehicleDays.inFleet`
  // — the two are defined differently and the screen says so.
  const availableVehicleDays = inService * days.length;
  const serviceableDays = vehicleDays.inFleet - vehicleDays.workshop;
  const perDay = db.settings.fleetStandingCostPerDay;
  const currencyCode = db.settings.currencyCode;

  const report: FleetReport = {
    from,
    to,
    dayCount: days.length,
    truncated: allDays.length > MAX_DAYS,
    totals: { vehicles: db.vehicles.length, inService, retired: db.vehicles.length - inService },
    today,
    workingToday: today.assigned + today.on_trip,
    availableToday: today.available,
    committedVehicleDays,
    availableVehicleDays,
    utilisation: availableVehicleDays > 0 ? committedVehicleDays / availableVehicleDays : null,
    vehicleDays,
    workedShare: serviceableDays > 0 ? vehicleDays.worked / serviceableDays : null,
    idleCost: {
      perDay,
      currencyCode,
      idleDays: vehicleDays.idle,
      // In whole pesewas, converted back once: 37 idle days at 450.05 must not become 16651.849999.
      total: perDay === null ? null : fromMinor(toMinor(perDay) * vehicleDays.idle),
    },
    byVehicle,
    coverage: {
      retiredExcluded: (db.vehicles as Vehicle[]).filter((vehicle) => vehicle.status === "retired").length,
      workshopWithoutRecord: (db.vehicles as Vehicle[]).filter(
        (vehicle) => vehicle.status === "maintenance" && !(spans.get(vehicle.id) ?? []).length,
      ).length,
      undatedOutOfService: (db.vehicles as Vehicle[]).filter((vehicle) => vehicle.status === "out_of_service").length,
      vehiclesWithNoWork: byVehicle.filter((usage) => usage.workedDays === 0).length,
      bookedNotWorked,
    },
    status: db.vehicles.length === 0 ? "empty" : "ok",
    message: "",
  };
  report.message = describe(report);
  return report;
}

/** Today's date as `YYYY-MM-DD`, the same string the screens use in their date boxes. */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The last day this vehicle worked before a date, or null.
 *
 * Bounded by the records that exist; a hire is not enumerated here, only runs, because a hire's
 * "last day worked" is its end date and the caller already has that on the hire screen.
 */
function lastWorkedBefore(db: Database, vehicleId: string, before: string): string | null {
  let latest: string | null = null;
  for (const trip of db.trips) {
    if (trip.vehicleId !== vehicleId || !WORKED_TRIP(trip)) continue;
    if (trip.serviceDate >= before) continue;
    if (latest === null || trip.serviceDate > latest) latest = trip.serviceDate;
  }
  return latest;
}

const share = (value: number | null) => (value === null ? null : Math.round(value * 100));

/** The sentence under the figures, in plain words, including what the records cannot say. */
function describe(report: FleetReport): string {
  if (report.status === "empty") return "No vehicles are on the register, so there is nothing to measure.";
  const parts: string[] = [];
  const committed = share(report.utilisation);
  parts.push(
    committed === null
      ? "No vehicle was in service on any day of this period, so utilisation cannot be stated."
      : `${committed}% of the available vehicle-days were committed to work: ${report.committedVehicleDays} of ${report.availableVehicleDays}.`,
  );
  const worked = share(report.workedShare);
  parts.push(
    worked === null
      ? "Nothing was serviceable, so the days actually worked cannot be stated."
      : `Of those, ${report.vehicleDays.worked} vehicle-day(s) were actually worked — ${worked}% of the ${report.vehicleDays.inFleet - report.vehicleDays.workshop} serviceable day(s).`,
  );
  if (report.vehicleDays.booked > 0)
    parts.push(
      `${report.vehicleDays.booked} day(s) were booked and never ran — a run that was planned or dispatched and not started, or a hire that was confirmed and not marked under way.`,
    );
  if (report.vehicleDays.workshop > 0)
    parts.push(`${report.vehicleDays.workshop} day(s) were in the workshop: downtime, counted apart from idle.`);
  parts.push(
    report.idleCost.total === null
      ? `${report.vehicleDays.idle} idle day(s) have no money on them: what a standing vehicle costs per day is a figure only the company can supply, and it is not set in Settings.`
      : `${report.vehicleDays.idle} idle day(s) at the standing cost set in Settings come to ${report.idleCost.currencyCode ?? ""} ${report.idleCost.total.toFixed(2)}.`,
  );
  if (report.truncated) parts.push("The period was longer than two years; these figures cover its first two.");
  if (report.coverage.retiredExcluded > 0)
    parts.push(`${report.coverage.retiredExcluded} retired vehicle(s) are left out of every day, because the program does not record the day they left.`);
  if (report.coverage.workshopWithoutRecord > 0)
    parts.push(
      `${report.coverage.workshopWithoutRecord} vehicle(s) the register calls "in the workshop" have no work order, so their days cannot be dated and are counted as idle here.`,
    );
  return parts.join(" ");
}

/** The buckets, in the order a reader takes them in, with the words the screen prints. */
export const FLEET_BUCKETS: readonly { key: FleetDayBucket; label: string; note: string }[] = [
  { key: "worked", label: "Worked", note: "A run that started or finished, or a hire that was under way." },
  { key: "booked", label: "Booked, never ran", note: "A run planned or dispatched, or a hire confirmed, with no start recorded." },
  { key: "workshop", label: "In the workshop", note: "A work order raised and not yet released. Downtime, not idle." },
  { key: "idle", label: "Idle", note: "Registered, out of the workshop, and holding nothing." },
];

/** A day bucket for a vehicle, used by the tests and by a per-vehicle panel. */
export function fleetDayBucket(db: Database, vehicle: Vehicle, day: string): FleetDayBucket {
  const worked =
    db.trips.some((trip) => trip.vehicleId === vehicle.id && trip.serviceDate === day && WORKED_TRIP(trip)) ||
    db.rentals.some(
      (rental) => rental.assignedVehicleId === vehicle.id && coversDay(rental, day) && WORKED_RENTAL(rental),
    );
  if (worked) return "worked";
  if (inSpan(downtimeSpans(db).get(vehicle.id), day)) return "workshop";
  const booked =
    db.trips.some((trip) => trip.vehicleId === vehicle.id && trip.serviceDate === day && BOOKED_TRIP(trip)) ||
    db.rentals.some(
      (rental) => rental.assignedVehicleId === vehicle.id && coversDay(rental, day) && BOOKED_RENTAL(rental),
    );
  return booked ? "booked" : "idle";
}

/** The period a reader most often wants: the first of this month to today. */
export function currentMonthToDate(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** A range of days a reader can compare against: the previous period of the same length. */
export function previousPeriod(from: string, to: string): { from: string; to: string } | null {
  const length = daysInRange(from, to).length;
  if (length === 0) return null;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/**
 * The dashboard as CSV, for the owner who checks figures in a spreadsheet.
 *
 * The figures come first, then one row per vehicle, so the file opens as a small report rather than a
 * bare list. Every value is the report's own number, formatted here and never re-added.
 */
export function fleetReportCsv(report: FleetReport): string {
  const percentText = (value: number | null) => (value === null ? "not available" : `${(value * 100).toFixed(1)}%`);
  const money = (value: number) => (report.idleCost.currencyCode ? `${report.idleCost.currencyCode} ${value.toFixed(2)}` : "currency not set");
  const serviceable = report.vehicleDays.inFleet - report.vehicleDays.workshop;
  const rows: (string | number)[][] = [
    ["Metric", "Value", "Note"],
    ["Period from", report.from, ""],
    ["Period to", report.to, ""],
    ["Days in the period", report.dayCount, report.truncated ? "the range was longer than two years and was cut short" : ""],
    ["Vehicles on the register", report.totals.vehicles, `${report.totals.inService} in service, ${report.totals.retired} retired`],
    ["Available today", report.availableToday, "nothing wrong with it and nothing holding it"],
    ["Working today", report.workingToday, "assigned to a run, or on one"],
    ["Committed vehicle-days", report.committedVehicleDays, "a run or hire held the vehicle that day"],
    ["Available vehicle-days", report.availableVehicleDays, "fleet in service × days in the period"],
    ["Utilisation", percentText(report.utilisation), "committed / available (Q-29, D-78)"],
    ["Worked vehicle-days", report.vehicleDays.worked, "a run started or finished, or a hire was under way"],
    ["Days worked", percentText(report.workedShare), `worked / ${serviceable} serviceable vehicle-days`],
    ["Booked, never ran", report.vehicleDays.booked, "a run planned or dispatched, or a hire confirmed, with no start"],
    ["Workshop vehicle-days", report.vehicleDays.workshop, "downtime, dated from the work orders"],
    ["Idle vehicle-days", report.vehicleDays.idle, "in the fleet, out of the workshop, holding nothing"],
    ["Standing cost per vehicle-day", report.idleCost.perDay === null ? "not set" : money(report.idleCost.perDay), "set in Settings → Fleet"],
    ["Cost of idle days", report.idleCost.total === null ? "not priced" : money(report.idleCost.total), "idle days × the standing cost"],
    [],
    ["Vehicle", "Category", "Days in fleet", "Committed", "Worked", "Booked", "Workshop", "Idle", "Last worked"],
    ...report.byVehicle.map((row) => [
      row.registration,
      row.categoryName,
      row.inFleetDays,
      row.committedDays,
      row.workedDays,
      row.bookedDays,
      row.workshopDays,
      row.idleDays,
      row.lastWorkedOn ?? "not in this period",
    ]),
  ];
  return toCsv(rows);
}
