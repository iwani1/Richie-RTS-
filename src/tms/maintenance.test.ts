import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import type { WorkOrderInput } from "./logistics";
import { lastServiceFor, latestOdometer, overdueServiceFor, readinessReport } from "./maintenance";
import type { Actor, Credential } from "./service";
import { emptyDatabase, migrate, SCHEMA_VERSION, type Database, type ServiceSchedule } from "./types";

const NOW = "2026-06-01T10:00:00.000Z";
const credential: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
// Readiness is evaluated at a fixed date so day maths is deterministic.
const AS_OF = "2026-09-15"; // 106 days after NOW's date

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  finance: Actor;
  categoryId: string;
  vehicleId: string;
}

function run(db: Database, actor: Actor | null, command: AnyCommand) {
  return executeCommand(db, actor, command, NOW);
}

function step(world: World, actor: Actor, command: AnyCommand) {
  const result = run(world.db, actor, command);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  world.db = result.db;
  return result;
}

function attempt(world: World, actor: Actor, command: AnyCommand) {
  return run(world.db, actor, command);
}

const errorsOf = (result: ReturnType<typeof attempt>) => (result.ok ? {} : result.errors);

function build(options: { secondVehicle?: boolean } = {}): World {
  let db = emptyDatabase();
  let result = run(db, null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential });
  if (!result.ok) throw new Error(result.message);
  db = result.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };

  result = run(db, admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential });
  if (!result.ok) throw new Error(result.message);
  db = result.db;
  result = run(db, admin, { type: "create_user", input: { fullName: "Fin", email: "fin@example.test", role: "finance", active: true }, credential });
  if (!result.ok) throw new Error(result.message);
  db = result.db;

  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  const finance: Actor = { id: db.users[2].id, fullName: "Fin", role: "finance" };

  result = run(db, admin, {
    type: "update_settings",
    input: { ...db.settings, vehicleCategories: [{ id: "", name: "Coach", licenceClasses: [] }], maintenance: { blockOnOverdueService: false, schedules: [] } },
  });
  if (!result.ok) throw new Error(result.message);
  db = result.db;

  result = run(db, ops, { type: "create_vehicle", input: { registration: "GT 1-26", categoryId: db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "30", notes: "" } });
  if (!result.ok) throw new Error(result.message);
  db = result.db;
  if (options.secondVehicle) {
    result = run(db, ops, { type: "create_vehicle", input: { registration: "GT 2-26", categoryId: db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "30", notes: "" } });
    if (!result.ok) throw new Error(result.message);
    db = result.db;
  }

  return { db, admin, ops, finance, categoryId: db.settings.vehicleCategories[0].id, vehicleId: db.vehicles[0].id };
}

const schedule = (categoryId: string, values: Partial<ServiceSchedule> = {}): ServiceSchedule => ({
  categoryId,
  intervalKm: null,
  intervalDays: null,
  remindLeadKm: null,
  remindLeadDays: null,
  ...values,
});

function setSchedules(world: World, schedules: ServiceSchedule[]) {
  step(world, world.admin, { type: "update_settings", input: { ...world.db.settings, maintenance: { blockOnOverdueService: false, schedules } } });
}

function workOrder(vehicleId: string, over: Partial<WorkOrderInput> = {}): WorkOrderInput {
  return {
    vehicleId,
    title: "Major service",
    workType: "Service",
    workshop: "",
    description: "",
    reportedOdometer: "120000",
    plannedDate: "",
    incidentId: "",
    resetsServiceInterval: true,
    ...over,
  };
}

