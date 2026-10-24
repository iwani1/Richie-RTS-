import { useCallback, useEffect, useState } from "react";
import { AuditPage } from "./screens/Audit";
import { SetupPage, SignInPage } from "./screens/Auth";
import { DashboardPage } from "./screens/Dashboard";
import { ClientsPage, DriversPage } from "./screens/Registers";
import { RentalsPage } from "./screens/Rentals";
import { StaffBusingPage } from "./screens/StaffBusing";
import { StaffLogisticsPage } from "./screens/StaffLogistics";
import { CompliancePage } from "./screens/Compliance";
import { FleetReadinessPage } from "./screens/FleetReadiness";
import { ClientPortalPage } from "./screens/ClientPortal";
import { DriverPortalPage } from "./screens/DriverPortal";
import { isRecordBound } from "./tms/permissions";
import { SettingsPage } from "./screens/Settings";
import { UsersPage } from "./screens/Users";
import { VehiclesPage } from "./screens/Vehicles";
import { NAV_ITEMS, type Route } from "./routes";
import { documentStatus } from "./tms/compliance";
import { readinessReport } from "./tms/maintenance";
import { setupProgress } from "./tms/setup";
import { todayYmd } from "./ui/primitives";
import { ROLE_LABELS } from "./tms/types";
import { TmsContext, useTms, useTmsState } from "./tms/useTms";
import { Button, Notice } from "./ui/primitives";
import { CommandPalette } from "./ui/CommandPalette";
import { Icon, type IconName } from "./ui/icons";
import { cn } from "./utils/cn";

const NAV_GROUPS: { label: string; routes: Route[] }[] = [
  { label: "My desk", routes: ["driver_portal", "client_portal"] },
  { label: "Service desk", routes: ["dashboard", "rentals", "busing", "logistics", "fleetReadiness"] },
  { label: "Fleet & clients", routes: ["compliance", "vehicles", "drivers", "clients"] },
  { label: "Administration", routes: ["users", "settings", "audit"] },
];

const ROUTE_ICONS: Record<Route, IconName> = {
  dashboard: "dashboard",
  rentals: "rental",
  busing: "busing",
  logistics: "logistics",
  fleetReadiness: "readiness",
  compliance: "compliance",
  vehicles: "vehicle",
  drivers: "driver",
  clients: "client",
  users: "user",
  settings: "settings",
  audit: "audit",
  driver_portal: "busing",
  client_portal: "client",
};


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
      {tms.status === "loading" ? (
        <BootScreen message="Contacting the server..." />
      ) : tms.status === "offline" ? (
        <BootScreen message={tms.connectionError ?? "The server is not reachable."} error onRetry={tms.refresh} />
      ) : tms.setupRequired ? (
        <SetupPage />
      ) : !tms.actor ? (
        <SignInPage />
      ) : (
        <Shell />
      )}
    </TmsContext.Provider>
  );
}

/**
 * Shown while the browser is waiting for /api/session, and when that call fails. It replaces the
 * prototype's habit of silently rendering an empty local database, which looked like "no data"
 * when the truth was "no server".
 */
