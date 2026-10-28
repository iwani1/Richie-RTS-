import { useCallback, useEffect, useState } from "react";
import {
  BusFront,
  Building2,
  CalendarClock,
  ChartColumn,
  ChevronRight,
  CircleUser,
  ClipboardList,
  Gauge,
  LogOut,
  Menu,
  type LucideIcon,
  PanelsTopLeft,
  Receipt,
  Route as RouteIcon,
  Search,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AuditPage } from "./screens/Audit";
import { SetupPage, SignInPage } from "./screens/Auth";
import { DashboardPage } from "./screens/Dashboard";
import { ClientsPage, DriversPage } from "./screens/Registers";
import { ContractsPage } from "./screens/Contracts";
import { RentalsPage } from "./screens/Rentals";
import { InvoicesPage } from "./screens/Invoices";
import { StatementsPage } from "./screens/Statements";
import { ExpensesPage } from "./screens/Expenses";
import { ProfilePage } from "./screens/Profile";
import { ReportsPage } from "./screens/Reports";
import { FinanceHomePage } from "./screens/FinanceHome";
import { StaffBusingPage } from "./screens/StaffBusing";
import { DispatchBoardPage } from "./screens/DispatchBoard";
import { StaffLogisticsPage } from "./screens/StaffLogistics";
import { CompliancePage } from "./screens/Compliance";
import { FleetReadinessPage } from "./screens/FleetReadiness";
import { FleetPage } from "./screens/Fleet";
import { ClientPortalPage } from "./screens/ClientPortal";
import { PassengerPortalPage } from "./screens/PassengerPortal";
import { DriverPortalPage } from "./screens/DriverPortal";
import { isRecordBound } from "./tms/permissions";
import { awaitingPrice } from "./tms/rentalWorkflow";
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
import { Notice } from "./ui/primitives";
import { CommandPalette } from "./ui/CommandPalette";
import { cn } from "@/lib/utils";

const NAV_GROUPS: { label: string; routes: Route[] }[] = [
  { label: "My desk", routes: ["driver_portal", "client_portal", "passenger_portal"] },
  { label: "Service desk", routes: ["dashboard", "finance", "rentals", "invoices", "statements", "expenses", "dispatch", "busing", "logistics", "fleetReadiness"] },
  { label: "Fleet & clients", routes: ["fleet", "compliance", "vehicles", "drivers", "clients", "contracts"] },
  { label: "Analysis", routes: ["reports"] },
  { label: "Administration", routes: ["users", "settings", "audit", "profile"] },
];

const ROUTE_ICONS: Record<Route, LucideIcon> = {
  dashboard: PanelsTopLeft,
  finance: Wallet,
  rentals: CalendarClock,
  invoices: Receipt,
  statements: Wallet,
  expenses: Receipt,
  reports: ChartColumn,
  busing: BusFront,
  dispatch: RouteIcon,
  logistics: ClipboardList,
  fleet: Gauge,
  fleetReadiness: Gauge,
  compliance: ShieldCheck,
  vehicles: Truck,
  drivers: CircleUser,
  clients: Building2,
  contracts: Building2,
  users: Users,
  settings: Settings2,
  audit: ClipboardList,
  profile: CircleUser,
  driver_portal: BusFront,
  client_portal: Building2,
  passenger_portal: BusFront,
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
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-xl rounded-xl border border-border bg-card p-8 shadow-sm" role="status" aria-live="polite">
        <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Richie Transport Services</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
        {preformatted ? (
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">{message}</pre>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
        )}
        {error && onRetry && (
          <Button variant="default" size="sm" className="mt-5" onClick={() => void onRetry()}>
            Try again
          </Button>
        )}
      </section>
    </main>
  );
}

