import { useState, type FormEvent } from "react";
import { readinessReport, type OdometerInput, type ReadinessStatus } from "../tms/maintenance";
import type { OdometerReading } from "../tms/types";
import { useTms } from "../tms/useTms";
import { Badge, Band, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, Select, Stat, TableCard, TextArea, TextInput, formatDate, todayYmd } from "../ui/primitives";

type Tab = "readiness" | "odometer";
type Errors = Record<string, string>;

const STATUS_TONE: Record<ReadinessStatus, "success" | "warning" | "error" | "info" | "neutral"> = {
  ok: "success",
  due: "warning",
  overdue: "error",
  no_data: "info",
  no_schedule: "neutral",
};
const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ok: "On schedule",
  due: "Due soon",
  overdue: "Overdue",
  no_data: "Insufficient data",
  no_schedule: "No schedule",
};

export function FleetReadinessPage() {
  const [tab, setTab] = useState<Tab>("readiness");
  return (
    <div>
      <PageHeader
        eyebrow="Staff logistics"
        title="Fleet readiness"
        description="Service intervals per vehicle category, odometer readings and due/overdue maintenance. Intervals are configured by management; nothing is scheduled by default."
      />
      <div role="tablist" aria-label="Fleet readiness sections" className="rts-tabs">
        {(["readiness", "odometer"] as Tab[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className="rts-tab"
          >
            {id === "readiness" ? "Readiness" : "Odometer log"}
          </button>
        ))}
      </div>
      {tab === "readiness" ? <ReadinessTab /> : <OdometerTab />}
    </div>
  );
}

