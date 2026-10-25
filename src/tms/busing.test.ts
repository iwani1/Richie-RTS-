import { describe, expect, it } from "vitest";
import { MAX_GENERATE_DAYS, tripOnTime, type CompleteTripInput, type PassengerInput, type RouteInput } from "./busing";
import { executeCommand, type AnyCommand } from "./commands";
import { onTimeReport } from "./kpis";
import { execute, type Actor, type Credential, type CommandResult } from "./service";
import { SCHEMA_VERSION, emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Trip } from "./types";

const NOW = "2026-06-01T06:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const EMAILS = { admin: "admin@example.test", ops: "ops@example.test", finance: "fin@example.test", driver: "driver@example.test" } as const;
type Who = keyof typeof EMAILS;

interface World {
  db: Database;
}

function actorOf(db: Database, who: Who): Actor {
  const u = db.users.find((x) => x.email === EMAILS[who]);
  if (!u) throw new Error(`missing user ${who}`);
  return { id: u.id, fullName: u.fullName, role: u.role };
}

function step(w: World, who: Who, command: AnyCommand): CommandResult {
  const r = executeCommand(w.db, actorOf(w.db, who), command, NOW);
  if (!r.ok) throw new Error(`${command.type} failed: ${r.message} ${JSON.stringify(r.errors)}`);
  w.db = r.db;
  return r;
}

function attempt(w: World, who: Who, command: AnyCommand): CommandResult {
  return executeCommand(w.db, actorOf(w.db, who), command, NOW);
}

function stepActor(w: World, actor: Actor, command: AnyCommand): CommandResult {
  const result = executeCommand(w.db, actor, command, NOW);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
}

function attemptActor(w: World, actor: Actor, command: AnyCommand): CommandResult {
  return executeCommand(w.db, actor, command, NOW);
}

const errorsOf = (r: CommandResult): Record<string, string> => (r.ok ? {} : r.errors);
const last = <T extends { id: string }>(xs: T[]) => xs[xs.length - 1].id;

function build(): World {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: EMAILS.admin }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  const w: World = { db: setup.db };
  step(w, "admin", { type: "create_user", input: { fullName: "Ops", email: EMAILS.ops, role: "operations", active: true }, credential: cred });
  step(w, "admin", { type: "create_user", input: { fullName: "Fin", email: EMAILS.finance, role: "finance", active: true }, credential: cred });
  step(w, "admin", {
    type: "update_settings",
    input: {
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 5,
      vehicleCategories: [
        { id: "", name: "Coaster" },
        { id: "", name: "Minibus" },
      ],
      shifts: [],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: null,
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      maintenance: { schedules: [] },
    },
  });
  const coaster = w.db.settings.vehicleCategories[0].id;
  const minibus = w.db.settings.vehicleCategories[1].id;
  step(w, "ops", { type: "create_vehicle", input: { registration: "GT 900-26", categoryId: coaster, make: "", model: "", seatCapacity: "30", notes: "" } });
  step(w, "ops", { type: "create_vehicle", input: { registration: "GT 901-26", categoryId: coaster, make: "", model: "", seatCapacity: "30", notes: "" } });
  step(w, "ops", { type: "create_vehicle", input: { registration: "GT 902-26", categoryId: minibus, make: "", model: "", seatCapacity: "14", notes: "" } });
  step(w, "ops", { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  step(w, "ops", { type: "create_driver", input: { fullName: "Ama", phone: "020", licenceNumber: "L-2", licenceExpiry: "2030-01-01", status: "active" } });
  step(w, "admin", { type: "create_user", input: { fullName: "Kojo", email: EMAILS.driver, role: "driver", active: true, driverId: w.db.drivers[0].id }, credential: cred });
  step(w, "finance", { type: "create_client", input: { name: "Acme", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
  return w;
}

function routeInput(w: World, overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    name: "Estate run",
    clientId: w.db.clients[0].id,
    direction: "to_work",
    shiftId: "",
    vehicleCategoryId: w.db.settings.vehicleCategories[0].id,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2026-01-01",
    endDate: "",
    status: "active",
    stops: [
      { name: "Estate gate", scheduledTime: "06:00" },
      { name: "Mid", scheduledTime: "06:15" },
      { name: "Head office", scheduledTime: "06:30" },
    ],
    ...overrides,
  };
}

const asInput = (r: BusRoute): RouteInput => ({
  name: r.name,
  clientId: r.clientId,
  direction: r.direction,
  shiftId: r.shiftId ?? "",
  vehicleCategoryId: r.vehicleCategoryId,
  weekdays: r.weekdays,
  startDate: r.startDate,
  endDate: r.endDate ?? "",
  status: r.status,
  stops: r.stops.map((s) => ({ id: s.id, name: s.name, scheduledTime: s.scheduledTime })),
});

function createRoute(w: World, overrides: Partial<RouteInput> = {}): string {
  step(w, "ops", { type: "create_route", input: routeInput(w, overrides) });
  return last(w.db.routes);
}

function generate(w: World, routeId: string, date: string): string {
  step(w, "ops", { type: "generate_trips", routeId, fromDate: date, toDate: date });
  return w.db.trips.filter((t) => t.routeId === routeId && t.serviceDate === date)[0].id;
}

const passengerInput = (w: World, over: Partial<PassengerInput> = {}): PassengerInput => ({
  fullName: "Ama Boateng",
  employeeRef: "E-001",
  phone: "",
  clientId: w.db.clients[0].id,
  routeId: "",
  stopId: "",
  status: "active",
  ...over,
});

function runTrip(w: World, routeId: string, date: string, times: string[], vehicleIndex = 0, driverIndex = 0): string {
  const tripId = generate(w, routeId, date);
  step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[vehicleIndex].id, driverId: w.db.drivers[driverIndex].id } });
  step(w, "ops", { type: "dispatch_trip", id: tripId });
  const route = w.db.routes.find((r) => r.id === routeId)!;
  step(w, "ops", {
    type: "complete_trip",
    id: tripId,
    input: { stopTimes: route.stops.map((s, i) => ({ stopId: s.id, actualTime: times[i] })), boardings: [] },
  });
  return tripId;
}

