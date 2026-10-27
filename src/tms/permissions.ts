import type { Role } from "./types";

// resource:action strings enforced by the service layer.
export const PERMISSIONS = [
  "users:read",
  "users:create",
  "users:update",
  "settings:read",
  "settings:update",
  "vehicles:read",
  "vehicles:create",
  "vehicles:update",
  "vehicles:transition",
  "drivers:read",
  "drivers:create",
  "drivers:update",
  "clients:read",
  "clients:create",
  "clients:update",
  "rentals:read",
  "rentals:create",
  "rentals:update",
  "rentals:quote",
  // The customer saying yes to a quotation (RNT-05, D-116). Separate from rentals:confirm, which is
  // taking the deposit: a customer agreeing to a price and the office banking the money are different
  // acts, and a client contact may do the first and never the second.
  "rentals:accept",
  "rentals:confirm",
  "rentals:dispatch",
  "rentals:complete",
  "rentals:cancel",
  "routes:read",
  "routes:create",
  "routes:update",
  "passengers:read",
  "passengers:create",
  "passengers:update",
  "trips:read",
  "trips:generate",
  "trips:assign",
  "trips:dispatch",
  "trips:start",
  "trips:record",
  "trips:complete",
  "trips:cancel",
  // Correcting a recorded stop time or boarding outcome is deliberately not part of trips:record:
  // the driver at the door records the fact, operations corrects it afterwards and the correction is
  // attributed (D-74).
  "trips:correct",
  "bookings:read",
  "bookings:create",
  "bookings:manage",
  "incidents:read",
  "incidents:create",
  "incidents:update",
  "incidents:advance",
  "incidents:cost",
  "maintenance:read",
  "maintenance:create",
  "maintenance:update",
  "maintenance:advance",
  "maintenance:release",
  "maintenance:cost",
  "costs:read",
  // Contracts (brief CLI-02, D-95). A contract states what was agreed with a client, so reading it is
  // ordinary office work; approving, suspending or ending one is a management act.
  "contracts:read",
  "contracts:create",
  "contracts:update",
  "contracts:advance",
  // Spending that is not a repair (D-93). Recording it is a money job; operations reads it because
  // fuel and tolls are how its own runs are priced, but does not enter it.
  "expenses:read",
  "expenses:record",
  "expenses:void",
  // The scanned copy of a receipt (Q-51, D-100). Deliberately not part of expenses:read: operations
  // reads the expense register — fuel and tolls are part of what its runs cost — but a scan
  // photographs a supplier's paper, a bank reference and sometimes a card. Finance and
  // administrators only, and the check is on the server before a byte leaves the folder.
  "receipts:read",
  "receipts:write",
  "invoices:read",
  "invoices:issue",
  "invoices:void",
  // Taking money *off* an invoice (D-86). Separate from invoices:void because a credit note is a
  // numbered document of its own, not a correction of the invoice's details.
  "credits:issue",
  "credits:void",
  "payments:record",
  "payments:advance",
  // Cancelling a payment recorded in error (D-88). Kept apart from payments:record: the person who
  // took the money in is not always the person who may undo it, and the undo has to be attributable.
  "payments:void",
  // Money going back out to a customer (D-92). Kept apart from payments:void and credits:void because
  // this is a payment the office makes, not a correction to a bill or to money received.
  "refunds:record",
  "refunds:void",
  "documents:read",
  "documents:create",
  "documents:update",
  "fleet:read",
  "fleet:record",
  "fleet:void",
  "kpis:read",
  "audit:read",
  "backup:export",
  "backup:import",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Scope = "company" | "own";

const ALL: readonly Permission[] = PERMISSIONS;

// Role x permission matrix. Record-bound roles receive a deliberately small set of own-run
// or own-client permissions; the enforcement is in scope.ts and the service commands.
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  administrator: ALL,
  operations: [
    "vehicles:read",
    "vehicles:create",
    "vehicles:update",
    "vehicles:transition",
    "drivers:read",
    "drivers:create",
    "drivers:update",
    "clients:read",
    // Contracts (CLI-02, D-95): operations runs the corporate services, so it drafts, corrects and
    // moves a contract through approval. Ending one a client is still being carried under is auditable.
    "contracts:read",
    "contracts:create",
    "contracts:update",
    "contracts:advance",
    "rentals:read",
    "rentals:create",
    "rentals:update",
    "rentals:quote",
    "rentals:accept",
    "rentals:dispatch",
    "rentals:complete",
    "rentals:cancel",
    "routes:read",
    "routes:create",
    "routes:update",
    "passengers:read",
    "passengers:create",
    "passengers:update",
    "trips:read",
    "trips:generate",
    "trips:assign",
    "trips:dispatch",
    "trips:start",
    "trips:record",
    "trips:complete",
    "trips:cancel",
    "trips:correct",
    "bookings:read",
    "bookings:create",
    "bookings:manage",
    "incidents:read",
    "incidents:create",
    "incidents:update",
    "incidents:advance",
    "maintenance:read",
    "maintenance:create",
    "maintenance:update",
    "maintenance:advance",
    "maintenance:release",
    "costs:read",
    // Spending that is not a repair (D-93): operations may read it, because fuel and tolls are part of
    // what its own runs cost, but entering it is a money job.
    "expenses:read",
    "documents:read",
    "documents:create",
    "documents:update",
    "fleet:read",
    "fleet:record",
    "fleet:void",
    "kpis:read",
    "settings:read",
    "audit:read",
  ],
  // Finance bills and reconciles; it does not read employee records, licence/insurance documents
  // or the audit trail. Brief section 6: "Finance Officers have no unrestricted access to
  // operational or personal data." The read filter in src/server/visibility.ts enforces the same
  // boundary on the payload, so the screen gates and the snapshot cannot disagree (D-60).
  finance: [
    "clients:read",
    "clients:create",
    "clients:update",
    // A contract states the price basis and payment terms behind the bills (D-95). Finance reads it to
    // invoice against it; approving or ending it is not a finance act.
    "contracts:read",
    "vehicles:read",
    "drivers:read",
    "rentals:read",
    "rentals:quote",
    "rentals:accept",
    "rentals:confirm",
    "routes:read",
    "trips:read",
    "incidents:read",
    "incidents:cost",
    "maintenance:read",
    "maintenance:cost",
    "costs:read",
    "kpis:read",
    "settings:read",
    "invoices:read",
    "invoices:issue",
    "invoices:void",
    "credits:issue",
    "credits:void",
    "payments:record",
    "payments:advance",
    "payments:void",
    // Money going back out to a customer (D-92). Kept apart from payments:void and credits:void
    // because this is a payment the office makes, not a correction to a bill or money received.
    "refunds:record",
    "refunds:void",
    // Spending that is not a repair (D-93). Recording it is finance's job; operations may read it.
    "expenses:read",
    "expenses:record",
    "expenses:void",
    // Filing and reading the paper behind the figure is finance's job (D-100).
    "receipts:read",
    "receipts:write",
  ],
  // Own-record scope: a driver sees only the runs and incidents for the vehicle and
  // trips assigned to their linked driver record. See PERMISSIONS.md "Own-record scope".
  // trips:start, trips:record and trips:complete are own-record: a driver starts only its
  // assigned run, records its next stop, then completes after every stop is logged.
  // documents:read is own-record: a driver sees compliance documents for its own
  // driver record and for vehicles it has been assigned to, read-only.
  // bookings:read is own-record: the seats sold on this driver's own runs, which is the run's list of
  // people to collect (D-85). It is not the company's booking register.
  driver: ["trips:read", "trips:start", "trips:record", "trips:complete", "incidents:read", "incidents:create", "documents:read", "bookings:read"],
  // Own-record scope: a client contact sees only its own client's routes, roster and
  // rental requests, and may raise a rental request for that client.
  // A client's own contact books seats for that client's people and can cancel them; it cannot
  // confirm a seat, because capacity is the office's judgement (BKG-03, D-83).
  // contracts:read is own-record: a client's own contact sees the agreement the office runs for them,
  // which is what makes the portal answer "what did we agree?" without a phone call (CLI-03, D-95).
  // invoices:read is own-record too (D-114): the invoice, the payments against it, what was credited
  // off it and what was paid back, on this client's own invoices and nothing else. It is a read
  // permission and nothing more — a client contact still cannot issue, void, credit or record a
  // payment. What it is for is the question a customer actually rings up to ask: what do we owe you?
  client_contact: ["routes:read", "passengers:read", "rentals:read", "rentals:create", "rentals:accept", "invoices:read", "bookings:read", "bookings:create", "contracts:read"],
  // Own-record scope: a passenger sees its own rider record, its route and the runs that carry it,
  // and the seats it holds (PAX-01, D-97). It may ask for a seat for **itself** and cancel one it
  // holds; it can never book for somebody else, confirm its own seat, or read another rider.
  // trips:read is own-record here for the same reason as a driver's: the journeys, not the timetable.
  // A rider reads its own journeys and may ask for a seat on a run that is not its own route. It may
  // also report a problem with a journey it is on — the feedback the brief asks for (PAX-01), kept as
  // an incident so operations triages it where it triages everything else.
  passenger: ["trips:read", "routes:read", "bookings:read", "bookings:create", "incidents:create"],
};