function ReadinessTab() {
  const { db, allowed } = useTms();
  const [asOf, setAsOf] = useState(todayYmd());
  const report = readinessReport(db, asOf);

  return (
    <div className="space-y-5">
      <Band label="As of" note="Readiness is evaluated for this date. Coverage is the share of non-retired vehicles this build can actually evaluate.">
        <Field label="Evaluate as of"><TextInput type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
      </Band>

      {report.status === "not_configured" && (
        <Notice tone="warning" title="No service schedules configured">
          An administrator must add a service schedule per vehicle category in Settings before anything can be evaluated. No interval or lead time is assumed (OPEN_QUESTIONS Q-17, Q-37).
          {allowed("settings:update") && " Add them under Settings."}
        </Notice>
      )}
      {report.status === "no_vehicles" && <Notice tone="info">There are no active vehicles in the fleet.</Notice>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Coverage"
          value={report.coverage === null ? "Not evaluated" : `${Math.round(report.coverage * 100)}%`}
          caption={report.coverage === null ? "No schedule configured" : `${report.evaluable} of ${report.total} vehicles evaluable`}
        />
        <Stat label="Overdue" value={report.counts.overdue} caption="Past the configured interval" />
        <Stat label="Due soon" value={report.counts.due} caption="Inside the reminder lead" />
        <Stat label="Not evaluable" value={report.counts.no_data + report.counts.no_schedule} caption={`${report.counts.no_data} missing data, ${report.counts.no_schedule} no schedule`} />
      </div>

      <Band label="Vehicles">
        <DataTable
          rows={report.vehicles}
          rowKey={(row) => row.vehicleId}
          emptyState={<EmptyState title={report.status === "not_configured" ? "Nothing to evaluate" : "No active vehicles"} body={report.status === "not_configured" ? "Configure service schedules in Settings." : "Retired vehicles are excluded."} />}
          columns={[
            { key: "reg", header: "Vehicle", render: (row) => <div><p className="font-mono text-xs font-semibold text-foreground">{row.registration}</p><p className="text-xs text-muted-foreground">{row.categoryName}</p></div> },
            { key: "status", header: "Status", render: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge> },
            {
              key: "bases",
              header: "Consumed / interval",
              render: (row) =>
                row.bases.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{row.reasons[0] ?? "Not evaluable"}</span>
                ) : (
                  <ul className="space-y-0.5 text-xs">
                    {row.bases.map((basis) => {
                      // How much of the interval has been used. The bar is decorative: the same
                      // numbers are set beside it, so the bar never carries information alone.
                      const used = basis.interval > 0 ? Math.min(100, Math.round((basis.consumed / basis.interval) * 100)) : 0;
                      return (
                        <li key={basis.basis} className="rts-interval-row">
                          <span className="font-semibold">{basis.basis === "km" ? `${basis.consumed} / ${basis.interval} km` : `${basis.consumed} / ${basis.interval} days`}</span>
                          <span className="rts-interval" aria-hidden="true">
                            <span className={`rts-interval-fill rts-interval-fill--${row.status}`} style={{ width: `${used}%` }} />
                          </span>
                          {basis.dueDate ? <span className="text-muted-foreground"> due {formatDate(basis.dueDate)}</span> : null}
                          {basis.lead !== null ? <span className="text-muted-foreground"> · warn {basis.lead} {basis.basis === "km" ? "km" : "days"} before</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ),
            },
            { key: "service", header: "Last service", render: (row) => (row.lastServiceDate ? <div className="text-xs">{formatDate(row.lastServiceDate)}<span className="block text-muted-foreground">{row.lastServiceWorkOrder}</span></div> : <span className="text-xs text-dim">none recorded</span>) },
            { key: "odometer", header: "Odometer", render: (row) => (row.latestOdometerKm === null ? <span className="text-xs text-dim">no reading</span> : <span className="tabular-nums text-xs">{row.latestOdometerKm} km</span>) },
          ]}
        />
        {report.vehicles.some((row) => row.reasons.length > 0) && (
          <div className="mt-4 border-t border-border pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why some vehicles are not evaluable</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {report.vehicles
                .filter((row) => row.reasons.length > 0)
                .map((row) => (
                  <li key={row.vehicleId}>
                    <span className="font-semibold">{row.registration}:</span> {row.reasons.join(" ")}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Band>

      <Band label="Schedules in use" note="Service intervals are recorded per vehicle category in Settings.">
        {db.settings.maintenance.schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">None configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-1">Category</th><th className="py-1 text-right">Interval km</th><th className="py-1 text-right">Interval days</th><th className="py-1 text-right">Warn lead km</th><th className="py-1 text-right">Warn lead days</th></tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {db.settings.maintenance.schedules.map((schedule) => (
                  <tr key={schedule.categoryId}>
                    <td className="py-1.5 font-medium">{db.settings.vehicleCategories.find((c) => c.id === schedule.categoryId)?.name ?? "Unknown"}</td>
                    <td className="py-1.5 text-right tabular-nums">{schedule.intervalKm ?? <span className="text-dim">-</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{schedule.intervalDays ?? <span className="text-dim">-</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{schedule.remindLeadKm ?? <span className="text-dim">-</span>}</td>
                    <td className="py-1.5 text-right tabular-nums">{schedule.remindLeadDays ?? <span className="text-dim">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A blank lead time means no &ldquo;due soon&rdquo; warning for that basis: only overdue is reported. No reminder is implied by an empty cell.
        </p>
      </Band>
    </div>
  );
}

function OdometerTab() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<null | "record">(null);
  const [voidTarget, setVoidTarget] = useState<OdometerReading | null>(null);
  const vehicles = db.vehicles.filter((v) => v.status !== "retired");
  const rows = [...db.odometerReadings].sort((a, b) => (a.readingDate === b.readingDate ? (a.createdAt < b.createdAt ? 1 : -1) : a.readingDate < b.readingDate ? 1 : -1));

  return (
    <div className="space-y-4">
      <TableCard
        title="Odometer readings"
        summary={`${rows.length} reading${rows.length === 1 ? "" : "s"} · recorded by hand, not from a telematics feed · ${rows.filter((r) => r.status === "current").length} current`}
        actions={
          allowed("fleet:record") ? (
            <Button variant="primary" disabled={vehicles.length === 0} title={vehicles.length === 0 ? "All vehicles are retired or none exist" : undefined} onClick={() => setPanel("record")}>
              Record reading
            </Button>
          ) : undefined
        }
      >
      <DataTable
        rows={rows}
        rowKey={(reading) => reading.id}
        emptyState={<EmptyState title="No odometer readings" body="Record the kilometre reading for each vehicle so readiness can be measured." />}
        columns={[
          { key: "vehicle", header: "Vehicle", render: (reading) => db.vehicles.find((v) => v.id === reading.vehicleId)?.registration ?? "Unknown" },
          { key: "date", header: "Date", render: (reading) => formatDate(reading.readingDate) },
          { key: "km", header: "Reading", className: "rts-num", render: (reading) => <span className="tabular-nums font-semibold">{reading.readingKm} km</span> },
          { key: "note", header: "Note", render: (reading) => reading.note || <span className="text-dim">-</span> },
          { key: "by", header: "Recorded by", render: (reading) => <span className="text-xs">{reading.createdBy}</span> },
          {
            key: "status",
            header: "Status",
            render: (reading) =>
              reading.status === "void" ? (
                <div><Badge tone="neutral">Void</Badge><p className="mt-1 text-xs text-muted-foreground">{reading.voidReason}</p></div>
              ) : (
                <Badge tone="success">Current</Badge>
              ),
          },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (reading) => (reading.status === "current" && allowed("fleet:void") ? <Button variant="danger" onClick={() => setVoidTarget(reading)}>Void</Button> : null),
          },
        ]}
        />
      </TableCard>

      {panel === "record" && <OdometerForm onClose={() => setPanel(null)} />}
      {voidTarget && (
        <VoidForm
          reading={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSubmit={async (reason) => {
            const result = await dispatch({ type: "void_odometer", id: voidTarget.id, reason });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setVoidTarget(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

function OdometerForm({ onClose }: { onClose: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const [values, setValues] = useState<OdometerInput>({ vehicleId: "", readingKm: "", readingDate: todayYmd(), note: "" });
  const [errors, setErrors] = useState<Errors>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await dispatch({ type: "record_odometer", input: values });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };
  return (
    <Panel title="Record odometer reading" description="Hand-recorded values only." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {db.vehicles.filter((v) => v.status !== "retired").map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </Select>
        </Field>
        <Field label="Odometer (km)" error={errors.readingKm}>
          <TextInput value={values.readingKm} onChange={(e) => setValues({ ...values, readingKm: e.target.value })} inputMode="numeric" invalid={!!errors.readingKm} autoFocus />
        </Field>
        <Field label="Reading date" error={errors.readingDate}>
          <TextInput type="date" value={values.readingDate} onChange={(e) => setValues({ ...values, readingDate: e.target.value })} invalid={!!errors.readingDate} />
        </Field>
        <Field label="Note (optional)" error={errors.note}>
          <TextArea value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} invalid={!!errors.note} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save reading</Button>
        </div>
      </form>
    </Panel>
  );
}

function VoidForm({ reading, onClose, onSubmit }: { reading: OdometerReading; onClose: () => void; onSubmit: (reason: string) => Errors | Promise<Errors> }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Panel title="Void odometer reading" description={`${reading.readingKm} km on ${formatDate(reading.readingDate)}`} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await onSubmit(reason);
          if (Object.keys(result).length) setErrors(result);
        }}
        className="space-y-4"
      >
        <Field label="Reason" hint="Voided readings are kept for the audit trail and excluded from calculations." error={errors.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger">Void reading</Button>
        </div>
      </form>
    </Panel>
  );
}
