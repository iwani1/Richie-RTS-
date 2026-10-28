import { useMemo, useState, type FormEvent } from "react";
import { VEHICLE_TRANSITIONS, type VehicleInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { fleetDetailGaps, isThirdParty, usualDriverOf, vehicleDetailLine } from "../tms/vehicles";
import {
  FLEET_STATE_LABELS,
  FLEET_STATE_ORDER,
  FLEET_STATE_RULES,
  fleetStateCounts,
  fleetStateOf,
  nextCommitmentOf,
  type FleetState,
} from "../tms/fleetState";
import { VEHICLE_PHOTO_LIMITS, vehiclePhotoLine, vehiclesWithoutPhoto } from "../tms/vehiclePhoto";
import {
  VEHICLE_OWNERSHIPS,
  VEHICLE_OWNERSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  type Vehicle,
  type VehicleStatus,
} from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, SearchInput, Select, TableCard, TextArea, TextInput, formatDateTime, todayYmd } from "../ui/primitives";
import { ImportPanel } from "../ui/ImportPanel";
import type { Route } from "../routes";

type PanelState =
  | { mode: "create" }
  | { mode: "edit"; vehicle: Vehicle }
  | { mode: "transition"; vehicle: Vehicle }
  | { mode: "photo"; vehicle: Vehicle }
  | { mode: "import" }
  | null;

/**
 * The tone of each state's badge (FLT-02, D-109).
 *
 * Colour is never the only carrier — the badge always prints its own word, and the register prints
 * the reference beside it — so this only has to make a fleet readable at a glance.
 */
const stateTone: Record<FleetState, "success" | "warning" | "error" | "neutral"> = {
  available: "success",
  reserved: "neutral",
  assigned: "neutral",
  on_trip: "success",
  pending_inspection: "warning",
  maintenance: "warning",
  out_of_service: "error",
  retired: "neutral",
};