function Shell() {
  const { db, actor, allowed, signOut, flash, setFlash, connectionError, busy } = useTms();
  // Record-bound roles (driver, client_contact) are confined to their own portal.
  // The internal screens read company-wide records, so those roles must not reach them.
  const portalRoute: Route | null =
    actor?.role === "driver"
      ? "driver_portal"
      : actor?.role === "client_contact"
        ? "client_portal"
        : actor?.role === "passenger"
          ? "passenger_portal"
          : null;
  // A finance account opens on the money home (FIN-07); everybody else opens on the operations board.
  const homeRoute: Route = actor?.role === "finance" ? "finance" : (portalRoute ?? "dashboard");
  const bound = actor ? isRecordBound(actor.role) : false;
  const [requestedRoute, setRoute] = useState<Route>(homeRoute);
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
  const route: Route = items.some((i) => i.route === requestedRoute) ? requestedRoute : homeRoute;

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
      case "invoices": return <InvoicesPage />;
      case "statements": return <StatementsPage />;
      case "expenses": return <ExpensesPage />;
      case "finance": return <FinanceHomePage navigate={navigate} />;
      case "reports": return <ReportsPage />;
      case "dispatch": return <DispatchBoardPage navigate={navigate} />;
      case "busing": return <StaffBusingPage />;
      case "logistics": return <StaffLogisticsPage />;
      case "fleet": return <FleetPage />;
      case "fleetReadiness": return <FleetReadinessPage />;
      case "compliance": return <CompliancePage />;
      case "driver_portal": return <DriverPortalPage />;
      case "client_portal": return <ClientPortalPage />;
      case "passenger_portal": return <PassengerPortalPage />;
      case "vehicles": return <VehiclesPage navigate={navigate} />;
      case "drivers": return <DriversPage />;
      case "clients": return <ClientsPage />;
      case "contracts": return <ContractsPage />;
      case "users": return <UsersPage />;
      case "settings": return <SettingsPage />;
      case "audit": return <AuditPage />;
      case "profile": return <ProfilePage />;
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
    rentals: db.rentals.filter((r) => awaitingPrice(r.status)).length,
    busing: db.trips.filter((t) => t.serviceDate === today && t.status === "planned").length,
    // The badge is the day's outstanding problem, not a count of everything: runs still to leave with
    // no vehicle or no driver on them (DSP-01, D-115).
    dispatch: db.trips.filter(
      (t) => t.serviceDate === today && (t.status === "planned" || t.status === "dispatched") && (!t.vehicleId || !t.driverId),
    ).length,
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

  // One sidebar, rendered once and used twice: fixed on a desk, inside a sheet on a phone.
  const rail = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">R</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-sidebar-accent-foreground">Richie TMS</p>
          <p className="truncate text-[11px] text-sidebar-foreground/70" title={db.settings.companyName ?? "Richie Transport Services"}>
            {db.settings.companyName ?? "Richie Transport Services"}
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Sections">
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-2 pb-1.5 font-mono text-[9.5px] font-medium tracking-[0.13em] text-sidebar-foreground/55 uppercase">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = route === item.route;
                const count = counts[item.route] ?? 0;
                const Glyph = ROUTE_ICONS[item.route];
                return (
                  <li key={item.route}>
                    <button
                      type="button"
                      onClick={() => navigate(item.route)}
                      aria-current={active ? "page" : undefined}
                      title={`${item.label} — ${item.caption}`}
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active
                          ? "bg-primary/12 font-semibold text-sidebar-accent-foreground"
                          : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Glyph className={cn("size-4 shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {count > 0 && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "h-5 min-w-5 justify-center rounded-md border-transparent px-1.5 font-mono text-[10px] tabular-nums",
                            active ? "bg-primary text-primary-foreground" : "bg-sidebar-accent text-sidebar-accent-foreground",
                          )}
                        >
                          {count}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-sidebar-border px-2 py-3">
        <button
          type="button"
          onClick={openPalette}
          aria-keyshortcuts="Control+K Meta+K"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Search className="size-4 shrink-0 text-sidebar-foreground/60" aria-hidden="true" />
          <span className="flex-1 text-left">Jump to a screen</span>
          <kbd className="rounded border border-sidebar-border px-1 font-mono text-[9.5px] text-sidebar-foreground/70">Ctrl K</kbd>
        </button>

        <div className="flex items-center justify-between px-2">
          <span className="font-mono text-[13px] tabular-nums text-sidebar-accent-foreground" aria-label={clock ? `Current time ${clock}` : undefined}>
            {clock ?? "--:--"}
          </span>
          <span className="text-[10.5px] text-sidebar-foreground/60">{todayLabel}</span>
        </div>

        <Separator className="bg-sidebar-border" />

        <div className="flex items-center gap-2.5 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-sidebar-accent text-[10px] font-semibold text-sidebar-accent-foreground">
              {initialsOf(actor?.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-sidebar-accent-foreground">{actor?.fullName}</p>
            <p className="truncate text-[10.5px] text-sidebar-foreground/60">{actor ? ROLE_LABELS[actor.role] : "Unknown role"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void signOut()}
            aria-label="Sign out"
            title="Sign out"
            className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background" data-route={route}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border lg:block" aria-label="Main">
        {rail}
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0" aria-label="Main">
          <SheetTitle className="sr-only">Sections</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-none lg:px-7">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            <Menu aria-hidden="true" />
          </Button>

          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            <span className="hidden sm:inline">{currentGroup}</span>
            <ChevronRight className="hidden size-3 sm:inline" aria-hidden="true" />
            <span className="truncate text-foreground">{currentLabel}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {busy && (
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground" role="status">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                Saving
              </span>
            )}
            <button
              type="button"
              onClick={openPalette}
              aria-keyshortcuts="Control+K Meta+K"
              className="hidden items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:flex"
            >
              <Search className="size-3.5" aria-hidden="true" />
              <span>Search or jump to a screen</span>
              <kbd className="rounded border border-border px-1 font-mono text-[9.5px]">Ctrl K</kbd>
            </button>
            <Avatar className="size-7" title={actor ? `${actor.fullName} — ${ROLE_LABELS[actor.role]}` : "Signed in"}>
              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">{initialsOf(actor?.fullName)}</AvatarFallback>
            </Avatar>
            <span className="sr-only">Signed in as {actor?.fullName ?? "an operator"}</span>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-5 pb-10 lg:px-7" id="main-content">
          {connectionError && <Notice tone="error" className="mb-4">{connectionError}</Notice>}
          {flash && (
            <div className="mb-4 flex items-start gap-2">
              <Notice tone={flash.tone} className="flex-1">{flash.message}</Notice>
              <Button variant="ghost" onClick={() => setFlash(null)} aria-label="Dismiss">
                Dismiss
              </Button>
            </div>
          )}
          <div className="min-h-[40vh]">{page}</div>
          <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
            <span>Richie Transport Services · Operations workspace</span>
            <span>Every change is attributed and audit-logged</span>
            <span className="font-mono">build {process.env.NEXT_PUBLIC_BUILD ?? "unknown"}</span>
          </footer>
        </main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={navigate} allowed={allowed} />}
    </div>
  );
}
