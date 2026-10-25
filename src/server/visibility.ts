// What a signed-in account is allowed to read.
//
// Authorisation used to stop at the write path: every command was checked against the actor's role
// and refused by the database when a constraint said no, but both snapshot endpoints returned the
// whole dataset to anyone with a cookie. Own-record scope existed only in the browser
// (`src/tms/scope.ts`), where the caller already holds the payload, so it was a display choice and
// not a control (audit F-01).
//
// This module applies that scope on the server, once, to the thing that actually leaves the process:
//   - internal roles (administrator, operations, finance) read company-wide, as before;
//   - a driver reads their own driver record, the trips assigned to them and the vehicles those
//     trips used;
//   - a client contact reads their own client, its routes, roster and rental requests;
//   - a passenger reads its own rider record, its own journeys and the seats it holds (PAX-01, D-97);
//   - a record-bound account with no linked record reads nothing. It does not fall back to
//     company-wide access.
//
// The audit log is not sent to record-bound roles at all: its summaries name other people's records.
//
// The response is also bounded. The audit log is append-only and grows without limit, and the audit
// screen renders the most recent 500 matches, so sending 5 000 was paying for rows the browser
// discards. The full count travels separately as `auditTotal`, so the screen can still say how many
// there are without carrying them.
import { can } from "../tms/permissions";
import { scopedView } from "../tms/scope";
import type { Actor } from "../tms/service";
import type { Database } from "../tms/types";
import type { Permission } from "../tms/permissions";
import { redact } from "./snapshot";

/** How many audit rows travel with a snapshot. The screen shows at most this many. */
export const SNAPSHOT_AUDIT_LIMIT = 500;

export interface VisibleSnapshot {
  /** The database as this actor may see it, credentials removed. Null when nobody is signed in. */
  database: Database | null;
  /** How many audit entries exist, independent of how many were sent. */
  auditTotal: number;
}

/**
 * Which collection is behind which read permission.
 *
 * Screen gates are not a control: the browser already holds the payload by the time a screen
 * decides what to draw. So an internal role that lacks a read permission does not receive that
 * collection at all — a Finance Officer gets rentals and costs, not the employee roster, licence
 * documents or the audit trail (brief section 6, D-60). Record-bound roles are narrowed further
 * by `scopedView` before this runs, and keep the collections their portal needs.
 */
const SECTION_PERMISSIONS: { [K in keyof Database]?: Permission } = {
  audit: "audit:read",
  bookings: "bookings:read",
  clients: "clients:read",
  documents: "documents:read",
  drivers: "drivers:read",
  incidents: "incidents:read",
  odometerReadings: "fleet:read",
  passengers: "passengers:read",
  rentals: "rentals:read",
  invoices: "invoices:read",
  // A payment and a credit note are part of their invoice, so the same read permission opens them.
  payments: "invoices:read",
  creditNotes: "invoices:read",
  // A refund is part of its invoice's money, so the invoice read permission opens it (D-92).
  refunds: "invoices:read",
  // Contracts (CLI-02, D-95): the terms agreed with a client. Read is ordinary office work; a client
  // contact receives only its own client's contracts through the object-scope branch below.
  contracts: "contracts:read",
  // Spending that is not a repair (D-93), with its own read permission: finance records it, and
  // operations may read it because it is part of what its runs cost.
  expenses: "expenses:read",
  referenceCounters: "invoices:read",
  routes: "routes:read",
  settings: "settings:read",
  trips: "trips:read",
  users: "users:read",
  vehicles: "vehicles:read",
  workOrders: "maintenance:read",
};

/**
 * The company's settings, as far as a rider needs them (PAX-01, D-97).
 *
 * Every other record-bound role is an outside party that already trades with the company, so it
 * receives the settings table whole. A passenger is an employee reading its own bus times, and the
 * same table carries rental prices, the deposit percentage, payment terms and the tax position —
 * commercial terms with no bearing on catching a bus. None of it travels to a passenger.
 */
