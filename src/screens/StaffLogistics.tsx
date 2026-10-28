import { useMemo, useState, type FormEvent } from "react";
import type { IncidentAdvanceInput, WorkOrderAdvanceInput, CostInput, IncidentInput, WorkOrderInput } from "../tms/logistics";
import { INCIDENT_TRANSITIONS, WORK_ORDER_TRANSITIONS } from "../tms/logistics";
import { costReport } from "../tms/costs";
import { fleetReport } from "../tms/fleetReport";
import { financialReport } from "../tms/financialReport";
import { formatAmount } from "../tms/money";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  VEHICLE_RESTORATIONS,
  VEHICLE_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type CostEntry,
  type Incident,
  type IncidentStatus,
  type VehicleRestoration,
  type WorkOrder,
  type WorkOrderStatus,
} from "../tms/types";
import { SectionPanel, SectionTabs } from "../components/tms/SectionTabs";
import { FigureStrip } from "../components/tms/FigureStrip";
import { Panel as SurfacePanel } from "../components/tms/Panel";
import { useTms } from "../tms/useTms";
import {
  Badge,
  Button,
  Band,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  Select,
  TextArea,
  TextInput,
  formatDate,
  formatDateTime,
  todayYmd,
} from "../ui/primitives";

type Errors = Record<string, string>;
type Tab = "incidents" | "maintenance" | "costs";

const INCIDENT_TONE: Record<IncidentStatus, "info" | "warning" | "success" | "neutral"> = {
  reported: "info",
  acknowledged: "info",
  responding: "warning",
  resolved: "success",
  closed: "neutral",
};

const WORK_ORDER_TONE: Record<WorkOrderStatus, "info" | "warning" | "success" | "neutral"> = {
  open: "info",
  in_progress: "warning",
  on_hold: "warning",
  completed: "success",
  closed: "neutral",
};

const money = (amount: number, currency: string | null) => `${currency ?? ""} ${formatAmount(amount)}`.trim();
const percent = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);