/** The stored words a derived state can disagree with, and the ones worth printing when it does. */
const BLOCKING_STATES: readonly FleetState[] = ["pending_inspection", "maintenance", "out_of_service"];

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
  // The filter speaks the brief's vocabulary — the seven states (D-109), not only the four stored
  // words — because "show me everything in the workshop" has to include a bus waiting for release.
  const [stateFilter, setStateFilter] = useState<"all" | FleetState>("all");
  const today = todayYmd();

  const categories = db.settings.vehicleCategories;
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Unknown";
  const blocked = categories.length === 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.vehicles
      .filter((v) => stateFilter === "all" || fleetStateOf(db, v.id, today)?.state === stateFilter)
      .filter((v) => !q || `${v.registration} ${v.make} ${v.model} ${categoryName(v.categoryId)} ${v.fuelType} ${v.ownerName}`.toLowerCase().includes(q))
      .sort((a, b) => a.registration.localeCompare(b.registration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.vehicles, query, stateFilter, categories, db.trips, db.rentals, db.workOrders, db.routes, db.drivers, today]);

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Vehicles"
        description="Fleet register. Each bus shows what it is doing today, read from the runs, the hires and the work orders; the office's own status — available, in the workshop, off the road — is what a person changes, and every change is written to the audit log."
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
        summary={`${rows.length} of ${db.vehicles.length} shown · ${fleetStateCounts(db, today).available} available today`}
        toolbar={
          <>
            <SearchInput placeholder="Search registration, make, model, category" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search vehicles" />
            <Select className="max-w-[190px]" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as "all" | FleetState)} aria-label="Filter by state">
              <option value="all">All states</option>
              {FLEET_STATE_ORDER.map((state) => (
                <option key={state} value={state}>{FLEET_STATE_LABELS[state]}</option>
              ))}
            </Select>
            {/* FLT-02, D-109: the fleet counted by what it is doing, not only by what the office has
                typed. A bus waiting for a release is neither "available" nor "in the workshop" in any
                useful sense, and it is the one most likely to be dispatched by mistake. */}
            {(() => {
              const counts = fleetStateCounts(db, today);
              const parts = FLEET_STATE_ORDER.filter((state) => state !== "retired" && counts[state] > 0).map(
                (state) => `${counts[state]} ${FLEET_STATE_LABELS[state].toLowerCase()}`,
              );
              if (counts.retired > 0) parts.push(`${counts.retired} retired`);
              return (
                <p className="rts-filter-bar-note" role="status">
                  {parts.length > 0 ? `${parts.join(" · ")} of ${counts.total}` : "No vehicles registered"}
                </p>
              );
            })()}
            {/* FLT-01, D-106: what the register still cannot say, counted rather than glossed over.
                A fleet that looks complete but cannot be told from the one it leases is a problem
                the office should see on the screen, not discover at audit time. */}
            {(() => {
              const gaps = fleetDetailGaps(db);
              const noPhoto = vehiclesWithoutPhoto(db);
              const parts = [
                gaps.noFuelType ? `${gaps.noFuelType} with no fuel type` : "",
                gaps.noOwnership ? `${gaps.noOwnership} with no ownership` : "",
                noPhoto ? `${noPhoto} with no photograph` : "",
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
          {
            key: "photo",
            header: "Photograph",
            // A thumbnail, or the plain statement that there is none. The image is served through the
            // route that checks the role and the caller's own-record scope (D-108), never inlined.
            render: (v) =>
              v.photo ? (
                // A plain <img>, not next/image: the optimiser caches what it fetches, and this
                // route serves a private picture under a session check (D-108).
                <img
                  src={`/api/vehicle-photo/${v.id}`}
                  alt={`${v.registration}`}
                  className="rts-thumb"
                  width={56}
                  height={40}
                />
              ) : (
                <span className="text-xs rts-unset">none</span>
              ),
          },
          { key: "reg", header: "Registration", render: (v) => <span className="font-mono text-xs font-semibold text-foreground">{v.registration}</span> },
          { key: "cat", header: "Category", render: (v) => categoryName(v.categoryId) },
          {
            key: "mm",
            header: "Make / model",
            // The vehicle's own line, under the name: what it runs on and whose it is (D-106).
            render: (v) => (
              <>
                <span className="block">{[v.make, v.model].filter(Boolean).join(" ") || <span className="text-dim">-</span>}</span>
                {vehicleDetailLine(v) ? (
                  <span className="block text-xs text-muted-foreground">{vehicleDetailLine(v)}</span>
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
          {
            key: "state",
            header: "Today",
            // The state, then the record behind it, then — only when the office's own word disagrees
            // with what the records show — that word, so nobody has to guess which one to believe.
            render: (v) => {
              const reading = fleetStateOf(db, v.id, today);
              if (!reading) return <span className="text-xs rts-unset">not on the register</span>;
              const storedWord = BLOCKING_STATES.includes(reading.state) && reading.state !== v.status;
              return (
                <span className="block">
                  <span className="flex items-center gap-2">
                    <Badge tone={stateTone[reading.state]}>{reading.label}</Badge>
                    {reading.reference && <span className="rts-state-ref">{reading.reference}</span>}
                  </span>
                  {storedWord && (
                    <span className="mt-1 block text-xs rts-unset">register: {VEHICLE_STATUS_LABELS[v.status].toLowerCase()}</span>
                  )}
                  {reading.conflict && <span className="mt-1 block text-xs text-amber-800">{reading.conflict}</span>}
                </span>
              );
            },
          },
          { key: "upd", header: "Updated", render: (v) => <span className="text-xs text-muted-foreground">{formatDateTime(v.updatedAt)}</span> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (v) => (
              <div className="flex justify-end gap-1">
                {allowed("vehicles:update") && <Button variant="ghost" onClick={() => setPanel({ mode: "edit", vehicle: v })}>Edit</Button>}
                {allowed("vehicles:update") && (
                  <Button variant="ghost" onClick={() => setPanel({ mode: "photo", vehicle: v })}>
                    {v.photo ? "Photograph" : "Add photograph"}
                  </Button>
                )}
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

      {/* The brief asks for the rule behind each state, not only the label (FLT-02). A rule that lives
          only in the documentation is a rule nobody at the desk has read. */}
      <details className="rts-state-rules">
        <summary>How each state is decided</summary>
        <dl>
          {FLEET_STATE_RULES.map((entry) => (
            <div key={entry.state}>
              <dt>{FLEET_STATE_LABELS[entry.state]}</dt>
              <dd>{entry.rule}</dd>
              <dd>
                <strong>Leaves it:</strong> {entry.leaves}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      {panel && panel.mode === "import" && <ImportPanel kind="vehicles" onClose={() => setPanel(null)} />}

      {/* Modes with a panel of their own are excluded here: every mode this form does not name would
          otherwise open behind it, and two dialogs at once is two places to type. */}
      {panel && (panel.mode === "create" || panel.mode === "edit") && (
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

      {panel && panel.mode === "photo" && (
        <VehiclePhotoForm vehicle={panel.vehicle} onClose={() => setPanel(null)} />
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
        <fieldset className="space-y-4 rounded-sm border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The vehicle itself</legend>
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
  const { db } = useTms();
  const options = VEHICLE_TRANSITIONS[vehicle.status];
  const [to, setTo] = useState<VehicleStatus>(options[0]);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const today = todayYmd();
  const reading = fleetStateOf(db, vehicle.id, today);
  const next = nextCommitmentOf(db, vehicle.id, today);
  return (
    <Panel title={`Change status: ${vehicle.registration}`} description={`The office's word for this bus: ${VEHICLE_STATUS_LABELS[vehicle.status].toLowerCase()}.`} onClose={onClose}>
      {reading && (
        <Notice tone={BLOCKING_STATES.includes(reading.state) ? "warning" : "info"} title={`Today: ${reading.label}`}>
          {reading.sentence}
          {next && reading.state === "available" && (
            <> Next spoken for on {next.onDate}: {next.text}.</>
          )}
        </Notice>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Available, in the workshop, off the road and retired are this register's own words, and this panel is where they change.
        On trip, assigned, reserved and pending inspection are read from the runs, the hires and the work orders — they change when
        those records do, never by a status change here.
      </p>
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

/**
 * The vehicle's photograph (FLT-01, D-108).
 *
 * One picture per vehicle: filing a new one replaces what is on file, because a register holding four
 * photographs of the same bus leaves a reader wondering which one is the bus. Taking one off needs a
 * reason — a photograph of a damaged bus is evidence, and evidence does not vanish silently.
 *
 * The file goes through `/api/vehicle-photo`, not a command: the row may only be written after the
 * bytes are on the disk, which is a thing only the server can promise.
 */
function VehiclePhotoForm({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const { attachVehiclePhoto, dispatch, setFlash } = useTms();
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});

  const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const tooBig = file !== null && file.size > VEHICLE_PHOTO_LIMITS.maxBytes;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setErrors({ file: "Choose the photograph of the vehicle." });
      return;
    }
    setSaving(true);
    const result = await attachVehiclePhoto(vehicle.id, file);
    setSaving(false);
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    const result = await dispatch({ type: "remove_vehicle_photo", vehicleId: vehicle.id, reason });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setRemoveErrors(result.errors);
  };

  return (
    <Panel
      title={`Photograph: ${vehicle.registration}`}
      description="One picture per vehicle, used to recognise the bus in the yard. The file is kept in a folder on this machine, not inside the database."
      onClose={onClose}
    >
      {vehicle.photo ? (
        <figure className="mb-4">
          {/* A plain <img> for the same reason as the row thumbnail: nothing here may be cached. */}
          <img
            src={`/api/vehicle-photo/${vehicle.id}`}
            alt={`Photograph of ${vehicle.registration}`}
            className="rts-photo"
          />
          <figcaption className="mt-2 text-xs text-muted-foreground">
            {vehicle.photo.originalName} · {megabytes(vehicle.photo.byteSize)} · {vehiclePhotoLine(vehicle.photo)}
          </figcaption>
        </figure>
      ) : (
        <Notice tone="info">No photograph has been filed for this vehicle. The register says so rather than showing a placeholder picture.</Notice>
      )}

      <form onSubmit={submit} className="mt-4 space-y-4">
        <Field
          label={vehicle.photo ? "Replace the photograph" : "The photograph"}
          hint={`JPEG, PNG or WebP, under ${megabytes(VEHICLE_PHOTO_LIMITS.maxBytes)}. Most phones will let you choose a smaller size.`}
          error={errors.file ?? (tooBig ? `That file is ${megabytes(file.size)}. Choose a smaller size.` : undefined)}
        >
          <input
            type="file"
            className="rts-input"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            aria-label="Vehicle photograph"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setErrors({});
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary" disabled={saving || !file || tooBig}>
            {saving ? "Filing…" : vehicle.photo ? "Replace the photograph" : "File the photograph"}
          </Button>
        </div>
      </form>

      {vehicle.photo && (
        <form onSubmit={remove} className="mt-6 space-y-3 border-t border-border pt-4">
          {!removing ? (
            <div className="flex justify-end">
              <Button variant="danger" onClick={() => setRemoving(true)}>
                Take the photograph off
              </Button>
            </div>
          ) : (
            <>
              <Field
                label="Why is it coming off?"
                hint="Recorded in the audit log with your name. The file stays in the folder until the office empties it."
                error={removeErrors.reason ?? removeErrors.vehicleId}
              >
                <TextArea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setRemoving(false)}>Keep it</Button>
                <Button type="submit" variant="danger" disabled={!reason.trim()}>
                  Take it off
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </Panel>
  );
}