function journeySettings(settings: Database["settings"]): Database["settings"] {
  return {
    companyName: settings.companyName,
    currencyCode: settings.currencyCode,
    onTimeThresholdMinutes: null,
    vehicleCategories: [],
    shifts: [],
    rental: {
      pricingBasis: null,
      depositPercent: null,
      quotationValidityDays: null,
      driversAlwaysIncluded: null,
      paymentMethods: [],
      requotePolicy: null,
    },
    documentTypes: [],
    taxPosition: null,
    taxLines: [],
    invoiceDueDays: null,
    documentReminderLeadDays: null,
    workTypes: [],
    costCategories: [],
    maintenance: settings.maintenance,
    booking: settings.booking,
  };
}

function byPermission(database: Database, actor: Actor): Database {
  const visible: Database = { ...database };
  for (const [section, permission] of Object.entries(SECTION_PERMISSIONS) as [keyof Database, Permission][]) {
    if (!can(actor.role, permission)) (visible as unknown as Record<string, unknown>)[section] = [];
  }
  return visible;
}

/** The database narrowed to what `actor` may read, credentials removed. */
export function scopeDatabase(database: Database, actor: Actor | null): Database | null {
  if (!actor) return null;

  const view = scopedView(database, actor);
  const { link } = view;
  // Internal roles read company-wide *within their permissions*; bound roles read their own
  // records. Neither branch is allowed to hand back a collection the role cannot read.
  let visible: Database = link.bound ? database : byPermission(database, actor);

  if (link.bound) {
    const vehicleIds = new Set(view.vehicles.map((vehicle) => vehicle.id));
    visible = {
      ...database,
      // The account's own row, and only when it still exists and is the row being viewed.
      users: link.user ? [link.user] : [],
      drivers: link.driver ? [link.driver] : [],
      clients: link.client ? [link.client] : [],
      trips: view.trips,
      incidents: view.incidents,
      routes: view.routes,
      // A corporate contact sees which of its staff travel and from which stop — the manifest it
      // needs to answer "where is my team?" — but not their phone numbers: the portal's own copy
      // says contact details are held by the account manager, and the payload must match it
      // (brief section 6, D-60).
      passengers: link.client ? view.passengers.map((passenger) => ({ ...passenger, phone: "" })) : view.passengers,
      rentals: view.rentals,
      vehicles: view.vehicles,
      workOrders: view.workOrders,
      documents: view.documents,
      // D-85: a bound role gets the seats it may see and nothing else. Leaving this collection out of
      // the narrowed snapshot handed the whole bookings table to a client contact or a driver.
      bookings: view.bookings,
      odometerReadings: database.odometerReadings.filter((reading) => vehicleIds.has(reading.vehicleId)),
      invoices: [],
      payments: [],
      // D-86: a credit note states what a customer was billed and why they were given money back.
      // It is billing, so it stays with the invoice and the payment rows — never with a driver or a
      // client contact. Adding the collection without this line would have sent the whole table.
      creditNotes: [],
      // D-92: a refund names a customer and an amount paid back to them. Billing, so it stays with
      // the invoice rows and never travels to a driver or a client contact.
      refunds: [],
      // D-93: an expense names a payee and what the business spent. It never travels to a driver or
      // a client contact.
      expenses: [],
      // D-95: a client contact gets the agreements covering its own account, a driver gets none.
      contracts: view.contracts,
      referenceCounters: [],
      // Record-bound roles have no audit: the summaries name records that are not theirs.
      audit: [],
      // A rider reads the company's name and the two booking cut-offs, nothing of its prices.
      settings: link.passenger ? journeySettings(database.settings) : database.settings,
    };
  }

  // Credentials are removed last, so no branch above can accidentally reintroduce one.
  return { ...redact(visible), audit: visible.audit.slice(0, SNAPSHOT_AUDIT_LIMIT) };
}

/** The snapshot response body for `actor`, together with the true audit count. */
export function visibleSnapshot(database: Database, actor: Actor | null): VisibleSnapshot {
  return {
    database: scopeDatabase(database, actor),
    auditTotal: actor ? database.audit.length : 0,
  };
}