export function StaffLogisticsPage() {
  const [tab, setTab] = useState<Tab>("incidents");

  return (
    <div>
      <PageHeader
        eyebrow="Service"
        title="Staff logistics"
        description="Breakdown response, maintenance coordination and recorded costs. Vehicle status follows what an operator records here; nothing is assumed."
      />
      <SectionTabs
        tabs={[
          { id: "incidents", label: "Incidents & breakdowns" },
          { id: "maintenance", label: "Work orders" },
          { id: "costs", label: "Cost report" },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Staff logistics sections"
        idPrefix="logistics"
        className="mb-4"
      />
      <SectionPanel prefix="logistics" id={tab}>
        {tab === "incidents" && <IncidentsTab onRaiseWorkOrder={() => setTab("maintenance")} />}
        {tab === "maintenance" && <MaintenanceTab />}
        {tab === "costs" && <CostsTab />}
      </SectionPanel>
    </div>
  );
}

// ---------------- shared cost pieces ----------------

function CostSection({
  title,
  entries,
  currency,
  canRecord,
  onAdd,
  onRemove,
  disabled,
  disabledReason,
}: {
  title: string;
  entries: CostEntry[];
  currency: string | null;
  canRecord: boolean;
  onAdd: (input: CostInput) => Errors | null | Promise<Errors | null>;
  onRemove: (costId: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { db } = useTms();
  const categories = db.settings.costCategories;
  const [values, setValues] = useState<CostInput>({ description: "", category: "", amount: "", incurredDate: todayYmd() });
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onAdd(values);
    if (result === null) {
      setValues({ description: "", category: "", amount: "", incurredDate: todayYmd() });
      setErrors({});
    } else {
      setErrors(result);
    }
  };

  return (
    <section className="border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No costs recorded. An empty list means nothing was entered, not that the cost was zero.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.map((cost) => (
            <li key={cost.id} className="flex items-start justify-between gap-3 rounded-sm border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{cost.description}</p>
                <p className="text-xs text-muted-foreground">
                  {cost.category ? `${cost.category} · ` : "Uncategorised · "}
                  {formatDate(cost.incurredDate)} · recorded by {cost.recordedBy}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{money(cost.amount, currency)}</span>
                {canRecord && !disabled && <Button variant="ghost" onClick={() => onRemove(cost.id)}>Remove</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canRecord && !disabled && (
        <form onSubmit={submit} className="mt-3 rounded-sm bg-muted p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What was the cost for?" error={errors.description}>
              <TextInput value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} invalid={!!errors.description} />
            </Field>
            <Field
              label="Category (optional)"
              hint={categories.length ? "From the list the company configured in Settings." : "No cost categories are configured yet; this will be counted as uncategorised."}
              error={errors.category}
            >
              <Select value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} invalid={!!errors.category}>
                <option value="">Uncategorised</option>
                {categories.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Amount${currency ? ` (${currency})` : ""}`} error={errors.amount}>
              <TextInput value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} inputMode="decimal" placeholder="0.00" invalid={!!errors.amount} />
            </Field>
            <Field label="Date incurred" error={errors.incurredDate}>
              <TextInput type="date" value={values.incurredDate} onChange={(e) => setValues({ ...values, incurredDate: e.target.value })} invalid={!!errors.incurredDate} />
            </Field>
          </div>
          <div className="mt-3">
            <Button type="submit" variant="primary">Record cost</Button>
          </div>
        </form>
      )}
      {disabled && disabledReason && <Notice tone="info" className="mt-2">{disabledReason}</Notice>}
    </section>
  );
}

// ---------------- incidents ----------------

function IncidentsTab({ onRaiseWorkOrder }: { onRaiseWorkOrder: () => void }) {
  const { db, allowed } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; incident: Incident } | { mode: "detail"; incident: Incident } | { mode: "workOrder"; incident: Incident } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | IncidentStatus>("all");

  const rows = useMemo(
    () =>
      db.incidents
        .filter((i) => statusFilter === "all" || i.status === statusFilter)
        .sort((a, b) => (a.reportedDate === b.reportedDate ? b.reference.localeCompare(a.reference) : a.reportedDate < b.reportedDate ? 1 : -1)),
    [db.incidents, statusFilter],
  );
  // Three states, three sentences: no vehicle named, the registration, or an id the register no
  // longer holds. A dash for the last one hides a broken link.
  const vehicleReg = (id: string | null) =>
    id ? db.vehicles.find((v) => v.id === id)?.registration ?? "not on the register" : "none named";

  // The other half of the response: what is already in the workshop, and which vehicles the
  // incident register has taken off the road. Both are read from the same snapshot as the table.
  const openOrders = db.workOrders.filter((w) => w.status === "open" || w.status === "in_progress" || w.status === "on_hold");
  const offRoad = db.vehicles.filter((v) => v.status === "maintenance" || v.status === "out_of_service");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select className="max-w-[210px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {(["reported", "acknowledged", "responding", "resolved", "closed"] as IncidentStatus[]).map((s) => (
            <option key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</option>
          ))}
        </Select>
        {allowed("incidents:create") && <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Report incident</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} of {db.incidents.length} incident{db.incidents.length === 1 ? "" : "s"} shown
        </p>
      </div>

      <Notice tone="info" className="mb-4">
        Taking a vehicle out of service here changes its status immediately, which blocks it from being assigned to trips and rentals. Record only what happened; do not infer a cause.
      </Notice>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div>
      <DataTable
        rows={rows}
        rowKey={(i) => i.id}
        emptyState={<EmptyState title={db.incidents.length ? "No incidents match" : "No incidents reported"} body="Report a breakdown, accident, damage or safety concern so that the response and its cost can be tracked." />}
        columns={[
          { key: "ref", header: "Ref", render: (i) => <span className="font-mono text-xs font-semibold text-foreground">{i.reference}</span> },
          { key: "type", header: "Type", render: (i) => <span className="font-medium">{INCIDENT_TYPE_LABELS[i.type]}</span> },
          { key: "vehicle", header: "Vehicle", render: (i) => vehicleReg(i.vehicleId) },
          { key: "date", header: "Reported", render: (i) => formatDate(i.reportedDate) },
          { key: "severity", header: "Severity", render: (i) => <Badge tone={i.severity === "critical" || i.severity === "high" ? "error" : i.severity === "medium" ? "warning" : "neutral"}>{INCIDENT_SEVERITY_LABELS[i.severity]}</Badge> },
          { key: "status", header: "Status", render: (i) => <Badge tone={INCIDENT_TONE[i.status]}>{INCIDENT_STATUS_LABELS[i.status]}</Badge> },
          { key: "costs", header: "Costs", render: (i) => (i.costEntries.length ? <span className="tabular-nums">{i.costEntries.length}</span> : <span className="text-dim">none recorded</span>) },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (i) => (
              <div className="flex justify-end gap-1">
                {allowed("incidents:update") && (i.status === "reported" || i.status === "acknowledged") && (
                  <Button variant="ghost" onClick={() => setPanel({ mode: "edit", incident: i })}>Edit</Button>
                )}
                <Button variant="ghost" onClick={() => setPanel({ mode: "detail", incident: i })}>Open</Button>
              </div>
            ),
          },
        ]}
      />
        </div>

        <aside aria-label="Work orders and vehicles off the road" className="self-start">
          <SurfacePanel
            kicker="Work orders"
            title={`${openOrders.length} still open`}
            description="Raised from an incident, so the cost keeps its source."
          >
            <div className="space-y-3 px-4 pb-4">
              <FigureStrip
                figures={(["open", "in_progress", "on_hold", "completed"] as WorkOrderStatus[]).map((status) => ({
                  label: WORK_ORDER_STATUS_LABELS[status],
                  value: db.workOrders.filter((w) => w.status === status).length,
                }))}
              />

              <div>
                <h3 className="tms-mono text-muted-foreground">Latest raised</h3>
                {openOrders.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">
                    No work order is open. A breakdown that needs workshop time is raised from the incident it came from, so the
                    cost keeps its source.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-divider border-y border-divider">
                    {openOrders.slice(0, 5).map((w) => (
                      <li key={w.id} className="flex items-baseline justify-between gap-2 py-2">
                        <span className="tms-num text-foreground">{w.reference}</span>
                        <span className="text-[11.5px] text-muted-foreground">{WORK_ORDER_STATUS_LABELS[w.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="tms-mono text-muted-foreground">Off the road</h3>
                {offRoad.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">Every registered vehicle is available.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-divider border-y border-divider">
                    {offRoad.map((v) => (
                      <li key={v.id} className="flex items-baseline justify-between gap-2 py-2">
                        <span className="tms-num text-foreground">{v.registration}</span>
                        <span className="text-[11.5px] text-muted-foreground">{VEHICLE_STATUS_LABELS[v.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SurfacePanel>
        </aside>
      </div>

      {panel?.mode === "create" && <IncidentForm incident={null} onClose={() => setPanel(null)} />}
      {panel?.mode === "edit" && <IncidentForm incident={panel.incident} onClose={() => setPanel(null)} />}
      {panel?.mode === "detail" && (
        <IncidentDetail
          incident={panel.incident}
          onClose={() => setPanel(null)}
          onRaiseWorkOrder={(incident) => setPanel({ mode: "workOrder", incident })}
        />
      )}
      {panel?.mode === "workOrder" && (
        <WorkOrderForm
          defaults={{ vehicleId: panel.incident.vehicleId ?? "", incidentId: panel.incident.id }}
          onClose={() => {
            setPanel(null);
            onRaiseWorkOrder();
          }}
        />
      )}
    </div>
  );
}

function IncidentForm({ incident, onClose }: { incident: Incident | null; onClose: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const [values, setValues] = useState<IncidentInput>(() =>
    incident
      ? {
          type: incident.type,
          severity: incident.severity,
          vehicleId: incident.vehicleId ?? "",
          tripId: incident.tripId ?? "",
          reportedDate: incident.reportedDate,
          description: incident.description,
          assignedTo: incident.assignedTo ?? "",
          takeVehicleOutOfService: false,
        }
      : {
          type: "breakdown",
          severity: "medium",
          vehicleId: "",
          tripId: "",
          reportedDate: todayYmd(),
          description: "",
          assignedTo: "",
          takeVehicleOutOfService: true,
        },
  );
  const [errors, setErrors] = useState<Errors>({});

  const vehicleRequired = values.type === "breakdown" || values.type === "accident" || values.type === "damage";
  const trips = db.trips.filter((t) => !values.vehicleId || t.vehicleId === values.vehicleId).slice(0, 30);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = incident ? await dispatch({ type: "update_incident", id: incident.id, input: values }) : await dispatch({ type: "create_incident", input: values });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={incident ? `Edit ${incident.reference}` : "Report an incident"}
      description="Only the report itself can be edited. Once the response starts, corrections go in the log so the original account is preserved."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" error={errors.type}>
            <Select value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value as IncidentInput["type"] })} invalid={!!errors.type}>
              {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="Severity" error={errors.severity}>
            <Select value={values.severity} onChange={(e) => setValues({ ...values, severity: e.target.value as IncidentInput["severity"] })} invalid={!!errors.severity}>
              {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={vehicleRequired ? "Vehicle" : "Vehicle (optional)"} error={errors.vehicleId}>
            <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value, tripId: "" })} invalid={!!errors.vehicleId}>
              <option value="">{vehicleRequired ? "Select a vehicle" : "Not vehicle related"}</option>
              {db.vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
            </Select>
          </Field>
          <Field label="Trip (optional)" hint="Links the incident to the run it happened on." error={errors.tripId}>
            <Select value={values.tripId} onChange={(e) => setValues({ ...values, tripId: e.target.value })} invalid={!!errors.tripId} disabled={!values.vehicleId}>
              <option value="">No linked trip</option>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.reference} · {formatDate(t.serviceDate)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Date reported" error={errors.reportedDate}>
          <TextInput type="date" value={values.reportedDate} onChange={(e) => setValues({ ...values, reportedDate: e.target.value })} invalid={!!errors.reportedDate} />
        </Field>
        <Field label="What happened?" hint="Facts only. The description may be read by finance and in an audit." error={errors.description}>
          <TextArea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} invalid={!!errors.description} autoFocus />
        </Field>
        <Field label="Responding to this (optional)" hint="Name of the person or team handling it." error={errors.assignedTo}>
          <TextInput value={values.assignedTo} onChange={(e) => setValues({ ...values, assignedTo: e.target.value })} invalid={!!errors.assignedTo} />
        </Field>
        <label className="flex items-start gap-2 rounded-sm border border-border bg-muted p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={values.takeVehicleOutOfService} onChange={(e) => setValues({ ...values, takeVehicleOutOfService: e.target.checked })} />
          <span>
            <span className="font-medium">Take the vehicle out of service now</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              This removes it from trip and rental assignment immediately. Choose it when the vehicle should not be dispatched. You decide again when the incident is resolved.
            </span>
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{incident ? "Save report" : "Report incident"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function IncidentDetail({ incident, onClose, onRaiseWorkOrder }: { incident: Incident; onClose: () => void; onRaiseWorkOrder: (i: Incident) => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  // Re-read from the store so the detail view reflects the latest state after a change.
  const current = db.incidents.find((i) => i.id === incident.id) ?? incident;
  const allowedTransitions = INCIDENT_TRANSITIONS[current.status];
  const [to, setTo] = useState<IncidentStatus>(allowedTransitions[0] ?? "closed");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [restoration, setRestoration] = useState<VehicleRestoration>("unchanged");
  const [errors, setErrors] = useState<Errors>({});

  const vehicle = db.vehicles.find((v) => v.id === current.vehicleId);
  const linked = db.workOrders.filter((w) => w.incidentId === current.id);

  const advance = async (event: FormEvent) => {
    event.preventDefault();
    const input: IncidentAdvanceInput = { to, note, assignedTo, resolutionNote, vehicleRestoredTo: restoration };
    const result = await dispatch({ type: "advance_incident", id: current.id, input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) {
      setNote("");
      setAssignedTo("");
      setResolutionNote("");
      setErrors({});
      // Offer the next sensible step now that the status has moved on.
      setTo(INCIDENT_TRANSITIONS[to][0] ?? to);
    } else setErrors(result.errors);
  };

  const addCost = async (input: CostInput): Promise<Errors | null> => {
    const result = await dispatch({ type: "add_incident_cost", id: current.id, input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    return result.ok ? null : result.errors;
  };

  return (
    <Panel title={`${current.reference} · ${INCIDENT_TYPE_LABELS[current.type]}`} description={`Reported ${formatDate(current.reportedDate)}. Status: ${INCIDENT_STATUS_LABELS[current.status]}.`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={INCIDENT_TONE[current.status]}>{INCIDENT_STATUS_LABELS[current.status]}</Badge>
          <Badge tone={current.severity === "critical" || current.severity === "high" ? "error" : current.severity === "medium" ? "warning" : "neutral"}>{INCIDENT_SEVERITY_LABELS[current.severity]}</Badge>
          {vehicle && <Badge tone="neutral">{vehicle.registration}</Badge>}
          {current.vehicleRestoredTo && <Badge tone="neutral">Vehicle: {current.vehicleRestoredTo.replace("_", " ")}</Badge>}
        </div>

        <p className="text-sm text-foreground">{current.description}</p>
        {current.resolutionNote && (
          <p className="rounded-sm border border-border bg-muted p-3 text-sm"><span className="font-medium">Resolution: </span>{current.resolutionNote}</p>
        )}

        {linked.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked work orders</h3>
            <ul className="mt-2 space-y-1">
              {linked.map((w) => (
                <li key={w.id} className="flex items-center justify-between rounded-sm border border-border px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{w.reference}</span>
                  <span className="flex-1 px-2">{w.title}</span>
                  <Badge tone={WORK_ORDER_TONE[w.status]}>{WORK_ORDER_STATUS_LABELS[w.status]}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response log</h3>
          <ol className="mt-2 space-y-2">
            {current.log.map((entry) => (
              <li key={entry.id} className="border-l-2 border-border pl-3">
                <p className="text-xs text-muted-foreground">{formatDateTime(entry.at)} · {entry.actorName}</p>
                <p className="text-sm">{entry.note}</p>
                {entry.fromStatus && <p className="text-xs text-dim">{entry.fromStatus} → {entry.toStatus}</p>}
              </li>
            ))}
          </ol>
        </div>

        <CostSection
          title="Costs"
          entries={current.costEntries}
          currency={db.settings.currencyCode}
          canRecord={allowed("incidents:cost")}
          onAdd={addCost}
          onRemove={async (costId) => {
            const result = await dispatch({ type: "remove_incident_cost", id: current.id, costId });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
          }}
          disabled={current.status === "closed"}
          disabledReason="This incident is closed. Costs can no longer be changed."
        />

        {allowedTransitions.length > 0 ? (
          <form onSubmit={advance} className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Move to</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="New status" error={errors.to}>
                <Select value={to} onChange={(e) => setTo(e.target.value as IncidentStatus)} invalid={!!errors.to}>
                  {allowedTransitions.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              {to === "responding" && (
                <Field label="Responding (required for a breakdown)" error={errors.assignedTo}>
                  <TextInput value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} invalid={!!errors.assignedTo} />
                </Field>
              )}
              {to === "resolved" && (
                <>
                  <Field label="How was it resolved?" error={errors.resolutionNote}>
                    <TextArea value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} invalid={!!errors.resolutionNote} />
                  </Field>
                  <Field label="Vehicle status after resolution" error={errors.vehicleRestoredTo}>
                    <Select value={restoration} onChange={(e) => setRestoration(e.target.value as VehicleRestoration)} invalid={!!errors.vehicleRestoredTo}>
                      {VEHICLE_RESTORATIONS.map((r) => <option key={r} value={r}>{r === "unchanged" ? "Leave unchanged" : VEHICLE_STATUS_LABELS[r]}</option>)}
                    </Select>
                  </Field>
                </>
              )}
            </div>
            <Field label="Note (optional)" className="mt-3" error={errors.note}>
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} invalid={!!errors.note} />
            </Field>
            <div className="mt-3 flex justify-end gap-2">
              {allowed("maintenance:create") && current.status !== "closed" && current.vehicleId && (
                <Button onClick={() => onRaiseWorkOrder(current)}>Raise work order</Button>
              )}
              <Button type="submit" variant="primary">Record change</Button>
            </div>
          </form>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">This incident is closed. No further status changes are allowed.</p>
        )}
      </div>
    </Panel>
  );
}

// ---------------- maintenance ----------------

function MaintenanceTab() {
  const { db, allowed } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; order: WorkOrder } | { mode: "detail"; order: WorkOrder } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | WorkOrderStatus>("all");

  const rows = useMemo(
    () =>
      db.workOrders
        .filter((w) => statusFilter === "all" || w.status === statusFilter)
        .sort((a, b) => (a.createdAt === b.createdAt ? b.reference.localeCompare(a.reference) : a.createdAt < b.createdAt ? 1 : -1)),
    [db.workOrders, statusFilter],
  );
  const vehicleReg = (id: string) => db.vehicles.find((v) => v.id === id)?.registration ?? "not on the register";

  // The incidents these orders came from, so the workshop column and the incident column answer
  // each other's question without switching tabs.
  const openIncidents = db.incidents.filter((i) => i.status !== "closed" && i.status !== "resolved");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Select className="max-w-[210px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {(["open", "in_progress", "on_hold", "completed", "closed"] as WorkOrderStatus[]).map((s) => (
            <option key={s} value={s}>{WORK_ORDER_STATUS_LABELS[s]}</option>
          ))}
        </Select>
        {allowed("maintenance:create") && <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Raise work order</Button>}
        <p className="ml-auto text-[11px] text-muted-foreground">
          {rows.length} of {db.workOrders.length} work order{db.workOrders.length === 1 ? "" : "s"} shown
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div>
      <DataTable
        rows={rows}
        rowKey={(w) => w.id}
        emptyState={<EmptyState title={db.workOrders.length ? "No work orders match" : "No work orders"} body="Raise a work order to coordinate maintenance and to record what it cost." />}
        columns={[
          { key: "ref", header: "Ref", render: (w) => <span className="font-mono text-xs font-semibold text-foreground">{w.reference}</span> },
          { key: "title", header: "Work", render: (w) => <div><p className="font-medium">{w.title}</p><p className="text-xs text-muted-foreground">{w.workType}{w.workshop ? ` · ${w.workshop}` : ""}</p></div> },
          { key: "vehicle", header: "Vehicle", render: (w) => vehicleReg(w.vehicleId) },
          { key: "planned", header: "Planned", render: (w) => (w.plannedDate ? formatDate(w.plannedDate) : <span className="text-dim">not set</span>) },
          { key: "status", header: "Status", render: (w) => <Badge tone={WORK_ORDER_TONE[w.status]}>{WORK_ORDER_STATUS_LABELS[w.status]}</Badge> },
          { key: "costs", header: "Costs", render: (w) => (w.costEntries.length ? <span className="tabular-nums">{w.costEntries.length}</span> : <span className="text-dim">none recorded</span>) },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (w) => (
              <div className="flex justify-end gap-1">
                {allowed("maintenance:update") && w.status !== "completed" && w.status !== "closed" && (
                  <Button variant="ghost" onClick={() => setPanel({ mode: "edit", order: w })}>Edit</Button>
                )}
                <Button variant="ghost" onClick={() => setPanel({ mode: "detail", order: w })}>Open</Button>
              </div>
            ),
          },
        ]}
      />
        </div>

        <aside aria-label="Open incidents" className="self-start">
          <SurfacePanel
            kicker="Incidents still open"
            title={`${openIncidents.length} awaiting resolution`}
            description="Oldest first: the one that has been waiting longest is the one to ask about."
          >
            <div className="space-y-3 px-4 pb-4">
              <FigureStrip
                figures={(["reported", "acknowledged", "responding"] as IncidentStatus[]).map((status) => ({
                  label: INCIDENT_STATUS_LABELS[status],
                  value: db.incidents.filter((i) => i.status === status).length,
                }))}
              />

              {openIncidents.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">No incident is waiting on a repair.</p>
              ) : (
                <ul className="divide-y divide-divider border-y border-divider">
                  {[...openIncidents]
                    .sort((a, b) => (a.reportedDate < b.reportedDate ? -1 : 1))
                    .slice(0, 6)
                    .map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-2 py-2">
                        <span className="tms-num text-foreground">{i.reference}</span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {INCIDENT_TYPE_LABELS[i.type]} · {formatDate(i.reportedDate)}
                        </span>
                      </li>
                    ))}
                </ul>
              )}

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A work order raised from an incident keeps that link: the cost is reported against the incident it came from, and
                the vehicle stays off the road until an operator says otherwise.
              </p>
            </div>
          </SurfacePanel>
        </aside>
      </div>

      {panel?.mode === "create" && <WorkOrderForm defaults={{ vehicleId: "", incidentId: "" }} onClose={() => setPanel(null)} />}
      {panel?.mode === "edit" && <WorkOrderForm defaults={{ vehicleId: panel.order.vehicleId, incidentId: panel.order.incidentId ?? "" }} order={panel.order} onClose={() => setPanel(null)} />}
      {panel?.mode === "detail" && <WorkOrderDetail order={panel.order} onClose={() => setPanel(null)} />}
    </div>
  );
}

function WorkOrderForm({ defaults, order, onClose }: { defaults: { vehicleId: string; incidentId: string }; order?: WorkOrder; onClose: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const [values, setValues] = useState<WorkOrderInput>(() =>
    order
      ? {
          vehicleId: order.vehicleId,
          title: order.title,
          workType: order.workType,
          workshop: order.workshop,
          description: order.description,
          reportedOdometer: order.reportedOdometer === null ? "" : String(order.reportedOdometer),
          plannedDate: order.plannedDate ?? "",
          incidentId: order.incidentId ?? "",
          resetsServiceInterval: order.resetsServiceInterval,
        }
      : {
          vehicleId: defaults.vehicleId,
          title: "",
          workType: "",
          workshop: "",
          description: "",
          reportedOdometer: "",
          plannedDate: "",
          incidentId: defaults.incidentId,
          resetsServiceInterval: false,
        },
  );
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = order ? await dispatch({ type: "update_work_order", id: order.id, input: values }) : await dispatch({ type: "create_work_order", input: values });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={order ? `Edit ${order.reference}` : "Raise a work order"}
      description="The type of work comes from the list the company keeps in Settings; the workshop is still free text, because no approved supplier list exists."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {db.vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </Select>
        </Field>
        <Field label="Title" error={errors.title}>
          <TextInput value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} invalid={!!errors.title} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Type of work"
            hint="From the list the company configured in Settings."
            error={errors.workType}
          >
            <Select value={values.workType} onChange={(e) => setValues({ ...values, workType: e.target.value })} invalid={!!errors.workType}>
              <option value="">Select a type</option>
              {db.settings.workTypes.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
              {/* An order written while this was free text keeps its own wording rather than being
                  silently reclassified. */}
              {values.workType && !db.settings.workTypes.includes(values.workType) && (
                <option value={values.workType}>{values.workType} (recorded before the list)</option>
              )}
            </Select>
          </Field>
          <Field label="Workshop (optional)" error={errors.workshop}>
            <TextInput value={values.workshop} onChange={(e) => setValues({ ...values, workshop: e.target.value })} invalid={!!errors.workshop} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Odometer reading (km)" hint="Required when this is a service for a km-tracked category." error={errors.reportedOdometer}>
            <TextInput value={values.reportedOdometer} onChange={(e) => setValues({ ...values, reportedOdometer: e.target.value })} inputMode="numeric" invalid={!!errors.reportedOdometer} />
          </Field>
          <Field label="Planned date (optional)" error={errors.plannedDate}>
            <TextInput type="date" value={values.plannedDate} onChange={(e) => setValues({ ...values, plannedDate: e.target.value })} invalid={!!errors.plannedDate} />
          </Field>
        </div>
        <label className="flex items-start gap-2 rounded-sm border border-border bg-muted p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={Boolean(values.resetsServiceInterval)} onChange={(e) => setValues({ ...values, resetsServiceInterval: e.target.checked })} />
          <span>
            <span className="font-medium">This work resets the service interval</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Tick only when this job is a service that restarts the schedule for the vehicle&apos;s category. You make that call; the system never infers it.
            </span>
          </span>
        </label>
        {errors.resetsServiceInterval && <p className="text-xs font-medium text-red-700" role="alert">{errors.resetsServiceInterval}</p>}
        <Field label="Description" error={errors.description}>
          <TextArea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} invalid={!!errors.description} />
        </Field>
        <Field label="Raised from incident (optional)" error={errors.incidentId}>
          <Select value={values.incidentId} onChange={(e) => setValues({ ...values, incidentId: e.target.value })} invalid={!!errors.incidentId}>
            <option value="">Not linked to an incident</option>
            {db.incidents.map((i) => <option key={i.id} value={i.id}>{i.reference} · {INCIDENT_TYPE_LABELS[i.type]}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{order ? "Save work order" : "Raise work order"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function WorkOrderDetail({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  const current = db.workOrders.find((w) => w.id === order.id) ?? order;
  // Closing is the release, so it is offered only to an account that may release the vehicle.
  const allowedTransitions = WORK_ORDER_TRANSITIONS[current.status].filter((status) => status !== "closed" || allowed("maintenance:release"));
  const [to, setTo] = useState<WorkOrderStatus>(allowedTransitions[0] ?? "closed");
  const [note, setNote] = useState("");
  const [costsConfirmed, setCostsConfirmed] = useState(current.costEntries.length > 0);
  const [restoration, setRestoration] = useState<VehicleRestoration>("available");
  const [errors, setErrors] = useState<Errors>({});
  const vehicle = db.vehicles.find((v) => v.id === current.vehicleId);
  const incident = current.incidentId ? db.incidents.find((i) => i.id === current.incidentId) : null;

  const advance = async (event: FormEvent) => {
    event.preventDefault();
    const input: WorkOrderAdvanceInput = { to, note, costsConfirmedComplete: costsConfirmed, vehicleRestoredTo: restoration };
    const result = await dispatch({ type: "advance_work_order", id: current.id, input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) {
      setNote("");
      setErrors({});
      // Offer the next sensible step now that the status has moved on.
      setTo(WORK_ORDER_TRANSITIONS[to][0] ?? to);
    } else setErrors(result.errors);
  };

  return (
    <Panel title={`${current.reference} · ${current.title}`} description={`Vehicle ${vehicle?.registration ?? "not on the register"} · ${WORK_ORDER_STATUS_LABELS[current.status]}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={WORK_ORDER_TONE[current.status]}>{WORK_ORDER_STATUS_LABELS[current.status]}</Badge>
          <Badge tone="neutral">{current.workType}</Badge>
          {current.workshop && <Badge tone="neutral">{current.workshop}</Badge>}
          {incident && <Badge tone="info">from {incident.reference}</Badge>}
        </div>
        {current.description && <p className="text-sm text-foreground">{current.description}</p>}
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Odometer</p><p className="font-medium">{current.reportedOdometer === null ? "not recorded" : `${current.reportedOdometer} km`}</p></div>
          <div><p className="text-xs text-muted-foreground">Planned</p><p className="font-medium">{current.plannedDate ? formatDate(current.plannedDate) : "not set"}</p></div>
          <div><p className="text-xs text-muted-foreground">Cost position</p><p className="font-medium">{current.costsConfirmedComplete ? "confirmed complete" : "not confirmed"}</p></div>
        </div>
        {current.holdReason && <p className="rounded-sm border border-border bg-muted p-3 text-sm"><span className="font-medium">On hold: </span>{current.holdReason}</p>}
        {current.completionNote && <p className="rounded-sm border border-border bg-muted p-3 text-sm"><span className="font-medium">Work done: </span>{current.completionNote}</p>}
        {current.releasedBy && (
          <p className="rounded-sm border border-border bg-muted p-3 text-sm">
            <span className="font-medium">Released for service by </span>{current.releasedBy}
            {current.releasedAt ? ` · ${formatDateTime(current.releasedAt)}` : ""}
          </p>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity log</h3>
          <ol className="mt-2 space-y-2">
            {current.log.map((entry) => (
              <li key={entry.id} className="border-l-2 border-border pl-3">
                <p className="text-xs text-muted-foreground">{formatDateTime(entry.at)} · {entry.actorName}</p>
                <p className="text-sm">{entry.note}</p>
              </li>
            ))}
          </ol>
        </div>

        <CostSection
          title="Costs"
          entries={current.costEntries}
          currency={db.settings.currencyCode}
          canRecord={allowed("maintenance:cost")}
          onAdd={async (input) => {
            const result = await dispatch({ type: "add_work_order_cost", id: current.id, input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            return result.ok ? null : result.errors;
          }}
          onRemove={async (costId) => {
            const result = await dispatch({ type: "remove_work_order_cost", id: current.id, costId });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
          }}
          disabled={current.status === "closed"}
          disabledReason="This work order is closed. Costs can no longer be changed."
        />

        {allowedTransitions.length > 0 ? (
          <form onSubmit={advance} className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Move to</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="New status" error={errors.to}>
                <Select value={to} onChange={(e) => setTo(e.target.value as WorkOrderStatus)} invalid={!!errors.to}>
                  {allowedTransitions.map((s) => <option key={s} value={s}>{WORK_ORDER_STATUS_LABELS[s]}</option>)}
                </Select>
              </Field>
              {to === "closed" && (
                <Field label="Vehicle status when closing" error={errors.vehicleRestoredTo}>
                  <Select value={restoration} onChange={(e) => setRestoration(e.target.value as VehicleRestoration)} invalid={!!errors.vehicleRestoredTo}>
                    {VEHICLE_RESTORATIONS.map((r) => <option key={r} value={r}>{r === "unchanged" ? "Leave unchanged" : VEHICLE_STATUS_LABELS[r]}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <Field label={to === "on_hold" ? "Why is it on hold?" : to === "completed" ? "What work was done?" : to === "closed" ? "Cost review note" : "Note (optional)"} className="mt-3" error={errors.note}>
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} invalid={!!errors.note} />
            </Field>
            {to === "completed" && (
              <label className="mt-3 flex items-start gap-2 rounded-sm border border-border bg-muted p-3 text-sm">
                <input type="checkbox" className="mt-0.5" checked={costsConfirmed} onChange={(e) => setCostsConfirmed(e.target.checked)} />
                <span>
                  <span className="font-medium">The cost position is complete</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Tick this once every cost has been recorded. If there was no cost, ticking it is the explicit zero confirmation the workflow requires.
                  </span>
                </span>
              </label>
            )}
            {errors.costsConfirmedComplete && <p className="mt-2 text-xs font-medium text-red-700">{errors.costsConfirmedComplete}</p>}
            {to === "closed" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Closing the work order returns the vehicle to service and records your name as the person who released it.
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <Button type="submit" variant="primary">Record change</Button>
            </div>
          </form>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            {current.status === "closed"
              ? "This work order is closed. No further status changes are allowed."
              : "The work is complete. Releasing the vehicle back into service is a separate control: an administrator or operations user must close the work order and sign the release."}
          </p>
        )}
      </div>
    </Panel>
  );
}

// ---------------- costs ----------------

function CostsTab() {
  const { db, allowed } = useTms();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayYmd());
  const validRange = from <= to;
  const report = validRange ? costReport(db, from, to) : null;
  // RPT-03 and RPT-02 (Q-29, D-78). Neither is recomputed here: cost per run divides the same total
  // the band above prints, from the same function the money report and the PDF use, and utilisation
  // is the function the fleet dashboard prints. Two screens, one arithmetic. Utilisation is offered
  // only to a role the server gives the fleet to, because finance's snapshot withholds the runs it
  // is counted from.
  const moneyReport = validRange ? financialReport(db, from, to) : null;
  const fleet = validRange && allowed("fleet:read") ? fleetReport(db, from, to) : null;

  // Grouping is presentation only: every line is still listed in full below this summary.
  const byCategory = (report?.lines ?? []).reduce<Map<string, { count: number; amount: number }>>((acc, line) => {
    const key = line.category?.trim() || "Uncategorised";
    const current = acc.get(key) ?? { count: 0, amount: 0 };
    acc.set(key, { count: current.count + 1, amount: current.amount + line.amount });
    return acc;
  }, new Map());

  if (!allowed("costs:read")) {
    return <Notice tone="warning" title="Not permitted">Your role does not include costs:read.</Notice>;
  }

  return (
    <div className="space-y-5">
      <Band label="Reporting period" note="Costs are shown for the dates they were incurred. In scope are incidents and work orders raised in the period, and expenses filed by the day the money was spent.">
        <div className="flex flex-wrap gap-3">
          <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {!validRange && <Notice tone="error" className="mt-3">"From" must be on or before "To".</Notice>}
      </Band>

      {report && (
        <>
          <Band
            label="Recorded spending"
            note="Maintenance, incident costs and expenses such as fuel and tolls, together: one figure, so this report and the money report cannot tell different stories. These are amounts entered by your team, not prices the system calculated."
          >
            {report.status !== "ok" && <Notice tone="warning" title={report.status === "currency_not_set" ? "Currency not set" : "No costs recorded"}>{report.message}</Notice>}
            {report.status === "ok" && <Notice tone="info" className="mb-3">{report.message}</Notice>}
            {/* A ruled total, not four cards: the number that matters is the sum, and the three
                coverage figures belong under it as a line of evidence, not beside it as equals. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-[34px] leading-none font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                {report.status === "ok" ? money(report.total, report.currencyCode) : "Not computed"}
              </p>
              <p className="text-[12px] text-muted-foreground">
                total recorded · {report.lines.length} {report.lines.length === 1 ? "entry" : "entries"}
              </p>
            </div>
            <div className="mt-4">
              <FigureStrip
                figures={[
                  { label: "Records with a cost", value: report.coverage === null ? "—" : `${Math.round(report.coverage * 100)}%` },
                  { label: "Work orders with no cost", value: report.workOrdersWithoutCosts },
                  { label: "Incidents with no cost", value: report.incidentsWithoutCosts },
                  { label: "Incidents with an entry", value: report.incidentsWithCosts },
                  { label: "Expenses", value: report.expenseCount },
                  { label: "Expenses with no receipt number", value: report.expensesWithoutReceipt },
                ]}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {report.workOrdersCostsConfirmed} work order(s) confirmed complete, including zero.
              {report.expenseCount > 0 &&
                ` Of ${report.expenseCount} expense(s), ${report.expensesWithReceiptHeld} carry the paper receipt; the rest are counted but weaker evidence.`}
            </p>
          </Band>

          <Band label="By category" note="Categories come from the list in Settings. Uncategorised entries are shown as their own line, not folded into another.">
            {report.lines.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Nothing recorded in this period.</p>
            ) : (
              <div className="overflow-x-auto rounded-control border border-border">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">Recorded spending by category, with the count and the amount</caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {["Category", "Entries", "Amount"].map((heading, index) => (
                        <th
                          key={heading}
                          scope="col"
                          className={index === 2 ? "tms-mono px-3 py-2 text-right font-medium text-muted-foreground" : "tms-mono px-3 py-2 text-left font-medium text-muted-foreground"}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...byCategory.entries()]
                      .sort((a, b) => b[1].amount - a[1].amount || a[0].localeCompare(b[0]))
                      .map(([category, line]) => (
                        <tr key={category} className="border-b border-divider last:border-b-0 hover:bg-row-hover">
                          <td className="px-3 py-2 text-[13px] text-foreground">{category}</td>
                          <td className="px-3 py-2 text-[13px] text-muted-foreground tabular-nums">{line.count}</td>
                          <td className="tms-num px-3 py-2 text-right text-foreground">{money(line.amount, report.currencyCode)}</td>
                        </tr>
                      ))}
                    <tr className="border-t border-border bg-muted/30">
                      <td className="px-3 py-2 text-[13px] font-semibold text-foreground">Total recorded</td>
                      <td className="px-3 py-2 text-[13px] text-muted-foreground tabular-nums">{report.lines.length}</td>
                      <td className="tms-num px-3 py-2 text-right font-semibold text-foreground">{money(report.total, report.currencyCode)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Band>

          <Band
            label="Cost entries"
            note="Maintenance and incident costs are audited and editable until the record is closed. Expenses are entered in the Expenses screen and are never edited — a wrong one is voided there, with a reason. A source starting EXP- is an expense."
          >
            {report.lines.length === 0 ? (
              <EmptyState title="No cost entries" body="Nothing was recorded in this period. This is not a statement that the cost was zero." />
            ) : (
              <DataTable
                rows={report.lines}
                rowKey={(l) => l.id}
                emptyState={<EmptyState title="No cost entries" body="" />}
                columns={[
                  { key: "date", header: "Date", render: (l) => formatDate(l.incurredDate) },
                  { key: "desc", header: "Description", render: (l) => <span className="font-medium">{l.description}</span> },
                  { key: "cat", header: "Category", render: (l) => (l.category || <span className="text-dim">Uncategorised</span>) },
                  { key: "source", header: "Source", render: (l) => <span className="font-mono text-xs">{l.sourceReference}</span> },
                  { key: "amount", header: "Amount", className: "text-right", render: (l) => <span className="tabular-nums font-semibold">{money(l.amount, report.currencyCode)}</span> },
                  { key: "by", header: "Recorded by", render: (l) => l.recordedBy },
                ]}
              />
            )}
          </Band>

          <Band
            label="RPT-03 Cost per completed run"
            note="Recorded costs in this period ÷ the runs completed in it. The numerator is the total printed above, so this figure and that total cannot tell different stories."
          >
            {moneyReport && (
              <>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-[34px] leading-none font-semibold tracking-[-0.04em] text-foreground tabular-nums">
                    {moneyReport.costPerTrip === null ? "Not available" : money(moneyReport.costPerTrip, moneyReport.currencyCode)}
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {moneyReport.completedTrips === 0
                      ? "no run was completed in this period"
                      : `per completed run · ${moneyReport.completedTrips} ${moneyReport.completedTrips === 1 ? "run" : "runs"}`}
                  </p>
                </div>
                <div className="mt-4">
                  <FigureStrip
                    figures={[
                      { label: "Runs completed", value: moneyReport.completedTrips },
                      { label: "Riders boarded", value: moneyReport.passengersBoarded },
                      { label: "Cost per rider boarded", value: moneyReport.costPerPassenger === null ? "—" : money(moneyReport.costPerPassenger, moneyReport.currencyCode) },
                    ]}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Divided by runs the records say were completed in the period, not by runs that were planned: a run that was never worked carries no cost of its own. Only riders recorded as boarded are counted, so a no-show does not make the remaining riders look more expensive. With no completed run there is nothing to divide by, and the figure says so rather than showing zero.
                </p>
              </>
            )}
          </Band>

          {fleet && (
            <Band
              label="RPT-02 Fleet utilisation"
              note="Committed vehicle-days ÷ available vehicle-days: every day a run or a hire held a bus, over one day for each bus in service. This is the figure the fleet dashboard prints, counted by the same function."
            >
              <FigureStrip
                figures={[
                  { label: "Utilisation", value: percent(fleet.utilisation) },
                  { label: "Committed vehicle-days", value: fleet.committedVehicleDays },
                  { label: "Available vehicle-days", value: fleet.availableVehicleDays },
                  { label: "Days worked", value: fleet.vehicleDays.worked },
                  { label: "Days in the workshop", value: fleet.vehicleDays.workshop },
                  { label: "Idle days", value: fleet.vehicleDays.idle },
                ]}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Counted in days, not hours: nothing in the program records an hour of a vehicle&apos;s time, so an hours-based figure would be a guess (Q-29). A bus that was sold for a day and never ran counts as committed and as not worked — the dashboard splits the two. Retired vehicles are left out of every day, because the date a vehicle left the fleet is not recorded, and the dashboard lists which ones and why.
              </p>
            </Band>
          )}
        </>
      )}
    </div>
  );
}
