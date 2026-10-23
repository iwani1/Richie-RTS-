// Staff logistics: breakdown/incident response, maintenance work orders, and recorded costs.
// Like every other module this is pure and synchronous. Each command checks permission,
// validates input, enforces its state machine, then returns a new immutable Database with
// an audit entry. Nothing mutates the input database.

import {
  audit,
  authorise,
  fail,
  isValidDate,
  makeId,
  VEHICLE_TRANSITIONS,
  type Actor,
  type CommandResult,
  type Errors,
} from "./service";
import { actorLink, mayReportOnVehicle } from "./scope";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type CostEntry,
  type Database,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  type LogEntry,
  type VehicleRestoration,
  type WorkOrder,
  type WorkOrderStatus,
} from "./types";

export const LOGISTICS_COMMAND_TYPES = [
  "create_incident",
  "update_incident",
  "advance_incident",
  "add_incident_cost",
  "remove_incident_cost",
  "create_work_order",
  "update_work_order",
  "advance_work_order",
  "add_work_order_cost",
  "remove_work_order_cost",
] as const;

export interface IncidentInput {
  type: IncidentType;
  severity: IncidentSeverity;
  vehicleId: string;
  tripId: string;
  reportedDate: string;
  description: string;
  assignedTo: string;
  takeVehicleOutOfService: boolean;
}

export interface IncidentAdvanceInput {
  to: IncidentStatus;
  note: string;
  assignedTo: string;
  resolutionNote: string;
  vehicleRestoredTo: VehicleRestoration;
}

export interface WorkOrderInput {
  vehicleId: string;
  title: string;
  workType: string;
  workshop: string;
  description: string;
  reportedOdometer: string;
  plannedDate: string;
  incidentId: string;
  // Does this work count as a service? Operator decision; the system never infers it.
  resetsServiceInterval?: boolean;
}

export interface WorkOrderAdvanceInput {
  to: WorkOrderStatus;
  note: string;
  costsConfirmedComplete: boolean;
  vehicleRestoredTo: VehicleRestoration;
}

export interface CostInput {
  description: string;
  category: string;
  amount: string;
  incurredDate: string;
}

export type LogisticsCommand =
  | { type: "create_incident"; input: IncidentInput }
  | { type: "update_incident"; id: string; input: IncidentInput }
  | { type: "advance_incident"; id: string; input: IncidentAdvanceInput }
  | { type: "add_incident_cost"; id: string; input: CostInput }
  | { type: "remove_incident_cost"; id: string; costId: string }
  | { type: "create_work_order"; input: WorkOrderInput }
  | { type: "update_work_order"; id: string; input: WorkOrderInput }
  | { type: "advance_work_order"; id: string; input: WorkOrderAdvanceInput }
  | { type: "add_work_order_cost"; id: string; input: CostInput }
  | { type: "remove_work_order_cost"; id: string; costId: string };

export function isLogisticsCommand(command: { type: string }): command is LogisticsCommand {
  return (LOGISTICS_COMMAND_TYPES as readonly string[]).includes(command.type);
}

// ---------- state machines ----------

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  reported: ["acknowledged"],
  acknowledged: ["responding"],
  responding: ["resolved"],
  resolved: ["closed"],
  closed: [],
};

// SM-06. completed and closed are terminal for editing purposes; costs can still be
// recorded on a completed work order until it is closed.
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ["in_progress"],
  in_progress: ["on_hold", "completed"],
  on_hold: ["in_progress", "completed"],
  completed: ["closed"],
  closed: [],
};

const ACTIVE_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ["open", "in_progress", "on_hold"];

// ---------- helpers ----------

function logEntry(actor: Actor | null, note: string, fromStatus: string | null, toStatus: string | null, now: string): LogEntry {
  return {
    id: makeId(),
    at: now,
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? "System",
    note: note.trim(),
    fromStatus,
    toStatus,
  };
}

function makeCost(actor: Actor | null, input: CostInput): CostEntry {
  return {
    id: makeId(),
    description: input.description.trim(),
    category: input.category.trim(),
    amount: Number(input.amount),
    incurredDate: input.incurredDate,
    recordedAt: new Date().toISOString(),
    recordedBy: actor?.fullName ?? "System",
  };
}

