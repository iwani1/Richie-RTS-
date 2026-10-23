import { useMemo, useState, type FormEvent } from "react";
import { VEHICLE_TRANSITIONS, type VehicleInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { VEHICLE_STATUS_LABELS, VEHICLE_STATUSES, type Vehicle, type VehicleStatus } from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, Select, TextArea, TextInput, formatDateTime } from "../ui/primitives";
import type { Route } from "../routes";

type PanelState = { mode: "create" } | { mode: "edit"; vehicle: Vehicle } | { mode: "transition"; vehicle: Vehicle } | null;

const statusTone: Record<VehicleStatus, "success" | "warning" | "error" | "neutral"> = {
  available: "success",
  maintenance: "warning",
  out_of_service: "error",
  retired: "neutral",
};

const emptyInput = (): VehicleInput => ({ registration: "", categoryId: "", make: "", model: "", seatCapacity: "", notes: "" });
const toInput = (v: Vehicle): VehicleInput => ({ registration: v.registration, categoryId: v.categoryId, make: v.make, model: v.model, seatCapacity: String(v.seatCapacity), notes: v.notes });

export function VehiclesPage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<PanelState>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | VehicleStatus>("all");

  const categories = db.settings.vehicleCategories;
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Unknown";
  const blocked = categories.length === 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.vehicles
      .filter((v) => statusFilter === "all" || v.status === statusFilter)
      .filter((v) => !q || `${v.registration} ${v.make} ${v.model} ${categoryName(v.categoryId)}`.toLowerCase().includes(q))
      .sort((a, b) => a.registration.localeCompare(b.registration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.vehicles, query, statusFilter, categories]);

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Vehicles"
        description="Fleet register. Status changes follow the vehicle state machine and are written to the audit log."
        actions={
          allowed("vehicles:create") ? (
            <Button variant="primary" onClick={() => setPanel({ mode: "create" })} disabled={blocked} title={blocked ? "Add vehicle categories in Settings first" : undefined}>
              Add vehicle
            </Button>
          ) : undefined
        }
      />

      {blocked && (
        <Notice tone="warning" title="Vehicle registration is blocked" className="mb-4">
          No vehicle categories are configured. {allowed("settings:update") ? <button type="button" className="underline" onClick={() => navigate("settings")}>Add categories in Settings</button> : "Ask an administrator to add categories in Settings"} before registering vehicles.
        </Notice>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput className="max-w-xs" placeholder="Search registration, make, model, category" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search vehicles" />
        <Select className="max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | VehicleStatus)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {VEHICLE_STATUSES.map((s) => (
            <option key={s} value={s}>{VEHICLE_STATUS_LABELS[s]}</option>
          ))}
        </Select>
      </div>

      <DataTable
        rows={rows}
        rowKey={(v) => v.id}
        emptyState={<EmptyState title={db.vehicles.length ? "No vehicles match" : "No vehicles registered"} body={db.vehicles.length ? "Adjust the search or status filter." : "Vehicles added here become available for trip assignment in the next phase."} />}
        columns={[
          { key: "reg", header: "Registration", render: (v) => <span className="font-mono text-xs font-semibold text-stone-900">{v.registration}</span> },
          { key: "cat", header: "Category", render: (v) => categoryName(v.categoryId) },
          { key: "mm", header: "Make / model", render: (v) => [v.make, v.model].filter(Boolean).join(" ") || <span className="text-stone-400">-</span> },
          { key: "seats", header: "Seats", render: (v) => v.seatCapacity },
          { key: "status", header: "Status", render: (v) => <Badge tone={statusTone[v.status]}>{VEHICLE_STATUS_LABELS[v.status]}</Badge> },
          { key: "upd", header: "Updated", render: (v) => <span className="text-xs text-stone-500">{formatDateTime(v.updatedAt)}</span> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (v) => (
              <div className="flex justify-end gap-1">
                {allowed("vehicles:update") && <Button variant="ghost" onClick={() => setPanel({ mode: "edit", vehicle: v })}>Edit</Button>}
                {allowed("vehicles:transition") && (
                  <Button variant="ghost" disabled={VEHICLE_TRANSITIONS[v.status].length === 0} onClick={() => setPanel({ mode: "transition", vehicle: v })}>
                    Change status
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      {panel && panel.mode !== "transition" && (
        <VehicleForm
          key={panel.mode === "edit" ? panel.vehicle.id : "create"}
          initial={panel.mode === "edit" ? toInput(panel.vehicle) : emptyInput()}
          title={panel.mode === "edit" ? `Edit ${panel.vehicle.registration}` : "Add vehicle"}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = panel.mode === "edit" ? await dispatch({ type: "update_vehicle", id: panel.vehicle.id, input }) : await dispatch({ type: "create_vehicle", input });
            if (result.ok) {
              setFlash({ tone: "success", message: result.message });
              setPanel(null);
              return {};
            }
            setFlash({ tone: "error", message: result.message });
            return result.errors;
          }}
        />
      )}

      {panel && panel.mode === "transition" && (
        <TransitionForm
          vehicle={panel.vehicle}
          onClose={() => setPanel(null)}
          onSubmit={async (to, reason) => {
            const result = await dispatch({ type: "transition_vehicle", id: panel.vehicle.id, to, reason });
            if (result.ok) {
              setFlash({ tone: "success", message: result.message });
              setPanel(null);
              return {};
            }
            setFlash({ tone: "error", message: result.message });
            return result.errors;
          }}
        />
      )}
    </div>
  );
}

function VehicleForm({ initial, title, onClose, onSubmit }: { initial: VehicleInput; title: string; onClose: () => void; onSubmit: (input: VehicleInput) => Record<string, string> | Promise<Record<string, string>> }) {
  const { db } = useTms();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<VehicleInput>) => setValues({ ...values, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(await onSubmit(values));
  };
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Registration" error={errors.registration}>
          <TextInput value={values.registration} onChange={(e) => set({ registration: e.target.value })} invalid={!!errors.registration} autoFocus />
        </Field>
        <Field label="Category" error={errors.categoryId}>
          <Select value={values.categoryId} onChange={(e) => set({ categoryId: e.target.value })} invalid={!!errors.categoryId}>
            <option value="">Select a category</option>
            {db.settings.vehicleCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Make"><TextInput value={values.make} onChange={(e) => set({ make: e.target.value })} /></Field>
          <Field label="Model"><TextInput value={values.model} onChange={(e) => set({ model: e.target.value })} /></Field>
        </div>
        <Field label="Seat capacity" error={errors.seatCapacity}>
          <TextInput type="number" min={1} step={1} value={values.seatCapacity} onChange={(e) => set({ seatCapacity: e.target.value })} invalid={!!errors.seatCapacity} />
        </Field>
        <Field label="Notes"><TextArea value={values.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save vehicle</Button>
        </div>
      </form>
    </Panel>
  );
}

function TransitionForm({ vehicle, onClose, onSubmit }: { vehicle: Vehicle; onClose: () => void; onSubmit: (to: VehicleStatus, reason: string) => Record<string, string> | Promise<Record<string, string>> }) {
  const options = VEHICLE_TRANSITIONS[vehicle.status];
  const [to, setTo] = useState<VehicleStatus>(options[0]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <Panel title={`Change status: ${vehicle.registration}`} description={`Current status: ${VEHICLE_STATUS_LABELS[vehicle.status]}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors((await onSubmit(to, reason)) ?? {});
        }}
        className="space-y-4"
      >
        <Field label="New status" error={errors.to}>
          <Select value={to} onChange={(e) => setTo(e.target.value as VehicleStatus)}>
            {options.map((s) => (
              <option key={s} value={s}>{VEHICLE_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reason" hint="Recorded in the audit log." error={errors.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} autoFocus />
        </Field>
        {to === "retired" && <Notice tone="warning">Retired is a final state. The vehicle cannot be returned to service.</Notice>}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Apply</Button>
        </div>
      </form>
    </Panel>
  );
}