// Record-bound roles hold their permissions against their own records only. The same
// permissions are company-scoped when held by internal staff.
const BOUND_ROLES: readonly Role[] = ["driver", "client_contact", "passenger"];
const OWN_SCOPED_FOR_BOUND_ROLES: readonly Permission[] = [
  "trips:read",
  "trips:start",
  "trips:record",
  "trips:complete",
  "incidents:read",
  "incidents:create",
  "documents:read",
  "routes:read",
  "passengers:read",
  "rentals:read",
  "rentals:create",
  "bookings:read",
  "bookings:create",
  "contracts:read",
  "invoices:read",
  "rentals:accept",
];

export function isOwnScoped(role: Role, permission: Permission): boolean {
  return BOUND_ROLES.includes(role) && OWN_SCOPED_FOR_BOUND_ROLES.includes(permission);
}

export function isRecordBound(role: Role): boolean {
  return BOUND_ROLES.includes(role);
}

export const PERMISSION_SCOPE: Record<Permission, Scope> = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, "company"]),
) as Record<Permission, Scope>;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  // Fail closed on a role the matrix does not know (for example a user record restored from
  // a hand-edited backup). This used to throw and take the whole screen down.
  const granted = ROLE_PERMISSIONS[role];
  return Array.isArray(granted) && granted.includes(permission);
}
