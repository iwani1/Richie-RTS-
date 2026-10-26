// Staff-transport reporting (brief RPT-02).
//
// Dispatch already carried an on-time figure (`kpis.ts`). What it did not carry was the plain count of
// what the buses actually did: how many runs were scheduled, how many were worked, how many riders were
// carried, how many did not appear, which routes are full and which are carrying air, and what happened
// to the seats people asked for. Those are the numbers a client asks about at a quarterly review, and
// until now they had to be counted by hand off the run sheet.
//
// The definitions matter more than the arithmetic, so they are written here and repeated in
// `docs/KPIS.md`:
//
//   * **everything is counted by service date** — the day the run was worked — not by the day the row
//     was typed. A booking made on Friday for Monday's run belongs to Monday;
//   * **riders carried** means a boarding outcome of `boarded` recorded on a completed run. Not the
//     roster size, not the seats sold. A person who did not appear was not carried;
//   * **expected riders** is the manifest — the active roster plus every seat that still holds one —
//     so "not recorded" is the data gap where a run was completed with nobody saying what happened to
//     somebody on it;
//   * **seats offered** is the vehicle's seat capacity on runs that were worked with a vehicle, so
//     occupancy is riders carried ÷ seats offered and not a guess about a bus that was never assigned;
//   * **average delay** is measured only on stops that were actually recorded, and early arrivals are
//     not allowed to cancel a late one: minutes late are averaged over late stops, with the count of
//     late stops beside it.
//
// What it deliberately does not claim: fuel cost and mileage per route (an expense carries no run and an
// odometer reading carries no route), downtime (nothing records a vehicle being unavailable for a
// period), and contract performance (a run does not record which agreement it was worked under). Those
// are named in `STAFF_REPORT_LIMITS` rather than approximated.
import { manifestFor } from "./bookings";
import { toMinutes } from "./busing";
import { onTimeReport } from "./kpis";
import type { BookingStatus, Database, Trip } from "./types";

export interface StaffRouteRow {
  routeId: string;
  reference: string;
  name: string;
  clientName: string;
  /** Runs on the route with a service date in the period, cancelled ones excluded. */
  runsScheduled: number;
  runsCompleted: number;
  runsCancelled: number;
  /** Expected riders across the completed runs: the manifest (roster plus held seats). */
  expected: number;
  carried: number;
  noShows: number;
  notRecorded: number;
  seatsOffered: number;
  /** Carried ÷ seats offered, 0–1. Null when no run on the route had a vehicle. */
  occupancy: number | null;
}

export interface StaffClientRow {
  clientId: string;
  clientName: string;
  routes: number;
  carried: number;
  noShows: number;
  /** Seats held by bookings (as opposed to the standing roster) for runs in the period. */
  bookedSeats: number;
}

export interface SeatReason {
  reason: string;
  count: number;
}

export interface StaffReport {
  from: string;
  to: string;
  runsScheduled: number;
  runsCompleted: number;
  runsCancelled: number;
  /** Runs created outside the schedule (a breakdown replacement, a one-off movement). */
  runsAdhoc: number;
  /** Manifest size across completed runs. */
  expected: number;
  carried: number;
  noShows: number;
  /** Expected riders on completed runs with no boarding outcome recorded for them. */
  notRecorded: number;
  /** Carried ÷ (carried + no-shows): of the riders somebody made a decision about, how many travelled. */
  boardingRate: number | null;
  noShowRate: number | null;
  seatsOffered: number;
  occupancy: number | null;
  /** Stops recorded late, and the mean minutes late over them. Null when nothing was late. */
  lateStops: number;
  averageDelayMinutes: number | null;
  /** On-time runs, from the existing rule (`kpis.ts`), for the same period. */
  onTimeRate: number | null;
  onTimeTimed: number;
  bookings: Record<BookingStatus, number> & { total: number };
  /** Why seats were refused or given up, with the recorded reason. */
  seatReasons: SeatReason[];
  /** Seats asked for on runs in the period that never held one: refused, cancelled or still waiting. */
  seatsNotHeld: number;
  routes: StaffRouteRow[];
  clients: StaffClientRow[];
  coverage: {
    runsWithoutVehicle: number;
    completedRunsWithoutBoardings: number;
    stopsRecorded: number;
    stopsExpected: number;
    runsFromRosterWithoutStop: number;
  };
  status: "ok" | "empty" | "invalid_range";
  message: string;
}

/** What this report cannot say, printed beside it. Each line names the record that is missing. */
export const STAFF_REPORT_LIMITS: readonly string[] = [
  "Fuel and mileage are not per route: an expense records no run, and an odometer reading records no route. Both are counted in the money report instead.",
  "Downtime is not measured: nothing records a vehicle being unavailable for a period, only that it is under maintenance or out of service now.",
  "Contract performance is not measured: a run does not record which agreement it was worked under.",
  "A delay is only known where a stop time was recorded. An unrecorded stop is counted as missing, never as on time.",
];

