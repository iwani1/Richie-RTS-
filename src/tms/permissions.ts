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
  "incidents:read",
  "incidents:create",
  "incidents:update",
  "incidents:advance",
  "incidents:cost",
  "maintenance:read",
  "maintenance:create",
  "maintenance:update",
  "maintenance:advance",
  "maintenance:cost",
  "costs:read",
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
    "incidents:read",
    "incidents:create",
    "incidents:update",
    "incidents:advance",
    "maintenance:read",
    "maintenance:create",
    "maintenance:update",
    "maintenance:advance",
    "costs:read",
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
    "passengers:read",
    "trips:read",
    "incidents:read",
    "incidents:cost",
    "maintenance:read",
    "maintenance:cost",
    "costs:read",
    "documents:read",
    "kpis:read",
    "settings:read",
    "audit:read",
  ],
  // Own-record scope: a driver sees only the runs and incidents for the vehicle and
  // trips assigned to their linked driver record. See PERMISSIONS.md "Own-record scope".
  // trips:start, trips:record and trips:complete are own-record: a driver starts only its
  // assigned run, records its next stop, then completes after every stop is logged.
  // documents:read is own-record: a driver sees compliance documents for its own
  // driver record and for vehicles it has been assigned to, read-only.
  driver: ["trips:read", "trips:start", "trips:record", "trips:complete", "incidents:read", "incidents:create", "documents:read"],
  // Own-record scope: a client contact sees only its own client's routes, roster and
  // rental requests, and may raise a rental request for that client.
  client_contact: ["routes:read", "passengers:read", "rentals:read", "rentals:create"],
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