describe("staff busing - routes", () => {
  it("validates stops, days, client and times", () => {
    const w = build();
    const bad = attempt(w, "ops", {
      type: "create_route",
      input: routeInput(w, { stops: [{ name: "Only", scheduledTime: "06:00" }], weekdays: [], clientId: "nope" }),
    });
    expect(bad.ok).toBe(false);
    expect(errorsOf(bad).stops).toBeDefined();
    expect(errorsOf(bad).weekdays).toBeDefined();
    expect(errorsOf(bad).clientId).toBeDefined();

    const backwards = attempt(w, "ops", {
      type: "create_route",
      input: routeInput(w, { stops: [{ name: "A", scheduledTime: "07:00" }, { name: "B", scheduledTime: "06:00" }] }),
    });
    expect(errorsOf(backwards)["stops.1.scheduledTime"]).toMatch(/backwards/);
  });

  it("locks stops, client and category once trips exist, but allows changing operating days", () => {
    const w = build();
    const routeId = createRoute(w);
    generate(w, routeId, "2026-06-02");
    const route = w.db.routes[0];

    const changedTime = attempt(w, "ops", {
      type: "update_route",
      id: routeId,
      input: { ...asInput(route), stops: route.stops.map((s, i) => (i === 1 ? { id: s.id, name: s.name, scheduledTime: "06:20" } : { id: s.id, name: s.name, scheduledTime: s.scheduledTime })) },
    });
    expect(errorsOf(changedTime).stops).toMatch(/locked/);

    const daysOnly = attempt(w, "ops", { type: "update_route", id: routeId, input: { ...asInput(route), weekdays: [1, 2, 3, 4, 5] } });
    expect(daysOnly.ok).toBe(true);
  });
});

describe("staff busing - trip generation", () => {
  it("creates trips only on operating days, never duplicates, and caps the range", () => {
    const w = build();
    const routeId = createRoute(w, { weekdays: [1, 2, 3, 4, 5] });
    // 2026-06-01 is a Monday.
    step(w, "ops", { type: "generate_trips", routeId, fromDate: "2026-06-01", toDate: "2026-06-07" });
    expect(w.db.trips.map((t) => t.serviceDate)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]);
    expect(w.db.trips.every((t) => t.status === "planned")).toBe(true);

    const again = attempt(w, "ops", { type: "generate_trips", routeId, fromDate: "2026-06-01", toDate: "2026-06-07" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/No trips generated/);

    const tooLong = attempt(w, "ops", { type: "generate_trips", routeId, fromDate: "2026-06-01", toDate: "2026-09-01" });
    expect(errorsOf(tooLong).toDate).toMatch(new RegExp(`at most ${MAX_GENERATE_DAYS}`));
  });

  it("denies trip generation to finance and passenger creation to finance", () => {
    const w = build();
    const routeId = createRoute(w);
    const denied = attempt(w, "finance", { type: "generate_trips", routeId, fromDate: "2026-06-01", toDate: "2026-06-01" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toMatch(/Not permitted/);
    const passenger = attempt(w, "finance", { type: "create_passenger", input: passengerInput(w) });
    expect(passenger.ok).toBe(false);
  });
});

describe("staff busing - passengers", () => {
  it("requires the pickup stop to belong to the route and the route to belong to the client", () => {
    const w = build();
    const routeId = createRoute(w);
    step(w, "finance", { type: "create_client", input: { name: "Beta", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
    const betaId = last(w.db.clients);
    const betaRoute = createRoute(w, { clientId: betaId, name: "Beta run" });

    const wrongClient = attempt(w, "ops", { type: "create_passenger", input: passengerInput(w, { routeId: betaRoute, stopId: w.db.routes[1].stops[0].id }) });
    expect(errorsOf(wrongClient).routeId).toMatch(/different client/);

    const wrongStop = attempt(w, "ops", { type: "create_passenger", input: passengerInput(w, { routeId, stopId: "nope" }) });
    expect(errorsOf(wrongStop).stopId).toMatch(/does not belong/);
  });

  it("enforces unique employee references per client", () => {
    const w = build();
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { employeeRef: "E-7" }) });
    const dup = attempt(w, "ops", { type: "create_passenger", input: passengerInput(w, { employeeRef: "e-7", fullName: "Other" }) });
    expect(errorsOf(dup).employeeRef).toMatch(/already exists/);
  });
});

describe("staff busing - assignment and conflicts", () => {
  it("blocks overlapping runs for the same vehicle or driver, but allows back-to-back runs", () => {
    const w = build();
    const a = createRoute(w, { name: "Route A", stops: [{ name: "A1", scheduledTime: "06:00" }, { name: "A2", scheduledTime: "06:30" }] });
    const b = createRoute(w, { name: "Route B", stops: [{ name: "B1", scheduledTime: "06:15" }, { name: "B2", scheduledTime: "06:45" }] });
    const c = createRoute(w, { name: "Route C", stops: [{ name: "C1", scheduledTime: "07:00" }, { name: "C2", scheduledTime: "07:30" }] });
    const v1 = w.db.vehicles[0].id;
    const v2 = w.db.vehicles[1].id;
    const d1 = w.db.drivers[0].id;
    const d2 = w.db.drivers[1].id;
    const tA = generate(w, a, "2026-06-08");
    const tB = generate(w, b, "2026-06-08");
    const tC = generate(w, c, "2026-06-08");

    step(w, "ops", { type: "assign_trip", id: tA, input: { vehicleId: v1, driverId: d1 } });

    const vehicleClash = attempt(w, "ops", { type: "assign_trip", id: tB, input: { vehicleId: v1, driverId: d2 } });
    expect(errorsOf(vehicleClash).vehicleId).toMatch(/overlapping/);

    const driverClash = attempt(w, "ops", { type: "assign_trip", id: tB, input: { vehicleId: v2, driverId: d1 } });
    expect(errorsOf(driverClash).driverId).toMatch(/overlapping/);

    step(w, "ops", { type: "assign_trip", id: tB, input: { vehicleId: v2, driverId: d2 } });
    step(w, "ops", { type: "assign_trip", id: tC, input: { vehicleId: v1, driverId: d1 } });
  });

  it("blocks wrong vehicle category, vehicles not available, and vehicles on a rental that day", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = generate(w, routeId, "2026-06-10");
    const minibus = w.db.vehicles[2].id;
    const mismatch = attempt(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: minibus, driverId: w.db.drivers[0].id } });
    expect(errorsOf(mismatch).vehicleId).toMatch(/category/);

    step(w, "ops", { type: "transition_vehicle", id: w.db.vehicles[1].id, to: "maintenance", reason: "Service due" });
    const maint = attempt(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[1].id, driverId: w.db.drivers[0].id } });
    expect(errorsOf(maint).vehicleId).toMatch(/Available/);
  });

  it("refuses dispatch without a vehicle and driver", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = generate(w, routeId, "2026-06-11");
    const r = attempt(w, "ops", { type: "dispatch_trip", id: tripId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Assign a vehicle and a driver/);
  });
});

