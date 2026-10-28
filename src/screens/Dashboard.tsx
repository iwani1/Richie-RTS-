import { ArrowRight, CalendarClock, CircleAlert, CircleCheck, ClipboardList, Gauge, Sparkles, TriangleAlert } from "lucide-react";
import { dueReminders, reminderCounts, reminderTiming } from "../tms/documentReminders";
import { awaitingCustomer, isActiveRental } from "../tms/rentalWorkflow";
import { readinessReport } from "../tms/maintenance";
import { setupProgress } from "../tms/setup";
import { useTms } from "../tms/useTms";
import {
  DIRECTION_LABELS,
  RENTAL_STATUS_LABELS,
  RENTAL_STATUSES,
  ROLE_LABELS,
  TRIP_STATUS_LABELS,
  type Trip,
} from "../tms/types";
import { formatAmount, fromMinor, sumAmounts, toMinor } from "../tms/money";
import { Badge, Button, todayYmd } from "../ui/primitives";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Route } from "../routes";

function money(amount: number, currency: string | null) {
  // formatAmount settles the pesewa with the same rule the server applies (money.ts); the formatter
  // only decides how that settled value is written down.
  if (!currency) return formatAmount(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(fromMinor(toMinor(amount)));
  } catch {
    return `${currency} ${formatAmount(amount)}`;
  }
}

/** First scheduled stop of a trip's route — the time a dispatcher actually looks for. */
function departureTime(trip: Trip, startTimes: Map<string, string>): string {
  return startTimes.get(trip.routeId) ?? "";
}

/** The last seven service dates, oldest first, for the sparkline. */
function lastSevenDays(today: string): string[] {
  const base = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(base);
    day.setUTCDate(day.getUTCDate() - (6 - offset));
    return day.toISOString().slice(0, 10);
  });
}

/** A tiny recorded series: one bar per day, the last day marked. Height is relative, never invented. */
function Spark({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mt-3 flex items-end gap-1" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={labels[index] ?? index}
          className={cn("flex-1 rounded-sm", index === values.length - 1 ? "bg-primary" : "bg-primary/20")}
          style={{ height: `${Math.max(10, Math.round((value / max) * 100))}%`, minHeight: 6 }}
          title={String(value)}
        />
      ))}
    </div>
  );
}

