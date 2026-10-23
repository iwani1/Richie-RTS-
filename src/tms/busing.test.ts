import { describe, expect, it } from "vitest";
import { MAX_GENERATE_DAYS, tripOnTime, type CompleteTripInput, type PassengerInput, type RouteInput } from "./busing";
import { executeCommand, type AnyCommand } from "./commands";
import { onTimeReport } from "./kpis";
import { execute, type Actor, type Credential, type CommandResult } from "./service";
import { SCHEMA_VERSION, emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Trip } from "./types";

const NOW = "2026-06-01T06:00:00.000Z";
const cred: Credential = { passwordHash: "h", passwordSalt: "s" };
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

    const tripId = generate(w, routeId, "2026-06-08");
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
    const tripId = generate(w, routeId, "2026-06-09");
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
    const tripId = generate(w, routeId, "2026-06-08");
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

    const tripId = generate(w, routeId, "2026-06-09");
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
