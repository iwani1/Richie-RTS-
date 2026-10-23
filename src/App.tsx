import { useState } from "react";
import { BriefDesk } from "./docs/BriefDesk";
import { AuditPage } from "./pages/Audit";
import { SetupPage, SignInPage } from "./pages/Auth";
import { DashboardPage } from "./pages/Dashboard";
import { ClientsPage, DriversPage } from "./pages/Registers";
import { RentalsPage } from "./pages/Rentals";
import { StaffBusingPage } from "./pages/StaffBusing";
import { StaffLogisticsPage } from "./pages/StaffLogistics";
import { CompliancePage } from "./pages/Compliance";
import { FleetReadinessPage } from "./pages/FleetReadiness";
import { ClientPortalPage } from "./pages/ClientPortal";
import { DriverPortalPage } from "./pages/DriverPortal";
import { isRecordBound } from "./tms/permissions";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { VehiclesPage } from "./pages/Vehicles";
import { NAV_ITEMS, type Route } from "./routes";
import { ROLE_LABELS } from "./tms/types";
import { TmsContext, useTms, useTmsState } from "./tms/useTms";
import { Button, Notice } from "./ui/primitives";
import { cn } from "./utils/cn";

const NAV_GROUPS: { label: string; routes: Route[] }[] = [
  { label: "My desk", routes: ["driver_portal", "client_portal"] },
  { label: "Service desk", routes: ["dashboard", "rentals", "busing", "logistics", "fleetReadiness"] },
  { label: "Fleet & clients", routes: ["compliance", "vehicles", "drivers", "clients"] },
  { label: "Administration", routes: ["users", "settings", "audit"] },
  { label: "Archive", routes: ["documents"] },
];

