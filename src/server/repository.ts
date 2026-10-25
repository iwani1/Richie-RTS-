// Repository: maps the domain's immutable `Database` snapshot to and from PostgreSQL.
//
// The domain layer (src/tms/*) is pure and takes the whole database as a value, which is what
// makes its 114 tests fast and deterministic. Rather than rewriting every command into SQL, the
// server loads the snapshot, runs the command, and writes back only what changed. Correctness of
// the write is enforced by the database (constraints, exclusion indexes, append-only audit), not
// by trusting the mapper.
//
// Mapping rule (D-50): the entity is stored whole in `data jsonb` AND projected into typed columns
// for the fields that constraints, indexes, reports and the audit depend on. The typed columns are
// always written from the same object in the same statement, so they cannot drift.
import { sql, type Kysely, type Selectable } from "kysely";
import { AUDIT_LIMIT } from "../tms/service";
import {
  emptyDatabase,
  migrate,
  type AuditEntry,
  type BusRoute,
  type Client,
  type ComplianceDocument,
  type CreditNote,
  type Refund,
  type Database,
  type Driver,
  type Incident,
  type Invoice,
  type OdometerReading,
  type Payment,
  type Passenger,
  type Rental,
  type Booking,
  type Trip,
  type User,
  type Vehicle,
  type WorkOrder,
} from "../tms/types";
import { formatAmount, sumAmounts } from "../tms/money";
import { db, type AuditEntryRow, type Db, type KyselyDatabase, type Trx } from "./db";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const at = (value: string | null | undefined) => (value ? value : null);

type Row = Record<string, unknown>;

/** Keys that identify a reservation source, so stale reservations can be released first. */
const CHUNK = 400;

// --------------------------------------------------------------------------- row projections

const userRow = (u: User): Row => ({
  id: u.id,
  full_name: u.fullName,
  email: u.email,
  role: u.role,
  active: u.active,
  driver_id: u.driverId ?? null,
  client_id: u.clientId ?? null,
  password_hash: u.passwordHash,
  password_salt: u.passwordSalt,
  created_at: u.createdAt,
  updated_at: u.updatedAt,
  data: json(u),
});

const vehicleRow = (v: Vehicle): Row => ({
  id: v.id,
  registration: v.registration,
  category_id: v.categoryId,
  make: v.make,
  model: v.model,
  seat_capacity: v.seatCapacity,
  status: v.status,
  notes: v.notes,
  created_at: v.createdAt,
  updated_at: v.updatedAt,
  data: json(v),
});

const driverRow = (d: Driver): Row => ({
  id: d.id,
  full_name: d.fullName,
  phone: d.phone,
  licence_number: d.licenceNumber,
  licence_expiry: d.licenceExpiry,
  status: d.status,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  data: json(d),
});

const clientRow = (c: Client): Row => ({
  id: c.id,
  name: c.name,
  contact_name: c.contactName,
  contact_phone: c.contactPhone,
  contact_email: c.contactEmail,
  status: c.status,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
  data: json(c),
});

const rentalRow = (r: Rental): Row => ({
  id: r.id,
  reference: r.reference,
  client_id: r.clientId ?? null,
  customer_name: r.customerName,
  customer_phone: r.customerPhone,
  customer_email: r.customerEmail,
  purpose: r.purpose,
  pickup_location: r.pickupLocation,
  dropoff_location: r.dropoffLocation,
  start_date: r.startDate,
  end_date: r.endDate,
  passengers: r.passengers,
  vehicle_category_id: r.vehicleCategoryId,
  driver_required: r.driverRequired,
  status: r.status,
  assigned_vehicle_id: r.assignedVehicleId ?? null,
  assigned_driver_id: r.assignedDriverId ?? null,
  // Money columns are real NUMERIC(14,2) so reports and reconciliation never read a float (§5.4).
  quote_subtotal: r.quote ? formatAmount(r.quote.subtotal) : null,
  deposit_required: r.quote ? formatAmount(r.quote.depositRequired) : null,
  deposit_amount: r.deposit ? formatAmount(r.deposit.amount) : null,
  invoice_total: r.finalInvoice ? formatAmount(r.finalInvoice.total) : null,
  currency_code: r.finalInvoice?.currencyCode ?? r.quote?.currencyCode ?? null,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  data: json(r),
});

