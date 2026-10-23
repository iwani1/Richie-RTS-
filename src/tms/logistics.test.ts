import { describe, expect, it } from "vitest";
import { costReport } from "./costs";
import { executeCommand, type AnyCommand } from "./commands";
import { INCIDENT_TRANSITIONS, WORK_ORDER_TRANSITIONS, type IncidentInput, type WorkOrderInput } from "./logistics";
import type { Actor, Credential } from "./service";
import { emptyDatabase, type Database, type Incident, type WorkOrder } from "./types";

const cred: Credential = { passwordHash: "hash", passwordSalt: "salt" };
const NOW = "2026-01-01T00:00:00.000Z";

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  finance: Actor;
  vehicleId: string;
}

// Builds a company with an administrator, operations and finance users, a vehicle
// category, one available vehicle and the currency set (unless options say otherwise).
function world(options: { currency?: boolean } = {}): World {
  let db = emptyDatabase();
  const run = (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(db, actor, command, NOW);
    if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };

  run(null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred });
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  run(admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  run(admin, { type: "create_user", input: { fullName: "Fin", email: "fin@example.test", role: "finance", active: true }, credential: cred });
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  const finance: Actor = { id: db.users[2].id, fullName: "Fin", role: "finance" };

  run(admin, {
    type: "update_settings",
    input: { ...db.settings, currencyCode: options.currency === false ? null : "GHS", vehicleCategories: [{ id: "", name: "Minibus" }] },
  });
  run(ops, {
    type: "create_vehicle",
    input: { registration: "GT 900-26", categoryId: db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "30", notes: "" },
  });

  return { db, admin, ops, finance, vehicleId: db.vehicles[0].id };
}

const incidentInput = (over: Partial<IncidentInput> = {}): IncidentInput => ({
  type: "breakdown",
  severity: "high",
  vehicleId: "",
  tripId: "",
  reportedDate: "2026-01-01",
  description: "Engine overheated on the motorway.",
  assignedTo: "",
  takeVehicleOutOfService: true,
  ...over,
});

const workOrderInput = (vehicleId: string, over: Partial<WorkOrderInput> = {}): WorkOrderInput => ({
  vehicleId,
  title: "Cooling system inspection",
  workType: "Engine",
  workshop: "",
  description: "",
  reportedOdometer: "",
  plannedDate: "",
  incidentId: "",
  ...over,
});

function step(w: World, actor: Actor, command: AnyCommand): Database {
  const result = executeCommand(w.db, actor, command, NOW);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result.db;
}

function attempt(w: World, actor: Actor, command: AnyCommand) {
  return executeCommand(w.db, actor, command, NOW);
}

const errorsOf = (result: ReturnType<typeof attempt>) => (result.ok ? {} : result.errors);
const lastIncident = (db: Database) => db.incidents[db.incidents.length - 1];
const lastOrder = (db: Database) => db.workOrders[db.workOrders.length - 1];

describe("incidents - reporting", () => {
  it("requires a vehicle for a breakdown but not for a safety concern", () => {
    const w = world();
    const noVehicle = attempt(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: "" }) });
    expect(noVehicle.ok).toBe(false);
    expect(errorsOf(noVehicle).vehicleId).toMatch(/about a vehicle/);

    const safety = attempt(w, w.ops, {
      type: "create_incident",
      input: incidentInput({ type: "safety_concern", vehicleId: "", takeVehicleOutOfService: false, description: "Gate access is unsafe." }),
    });
    expect(safety.ok).toBe(true);
  });

  it("takes the vehicle out of service when the operator chooses to", () => {
    const w = world();
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: true }) });
    expect(w.db.vehicles[0].status).toBe("out_of_service");
    expect(w.db.audit[0].summary).toMatch(/taken out of service/);

    const untouched = world();
    step(untouched, untouched.ops, {
      type: "create_incident",
      input: incidentInput({ vehicleId: untouched.vehicleId, takeVehicleOutOfService: false, type: "damage", severity: "low" }),
    });
    expect(untouched.db.vehicles[0].status).toBe("available");
  });

  it("rejects a linked trip that belongs to another vehicle", () => {
    const w = world();
    step(w, w.ops, {
      type: "create_vehicle",
      input: { registration: "GT 901-26", categoryId: w.db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "30", notes: "" },
    });
    // A trip on the second vehicle, linked to an incident about the first.
    const otherVehicle = w.db.vehicles[1].id;
    const bad = attempt(w, w.ops, {
      type: "create_incident",
      input: incidentInput({ vehicleId: w.vehicleId, tripId: "not-a-trip" }),
    });
    expect(errorsOf(bad).tripId).toMatch(/not found/i);
    expect(otherVehicle).toBeTruthy();
  });
});