function BootScreen({ message, error, onRetry }: { message: string; error?: boolean; onRetry?: () => void }) {
  // A configuration error is not a reachability problem: say which it is, so the reader does not
  // go looking for a stopped server when the answer is in .env.
  // Each failure this screen can show has its own cause, and the title says which one it is rather
  // than a generic "cannot reach". A message written as a list of steps is rendered as preformatted
  // text so its indentation survives; a one-line message stays a paragraph.
  const misconfigured = /Invalid server configuration|must be at least|is required/i.test(message);
  const title = misconfigured
    ? "The server needs configuration"
    : /rejected the password/i.test(message)
      ? "The database rejected the password"
      : /database named in DATABASE_URL does not exist/i.test(message)
        ? "The database does not exist"
        : /schema has not been created|schema is incomplete/i.test(message)
          ? "The database needs migrating"
          : error
            ? "Cannot reach the server"
            : "Opening the workspace";
  const preformatted = misconfigured || message.includes("\n");
  return (
    <main className="rts-auth rts-auth--solo">
      <section className="rts-auth-side">
        <div className="rts-auth-card" role="status" aria-live="polite">
          <p className="rts-auth-eyebrow">Richie Transport Services</p>
          <h1 className="rts-auth-title">{title}</h1>
          {preformatted ? <pre className="rts-auth-config">{message}</pre> : <p className="rts-auth-intro">{message}</p>}
          {error && onRetry && (
            <Button variant="primary" onClick={() => void onRetry()} className="mt-4">
              Try again
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

function Shell() {
  const { db, actor, allowed, signOut, flash, setFlash, connectionError, busy } = useTms();
  // Record-bound roles (driver, client_contact) are confined to their own portal.
  // The internal screens read company-wide records, so those roles must not reach them.
  const portalRoute: Route | null =
    actor?.role === "driver" ? "driver_portal" : actor?.role === "client_contact" ? "client_portal" : null;
  const bound = actor ? isRecordBound(actor.role) : false;
  const [requestedRoute, setRoute] = useState<Route>(portalRoute ?? "dashboard");
  const [navOpen, setNavOpen] = useState(false);
  // The board carries a clock because a dispatcher reads this screen against the wall clock. It is
  // rendered only after mount, so the server and the first client render cannot disagree.
  const [clock, setClock] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items =
    bound && portalRoute
      ? NAV_ITEMS.filter((item) => item.route === portalRoute)
      : NAV_ITEMS.filter((item) => !item.permission || allowed(item.permission));

  // Derive the route actually shown during render, rather than correcting state after the
  // fact in an effect. A record-bound role never gets a render of a screen outside its scope.
  const route: Route = items.some((i) => i.route === requestedRoute) ? requestedRoute : (portalRoute ?? "dashboard");

  const navigate = (next: Route) => {
    setRoute(next);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // ⌘K on a Mac, Ctrl-K everywhere else. Ignored while typing in a field so a stray shortcut never
  // steals a keystroke from a form.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.key === "k" || event.key === "K")) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  const todayLabel = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  // Counts beside the destinations. Each one is a number the section can back up: rentals waiting
  // on us, runs not yet dispatched today, vehicles past their service interval, warnings on
  // compliance. A zero is not shown, because a badge that says 0 is noise.
  const today = todayYmd();
  const readiness = readinessReport(db, today);
  const setup = setupProgress(db.settings);
  const counts: Partial<Record<Route, number>> = {
    rentals: db.rentals.filter((r) => r.status === "draft" || r.status === "quoted").length,
    busing: db.trips.filter((t) => t.serviceDate === today && t.status === "planned").length,
    fleetReadiness: readiness.status === "not_configured" ? 0 : readiness.counts.overdue,
    logistics: db.incidents.filter((i) => i.status !== "closed" && i.status !== "resolved").length,
    compliance: db.documents.filter((doc) => {
      const state = documentStatus(doc.expiryDate, db.settings.documentReminderLeadDays, today);
      return state === "expired" || state === "expiring_soon";
    }).length,
    settings: setup.outstanding,
  };

  const currentLabel = items.find((item) => item.route === route)?.label ?? "Dashboard";
  const currentGroup = visibleGroups.find((group) => group.items.some((item) => item.route === route))?.label ?? "Operations";

  return (
    <div className="rts-shell" data-route={route}>
      <a className="rts-skip" href="#main-content">Skip to content</a>

      {navOpen && (
        <button type="button" className="rts-scrim-mobile" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
      )}

      {/* The sidebar: identity, the installation you are looking at, every destination grouped with
          its outstanding count, then the desk's instruments at the foot. */}
      <aside className={cn("rts-side", navOpen && "is-open")} aria-label="Main">
        <div className="rts-side-top">
          <div className="rts-brand">
            <div className="rts-mark" aria-hidden="true">R</div>
            <p className="rts-wordmark">
              Richie TMS
              <span title={db.settings.companyName ?? "Richie Transport Services"}>
                {db.settings.companyName ?? "Richie Transport Services"}
              </span>
            </p>
          </div>
          <Button className="rts-menu" variant="ghost" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            Close
          </Button>
        </div>

        <div className="rts-workspace">
          <i aria-hidden="true" />
          {actor ? ROLE_LABELS[actor.role] : "Signed in"}
          <small>signed in</small>
        </div>

        <nav className="rts-spine-nav" aria-label="Sections">
          {visibleGroups.map((group) => (
            <div className="rts-nav-group" key={group.label}>
              <p className="rts-nav-label">{group.label}</p>
              <div className="rts-nav">
                {group.items.map((item) => {
                  const active = route === item.route;
                  const count = counts[item.route] ?? 0;
                  return (
                    <button
                      key={item.route}
                      type="button"
                      onClick={() => navigate(item.route)}
                      aria-current={active ? "page" : undefined}
                      className="rts-nav-item"
                      title={`${item.label} — ${item.caption}`}
                    >
                      <Icon name={ROUTE_ICONS[item.route]} className="rts-nav-icon" />
                      <span className="rts-nav-name">{item.label}</span>
                      {count > 0 && (
                        <span
                          className={cn(
                            "rts-nav-badge",
                            item.route === "compliance" && "rts-nav-badge--alert",
                            item.route === "fleetReadiness" && "rts-nav-badge--warn",
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="rts-side-foot">
          <button type="button" className="rts-nav-item" onClick={openPalette} aria-keyshortcuts="Control+K Meta+K">
            <Icon name="search" className="rts-nav-icon" />
            <span className="rts-nav-name">Jump to a screen</span>
            <span className="rts-kbd">Ctrl K</span>
          </button>
          <div className="rts-spine-clock">
            <span className="rts-clock" aria-label={clock ? `Current time ${clock}` : undefined}>{clock ?? "--:--"}</span>
            <span className="rts-date">{todayLabel}</span>
          </div>
          <div className="rts-user">
            <div className="rts-avatar" aria-hidden="true">{initialsOf(actor?.fullName)}</div>
            <div className="min-w-0">
              <strong className="truncate">{actor?.fullName}</strong>
              <small>{actor ? ROLE_LABELS[actor.role] : "Unknown role"}</small>
            </div>
          </div>
          <Button variant="ghost" className="rts-signout" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </aside>

      <div className="rts-main-wrap">
        <header className="rts-topbar">
          <Button className="rts-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            Menu
          </Button>
          <div className="rts-crumbs">
            {currentGroup}
            <Icon name="chevron" />
            <b>{currentLabel}</b>
          </div>
          <div className="rts-top-right">
            {busy && (
              <span className="rts-busy" role="status">
                <span className="rts-busy-bar" aria-hidden="true" />
                Saving
              </span>
            )}
            <button type="button" className="rts-palette-trigger" onClick={openPalette} aria-keyshortcuts="Control+K Meta+K">
              <Icon name="search" className="rts-palette-trigger-icon" />
              <span className="rts-palette-trigger-text">Search or jump to a screen</span>
              <kbd className="rts-kbd">Ctrl K</kbd>
            </button>
            <span className="rts-top-user" title={actor ? `${actor.fullName} — ${ROLE_LABELS[actor.role]}` : "Signed in"}>
              <span className="rts-avatar" aria-hidden="true">{initialsOf(actor?.fullName)}</span>
              <span className="sr-only">Signed in as {actor?.fullName ?? "an operator"}</span>
            </span>
          </div>
        </header>

        <main className="rts-main" id="main-content">
          <div className="rts-main-inner">
            {connectionError && <Notice tone="error" className="mb-4">{connectionError}</Notice>}
            {flash && (
              <div className="rts-flash-row">
                <Notice tone={flash.tone} className="flex-1">{flash.message}</Notice>
                <Button variant="ghost" onClick={() => setFlash(null)} aria-label="Dismiss">Dismiss</Button>
              </div>
            )}
            <div className="rts-screen">
              {page}
            </div>
            <footer className="rts-provenance">
              <span>Richie Transport Services · Operations workspace</span>
              <span>Every change is attributed and audit-logged</span>
              <span className="rts-build">build {process.env.NEXT_PUBLIC_BUILD ?? "unknown"}</span>
            </footer>
          </div>
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={navigate} allowed={allowed} />
      )}
    </div>
  );
}