const routeRow = (r: BusRoute): Row => ({
  id: r.id,
  reference: r.reference,
  name: r.name,
  client_id: r.clientId,
  direction: r.direction,
  shift_id: r.shiftId ?? null,
  vehicle_category_id: r.vehicleCategoryId,
  start_date: r.startDate,
  end_date: r.endDate ?? null,
  status: r.status,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  data: json(r),
});

const passengerRow = (p: Passenger): Row => ({
  id: p.id,
  client_id: p.clientId,
  full_name: p.fullName,
  employee_ref: p.employeeRef,
  phone: p.phone,
  route_id: p.routeId ?? null,
  stop_id: p.stopId ?? null,
  status: p.status,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
  data: json(p),
});

const tripRow = (t: Trip): Row => ({
  id: t.id,
  reference: t.reference,
  route_id: t.routeId,
  service_date: t.serviceDate,
  status: t.status,
  // The column decides which rows the one-scheduled-run-per-day index covers (DSP-03, D-82).
  origin: t.origin ?? "schedule",
  vehicle_id: t.vehicleId ?? null,
  driver_id: t.driverId ?? null,
  dispatched_at: at(t.dispatchedAt),
  started_at: at(t.startedAt),
  completed_at: at(t.completedAt),
  cancel_reason: t.cancelReason ?? null,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  data: json(t),
});

const bookingRow = (b: Booking): Row => ({
  id: b.id,
  reference: b.reference,
  trip_id: b.tripId,
  passenger_id: b.passengerId,
  client_id: b.clientId,
  service_date: b.serviceDate,
  status: b.status,
  created_at: b.createdAt,
  updated_at: b.updatedAt,
  data: json(b),
});

const incidentRow = (i: Incident): Row => ({
  id: i.id,
  reference: i.reference,
  type: i.type,
  severity: i.severity,
  vehicle_id: i.vehicleId ?? null,
  trip_id: i.tripId ?? null,
  reported_date: i.reportedDate,
  status: i.status,
  created_at: i.createdAt,
  updated_at: i.updatedAt,
  data: json(i),
});

const workOrderRow = (w: WorkOrder): Row => ({
  id: w.id,
  reference: w.reference,
  vehicle_id: w.vehicleId,
  incident_id: w.incidentId ?? null,
  title: w.title,
  status: w.status,
  // Summed in whole pesewas and formatted once: the column is numeric(14,2) and must agree with
  // the domain total to the pesewa (audit D-04).
  cost_total: formatAmount(sumAmounts(w.costEntries.map((c) => c.amount))),
  created_at: w.createdAt,
  updated_at: w.updatedAt,
  data: json(w),
});

const documentRow = (d: ComplianceDocument): Row => ({
  id: d.id,
  owner_type: d.ownerType,
  owner_id: d.ownerId,
  document_type_id: d.documentTypeId,
  document_number: d.documentNumber,
  issued_date: d.issuedDate ?? null,
  expiry_date: d.expiryDate,
  notes: d.notes,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  data: json(d),
});

const odometerRow = (o: OdometerReading): Row => ({
  id: o.id,
  vehicle_id: o.vehicleId,
  reading_km: o.readingKm,
  reading_date: o.readingDate,
  status: o.status,
  note: o.note,
  void_reason: o.voidReason ?? null,
  created_at: o.createdAt,
  created_by: o.createdBy,
  data: json(o),
});

const invoiceRow = (i: Invoice): Row => ({
  id: i.id,
  reference: i.reference,
  kind: i.kind,
  rental_id: i.rentalId,
  client_id: i.clientId,
  customer_name: i.customerName,
  currency_code: i.currencyCode,
  subtotal: formatAmount(i.subtotal),
  total: formatAmount(i.total),
  amount_paid: formatAmount(i.amountPaid),
  status: i.status,
  billable_event: i.billableEvent,
  issued_on: i.issuedOn,
  due_on: i.dueOn,
  created_at: i.createdAt,
  updated_at: i.updatedAt,
  data: json(i),
});