function validateCost(db: Database, input: CostInput): Errors {
  const errors: Errors = {};
  if (!input.description.trim()) errors.description = "Describe what the cost was for.";
  else if (input.description.trim().length > 120) errors.description = "Keep the description to 120 characters.";
  if (input.category.trim().length > 40) errors.category = "Keep the category to 40 characters.";
  const amount = Number(input.amount);
  if (!input.amount.trim() || !Number.isFinite(amount)) errors.amount = "Enter an amount, for example 450.00.";
  else if (amount <= 0) errors.amount = "The amount must be greater than zero. Use a work order note to explain a refund.";
  else if (amount > 1_000_000_000) errors.amount = "That amount looks wrong. Check the figure.";
  else if (!/^\d+(\.\d{1,2})?$/.test(input.amount.trim())) errors.amount = "Use at most two decimal places.";
  if (!isValidDate(input.incurredDate)) errors.incurredDate = "Enter the date the cost was incurred.";
  // Costs are facts recorded after the fact; the currency must be known first (no default).
  if (!db.settings.currencyCode) errors.amount = "Set the company currency in Settings before recording costs.";
  return errors;
}

function activeWorkOrders(db: Database, vehicleId: string, exceptId?: string): WorkOrder[] {
  return db.workOrders.filter(
    (w) => w.vehicleId === vehicleId && ACTIVE_WORK_ORDER_STATUSES.includes(w.status) && w.id !== exceptId,
  );
}

// Restoring a vehicle to Available must not override unfinished maintenance.
function vehicleRestoreErrors(db: Database, vehicleId: string, target: VehicleRestoration, exceptWorkOrderId?: string): Errors {
  const errors: Errors = {};
  if (target === "unchanged") return errors;
  const vehicle = db.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) {
    errors.vehicleId = "Vehicle not found.";
    return errors;
  }
  if (!VEHICLE_TRANSITIONS[vehicle.status].includes(target)) {
    errors.vehicleRestoredTo = `A ${vehicle.status.replace("_", " ")} vehicle cannot be set to ${target.replace("_", " ")}.`;
    return errors;
  }
  if (target === "available" && activeWorkOrders(db, vehicleId, exceptWorkOrderId).length > 0) {
    errors.vehicleRestoredTo = "Another work order for this vehicle is still active. Close or finish it first.";
  }
  return errors;
}

function applyVehicleStatus(db: Database, vehicleId: string, target: VehicleRestoration, now: string): { db: Database; changed: boolean } {
  if (target === "unchanged") return { db, changed: false };
  return {
    db: {
      ...db,
      vehicles: db.vehicles.map((v) => (v.id === vehicleId ? { ...v, status: target, updatedAt: now } : v)),
    },
    changed: true,
  };
}

function validateIncident(db: Database, input: IncidentInput) {
  const errors: Errors = {};
  if (!INCIDENT_TYPES.includes(input.type)) errors.type = "Select an incident type.";
  if (!INCIDENT_SEVERITIES.includes(input.severity)) errors.severity = "Select a severity.";
  if (!isValidDate(input.reportedDate)) errors.reportedDate = "Enter the date it was reported.";

  // A breakdown, accident or damage is about a vehicle. A safety concern or "other"
  // report may not be, so a vehicle is optional for those.
  const vehicleRequired = input.type === "breakdown" || input.type === "accident" || input.type === "damage";
  const vehicle = db.vehicles.find((v) => v.id === input.vehicleId);
  if (!input.vehicleId && vehicleRequired) errors.vehicleId = "This incident type is about a vehicle. Select one.";
  else if (input.vehicleId && !vehicle) errors.vehicleId = "Vehicle not found.";

  if (input.tripId) {
    const trip = db.trips.find((t) => t.id === input.tripId);
    if (!trip) errors.tripId = "Trip not found.";
    else if (input.vehicleId && trip.vehicleId && trip.vehicleId !== input.vehicleId)
      errors.tripId = "That trip is assigned to a different vehicle.";
  }

  if (!input.description.trim()) errors.description = "Describe what happened.";
  else if (input.description.trim().length > 2000) errors.description = "Keep the description to 2000 characters.";
  if (input.assignedTo.trim().length > 80) errors.assignedTo = "Keep the responder name to 80 characters.";

  return {
    errors,
    value: {
      type: input.type,
      severity: input.severity,
      vehicleId: input.vehicleId || null,
      tripId: input.tripId || null,
      reportedDate: input.reportedDate,
      description: input.description.trim(),
      assignedTo: input.assignedTo.trim() || null,
      takeVehicleOutOfService: input.takeVehicleOutOfService === true,
    },
  };
}

