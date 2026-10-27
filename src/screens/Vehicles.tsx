import { useMemo, useState, type FormEvent } from "react";
import { VEHICLE_TRANSITIONS, type VehicleInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { fleetDetailGaps, isThirdParty, usualDriverOf, vehicleDetailLine } from "../tms/vehicles";
import {
  VEHICLE_OWNERSHIPS,
  VEHICLE_OWNERSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type Vehicle,
  type VehicleStatus,
} from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, SearchInput, Select, TableCard, TextArea, TextInput, formatDateTime } from "../ui/primitives";
import { ImportPanel } from "../ui/ImportPanel";
import type { Route } from "../routes";

type PanelState = { mode: "create" } | { mode: "edit"; vehicle: Vehicle } | { mode: "transition"; vehicle: Vehicle } | { mode: "import" } | null;

const statusTone: Record<VehicleStatus, "success" | "warning" | "error" | "neutral"> = {
  available: "success",
  maintenance: "warning",
  out_of_service: "error",
  retired: "neutral",
};

const emptyInput = (): VehicleInput => ({
  registration: "",
  categoryId: "",
  make: "",
  model: "",
  seatCapacity: "",
  fuelType: "",
  ownership: "",
  ownerName: "",
  usualDriverId: "",
  notes: "",
});
const toInput = (v: Vehicle): VehicleInput => ({
  registration: v.registration,
  categoryId: v.categoryId,
  make: v.make,
  model: v.model,
  seatCapacity: String(v.seatCapacity),
  fuelType: v.fuelType,
  ownership: v.ownership ?? "",
  ownerName: v.ownerName,
  usualDriverId: v.usualDriverId ?? "",
  notes: v.notes,
});

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
      .filter((v) => !q || `${v.registration} ${v.make} ${v.model} ${categoryName(v.categoryId)} ${v.fuelType} ${v.ownerName}`.toLowerCase().includes(q))
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
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPanel({ mode: "import" })}>Import CSV</Button>
              <Button variant="primary" onClick={() => setPanel({ mode: "create" })} disabled={blocked} title={blocked ? "Add vehicle categories in Settings first" : undefined}>
                Add vehicle
              </Button>
            </div>
          ) : undefined
        }
      />

      {blocked && (
        <Notice tone="warning" title="Vehicle registration is blocked" className="mb-4">
          No vehicle categories are configured. {allowed("settings:update") ? <button type="button" className="underline" onClick={() => navigate("settings")}>Add categories in Settings</button> : "Ask an administrator to add categories in Settings"} before registering vehicles.
        </Notice>
      )}

      <TableCard
        title="Fleet register"
        summary={`${rows.length} of ${db.vehicles.length} shown · ${db.vehicles.filter((v) => v.status === "available").length} available`}
        toolbar={
          <>
            <SearchInput placeholder="Search registration, make, model, category" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search vehicles" />
            <Select className="max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | VehicleStatus)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {VEHICLE_STATUSES.map((s) => (
                <option key={s} value={s}>{VEHICLE_STATUS_LABELS[s]}</option>
              ))}
            </Select>
            <p className="rts-filter-bar-note" role="status">
              {db.vehicles.filter((v) => v.status === "maintenance").length} in maintenance · {db.vehicles.filter((v) => v.status === "out_of_service").length} off road
            </p>
            {/* FLT-01, D-106: what the register still cannot say, counted rather than glossed over.
                A fleet that looks complete but cannot be told from the one it leases is a problem
                the office should see on the screen, not discover at audit time. */}
            {(() => {
              const gaps = fleetDetailGaps(db);
              const parts = [
                gaps.noFuelType ? `${gaps.noFuelType} with no fuel type` : "",
                gaps.noOwnership ? `${gaps.noOwnership} with no ownership` : "",
              ].filter(Boolean);
              return parts.length > 0 ? (
                <p className="rts-filter-bar-note rts-unset" role="status">
                  {parts.join(" · ")} of {gaps.total}
                </p>
              ) : null;
            })()}
          </>
        }
      >
        <DataTable
        rows={rows}
        rowKey={(v) => v.id}
        emptyState={<EmptyState title={db.vehicles.length ? "No vehicles match" : "No vehicles registered"} body={db.vehicles.length ? "Adjust the search or status filter." : "Vehicles added here become available for trip assignment in the next phase."} />}
        columns={[
          { key: "reg", header: "Registration", render: (v) => <span className="font-mono text-xs font-semibold text-stone-900">{v.registration}</span> },
          { key: "cat", header: "Category", render: (v) => categoryName(v.categoryId) },
          {
            key: "mm",
            header: "Make / model",
            // The vehicle's own line, under the name: what it runs on and whose it is (D-106).
            render: (v) => (
              <>
                <span className="block">{[v.make, v.model].filter(Boolean).join(" ") || <span className="text-stone-400">-</span>}</span>
                {vehicleDetailLine(v) ? (
                  <span className="block text-xs text-stone-600">{vehicleDetailLine(v)}</span>
                ) : (
                  <span className="block text-xs rts-unset">fuel and ownership not recorded</span>
                )}
              </>
            ),
          },
          {
            key: "usual",
            header: "Usual driver",
            render: (v) => {
              const driver = usualDriverOf(db, v);
              if (!driver) return <span className="text-xs rts-unset">not recorded</span>;
              return (
                <span className="text-sm">
                  {driver.fullName}
                  {driver.status !== "active" && <span className="block text-xs text-amber-800">{driver.status}</span>}
                </span>
              );
            },
          },
          { key: "seats", header: "Seats", className: "rts-num", render: (v) => v.seatCapacity },
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
      </TableCard>

      {panel && panel.mode === "import" && <ImportPanel kind="vehicles" onClose={() => setPanel(null)} />}

      {panel && panel.mode !== "transition" && panel.mode !== "import" && (
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

        {/* FLT-01, D-106: the vehicle itself. Everything here may be left blank — a register that
            refuses to record a bus because nobody knows its fuel is worse than one that says so. */}
        <fieldset className="space-y-4 rounded-sm border border-stone-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">The vehicle itself</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fuel type" hint="As the office says it: Diesel, Petrol." error={errors.fuelType}>
              <TextInput value={values.fuelType ?? ""} onChange={(e) => set({ fuelType: e.target.value })} invalid={!!errors.fuelType} />
            </Field>
            <Field label="Ownership" hint="Leave blank if nobody knows yet — that is not the same as ours." error={errors.ownership}>
              <Select value={values.ownership ?? ""} onChange={(e) => set({ ownership: e.target.value, ownerName: e.target.value === "owned" ? "" : values.ownerName })} invalid={!!errors.ownership}>
                <option value="">Not recorded</option>
                {VEHICLE_OWNERSHIPS.map((ownership) => (
                  <option key={ownership} value={ownership}>{VEHICLE_OWNERSHIP_LABELS[ownership]}</option>
                ))}
              </Select>
            </Field>
          </div>
          {/* Asked only when the answer can exist: an owned bus has no other owner. */}
          {isThirdParty((values.ownership || null) as never) && (
            <Field label="Whose vehicle is it?" hint="The lessor, or the company it is being paid off to." error={errors.ownerName}>
              <TextInput value={values.ownerName ?? ""} onChange={(e) => set({ ownerName: e.target.value })} invalid={!!errors.ownerName} />
            </Field>
          )}
          <Field
            label="Usual driver (optional)"
            hint="Who normally takes it out. A habit, not an assignment — the run's own driver is what dispatch records."
            error={errors.usualDriverId}
          >
            <Select value={values.usualDriverId ?? ""} onChange={(e) => set({ usualDriverId: e.target.value })} invalid={!!errors.usualDriverId}>
              <option value="">No usual driver</option>
              {db.drivers
                .filter((driver) => driver.status !== "inactive")
                .map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.fullName}</option>
                ))}
            </Select>
          </Field>
        </fieldset>

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
