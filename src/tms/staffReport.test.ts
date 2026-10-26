// The staff-transport report (brief RPT-02).
//
// Seven counts matter here, and each one is a place a report can quietly lie:
//
//   1. **carried** is a boarding recorded at the door, never the roster size;
//   2. **expected** is the manifest, so the difference between the two is a named gap ("not recorded")
//      rather than an unexplained shortfall;
//   3. **seats offered** uses the bus that was on the run, so occupancy is a measurement;
//   4. **a cancelled run** is counted, and a route whose runs were all cancelled still appears;
//   5. **delay** is measured only where a stop time was recorded, and an early arrival never cancels a
//      late one out;
//   6. **seats asked for** are counted by service date, so a request for Monday belongs to Monday
//      whatever day it was typed;
//   7. **a period the wrong way round** and **a period with no runs** are different from a period in
//      which nobody travelled.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { staffReport, staffReportCsv, STAFF_REPORT_LIMITS } from "./staffReport";
import { execute, type Actor } from "./service";
import { emptyDatabase, type Database, type Trip } from "./types";

const NOW = "2026-06-01T05:00:00.000Z";
const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const DATE = "2026-06-01";

interface World {
  db: Database;
  ops: Actor;
  routeId: string;
  otherRouteId: string;
  tripIds: string[];
  vehicleId: string;
  riderIds: string[];
}