/** Minutes late at each recorded stop. Early arrivals contribute nothing: they are not a delay. */
function lateMinutes(db: Database, trip: Trip): number[] {
  const route = db.routes.find((candidate) => candidate.id === trip.routeId);
  if (!route) return [];
  return trip.stopLogs.flatMap((log) => {
    const stop = route.stops.find((candidate) => candidate.id === log.stopId);
    if (!stop) return [];
    const late = toMinutes(log.actualTime) - toMinutes(stop.scheduledTime);
    return late > 0 ? [late] : [];
  });
}

/** The seat a booking holds, for the purpose of counting what was asked for and not kept. */
const SEAT_HELD: BookingStatus[] = ["confirmed", "offered"];

/**
 * The staff-transport report for a period of service dates.
 *
 * A period the wrong way round returns `invalid_range` with every figure at zero rather than quietly
 * reporting a backwards slice of time. A period with no runs returns `empty`, because "no bus ran" and
 * "every bus ran with nobody on it" are different statements and only one of them is true here.
 */
export function staffReport(db: Database, from: string, to: string): StaffReport {
  const empty: StaffReport = {
    from,
    to,
    runsScheduled: 0,
    runsCompleted: 0,
    runsCancelled: 0,
    runsAdhoc: 0,
    expected: 0,
    carried: 0,
    noShows: 0,
    notRecorded: 0,
    boardingRate: null,
    noShowRate: null,
    seatsOffered: 0,
    occupancy: null,
    lateStops: 0,
    averageDelayMinutes: null,
    onTimeRate: null,
    onTimeTimed: 0,
    bookings: { requested: 0, confirmed: 0, waitlisted: 0, offered: 0, rejected: 0, cancelled: 0, total: 0 },
    seatReasons: [],
    seatsNotHeld: 0,
    routes: [],
    clients: [],
    coverage: { runsWithoutVehicle: 0, completedRunsWithoutBoardings: 0, stopsRecorded: 0, stopsExpected: 0, runsFromRosterWithoutStop: 0 },
    status: "empty",
    message: "No run has a service date in this period.",
  };

  if (from > to)
    return {
      ...empty,
      status: "invalid_range",
      message: "The reporting period is invalid: the start date is after the end date.",
    };

  const trips = db.trips.filter((trip) => trip.serviceDate >= from && trip.serviceDate <= to);
  if (trips.length === 0) return empty;

  const completed = trips.filter((trip) => trip.status === "completed");
  const cancelledTrips = trips.filter((trip) => trip.status === "cancelled");

  let expected = 0;
  let carried = 0;
  let noShows = 0;
  let notRecorded = 0;
  let seatsOffered = 0;
  let runsWithoutVehicle = 0;
  let completedRunsWithoutBoardings = 0;
  let stopsRecorded = 0;
  let stopsExpected = 0;
  let runsFromRosterWithoutStop = 0;
  const late: number[] = [];

  const perRoute = new Map<string, StaffRouteRow>();

  for (const trip of completed) {
    const route = db.routes.find((candidate) => candidate.id === trip.routeId);
    const manifest = manifestFor(db, trip);
    const boardings = trip.boardings;
    const boarded = boardings.filter((boarding) => boarding.outcome === "boarded").length;
    const missed = boardings.filter((boarding) => boarding.outcome === "no_show").length;
    const unrecorded = manifest.filter(
      (rider) => !boardings.some((boarding) => boarding.passengerId === rider.passenger.id),
    ).length;
    const vehicle = trip.vehicleId ? db.vehicles.find((candidate) => candidate.id === trip.vehicleId) : null;
    const seats = vehicle?.seatCapacity ?? 0;

    expected += manifest.length;
    carried += boarded;
    noShows += missed;
    notRecorded += unrecorded;
    seatsOffered += seats;
    if (!vehicle) runsWithoutVehicle += 1;
    if (boardings.length === 0) completedRunsWithoutBoardings += 1;
    runsFromRosterWithoutStop += manifest.filter((rider) => rider.source === "roster" && !rider.passenger.stopId).length;
    stopsRecorded += trip.stopLogs.length;
    late.push(...lateMinutes(db, trip));

    if (route) {
      const row =
        perRoute.get(route.id) ??
        {
          routeId: route.id,
          reference: route.reference,
          name: route.name,
          clientName: db.clients.find((client) => client.id === route.clientId)?.name ?? "No client named",
          runsScheduled: 0,
          runsCompleted: 0,
          runsCancelled: 0,
          expected: 0,
          carried: 0,
          noShows: 0,
          notRecorded: 0,
          seatsOffered: 0,
          occupancy: null,
        };
      row.runsCompleted += 1;
      row.expected += manifest.length;
      row.carried += boarded;
      row.noShows += missed;
      row.notRecorded += unrecorded;
      row.seatsOffered += seats;
      perRoute.set(route.id, row);
    }
  }

  // Every route with a run in the period appears, including one whose runs were all cancelled: that is
  // the thing worth seeing, and a route that vanishes reads as "never existed" rather than "did not run".
  for (const trip of trips) {
    const route = db.routes.find((candidate) => candidate.id === trip.routeId);
    if (!route) continue;
    const row = perRoute.get(route.id) ?? {
      routeId: route.id,
      reference: route.reference,
      name: route.name,
      clientName: db.clients.find((client) => client.id === route.clientId)?.name ?? "No client named",
      runsScheduled: 0,
      runsCompleted: 0,
      runsCancelled: 0,
      expected: 0,
      carried: 0,
      noShows: 0,
      notRecorded: 0,
      seatsOffered: 0,
      occupancy: null,
    };
    if (trip.status === "cancelled") row.runsCancelled += 1;
    else row.runsScheduled += 1;
    perRoute.set(route.id, row);
  }

  const routes = [...perRoute.values()]
    .map((row) => ({ ...row, occupancy: row.seatsOffered > 0 ? row.carried / row.seatsOffered : null }))
    .sort((a, b) => b.carried - a.carried || a.reference.localeCompare(b.reference));

  // Seats asked for on runs in the period, by their status now. This is the whole history of the
  // question "did I get a seat?", which is what a client asks.
  const bookingsInPeriod = db.bookings.filter((booking) => booking.serviceDate >= from && booking.serviceDate <= to);
  const bookings = {
    requested: 0,
    confirmed: 0,
    waitlisted: 0,
    offered: 0,
    rejected: 0,
    cancelled: 0,
    total: bookingsInPeriod.length,
  } as StaffReport["bookings"];
  for (const booking of bookingsInPeriod) bookings[booking.status] += 1;

  const reasons = new Map<string, number>();
  for (const booking of bookingsInPeriod) {
    if (booking.status !== "rejected" && booking.status !== "cancelled") continue;
    const reason = booking.note.trim() || "No reason recorded";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const seatReasons: SeatReason[] = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const seatsNotHeld = bookingsInPeriod.filter((booking) => !SEAT_HELD.includes(booking.status)).length;

  // Per client: what the client's routes carried, and how many of the seats were sold rather than
  // standing roster. A client asking "how many of my people did you move?" is answered here.
  const perClient = new Map<string, StaffClientRow>();
  for (const row of routes) {
    const route = db.routes.find((candidate) => candidate.id === row.routeId);
    if (!route) continue;
    const entry =
      perClient.get(route.clientId) ??
      {
        clientId: route.clientId,
        clientName: row.clientName,
        routes: 0,
        carried: 0,
        noShows: 0,
        bookedSeats: 0,
      };
    entry.routes += 1;
    entry.carried += row.carried;
    entry.noShows += row.noShows;
    perClient.set(route.clientId, entry);
  }
  for (const booking of bookingsInPeriod) {
    if (!SEAT_HELD.includes(booking.status)) continue;
    const entry = perClient.get(booking.clientId);
    if (entry) entry.bookedSeats += 1;
  }

  // Stops expected is the work the timetable promised: every stop of every run not cancelled. A run
  // that was scheduled and never worked shows up here as missing stops, which is the data gap a reader
  // needs to see before trusting an on-time figure.
  for (const trip of trips) {
    if (trip.status === "cancelled") continue;
    const route = db.routes.find((candidate) => candidate.id === trip.routeId);
    stopsExpected += route?.stops.length ?? 0;
  }

  const decided = carried + noShows;
  const onTime = onTimeReport(db, from, to);

  return {
    from,
    to,
    runsScheduled: trips.filter((trip) => trip.status !== "cancelled").length,
    runsCompleted: completed.length,
    runsCancelled: cancelledTrips.length,
    runsAdhoc: trips.filter((trip) => trip.origin === "adhoc").length,
    expected,
    carried,
    noShows,
    notRecorded,
    boardingRate: decided > 0 ? carried / decided : null,
    noShowRate: decided > 0 ? noShows / decided : null,
    seatsOffered,
    occupancy: seatsOffered > 0 ? carried / seatsOffered : null,
    lateStops: late.length,
    averageDelayMinutes: late.length > 0 ? Math.round((late.reduce((sum, value) => sum + value, 0) / late.length) * 10) / 10 : null,
    onTimeRate: onTime.status === "ok" ? onTime.rate : null,
    onTimeTimed: onTime.timed,
    bookings,
    seatReasons,
    seatsNotHeld,
    routes,
    clients: [...perClient.values()].sort((a, b) => b.carried - a.carried || a.clientName.localeCompare(b.clientName)),
    coverage: {
      runsWithoutVehicle: runsWithoutVehicle,
      completedRunsWithoutBoardings,
      stopsRecorded,
      stopsExpected,
      runsFromRosterWithoutStop,
    },
    status: completed.length === 0 ? "empty" : "ok",
    message:
      completed.length === 0
        ? "No run in this period has been completed, so there is nothing to say about riders yet. The scheduled and cancelled counts are real."
        : `${completed.length} of ${trips.filter((trip) => trip.status !== "cancelled").length} scheduled run(s) were worked; ${carried} rider(s) carried on ${new Set(completed.map((trip) => trip.routeId)).size} route(s).`,
  };
}

/** The report as CSV: the same figures, for the person who checks them in a spreadsheet. */
export function staffReportCsv(report: StaffReport): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const pct = (value: number | null) => (value === null ? "not available" : `${(value * 100).toFixed(1)}%`);
  const rows: string[][] = [
    ["Metric", "Value", "Note"],
    ["Period from", report.from, "service dates"],
    ["Period to", report.to, "service dates"],
    ["Runs scheduled", String(report.runsScheduled), "cancelled runs excluded"],
    ["Runs completed", String(report.runsCompleted), ""],
    ["Runs cancelled", String(report.runsCancelled), ""],
    ["Runs created outside the schedule", String(report.runsAdhoc), "a breakdown replacement or a one-off movement"],
    ["Expected riders", String(report.expected), "manifest of the completed runs: roster plus held seats"],
    ["Riders carried", String(report.carried), "boarded, recorded at the door"],
    ["No-shows", String(report.noShows), "recorded as not boarding"],
    ["Not recorded", String(report.notRecorded), "expected on a completed run with no outcome recorded"],
    ["Boarding rate", pct(report.boardingRate), "carried / (carried + no-shows)"],
    ["No-show rate", pct(report.noShowRate), "no-shows / (carried + no-shows)"],
    ["Seats offered", String(report.seatsOffered), "vehicle seat capacity on completed runs"],
    ["Occupancy", pct(report.occupancy), "carried / seats offered"],
    ["Late stops", String(report.lateStops), "recorded stops later than the timetable"],
    ["Average delay", report.averageDelayMinutes === null ? "not available" : `${report.averageDelayMinutes} minutes`, "over the late stops only"],
    ["On-time rate", pct(report.onTimeRate), `${report.onTimeTimed} completed run(s) with a threshold`],
    ["Seats requested", String(report.bookings.requested), "asked for, not yet answered"],
    ["Seats confirmed", String(report.bookings.confirmed), ""],
    ["Seats on the waiting list", String(report.bookings.waitlisted), ""],
    ["Seats offered after a cancellation", String(report.bookings.offered), ""],
    ["Seats refused", String(report.bookings.rejected), ""],
    ["Seats cancelled", String(report.bookings.cancelled), ""],
    ["Seats asked for and not held", String(report.seatsNotHeld), "refused, cancelled, waiting or not yet answered"],
    ["", "", ""],
    ["Route", "Client", "Runs scheduled · completed · carried · no-shows · not recorded · seats offered · occupancy"],
    ...report.routes.map((row) => [
      `${row.reference} ${row.name}`,
      row.clientName,
      `${row.runsScheduled} · ${row.runsCompleted} · ${row.carried} · ${row.noShows} · ${row.notRecorded} · ${row.seatsOffered} · ${pct(row.occupancy)}`,
    ]),
    ["", "", ""],
    ["Client", "Routes", "Carried · no-shows · booked seats"],
    ...report.clients.map((row) => [row.clientName, String(row.routes), `${row.carried} · ${row.noShows} · ${row.bookedSeats}`]),
    ["", "", ""],
    ["Why seats were lost", "Count", ""],
    ...report.seatReasons.map((row) => [row.reason, String(row.count), ""]),
    ["", "", ""],
    ["Runs with no vehicle", String(report.coverage.runsWithoutVehicle), "coverage"],
    ["Completed runs with no boarding recorded", String(report.coverage.completedRunsWithoutBoardings), "coverage"],
    ["Stops recorded", String(report.coverage.stopsRecorded), `of ${report.coverage.stopsExpected} expected`],
    ["Roster riders with no pickup stop", String(report.coverage.runsFromRosterWithoutStop), "their pickup cannot be printed on a manifest"],
  ];
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}