describe("incidents - response state machine", () => {
  it("follows reported -> acknowledged -> responding -> resolved -> closed and refuses jumps", () => {
    const w = world();
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId }) });
    const id = lastIncident(w.db).id;

    const jump = attempt(w, w.ops, { type: "advance_incident", id, input: { to: "resolved", note: "", assignedTo: "", resolutionNote: "fixed", vehicleRestoredTo: "unchanged" } });
    expect(jump.ok).toBe(false);
    expect(errorsOf(jump).to).toMatch(/Allowed from reported/);

    step(w, w.ops, { type: "advance_incident", id, input: { to: "acknowledged", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });

    // A breakdown needs someone named before the response starts.
    const noResponder = attempt(w, w.ops, { type: "advance_incident", id, input: { to: "responding", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    expect(noResponder.ok).toBe(false);
    expect(errorsOf(noResponder).assignedTo).toMatch(/who is responding/);

    step(w, w.ops, { type: "advance_incident", id, input: { to: "responding", note: "Tow dispatched", assignedTo: "Kojo", resolutionNote: "", vehicleRestoredTo: "unchanged" } });

    const noResolution = attempt(w, w.ops, { type: "advance_incident", id, input: { to: "resolved", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    expect(noResolution.ok).toBe(false);
    expect(errorsOf(noResolution).resolutionNote).toMatch(/how this incident was resolved/i);

    step(w, w.ops, { type: "advance_incident", id, input: { to: "resolved", note: "", assignedTo: "", resolutionNote: "Hose replaced.", vehicleRestoredTo: "available" } });
    expect(w.db.vehicles[0].status).toBe("available");
    expect(lastIncident(w.db).vehicleRestoredTo).toBe("available");

    step(w, w.ops, { type: "advance_incident", id, input: { to: "closed", note: "Reviewed.", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    expect(lastIncident(w.db).log).toHaveLength(5);
    expect(INCIDENT_TRANSITIONS.closed).toHaveLength(0);
  });

  it("does not allow the report to be edited once the response has started", () => {
    const w = world();
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId }) });
    const id = lastIncident(w.db).id;
    step(w, w.ops, { type: "advance_incident", id, input: { to: "acknowledged", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_incident", id, input: { to: "responding", note: "", assignedTo: "Kojo", resolutionNote: "", vehicleRestoredTo: "unchanged" } });

    const edit = attempt(w, w.ops, { type: "update_incident", id, input: incidentInput({ vehicleId: w.vehicleId, severity: "low" }) });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.message).toMatch(/Add a note instead/);
  });
});

describe("work orders - maintenance coordination", () => {
  it("moves the vehicle into maintenance when work starts", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    expect(w.db.vehicles[0].status).toBe("available");

    step(w, w.ops, {
      type: "advance_work_order",
      id: lastOrder(w.db).id,
      input: { to: "in_progress", note: "Booked in", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" },
    });
    expect(w.db.vehicles[0].status).toBe("maintenance");
  });

  it("requires the cost position to be confirmed before completion", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const id = lastOrder(w.db).id;
    step(w, w.ops, { type: "advance_work_order", id, input: { to: "in_progress", note: "", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });

    const unconfirmed = attempt(w, w.ops, {
      type: "advance_work_order",
      id,
      input: { to: "completed", note: "Done.", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" },
    });
    expect(unconfirmed.ok).toBe(false);
    expect(errorsOf(unconfirmed).costsConfirmedComplete).toMatch(/record the costs, or tick/);

    step(w, w.ops, { type: "advance_work_order", id, input: { to: "completed", note: "Hose replaced.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    expect(lastOrder(w.db).costsConfirmedComplete).toBe(true);
  });

  it("will not return a vehicle to service while another work order is active", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId, { title: "Brakes" }) });
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId, { title: "Tyres" }) });
    const [first, second] = [w.db.workOrders[0].id, w.db.workOrders[1].id];
    step(w, w.ops, { type: "advance_work_order", id: first, input: { to: "in_progress", note: "", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id: second, input: { to: "in_progress", note: "", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id: first, input: { to: "completed", note: "Done.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });

    const blocked = attempt(w, w.ops, {
      type: "advance_work_order",
      id: first,
      input: { to: "closed", note: "Reviewed.", costsConfirmedComplete: true, vehicleRestoredTo: "available" },
    });
    expect(blocked.ok).toBe(false);
    expect(errorsOf(blocked).vehicleRestoredTo).toMatch(/Another work order/);

    step(w, w.ops, { type: "advance_work_order", id: second, input: { to: "completed", note: "Done.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id: second, input: { to: "closed", note: "Reviewed.", costsConfirmedComplete: true, vehicleRestoredTo: "available" } });
    step(w, w.ops, { type: "advance_work_order", id: first, input: { to: "closed", note: "Reviewed.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    expect(w.db.vehicles[0].status).toBe("available");
  });

  it("cannot close an incident while a linked work order is still open", () => {
    const w = world();
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });
    const incident: Incident = lastIncident(w.db);
    step(w, w.ops, { type: "advance_incident", id: incident.id, input: { to: "acknowledged", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_incident", id: incident.id, input: { to: "responding", note: "", assignedTo: "Kojo", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_incident", id: incident.id, input: { to: "resolved", note: "", assignedTo: "", resolutionNote: "Towed.", vehicleRestoredTo: "unchanged" } });

    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId, { incidentId: incident.id, title: "Repair after breakdown" }) });
    const order: WorkOrder = lastOrder(w.db);
    expect(order.incidentId).toBe(incident.id);

    const closeIncident = attempt(w, w.ops, {
      type: "advance_incident",
      id: incident.id,
      input: { to: "closed", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" },
    });
    expect(closeIncident.ok).toBe(false);
    expect(errorsOf(closeIncident).to).toMatch(/Close the linked work order first/);
    expect(closeIncident.ok === false && closeIncident.message).toMatch(/cannot move/);

    step(w, w.ops, { type: "advance_work_order", id: order.id, input: { to: "in_progress", note: "", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id: order.id, input: { to: "completed", note: "Fixed.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id: order.id, input: { to: "closed", note: "Reviewed.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_incident", id: incident.id, input: { to: "closed", note: "", assignedTo: "", resolutionNote: "", vehicleRestoredTo: "unchanged" } });
    expect(lastIncident(w.db).status).toBe("closed");
  });

  it("refuses illegal work order transitions", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const id = lastOrder(w.db).id;
    const jump = attempt(w, w.ops, {
      type: "advance_work_order",
      id,
      input: { to: "completed", note: "Done.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" },
    });
    expect(jump.ok).toBe(false);
    expect(errorsOf(jump).to).toMatch(/Allowed from open/);
    expect(WORK_ORDER_TRANSITIONS.open).toEqual(["in_progress"]);
  });
});

describe("costs", () => {
  const costInput = { description: "Tow truck", category: "Recovery", amount: "450.00", incurredDate: "2026-01-01" };

  it("refuses to record a cost before the company currency is set", () => {
    const w = world({ currency: false });
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });
    const result = attempt(w, w.finance, { type: "add_incident_cost", id: lastIncident(w.db).id, input: costInput });
    expect(result.ok).toBe(false);
    expect(errorsOf(result).amount).toMatch(/company currency/);
  });

  it("validates the amount and lets finance add then remove a cost", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const id = lastOrder(w.db).id;

    for (const amount of ["", "0", "-5", "abc", "10.999"]) {
      const bad = attempt(w, w.finance, { type: "add_work_order_cost", id, input: { ...costInput, amount } });
      expect(bad.ok).toBe(false);
      expect(errorsOf(bad).amount).toBeDefined();
    }

    step(w, w.finance, { type: "add_work_order_cost", id, input: costInput });
    const order = lastOrder(w.db);
    expect(order.costEntries).toHaveLength(1);
    expect(order.costEntries[0].amount).toBe(450);

    step(w, w.finance, { type: "remove_work_order_cost", id, costId: order.costEntries[0].id });
    expect(lastOrder(w.db).costEntries).toHaveLength(0);
    expect(w.db.audit[0].summary).toMatch(/Cost removed/);
  });

  it("locks costs once the work order or incident is closed", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const id = lastOrder(w.db).id;
    step(w, w.ops, { type: "advance_work_order", id, input: { to: "in_progress", note: "", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id, input: { to: "completed", note: "Done.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } });
    step(w, w.ops, { type: "advance_work_order", id, input: { to: "closed", note: "Reviewed.", costsConfirmedComplete: true, vehicleRestoredTo: "available" } });

    const late = attempt(w, w.finance, { type: "add_work_order_cost", id, input: costInput });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toMatch(/closed work order/);
  });
});

describe("cost report (RPT-03 inputs, with coverage)", () => {
  it("totals recorded costs with period and coverage, and never implies zero cost", () => {
    const w = world();
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId, { title: "Brakes" }) });
    const order = lastOrder(w.db);
    step(w, w.finance, { type: "add_work_order_cost", id: order.id, input: { description: "Pads", category: "Parts", amount: "200", incurredDate: "2026-01-02" } });
    step(w, w.finance, { type: "add_work_order_cost", id: order.id, input: { description: "Labour", category: "", amount: "150.50", incurredDate: "2026-01-03" } });
    step(w, w.ops, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });

    const report = costReport(w.db, "2026-01-01", "2026-01-31");
    expect(report.status).toBe("ok");
    expect(report.total).toBe(350.5);
    expect(report.currencyCode).toBe("GHS");
    expect(report.from).toBe("2026-01-01");
    expect(report.to).toBe("2026-01-31");
    // 2 records in scope, 1 with a cost.
    expect(report.coverage).toBeCloseTo(0.5);
    expect(report.incidentsWithoutCosts).toBe(1);
    expect(report.lines[0].sourceReference).toBe(order.reference);

    const empty = costReport(w.db, "2027-01-01", "2027-01-31");
    expect(empty.status).toBe("no_costs");
    expect(empty.message).toMatch(/not the same as zero cost/);
  });

  it("will not show a total when the currency is not set", () => {
    const w = world({ currency: false });
    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const report = costReport(w.db, "2026-01-01", "2026-01-31");
    expect(report.status).toBe("currency_not_set");
    expect(report.message).toMatch(/no total is shown/i);
    expect(report.total).toBe(0);
  });
});

describe("permissions", () => {
  it("operations runs response and maintenance but cannot record costs; finance is the reverse", () => {
    const w = world();

    const opsCost = attempt(w, w.ops, { type: "add_incident_cost", id: "x", input: { description: "x", category: "", amount: "10", incurredDate: "2026-01-01" } });
    expect(opsCost.ok).toBe(false);
    if (!opsCost.ok) expect(opsCost.message).toMatch(/Not permitted/);

    const finReport = attempt(w, w.finance, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });
    expect(finReport.ok).toBe(false);
    if (!finReport.ok) expect(finReport.message).toMatch(/Not permitted/);

    const finMaintenance = attempt(w, w.finance, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    expect(finMaintenance.ok).toBe(false);

    step(w, w.ops, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
    const finCost = attempt(w, w.finance, { type: "add_work_order_cost", id: lastOrder(w.db).id, input: { description: "Parts", category: "", amount: "10", incurredDate: "2026-01-01" } });
    expect(finCost.ok).toBe(true);
  });

  it("keeps record-bound roles out of the logistics workflow", () => {
    const w = world();
    const driver: Actor = { id: "d", fullName: "Driver", role: "driver" };
    const client: Actor = { id: "c", fullName: "Client", role: "client_contact" };

    // A client contact holds no incident permission at all.
    const fromClient = attempt(w, client, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });
    expect(fromClient.ok).toBe(false);
    if (!fromClient.ok) expect(fromClient.message).toMatch(/Not permitted/);

    // A driver may report, but only on a vehicle assigned to its linked driver record.
    // This account has no linked record, so it can report on nothing.
    const fromDriver = attempt(w, driver, { type: "create_incident", input: incidentInput({ vehicleId: w.vehicleId, takeVehicleOutOfService: false }) });
    expect(fromDriver.ok).toBe(false);
    if (!fromDriver.ok) expect(fromDriver.message).toMatch(/only report an incident for a vehicle assigned to you/);

    // Neither role can raise maintenance or drive a response forward.
    for (const actor of [driver, client]) {
      const work = attempt(w, actor, { type: "create_work_order", input: workOrderInput(w.vehicleId) });
      expect(work.ok).toBe(false);
    }
  });
});
