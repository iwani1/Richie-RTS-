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
  // Spending that is not a repair (D-93). Recording it is a money job; operations reads it because
  // fuel and tolls are how its own runs are priced, but does not enter it.
  "expenses:read",
  "expenses:record",
  "expenses:void",
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
    "rentals:read",
    "rentals:create",
    "rentals:update",
    "rentals:quote",
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
    "vehicles:read",
    "drivers:read",
    "rentals:read",
    "rentals:quote",
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
  client_contact: ["routes:read", "passengers:read", "rentals:read", "rentals:create", "bookings:read", "bookings:create"],
};

// Record-bound roles hold their permissions against their own records only. The same
// permissions are company-scoped when held by internal staff.
const BOUND_ROLES: readonly Role[] = ["driver", "client_contact"];
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