describe("staff busing - progressive driver run", () => {
  it("starts only its assigned run, records the next stop and its roster, then completes from recorded data", () => {
    const w = build();
    const routeId = createRoute(w, {
      name: "Progressive run",
      stops: [
        { name: "Estate gate", scheduledTime: "06:00" },
        { name: "Market", scheduledTime: "06:15" },
        { name: "Head office", scheduledTime: "06:30" },
      ],
    });
    const route = w.db.routes.find((r) => r.id === routeId)!;
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Ama", employeeRef: "P-A", routeId, stopId: route.stops[0].id }) });
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Kofi", employeeRef: "P-K", routeId, stopId: route.stops[1].id }) });
    const [ama, kofi] = [w.db.passengers[0], w.db.passengers[1]];

    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    const driver = actorOf(w.db, "driver");

    const started = attempt(w, "driver", { type: "start_trip", id: tripId });
    expect(started.ok).toBe(true);
    if (started.ok) w.db = started.db;
    expect(w.db.trips.find((trip) => trip.id === tripId)?.status).toBe("in_progress");
    expect(w.db.trips.find((trip) => trip.id === tripId)?.startedAt).toBe(NOW);

    // Mid-trip roster rules are covered in the dedicated block below (Phase 11 amends the freeze).

    // Ownership is checked before state: this driver cannot probe or start a different run.
    const otherTripId = generate(w, createRoute(w, { name: "Other run" }), "2026-06-08");
    const other = attemptActor(w, driver, { type: "start_trip", id: otherTripId });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.message).toMatch(/assigned to you/);

    const wrongStop = attemptActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:20", boardings: [] } });
    expect(wrongStop.ok).toBe(false);
    expect(errorsOf(wrongStop).stopId).toMatch(/next stop is Estate gate/);

    const missingOutcome = attemptActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [] } });
    expect(errorsOf(missingOutcome).boardings).toMatch(/every active passenger at Estate gate/);

    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: ama.id, outcome: "boarded" }] } });
    expect(w.db.trips.find((trip) => trip.id === tripId)?.stopLogs).toHaveLength(1);

    const backwards = attemptActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:02", boardings: [{ passengerId: kofi.id, outcome: "no_show" }] } });
    expect(errorsOf(backwards).actualTime).toMatch(/cannot go backwards/);
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:20", boardings: [{ passengerId: kofi.id, outcome: "no_show" }] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[2].id, actualTime: "06:30", boardings: [] } });

    const completed = attemptActor(w, driver, { type: "complete_trip", id: tripId });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    w.db = completed.db;
    const trip = w.db.trips.find((record) => record.id === tripId)!;
    expect(trip.status).toBe("completed");
    expect(trip.stopLogs.map((log) => log.actualTime)).toEqual(["06:03", "06:20", "06:30"]);
    expect(trip.boardings).toEqual([
      { passengerId: ama.id, stopId: route.stops[0].id, outcome: "boarded" },
      { passengerId: kofi.id, stopId: route.stops[1].id, outcome: "no_show" },
    ]);
    expect(tripOnTime(trip, route, 5)).toBe(true);
    expect(w.db.audit.some((entry) => entry.action === "trips:record_stop")).toBe(true);

    const editAfterCompletion = attemptActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:00", boardings: [] } });
    expect(editAfterCompletion.ok).toBe(false);
  });

  it("does not allow the full-form completion to overwrite progressive stop records", () => {
    const w = build();
    const routeId = createRoute(w);
    const route = w.db.routes.find((r) => r.id === routeId)!;
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "start_trip", id: tripId });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:00", boardings: [] } });
    const overwrite = attempt(w, "ops", { type: "complete_trip", id: tripId, input: { stopTimes: route.stops.map((stop) => ({ stopId: stop.id, actualTime: stop.scheduledTime })), boardings: [] } });
    expect(overwrite.ok).toBe(false);
    if (!overwrite.ok) expect(overwrite.message).toMatch(/cannot be replaced/);
  });
});