const creditNoteRow = (c: CreditNote): Row => ({
  id: c.id,
  reference: c.reference,
  invoice_id: c.invoiceId,
  client_id: c.clientId,
  customer_name: c.customerName,
  currency_code: c.currencyCode,
  subtotal: formatAmount(c.subtotal),
  total: formatAmount(c.total),
  reason: c.reason,
  issued_on: c.issuedOn,
  status: c.status,
  void_reason: c.voidReason,
  voided_at: c.voidedAt,
  created_by: c.createdBy,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
  data: json(c),
});

const refundRow = (r: Refund): Row => ({
  id: r.id,
  reference: r.reference,
  invoice_id: r.invoiceId,
  client_id: r.clientId,
  customer_name: r.customerName,
  currency_code: r.currencyCode,
  amount: formatAmount(r.amount),
  method: r.method,
  paid_on: r.paidOn,
  external_reference: r.externalReference,
  reason: r.reason,
  status: r.status,
  void_reason: r.voidReason,
  voided_at: r.voidedAt,
  recorded_by: r.recordedBy,
  recorded_at: r.recordedAt,
  updated_at: r.updatedAt,
  data: json(r),
});

const paymentRow = (p: Payment): Row => ({
  id: p.id,
  reference: p.reference,
  invoice_id: p.invoiceId,
  amount: formatAmount(p.amount),
  currency_code: p.currencyCode,
  method: p.method,
  paid_on: p.paidOn,
  external_reference: p.externalReference,
  status: p.status,
  recorded_by: p.recordedBy,
  recorded_at: p.recordedAt,
  void_reason: p.voidReason ?? null,
  voided_at: p.voidedAt ?? null,
  data: json(p),
});

// --------------------------------------------------------------------------- helpers

/** Insert-or-update, keyed on id. Values are chunked to stay under PostgreSQL's 65,535 parameter cap. */
async function upsert(trx: Kysely<KyselyDatabase>, table: keyof KyselyDatabase, rows: Row[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await (trx as unknown as Kysely<Record<string, Row>>)
      .insertInto(table as string)
      .values(slice)
      .onConflict((oc) =>
        oc.column("id" as never).doUpdateSet(
          Object.fromEntries(
            Object.keys(slice[0])
              .filter((key) => key !== "id")
              .map((key) => [key, (eb: { ref: (c: string) => unknown }) => eb.ref(`excluded.${key}`)]),
          ) as never,
        ),
      )
      .execute();
  }
}

/** Deletes rows whose id is not present in `keep` (one round trip, `= any(array)`). */
async function prune(trx: Kysely<KyselyDatabase>, table: string, keep: string[]) {
  await sql`delete from ${sql.table(table)} where not (id = any(${sql.val(keep)}::text[]))`.execute(trx);
}

// --------------------------------------------------------------------------- load

type LoadedRow = { id: string; data: unknown };

async function rows(trx: Kysely<KyselyDatabase>, table: keyof KyselyDatabase, limit?: number): Promise<LoadedRow[]> {
  let query = trx.selectFrom(table as never).select(["id", "data"] as never) as unknown as {
    orderBy: (column: string, direction: string) => unknown;
    limit: (n: number) => unknown;
    execute: () => Promise<LoadedRow[]>;
  };
  if (limit) query = query.limit(limit) as typeof query;
  return query.execute();
}

/**
 * Audit rows come back from their typed columns, not from a `data` blob: the ledger is deliberately
 * a fixed shape so the append-only trigger has something stable to protect (migration 001).
 */
async function auditRows(trx: Kysely<KyselyDatabase>, limit: number): Promise<Selectable<AuditEntryRow>[]> {
  return trx.selectFrom("audit_entry").selectAll().orderBy("at", "desc").limit(limit).execute();
}