function validateWorkOrder(db: Database, input: WorkOrderInput) {
  const errors: Errors = {};
  const vehicle = db.vehicles.find((v) => v.id === input.vehicleId);
  if (!input.vehicleId) errors.vehicleId = "Select the vehicle this work is for.";
  else if (!vehicle) errors.vehicleId = "Vehicle not found.";
  else if (vehicle.status === "retired") errors.vehicleId = "A retired vehicle cannot receive new work orders.";

  if (!input.title.trim()) errors.title = "Give the work order a short title.";
  else if (input.title.trim().length > 120) errors.title = "Keep the title to 120 characters.";
  if (!input.workType.trim()) errors.workType = "Describe the type of work (no work catalogue is configured).";
  else if (input.workType.trim().length > 60) errors.workType = "Keep the work type to 60 characters.";
  if (input.workshop.trim().length > 120) errors.workshop = "Keep the workshop name to 120 characters.";
  if (input.description.trim().length > 2000) errors.description = "Keep the description to 2000 characters.";

  const odometer = input.reportedOdometer.trim();
  if (odometer && !/^\d+$/.test(odometer)) errors.reportedOdometer = "Enter the odometer as a whole number of kilometres.";
  else if (odometer && Number(odometer) > 100_000_000) errors.reportedOdometer = "That odometer looks wrong.";

  const resetsServiceInterval = input.resetsServiceInterval === true;
  if (resetsServiceInterval && !odometer) {
    const vehicleCategoryId = db.vehicles.find((record) => record.id === input.vehicleId)?.categoryId;
    const schedule = db.settings.maintenance.schedules.find((record) => record.categoryId === vehicleCategoryId);
    if (schedule && schedule.intervalKm !== null)
      errors.resetsServiceInterval = "Enter the odometer at service: this category is tracked by kilometres.";
  }

  if (input.plannedDate && !isValidDate(input.plannedDate)) errors.plannedDate = "Enter a valid planned date, or leave it blank.";

  if (input.incidentId) {
    const incident = db.incidents.find((i) => i.id === input.incidentId);
    if (!incident) errors.incidentId = "Incident not found.";
    else if (input.vehicleId && incident.vehicleId && incident.vehicleId !== input.vehicleId)
      errors.incidentId = "That incident is about a different vehicle.";
  }

  return {
    errors,
    value: {
      vehicleId: input.vehicleId,
      title: input.title.trim(),
      workType: input.workType.trim(),
      workshop: input.workshop.trim(),
      description: input.description.trim(),
      reportedOdometer: odometer ? Number(odometer) : null,
      plannedDate: input.plannedDate || null,
      incidentId: input.incidentId || null,
      resetsServiceInterval,
    },
  };
}

// ---------- command execution ----------

