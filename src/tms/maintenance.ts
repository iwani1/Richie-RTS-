// Service intervals and odometer readings (staff logistics: preventive maintenance).
//
// Intervals live in settings and are null until management supplies them (OPEN_QUESTIONS
// Q-17, Q-37). Nothing is scheduled, blocked or computed by default. A service is a completed
// work order that the operator explicitly marked as resetting the interval; this module never
// infers that a repair was a service.

import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type { Database, OdometerReading, ServiceSchedule } from "./types";

export const MAINTENANCE_COMMAND_TYPES = ["record_odometer", "void_odometer"] as const;

export interface OdometerInput {
  vehicleId: string;
  readingKm: string;
  readingDate: string;
  note: string;
}

export type MaintenanceCommand = { type: "record_odometer"; input: OdometerInput } | { type: "void_odometer"; id: string; reason: string };

export function isMaintenanceCommand(command: { type: string }): command is MaintenanceCommand {
  return (MAINTENANCE_COMMAND_TYPES as readonly string[]).includes(command.type);
}

// ---------- helpers ----------

const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
const addDays = (ymd: string, days: number) => {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export interface ServiceAnchor {
  workOrderReference: string;
  completedAt: string;
  serviceDate: string;
  odometerKm: number | null;
}

// Newest completed work order the operator marked as a service.
export function lastServiceFor(db: Database, vehicleId: string): ServiceAnchor | null {
  const anchors = db.workOrders
    .filter((order) => order.vehicleId === vehicleId && order.resetsServiceInterval && order.completedAt !== null)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1));
  const anchor = anchors[0];
  if (!anchor) return null;
  return {
    workOrderReference: anchor.reference,
    completedAt: anchor.completedAt!,
    serviceDate: anchor.completedAt!.slice(0, 10),
    odometerKm: anchor.reportedOdometer,
  };
}

// Newest valid reading for a vehicle.
export function latestOdometer(db: Database, vehicleId: string): OdometerReading | null {
  const valid = db.odometerReadings.filter((reading) => reading.vehicleId === vehicleId && reading.status === "current");
  if (valid.length === 0) return null;
  return valid.sort((a, b) => {
    if (a.readingDate !== b.readingDate) return a.readingDate < b.readingDate ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  })[valid.length - 1];
}

export function scheduleFor(db: Database, categoryId: string): ServiceSchedule | null {
  return db.settings.maintenance.schedules.find((schedule) => schedule.categoryId === categoryId) ?? null;
}

// ---------- readiness ----------

export type ReadinessStatus = "ok" | "due" | "overdue" | "no_data" | "no_schedule";

export interface BasisView {
  basis: "km" | "days";
  interval: number;
  lead: number | null;
  consumed: number;
  remaining: number;
  dueDate: string | null;
}

export interface VehicleReadiness {
  vehicleId: string;
  registration: string;
  categoryId: string;
  categoryName: string;
  status: ReadinessStatus;
  reasons: string[];
  bases: BasisView[];
  lastServiceDate: string | null;
  lastServiceWorkOrder: string | null;
  latestOdometerKm: number | null;
}

export interface ReadinessReport {
  asOf: string;
  vehicles: VehicleReadiness[];
  counts: Record<ReadinessStatus, number>;
  total: number;
  evaluable: number;
  coverage: number | null;
  status: "ok" | "no_vehicles" | "not_configured";
}

function classify(interval: number, consumed: number, lead: number | null): "ok" | "due" | "overdue" {
  const remaining = interval - consumed;
  if (remaining <= 0) return "overdue";
  if (lead !== null && remaining <= lead) return "due";
  return "ok";
}