// Raises a work order and walks it to completed (the only point at which it can count as a service).
function completeWorkOrder(world: World, vehicleId: string, over: Partial<WorkOrderInput> = {}) {
  step(world, world.ops, { type: "create_work_order", input: workOrder(vehicleId, over) });
  const id = world.db.workOrders[world.db.workOrders.length - 1].id;
  step(world, world.ops, { type: "advance_work_order", id, input: { to: "in_progress", note: "Booked in", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
  step(world, world.ops, { type: "advance_work_order", id, input: { to: "completed", note: "Filters, oil and inspection", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
  return id;
}

function recordReading(world: World, vehicleId: string, km: string, date = "2026-06-15") {
  step(world, world.ops, { type: "record_odometer", input: { vehicleId, readingKm: km, readingDate: date, note: "" } });
  return world.db.odometerReadings[world.db.odometerReadings.length - 1].id;
}

describe("service schedule settings", () => {
  it("requires at least one interval basis and a known, unique category", () => {
    const world = build();
    const empty = attempt(world, world.admin, { type: "update_settings", input: { ...world.db.settings, maintenance: { blockOnOverdueService: false, schedules: [schedule(world.categoryId)] } } });
    expect(empty.ok).toBe(false);
    expect(errorsOf(empty)["maintenance.schedules.0"]).toMatch(/km interval, a day interval/);

    const unknown = attempt(world, world.admin, { type: "update_settings", input: { ...world.db.settings, maintenance: { blockOnOverdueService: false, schedules: [schedule("missing", { intervalDays: 90 })] } } });
    expect(errorsOf(unknown)["maintenance.schedules.0"]).toMatch(/category not found/i);

    const duplicate = attempt(world, world.admin, { type: "update_settings", input: { ...world.db.settings, maintenance: { blockOnOverdueService: false, schedules: [schedule(world.categoryId, { intervalDays: 90 }), schedule(world.categoryId, { intervalDays: 60 })] } } });
    expect(errorsOf(duplicate)["maintenance.schedules.1"]).toMatch(/only one schedule/);

    const negative = attempt(world, world.admin, { type: "update_settings", input: { ...world.db.settings, maintenance: { blockOnOverdueService: false, schedules: [schedule(world.categoryId, { intervalDays: -1 })] } } });
    expect(errorsOf(negative)["maintenance.schedules.0"]).toMatch(/whole number/);
  });
});

describe("odometer readings", () => {
  it("records readings and refuses a lower value", () => {
    const world = build();
    step(world, world.ops, { type: "record_odometer", input: { vehicleId: world.vehicleId, readingKm: "120500", readingDate: "2026-06-15", note: "Fuel stop" } });
    expect(latestOdometer(world.db, world.vehicleId)?.readingKm).toBe(120500);

    const backwards = attempt(world, world.ops, { type: "record_odometer", input: { vehicleId: world.vehicleId, readingKm: "120100", readingDate: "2026-06-20", note: "" } });
    expect(backwards.ok).toBe(false);
    expect(errorsOf(backwards).readingKm).toMatch(/cannot go backwards/);
  });

  it("rejects bad values and retired vehicles", () => {
    const world = build();
    const bad = attempt(world, world.ops, { type: "record_odometer", input: { vehicleId: world.vehicleId, readingKm: "12.5", readingDate: "not-a-date", note: "" } });
    expect(bad.ok).toBe(false);
    expect(errorsOf(bad).readingKm).toBeDefined();
    expect(errorsOf(bad).readingDate).toBeDefined();

    step(world, world.ops, { type: "transition_vehicle", id: world.vehicleId, to: "retired", reason: "Disposed" });
    const retired = attempt(world, world.ops, { type: "record_odometer", input: { vehicleId: world.vehicleId, readingKm: "999", readingDate: "2026-06-20", note: "" } });
    expect(retired.ok).toBe(false);
    expect(errorsOf(retired).vehicleId).toMatch(/retired/);
  });

  it("voids a reading with a reason and drops it from calculations", () => {
    const world = build();
    recordReading(world, world.vehicleId, "120500");
    const wrong = recordReading(world, world.vehicleId, "130000", "2026-06-20");
    expect(latestOdometer(world.db, world.vehicleId)?.readingKm).toBe(130000);

    const noReason = attempt(world, world.ops, { type: "void_odometer", id: wrong, reason: "" });
    expect(noReason.ok).toBe(false);
    step(world, world.ops, { type: "void_odometer", id: wrong, reason: "Entered a trip meter reading" });
    expect(latestOdometer(world.db, world.vehicleId)?.readingKm).toBe(120500);
    expect(world.db.audit.some((entry) => entry.action === "fleet:odometer_void")).toBe(true);
  });

  it("denies finance odometer recording", () => {
    const world = build();
    const denied = attempt(world, world.finance, { type: "record_odometer", input: { vehicleId: world.vehicleId, readingKm: "1", readingDate: "2026-06-15", note: "" } });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toMatch(/Not permitted/);
  });
});

describe("work orders as services", () => {
  it("requires an odometer for a km-tracked category when marked as a service", () => {
    const world = build();
    setSchedules(world, [schedule(world.categoryId, { intervalKm: 10000 })]);
    const missing = attempt(world, world.ops, { type: "create_work_order", input: workOrder(world.vehicleId, { reportedOdometer: "" }) });
    expect(missing.ok).toBe(false);
    expect(errorsOf(missing).resetsServiceInterval).toMatch(/tracked by kilometres/);

    // A non-service work order needs no odometer.
    const plain = attempt(world, world.ops, { type: "create_work_order", input: workOrder(world.vehicleId, { resetsServiceInterval: false, reportedOdometer: "" }) });
    expect(plain.ok).toBe(true);
  });

  it("records the completion time and only completed work counts as a service", () => {
    const world = build();
    const id = completeWorkOrder(world, world.vehicleId);
    const anchor = lastServiceFor(world.db, world.vehicleId);
    expect(anchor?.workOrderReference).toBe(world.db.workOrders.find((order) => order.id === id)?.reference);
    expect(anchor?.serviceDate).toBe(NOW.slice(0, 10));
    expect(anchor?.odometerKm).toBe(120000);
  });
});

describe("readiness report", () => {
  it("reports not_configured when no schedules exist", () => {
    const world = build();
    const report = readinessReport(world.db, AS_OF);
    expect(report.status).toBe("not_configured");
    expect(report.coverage).toBeNull();
    expect(report.counts.no_schedule).toBe(1);
    expect(report.vehicles[0].reasons[0]).toMatch(/No service schedule/);
  });

  it("reports insufficient data until a service exists, then day and km bases", () => {
    const world = build();
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 90, remindLeadDays: 10, intervalKm: 1000, remindLeadKm: 200 })]);

    const noService = readinessReport(world.db, AS_OF);
    expect(noService.status).toBe("ok"); // schedule configured, so coverage is measurable
    expect(noService.counts.no_data).toBe(1);
    expect(noService.coverage).toBe(0);
    expect(noService.vehicles[0].reasons[0]).toMatch(/No service has been recorded/);

    completeWorkOrder(world, world.vehicleId);
    recordReading(world, world.vehicleId, "120500");

    const withService = readinessReport(world.db, AS_OF);
    expect(withService.counts.overdue).toBe(1); // 106 days of a 90 day interval
    expect(withService.coverage).toBe(1);
    const row = withService.vehicles[0];
    expect(row.bases.map((basis) => basis.basis).sort()).toEqual(["days", "km"]);
    expect(row.bases.find((basis) => basis.basis === "days")?.consumed).toBe(106);
    expect(row.bases.find((basis) => basis.basis === "km")?.consumed).toBe(500);
  });

  it("warns before the interval when the lead time is set", () => {
    const world = build();
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 100, remindLeadDays: 60 })]);
    completeWorkOrder(world, world.vehicleId);
    // 60 days elapsed, warn 60 days before -> due soon.
    const due = readinessReport(world.db, "2026-07-31");
    expect(due.vehicles[0].status).toBe("due");
    const ok = readinessReport(world.db, "2026-06-20");
    expect(ok.vehicles[0].status).toBe("ok");
  });

  it("flags a service recorded without an odometer for a km-tracked category", () => {
    const world = build();
    // The service is recorded while the category is date-only, so no odometer is required.
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 90 })]);
    completeWorkOrder(world, world.vehicleId, { reportedOdometer: "" });
    // Management then starts tracking by km; the older service has no reading to work from.
    setSchedules(world, [schedule(world.categoryId, { intervalKm: 5000 })]);
    const report = readinessReport(world.db, AS_OF);
    expect(report.counts.no_data).toBe(1);
    expect(report.coverage).toBe(0);
    expect(report.vehicles[0].reasons[0]).toMatch(/without an odometer/);
  });

  it("excludes retired vehicles from coverage", () => {
    const world = build({ secondVehicle: true });
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 90 })]);
    const second = world.db.vehicles[1].id;
    step(world, world.ops, { type: "transition_vehicle", id: second, to: "retired", reason: "Disposed" });
    const report = readinessReport(world.db, AS_OF);
    expect(report.total).toBe(1);
    expect(report.vehicles).toHaveLength(1);
  });

  it("reports no_vehicles rather than a meaningless percentage", () => {
    const world = build({ secondVehicle: true });
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 90 })]);
    step(world, world.ops, { type: "transition_vehicle", id: world.vehicleId, to: "retired", reason: "Disposed" });
    step(world, world.ops, { type: "transition_vehicle", id: world.db.vehicles[1].id, to: "retired", reason: "Disposed" });
    const report = readinessReport(world.db, AS_OF);
    expect(report.status).toBe("no_vehicles");
    expect(report.coverage).toBeNull();
  });
});