describe("staff busing - date and capacity guards (brief 5.1, 5.5)", () => {
  it("refuses to start a run before its service day, or long after it", () => {
    const w = build();
    const routeId = createRoute(w);
    const future = generate(w, routeId, "2026-06-08");
    step(w, "ops", { type: "assign_trip", id: future, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: future });
    const tooEarly = attempt(w, "driver", { type: "start_trip", id: future });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.message).toMatch(/scheduled for 2026-06-08/);

    const stale = generate(w, routeId, "2026-05-20");
    step(w, "ops", { type: "assign_trip", id: stale, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: stale });
    const tooLate = attempt(w, "driver", { type: "start_trip", id: stale });
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.message).toMatch(/was scheduled for 2026-05-20/);
  });

  it("refuses a vehicle that cannot seat the route's active roster", () => {
    const w = build();
    const minibus = w.db.settings.vehicleCategories[1].id;
    const routeId = createRoute(w, { name: "Big roster", vehicleCategoryId: minibus });
    const route = w.db.routes.find((r) => r.id === routeId)!;
    for (let i = 1; i <= 15; i += 1) {
      step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: `Rider ${i}`, employeeRef: `E-${i}`, routeId, stopId: route.stops[0].id }) });
    }
    const tripId = generate(w, routeId, "2026-06-01");
    const minibusVehicle = w.db.vehicles.find((v) => v.registration === "GT 902-26")!;
    const tooSmall = attempt(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: minibusVehicle.id, driverId: w.db.drivers[0].id } });
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.errors.vehicleId).toMatch(/seats 14/);
  });

  it("rechecks capacity at dispatch, so a roster that grew after assignment is caught", () => {
    const w = build();
    const catId = w.db.settings.vehicleCategories[0].id;
    step(w, "ops", { type: "create_vehicle", input: { registration: "GT 903-26", categoryId: catId, make: "Toyota", model: "Mini", seatCapacity: "3", notes: "" } });
    const small = w.db.vehicles.find((v) => v.registration === "GT 903-26")!;
    const routeId = createRoute(w, { name: "Three seats", stops: [{ name: "A", scheduledTime: "06:00" }, { name: "B", scheduledTime: "06:20" }] });
    const route = w.db.routes.find((r) => r.id === routeId)!;
    for (let i = 1; i <= 2; i += 1) {
      step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: `Rider ${i}`, employeeRef: `R-${i}`, routeId, stopId: route.stops[0].id }) });
    }
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: small.id, driverId: w.db.drivers[0].id } });
    for (let i = 3; i <= 5; i += 1) {
      step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: `Rider ${i}`, employeeRef: `R-${i}`, routeId, stopId: route.stops[0].id }) });
    }
    const dispatch = attempt(w, "ops", { type: "dispatch_trip", id: tripId });
    expect(dispatch.ok).toBe(false);
    if (!dispatch.ok) expect(dispatch.errors.vehicleId).toMatch(/seats 3/);
  });
});

describe("staff busing - mid-trip passenger changes", () => {
  function startedRun() {
    const w = build();
    const routeId = createRoute(w, {
      name: "Mid-trip run",
      stops: [
        { name: "Estate gate", scheduledTime: "06:00" },
        { name: "Market", scheduledTime: "06:15" },
        { name: "Head office", scheduledTime: "06:30" },
      ],
    });
    const route = w.db.routes.find((r) => r.id === routeId)!;
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Ama", employeeRef: "P-A", routeId, stopId: route.stops[0].id }) });
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Kofi", employeeRef: "P-K", routeId, stopId: route.stops[1].id }) });
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    step(w, "driver", { type: "start_trip", id: tripId });
    return { w, route, tripId, amaId: w.db.passengers[0].id, kofiId: w.db.passengers[1].id };
  }

  it("allows adding a passenger to a future stop mid-trip, and the driver records them there", () => {
    const { w, route, tripId } = startedRun();
    const added = step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "New rider", employeeRef: "P-N", routeId: route.id, stopId: route.stops[2].id }) });
    expect(w.db.audit[0].summary).toMatch(/Mid-trip addition during TR-/);
    const newId = (added as { db: Database }).db.passengers.find((p) => p.employeeRef === "P-N")!.id;
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: w.db.passengers[0].id, outcome: "boarded" }] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:20", boardings: [{ passengerId: w.db.passengers[1].id, outcome: "no_show" }] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[2].id, actualTime: "06:31", boardings: [{ passengerId: newId, outcome: "boarded" }] } });
    const completed = attemptActor(w, driver, { type: "complete_trip", id: tripId });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    w.db = completed.db;
    expect(w.db.trips.find((t) => t.id === tripId)?.boardings).toHaveLength(3);
  });

  it("refuses a roster addition that would overflow the seats of a run already on the road", () => {
    const w = build();
    const catId = w.db.settings.vehicleCategories[0].id;
    step(w, "ops", { type: "create_vehicle", input: { registration: "GT 904-26", categoryId: catId, make: "Toyota", model: "Mini", seatCapacity: "3", notes: "" } });
    const small = w.db.vehicles.find((v) => v.registration === "GT 904-26")!;
    const routeId = createRoute(w, { name: "Three seats", stops: [{ name: "A", scheduledTime: "06:00" }, { name: "B", scheduledTime: "06:20" }] });
    const route = w.db.routes.find((r) => r.id === routeId)!;
    for (let i = 1; i <= 2; i += 1) {
      step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: `Rider ${i}`, employeeRef: `C-${i}`, routeId, stopId: route.stops[0].id }) });
    }
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: small.id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    step(w, "driver", { type: "start_trip", id: tripId });

    // The third rider still fits; the fourth would put four people in a three-seat vehicle that has
    // already left, and dispatch can no longer catch it (brief 5.1, 12).
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Rider 3", employeeRef: "C-3", routeId, stopId: route.stops[1].id }) });
    const fourth = attempt(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Rider 4", employeeRef: "C-4", routeId, stopId: route.stops[1].id }) });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.errors.routeId).toMatch(/seats 3/);
    expect(w.db.passengers.some((p) => p.employeeRef === "C-4")).toBe(false);
  });

  it("refuses passengers on already-recorded stops", () => {
    const { w, route, tripId, amaId } = startedRun();
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: amaId, outcome: "boarded" }] } });
    const late = attempt(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Too late", employeeRef: "P-L", routeId: route.id, stopId: route.stops[0].id }) });
    expect(late.ok).toBe(false);
    expect(errorsOf(late).stopId).toMatch(/already recorded/);
    const kofi = w.db.passengers.find((p) => p.employeeRef === "P-K")!;
    const move = attempt(w, "ops", {
      type: "update_passenger",
      id: kofi.id,
      input: passengerInput(w, { fullName: "Kofi", employeeRef: "P-K", routeId: route.id, stopId: route.stops[0].id }),
    });
    expect(move.ok).toBe(false);
    expect(errorsOf(move).stopId).toMatch(/already recorded/);
  });

  it("locks assignment once boarded but allows personal-detail corrections", () => {
    const { w, route, tripId, amaId } = startedRun();
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: amaId, outcome: "boarded" }] } });
    const move = attempt(w, "ops", {
      type: "update_passenger",
      id: amaId,
      input: passengerInput(w, { fullName: "Ama", employeeRef: "P-A", routeId: route.id, stopId: route.stops[2].id }),
    });
    expect(move.ok).toBe(false);
    expect(errorsOf(move).stopId).toMatch(/already boarded/);
    const deactivate = attempt(w, "ops", {
      type: "update_passenger",
      id: amaId,
      input: passengerInput(w, { fullName: "Ama", employeeRef: "P-A", routeId: route.id, stopId: route.stops[0].id, status: "inactive" }),
    });
    expect(deactivate.ok).toBe(false);
    expect(errorsOf(deactivate).status).toMatch(/already has a boarding outcome/);
    const correction = attempt(w, "ops", {
      type: "update_passenger",
      id: amaId,
      input: passengerInput(w, { fullName: "Ama", employeeRef: "P-A", phone: "055", routeId: route.id, stopId: route.stops[0].id }),
    });
    expect(correction.ok).toBe(true);
  });

  it("allows deactivating a future passenger mid-trip and completes consistently", () => {
    const { w, route, tripId, amaId, kofiId } = startedRun();
    step(w, "ops", {
      type: "update_passenger",
      id: kofiId,
      input: passengerInput(w, { fullName: "Kofi", employeeRef: "P-K", routeId: route.id, stopId: route.stops[1].id, status: "inactive" }),
    });
    expect(w.db.audit[0].summary).toMatch(/Mid-trip change during TR-/);
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: amaId, outcome: "boarded" }] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:20", boardings: [] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[2].id, actualTime: "06:31", boardings: [] } });
    const completed = attemptActor(w, driver, { type: "complete_trip", id: tripId });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.db.trips.find((t) => t.id === tripId)?.boardings).toHaveLength(1);
  });

  it("allows moving a passenger between two future stops", () => {
    const { w, route, tripId, amaId, kofiId } = startedRun();
    step(w, "ops", {
      type: "update_passenger",
      id: kofiId,
      input: passengerInput(w, { fullName: "Kofi", employeeRef: "P-K", routeId: route.id, stopId: route.stops[2].id }),
    });
    const driver = actorOf(w.db, "driver");
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[0].id, actualTime: "06:03", boardings: [{ passengerId: amaId, outcome: "boarded" }] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[1].id, actualTime: "06:20", boardings: [] } });
    stepActor(w, driver, { type: "record_trip_stop", id: tripId, input: { stopId: route.stops[2].id, actualTime: "06:31", boardings: [{ passengerId: kofiId, outcome: "boarded" }] } });
    const completed = attemptActor(w, driver, { type: "complete_trip", id: tripId });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.db.trips.find((t) => t.id === tripId)?.boardings.find((b) => b.passengerId === kofiId)?.stopId).toBe(route.stops[2].id);
  });
});