export function executeLogistics(
  db: Database,
  actor: Actor | null,
  command: LogisticsCommand,
  now: string = new Date().toISOString(),
): CommandResult {
  switch (command.type) {
    case "create_incident": {
      const denied = authorise(actor, "incidents:create");
      if (denied) return denied;
      // Own-record scope: a driver may report only against a vehicle assigned to it,
      // and cannot change fleet availability — withdrawing a vehicle is an operations
      // decision (D-17), so the flag is ignored for record-bound roles.
      const link = actorLink(db, actor);
      if (link.bound && !mayReportOnVehicle(db, actor, command.input.vehicleId)) {
        return fail("You can only report an incident for a vehicle assigned to you.");
      }
      const incidentInput = link.bound ? { ...command.input, takeVehicleOutOfService: false } : command.input;
      const { errors, value } = validateIncident(db, incidentInput);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const reference = `IN-${String(db.incidents.length + 1).padStart(4, "0")}`;
      const created: Incident = {
        id: makeId(),
        reference,
        ...value,
        status: "reported",
        resolutionNote: null,
        vehicleRestoredTo: null,
        costEntries: [],
        log: [],
        createdAt: now,
        updatedAt: now,
      };
      created.log = [logEntry(actor, "Incident reported.", null, "reported", now)];

      let next: Database = { ...db, incidents: [...db.incidents, created] };
      let vehicleNote = "";
      if (value.takeVehicleOutOfService && value.vehicleId) {
        const applied = applyVehicleStatus(next, value.vehicleId, "out_of_service", now);
        next = applied.db;
        const vehicle = db.vehicles.find((v) => v.id === value.vehicleId);
        if (applied.changed && vehicle) vehicleNote = ` Vehicle ${vehicle.registration} taken out of service.`;
      }
      next = audit(next, actor, {
        action: "incidents:create",
        entity: "incident",
        entityId: created.id,
        summary: `${reference} reported (${value.type}, ${value.severity})${vehicleNote}`,
      }, now);
      return { ok: true, db: next, message: `${reference} reported.${vehicleNote}` };
    }

    case "update_incident": {
      const denied = authorise(actor, "incidents:update");
      if (denied) return denied;
      const existing = db.incidents.find((i) => i.id === command.id);
      if (!existing) return fail("Incident not found.");
      // Once a response is in progress the facts are settled; corrections go in the log.
      if (existing.status !== "reported" && existing.status !== "acknowledged")
        return fail(`This incident is ${existing.status.replace("_", " ")}. Add a note instead of editing the original report.`);
      const { errors, value } = validateIncident(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);

      const updated: Incident = {
        ...existing,
        ...value,
        updatedAt: now,
        log: [...existing.log, logEntry(actor, "Report details updated.", existing.status, existing.status, now)],
      };
      let next: Database = { ...db, incidents: db.incidents.map((i) => (i.id === updated.id ? updated : i)) };
      // The operator can take the vehicle out of service while editing the report.
      if (value.takeVehicleOutOfService && value.vehicleId && existing.status === "reported") {
        const applied = applyVehicleStatus(next, value.vehicleId, "out_of_service", now);
        next = applied.db;
      }
      next = audit(next, actor, {
        action: "incidents:update",
        entity: "incident",
        entityId: updated.id,
        summary: `${updated.reference} report updated (${updated.type}, ${updated.severity}).`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} updated.` };
    }

    case "advance_incident": {
      const denied = authorise(actor, "incidents:advance");
      if (denied) return denied;
      const existing = db.incidents.find((i) => i.id === command.id);
      if (!existing) return fail("Incident not found.");
      const from = existing.status;
      const to = command.input.to;
      if (from === to) return fail(`This incident is already ${to.replace("_", " ")}.`);
      if (!INCIDENT_TRANSITIONS[from].includes(to))
        return fail(`Transition ${from} -> ${to} is not allowed.`, { to: `Allowed from ${from}: ${INCIDENT_TRANSITIONS[from].join(", ") || "nothing"}.` });

      const errors: Errors = {};
      const assignedTo = command.input.assignedTo.trim() || existing.assignedTo;

      if (to === "responding" && existing.type === "breakdown" && !assignedTo)
        errors.assignedTo = "Name who is responding to this breakdown before starting the response.";
      if (to === "resolved") {
        if (!command.input.resolutionNote.trim())
          errors.resolutionNote = "Record how this incident was resolved.";
        const restoreErrors = vehicleRestoreErrors(db, existing.vehicleId ?? "", command.input.vehicleRestoredTo);
        Object.assign(errors, restoreErrors);
      }
      if (to === "closed") {
        const linked = db.workOrders.filter((w) => w.incidentId === existing.id);
        const unfinished = linked.filter((w) => w.status !== "closed");
        if (unfinished.length > 0)
          errors.to = `Close the linked work order first (${unfinished.map((w) => w.reference).join(", ")}).`;
      }
      if (Object.keys(errors).length) return fail("This incident cannot move to that status yet.", errors);

      const updated: Incident = {
        ...existing,
        status: to,
        assignedTo,
        resolutionNote: to === "resolved" ? command.input.resolutionNote.trim() : existing.resolutionNote,
        vehicleRestoredTo: to === "resolved" ? command.input.vehicleRestoredTo : existing.vehicleRestoredTo,
        updatedAt: now,
        log: [...existing.log, logEntry(actor, command.input.note || `Status set to ${to}.`, from, to, now)],
      };
      let next: Database = { ...db, incidents: db.incidents.map((i) => (i.id === updated.id ? updated : i)) };
      if (to === "resolved") next = applyVehicleStatus(next, existing.vehicleId ?? "", command.input.vehicleRestoredTo, now).db;
      next = audit(next, actor, {
        action: "incidents:advance",
        entity: "incident",
        entityId: updated.id,
        summary: `${updated.reference}: ${from} -> ${to}.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} is now ${to.replace("_", " ")}.` };
    }

    case "add_incident_cost":
    case "add_work_order_cost": {
      const isIncident = command.type === "add_incident_cost";
      const denied = authorise(actor, isIncident ? "incidents:cost" : "maintenance:cost");
      if (denied) return denied;
      const errors = validateCost(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const cost = makeCost(actor, command.input);

      if (isIncident) {
        const existing = db.incidents.find((i) => i.id === command.id);
        if (!existing) return fail("Incident not found.");
        if (existing.status === "closed") return fail("Costs cannot be added to a closed incident.");
        const updated = { ...existing, costEntries: [...existing.costEntries, cost], updatedAt: now };
        const next = audit({ ...db, incidents: db.incidents.map((i) => (i.id === updated.id ? updated : i)) }, actor, {
          action: "incidents:cost",
          entity: "incident",
          entityId: updated.id,
          summary: `Cost recorded on ${updated.reference}: ${cost.description} (${cost.amount}).`,
        }, now);
        return { ok: true, db: next, message: `Cost recorded on ${updated.reference}.` };
      }

      const existing = db.workOrders.find((w) => w.id === command.id);
      if (!existing) return fail("Work order not found.");
      if (existing.status === "closed") return fail("Costs cannot be added to a closed work order.");
      const updated = { ...existing, costEntries: [...existing.costEntries, cost], updatedAt: now };
      const next = audit({ ...db, workOrders: db.workOrders.map((w) => (w.id === updated.id ? updated : w)) }, actor, {
        action: "maintenance:cost",
        entity: "work_order",
        entityId: updated.id,
        summary: `Cost recorded on ${updated.reference}: ${cost.description} (${cost.amount}).`,
      }, now);
      return { ok: true, db: next, message: `Cost recorded on ${updated.reference}.` };
    }

    case "remove_incident_cost":
    case "remove_work_order_cost": {
      const isIncident = command.type === "remove_incident_cost";
      const denied = authorise(actor, isIncident ? "incidents:cost" : "maintenance:cost");
      if (denied) return denied;
      const label = isIncident ? "Incident" : "Work order";
      if (isIncident) {
        const existing = db.incidents.find((i) => i.id === command.id);
        if (!existing) return fail("Incident not found.");
        if (existing.status === "closed") return fail("Costs cannot be changed on a closed incident.");
        const cost = existing.costEntries.find((c) => c.id === command.costId);
        if (!cost) return fail(`${label} cost not found.`);
        const updated = { ...existing, costEntries: existing.costEntries.filter((c) => c.id !== command.costId), updatedAt: now };
        const next = audit({ ...db, incidents: db.incidents.map((i) => (i.id === updated.id ? updated : i)) }, actor, {
          action: "incidents:cost",
          entity: "incident",
          entityId: updated.id,
          summary: `Cost removed from ${updated.reference}: ${cost.description} (${cost.amount}).`,
        }, now);
        return { ok: true, db: next, message: `Cost removed from ${updated.reference}.` };
      }

      const existing = db.workOrders.find((w) => w.id === command.id);
      if (!existing) return fail("Work order not found.");
      if (existing.status === "closed") return fail("Costs cannot be changed on a closed work order.");
      const cost = existing.costEntries.find((c) => c.id === command.costId);
      if (!cost) return fail(`${label} cost not found.`);
      const updated = { ...existing, costEntries: existing.costEntries.filter((c) => c.id !== command.costId), updatedAt: now };
      const next = audit({ ...db, workOrders: db.workOrders.map((w) => (w.id === updated.id ? updated : w)) }, actor, {
        action: "maintenance:cost",
        entity: "work_order",
        entityId: updated.id,
        summary: `Cost removed from ${updated.reference}: ${cost.description} (${cost.amount}).`,
      }, now);
      return { ok: true, db: next, message: `Cost removed from ${updated.reference}.` };
    }

    case "create_work_order": {
      const denied = authorise(actor, "maintenance:create");
      if (denied) return denied;
      const { errors, value } = validateWorkOrder(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const reference = `WO-${String(db.workOrders.length + 1).padStart(4, "0")}`;
      const created: WorkOrder = {
        id: makeId(),
        reference,
        ...value,
        status: "open",
        holdReason: null,
        completedAt: null,
        costEntries: [],
        costsConfirmedComplete: false,
        completionNote: null,
        log: [],
        createdAt: now,
        updatedAt: now,
      };
      created.log = [logEntry(actor, "Work order raised.", null, "open", now)];
      const next = audit({ ...db, workOrders: [...db.workOrders, created] }, actor, {
        action: "maintenance:create",
        entity: "work_order",
        entityId: created.id,
        summary: `${reference} raised for vehicle ${value.vehicleId}: ${value.title}`,
      }, now);
      return { ok: true, db: next, message: `${reference} raised.` };
    }

    case "update_work_order": {
      const denied = authorise(actor, "maintenance:update");
      if (denied) return denied;
      const existing = db.workOrders.find((w) => w.id === command.id);
      if (!existing) return fail("Work order not found.");
      if (existing.status === "completed" || existing.status === "closed")
        return fail(`A ${existing.status} work order cannot be edited. Raise a new one for further work.`);
      const { errors, value } = validateWorkOrder(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      if (value.vehicleId !== existing.vehicleId && existing.status !== "open")
        return fail("The vehicle cannot be changed once work has started.");
      const updated: WorkOrder = {
        ...existing,
        ...value,
        updatedAt: now,
        log: [...existing.log, logEntry(actor, "Work order details updated.", existing.status, existing.status, now)],
      };
      const next = audit({ ...db, workOrders: db.workOrders.map((w) => (w.id === updated.id ? updated : w)) }, actor, {
        action: "maintenance:update",
        entity: "work_order",
        entityId: updated.id,
        summary: `${updated.reference} updated.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} updated.` };
    }

    case "advance_work_order": {
      const denied = authorise(actor, "maintenance:advance");
      if (denied) return denied;
      const existing = db.workOrders.find((w) => w.id === command.id);
      if (!existing) return fail("Work order not found.");
      const from = existing.status;
      const to = command.input.to;
      if (from === to) return fail(`This work order is already ${to.replace("_", " ")}.`);
      if (!WORK_ORDER_TRANSITIONS[from].includes(to))
        return fail(`Transition ${from} -> ${to} is not allowed.`, { to: `Allowed from ${from}: ${WORK_ORDER_TRANSITIONS[from].join(", ") || "nothing"}.` });

      const errors: Errors = {};
      if (to === "on_hold" && !command.input.note.trim())
        errors.note = "Say why the work is on hold.";
      if (to === "completed" && !command.input.costsConfirmedComplete)
        errors.costsConfirmedComplete = "Confirm the cost position: record the costs, or tick that there are none to record.";
      if (to === "completed" && !command.input.note.trim())
        errors.note = "Record what work was done.";
      if (to === "closed") {
        const restoreErrors = vehicleRestoreErrors(db, existing.vehicleId, command.input.vehicleRestoredTo, existing.id);
        Object.assign(errors, restoreErrors);
        if (!command.input.note.trim()) errors.note = "Record that the costs were reviewed.";
      }
      if (Object.keys(errors).length) return fail("This work order cannot move to that status yet.", errors);

      const updated: WorkOrder = {
        ...existing,
        status: to,
        holdReason: to === "on_hold" ? command.input.note.trim() : to === "in_progress" ? null : existing.holdReason,
        costsConfirmedComplete: to === "completed" || to === "closed" ? true : existing.costsConfirmedComplete,
        completionNote: to === "completed" ? command.input.note.trim() : existing.completionNote,
        completedAt: to === "completed" ? now : existing.completedAt,
        updatedAt: now,
        log: [...existing.log, logEntry(actor, command.input.note || `Status set to ${to}.`, from, to, now)],
      };

      let next: Database = { ...db, workOrders: db.workOrders.map((w) => (w.id === updated.id ? updated : w)) };
      let vehicleNote = "";
      if (to === "in_progress") {
        const vehicle = db.vehicles.find((v) => v.id === existing.vehicleId);
        const applied = applyVehicleStatus(next, existing.vehicleId, "maintenance", now);
        next = applied.db;
        if (applied.changed && vehicle) vehicleNote = ` Vehicle ${vehicle.registration} moved to maintenance.`;
      }
      if (to === "closed") {
        const vehicle = db.vehicles.find((v) => v.id === existing.vehicleId);
        const applied = applyVehicleStatus(next, existing.vehicleId, command.input.vehicleRestoredTo, now);
        next = applied.db;
        if (applied.changed && vehicle) vehicleNote = ` Vehicle ${vehicle.registration} set to ${command.input.vehicleRestoredTo.replace("_", " ")}.`;
      }

      next = audit(next, actor, {
        action: "maintenance:advance",
        entity: "work_order",
        entityId: updated.id,
        summary: `${updated.reference}: ${from} -> ${to}.${vehicleNote}`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} is now ${to.replace("_", " ")}.${vehicleNote}` };
    }
  }
}