export function readinessReport(db: Database, asOf: string): ReadinessReport {
  const vehicles = db.vehicles.filter((vehicle) => vehicle.status !== "retired");
  const ranked: Record<ReadinessStatus, number> = { overdue: 0, due: 1, ok: 2, no_data: 3, no_schedule: 4 };

  const rows: VehicleReadiness[] = vehicles.map((vehicle) => {
    const category = db.settings.vehicleCategories.find((record) => record.id === vehicle.categoryId);
    const schedule = scheduleFor(db, vehicle.categoryId);
    const base = {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      categoryId: vehicle.categoryId,
      categoryName: category?.name ?? "Unknown category",
      reasons: [] as string[],
      bases: [] as BasisView[],
      lastServiceDate: null as string | null,
      lastServiceWorkOrder: null as string | null,
      latestOdometerKm: null as number | null,
    };

    if (!schedule) {
      return { ...base, status: "no_schedule" as const, reasons: ["No service schedule is configured for this vehicle category."] };
    }

    const service = lastServiceFor(db, vehicle.id);
    const reading = latestOdometer(db, vehicle.id);
    base.lastServiceDate = service?.serviceDate ?? null;
    base.lastServiceWorkOrder = service?.workOrderReference ?? null;
    base.latestOdometerKm = reading?.readingKm ?? null;

    if (!service) {
      base.reasons.push("No service has been recorded for this vehicle.");
    } else if (schedule.intervalDays !== null) {
      const dueDate = addDays(service.serviceDate, schedule.intervalDays);
      const consumed = daysBetween(service.serviceDate, asOf);
      base.bases.push({
        basis: "days",
        interval: schedule.intervalDays,
        lead: schedule.remindLeadDays,
        consumed,
        remaining: daysBetween(asOf, dueDate),
        dueDate,
      });
    }

    if (schedule.intervalKm !== null) {
      if (!service) {
        // already noted
      } else if (service.odometerKm === null) {
        base.reasons.push("The last service was recorded without an odometer reading.");
      } else if (!reading) {
        base.reasons.push("No odometer reading has been recorded for this vehicle.");
      } else if (reading.readingKm < service.odometerKm) {
        base.reasons.push(`The latest odometer reading (${reading.readingKm} km) is lower than the last service reading (${service.odometerKm} km).`);
      } else {
        base.bases.push({
          basis: "km",
          interval: schedule.intervalKm,
          lead: schedule.remindLeadKm,
          consumed: reading.readingKm - service.odometerKm,
          remaining: schedule.intervalKm - (reading.readingKm - service.odometerKm),
          dueDate: null,
        });
      }
    }

    if (base.bases.length === 0) {
      if (base.reasons.length === 0) base.reasons.push("The configured schedule could not be evaluated.");
      return { ...base, status: "no_data" as const };
    }

    const classifications = base.bases.map((basis) => classify(basis.interval, basis.consumed, basis.lead));
    const status = (["overdue", "due", "ok"] as const).find((candidate) => classifications.includes(candidate)) ?? "ok";
    return { ...base, status };
  });

  const counts: Record<ReadinessStatus, number> = { ok: 0, due: 0, overdue: 0, no_data: 0, no_schedule: 0 };
  for (const row of rows) counts[row.status] += 1;
  const evaluable = counts.ok + counts.due + counts.overdue;

  const status: ReadinessReport["status"] = rows.length === 0 ? "no_vehicles" : db.settings.maintenance.schedules.length === 0 ? "not_configured" : "ok";
  return {
    asOf,
    vehicles: rows.sort((a, b) => ranked[a.status] - ranked[b.status] || a.registration.localeCompare(b.registration)),
    counts,
    total: rows.length,
    evaluable,
    coverage: status === "ok" && rows.length > 0 ? evaluable / rows.length : null,
    status,
  };
}

// ---------- commands ----------

export function executeMaintenance(db: Database, actor: Actor | null, command: MaintenanceCommand, now = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "record_odometer": {
      const denied = authorise(actor, "fleet:record");
      if (denied) return denied;
      const errors: Errors = {};
      const vehicle = db.vehicles.find((record) => record.id === command.input.vehicleId);
      if (!command.input.vehicleId) errors.vehicleId = "Select the vehicle.";
      else if (!vehicle) errors.vehicleId = "Vehicle not found.";
      else if (vehicle.status === "retired") errors.vehicleId = "A retired vehicle cannot record odometer readings.";

      const km = Number(command.input.readingKm);
      if (!command.input.readingKm.trim() || !Number.isInteger(km) || km < 0) errors.readingKm = "Enter the odometer as a whole number of kilometres.";
      else if (km > 10_000_000) errors.readingKm = "That odometer reading looks wrong.";
      if (!isValidDate(command.input.readingDate)) errors.readingDate = "Enter the reading date.";
      if (command.input.note.trim().length > 500) errors.note = "Keep the note to 500 characters.";

      if (vehicle && !errors.readingKm) {
        const latest = latestOdometer(db, vehicle.id);
        if (latest && km < latest.readingKm)
          errors.readingKm = `The odometer cannot go backwards: the latest reading is ${latest.readingKm} km on ${latest.readingDate}. Void that entry first if it was recorded wrong.`;
      }
      if (Object.keys(errors).length) return fail("Please correct the reading.", errors);

      const reading: OdometerReading = {
        id: makeId(),
        vehicleId: command.input.vehicleId,
        readingKm: km,
        readingDate: command.input.readingDate,
        note: command.input.note.trim(),
        status: "current",
        voidReason: null,
        createdAt: now,
        createdBy: actor?.fullName ?? "System",
      };
      const next = audit({ ...db, odometerReadings: [...db.odometerReadings, reading] }, actor, {
        action: "fleet:odometer_record",
        entity: "odometer_reading",
        entityId: reading.id,
        summary: `${reading.vehicleId} odometer recorded at ${reading.readingKm} km on ${reading.readingDate}.`,
      }, now);
      return { ok: true, db: next, message: `Odometer recorded at ${reading.readingKm} km.` };
    }

    case "void_odometer": {
      const denied = authorise(actor, "fleet:void");
      if (denied) return denied;
      const existing = db.odometerReadings.find((record) => record.id === command.id);
      if (!existing) return fail("Odometer reading not found.");
      if (existing.status === "void") return fail("This reading is already void.");
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Record why this reading is being voided." });
      const updated: OdometerReading = { ...existing, status: "void", voidReason: command.reason.trim() };
      const next = audit({ ...db, odometerReadings: db.odometerReadings.map((record) => (record.id === updated.id ? updated : record)) }, actor, {
        action: "fleet:odometer_void",
        entity: "odometer_reading",
        entityId: updated.id,
        summary: `${updated.vehicleId} odometer reading of ${updated.readingKm} km voided. Reason: ${updated.voidReason}`,
      }, now);
      return { ok: true, db: next, message: "Odometer reading voided." };
    }
  }
}
