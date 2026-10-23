import { useState, type FormEvent, type ReactNode } from "react";
import { MAX_GENERATE_DAYS, type CompleteTripInput, type PassengerInput, type RouteInput, type TripAssignInput } from "../tms/busing";
import { TripStopForm } from "./TripStopForm";
import { onTimeReport } from "../tms/kpis";
import type { Permission } from "../tms/permissions";
import type { CommandResult } from "../tms/service";
import { useTms } from "../tms/useTms";
import {
  DIRECTIONS,
  DIRECTION_LABELS,
  PASSENGER_STATUSES,
  ROUTE_STATUSES,
  TRIP_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type BoardingOutcome,
  type BusRoute,
  type Passenger,
  type Trip,
  type TripStatus,
} from "../tms/types";
import { Badge, Band, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, Select, Stat, TextArea, TextInput, formatDate, todayYmd } from "../ui/primitives";

type Errors = Record<string, string>;
type Tab = "routes" | "passengers" | "trips" | "performance";

const TABS: { id: Tab; label: string; permission: Permission }[] = [
  { id: "routes", label: "Routes", permission: "routes:read" },
  { id: "passengers", label: "Passengers", permission: "passengers:read" },
  { id: "trips", label: "Trips", permission: "trips:read" },
  { id: "performance", label: "Performance", permission: "kpis:read" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isoDaysFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const TRIP_TONE: Record<TripStatus, "info" | "warning" | "success" | "error"> = {
  planned: "info",
  dispatched: "warning",
  in_progress: "warning",
  completed: "success",
  cancelled: "error",
};
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
const dayList = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(" ");

export function StaffBusingPage() {
  const { allowed } = useTms();
  const available = TABS.filter((t) => allowed(t.permission));
  const [requested, setRequested] = useState<Tab>("routes");

  if (available.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Service" title="Staff busing" />
        <EmptyState title="No access" body="Your role has no staff busing permissions." />
      </div>
    );
  }

  const tab = available.some((t) => t.id === requested) ? requested : available[0].id;

  return (
    <div>
      <PageHeader
        eyebrow="Service"
        title="Staff busing"
        description="Recurring employee transport: routes and rosters, generated trips, dispatch, boarding records and on-time performance."
      />
      <div role="tablist" aria-label="Staff busing sections" className="mb-5 flex flex-wrap gap-1 border-b border-stone-200">
        {available.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setRequested(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold ${tab === t.id ? "border-lime-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "routes" && <RoutesTab />}
      {tab === "passengers" && <PassengersTab />}
      {tab === "trips" && <TripsTab />}
      {tab === "performance" && <PerformanceTab />}
    </div>
  );
}

// ---------------- Routes ----------------

function RoutesTab() {
  const { db, allowed } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; route: BusRoute } | { mode: "generate"; route: BusRoute } | null>(null);

  const clientName = (id: string) => db.clients.find((c) => c.id === id)?.name ?? "Unknown";
  const categoryName = (id: string) => db.settings.vehicleCategories.find((c) => c.id === id)?.name ?? "Unknown";
  const canCreate = db.settings.vehicleCategories.length > 0 && db.clients.some((c) => c.status === "active");
  const rows = [...db.routes].sort((a, b) => a.reference.localeCompare(b.reference));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-stone-500">
          A route needs an active client and a vehicle category. Stops and times are entered by operations; none are assumed.
        </p>
        {allowed("routes:create") && (
          <Button
            variant="primary"
            disabled={!canCreate}
            title={canCreate ? undefined : "Needs an active client and at least one vehicle category"}
            onClick={() => setPanel({ mode: "create" })}
          >
            New route
          </Button>
        )}
      </div>

      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        emptyState={<EmptyState title="No routes yet" body="Create a route with its stops and scheduled times, then generate trips from it." />}
        columns={[
          { key: "ref", header: "Ref", render: (r) => <span className="font-mono text-xs font-semibold text-stone-900">{r.reference}</span> },
          { key: "name", header: "Route", render: (r) => <span className="font-semibold text-stone-900">{r.name}</span> },
          { key: "client", header: "Client", render: (r) => clientName(r.clientId) },
          { key: "days", header: "Operates", render: (r) => <span className="text-xs">{dayList(r.weekdays)}</span> },
          {
            key: "times",
            header: "Times",
            render: (r) => (
              <span className="whitespace-nowrap text-xs">
                {r.stops[0]?.scheduledTime} - {r.stops[r.stops.length - 1]?.scheduledTime} ({r.stops.length} stops)
              </span>
            ),
          },
          { key: "vehicle", header: "Vehicle", render: (r) => categoryName(r.vehicleCategoryId) },
          {
            key: "status",
            header: "Status",
            render: (r) => <Badge tone={r.status === "active" ? "success" : r.status === "suspended" ? "warning" : "neutral"}>{r.status}</Badge>,
          },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (r) => (
              <div className="flex justify-end gap-1">
                {allowed("routes:update") && <Button variant="ghost" onClick={() => setPanel({ mode: "edit", route: r })}>Edit</Button>}
                {allowed("trips:generate") && r.status === "active" && <Button variant="ghost" onClick={() => setPanel({ mode: "generate", route: r })}>Generate trips</Button>}
              </div>
            ),
          },
        ]}
      />

      {panel?.mode === "create" && <RouteForm route={null} onClose={() => setPanel(null)} />}
      {panel?.mode === "edit" && <RouteForm route={panel.route} onClose={() => setPanel(null)} />}
      {panel?.mode === "generate" && <GenerateForm route={panel.route} onClose={() => setPanel(null)} />}
    </div>
  );
}

function RouteForm({ route, onClose }: { route: BusRoute | null; onClose: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const locked = route !== null && db.trips.some((t) => t.routeId === route.id);
  const [values, setValues] = useState<RouteInput>(() =>
    route
      ? {
          name: route.name,
          clientId: route.clientId,
          direction: route.direction,
          shiftId: route.shiftId ?? "",
          vehicleCategoryId: route.vehicleCategoryId,
          weekdays: route.weekdays,
          startDate: route.startDate,
          endDate: route.endDate ?? "",
          status: route.status,
          stops: route.stops.map((s) => ({ id: s.id, name: s.name, scheduledTime: s.scheduledTime })),
        }
      : {
          name: "",
          clientId: "",
          direction: "to_work",
          shiftId: "",
          vehicleCategoryId: "",
          weekdays: [1, 2, 3, 4, 5],
          startDate: todayYmd(),
          endDate: "",
          status: "active",
          stops: [
            { name: "", scheduledTime: "" },
            { name: "", scheduledTime: "" },
          ],
        },
  );
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<RouteInput>) => setValues((v) => ({ ...v, ...patch }));
  const setStop = (i: number, patch: Partial<RouteInput["stops"][number]>) =>
    set({ stops: values.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveStop = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= values.stops.length) return;
    const stops = [...values.stops];
    [stops[i], stops[j]] = [stops[j], stops[i]];
    set({ stops });
  };

  const clientOptions = db.clients.filter((c) => c.status === "active" || c.id === values.clientId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = route
      ? await dispatch({ type: "update_route", id: route.id, input: values })
      : await dispatch({ type: "create_route", input: values });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return (
    <Panel title={route ? `Edit ${route.reference}` : "New route"} description="Scheduled times are the operator's plan; they are compared with actual times at completion." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {locked && (
          <Notice tone="warning">Trips already exist for this route, so its client, vehicle category and stops are locked. Operating days, dates and status can still change.</Notice>
        )}
        <Field label="Route name" error={errors.name}>
          <TextInput value={values.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Client" error={errors.clientId}>
          <Select value={values.clientId} onChange={(e) => set({ clientId: e.target.value })} invalid={!!errors.clientId} disabled={locked}>
            <option value="">Select a client</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Direction" error={errors.direction}>
            <Select value={values.direction} onChange={(e) => set({ direction: e.target.value as RouteInput["direction"] })} invalid={!!errors.direction}>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" error={errors.status}>
            <Select value={values.status} onChange={(e) => set({ status: e.target.value as RouteInput["status"] })} invalid={!!errors.status}>
              {ROUTE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle category" error={errors.vehicleCategoryId}>
            <Select value={values.vehicleCategoryId} onChange={(e) => set({ vehicleCategoryId: e.target.value })} invalid={!!errors.vehicleCategoryId} disabled={locked}>
              <option value="">Select a category</option>
              {db.settings.vehicleCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Shift (optional)" error={errors.shiftId}>
            <Select value={values.shiftId} onChange={(e) => set({ shiftId: e.target.value })} invalid={!!errors.shiftId}>
              <option value="">No shift linked</option>
              {db.settings.shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-stone-500">Operating days</span>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, d) => (
              <label key={label} className="flex items-center gap-1 rounded-sm border border-[color:var(--rts-line-strong)] bg-[var(--rts-paper-2)] px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={values.weekdays.includes(d)}
                  onChange={(e) => set({ weekdays: e.target.checked ? [...values.weekdays, d] : values.weekdays.filter((x) => x !== d) })}
                />
                {label}
              </label>
            ))}
          </div>
          {errors.weekdays && <span className="mt-1 block text-[11px] font-medium text-red-700">{errors.weekdays}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" error={errors.startDate}>
            <TextInput type="date" value={values.startDate} onChange={(e) => set({ startDate: e.target.value })} invalid={!!errors.startDate} />
          </Field>
          <Field label="End date (optional)" error={errors.endDate}>
            <TextInput type="date" value={values.endDate} onChange={(e) => set({ endDate: e.target.value })} invalid={!!errors.endDate} />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Stops in order</span>
            <Button disabled={locked} onClick={() => set({ stops: [...values.stops, { name: "", scheduledTime: "" }] })}>Add stop</Button>
          </div>
          {errors.stops && <Notice tone="error" className="mb-2">{errors.stops}</Notice>}
          <ol className="space-y-2">
            {values.stops.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="grid gap-2 rounded-sm border border-[color:var(--rts-line)] bg-[var(--rts-paper-2)] p-2 sm:grid-cols-[1fr_120px_auto]">
                <Field label={`Stop ${i + 1} name`} error={errors[`stops.${i}.name`]}>
                  <TextInput value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} disabled={locked} invalid={!!errors[`stops.${i}.name`]} />
                </Field>
                <Field label={`Stop ${i + 1} scheduled time`} error={errors[`stops.${i}.scheduledTime`]}>
                  <TextInput type="time" value={s.scheduledTime} onChange={(e) => setStop(i, { scheduledTime: e.target.value })} disabled={locked} invalid={!!errors[`stops.${i}.scheduledTime`]} />
                </Field>
                <div className="flex items-end gap-1">
                  <Button onClick={() => moveStop(i, -1)} disabled={locked || i === 0} aria-label={`Move stop ${i + 1} up`}>Up</Button>
                  <Button onClick={() => moveStop(i, 1)} disabled={locked || i === values.stops.length - 1} aria-label={`Move stop ${i + 1} down`}>Down</Button>
                  <Button variant="danger" disabled={locked || values.stops.length <= 2} onClick={() => set({ stops: values.stops.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save route</Button>
        </div>
      </form>
    </Panel>
  );
}

function GenerateForm({ route, onClose }: { route: BusRoute; onClose: () => void }) {
  const { dispatch, setFlash } = useTms();
  const [fromDate, setFromDate] = useState(todayYmd());
  const [toDate, setToDate] = useState(isoDaysFromToday(6));
  const [errors, setErrors] = useState<Errors>({});

  return (
    <Panel
      title={`Generate trips: ${route.reference}`}
      description={`Creates planned trips on ${dayList(route.weekdays)} within the route's dates. Existing trips are never duplicated. Up to ${MAX_GENERATE_DAYS} days at a time.`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const result = await dispatch({ type: "generate_trips", routeId: route.id, fromDate, toDate });
          setFlash({ tone: result.ok ? "success" : "error", message: result.message });
          if (result.ok) onClose();
          else setErrors(result.errors);
        }}
        className="space-y-4"
      >
        <Field label="From date" error={errors.fromDate}>
          <TextInput type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} invalid={!!errors.fromDate} />
        </Field>
        <Field label="To date" error={errors.toDate}>
          <TextInput type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} invalid={!!errors.toDate} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Generate trips</Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------- Passengers ----------------

function PassengersTab() {
  const { db, allowed } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; passenger: Passenger } | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const clientName = (id: string) => db.clients.find((c) => c.id === id)?.name ?? "Unknown";
  const routeOf = (p: Passenger) => db.routes.find((r) => r.id === p.routeId);
  const stopName = (p: Passenger) => routeOf(p)?.stops.find((s) => s.id === p.stopId)?.name ?? "-";

  const q = query.trim().toLowerCase();
  const rows = db.passengers
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .filter((p) => !q || `${p.fullName} ${p.employeeRef} ${clientName(p.clientId)}`.toLowerCase().includes(q))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <TextInput className="max-w-xs" placeholder="Search name, employee ref, client" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search passengers" />
          <Select className="max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
            <option value="all">All</option>
            {PASSENGER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        {allowed("passengers:create") && <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add passenger</Button>}
      </div>
      <Notice tone="info" className="mb-3">
        Passenger records are personal data. Capture only what is needed to run the route. See docs/DATA_PROTECTION.md.
      </Notice>

      <DataTable
        rows={rows}
        rowKey={(p) => p.id}
        emptyState={<EmptyState title={db.passengers.length ? "No passengers match" : "No passengers yet"} body="Add employees to a client's roster and assign each one a route and pickup stop." />}
        columns={[
          { key: "name", header: "Name", render: (p) => <span className="font-semibold text-stone-900">{p.fullName}</span> },
          { key: "ref", header: "Employee ref", render: (p) => p.employeeRef || <span className="text-stone-400">-</span> },
          { key: "client", header: "Client", render: (p) => clientName(p.clientId) },
          { key: "route", header: "Route", render: (p) => (routeOf(p) ? `${routeOf(p)!.reference} ${routeOf(p)!.name}` : <span className="text-stone-400">Not on a route</span>) },
          { key: "stop", header: "Pickup stop", render: (p) => stopName(p) },
          { key: "status", header: "Status", render: (p) => <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (p) => (allowed("passengers:update") ? <Button variant="ghost" onClick={() => setPanel({ mode: "edit", passenger: p })}>Edit</Button> : null),
          },
        ]}
      />

      {panel?.mode === "create" && <PassengerForm passenger={null} onClose={() => setPanel(null)} />}
      {panel?.mode === "edit" && <PassengerForm passenger={panel.passenger} onClose={() => setPanel(null)} />}

    </div>
  );
}

function PassengerForm({ passenger, onClose }: { passenger: Passenger | null; onClose: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const [values, setValues] = useState<PassengerInput>(() =>
    passenger
      ? {
          fullName: passenger.fullName,
          employeeRef: passenger.employeeRef,
          phone: passenger.phone,
          clientId: passenger.clientId,
          routeId: passenger.routeId ?? "",
          stopId: passenger.stopId ?? "",
          status: passenger.status,
        }
      : { fullName: "", employeeRef: "", phone: "", clientId: "", routeId: "", stopId: "", status: "active" },
  );
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<PassengerInput>) => setValues((v) => ({ ...v, ...patch }));

  const routeOptions = db.routes.filter((r) => r.clientId === values.clientId && (r.status !== "ended" || r.id === values.routeId));
  const selectedRoute = db.routes.find((r) => r.id === values.routeId);

  // Phase 11: mid-trip visibility. Stops already recorded on an in-progress trip of the
  // selected route are shown disabled; a passenger with a boarding outcome keeps only
  // personal-detail edits. The service layer enforces the same rules.
  const runningTrips = db.trips.filter((t) => t.routeId === values.routeId && t.status === "in_progress");
  const recordedStopIds = new Set(runningTrips.flatMap((t) => t.stopLogs.map((log) => log.stopId)));
  const boardedRefs = passenger
    ? db.trips.filter((t) => t.status === "in_progress" && t.boardings.some((b) => b.passengerId === passenger.id)).map((t) => t.reference)
    : [];
  const boardedMidRun = boardedRefs.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = passenger ? await dispatch({ type: "update_passenger", id: passenger.id, input: values }) : await dispatch({ type: "create_passenger", input: values });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return (
    <Panel title={passenger ? "Edit passenger" : "Add passenger"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {boardedMidRun && (
          <Notice tone="warning">
            This passenger already boarded on {boardedRefs.join(", ")}. Only the name, phone and employee reference can be corrected mid-run; route, stop, status and client are locked.
          </Notice>
        )}
        {!boardedMidRun && runningTrips.length > 0 && (
          <Notice tone="info">
            A run is in progress on this route ({runningTrips.map((t) => t.reference).join(", ")}). New and changed assignments must use stops the run has not reached yet; recorded stops are disabled below.
          </Notice>
        )}
        <Field label="Client" error={errors.clientId}>
          <Select value={values.clientId} onChange={(e) => set({ clientId: e.target.value, routeId: "", stopId: "" })} invalid={!!errors.clientId} disabled={boardedMidRun}>
            <option value="">Select a client</option>
            {db.clients.filter((c) => c.status === "active" || c.id === values.clientId).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Full name" error={errors.fullName}>
          <TextInput value={values.fullName} onChange={(e) => set({ fullName: e.target.value })} invalid={!!errors.fullName} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employee reference" hint="Optional. Unique per client." error={errors.employeeRef}>
            <TextInput value={values.employeeRef} onChange={(e) => set({ employeeRef: e.target.value })} invalid={!!errors.employeeRef} />
          </Field>
          <Field label="Phone (optional)">
            <TextInput value={values.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" />
          </Field>
        </div>
        <Field label="Route" hint="Leave as 'Not on a route' if the employee is not yet assigned." error={errors.routeId}>
          <Select value={values.routeId} onChange={(e) => set({ routeId: e.target.value, stopId: "" })} invalid={!!errors.routeId} disabled={!values.clientId || boardedMidRun}>
            <option value="">Not on a route</option>
            {routeOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.reference} {r.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Pickup stop" error={errors.stopId}>
          <Select value={values.stopId} onChange={(e) => set({ stopId: e.target.value })} invalid={!!errors.stopId} disabled={!selectedRoute || boardedMidRun}>
            <option value="">Select a stop</option>
            {selectedRoute?.stops.map((s) => (
              <option key={s.id} value={s.id} disabled={recordedStopIds.has(s.id) && s.id !== values.stopId}>
                {s.name} ({s.scheduledTime}){recordedStopIds.has(s.id) ? " — recorded" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={errors.status}>
          <Select value={values.status} onChange={(e) => set({ status: e.target.value as PassengerInput["status"] })} disabled={boardedMidRun}>
            {PASSENGER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save passenger</Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------- Trips ----------------

function TripsTab() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [date, setDate] = useState(todayYmd());
  const [panel, setPanel] = useState<{ mode: "assign" | "complete" | "stop" | "cancel"; trip: Trip } | null>(null);

  const trips = db.trips.filter((t) => t.serviceDate === date).sort((a, b) => a.reference.localeCompare(b.reference));
  const routeOf = (routeId: string) => db.routes.find((r) => r.id === routeId);
  const vehicleReg = (id: string | null) => db.vehicles.find((v) => v.id === id)?.registration ?? "-";
  const driverName = (id: string | null) => db.drivers.find((d) => d.id === id)?.fullName ?? "-";
  const windowOf = (t: Trip) => {
    const r = routeOf(t.routeId);
    return r ? `${r.stops[0].scheduledTime} - ${r.stops[r.stops.length - 1].scheduledTime}` : "-";
  };

  const report = async (pending: Promise<CommandResult> | CommandResult) => {
    const result = await pending;
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    return result;
  };

  const dispatchTrip = (t: Trip) => void report(dispatch({ type: "dispatch_trip", id: t.id }));

  const actions = (t: Trip) => {
    const out: ReactNode[] = [];
    if (t.status === "planned" && allowed("trips:assign"))
      out.push(<Button key="assign" variant="ghost" onClick={() => setPanel({ mode: "assign", trip: t })}>{t.vehicleId ? "Reassign" : "Assign"}</Button>);
    if (t.status === "planned" && t.vehicleId && t.driverId && allowed("trips:dispatch"))
      out.push(<Button key="dispatch" variant="primary" onClick={() => dispatchTrip(t)}>Dispatch</Button>);
    if (t.status === "dispatched" && allowed("trips:start"))
      out.push(<Button key="start" variant="primary" onClick={() => void report(dispatch({ type: "start_trip", id: t.id }))}>Start run</Button>);
    if (t.status === "dispatched" && allowed("trips:complete"))
      out.push(<Button key="full-complete" variant="ghost" onClick={() => setPanel({ mode: "complete", trip: t })}>Record full completion</Button>);
    const route = routeOf(t.routeId);
    if (t.status === "in_progress" && route?.stops[t.stopLogs.length] && allowed("trips:record"))
      out.push(<Button key="stop" variant="ghost" onClick={() => setPanel({ mode: "stop", trip: t })}>Record next stop</Button>);
    if (t.status === "in_progress" && route && t.stopLogs.length === route.stops.length && allowed("trips:complete"))
      out.push(<Button key="complete" variant="primary" onClick={() => void report(dispatch({ type: "complete_trip", id: t.id }))}>Complete run</Button>);
    if ((t.status === "planned" || t.status === "dispatched") && allowed("trips:cancel"))
      out.push(<Button key="cancel" variant="danger" onClick={() => setPanel({ mode: "cancel", trip: t })}>Cancel</Button>);
    return <div className="flex justify-end gap-1">{out}</div>;
  };

  const panelRoute = panel ? routeOf(panel.trip.routeId) : undefined;
  const roster = panel ? db.passengers.filter((p) => p.routeId === panel.trip.routeId && p.status === "active") : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Service date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button onClick={() => setDate(todayYmd())}>Today</Button>
        <p className="pb-2 text-xs text-stone-500">{trips.length} trip(s) on {formatDate(date)}.</p>
      </div>

      <DataTable
        rows={trips}
        rowKey={(t) => t.id}
        emptyState={<EmptyState title="No trips on this date" body="Generate trips from a route on the Routes tab." />}
        columns={[
          { key: "ref", header: "Trip", render: (t) => <span className="font-mono text-xs font-semibold text-stone-900">{t.reference}</span> },
          { key: "route", header: "Route", render: (t) => <span className="font-semibold text-stone-900">{routeOf(t.routeId)?.name ?? "Unknown route"}</span> },
          { key: "window", header: "Window", render: (t) => <span className="whitespace-nowrap text-xs">{windowOf(t)}</span> },
          { key: "progress", header: "Stops", render: (t) => { const route = routeOf(t.routeId); return route ? `${t.stopLogs.length}/${route.stops.length}` : "-"; } },
          { key: "vehicle", header: "Vehicle", render: (t) => vehicleReg(t.vehicleId) },
          { key: "driver", header: "Driver", render: (t) => driverName(t.driverId) },
          { key: "status", header: "Status", render: (t) => <Badge tone={TRIP_TONE[t.status]}>{TRIP_STATUS_LABELS[t.status]}</Badge> },
          { key: "actions", header: "", className: "text-right", render: actions },
        ]}
      />

      {panel && panelRoute && panel.mode === "assign" && (
        <AssignForm
          trip={panel.trip}
          route={panelRoute}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "assign_trip", id: panel.trip.id, input });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel && panelRoute && panel.mode === "complete" && (
        <CompleteForm
          trip={panel.trip}
          route={panelRoute}
          roster={roster}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "complete_trip", id: panel.trip.id, input });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel && panelRoute && panel.mode === "stop" && (
        <TripStopForm
          trip={panel.trip}
          route={panelRoute}
          roster={roster}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "record_trip_stop", id: panel.trip.id, input });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel && panel.mode === "cancel" && (
        <CancelForm
          trip={panel.trip}
          onClose={() => setPanel(null)}
          onSubmit={async (reason) => {
            const result = await dispatch({ type: "cancel_trip", id: panel.trip.id, reason });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

function AssignForm({ trip, route, onClose, onSubmit }: { trip: Trip; route: BusRoute; onClose: () => void; onSubmit: (input: TripAssignInput) => Errors | Promise<Errors> }) {
  const { db } = useTms();
  const [values, setValues] = useState<TripAssignInput>({ vehicleId: trip.vehicleId ?? "", driverId: trip.driverId ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  const vehicles = db.vehicles.filter((v) => v.categoryId === route.vehicleCategoryId && v.status !== "retired");
  const drivers = db.drivers.filter((d) => d.status === "active");

  return (
    <Panel title={`Assign ${trip.reference}`} description={`${route.name} on ${formatDate(trip.serviceDate)}. The system blocks overlapping runs and rental clashes.`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors(await onSubmit(values)); }} className="space-y-4">
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.registration} ({v.seatCapacity} seats, {VEHICLE_STATUS_LABELS[v.status]})</option>
            ))}
          </Select>
        </Field>
        <Field label="Driver" error={errors.driverId}>
          <Select value={values.driverId} onChange={(e) => setValues({ ...values, driverId: e.target.value })} invalid={!!errors.driverId}>
            <option value="">Select a driver</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.fullName}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save assignment</Button>
        </div>
      </form>
    </Panel>
  );
}

function CompleteForm({
  trip,
  route,
  roster,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  route: BusRoute;
  roster: Passenger[];
  onClose: () => void;
  onSubmit: (input: CompleteTripInput) => Errors | Promise<Errors>;
}) {
  const [times, setTimes] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, BoardingOutcome>>({});
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(
      (await onSubmit({
        stopTimes: route.stops.map((s) => ({ stopId: s.id, actualTime: times[s.id] ?? "" })),
        boardings: roster.map((p) => ({ passengerId: p.id, outcome: outcomes[p.id] ?? "boarded" })),
      })) ?? {},
    );
  };

  return (
    <Panel
      title={`Record completion: ${trip.reference}`}
      description="Enter the actual time at every stop and an outcome for every active passenger on this route."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">Actual stop times</h3>
          <div className="space-y-2">
            {route.stops.map((s, i) => (
              <Field key={s.id} label={`Actual time at ${s.name}`} hint={`Scheduled ${s.scheduledTime}`} error={errors[`stopTimes.${i}`]}>
                <TextInput
                  type="time"
                  value={times[s.id] ?? ""}
                  onChange={(e) => setTimes({ ...times, [s.id]: e.target.value })}
                  invalid={!!errors[`stopTimes.${i}`]}
                />
              </Field>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">Passengers ({roster.length})</h3>
          {roster.length === 0 ? (
            <p className="text-xs text-stone-500">No active passengers are on this route. The trip can be completed with stop times only.</p>
          ) : (
            <ul className="space-y-2">
              {roster.map((p) => {
                const stop = route.stops.find((s) => s.id === p.stopId);
                return (
                  <li key={p.id}>
                    <Field label={`Outcome for ${p.fullName}`} hint={stop ? `Pickup: ${stop.name}` : undefined}>
                      <Select value={outcomes[p.id] ?? "boarded"} onChange={(e) => setOutcomes({ ...outcomes, [p.id]: e.target.value as BoardingOutcome })}>
                        <option value="boarded">Boarded</option>
                        <option value="no_show">No-show</option>
                      </Select>
                    </Field>
                  </li>
                );
              })}
            </ul>
          )}
          {errors.boardings && <Notice tone="error" className="mt-2">{errors.boardings}</Notice>}
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save completion</Button>
        </div>
      </form>
    </Panel>
  );
}

function CancelForm({ trip, onClose, onSubmit }: { trip: Trip; onClose: () => void; onSubmit: (reason: string) => Errors | Promise<Errors> }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Panel title={`Cancel ${trip.reference}`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors((await onSubmit(reason)) ?? {}); }} className="space-y-4">
        <Field label="Reason" hint="Recorded in the audit log." error={errors.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} autoFocus />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="danger">Cancel trip</Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------- Performance ----------------

function PerformanceTab() {
  const { db } = useTms();
  const [from, setFrom] = useState(isoDaysFromToday(-30));
  const [to, setTo] = useState(todayYmd());
  const validRange = from <= to;
  const report = validRange ? onTimeReport(db, from, to) : null;

  return (
    <div className="space-y-5">
      <Band label="Reporting period" note="Dates are service dates. Cancelled trips are excluded from the denominator.">
        <div className="flex flex-wrap gap-3">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {!validRange && <Notice tone="error" className="mt-3">"From" must be on or before "To".</Notice>}
      </Band>

      {report && (
        <>
          <Band
            label="RPT-01 On-time rate"
            note="A completed trip is on time when every stop's actual time is no later than its scheduled time plus the on-time threshold. Early arrivals count as on time. Definition pending management confirmation (docs/KPIS.md)."
          >
            {report.status !== "ok" && (
              <Notice tone="warning" title="Insufficient data">{report.message}</Notice>
            )}
            {report.status === "ok" && report.message && <Notice tone="info" className="mb-3">{report.message}</Notice>}
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="On-time rate"
                value={report.status === "ok" ? pct(report.rate) : "Not computed"}
                caption={report.status === "ok" ? `${report.onTime} of ${report.timed} timed trip(s)` : "See note above"}
              />
              <Stat label="Completed trips" value={report.completed} caption={`of ${report.scheduled} scheduled (not cancelled)`} />
              <Stat label="Data coverage" value={pct(report.coverage)} caption="Completed / scheduled in period" />
              <Stat label="Reporting period" value={formatDate(from)} caption={`to ${formatDate(to)}`} />
            </div>
          </Band>

          <Band label="RPT-02 and RPT-03" note="Fleet utilisation and cost per trip.">
            <Notice tone="info" title="Not configured">
              These need fleet availability hours and recorded trip costs, which are not captured yet. No figure is shown rather than an estimate.
            </Notice>
          </Band>
        </>
      )}
    </div>
  );
}