/** A card in the board: the title row every card shares, and a quiet action on the right. */
function BoardCard({
  title,
  note,
  action,
  children,
  className,
  id,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0 shadow-xs", className)} aria-labelledby={id}>
      <CardHeader className="flex flex-row items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 id={id} className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h2>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

function LinkAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-mr-1 shrink-0 text-muted-foreground hover:text-foreground" onClick={onClick}>
      {label}
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}

const TONE_MARK = {
  error: "bg-destructive",
  warning: "bg-amber-700",
  info: "bg-primary",
} as const;

/**
 * The operations board.
 *
 * Laid out as a board rather than a stack: cards of different sizes, each holding one kind of thing —
 * a figure with its qualifier, a list of runs, a list of decisions, a progress bar. Every number is
 * counted from the database on this request; there is no seeded trend, no target and no invented
 * comparison. Where the data cannot answer, the card says so in words.
 */
export function DashboardPage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, actor, currentUser, allowed } = useTms();
  const s = db.settings;
  const today = todayYmd();
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long" });

  // ---- setup checklist (shared with the Settings screen, one source of truth) -----------------
  const setup = setupProgress(s);
  const checklist = setup.items;
  const outstanding = setup.outstanding;
  const done = setup.done;

  // ---- exceptions ------------------------------------------------------------------------------
  const expiredLicences = db.drivers.filter((d) => d.status === "active" && d.licenceExpiry < today);
  const papers = dueReminders(db, db.settings.documentReminderLeadDays, today);
  const paperCounts = reminderCounts(db, db.settings.documentReminderLeadDays, today);
  const readiness = readinessReport(db, today);
  const awaitingConfirmation = db.rentals.filter((r) => awaitingCustomer(r.status));
  const activeRentals = db.rentals.filter((r) => isActiveRental(r.status));
  const depositsHeld = sumAmounts(activeRentals.map((r) => r.deposit?.amount ?? 0));
  const billed = sumAmounts(db.rentals.filter((r) => r.status === "completed" && r.finalInvoice).map((r) => r.finalInvoice?.total ?? 0));

  // ---- today's work ----------------------------------------------------------------------------
  const startTimes = new Map<string, string>(
    db.routes.map((route) => {
      const first = [...route.stops].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))[0];
      return [route.id, first?.scheduledTime ?? ""];
    }),
  );
  const todaysTrips = db.trips
    .filter((trip) => trip.serviceDate === today && trip.status !== "cancelled")
    .sort((a, b) => departureTime(a, startTimes).localeCompare(departureTime(b, startTimes)));
  const undispatched = todaysTrips.filter((trip) => trip.status === "planned");

  const vehiclesById = new Map(db.vehicles.map((v) => [v.id, v]));
  const driversById = new Map(db.drivers.map((d) => [d.id, d]));
  const routesById = new Map(db.routes.map((r) => [r.id, r]));

  // ---- the last seven days, counted from recorded trips ----------------------------------------
  const days = lastSevenDays(today);
  const runsByDay = days.map((day) => db.trips.filter((trip) => trip.serviceDate === day && trip.status !== "cancelled").length);
  const runsRecorded = runsByDay.reduce((sum, n) => sum + n, 0);

  // Everything the operator must act on, in one list. Empty rows are omitted, never zero-filled.
  const attention: { key: string; label: string; detail: string; count: number; tone: "error" | "warning" | "info"; action?: Route }[] = [];
  if (allowed("drivers:read") && expiredLicences.length > 0) {
    attention.push({
      key: "licences",
      label: `${expiredLicences.length} driver licence${expiredLicences.length === 1 ? "" : "s"} expired`,
      detail: expiredLicences.map((d) => d.fullName).slice(0, 3).join(", "),
      count: expiredLicences.length,
      tone: "error",
      action: allowed("drivers:read") ? "drivers" : undefined,
    });
  }
  if (allowed("documents:read") && paperCounts.untaken > 0) {
    const soonest = papers.filter((entry) => entry.takenOn === null).slice(0, 3);
    attention.push({
      key: "papers",
      label: `${paperCounts.untaken} paper${paperCounts.untaken === 1 ? "" : "s"} need${paperCounts.untaken === 1 ? "s" : ""} renewing${paperCounts.takenOn > 0 ? `, ${paperCounts.takenOn} taken on` : ""}`,
      detail: `${soonest
        .map((entry) => `${entry.document.expiryDate} (${reminderTiming(entry.days)})`)
        .join(", ")}${papers.length > soonest.length ? `, and ${papers.length - soonest.length} more` : ""}. Nobody has taken one on yet.`,
      count: paperCounts.untaken,
      tone: paperCounts.expired > 0 ? "error" : "warning",
      action: "compliance",
    });
  }
  if (allowed("fleet:read") && readiness.counts.overdue > 0) {
    attention.push({
      key: "overdue",
      label: `${readiness.counts.overdue} vehicle${readiness.counts.overdue === 1 ? "" : "s"} past service interval`,
      detail: "Scheduled maintenance is overdue as of today.",
      count: readiness.counts.overdue,
      tone: "error",
      action: "fleetReadiness",
    });
  }
  if (allowed("fleet:read") && readiness.counts.due > 0) {
    attention.push({
      key: "due",
      label: `${readiness.counts.due} service${readiness.counts.due === 1 ? "" : "s"} due soon`,
      detail: "Within the configured lead time for its category.",
      count: readiness.counts.due,
      tone: "warning",
      action: "fleetReadiness",
    });
  }
  if (allowed("rentals:read") && awaitingConfirmation.length > 0) {
    attention.push({
      key: "rentals",
      label: `${awaitingConfirmation.length} rental${awaitingConfirmation.length === 1 ? "" : "s"} awaiting confirmation`,
      detail: "Quoted or agreed but not yet paid — no vehicle is held until the deposit is in.",
      count: awaitingConfirmation.length,
      tone: "info",
      action: "rentals",
    });
  }
  if (undispatched.length > 0) {
    attention.push({
      key: "dispatch",
      label: `${undispatched.length} of today's ${todaysTrips.length} trip${todaysTrips.length === 1 ? "" : "s"} not dispatched`,
      detail: "A planned trip has no departure recorded yet.",
      count: undispatched.length,
      tone: "warning",
      action: "busing",
    });
  }
  if (allowed("settings:read") && outstanding > 0) {
    attention.push({
      key: "settings",
      label: `${outstanding} business rule${outstanding === 1 ? "" : "s"} still unset`,
      detail: "Dependent features stay blocked until management supplies them.",
      count: outstanding,
      tone: "info",
      action: allowed("settings:update") ? "settings" : undefined,
    });
  }

  // ---- fleet: three readiness states plus the vehicles nothing is known about ------------------
  const readinessConfigured = readiness.status === "ok";
  const segments = [
    { key: "ok", label: "Ready", value: readiness.counts.ok, bar: "bg-primary" },
    { key: "due", label: "Due soon", value: readiness.counts.due, bar: "bg-amber-700" },
    { key: "overdue", label: "Overdue", value: readiness.counts.overdue, bar: "bg-destructive" },
    { key: "no_data", label: "No reading", value: readiness.counts.no_data, bar: "bg-muted-foreground/40" },
  ].filter((segment) => segment.value > 0);
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);

  const canSeeMaster = allowed("vehicles:read") || allowed("drivers:read") || allowed("clients:read");
  const go = (route: Route | undefined) => (route ? () => navigate(route) : undefined);

  const quickActions = [
    allowed("trips:generate") && { label: "Generate today's runs", icon: CalendarClock, route: "busing" as Route },
    allowed("rentals:create") && { label: "New rental", icon: ClipboardList, route: "rentals" as Route },
    allowed("fleet:record") && { label: "Record odometer", icon: Gauge, route: "fleetReadiness" as Route },
    allowed("incidents:create") && { label: "Report an issue", icon: TriangleAlert, route: "logistics" as Route },
  ].filter((action): action is { label: string; icon: typeof CalendarClock; route: Route } => Boolean(action));

  const figures = [
    {
      label: "Runs today",
      chip: undispatched.length > 0 ? `${undispatched.length} waiting` : todaysTrips.length === 0 ? "none planned" : "all dispatched",
      chipTone: undispatched.length > 0 ? "warning" : "neutral",
      value: todaysTrips.length,
      unit: `run${todaysTrips.length === 1 ? "" : "s"} today`,
      caption:
        todaysTrips.length === 0
          ? "No trip is scheduled for today."
          : `Earliest departure ${departureTime(todaysTrips[0], startTimes) || "—"} · ${todaysTrips.length - undispatched.length} dispatched`,
      spark: runsRecorded > 0 ? <Spark values={runsByDay} labels={days} /> : null,
    },
    {
      label: "Fleet ready",
      chip:
        readiness.status === "not_configured"
          ? "not configured"
          : readiness.counts.overdue > 0
            ? `${readiness.counts.overdue} overdue`
            : db.vehicles.length === 0
              ? "no vehicles"
              : "within interval",
      chipTone: readiness.counts.overdue > 0 && readiness.status === "ok" ? "error" : "neutral",
      value: readiness.counts.ok,
      unit: `of ${readiness.total} in the fleet`,
      caption:
        readiness.status === "not_configured"
          ? "Service intervals are not set, so readiness cannot be computed."
          : readiness.coverage === null
            ? "No vehicle has a recorded service basis yet."
            : `${readiness.counts.due} due soon · ${readiness.counts.overdue} overdue · coverage ${Math.round(readiness.coverage * 100)}%`,
      spark: null,
    },
    {
      label: "Rentals awaiting",
      chip: awaitingConfirmation.length > 0 ? `${awaitingConfirmation.length} open` : "clear",
      chipTone: awaitingConfirmation.length > 0 ? "warning" : "neutral",
      value: allowed("rentals:read") ? awaitingConfirmation.length : "—",
      unit: "draft or quoted",
      caption: !allowed("rentals:read")
        ? "Your role cannot read rental records."
        : `${money(depositsHeld, s.currencyCode)} in deposits held across ${activeRentals.length} active rental${activeRentals.length === 1 ? "" : "s"}.`,
      spark: null,
    },
    {
      label: "Licences expired",
      chip: !allowed("drivers:read") ? "restricted" : expiredLicences.length > 0 ? "not dispatchable" : "all current",
      chipTone: allowed("drivers:read") && expiredLicences.length > 0 ? "error" : "neutral",
      value: allowed("drivers:read") ? expiredLicences.length : "—",
      unit: `of ${db.drivers.filter((d) => d.status === "active").length} active drivers`,
      caption: !allowed("drivers:read")
        ? "Your role cannot read driver records."
        : expiredLicences.length === 0
          ? "A driver past expiry cannot be assigned to a run."
          : expiredLicences.map((d) => d.fullName).slice(0, 2).join(", "),
      spark: null,
    },
  ];

  return (
    <div className="space-y-4">
      {/* ---- the header: who is on the desk, the day, and what it looks like --------------------- */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Overview · {todayLabel}</p>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},{" "}
            {currentUser?.fullName?.split(" ")[0] ?? "operator"}
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">{s.companyName ?? "Richie Transport Services"}</span>
          </h1>
          <p className="max-w-[78ch] text-[13px] leading-relaxed text-muted-foreground">
            {actor ? ROLE_LABELS[actor.role] : "Signed in"} —{" "}
            {todaysTrips.length === 0 ? "no runs are scheduled for today" : `${todaysTrips.length} run${todaysTrips.length === 1 ? "" : "s"} scheduled today`}
            {attention.length === 0 ? ", and nothing is waiting on a decision." : `, ${attention.length} item${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} a decision.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => navigate("fleetReadiness")}>Check readiness</Button>
          <Button variant="primary" onClick={() => navigate("busing")}>
            Open dispatch
          </Button>
        </div>
      </header>

      {!canSeeMaster && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status">
          <p className="font-medium text-foreground">No screens are enabled for your role yet</p>
          <p className="mt-1 text-muted-foreground">
            The {actor ? ROLE_LABELS[actor.role] : ""} role gains record-scoped features (trips, boarding, bookings) in later phases.
            Nothing is hidden behind this message — there is simply nothing to show yet.
          </p>
        </div>
      )}

      {/* ---- four recorded figures, one strip ---------------------------------------------------- */}
      <section aria-label="Today at a glance" className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-xs sm:grid-cols-2 xl:grid-cols-4">
        {figures.map((figure, index) => (
          <article key={figure.label} className={cn("space-y-2 p-4", index > 0 && "border-t border-border sm:border-t-0 sm:border-l")}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">{figure.label}</span>
              <Badge tone={figure.chipTone === "error" ? "error" : figure.chipTone === "warning" ? "warning" : "neutral"}>{figure.chip}</Badge>
            </div>
            <p className="flex items-baseline gap-1.5 text-[28px] leading-none font-semibold tracking-[-0.04em] text-foreground tabular-nums">
              {figure.value}
              <span className="text-[11.5px] font-medium tracking-normal text-muted-foreground">{figure.unit}</span>
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{figure.caption}</p>
            {figure.spark}
          </article>
        ))}
      </section>

      {/* ---- the board ------------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <BoardCard
          id="attention-heading"
          className="lg:col-span-5"
          title="Needs attention"
          note="Everything below is counted from records on this screen."
          action={
            attention.length === 0 ? (
              <Badge tone="success">All clear</Badge>
            ) : (
              <Badge tone="warning">
                {attention.length} item{attention.length === 1 ? "" : "s"}
              </Badge>
            )
          }
        >
          {attention.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-[13px] font-medium text-foreground">Nothing is waiting on you</p>
                <p className="text-xs text-muted-foreground">No expiries, no overdue service, no unconfirmed rentals.</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((row) => (
                <li key={row.key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE_MARK[row.tone])} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{row.label}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{row.detail}</p>
                  </div>
                  {row.action ? (
                    <Button variant="ghost" size="sm" className="-mr-1 text-muted-foreground hover:text-foreground" onClick={go(row.action)}>
                      Review
                    </Button>
                  ) : (
                    <span className="mt-1 shrink-0 text-[11px] text-muted-foreground">Admin only</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </BoardCard>

        <BoardCard
          id="departures-heading"
          className="lg:col-span-7"
          title="Today's departures"
          note={
            todaysTrips.length === 0
              ? "No trips scheduled."
              : `${todaysTrips.length} scheduled · earliest ${departureTime(todaysTrips[0], startTimes) || "—"}`
          }
          action={<LinkAction label="Run sheet" onClick={() => navigate("busing")} />}
        >
          {todaysTrips.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Trips appear here once a staff route generates one for today.{" "}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => navigate("busing")}>
                Open staff busing
              </button>
            </p>
          ) : (
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <Table aria-label="Today's departures">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 bg-muted/40 pl-4 font-mono text-[10px] tracking-[0.1em] uppercase">Dep</TableHead>
                    <TableHead className="h-8 bg-muted/40 font-mono text-[10px] tracking-[0.1em] uppercase">Route</TableHead>
                    <TableHead className="h-8 bg-muted/40 font-mono text-[10px] tracking-[0.1em] uppercase">Crew</TableHead>
                    <TableHead className="h-8 bg-muted/40 pr-4 font-mono text-[10px] tracking-[0.1em] uppercase">State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {todaysTrips.map((trip) => {
                    const route = routesById.get(trip.routeId);
                    const vehicle = trip.vehicleId ? vehiclesById.get(trip.vehicleId) : null;
                    const driver = trip.driverId ? driversById.get(trip.driverId) : null;
                    return (
                      <TableRow key={trip.id}>
                        <TableCell className="pl-4">
                          <span className="block font-mono text-[12.5px] font-medium tabular-nums text-foreground">{departureTime(trip, startTimes) || "—"}</span>
                          <span className="block font-mono text-[10.5px] text-muted-foreground">{trip.reference}</span>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <span className="block text-[13px] font-medium text-foreground">{route?.name ?? "Unknown route"}</span>
                          <span className="block text-[11.5px] text-muted-foreground">
                            {route ? DIRECTION_LABELS[route.direction] : "—"}
                            {route?.stops.length ? ` · ${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}` : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="block text-[12px] text-foreground">{vehicle ? vehicle.registration : <em className="text-muted-foreground">not assigned</em>}</span>
                          <span className="block text-[11.5px] text-muted-foreground">{driver ? driver.fullName : <em>not assigned</em>}</span>
                        </TableCell>
                        <TableCell className="pr-4">
                          <Badge tone={trip.status === "planned" ? "warning" : trip.status === "dispatched" ? "info" : "success"}>{TRIP_STATUS_LABELS[trip.status]}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </BoardCard>

        {allowed("vehicles:read") && (
          <BoardCard
            id="fleet-heading"
            className="lg:col-span-4"
            title="Fleet readiness"
            note={db.vehicles.length === 0 ? "Nothing registered yet." : readiness.asOf}
          >
            {db.vehicles.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No vehicles are registered, so there is no readiness to report.{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => navigate("vehicles")}>
                  Register the first vehicle
                </button>
              </p>
            ) : !readinessConfigured ? (
              <p className="text-[13px] text-muted-foreground">
                Service intervals are not configured, so readiness cannot be computed.{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => navigate("fleetReadiness")}>
                  Review readiness
                </button>
              </p>
            ) : (
              <div className="space-y-3">
                <p className="flex items-baseline gap-1.5 text-[28px] leading-none font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                  {readiness.counts.ok}/{readiness.total}
                  <span className="text-[11.5px] font-medium tracking-normal text-muted-foreground">ready</span>
                </p>
                <div
                  className="flex h-2 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Readiness: ${readiness.counts.overdue} overdue, ${readiness.counts.due} due, ${readiness.counts.ok} ready, ${readiness.counts.no_data} without a reading`}
                >
                  {segments.map((segment) => (
                    <span key={segment.key} className={segment.bar} style={{ width: `${(segment.value / segmentTotal) * 100}%` }} />
                  ))}
                </div>
                <ul className="space-y-1.5">
                  {segments.map((segment) => (
                    <li key={segment.key} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span className={cn("size-2 rounded-sm", segment.bar)} aria-hidden="true" />
                      <span className="flex-1">{segment.label}</span>
                      <b className="font-medium tabular-nums text-foreground">{segment.value}</b>
                    </li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {readiness.coverage === null
                    ? "No vehicle has a recorded service basis yet."
                    : `Coverage ${Math.round(readiness.coverage * 100)}% · ${readiness.evaluable} of ${readiness.total} vehicles evaluable.`}
                </p>
              </div>
            )}
          </BoardCard>
        )}

        {allowed("rentals:read") && (
          <BoardCard
            id="rentals-heading"
            className="lg:col-span-4"
            title="Bus rentals"
            note="Money figures sum recorded amounts only. Not a margin."
            action={<LinkAction label="Open rentals" onClick={() => navigate("rentals")} />}
          >
            {db.rentals.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No rental requests yet. Money appears here only once an amount is recorded against a request.{" "}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => navigate("rentals")}>
                  Open rentals
                </button>
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "Billed to date",
                      value: money(billed, s.currencyCode),
                      caption: `${db.rentals.filter((r) => r.status === "completed").length} completed rental${db.rentals.filter((r) => r.status === "completed").length === 1 ? "" : "s"}`,
                    },
                    { label: "Deposits held", value: money(depositsHeld, s.currencyCode), caption: `${activeRentals.length} active rental${activeRentals.length === 1 ? "" : "s"}` },
                  ].map((figure) => (
                    <div key={figure.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                      <p className="font-mono text-[9.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">{figure.label}</p>
                      <p className="mt-1 text-[17px] leading-none font-semibold tracking-[-0.02em] text-foreground tabular-nums">{figure.value}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{figure.caption}</p>
                    </div>
                  ))}
                </div>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
                  {RENTAL_STATUSES.map((status) => {
                    const count = db.rentals.filter((r) => r.status === status).length;
                    return (
                      <li key={status} className="flex items-baseline gap-1.5 text-[11.5px]">
                        <b className={cn("text-[12.5px] tabular-nums", count === 0 ? "text-muted-foreground" : "text-foreground")}>{count}</b>
                        <span className="truncate text-muted-foreground">{RENTAL_STATUS_LABELS[status]}</span>
                      </li>
                    );
                  })}
                </ul>
                {!s.currencyCode && <p className="text-xs text-muted-foreground">Billing currency is not set, so amounts are shown without a currency symbol.</p>}
              </div>
            )}
          </BoardCard>
        )}

        {allowed("settings:read") && (
          <BoardCard
            id="setup-heading"
            className="lg:col-span-4"
            title="Setup"
            note={outstanding === 0 ? "All rules supplied" : `${outstanding} outstanding`}
            action={
              allowed("settings:update") ? (
                <Button size="sm" variant="primary" onClick={() => navigate("settings")}>
                  Open settings
                </Button>
              ) : undefined
            }
          >
            <div className="space-y-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done} of ${checklist.length} setup items complete`}>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${setup.percent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {done} of {checklist.length} complete{outstanding > 0 && ` — ${outstanding} still needed`}
              </p>
              <ul className="space-y-1.5">
                {checklist.map((item) => (
                  <li key={item.label} className="flex items-center gap-2 text-[12.5px]">
                    {item.done ? (
                      <CircleCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <CircleAlert className="size-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                    )}
                    <span className={cn("min-w-0 flex-1 truncate", item.done ? "text-foreground" : "text-muted-foreground")}>{item.label}</span>
                    <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Set" : "Not set"}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </BoardCard>
        )}

        {quickActions.length > 0 && (
          <BoardCard id="quick-heading" className="lg:col-span-4" title="Quick actions">
            <div className="grid gap-1.5">
              {quickActions.map((action) => {
                const Glyph = action.icon;
                return (
                  <button
                    key={action.route + action.label}
                    type="button"
                    onClick={() => navigate(action.route)}
                    className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Glyph className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                    <span className="flex-1">{action.label}</span>
                    <ArrowRight className="size-3.5 text-muted-foreground/60 group-hover:text-primary" aria-hidden="true" />
                  </button>
                );
              })}
              <p className="flex items-start gap-1.5 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                Every action here is one this role is allowed to take. Nothing is offered that the server would refuse.
              </p>
            </div>
          </BoardCard>
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        On-time rate (RPT-01) is computed on Staff busing, with its reporting period and data coverage. RPT-02 (fleet utilisation) and RPT-03 (cost per trip) are
        not configured because no fleet-hours or cost inputs exist yet — <span className="font-mono">docs/KPIS.md</span>.
      </p>
    </div>
  );
}

export { money };