/** Reads the whole working set. Audit is capped for the in-memory snapshot; the table keeps all. */
export async function loadDatabase(executor: Kysely<KyselyDatabase> = db()): Promise<Database> {
  const [users, vehicles, drivers, clients, rentals, routes, passengers, trips, bookings, incidents, workOrders, documents, odometer, invoices, creditNotes, payments, refunds, counters, audit, settings] =
    await Promise.all([
      rows(executor, "app_user"),
      rows(executor, "vehicle"),
      rows(executor, "driver"),
      rows(executor, "client"),
      rows(executor, "rental"),
      rows(executor, "bus_route"),
      rows(executor, "passenger"),
      rows(executor, "trip"),
      rows(executor, "booking"),
      rows(executor, "incident"),
      rows(executor, "work_order"),
      rows(executor, "compliance_document"),
      rows(executor, "odometer_reading"),
      rows(executor, "invoice"),
      rows(executor, "credit_note"),
      rows(executor, "payment"),
      rows(executor, "refund"),
      // Number series are what stop a second invoice or payment reusing INV-2026-0001. They are
      // stored outside the JSON snapshot, so this read is the only thing that carries them into
      // the next command (found by the workflow C integration test: without it every payment took
      // PAY-…-0001 and the second one was refused by payment_reference_key).
      executor.selectFrom("reference_counter").select(["scope", "period", "last"]).execute(),
      auditRows(executor, AUDIT_LIMIT),
      executor.selectFrom("app_settings").select(["data"]).where("id", "=", "singleton").executeTakeFirst(),
    ]);

  const snapshot = migrate({
    ...emptyDatabase(),
    users: users.map((r) => r.data),
    vehicles: vehicles.map((r) => r.data),
    drivers: drivers.map((r) => r.data),
    clients: clients.map((r) => r.data),
    rentals: rentals.map((r) => r.data),
    routes: routes.map((r) => r.data),
    passengers: passengers.map((r) => r.data),
    trips: trips.map((r) => r.data),
    bookings: bookings.map((r) => r.data),
    incidents: incidents.map((r) => r.data),
    workOrders: workOrders.map((r) => r.data),
    documents: documents.map((r) => r.data),
    odometerReadings: odometer.map((r) => r.data),
    invoices: invoices.map((r) => r.data),
    creditNotes: creditNotes.map((r) => r.data),
    payments: payments.map((r) => r.data),
    refunds: refunds.map((r) => r.data),
    referenceCounters: counters.map((counter) => ({
      scope: counter.scope as Database["referenceCounters"][number]["scope"],
      period: counter.period,
      last: Number(counter.last),
    })),
    settings: (settings?.data as Database["settings"]) ?? emptyDatabase().settings,
    // Audit has no `data` column: it is a typed, append-only ledger precisely so that the rows
    // cannot be rewritten as opaque JSON (migration 001, trigger audit_append_only_trg).
    audit: audit.map((r) => ({
      id: r.id,
      at: new Date(r.at).toISOString(),
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      summary: r.summary,
    })),
  });

  if (!snapshot) {
    throw new Error("Stored data could not be migrated to the current schema. Run `npm run db:reset` only if data loss is acceptable.");
  }
  return snapshot;
}

// --------------------------------------------------------------------------- reservations

interface DesiredReservation {
  id: string;
  resourceType: "vehicle" | "driver";
  resourceId: string;
  start: string;
  end: string;
  sourceType: "rental" | "trip";
  sourceId: string;
  sourceRef: string;
}

const ACTIVE_RENTAL: readonly string[] = ["confirmed", "in_progress"];
const ACTIVE_TRIP: readonly string[] = ["dispatched", "in_progress", "completed"];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reservations derived from the snapshot. This is the input to the brief §5.1 exclusion constraint:
 * if two active rentals or trips claim the same vehicle or driver on overlapping dates, the
 * constraint rejects the write regardless of what the service layer believed.
 */