describe("staff busing - completion and on-time", () => {
  it("requires every stop time and one outcome per active passenger, and excludes inactive passengers", () => {
    const w = build();
    const routeId = createRoute(w);
    const stops = w.db.routes[0].stops;
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Ama", employeeRef: "A", routeId, stopId: stops[0].id }) });
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Kofi", employeeRef: "K", routeId, stopId: stops[1].id }) });
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { fullName: "Old", employeeRef: "O", routeId, stopId: stops[0].id, status: "inactive" }) });
    const [ama, kofi] = [w.db.passengers[0].id, w.db.passengers[1].id];

    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });

    const timesOk = [
      { stopId: stops[0].id, actualTime: "06:02" },
      { stopId: stops[1].id, actualTime: "06:20" },
      { stopId: stops[2].id, actualTime: "" },
    ];
    const missingTime = attempt(w, "ops", {
      type: "complete_trip",
      id: tripId,
      input: { stopTimes: timesOk, boardings: [{ passengerId: ama, outcome: "boarded" }, { passengerId: kofi, outcome: "boarded" }] },
    });
    expect(errorsOf(missingTime)["stopTimes.2"]).toBeDefined();

    const missingOutcome = attempt(w, "ops", {
      type: "complete_trip",
      id: tripId,
      input: { stopTimes: [...timesOk.slice(0, 2), { stopId: stops[2].id, actualTime: "06:31" }], boardings: [{ passengerId: ama, outcome: "boarded" }] },
    });
    expect(errorsOf(missingOutcome).boardings).toMatch(/every active passenger/);

    const inactiveRecorded = attempt(w, "ops", {
      type: "complete_trip",
      id: tripId,
      input: {
        stopTimes: [...timesOk.slice(0, 2), { stopId: stops[2].id, actualTime: "06:31" }],
        boardings: [{ passengerId: ama, outcome: "boarded" }, { passengerId: kofi, outcome: "no_show" }, { passengerId: w.db.passengers[2].id, outcome: "boarded" }],
      },
    });
    expect(errorsOf(inactiveRecorded).boardings).toMatch(/not on this route/);

    const input: CompleteTripInput = {
      stopTimes: [...timesOk.slice(0, 2), { stopId: stops[2].id, actualTime: "06:31" }],
      boardings: [{ passengerId: ama, outcome: "boarded" }, { passengerId: kofi, outcome: "no_show" }],
    };
    const done = step(w, "ops", { type: "complete_trip", id: tripId, input });
    expect(done.message).toMatch(/On time: yes/);
    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.status).toBe("completed");
    expect(trip.boardings).toHaveLength(2);
    expect(trip.boardings.find((b) => b.passengerId === kofi)?.stopId).toBe(stops[1].id);
    expect(trip.onTimeThresholdMinutes).toBe(5);
  });

  it("judges on-time per stop with early arrivals counted as on time", () => {
    const route = { stops: [{ id: "a", name: "A", scheduledTime: "06:00" }, { id: "b", name: "B", scheduledTime: "06:30" }] } as BusRoute;
    const trip = { stopLogs: [{ stopId: "a", actualTime: "05:58" }, { stopId: "b", actualTime: "06:35" }] } as Trip;
    expect(tripOnTime(trip, route, 5)).toBe(true);
    expect(tripOnTime(trip, route, 4)).toBe(false);
  });

  it("does not compute on-time when the threshold was unset at completion (Q-06)", () => {
    const w = build();
    step(w, "admin", { type: "update_settings", input: { ...w.db.settings, onTimeThresholdMinutes: null } });
    const routeId = createRoute(w);
    runTrip(w, routeId, "2026-06-12", ["06:00", "06:15", "06:30"]);
    const trip = w.db.trips[0];
    expect(trip.onTimeThresholdMinutes).toBeNull();
    const report = onTimeReport(w.db, "2026-06-01", "2026-06-30");
    expect(report.status).toBe("threshold_not_set");
    expect(report.rate).toBeNull();
  });

  it("cancels only planned or dispatched trips, with a reason", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = generate(w, routeId, "2026-06-13");
    const noReason = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: " " });
    expect(errorsOf(noReason).reason).toBeDefined();
    step(w, "ops", { type: "cancel_trip", id: tripId, reason: "Holiday" });
    const again = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Again" });
    expect(again.ok).toBe(false);

    const doneId = runTrip(w, routeId, "2026-06-14", ["06:00", "06:15", "06:30"]);
    const cancelDone = attempt(w, "ops", { type: "cancel_trip", id: doneId, reason: "Late" });
    expect(cancelDone.ok).toBe(false);
  });
});

