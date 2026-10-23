import { readinessReport } from "../tms/maintenance";
import { setupProgress } from "../tms/setup";
import { useTms } from "../tms/useTms";
import {
  DIRECTION_LABELS,
  RENTAL_STATUS_LABELS,
  RENTAL_STATUSES,
  ROLE_LABELS,
  TRIP_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type Trip,
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

/**
 * The operations board: what is wrong today, then today's departures, then the state of the fleet
 * and the one thing only management can fix (unset business rules).
 *
 * Deliberately not a KPI dashboard. A count of "12 vehicles" changes no decision; "3 services
 * overdue · 1 licence expired · 2 rentals unconfirmed" is the morning's work list. Charts are absent
 * because this installation has no history to chart yet — RPT-02/RPT-03 remain open (docs/KPIS.md).
 */
export function DashboardPage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, actor, allowed } = useTms();
  const s = db.settings;
  const today = todayYmd();

  // ---- setup checklist (shared with the Settings screen, one source of truth) -----------------
  const setup = setupProgress(s);
  const checklist = setup.items;
  const outstanding = setup.outstanding;
  const done = setup.done;

  // ---- exceptions ------------------------------------------------------------------------------
  const expiredLicences = db.drivers.filter((d) => d.status === "active" && d.licenceExpiry < today);
  const readiness = readinessReport(db, today);
  const awaitingConfirmation = db.rentals.filter((r) => r.status === "draft" || r.status === "quoted");
  const depositsHeld = db.rentals
    .filter((r) => (r.status === "confirmed" || r.status === "in_progress") && r.deposit)
    .reduce((sum, r) => sum + (r.deposit?.amount ?? 0), 0);
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

  const canSeeMaster = allowed("vehicles:read") || allowed("drivers:read") || allowed("clients:read");
  const go = (route: Route | undefined) => (route ? () => navigate(route) : undefined);

  return (
    <>
      {/* ---- masthead: the front page of the day ------------------------------------------- */}
      <header className="rts-sheet-head">
        <div className="min-w-0">
          <p className="rts-eyebrow">The front page · {today}</p>
          <h1 className="rts-title">{s.companyName ?? "Richie Transport Services"}</h1>
          <p className="rts-page-desc">
            {actor?.fullName} — {actor ? ROLE_LABELS[actor.role] : ""}. What needs attention today, then
            today&apos;s departures and the state of the fleet.
          </p>
        </div>
        <div className="rts-sheet-meta">
          <span className="rts-stamp">{todaysTrips.length} departures today</span>
          <button type="button" className="rts-link" onClick={() => navigate("busing")}>
            Open dispatch <Icon name="chevron" className="rts-link-icon" />
          </button>
        </div>
      </header>

      {!canSeeMaster && (
        <div className="rts-notice rts-notice--info" role="status">
          <p className="rts-notice-title">No screens are enabled for your role yet</p>
          The {actor ? ROLE_LABELS[actor.role] : ""} role gains record-scoped features (trips, boarding,
          bookings) in later phases. Nothing is hidden behind this message — there is simply nothing to show yet.
        </div>
      )}

      {/* ---- lead story: the first thing to act on, then the rest of the brief -------------- */}
      <section className="rts-lead" aria-labelledby="attention-heading">
        <div>
          <h2 id="attention-heading" className="rts-kicker">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="rts-all-clear">
              <Icon name="clock" className="rts-all-clear-icon" />
              Nothing is waiting on you: no expiries, no overdue service, no unconfirmed rentals.
            </p>
          ) : (
            <>
              <p className="rts-lead-hook">{attention[0].tone === "error" ? "Act today" : "Waiting on someone"}</p>
              <p className="rts-lead-headline">{attention[0].label}</p>
              <p className="rts-lead-deck">{attention[0].detail}</p>
              {attention[0].action && (
                <div style={{ marginTop: 16 }}>
                  <Button variant="primary" onClick={go(attention[0].action)}>
                    Review {attention[0].key === "settings" ? "settings" : "now"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <p className="rts-kicker">
            The brief · {attention.length === 0 ? "nothing outstanding" : `${attention.length} item${attention.length === 1 ? "" : "s"}`}
          </p>
          {attention.length <= 1 ? (
            <p className="rts-band-empty">
              {attention.length === 0
                ? "No exception is recorded against this installation today."
                : "Nothing beyond the item on the left."}
            </p>
          ) : (
            <ol className="rts-contents">
              {attention.slice(1).map((row, index) => (
                <li key={row.key}>
                  <span>{String(index + 2).padStart(2, "0")}</span>
                  <span>
                    <strong style={{ fontWeight: 600 }}>{row.label}</strong>
                    <span className="rts-band-note" style={{ display: "block", textAlign: "left" }}>{row.detail}</span>
                  </span>
                  {row.action ? (
                    <button type="button" className="rts-link" onClick={go(row.action)}>Review</button>
                  ) : (
                    <span className="rts-attention-noaction">Admin only</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* ---- the spread: today's timetable beside the fleet and the rules ------------------- */}
      <div className="rts-spread">
        <div>
          <section className="rts-band" aria-labelledby="departures-heading" style={{ borderBottom: 0, marginBottom: 0 }}>
            <div className="rts-band-label">
              <h2 id="departures-heading" className="rts-band-title">Today&apos;s departures</h2>
              <p className="rts-band-note">
                {todaysTrips.length === 0
                  ? "No trips scheduled."
                  : `${todaysTrips.length} scheduled · earliest ${departureTime(todaysTrips[0], startTimes) || "—"}`}
              </p>
            </div>
            <div className="rts-band-body">
              {todaysTrips.length === 0 ? (
                <p className="rts-band-empty">
                  Trips appear here once a staff route generates one for today.{" "}
                  <button type="button" className="rts-link" onClick={() => navigate("busing")}>
                    Open staff busing <Icon name="chevron" className="rts-link-icon" />
                  </button>
                </p>
              ) : (
                <div className="rts-board" role="table" aria-label="Today's departures">
                  <div className="rts-board-head" role="row">
                    <span role="columnheader">Dep</span>
                    <span role="columnheader">Route</span>
                    <span role="columnheader">Vehicle</span>
                    <span role="columnheader">Driver</span>
                    <span role="columnheader">State</span>
                  </div>
                  {todaysTrips.map((trip) => {
                    const route = routesById.get(trip.routeId);
                    const vehicle = trip.vehicleId ? vehiclesById.get(trip.vehicleId) : null;
                    const driver = trip.driverId ? driversById.get(trip.driverId) : null;
                    return (
                      <div className="rts-board-row" role="row" key={trip.id}>
                        <span className="rts-board-time" role="cell">{departureTime(trip, startTimes) || "—"}</span>
                        <span className="rts-board-route" role="cell">
                          <strong>{route?.name ?? "Unknown route"}</strong>
                          <small>
                            {route?.reference ?? "—"} · {route ? DIRECTION_LABELS[route.direction] : "—"}
                          </small>
                        </span>
                        <span role="cell" className="rts-board-cell">
                          {vehicle ? vehicle.registration : <em className="rts-unset">not assigned</em>}
                        </span>
                        <span role="cell" className="rts-board-cell">
                          {driver ? driver.fullName : <em className="rts-unset">not assigned</em>}
                        </span>
                        <span role="cell">
                          <span className={`rts-flag rts-flag--${trip.status}`}>{TRIP_STATUS_LABELS[trip.status]}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>

        <div>
          {allowed("vehicles:read") && (
            <section className="rts-band" aria-labelledby="fleet-heading">
              <div className="rts-band-label">
                <h2 id="fleet-heading" className="rts-band-title">Fleet</h2>
                <p className="rts-band-note">
                  {db.vehicles.filter((v) => v.status !== "retired").length} in service · {readiness.asOf}
                </p>
              </div>
              <div className="rts-band-body">
                <div className="rts-fleet-status">
                  {VEHICLE_STATUSES.map((status) => {
                    const count = db.vehicles.filter((v) => v.status === status).length;
                    return (
                      <div key={status} className="rts-fleet-cell">
                        <span className="rts-figure">{count}</span>
                        <span className="rts-fleet-label">{VEHICLE_STATUS_LABELS[status]}</span>
                      </div>
                    );
                  })}
                </div>
                {readiness.status === "not_configured" ? (
                  <p className="rts-band-empty">
                    Service intervals are not configured, so readiness cannot be computed.{" "}
                    <button type="button" className="rts-link" onClick={() => navigate("fleetReadiness")}>
                      Review readiness <Icon name="chevron" className="rts-link-icon" />
                    </button>
                  </p>
                ) : (
                  <div className="rts-meter" role="img" aria-label={`Readiness: ${readiness.counts.overdue} overdue, ${readiness.counts.due} due, ${readiness.counts.ok} ok, ${readiness.counts.no_data} without data`}>
                    {[
                      { key: "overdue", tone: "error" as const },
                      { key: "due", tone: "warning" as const },
                      { key: "ok", tone: "success" as const },
                      { key: "no_data", tone: "neutral" as const },
                    ].map(({ key, tone }) => {
                      const count = readiness.counts[key as keyof typeof readiness.counts] ?? 0;
                      if (count === 0) return null;
                      return (
                        <span
                          key={key}
                          className={`rts-meter-seg rts-meter-seg--${tone}`}
                          style={{ flexGrow: count }}
                          title={`${count} ${key.replace("_", " ")}`}
                        />
                      );
                    })}
                  </div>
                )}
                {readiness.status !== "not_configured" && (
                  <p className="rts-meter-legend">
                    <span><i className="rts-dot rts-dot--error" /> {readiness.counts.overdue} overdue</span>
                    <span><i className="rts-dot rts-dot--warning" /> {readiness.counts.due} due</span>
                    <span><i className="rts-dot rts-dot--success" /> {readiness.counts.ok} ready</span>
                    <span><i className="rts-dot rts-dot--neutral" /> {readiness.counts.no_data} no data</span>
                    {readiness.coverage !== null && <span className="rts-meter-coverage">coverage {Math.round(readiness.coverage * 100)}%</span>}
                  </p>
                )}
              </div>
            </section>
          )}

          {allowed("settings:read") && (
            <section className="rts-band" aria-labelledby="setup-heading" style={{ borderBottom: 0 }}>
              <div className="rts-band-label">
                <h2 id="setup-heading" className="rts-band-title">Setup</h2>
                <p className="rts-band-note">Rules only management can supply.</p>
              </div>
              <div className="rts-band-body">
                <div className="rts-progress" role="img" aria-label={`${done} of ${checklist.length} setup items complete`}>
                  <span className="rts-progress-fill" style={{ width: `${setup.percent}%` }} />
                </div>
                <p className="rts-progress-caption">
                  {done} of {checklist.length} complete
                  {outstanding > 0 && ` — ${outstanding} still needed`}
                </p>
                <ul className="rts-rules" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                  {checklist.map((item) => (
                    <li key={item.label} className="rts-rule">
                      <span className="rts-rule-label">{item.label}</span>
                      <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Set" : "Not set"}</Badge>
                    </li>
                  ))}
                </ul>
                {allowed("settings:update") && (
                  <div className="rts-band-actions">
                    <Button variant="primary" onClick={() => navigate("settings")}>Open settings</Button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {allowed("rentals:read") && (
        <section className="rts-band" aria-labelledby="rentals-heading">
          <div className="rts-band-label">
            <h2 id="rentals-heading" className="rts-band-title">Bus rentals</h2>
            <p className="rts-band-note">Money figures sum recorded amounts only. Not a margin.</p>
          </div>
          <div className="rts-band-body">
            <div className="rts-fleet-status">
              <div className="rts-fleet-cell">
                <span className="rts-figure rts-figure--money">{money(billed, s.currencyCode)}</span>
                <span className="rts-fleet-label">billed · {db.rentals.filter((r) => r.status === "completed").length} completed</span>
              </div>
              <div className="rts-fleet-cell">
                <span className="rts-figure rts-figure--money">{money(depositsHeld, s.currencyCode)}</span>
                <span className="rts-fleet-label">deposits held · active rentals</span>
              </div>
              <div className="rts-fleet-cell">
                <span className="rts-figure">{db.rentals.length}</span>
                <span className="rts-fleet-label">requests in total</span>
              </div>
            </div>
            <div className="rts-statusline">
              {RENTAL_STATUSES.map((status) => {
                const count = db.rentals.filter((r) => r.status === status).length;
                return (
                  <span key={status} className={count === 0 ? "rts-statusline-cell is-zero" : "rts-statusline-cell"}>
                    <b>{count}</b> {RENTAL_STATUS_LABELS[status]}
                  </span>
                );
              })}
            </div>
            {!s.currencyCode && db.rentals.length > 0 && (
              <p className="rts-band-empty">Billing currency is not set, so amounts are shown without a currency symbol.</p>
            )}
          </div>
        </section>
      )}

      <p className="rts-footnote">
        On-time rate (RPT-01) is computed on Staff busing, with its reporting period and data coverage.
        RPT-02 (fleet utilisation) and RPT-03 (cost per trip) are not configured because no fleet-hours
        or cost inputs exist yet — <span className="rts-footnote-ref">docs/KPIS.md</span>.
      </p>
    </>
  );
}

export { money };
