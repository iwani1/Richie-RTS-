import type { Permission } from "./tms/permissions";
import type { Role } from "./tms/types";

export type Route =
  | "dashboard"
  | "rentals"
  | "busing"
  | "logistics"
  | "fleetReadiness"
  | "vehicles"
  | "drivers"
  | "clients"
  | "users"
  | "settings"
  | "audit"
  | "compliance"
  | "documents"
  | "driver_portal"
  | "client_portal";

export interface NavItem {
  route: Route;
  label: string;
  caption: string;
  permission: Permission | null;
  // When present, the entry is shown only to these roles. Record-bound roles are
  // confined to their own portal by the app shell, so this marks those entries.
  roles?: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { route: "dashboard", label: "Dashboard", caption: "Setup and overview", permission: null },
  { route: "driver_portal", label: "My runs", caption: "Assigned work and problems", permission: null, roles: ["driver"] },
  { route: "client_portal", label: "My account", caption: "Routes, staff and rentals", permission: null, roles: ["client_contact"] },
  { route: "rentals", label: "Bus rentals", caption: "Requests to billing", permission: "rentals:read" },
  { route: "busing", label: "Staff busing", caption: "Routes, rosters, trips", permission: "routes:read" },
  { route: "logistics", label: "Staff logistics", caption: "Breakdowns, maintenance, costs", permission: "incidents:read" },
  { route: "fleetReadiness", label: "Fleet readiness", caption: "Service intervals, odometer", permission: "fleet:read" },
  { route: "compliance", label: "Compliance", caption: "Vehicle & driver documents", permission: "documents:read" },
  { route: "vehicles", label: "Vehicles", caption: "Fleet register", permission: "vehicles:read" },
  { route: "drivers", label: "Drivers", caption: "Driver register", permission: "drivers:read" },
  { route: "clients", label: "Clients", caption: "Corporate accounts", permission: "clients:read" },
  { route: "users", label: "Users", caption: "Accounts and roles", permission: "users:read" },
  { route: "settings", label: "Settings", caption: "Business rules", permission: "settings:read" },
  { route: "audit", label: "Audit log", caption: "Who changed what", permission: "audit:read" },
  { route: "documents", label: "Project brief", caption: "Source documents", permission: null },
];