describe("migration", () => {
  it("upgrades schema 6 without inventing services for legacy work orders", () => {
    const world = build();
    const legacy: Record<string, unknown> = {
      ...world.db,
      schemaVersion: 6,
      odometerReadings: undefined,
      settings: { ...world.db.settings, maintenance: undefined },
      workOrders: [
        { id: "wo-1", vehicleId: world.vehicleId, reference: "WO-0001", status: "completed", reportedOdometer: 111000, updatedAt: NOW, createdAt: NOW },
      ],
    };
    const migrated = migrate(legacy);
    if (!migrated) throw new Error("migration failed");
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.odometerReadings).toEqual([]);
    expect(migrated.settings.maintenance.schedules).toEqual([]);
    expect(migrated.workOrders[0].resetsServiceInterval).toBe(false);
    expect(migrated.workOrders[0].completedAt).toBeNull();
    expect(lastServiceFor(migrated, world.vehicleId)).toBeNull();
  });
});

describe("an overdue routine service, said in one sentence (Q-43, D-80)", () => {
  it("says nothing while the vehicle is inside its interval, or when no schedule exists", () => {
    const world = build();
    // No schedule at all: "we never set an interval" is not "this service is overdue".
    expect(overdueServiceFor(world.db, world.vehicleId, AS_OF)).toBeNull();

    setSchedules(world, [schedule(world.categoryId, { intervalDays: 30 })]);
    completeWorkOrder(world, world.vehicleId);
    // 19 days after the service, inside a 30 day interval.
    expect(overdueServiceFor(world.db, world.vehicleId, "2026-06-20")).toBeNull();
  });

  it("names the vehicle, how far past the interval it is, and when it was last serviced", () => {
    const world = build();
    setSchedules(world, [schedule(world.categoryId, { intervalDays: 30 })]);
    completeWorkOrder(world, world.vehicleId);
    const asOf = "2026-09-15";
    // Readiness measures days remaining until the next service; negative means past the due date.
    const row = readinessReport(world.db, asOf).vehicles.find((v) => v.vehicleId === world.vehicleId)!;
    expect(row.status).toBe("overdue");
    const days = Math.abs(row.bases[0].remaining);
    expect(overdueServiceFor(world.db, world.vehicleId, asOf)).toBe(
      `Vehicle GT 1-26 is overdue for routine service (${days} days past the 30 day interval). Last service: ${lastServiceFor(world.db, world.vehicleId)!.serviceDate}.`,
    );
  });

  it("reads the kilometres basis the same way", () => {
    const world = build();
    setSchedules(world, [schedule(world.categoryId, { intervalKm: 10000 })]);
    completeWorkOrder(world, world.vehicleId, { reportedOdometer: "120000" });
    recordReading(world, world.vehicleId, "135000");
    const sentence = overdueServiceFor(world.db, world.vehicleId, AS_OF);
    expect(sentence).toMatch(/^Vehicle GT 1-26 is overdue for routine service \(5,000 km past the 10,000 km interval\)\. Last service: \d{4}-\d{2}-\d{2}\.$/);
  });
});