export function desiredReservations(database: Database): DesiredReservation[] {
  const out: DesiredReservation[] = [];
  for (const rental of database.rentals) {
    if (!ACTIVE_RENTAL.includes(rental.status)) continue;
    if (rental.assignedVehicleId) {
      out.push({
        id: `res-rental-vehicle-${rental.id}`,
        resourceType: "vehicle",
        resourceId: rental.assignedVehicleId,
        start: rental.startDate,
        end: rental.endDate,
        sourceType: "rental",
        sourceId: rental.id,
        sourceRef: rental.reference,
      });
    }
    if (rental.assignedDriverId) {
      out.push({
        id: `res-rental-driver-${rental.id}`,
        resourceType: "driver",
        resourceId: rental.assignedDriverId,
        start: rental.startDate,
        end: rental.endDate,
        sourceType: "rental",
        sourceId: rental.id,
        sourceRef: rental.reference,
      });
    }
  }
  for (const trip of database.trips) {
    if (!ACTIVE_TRIP.includes(trip.status)) continue;
    if (trip.vehicleId) {
      out.push({
        id: `res-trip-vehicle-${trip.id}`,
        resourceType: "vehicle",
        resourceId: trip.vehicleId,
        start: trip.serviceDate,
        end: addDays(trip.serviceDate, 0),
        sourceType: "trip",
        sourceId: trip.id,
        sourceRef: trip.reference,
      });
    }
    if (trip.driverId) {
      out.push({
        id: `res-trip-driver-${trip.id}`,
        resourceType: "driver",
        resourceId: trip.driverId,
        start: trip.serviceDate,
        end: addDays(trip.serviceDate, 0),
        sourceType: "trip",
        sourceId: trip.id,
        sourceRef: trip.reference,
      });
    }
  }
  return out;
}

async function syncReservations(trx: Kysely<KyselyDatabase>, database: Database) {
  const desired = desiredReservations(database);
  const existing = await trx.selectFrom("resource_reservation").select(["id", "resource_type", "resource_id", "source_type", "source_id"]).execute();
  const desiredKeys = new Set(desired.map((d) => `${d.resourceType}|${d.resourceId}|${d.sourceType}|${d.sourceId}`));
  const stale = existing.filter((e) => !desiredKeys.has(`${e.resource_type}|${e.resource_id}|${e.source_type}|${e.source_id}`));

  // Release first: a cancelled rental must free its slot in the same transaction that records it.
  for (const row of stale) {
    await trx.deleteFrom("resource_reservation").where("id", "=", row.id).execute();
  }
  for (const d of desired) {
    await sql`
      insert into resource_reservation (id, resource_type, resource_id, period, source_type, source_id, source_ref, active)
      values (${d.id}, ${d.resourceType}, ${d.resourceId}, daterange(${d.start}::date, ${d.end}::date, '[]'), ${d.sourceType}, ${d.sourceId}, ${d.sourceRef}, true)
      on conflict (resource_type, resource_id, source_type, source_id)
      do update set period = excluded.period, active = excluded.active, source_ref = excluded.source_ref
    `.execute(trx);
  }
}

// --------------------------------------------------------------------------- save

/**
 * Writes the difference between two snapshots in one transaction.
 *
 * Order matters: parents before children on write, children before parents on delete, so foreign
 * keys hold throughout. Audit is insert-only — the table rejects updates and deletes by trigger.
 */
