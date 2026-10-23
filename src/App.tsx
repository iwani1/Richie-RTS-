import { useCallback, useEffect, useState } from "react";
import { BriefDesk } from "./docs/BriefDesk";
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
  { label: "Archive", routes: ["documents"] },
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
  documents: "archive",
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
  const title = /Invalid server configuration|must be at least|is required/i.test(message)
    ? "The server needs configuration"
    : error
      ? "Cannot reach the ledger"
      : "Opening the ledger";
  return (
    <main className="rts-auth">
      <section className="rts-auth-side">
        <div className="rts-auth-card" role="status" aria-live="polite">
          <p className="rts-auth-eyebrow">Richie Transport Services</p>
          <h1 className="rts-auth-title">{title}</h1>
          <p className="rts-auth-intro">{message}</p>
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

  const today = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  // Running index numerals per visible group, computed without mutating during render: the rail
  // reads as a ledger tab index (01…14) rather than a list of links.
  const numberedGroups = visibleGroups.reduce<{ label: string; items: { item: (typeof items)[number]; index: number }[] }[]>(
    (acc, group) => {
      const start = acc.reduce((total, prior) => total + prior.items.length, 0);
      return [...acc, { label: group.label, items: group.items.map((item, offset) => ({ item, index: start + offset + 1 })) }];
    },
    [],
  );

  return (
    <div className="rts-shell">
      <a className="rts-skip" href="#main-content">Skip to content</a>

      {navOpen && (
        <button type="button" className="rts-scrim-mobile" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
      )}

      {/* The board's header. Identity and the clock sit on one row; every destination sits on the
          next, grouped, because a dispatcher switches between busing, rentals and logistics all
          afternoon and should not open a menu to do it. */}
      <header className={cn("rts-topnav", navOpen && "is-open")}>
        <div className="rts-topnav-primary">
          <div className="rts-brand">
            <div className="rts-mark" aria-hidden="true">R</div>
            <p className="rts-wordmark">
              Richie
              <span title={db.settings.companyName ?? "Richie Transport Services"}>
                {(db.settings.companyName ?? "Richie Transport Services").toUpperCase()} · OPERATIONS
              </span>
            </p>
          </div>

          <Button className="rts-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            Menu
          </Button>

          <div className="rts-top-right">
            <button type="button" className="rts-palette-trigger" onClick={openPalette} aria-keyshortcuts="Control+K Meta+K">
              <Icon name="search" className="rts-palette-trigger-icon" />
              <span className="rts-palette-trigger-text">Jump to a screen</span>
              <kbd className="rts-kbd">Ctrl K</kbd>
            </button>
            {busy && (
              <span className="rts-busy" role="status">
                <span className="rts-busy-bar" aria-hidden="true" />
                Saving
              </span>
            )}
            <span className="rts-clock" aria-label={clock ? `Current time ${clock}` : undefined}>{clock ?? "--:--"}</span>
            <span className="rts-date">{today}</span>
            <div className="rts-user">
              <div className="rts-avatar" aria-hidden="true">{initialsOf(actor?.fullName)}</div>
              <div className="min-w-0">
                <strong className="truncate">{actor?.fullName}</strong>
                <small>{actor ? (ROLE_LABELS[actor.role] ?? "UNKNOWN ROLE").toUpperCase() : ""}</small>
              </div>
            </div>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </div>

        <nav className="rts-topnav-tabs" aria-label="Main">
          {numberedGroups.map((group) => (
            <div className="rts-nav-group" key={group.label}>
              <p className="rts-nav-label">{group.label}</p>
              <div className="rts-nav">
                {group.items.map(({ item, index }) => {
                  const active = route === item.route;
                  return (
                    <button
                      key={item.route}
                      type="button"
                      onClick={() => navigate(item.route)}
                      aria-current={active ? "page" : undefined}
                      className="rts-nav-item"
                      title={`${item.label} — ${item.caption}`}
                    >
                      <span className="rts-nav-index" aria-hidden="true">{String(index).padStart(2, "0")}</span>
                      <Icon name={ROUTE_ICONS[item.route]} className="rts-nav-icon" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </header>

      <div className="rts-main-wrap">

        <main className="rts-main" id="main-content">
          <div className="rts-main-inner">
            {connectionError && <Notice tone="error" className="mb-4">{connectionError}</Notice>}
            {flash && (
              <div className="rts-flash-row">
                <Notice tone={flash.tone} className="flex-1">{flash.message}</Notice>
                <Button variant="ghost" onClick={() => setFlash(null)} aria-label="Dismiss">Dismiss</Button>
              </div>
            )}
            <div className="rts-screen" data-route={route}>
              {page}
            </div>
            <footer className="rts-provenance">
              <span>Richie Transport Services · Operations ledger</span>
              <span>Every change is attributed and audit-logged</span>
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
