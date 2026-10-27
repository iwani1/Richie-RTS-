import type { Permission } from "./tms/permissions";
import type { Role } from "./tms/types";

export type Route =
  | "dashboard"
  | "finance"
  | "rentals"
  | "invoices"
  | "statements"
  | "expenses"
  | "reports"
  | "busing"
  | "logistics"
  | "fleet"
  | "fleetReadiness"
  | "vehicles"
  | "drivers"
  | "clients"
  | "contracts"
  | "users"
  | "settings"
  | "audit"
  | "profile"
  | "compliance"
  | "driver_portal"
  | "client_portal"
  | "passenger_portal";

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
  // FIN-07: finance lands on the money home, not the operations board. The gate is the invoice read
  // permission, not the KPI one: this screen is about invoiced money, payments and what is owed, and
  // operations holds no invoice access at all (D-60). The server narrows the payload the same way, so
  // an account that may not read invoices receives no invoices to total.
  { route: "finance", label: "Finance", caption: "Money in, out and owed", permission: "invoices:read" },
  { route: "driver_portal", label: "My runs", caption: "Assigned work and problems", permission: null, roles: ["driver"] },
  { route: "client_portal", label: "My account", caption: "Routes, staff and rentals", permission: null, roles: ["client_contact"] },
  // A rider's own desk (PAX-01, D-97). No permission gate: the server has already narrowed the
  // payload to this rider's record, so there is nothing here an unlinked account could read.
  { route: "passenger_portal", label: "My journeys", caption: "Bus, stop and seat", permission: null, roles: ["passenger"] },
  { route: "rentals", label: "Bus rentals", caption: "Requests to billing", permission: "rentals:read" },
  { route: "invoices", label: "Invoices", caption: "Billing and payments", permission: "invoices:read" },
  // One customer's whole account, aged: the paper the office chases money with (FIN-02, D-90). Gated by
  // the invoice read permission because it is invoice, payment and credit-note data, nothing else.
  { route: "statements", label: "Statements", caption: "Who owes what, by age", permission: "invoices:read" },
  // Spending that is not a repair: fuel, tolls, permits (FIN-05, D-93). Its own read permission,
  // because operations reads costs without entering them.
  { route: "expenses", label: "Expenses", caption: "Fuel, tolls, receipts", permission: "expenses:read" },
  { route: "reports", label: "Reports", caption: "Rentals, revenue, utilisation", permission: "kpis:read" },
  { route: "busing", label: "Staff busing", caption: "Routes, rosters, trips", permission: "routes:read" },
  { route: "logistics", label: "Staff logistics", caption: "Breakdowns, maintenance, costs", permission: "incidents:read" },
  // What the fleet had and did with its days, and what standing still cost (FLT-05, D-112). Read on
  // the fleet permission: it is vehicles, runs, hires and work orders, and holds no money of its own
  // beyond the standing cost management sets.
  { route: "fleet", label: "Fleet dashboard", caption: "Utilisation and idle days", permission: "fleet:read" },
  { route: "fleetReadiness", label: "Fleet readiness", caption: "Service intervals, odometer", permission: "fleet:read" },
  { route: "compliance", label: "Compliance", caption: "Vehicle & driver documents", permission: "documents:read" },
  { route: "vehicles", label: "Vehicles", caption: "Fleet register", permission: "vehicles:read" },
  { route: "drivers", label: "Drivers", caption: "Driver register", permission: "drivers:read" },
  { route: "clients", label: "Clients", caption: "Corporate accounts", permission: "clients:read" },
  // The agreements behind the accounts (CLI-02, D-95). Read on its own permission: a client's own
  // contact also holds it, scoped to its own account.
  { route: "contracts", label: "Contracts", caption: "Agreements and renewals", permission: "contracts:read" },
  { route: "users", label: "Users", caption: "Accounts and roles", permission: "users:read" },
  { route: "settings", label: "Settings", caption: "Business rules", permission: "settings:read" },
  { route: "audit", label: "Audit log", caption: "Who changed what", permission: "audit:read" },
  { route: "profile", label: "My account", caption: "Your details and sign-ins", permission: null },
];
