// Database access.
//
// Kysely over `pg` rather than Prisma: Prisma's native query engine could not be downloaded in
// the environment this was built and verified in, so Prisma code could not have been run even
// once. A type-safe query builder over the driver is verifiable end to end, and every migration
// is hand-written SQL anyway (the brief requires that for the constraints Prisma cannot express).
// Decision D-50 records the trade-off and the path back to Prisma if the team standardises on it.
import { Kysely, PostgresDialect, sql, type ColumnType } from "kysely";
import { Pool, types } from "pg";
import { env } from "./env";

// `date` columns must round-trip as plain YYYY-MM-DD strings. Letting node-postgres build a JS
// Date shifts the value by the process time zone, which is exactly the class of bug brief §5.5
// is written to prevent.
types.setTypeParser(1082, (value: string) => value);

/** timestamptz: read as Date, write as an ISO string. */
type Timestamp = ColumnType<Date, string | Date, string | Date>;
/** date: read and write as YYYY-MM-DD. */
type DateOnly = ColumnType<string, string, string>;
/** jsonb: written as a serialised string, read back as whatever was stored. */
type Json = ColumnType<unknown, string, string>;

export interface AppUserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  active: boolean;
  driver_id: string | null;
  client_id: string | null;
  /** The rider a passenger account reads its own journeys through (PAX-01, D-97). */
  passenger_id: string | null;
  password_hash: string;
  password_salt: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface VehicleRow {
  id: string;
  registration: string;
  category_id: string;
  make: string;
  model: string;
  seat_capacity: number;
  status: string;
  notes: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface DriverRow {
  id: string;
  full_name: string;
  phone: string;
  licence_number: string;
  licence_expiry: DateOnly;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface ClientRow {
  id: string;
  name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface RentalRow {
  id: string;
  reference: string;
  client_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  purpose: string;
  pickup_location: string;
  dropoff_location: string;
  start_date: DateOnly;
  end_date: DateOnly;
  passengers: number;
  vehicle_category_id: string;
  driver_required: boolean;
  status: string;
  assigned_vehicle_id: string | null;
  assigned_driver_id: string | null;
  quote_subtotal: string | null;
  deposit_required: string | null;
  deposit_amount: string | null;
  invoice_total: string | null;
  currency_code: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface BusRouteRow {
  id: string;
  reference: string;
  name: string;
  client_id: string;
  direction: string;
  shift_id: string | null;
  vehicle_category_id: string;
  start_date: DateOnly;
  end_date: DateOnly | null;
  status: string;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface PassengerRow {
  id: string;
  client_id: string;
  full_name: string;
  employee_ref: string;
  phone: string;
  route_id: string | null;
  stop_id: string | null;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface ContractRow {
  id: string;
  reference: string;
  client_id: string;
  start_date: DateOnly;
  end_date: DateOnly | null;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface BookingRow {
  id: string;
  reference: string;
  trip_id: string;
  passenger_id: string;
  client_id: string;
  service_date: DateOnly;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface TripRow {
  id: string;
  reference: string;
  route_id: string;
  service_date: DateOnly;
  status: string;
  /** `schedule` or `adhoc`; decides the partial unique index on (route_id, service_date) (D-82). */
  origin: string;
  vehicle_id: string | null;
  driver_id: string | null;
  dispatched_at: Timestamp | null;
  started_at: Timestamp | null;
  completed_at: Timestamp | null;
  cancel_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface IncidentRow {
  id: string;
  reference: string;
  type: string;
  severity: string;
  vehicle_id: string | null;
  trip_id: string | null;
  reported_date: DateOnly;
  status: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface WorkOrderRow {
  id: string;
  reference: string;
  vehicle_id: string;
  incident_id: string | null;
  title: string;
  status: string;
  cost_total: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface ComplianceDocumentRow {
  id: string;
  owner_type: string;
  owner_id: string;
  document_type_id: string;
  document_number: string;
  issued_date: DateOnly | null;
  expiry_date: DateOnly;
  notes: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface OdometerReadingRow {
  id: string;
  vehicle_id: string;
  reading_km: number;
  reading_date: DateOnly;
  status: string;
  note: string;
  void_reason: string | null;
  created_at: Timestamp;
  created_by: string;
  data: Json;
}

export interface InvoiceRow {
  id: string;
  reference: string;
  kind: string;
  rental_id: string | null;
  client_id: string | null;
  customer_name: string;
  currency_code: string;
  subtotal: string;
  total: string;
  amount_paid: string;
  status: string;
  billable_event: string;
  issued_on: DateOnly;
  due_on: DateOnly;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface PaymentRow {
  id: string;
  reference: string;
  invoice_id: string;
  amount: string;
  currency_code: string;
  method: string;
  paid_on: DateOnly;
  external_reference: string;
  status: string;
  recorded_by: string;
  recorded_at: Timestamp;
  // Cancelling a payment (D-88): null while it stands, set once with a reason.
  void_reason: string | null;
  voided_at: Timestamp | null;
  data: Json;
}

export interface CreditNoteRow {
  id: string;
  reference: string;
  invoice_id: string;
  client_id: string | null;
  customer_name: string;
  currency_code: string;
  subtotal: string;
  total: string;
  reason: string;
  issued_on: DateOnly;
  status: string;
  void_reason: string | null;
  voided_at: Timestamp | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface RefundRow {
  id: string;
  reference: string;
  invoice_id: string;
  client_id: string | null;
  customer_name: string;
  currency_code: string;
  amount: string;
  method: string;
  paid_on: DateOnly;
  external_reference: string;
  reason: string;
  status: string;
  void_reason: string | null;
  voided_at: Timestamp | null;
  recorded_by: string;
  recorded_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface ExpenseRow {
  id: string;
  reference: string;
  incurred_on: DateOnly;
  category: string;
  description: string;
  payee: string;
  amount: string;
  currency_code: string;
  method: string;
  receipt_reference: string;
  receipt_held: boolean;
  status: string;
  void_reason: string | null;
  voided_at: Timestamp | null;
  recorded_by: string;
  recorded_at: Timestamp;
  updated_at: Timestamp;
  data: Json;
}

export interface ReceiptFileRow {
  id: string;
  expense_id: string;
  stored_name: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  status: string;
  removed_reason: string | null;
  removed_by: string | null;
  removed_at: Timestamp | null;
  superseded_by_id: string | null;
  uploaded_by: string;
  uploaded_at: Timestamp;
  data: Json;
}

export interface AuditEntryRow {
  id: string;
  at: Timestamp;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string;
  summary: string;
}

export interface AppSettingsRow {
  id: string;
  updated_at: Timestamp;
  data: Json;
}

export interface ResourceReservationRow {
  id: string;
  resource_type: string;
  resource_id: string;
  period: ColumnType<string, string, string>;
  source_type: string;
  source_id: string;
  source_ref: string;
  active: boolean;
}

export interface SchemaMigrationRow {
  version: string;
  applied_at: Timestamp;
}

export interface KyselyDatabase {
  app_user: AppUserRow;
  vehicle: VehicleRow;
  driver: DriverRow;
  client: ClientRow;
  rental: RentalRow;
  bus_route: BusRouteRow;
  passenger: PassengerRow;
  trip: TripRow;
  booking: BookingRow;
  contract: ContractRow;
  incident: IncidentRow;
  work_order: WorkOrderRow;
  compliance_document: ComplianceDocumentRow;
  odometer_reading: OdometerReadingRow;
  invoice: InvoiceRow;
  credit_note: CreditNoteRow;
  payment: PaymentRow;
  refund: RefundRow;
  expense: ExpenseRow;
  receipt_file: ReceiptFileRow;
  audit_entry: AuditEntryRow;
  reference_counter: { scope: string; period: string; last: number };
  app_settings: AppSettingsRow;
  resource_reservation: ResourceReservationRow;
  schema_migrations: SchemaMigrationRow;
}

export type Db = Kysely<KyselyDatabase>;
export type Trx = Kysely<KyselyDatabase>;

let pool: Pool | null = null;
let instance: Db | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env().DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      // Fail fast instead of hanging a request for 30s when Postgres is down.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

/** Shared Kysely instance. Next's dev server re-evaluates modules on every edit, so the pool is
 *  cached on globalThis to avoid leaking one pool per reload. */
export function db(): Db {
  if (instance) return instance;
  const globalRef = globalThis as unknown as { __richieDb?: Db };
  if (globalRef.__richieDb) {
    instance = globalRef.__richieDb;
    return instance;
  }
  instance = new Kysely<KyselyDatabase>({ dialect: new PostgresDialect({ pool: getPool() }) });
  globalRef.__richieDb = instance;
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) await instance.destroy();
  instance = null;
  pool = null;
}

/** Health probe used by /api/health and by the start-up check in the dev server. */
export async function databaseHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await sql<{ v: string }>`select version() as v`.execute(db());
    const version = result.rows[0]?.v ?? "unknown";
    const ext = await sql<{ extname: string }>`
      select extname from pg_extension where extname in ('btree_gist','pgcrypto') order by extname
    `.execute(db());
    const applied = await sql<{ count: string }>`select count(*)::text as count from schema_migrations`.execute(db());
    return {
      ok: true,
      detail: `${version.split(" on ")[0]}; extensions: ${ext.rows.map((r) => r.extname).join(", ") || "none"}; migrations applied: ${applied.rows[0]?.count ?? "0"}`,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "database unreachable" };
  }
}