function run(db: Database, actor: Actor | null, command: AnyCommand, now = NOW): Database {
  const result = executeCommand(db, actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}

/** Two routes on one client, a 4-seat bus, and three riders on the first route's roster. */
function build(): World {
  let db = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  db = run(db, admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  db = run(db, admin, {
    type: "update_settings",
    input: {
      ...db.settings,
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 5,
      vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
      shifts: [],
    },
  });
  const category = db.settings.vehicleCategories[0].id;
  db = run(db, ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId: category, make: "", model: "", seatCapacity: "4", notes: "" } });
  const vehicleId = db.vehicles[0].id;
  db = run(db, ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  db = run(db, admin, { type: "create_client", input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const clientId = db.clients[0].id;

  // Two routes at different times, so one bus and one driver can work both without a clash.
  const route = (name: string, first: string, firstTime: string, second: string, secondTime: string) => ({
    name,
    clientId,
    direction: "to_work" as const,
    shiftId: "",
    vehicleCategoryId: category,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2026-01-01",
    endDate: "",
    status: "active" as const,
    stops: [
      { name: first, scheduledTime: firstTime },
      { name: second, scheduledTime: secondTime },
    ],
  });
  db = run(db, ops, { type: "create_route", input: route("Estate run", "Estate gate", "06:00", "Head office", "06:30") });
  db = run(db, ops, { type: "create_route", input: route("Evening run", "Head office", "18:00", "Estate gate", "18:30") });
  const routeId = db.routes[0].id;
  const otherRouteId = db.routes[1].id;

  const riderIds: string[] = [];
  for (const name of ["Ama", "Kofi", "Yaa"]) {
    db = run(db, ops, {
      type: "create_passenger",
      input: { fullName: name, employeeRef: name, phone: "", clientId, routeId, stopId: db.routes[0].stops[0].id, status: "active" },
    });
    riderIds.push(db.passengers[db.passengers.length - 1].id);
  }

  db = run(db, ops, { type: "generate_trips", routeId, fromDate: DATE, toDate: DATE });
  db = run(db, ops, { type: "generate_trips", routeId: otherRouteId, fromDate: DATE, toDate: DATE });
  const tripIds = db.trips.map((trip) => trip.id);
  for (const id of tripIds) {
    db = run(db, ops, { type: "assign_trip", id, input: { vehicleId, driverId: db.drivers[0].id } });
  }
  return { db, ops, routeId, otherRouteId, tripIds, vehicleId, riderIds };
}

const tripOf = (db: Database, id: string) => db.trips.find((trip) => trip.id === id) as Trip;

/**
 * Work a run the way the office does: dispatch, start, record both stops with an outcome for every
 * rider expected at the first one, then complete.
 *
 * `outcomes` gives the three rostered riders' outcomes in roster order. The command refuses a stop
 * record that leaves anybody unanswered, which is exactly why "not recorded" is rare — a test that
 * needs that gap removes a boarding from the stored run afterwards, as a restored backup from before
 * outcomes were recorded would look.
 */
function work(
  w: World,
  tripId: string,
  options: { arrivedAt: string; secondAt: string; outcomes: ("boarded" | "no_show")[] },
  now = NOW,
): Database {
  let db = run(w.db, w.ops, { type: "dispatch_trip", id: tripId }, now);
  db = run(db, w.ops, { type: "start_trip", id: tripId }, now);
  const trip = tripOf(db, tripId);
  const route = db.routes.find((candidate) => candidate.id === trip.routeId)!;
  const boardings = w.riderIds.map((passengerId, index) => ({ passengerId, outcome: options.outcomes[index] }));
  db = run(db, w.ops, {
    type: "record_trip_stop",
    id: tripId,
    input: { stopId: route.stops[0].id, actualTime: options.arrivedAt, boardings },
  }, now);
  db = run(db, w.ops, {
    type: "record_trip_stop",
    id: tripId,
    input: { stopId: route.stops[1].id, actualTime: options.secondAt, boardings: [] },
  }, now);
  db = run(db, w.ops, { type: "complete_trip", id: tripId }, now);
  return db;
}

describe("staff report - what the buses did", () => {
  it("counts runs worked, riders carried, no-shows and the gap nobody recorded", () => {
    const w = build();
    // One of the three boards, one does not turn up, and the third answer is lost from the stored run
    // (what a backup taken before outcomes were recorded looks like).
    w.db = work(w, w.tripIds[0], { arrivedAt: "06:02", secondAt: "06:31", outcomes: ["boarded", "no_show", "no_show"] });
    const tripId = w.tripIds[0];
    w.db = { ...w.db, trips: w.db.trips.map((trip) => (trip.id === tripId ? { ...trip, boardings: trip.boardings.slice(0, 2) } : trip)) };
    const report = staffReport(w.db, DATE, DATE);

    expect(report.runsScheduled).toBe(2);
    expect(report.runsCompleted).toBe(1);
    // Carried is a boarding at the door: the roster of three is not three people carried.
    expect(report.carried).toBe(1);
    expect(report.noShows).toBe(1);
    expect(report.expected).toBe(3);
    expect(report.notRecorded).toBe(1);
    expect(report.boardingRate).toBeCloseTo(0.5, 5);
    expect(report.noShowRate).toBeCloseTo(0.5, 5);
  });

  it("counts seats offered from the bus that was on the run, so occupancy is a measurement", () => {
    const w = build();
    w.db = work(w, w.tripIds[0], { arrivedAt: "06:02", secondAt: "06:31", outcomes: ["boarded", "no_show", "no_show"] });
    const report = staffReport(w.db, DATE, DATE);
    // One worked run in a four-seat bus, one rider carried.
    expect(report.seatsOffered).toBe(4);
    expect(report.occupancy).toBeCloseTo(0.25, 5);
    expect(report.routes[0].occupancy).toBeCloseTo(0.25, 5);
  });

  it("measures a delay where it was recorded, and never lets an early stop cancel a late one", () => {
    const w = build();
    // First stop six minutes late, second stop four minutes early: the average delay is 6, not 1.
    w.db = work(w, w.tripIds[0], { arrivedAt: "06:06", secondAt: "06:26", outcomes: ["boarded", "no_show", "no_show"] });
    const report = staffReport(w.db, DATE, DATE);
    expect(report.lateStops).toBe(1);
    expect(report.averageDelayMinutes).toBe(6);
    // Four of eight stops were recorded on one of two runs, and the report says so.
    expect(report.coverage.stopsRecorded).toBe(2);
    expect(report.coverage.stopsExpected).toBe(4);
  });

  it("says 'not available' for a delay when nothing was recorded late", () => {
    const w = build();
    w.db = work(w, w.tripIds[0], { arrivedAt: "05:58", secondAt: "06:29", outcomes: ["boarded", "no_show", "no_show"] });
    const report = staffReport(w.db, DATE, DATE);
    expect(report.lateStops).toBe(0);
    expect(report.averageDelayMinutes).toBeNull();
  });

  it("keeps a route whose only run was cancelled, with zero worked", () => {
    const w = build();
    w.db = run(w.db, w.ops, { type: "cancel_trip", id: w.tripIds[1], reason: "Bus in the workshop" });
    const report = staffReport(w.db, DATE, DATE);
    expect(report.runsCancelled).toBe(1);
    const evening = report.routes.find((row) => row.routeId === w.otherRouteId)!;
    expect(evening.runsScheduled).toBe(0);
    expect(evening.runsCancelled).toBe(1);
    expect(evening.runsCompleted).toBe(0);
    expect(evening.carried).toBe(0);
    expect(evening.occupancy).toBeNull();
  });

  it("separates 'nothing ran' from 'nobody travelled'", () => {
    const w = build();
    const emptyPeriod = staffReport(w.db, "2026-07-01", "2026-07-31");
    expect(emptyPeriod.status).toBe("empty");
    expect(emptyPeriod.message).toMatch(/No run has a service date in this period/i);

    const scheduledOnly = staffReport(w.db, DATE, DATE);
    expect(scheduledOnly.status).toBe("empty");
    // The scheduled count is still real even though nothing was worked.
    expect(scheduledOnly.runsScheduled).toBe(2);
    expect(scheduledOnly.message).toMatch(/no run in this period has been completed/i);
  });

  it("refuses a backwards period instead of reporting a slice of time", () => {
    const report = staffReport(build().db, "2026-06-30", "2026-06-01");
    expect(report.status).toBe("invalid_range");
    expect(report.runsCompleted).toBe(0);
    expect(report.carried).toBe(0);
  });
});

describe("staff report - the seats people asked for", () => {
  it("counts requests by the day of the run, not the day they were typed", () => {
    const w = build();
    // A seat requested on 1 June for a run on 2 June: it belongs to 2 June's report, the day it is
    // used, not the day it was typed. (A seat cannot be requested for a run that has already left, so
    // the way to tell the two days apart is a request made ahead of time.)
    const LATER = "2026-06-02";
    w.db = run(w.db, w.ops, { type: "generate_trips", routeId: w.otherRouteId, fromDate: LATER, toDate: LATER });
    const laterTrip = w.db.trips[w.db.trips.length - 1];
    w.db = run(w.db, w.ops, { type: "assign_trip", id: laterTrip.id, input: { vehicleId: w.vehicleId, driverId: w.db.drivers[0].id } });
    w.db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderIds[0], routeId: w.otherRouteId, serviceDate: LATER, toDate: "", type: "one_time", note: "" },
    });
    const report = staffReport(w.db, LATER, LATER);
    expect(report.bookings.total).toBe(1);
    expect(report.bookings.requested).toBe(1);
    expect(report.seatsNotHeld).toBe(1);
    // The booking is not in 1 June's report, the day it was typed.
    expect(staffReport(w.db, DATE, DATE).bookings.total).toBe(0);
  });

  it("groups the reasons the office recorded for refusing or cancelling a seat", () => {
    const w = build();
    w.db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderIds[0], routeId: w.otherRouteId, serviceDate: DATE, toDate: "", type: "one_time", note: "" },
    });
    const booking = w.db.bookings[0];
    w.db = run(w.db, w.ops, { type: "reject_booking", id: booking.id, reason: "Route is for the night shift only" });
    const report = staffReport(w.db, DATE, DATE);
    expect(report.bookings.rejected).toBe(1);
    expect(report.seatReasons).toEqual([{ reason: "Route is for the night shift only", count: 1 }]);
  });

  it("counts a held seat as held, and says which client it belongs to", () => {
    const w = build();
    w.db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderIds[0], routeId: w.otherRouteId, serviceDate: DATE, toDate: "", type: "one_time", note: "" },
    });
    w.db = run(w.db, w.ops, { type: "confirm_booking", id: w.db.bookings[0].id });
    const report = staffReport(w.db, DATE, DATE);
    expect(report.bookings.confirmed).toBe(1);
    expect(report.seatsNotHeld).toBe(0);
    expect(report.clients[0].bookedSeats).toBe(1);
    // The seat is on the manifest of that run, so it is expected to be accounted for.
    expect(report.clients[0].clientName).toBe("Acme Ltd");
  });
});

describe("staff report - the CSV and the stated limits", () => {
  it("exports the same figures, quoting a reason that contains a comma", () => {
    const w = build();
    w.db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderIds[0], routeId: w.otherRouteId, serviceDate: DATE, toDate: "", type: "one_time", note: "" },
    });
    w.db = run(w.db, w.ops, { type: "reject_booking", id: w.db.bookings[0].id, reason: "Full, and a second bus is not available" });
    const report = staffReport(w.db, DATE, DATE);
    const csv = staffReportCsv(report);
    expect(csv).toContain("Runs scheduled,2");
    expect(csv).toContain('"Full, and a second bus is not available",1');
    expect(csv).toContain("Period from,2026-06-01");
    expect(csv.split("\n")[0]).toBe("Metric,Value,Note");
  });

  it("names what it cannot say rather than leaving a reader to assume a zero", () => {
    const limits = STAFF_REPORT_LIMITS.join(" ");
    expect(limits).toMatch(/Fuel and mileage are not per route/i);
    expect(limits).toMatch(/Downtime is not measured/i);
    expect(limits).toMatch(/Contract performance is not measured/i);
    expect(limits).toMatch(/only known where a stop time was recorded/i);
  });
});