describe("staff busing - on-time report", () => {
  it("reports rate and coverage with the reporting period, and flags insufficient data", () => {
    const w = build();
    const routeId = createRoute(w);
    runTrip(w, routeId, "2026-06-09", ["06:02", "06:20", "06:31"]); // on time
    runTrip(w, routeId, "2026-06-10", ["06:00", "06:15", "06:45"]); // Head office 15 min late
    generate(w, routeId, "2026-06-11"); // planned, not yet run

    const report = onTimeReport(w.db, "2026-06-01", "2026-06-30");
    expect(report.status).toBe("ok");
    expect(report.scheduled).toBe(3);
    expect(report.completed).toBe(2);
    expect(report.timed).toBe(2);
    expect(report.onTime).toBe(1);
    expect(report.rate).toBe(0.5);
    expect(report.coverage).toBeCloseTo(2 / 3);

    const empty = onTimeReport(w.db, "2026-07-01", "2026-07-31");
    expect(empty.status).toBe("insufficient_data");
    expect(empty.rate).toBeNull();

    const invalid = onTimeReport(w.db, "2026-06-30", "2026-06-01");
    expect(invalid.status).toBe("insufficient_data");
  });
});

describe("staff busing - migration", () => {
  it("imports a schema-2 backup and upgrades it with empty busing collections", () => {
    const w = build();
    const legacy = {
      schemaVersion: 2,
      users: w.db.users,
      vehicles: w.db.vehicles,
      drivers: w.db.drivers,
      clients: w.db.clients,
      rentals: w.db.rentals,
      settings: w.db.settings,
      audit: w.db.audit,
    } as unknown as Database;
    const r = executeCommand(w.db, actorOf(w.db, "admin"), { type: "import_backup", database: legacy }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.db.routes).toEqual([]);
      expect(r.db.trips).toEqual([]);
      expect(r.db.passengers).toEqual([]);
      // Phase 3 collections arrive empty when upgrading older backups.
      expect(r.db.incidents).toEqual([]);
      expect(r.db.workOrders).toEqual([]);
      expect(r.db.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it("imports a schema-9 backup and backfills startedAt without changing existing trip state", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = generate(w, routeId, "2026-06-15");
    const oldTrip = { ...w.db.trips.find((trip) => trip.id === tripId)! } as Record<string, unknown>;
    delete oldTrip.startedAt;
    const legacy = { ...w.db, schemaVersion: 9, trips: [oldTrip] } as unknown as Database;
    const result = executeCommand(w.db, actorOf(w.db, "admin"), { type: "import_backup", database: legacy }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.schemaVersion).toBe(SCHEMA_VERSION);
      expect(result.db.trips[0].startedAt).toBeNull();
      expect(result.db.trips[0].status).toBe("planned");
    }
  });
});

describe("staff busing - corrections to a recorded run (D-74, Q-42)", () => {
  /** A completed run whose actual times are 06:05 / 06:20 / 06:35 against 06:00 / 06:15 / 06:30. */
  function completedRun(w: World): { tripId: string; routeId: string; stops: string[] } {
    const routeId = createRoute(w);
    const tripId = runTrip(w, routeId, "2026-06-02", ["06:05", "06:20", "06:35"]);
    const route = w.db.routes.find((r) => r.id === routeId)!;
    return { tripId, routeId, stops: route.stops.map((s) => s.id) };
  }

  it("corrects a stop time on a completed run, and keeps what was there before", () => {
    const w = build();
    const { tripId, stops } = completedRun(w);

    const result = step(w, "ops", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[1], newValue: "06:18", reason: "Driver wrote the wrong minute" },
    });

    const trip = w.db.trips.find((t) => t.id === tripId)!;
    // The run now reads the corrected value...
    expect(trip.stopLogs.find((log) => log.stopId === stops[1])!.actualTime).toBe("06:18");
    // ...and the change is its own record, with the value it replaced.
    expect(trip.corrections).toHaveLength(1);
    expect(trip.corrections[0]).toMatchObject({
      field: "stop_time",
      stopId: stops[1],
      passengerId: null,
      previousValue: "06:20",
      newValue: "06:18",
      reason: "Driver wrote the wrong minute",
      correctedBy: "Ops",
    });
    expect(result.ok && result.message).toMatch(/corrected to 06:18/);
    // The audit log says so too, and names no rider.
    const entry = w.db.audit.find((row) => row.action === "trips:correct")!;
    expect(entry.summary).toMatch(/corrected from 06:20 to 06:18/);
  });

  it("feeds the corrected time into the on-time judgement instead of leaving it stale", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = runTrip(w, routeId, "2026-06-02", ["06:20", "06:20", "06:20"]);
    const stops = w.db.routes.find((r) => r.id === routeId)!.stops.map((s) => s.id);
    // 06:20 against a 06:00 stop is 20 minutes late with a 5-minute threshold: not on time.
    const before = onTimeReport(w.db, "2026-06-02", "2026-06-02");
    expect(before.onTime).toBe(0);
    expect(before.timed).toBe(1);

    step(w, "ops", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[0], newValue: "06:02", reason: "Watch was wrong" },
    });
    const after = onTimeReport(w.db, "2026-06-02", "2026-06-02");
    expect(after.onTime).toBe(1);
    // The threshold that judged the run is still the one in force when it was completed.
    expect(w.db.trips.find((t) => t.id === tripId)!.onTimeThresholdMinutes).toBe(5);
  });

  it("corrects a boarding outcome, changes the count, and never names the rider in the log", () => {
    const w = build();
    const routeId = createRoute(w);
    const stops = w.db.routes.find((r) => r.id === routeId)!.stops.map((s) => s.id);
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { routeId, stopId: stops[0] }) });
    const passengerId = w.db.passengers[0].id;
    // The run has to be worked on the day the test is "now", or the start guard refuses it.
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    step(w, "ops", { type: "start_trip", id: tripId });
    step(w, "ops", { type: "record_trip_stop", id: tripId, input: { stopId: stops[0], actualTime: "06:04", boardings: [{ passengerId, outcome: "no_show" }] } });

    step(w, "ops", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "boarding_outcome", stopId: stops[0], passengerId, newValue: "boarded", reason: "Rider produced his badge after the run was logged" },
    });

    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.boardings.find((b) => b.passengerId === passengerId)!.outcome).toBe("boarded");
    expect(trip.corrections[0]).toMatchObject({ field: "boarding_outcome", passengerId, previousValue: "no_show", newValue: "boarded" });
    const entry = w.db.audit.find((row) => row.action === "trips:correct")!;
    expect(entry.summary).toMatch(/boarding outcome at Estate gate corrected/);
    expect(entry.summary).not.toMatch(/Ama/);
  });

  it("refuses a correction that would break the order of the run", () => {
    const w = build();
    const { tripId, stops } = completedRun(w);
    // Stop 2 cannot move before stop 1 at 06:05.
    const backwards = attempt(w, "ops", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[1], newValue: "05:50", reason: "typo" },
    });
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.errors.newValue).toMatch(/earlier than/);
    // Nor after stop 3 at 06:35.
    const forwards = attempt(w, "ops", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[1], newValue: "06:40", reason: "typo" },
    });
    expect(forwards.ok).toBe(false);
    if (!forwards.ok) expect(forwards.errors.newValue).toMatch(/later than/);
    // Nothing was written by either refusal.
    expect(w.db.trips.find((t) => t.id === tripId)!.corrections).toHaveLength(0);
  });

  it("needs a reason, a real change and a recorded value", () => {
    const w = build();
    const { tripId, stops } = completedRun(w);
    const correct = (input: Record<string, unknown>) => attempt(w, "ops", { type: "correct_trip_record", id: tripId, input: input as never });

    const noReason = correct({ field: "stop_time", stopId: stops[0], newValue: "06:01", reason: "" });
    expect(errorsOf(noReason).reason).toMatch(/why/);

    const unchanged = correct({ field: "stop_time", stopId: stops[0], newValue: "06:05", reason: "checked" });
    expect(errorsOf(unchanged).newValue).toMatch(/already recorded/);

    const badTime = correct({ field: "stop_time", stopId: stops[0], newValue: "6.05 am", reason: "checked" });
    expect(errorsOf(badTime).newValue).toMatch(/HH:MM/);

    const notRecorded = correct({ field: "stop_time", stopId: "nope", newValue: "06:01", reason: "checked" });
    expect(errorsOf(notRecorded).stopId).toMatch(/not on this route/);

    const noRecord = correct({ field: "boarding_outcome", stopId: stops[0], passengerId: "", newValue: "boarded", reason: "checked" });
    expect(errorsOf(noRecord).passengerId).toMatch(/Choose the rider/);
  });

  it("is closed to the driver who recorded the run, and to finance", () => {
    const w = build();
    const { tripId, stops } = completedRun(w);
    const asDriver = attempt(w, "driver", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[0], newValue: "06:01", reason: "I was actually early" },
    });
    expect(asDriver.ok).toBe(false);
    if (!asDriver.ok) expect(asDriver.message).toMatch(/trips:correct/);

    const asFinance = attempt(w, "finance", {
      type: "correct_trip_record",
      id: tripId,
      input: { field: "stop_time", stopId: stops[0], newValue: "06:01", reason: "tidy up" },
    });
    expect(asFinance.ok).toBe(false);
  });

  it("keeps every correction, so a repeatedly corrected run is visible", () => {
    const w = build();
    const { tripId, stops } = completedRun(w);
    for (const time of ["06:06", "06:07", "06:08"]) {
      step(w, "ops", {
        type: "correct_trip_record",
        id: tripId,
        input: { field: "stop_time", stopId: stops[0], newValue: time, reason: "driver called in the real time" },
      });
    }
    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.corrections.map((c) => c.newValue)).toEqual(["06:06", "06:07", "06:08"]);
    expect(trip.corrections.map((c) => c.previousValue)).toEqual(["06:05", "06:06", "06:07"]);
    expect(w.db.audit.filter((row) => row.action === "trips:correct")).toHaveLength(3);
  });
});

