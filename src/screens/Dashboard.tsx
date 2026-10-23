import { useTms } from "../tms/useTms";
import { readinessReport } from "../tms/maintenance";
import { RENTAL_STATUS_LABELS, RENTAL_STATUSES, ROLE_LABELS, VEHICLE_STATUS_LABELS, VEHICLE_STATUSES } from "../tms/types";
import { Badge, Button, Card, Notice, Stat, todayYmd } from "../ui/primitives";
import type { Route } from "../routes";

function money(amount: number, currency: string | null) {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function RentalsSummary() {
  const { db } = useTms();
  const rentals = db.rentals;
  const completed = rentals.filter((r) => r.status === "completed" && r.finalInvoice);
  const billed = completed.reduce((sum, r) => sum + (r.finalInvoice?.total ?? 0), 0);
  const depositsHeld = rentals.filter((r) => (r.status === "confirmed" || r.status === "in_progress") && r.deposit).reduce((sum, r) => sum + (r.deposit?.amount ?? 0), 0);
  const currency = db.settings.currencyCode;

  return (
    <Card title="Bus rentals summary" description="Counts all rentals; money figures sum only amounts actually recorded. Not a profit or margin figure.">
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Stat label="Completed (billed)" value={money(billed, currency)} caption={`${completed.length} completed rental${completed.length === 1 ? "" : "s"}`} />
        <Stat label="Deposits held (active)" value={money(depositsHeld, currency)} caption="Confirmed / in-progress" />
        <Stat label="Total requests" value={rentals.length} caption={`${rentals.filter((r) => ["draft", "quoted"].includes(r.status)).length} awaiting confirmation`} />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {RENTAL_STATUSES.map((s) => (
          <div key={s} className="rounded-sm bg-stone-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{RENTAL_STATUS_LABELS[s]}</p>
            <p className="text-lg font-semibold text-stone-900">{rentals.filter((r) => r.status === s).length}</p>
          </div>
        ))}
      </div>
      {!currency && rentals.length > 0 && <p className="mt-3 text-xs text-amber-700">Billing currency is not set, so amounts are shown without a currency symbol.</p>}
    </Card>
  );
}

export function DashboardPage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, actor, allowed } = useTms();
  const s = db.settings;

  const checklist = [
    { label: "Company name", done: !!s.companyName },
    { label: "Billing currency", done: !!s.currencyCode },
    { label: "Vehicle categories (at least one)", done: s.vehicleCategories.length > 0 },
    { label: "Shift definitions", done: s.shifts.length > 0 },
    { label: "On-time threshold (minutes)", done: s.onTimeThresholdMinutes !== null },
  ];
  const outstanding = checklist.filter((c) => !c.done).length;
  const today = todayYmd();
  const expiredLicences = db.drivers.filter((d) => d.status === "active" && d.licenceExpiry < today).length;
  const readiness = readinessReport(db, today);
  const canSeeMaster = allowed("vehicles:read") || allowed("drivers:read") || allowed("clients:read");

  return (
    <div className="space-y-6">
      <div className="rts-page-head">
        <div className="min-w-0">
          <p className="rts-eyebrow">Operations desk</p>
          <h1 className="rts-title">{s.companyName ?? "Richie Transport Services"}</h1>
          <p className="rts-page-desc">
            Signed in as {actor?.fullName} — {actor ? ROLE_LABELS[actor.role] : ""}. Staff busing, rentals and fleet
            logistics on one ledger.
          </p>
        </div>
        <div className="rts-page-actions">
          <span className="rts-stamp">Active ledger</span>
        </div>
      </div>

      {!canSeeMaster && (
        <Notice tone="info" title="No screens are enabled for your role yet">
          The {actor ? ROLE_LABELS[actor.role] : ""} role will gain record-scoped features (trips, boarding, bookings) in later phases. Nothing is hidden behind this message - there is simply nothing to show yet.
        </Notice>
      )}

      {allowed("settings:read") && (
        <Card
          title="Setup status"
          description="Business rules the company must supply. None has a default; dependent features stay blocked until these are set."
          actions={allowed("settings:update") ? <Button onClick={() => navigate("settings")}>Open settings</Button> : undefined}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3 border border-[var(--rts-line)] bg-[#fffdf6] px-3 py-2 text-sm">
                <span className="text-stone-700">{item.label}</span>
                <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Set" : "Not set"}</Badge>
              </li>
            ))}
          </ul>
          {outstanding > 0 && (
            <p className="mt-3 text-xs text-stone-500">
              {outstanding} of {checklist.length} required settings still need a value from management. See docs/OPEN_QUESTIONS.md.
            </p>
          )}
        </Card>
      )}

      {canSeeMaster && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {allowed("vehicles:read") && <Stat label="Vehicles" value={db.vehicles.length} caption={`${db.vehicles.filter((v) => v.status === "available").length} available`} />}
          {allowed("drivers:read") && <Stat label="Drivers" value={db.drivers.length} caption={`${db.drivers.filter((d) => d.status === "active").length} active`} />}
          {allowed("clients:read") && <Stat label="Corporate clients" value={db.clients.length} caption={`${db.clients.filter((c) => c.status === "active").length} active`} />}
          {allowed("rentals:read") && <Stat label="Rentals" value={db.rentals.length} caption={`${db.rentals.filter((r) => r.status === "in_progress").length} in progress`} />}
          {allowed("users:read") && <Stat label="User accounts" value={db.users.length} caption={`${db.users.filter((u) => u.active).length} active`} />}
        </div>
      )}

      {allowed("vehicles:read") && db.vehicles.length > 0 && (
        <Card title="Fleet by status">
          <div className="grid gap-2 sm:grid-cols-4">
            {VEHICLE_STATUSES.map((status) => (
              <div key={status} className="rounded-sm bg-stone-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">{VEHICLE_STATUS_LABELS[status]}</p>
                <p className="text-lg font-semibold text-stone-900">{db.vehicles.filter((v) => v.status === status).length}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {allowed("drivers:read") && expiredLicences > 0 && (
        <Notice tone="warning" title={`${expiredLicences} active driver${expiredLicences === 1 ? " has" : "s have"} an expired licence`}>
          Review the Drivers screen. Reminder lead times are an open question for management; only already-expired dates are flagged.
        </Notice>
      )}

      {allowed("fleet:read") && (readiness.counts.overdue > 0 || readiness.counts.due > 0 || readiness.counts.no_data > 0) && (
        <Notice tone={readiness.counts.overdue > 0 ? "warning" : "info"} title="Service schedules need attention">
          {readiness.counts.overdue} overdue, {readiness.counts.due} due soon and {readiness.counts.no_data} not evaluable as of {today}.{" "}
          <button type="button" className="underline" onClick={() => navigate("fleetReadiness")}>
            Open fleet readiness
          </button>
          .
        </Notice>
      )}

      {allowed("rentals:read") && <RentalsSummary />}

      <Card title="Operational KPIs" description="Definitions for RPT-01 to RPT-03 are pending management confirmation (docs/KPIS.md).">
        <div className="rounded-sm border border-dashed border-stone-300 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-stone-700">RPT-01 is computed on Staff busing</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-stone-500">
            The on-time rate is shown with its reporting period and data coverage under Staff busing, Performance. RPT-02 (fleet utilisation) and RPT-03 (cost per trip) are not configured because no fleet-hours or cost inputs exist yet.
          </p>
        </div>
      </Card>
    </div>
  );
}