function initialsOf(name: string | undefined): string {
  if (!name) return "RT";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default function App() {
  const tms = useTmsState();
  return (
    <TmsContext.Provider value={tms}>
      {tms.db.users.length === 0 ? <SetupPage /> : !tms.actor ? <SignInPage /> : <Shell />}
    </TmsContext.Provider>
  );
}

function Shell() {
  const { db, actor, allowed, signOut, flash, setFlash, storageError } = useTms();
  // Record-bound roles (driver, client_contact) are confined to their own portal.
  // The internal screens read company-wide records, so those roles must not reach them.
  const portalRoute: Route | null =
    actor?.role === "driver" ? "driver_portal" : actor?.role === "client_contact" ? "client_portal" : null;
  const bound = actor ? isRecordBound(actor.role) : false;
  const [requestedRoute, setRoute] = useState<Route>(portalRoute ?? "dashboard");
  const [navOpen, setNavOpen] = useState(false);

  const items =
    bound && portalRoute
      ? NAV_ITEMS.filter((item) => item.route === portalRoute || item.route === "documents")
      : NAV_ITEMS.filter((item) => !item.permission || allowed(item.permission));

  // Derive the route actually shown during render, rather than correcting state after the
  // fact in an effect. A record-bound role never gets a render of a screen outside its scope.
  const route: Route = items.some((i) => i.route === requestedRoute) ? requestedRoute : (portalRoute ?? "dashboard");

  const navigate = (next: Route) => {
    setRoute(next);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  if (route === "documents") return <BriefDesk onExit={() => navigate("dashboard")} />;

  const page = (() => {
    switch (route) {
      case "rentals": return <RentalsPage navigate={navigate} />;
      case "busing": return <StaffBusingPage />;
      case "logistics": return <StaffLogisticsPage />;
      case "fleetReadiness": return <FleetReadinessPage />;
      case "compliance": return <CompliancePage />;
      case "driver_portal": return <DriverPortalPage />;
      case "client_portal": return <ClientPortalPage />;
      case "vehicles": return <VehiclesPage navigate={navigate} />;
      case "drivers": return <DriversPage />;
      case "clients": return <ClientsPage />;
      case "users": return <UsersPage />;
      case "settings": return <SettingsPage />;
      case "audit": return <AuditPage />;
      default: return <DashboardPage navigate={navigate} />;
    }
  })();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.routes
      .map((r) => items.find((item) => item.route === r))
      .filter((item): item is (typeof items)[number] => Boolean(item)),
  })).filter((group) => group.items.length > 0);

  const activeLabel = items.find((i) => i.route === route)?.label ?? "Dashboard";
  const today = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  // Running ledger numbers per visible group, computed without mutating during render.
  const numberedGroups = visibleGroups.reduce<{ label: string; items: { item: (typeof items)[number]; index: number }[] }[]>(
    (acc, group) => {
      const start = acc.reduce((total, prior) => total + prior.items.length, 0);
      return [...acc, { label: group.label, items: group.items.map((item, offset) => ({ item, index: start + offset + 1 })) }];
    },
    [],
  );

  return (
    <div className="rts-shell">
      {navOpen && <button type="button" className="rts-scrim-mobile" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

      <aside className={cn("rts-rail", navOpen && "is-open")} aria-label="Workspace navigation">
        <div className="rts-brand">
          <div className="rts-mark" aria-hidden="true">R</div>
          <div className="min-w-0">
            <p className="rts-wordmark">
              Richie
              <span className="truncate" title={db.settings.companyName ?? "Richie Transport Services"}>
                {(db.settings.companyName ?? "Richie Transport Services").toUpperCase()} · LEDGER
              </span>
            </p>
          </div>
        </div>

        <nav className="rts-nav" aria-label="Main">
          {numberedGroups.map((group) => (
            <div className="rts-nav-group" key={group.label}>
              <p className="rts-nav-label">{group.label}</p>
              {group.items.map(({ item, index }) => {
                const active = route === item.route;
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => navigate(item.route)}
                    aria-current={active ? "page" : undefined}
                    className="rts-nav-item"
                  >
                    <span className="rts-nav-index" aria-hidden="true">{String(index).padStart(2, "0")}</span>
                    <span className="rts-nav-copy">
                      <strong>{item.label}</strong>
                      <small>{item.caption}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="rts-rail-foot">
          <div className="rts-rail-note">
            <span aria-hidden="true">▣</span> LOCAL LEDGER · NO SERVER
          </div>
          <div className="rts-user">
            <div className="rts-avatar" aria-hidden="true">{initialsOf(actor?.fullName)}</div>
            <div className="min-w-0">
              <strong className="truncate">{actor?.fullName}</strong>
              <small>{actor ? ROLE_LABELS[actor.role].toUpperCase() : ""}</small>
            </div>
          </div>
          <button type="button" className="rts-btn rts-btn--rail" onClick={signOut}>
            <span>Sign out</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </aside>

      <div className="rts-main-wrap">
        <header className="rts-topbar">
          <div className="rts-topbar-start">
            <Button className="rts-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation">Menu</Button>
            <div className="rts-crumbs">
              <span>RTS</span>
              <span className="rts-crumb-dash" aria-hidden="true" />
              <b>{activeLabel}</b>
            </div>
          </div>
          <div className="rts-top-right">
            <span className="rts-date">{today}</span>
            <span
              className="rts-chip"
              title="This build stores data in the browser. A server and PostgreSQL are not configured in this environment."
            >
              <i aria-hidden="true" /> Browser-local · no server
            </span>
          </div>
        </header>

        <main className="rts-main" id="main-content">
          <div className="rts-main-inner">
            {storageError && <Notice tone="error" className="mb-4">{storageError}</Notice>}
            {flash && (
              <div className="rts-flash-row">
                <Notice tone={flash.tone} className="flex-1">{flash.message}</Notice>
                <Button variant="ghost" onClick={() => setFlash(null)} aria-label="Dismiss">Dismiss</Button>
              </div>
            )}
            {page}
            <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--rts-line-strong)] pt-3 font-mono text-[8px] uppercase tracking-[0.14em] text-[#7d8375]">
              <span>Richie Transport Services · Operations Ledger</span>
              <span>Browser-local data · export before clearing site storage</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