describe("stopping a run that has already started (Q-47, D-75)", () => {
  /** A run on today's service date, started, with its first stop recorded and one rider aboard. */
  function runningRun(w: World) {
    const routeId = createRoute(w);
    const stops = w.db.routes.find((r) => r.id === routeId)!.stops.map((s) => s.id);
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { routeId, stopId: stops[0] }) });
    step(w, "ops", { type: "create_passenger", input: passengerInput(w, { routeId, stopId: stops[1], fullName: "Efua Mensah", employeeRef: "E-002" }) });
    const tripId = generate(w, routeId, "2026-06-01");
    step(w, "ops", { type: "assign_trip", id: tripId, input: { vehicleId: w.db.vehicles[0].id, driverId: w.db.drivers[0].id } });
    step(w, "ops", { type: "dispatch_trip", id: tripId });
    step(w, "ops", { type: "start_trip", id: tripId });
    step(w, "ops", {
      type: "record_trip_stop",
      id: tripId,
      input: { stopId: stops[0], actualTime: "06:04", boardings: [{ passengerId: w.db.passengers[0].id, outcome: "boarded" }] },
    });
    return { tripId, stops, vehicleId: w.db.vehicles[0].id };
  }

  it("lets operations stop a run mid-way, keeping the stops and the outcomes already recorded", () => {
    const w = build();
    const { tripId } = runningRun(w);
    const result = step(w, "ops", { type: "cancel_trip", id: tripId, reason: "Driver taken ill at the second pick-up" });

    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.status).toBe("cancelled");
    expect(trip.cancelReason).toBe("Driver taken ill at the second pick-up");
    expect(trip.cancelledBy).toBe("Ops");
    expect(trip.cancelledAt).toBe(NOW);
    // The evidence of the part of the run that happened is untouched.
    expect(trip.stopLogs).toHaveLength(1);
    expect(trip.boardings[0].outcome).toBe("boarded");
    expect(result.ok && result.message).toMatch(/Stopped after 1 stop\(s\) were recorded/);
    expect(result.ok && result.message).toMatch(/1 rider outcome\(s\) kept; 1 without an outcome/);
  });

  it("insists the finished run is completed, not cancelled", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = runTrip(w, routeId, "2026-06-02", ["06:05", "06:20", "06:35"]);
    const result = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Tidy up" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/completed trip cannot be cancelled/);
  });

  it("refuses to stop a run while an unresolved breakdown sits on its vehicle, until it is linked", () => {
    const w = build();
    const { tripId, vehicleId } = runningRun(w);
    step(w, "ops", {
      type: "create_incident",
      input: {
        type: "breakdown",
        severity: "high",
        vehicleId,
        tripId,
        reportedDate: "2026-06-01",
        description: "Gearbox failed on the hill",
        assignedTo: "",
        takeVehicleOutOfService: true,
      },
    });
    const incidentId = w.db.incidents[0].id;

    const unlinked = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Breakdown" });
    expect(unlinked.ok).toBe(false);
    if (!unlinked.ok) {
      expect(unlinked.message).toMatch(/IN-0001 is recorded against this run/);
      expect(unlinked.errors.incidentId).toMatch(/IN-0001/);
    }
    // Nothing was written while the records disagreed.
    expect(w.db.trips.find((t) => t.id === tripId)!.status).toBe("in_progress");

    const linked = step(w, "ops", { type: "cancel_trip", id: tripId, reason: "Breakdown", incidentId });
    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.status).toBe("cancelled");
    expect(trip.incidentId).toBe(incidentId);
    expect(linked.ok && linked.message).toMatch(/linked to IN-0001/);
    // The audit entry ties the two references together.
    const entry = w.db.audit.filter((row) => row.action === "trips:cancel").pop()!;
    expect(entry.summary).toMatch(/TR-0001 cancelled \(IN-0001\)/);
  });

  it("refuses an incident that is about something else, or already resolved", () => {
    const w = build();
    const { tripId } = runningRun(w);
    step(w, "ops", {
      type: "create_incident",
      input: {
        type: "breakdown",
        severity: "high",
        vehicleId: w.db.vehicles[1].id,
        tripId: "",
        reportedDate: "2026-06-01",
        description: "Other bus",
        assignedTo: "",
        takeVehicleOutOfService: false,
      },
    });
    const otherIncident = w.db.incidents[0].id;
    const wrong = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Breakdown", incidentId: otherIncident });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toMatch(/not about this run or its vehicle/);

    const missing = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Breakdown", incidentId: "nope" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/not found/);
  });

  it("keeps the simple case simple: a planned run still cancels with just a reason", () => {
    const w = build();
    const routeId = createRoute(w);
    const tripId = generate(w, routeId, "2026-06-03");
    step(w, "ops", { type: "cancel_trip", id: tripId, reason: "Public holiday" });
    const trip = w.db.trips.find((t) => t.id === tripId)!;
    expect(trip.status).toBe("cancelled");
    expect(trip.cancelledAt).toBe(NOW);
    expect(trip.incidentId).toBeNull();
  });

  it("is closed to the driver whose run it is", () => {
    const w = build();
    const { tripId } = runningRun(w);
    const asDriver = attempt(w, "driver", { type: "cancel_trip", id: tripId, reason: "I could not finish" });
    expect(asDriver.ok).toBe(false);
    if (!asDriver.ok) expect(asDriver.message).toMatch(/trips:cancel/);
  });

  it("cannot be cancelled twice", () => {
    const w = build();
    const { tripId } = runningRun(w);
    step(w, "ops", { type: "cancel_trip", id: tripId, reason: "Breakdown" });
    const again = attempt(w, "ops", { type: "cancel_trip", id: tripId, reason: "Once more" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/cancelled/);
  });
});