export async function saveDatabase(trx: Kysely<KyselyDatabase>, before: Database, after: Database): Promise<void> {
  // 1. Release reservations that no longer exist before claiming new ones.
  await syncReservations(trx, after);

  // 2. Deletions, children first. The application archives rather than deletes (§5.9), so this is
  //    only reached when a backup import removes records.
  const order: (keyof Database)[] = [
    "refunds",
    "payments",
    "bookings",
    "creditNotes",
    "invoices",
    "workOrders",
    "incidents",
    "trips",
    "passengers",
    "routes",
    "documents",
    "odometerReadings",
    "rentals",
    "vehicles",
    "drivers",
    "clients",
    "users",
  ];
  const tableOf: Record<string, keyof KyselyDatabase> = {
    refunds: "refund",
    payments: "payment",
    bookings: "booking",
    creditNotes: "credit_note",
    invoices: "invoice",
    workOrders: "work_order",
    incidents: "incident",
    trips: "trip",
    passengers: "passenger",
    routes: "bus_route",
    documents: "compliance_document",
    odometerReadings: "odometer_reading",
    rentals: "rental",
    vehicles: "vehicle",
    drivers: "driver",
    clients: "client",
    users: "app_user",
  };
  for (const key of order) {
    const next = (after[key] as { id: string }[]).map((e) => e.id);
    const previous = (before[key] as { id: string }[]).map((e) => e.id);
    if (next.length !== previous.length || next.some((id) => !previous.includes(id))) {
      await prune(trx, tableOf[key] as string, next);
    }
  }

  // 3. Upserts, parents first.
  const write = async (table: keyof KyselyDatabase, next: Row[], previousRows: Row[]) => {
    const beforeById = new Map(previousRows.map((r) => [r.id as string, json(r)]));
    const dirty = next.filter((row) => beforeById.get(row.id as string) !== json(row));
    if (dirty.length) await upsert(trx, table, dirty);
  };

  await write("app_user", after.users.map(userRow), before.users.map(userRow));
  await write("client", after.clients.map(clientRow), before.clients.map(clientRow));
  await write("driver", after.drivers.map(driverRow), before.drivers.map(driverRow));
  await write("vehicle", after.vehicles.map(vehicleRow), before.vehicles.map(vehicleRow));
  await write("rental", after.rentals.map(rentalRow), before.rentals.map(rentalRow));
  await write("bus_route", after.routes.map(routeRow), before.routes.map(routeRow));
  await write("passenger", after.passengers.map(passengerRow), before.passengers.map(passengerRow));
  await write("trip", after.trips.map(tripRow), before.trips.map(tripRow));
  await write("incident", after.incidents.map(incidentRow), before.incidents.map(incidentRow));
  await write("work_order", after.workOrders.map(workOrderRow), before.workOrders.map(workOrderRow));
  await write("compliance_document", after.documents.map(documentRow), before.documents.map(documentRow));
  await write("odometer_reading", after.odometerReadings.map(odometerRow), before.odometerReadings.map(odometerRow));
  await write("invoice", after.invoices.map(invoiceRow), before.invoices.map(invoiceRow));
  await write("credit_note", after.creditNotes.map(creditNoteRow), before.creditNotes.map(creditNoteRow));
  await write("payment", after.payments.map(paymentRow), before.payments.map(paymentRow));
  await write("refund", after.refunds.map(refundRow), before.refunds.map(refundRow));
  await write("booking", after.bookings.map(bookingRow), before.bookings.map(bookingRow));

  // 3b. Number series. Keyed by (scope, period) rather than an id, so the generic upsert helper
  //     above does not apply. Only ever moves forwards: a lowered counter could reissue a printed
  //     document number, so the database check constraint refuses a lower value.
  for (const counter of after.referenceCounters ?? []) {
    await trx
      .insertInto("reference_counter")
      .values({ scope: counter.scope, period: counter.period, last: counter.last })
      .onConflict((oc) => oc.columns(["scope", "period"]).doUpdateSet({ last: counter.last }))
      .execute();
  }

  // 4. Settings (single row).
  if (json(after.settings) !== json(before.settings)) {
    await trx
      .insertInto("app_settings")
      .values({ id: "singleton", updated_at: now(), data: json(after.settings) })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ updated_at: now(), data: json(after.settings) }),
      )
      .execute();
  }

  // 5. Audit: append what is new, never rewrite what exists.
  const known = new Set(before.audit.map((a) => a.id));
  const fresh: AuditEntry[] = after.audit.filter((a) => !known.has(a.id));
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const slice = fresh.slice(i, i + CHUNK);
    await trx
      .insertInto("audit_entry")
      .values(
        slice.map((a) => ({
          id: a.id,
          at: a.at,
          actor_id: a.actorId,
          actor_name: a.actorName,
          action: a.action,
          entity: a.entity,
          entity_id: a.entityId,
          summary: a.summary,
        })),
      )
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
  }
}

/** Deletes every business row. Used by scripts/reset.ts and by the integration tests. */
export async function truncateAll(trx: Db | Trx): Promise<void> {
  await sql`
    truncate table resource_reservation, audit_entry, app_settings, odometer_reading,
      payment, refund, credit_note, invoice, reference_counter,
      compliance_document, work_order, incident, booking, trip, passenger, bus_route, rental,
      vehicle, driver, client, app_user restart identity cascade
  `.execute(trx);
}

