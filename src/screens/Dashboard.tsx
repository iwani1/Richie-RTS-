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
  type User,
} from "../tms/types";
import { Badge, Button, todayYmd } from "../ui/primitives";
import { Icon } from "../ui/icons";
import type { Route } from "../routes";

function money(amount: number, currency: string | null) {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
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

function initialsOf(user: User | null): string {
  if (!user) return "—";
  return user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** A tiny recorded series: one bar per day, the last day marked. Height is relative, never invented. */
function Spark({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="rts-spark" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={labels[index] ?? index}
          className={index === values.length - 1 ? "is-hi" : undefined}
          style={{ height: `${Math.max(8, Math.round((value / max) * 100))}%` }}
          title={String(value)}
        />
      ))}
    </div>
  );
}

const RING_RADIUS = 40;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The operations overview: four recorded figures, the work that needs a decision, today's runs and
 * the state of the fleet. Every number below is counted from the database on this request — there is
 * no seeded trend, no target and no invented comparison. Where the data cannot answer, the card says
 * so in words.
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
  const readiness = readinessReport(db, today);
  const awaitingConfirmation = db.rentals.filter((r) => r.status === "draft" || r.status === "quoted");
  const activeRentals = db.rentals.filter((r) => r.status === "confirmed" || r.status === "in_progress");
  const depositsHeld = activeRentals.reduce((sum, r) => sum + (r.deposit?.amount ?? 0), 0);
  const billed = db.rentals
    .filter((r) => r.status === "completed" && r.finalInvoice)
    .reduce((sum, r) => sum + (r.finalInvoice?.total ?? 0), 0);

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
      detail: "Draft or quoted — no vehicle is held until confirmed.",
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

  // ---- fleet ring: three readiness states plus the vehicles nothing is known about ------------
  const readinessConfigured = readiness.status === "ok";
  const ringSegments = [
    { key: "ok", label: "Ready", value: readiness.counts.ok, tone: "success" as const },
    { key: "due", label: "Due soon", value: readiness.counts.due, tone: "warning" as const },
    { key: "overdue", label: "Overdue", value: readiness.counts.overdue, tone: "error" as const },
    { key: "no_data", label: "No reading", value: readiness.counts.no_data, tone: "neutral" as const },
  ].filter((segment) => segment.value > 0);
  const ringTotal = ringSegments.reduce((sum, segment) => sum + segment.value, 0);
  let ringOffset = 0;

  const canSeeMaster = allowed("vehicles:read") || allowed("drivers:read") || allowed("clients:read");
  const go = (route: Route | undefined) => (route ? () => navigate(route) : undefined);

  const quickActions = [
    allowed("trips:generate") && { label: "Generate today's runs", icon: "busing" as const, route: "busing" as Route },
    allowed("rentals:create") && { label: "New rental", icon: "rental" as const, route: "rentals" as Route },
    allowed("fleet:record") && { label: "Record odometer", icon: "readiness" as const, route: "fleetReadiness" as Route },
    allowed("incidents:create") && { label: "Report an issue", icon: "alert" as const, route: "logistics" as Route },
  ].filter((action): action is { label: string; icon: "busing" | "rental" | "readiness" | "alert"; route: Route } => Boolean(action));

  return (
    <>
      {/* ---- page header: who is on the desk, what day it is, what it looks like ---------------- */}
      <header className="rts-page-head">
        <div className="min-w-0">
          <p className="rts-eyebrow">
            Overview · {todayLabel}
          </p>
          <h1 className="rts-title">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"},{" "}
            {currentUser?.fullName?.split(" ")[0] ?? "operator"}
            <span className="rts-title-sub">{s.companyName ?? "Richie Transport Services"}</span>
          </h1>
          <p className="rts-page-desc">
            {actor ? ROLE_LABELS[actor.role] : "Signed in"} —{" "}
            {todaysTrips.length === 0
              ? "no runs are scheduled for today"
              : `${todaysTrips.length} run${todaysTrips.length === 1 ? "" : "s"} scheduled today`}
            {attention.length === 0 ? ", and nothing is waiting on a decision." : `, ${attention.length} item${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} a decision.`}
          </p>
        </div>
        <div className="rts-page-actions">
          <span className="rts-avatar rts-avatar--lg" aria-hidden="true">{initialsOf(currentUser)}</span>
          <Button variant="primary" onClick={() => navigate("busing")}>
            Open dispatch
          </Button>
        </div>
      </header>

      {!canSeeMaster && (
        <div className="rts-notice rts-notice--info" role="status">
          <p className="rts-notice-title">No screens are enabled for your role yet</p>
          The {actor ? ROLE_LABELS[actor.role] : ""} role gains record-scoped features (trips, boarding,
          bookings) in later phases. Nothing is hidden behind this message — there is simply nothing to show yet.
        </div>
      )}

      {/* ---- four recorded figures, each with the sentence that qualifies it --------------------- */}
      <section className="rts-stat-grid" aria-label="Today at a glance">
        <article className="rts-stat">
          <div className="rts-stat-top">
            <span className="rts-stat-label">Runs today</span>
            {undispatched.length > 0 ? (
              <span className="rts-stat-chip rts-stat-chip--warn">{undispatched.length} waiting</span>
            ) : (
              <span className="rts-stat-chip">{todaysTrips.length === 0 ? "none planned" : "all dispatched"}</span>
            )}
          </div>
          <p className="rts-stat-value">
            {todaysTrips.length}
            <span className="rts-stat-unit">of {todaysTrips.length} planned</span>
          </p>
          <p className="rts-stat-caption">
            {todaysTrips.length === 0
              ? "No trip is scheduled for today."
              : `Earliest departure ${departureTime(todaysTrips[0], startTimes) || "—"} · ${todaysTrips.length - undispatched.length} dispatched`}
          </p>
          {runsRecorded > 0 && <Spark values={runsByDay} labels={days} />}
        </article>

        <article className="rts-stat">
          <div className="rts-stat-top">
            <span className="rts-stat-label">Fleet ready</span>
            {readiness.status === "not_configured" ? (
              <span className="rts-stat-chip rts-stat-chip--info">not configured</span>
            ) : readiness.counts.overdue > 0 ? (
              <span className="rts-stat-chip rts-stat-chip--alert">{readiness.counts.overdue} overdue</span>
            ) : db.vehicles.length === 0 ? (
              <span className="rts-stat-chip rts-stat-chip--info">no vehicles</span>
            ) : (
              <span className="rts-stat-chip">within interval</span>
            )}
          </div>
          <p className="rts-stat-value">
            {readiness.evaluable}
            <span className="rts-stat-unit">of {readiness.total} evaluated</span>
          </p>
          <p className="rts-stat-caption">
            {readiness.status === "not_configured"
              ? "Service intervals are not set, so readiness cannot be computed."
              : readiness.coverage === null
                ? "No vehicle has a recorded service basis yet."
                : `Coverage ${Math.round(readiness.coverage * 100)}% — from recorded odometer and service dates.`}
          </p>
        </article>

        <article className="rts-stat">
          <div className="rts-stat-top">
            <span className="rts-stat-label">Rentals awaiting</span>
            {awaitingConfirmation.length > 0 ? (
              <span className="rts-stat-chip rts-stat-chip--warn">{awaitingConfirmation.length} open</span>
            ) : (
              <span className="rts-stat-chip">clear</span>
            )}
          </div>
          <p className="rts-stat-value">
            {allowed("rentals:read") ? awaitingConfirmation.length : "—"}
            <span className="rts-stat-unit">draft or quoted</span>
          </p>
          <p className="rts-stat-caption">
            {!allowed("rentals:read")
              ? "Your role cannot read rental records."
              : `${money(depositsHeld, s.currencyCode)} in deposits held across ${activeRentals.length} active rental${activeRentals.length === 1 ? "" : "s"}.`}
          </p>
        </article>

        <article className="rts-stat">
          <div className="rts-stat-top">
            <span className="rts-stat-label">Licences expired</span>
            {!allowed("drivers:read") ? (
              <span className="rts-stat-chip rts-stat-chip--info">restricted</span>
            ) : expiredLicences.length > 0 ? (
              <span className="rts-stat-chip rts-stat-chip--alert">not dispatchable</span>
            ) : (
              <span className="rts-stat-chip">all current</span>
            )}
          </div>
          <p className="rts-stat-value">
            {allowed("drivers:read") ? expiredLicences.length : "—"}
            <span className="rts-stat-unit">of {db.drivers.filter((d) => d.status === "active").length} active drivers</span>
          </p>
          <p className="rts-stat-caption">
            {!allowed("drivers:read")
              ? "Your role cannot read driver records."
              : expiredLicences.length === 0
                ? "A driver past expiry cannot be assigned to a run."
                : expiredLicences.map((d) => d.fullName).slice(0, 2).join(", ")}
          </p>
        </article>
      </section>

      {/* ---- the working surface: decisions and runs beside the fleet and the rules -------------- */}
      <div className="rts-spread">
        <div className="rts-col">
          <section className="rts-card" aria-labelledby="attention-heading">
            <div className="rts-card-head">
              <div className="rts-head-text">
                <h2 id="attention-heading" className="rts-card-title">Needs attention</h2>
                <p className="rts-card-desc">
                  {attention.length === 0 ? "Nothing outstanding" : `${attention.length} item${attention.length === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
            <div className="rts-card-body">
              {attention.length === 0 ? (
                <div className="rts-check">
                  <span className="rts-check-mark rts-check-mark--success" aria-hidden="true" />
                  <div>
                    <b>Nothing is waiting on you</b>
                    <small>No expiries, no overdue service, no unconfirmed rentals.</small>
                  </div>
                  <Icon name="clock" className="rts-check-go rts-check-icon" />
                </div>
              ) : (
                attention.map((row) => (
                  <div className="rts-check" key={row.key}>
                    <span className={`rts-check-mark rts-check-mark--${row.tone}`} aria-hidden="true" />
                    <div>
                      <b>{row.label}</b>
                      <small>{row.detail}</small>
                    </div>
                    {row.action ? (
                      <Button variant="ghost" className="rts-check-go" onClick={go(row.action)}>
                        Review
                      </Button>
                    ) : (
                      <span className="rts-check-go rts-check-note">Admin only</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rts-card" aria-labelledby="departures-heading">
            <div className="rts-card-head">
              <div className="rts-head-text">
                <h2 id="departures-heading" className="rts-card-title">Today&apos;s departures</h2>
                <p className="rts-card-desc">
                  {todaysTrips.length === 0
                    ? "No trips scheduled."
                    : `${todaysTrips.length} scheduled · earliest ${departureTime(todaysTrips[0], startTimes) || "—"}`}
                </p>
              </div>
              <button type="button" className="rts-link" onClick={() => navigate("busing")}>
                Run sheet <Icon name="chevron" className="rts-link-icon" />
              </button>
            </div>
            {todaysTrips.length === 0 ? (
              <div className="rts-card-body">
                <p className="rts-band-empty">
                  Trips appear here once a staff route generates one for today.{" "}
                  <button type="button" className="rts-link" onClick={() => navigate("busing")}>
                    Open staff busing <Icon name="chevron" className="rts-link-icon" />
                  </button>
                </p>
              </div>
            ) : (
              <div className="rts-card-body rts-card-body--flush">
                <div className="rts-runs" role="table" aria-label="Today's departures">
                  <div className="rts-runs-head" role="row">
                    <span role="columnheader">Dep</span>
                    <span role="columnheader">Route</span>
                    <span role="columnheader">Crew</span>
                    <span role="columnheader">State</span>
                  </div>
                  {todaysTrips.map((trip) => {
                    const route = routesById.get(trip.routeId);
                    const vehicle = trip.vehicleId ? vehiclesById.get(trip.vehicleId) : null;
                    const driver = trip.driverId ? driversById.get(trip.driverId) : null;
                    return (
                      <div className="rts-run" role="row" key={trip.id}>
                        <div className="rts-run-time" role="cell">
                          <b>{departureTime(trip, startTimes) || "—"}</b>
                          <span>{trip.reference}</span>
                        </div>
                        <div role="cell" className="min-w-0">
                          <p className="rts-run-route">
                            {route?.name ?? "Unknown route"} <span className="rts-run-ref">{route?.reference ?? "—"}</span>
                          </p>
                          <p className="rts-run-meta">
                            {route ? DIRECTION_LABELS[route.direction] : "—"}
                            {route?.stops.length ? ` · ${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}` : ""}
                          </p>
                        </div>
                        <div className="rts-run-crew" role="cell">
                          <span>{vehicle ? vehicle.registration : <em className="rts-unset">not assigned</em>}</span>
                          <span>{driver ? driver.fullName : <em className="rts-unset">not assigned</em>}</span>
                        </div>
                        <div className="rts-run-state" role="cell">
                          <span className={`rts-flag rts-flag--${trip.status}`}>{TRIP_STATUS_LABELS[trip.status]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {allowed("rentals:read") && (
            <section className="rts-card" aria-labelledby="rentals-heading">
              <div className="rts-card-head">
                <div className="rts-head-text">
                  <h2 id="rentals-heading" className="rts-card-title">Bus rentals</h2>
                  <p className="rts-card-desc">Money figures sum recorded amounts only. Not a margin.</p>
                </div>
                <button type="button" className="rts-link" onClick={() => navigate("rentals")}>
                  Open rentals <Icon name="chevron" className="rts-link-icon" />
                </button>
              </div>
              <div className="rts-card-body">
                {db.rentals.length === 0 ? (
                  <p className="rts-band-empty">
                    No rental requests yet. Money appears here only once an amount is recorded against a
                    request.{" "}
                    <button type="button" className="rts-link" onClick={() => navigate("rentals")}>
                      Open rentals <Icon name="chevron" className="rts-link-icon" />
                    </button>
                  </p>
                ) : (
                  <>
                    <div className="rts-stat-split">
                      <div>
                        <span className="rts-stat-label">Billed to date</span>
                        <p className="rts-stat-value rts-stat-value--sm">{money(billed, s.currencyCode)}</p>
                        <p className="rts-stat-caption">
                          {db.rentals.filter((r) => r.status === "completed").length} completed rental
                          {db.rentals.filter((r) => r.status === "completed").length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div>
                        <span className="rts-stat-label">Deposits held</span>
                        <p className="rts-stat-value rts-stat-value--sm">{money(depositsHeld, s.currencyCode)}</p>
                        <p className="rts-stat-caption">
                          {activeRentals.length} active rental{activeRentals.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <div className="rts-statusline rts-statusline--boxed">
                      {RENTAL_STATUSES.map((status) => {
                        const count = db.rentals.filter((r) => r.status === status).length;
                        return (
                          <span key={status} className={count === 0 ? "rts-statusline-cell is-zero" : "rts-statusline-cell"}>
                            <b>{count}</b>
                            <span>{RENTAL_STATUS_LABELS[status]}</span>
                          </span>
                        );
                      })}
                    </div>
                    {!s.currencyCode && (
                      <p className="rts-band-empty">Billing currency is not set, so amounts are shown without a currency symbol.</p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="rts-rail">
          {allowed("vehicles:read") && (
            <section className="rts-card" aria-labelledby="fleet-heading">
              <div className="rts-card-head">
                <div className="rts-head-text">
                  <h2 id="fleet-heading" className="rts-card-title">Fleet readiness</h2>
                  <p className="rts-card-desc">{db.vehicles.length === 0 ? "Nothing registered yet." : readiness.asOf}</p>
                </div>
              </div>
              <div className="rts-card-body">
                {db.vehicles.length === 0 ? (
                  <p className="rts-band-empty">
                    No vehicles are registered, so there is no readiness to report.{" "}
                    <button type="button" className="rts-link" onClick={() => navigate("vehicles")}>
                      Register the first vehicle <Icon name="chevron" className="rts-link-icon" />
                    </button>
                  </p>
                ) : !readinessConfigured ? (
                  <p className="rts-band-empty">
                    Service intervals are not configured, so readiness cannot be computed.{" "}
                    <button type="button" className="rts-link" onClick={() => navigate("fleetReadiness")}>
                      Review readiness <Icon name="chevron" className="rts-link-icon" />
                    </button>
                  </p>
                ) : (
                  <>
                    <div className="rts-donut">
                      <svg
                        className="rts-ring"
                        viewBox="0 0 104 104"
                        role="img"
                        aria-label={`Readiness: ${readiness.counts.overdue} overdue, ${readiness.counts.due} due, ${readiness.counts.ok} ready, ${readiness.counts.no_data} without a reading`}
                      >
                        <circle className="rts-ring-track" cx="52" cy="52" r={RING_RADIUS} />
                        {ringSegments.map((segment) => {
                          const length = (segment.value / ringTotal) * RING_CIRCUMFERENCE;
                          const dashOffset = ringOffset;
                          ringOffset += length;
                          return (
                            <circle
                              key={segment.key}
                              className={`rts-ring-seg rts-ring-seg--${segment.tone}`}
                              cx="52"
                              cy="52"
                              r={RING_RADIUS}
                              strokeDasharray={`${Math.max(length - 3, 1)} ${RING_CIRCUMFERENCE}`}
                              strokeDashoffset={-dashOffset}
                              transform="rotate(-90 52 52)"
                            />
                          );
                        })}
                        <text className="rts-ring-value" x="52" y="51" textAnchor="middle">
                          {readiness.counts.ok}/{readiness.total}
                        </text>
                        <text className="rts-ring-label" x="52" y="66" textAnchor="middle">
                          ready
                        </text>
                      </svg>
                      <div className="rts-legend">
                        {ringSegments.map((segment) => (
                          <span key={segment.key}>
                            <i className={`rts-dot rts-dot--${segment.tone}`} />
                            {segment.label}
                            <b>{segment.value}</b>
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="rts-stat-caption rts-donut-note">
                      {readiness.coverage === null
                        ? "No vehicle has a recorded service basis yet."
                        : `Coverage ${Math.round(readiness.coverage * 100)}% · ${readiness.evaluable} of ${readiness.total} vehicles evaluable.`}
                    </p>
                  </>
                )}
              </div>
            </section>
          )}

          {allowed("settings:read") && (
            <section className="rts-card" aria-labelledby="setup-heading">
              <div className="rts-card-head">
                <div className="rts-head-text">
                  <h2 id="setup-heading" className="rts-card-title">Setup</h2>
                  <p className="rts-card-desc">{outstanding === 0 ? "All rules supplied" : `${outstanding} outstanding`}</p>
                </div>
              </div>
              <div className="rts-card-body">
                <div className="rts-progress" role="img" aria-label={`${done} of ${checklist.length} setup items complete`}>
                  <span className="rts-progress-fill" style={{ width: `${setup.percent}%` }} />
                </div>
                <p className="rts-progress-caption">
                  {done} of {checklist.length} complete
                  {outstanding > 0 && ` — ${outstanding} still needed`}
                </p>
                <div className="rts-checklist">
                  {checklist.map((item) => (
                    <div className="rts-check" key={item.label}>
                      <span className={`rts-check-mark rts-check-mark--${item.done ? "success" : "warning"}`} aria-hidden="true" />
                      <div>
                        <b>{item.label}</b>
                        <small>{item.done ? "Supplied by management." : "Dependent features stay blocked."}</small>
                      </div>
                      <span className="rts-check-go">
                        <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Set" : "Not set"}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
                {allowed("settings:update") && (
                  <div className="rts-card-actions">
                    <Button variant="primary" onClick={() => navigate("settings")}>Open settings</Button>
                  </div>
                )}
              </div>
            </section>
          )}

          {quickActions.length > 0 && (
            <section className="rts-card" aria-labelledby="quick-heading">
              <div className="rts-card-head">
                <h2 id="quick-heading" className="rts-card-title">Quick actions</h2>
              </div>
              <div className="rts-card-body">
                <div className="rts-quick">
                  {quickActions.map((action) => (
                    <button key={action.route + action.label} type="button" onClick={() => navigate(action.route)}>
                      <Icon name={action.icon} />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <p className="rts-footnote">
        On-time rate (RPT-01) is computed on Staff busing, with its reporting period and data coverage.
        RPT-02 (fleet utilisation) and RPT-03 (cost per trip) are not configured because no fleet-hours
        or cost inputs exist yet — <span className="rts-footnote-ref">docs/KPIS.md</span>.
      </p>
    </>
  );
}

export { money };
