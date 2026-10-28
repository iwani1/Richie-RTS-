import { useState, type FormEvent, type ReactNode } from "react";
import { MAX_GENERATE_DAYS, type AdhocTripInput, type CompleteTripInput, type PassengerInput, type RouteInput, type TripAssignInput, type TripCorrectionInput, type TripDelayInput } from "../tms/busing";
import { delayLine, liveDelay, runningLate } from "../tms/delays";
import { stopDetailLine } from "../tms/stops";
import { capacityOf, manifestFor, type BookingRequestInput, type ManifestRider } from "../tms/bookings";
import { TripDelayForm } from "./TripDelayForm";
import { TripStopForm } from "./TripStopForm";
import { onTimeReport } from "../tms/kpis";
import type { Permission } from "../tms/permissions";
import type { CommandResult } from "../tms/service";
import { readinessReport } from "../tms/maintenance";
import { PLAN_SHORTLIST, PLANNING_LIMITS, planDay, planRun, type PlanCandidate, type RunPlan } from "../tms/planning";
import { ImportPanel } from "../ui/ImportPanel";
import { useTms, type Tone } from "../tms/useTms";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_TYPE_LABELS,
  DIRECTIONS,
  DIRECTION_LABELS,
  PASSENGER_STATUSES,
  ROUTE_STATUSES,
  TRIP_CORRECTION_FIELD_LABELS,
  TRIP_STATUS_LABELS,
  VEHICLE_STATUS_LABELS,
  type BoardingOutcome,
  type Booking,
  type BookingStatus,
  type BusRoute,
  type Passenger,
  type Trip,
  type TripStatus,
} from "../tms/types";
import { CopyButton } from "../ui/CopyButton";
import { Badge, Band, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, SearchInput, Select, Stat, TableCard, TextArea, TextInput, formatDate, formatDateTime, todayYmd } from "../ui/primitives";

type Errors = Record<string, string>;
type Tab = "routes" | "passengers" | "trips" | "bookings" | "performance";

const TABS: { id: Tab; label: string; permission: Permission }[] = [
  { id: "routes", label: "Routes", permission: "routes:read" },
  { id: "passengers", label: "Passengers", permission: "passengers:read" },
  { id: "trips", label: "Trips", permission: "trips:read" },
  { id: "bookings", label: "Bookings", permission: "bookings:read" },
  { id: "performance", label: "Performance", permission: "kpis:read" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isoDaysFromToday = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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
        description="Recurring employee transport: routes and rosters, generated trips, dispatch, boarding records, booked seats and on-time performance."
      />
      <div role="tablist" aria-label="Staff busing sections" className="rts-tabs">
        {available.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setRequested(t.id)}
            className="rts-tab"
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "routes" && <RoutesTab />}
      {tab === "passengers" && <PassengersTab />}
      {tab === "trips" && <TripsTab />}
      {tab === "bookings" && <BookingsTab />}
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
      <TableCard
        title="Route register"
        summary={`${rows.length} route${rows.length === 1 ? "" : "s"} · ${rows.filter((r) => r.status === "active").length} active · a route needs an active client and a vehicle category`}
        actions={
          allowed("routes:create") ? (
            <Button
              variant="primary"
              disabled={!canCreate}
              title={canCreate ? undefined : "Needs an active client and at least one vehicle category"}
              onClick={() => setPanel({ mode: "create" })}
            >
              New route
            </Button>
          ) : undefined
        }
      >
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        emptyState={<EmptyState title="No routes yet" body="Create a route with its stops and scheduled times, then generate trips from it." />}
        columns={[
          { key: "ref", header: "Ref", render: (r) => <span className="font-mono text-xs font-semibold text-foreground">{r.reference}</span> },
          { key: "name", header: "Route", render: (r) => <span className="font-semibold text-foreground">{r.name}</span> },
          { key: "client", header: "Client", render: (r) => clientName(r.clientId) },
          { key: "days", header: "Operates", render: (r) => <span className="text-xs">{dayList(r.weekdays)}</span> },
          {
            key: "times",
            header: "Times",
            render: (r) => {
              // RTE-01: the count of stops nobody has described. A route of bare names only works
              // for the driver who already knows it, so the gap is shown rather than assumed away.
              const bare = r.stops.filter((stop) => stopDetailLine(stop) === "").length;
              return (
                <span className="whitespace-nowrap text-xs">
                  {r.stops[0]?.scheduledTime} - {r.stops[r.stops.length - 1]?.scheduledTime} ({r.stops.length} stops)
                  {bare > 0 && (
                    <span className="block text-[11px] text-muted-foreground">
                      {bare} of {r.stops.length} without directions
                    </span>
                  )}
                </span>
              );
            },
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
      </TableCard>

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
          stops: route.stops.map((s) => ({
            id: s.id,
            name: s.name,
            scheduledTime: s.scheduledTime,
            landmark: s.landmark ?? "",
            digitalAddress: s.digitalAddress ?? "",
            latitude: s.latitude ?? "",
            longitude: s.longitude ?? "",
          })),
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
            { name: "", scheduledTime: "", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
            { name: "", scheduledTime: "", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
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
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Operating days</span>
          <div className="flex flex-wrap gap-2">
            {DAY_LABELS.map((label, d) => (
              <label key={label} className="flex items-center gap-1 rounded-sm border border-border bg-muted/50 px-2 py-1 text-xs">
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
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Stops in order</span>
            <Button disabled={locked} onClick={() =>
              set({
                stops: [...values.stops, { name: "", scheduledTime: "", landmark: "", digitalAddress: "", latitude: "", longitude: "" }],
              })
            }>Add stop</Button>
          </div>
          {errors.stops && <Notice tone="error" className="mb-2">{errors.stops}</Notice>}
          <ol className="space-y-2">
            {values.stops.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="space-y-2 rounded-sm border border-border bg-muted/50 p-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
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
                </div>
                {/* RTE-01: how to find it. Never disabled by `locked` — a wrong landmark is a typo
                    to correct, not a change to the route's identity, and a driver should not be left
                    following it for the life of the route. */}
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_110px]">
                  <Field label={`Stop ${i + 1} landmark`} hint="What the driver looks for: the fuel station, the blue wall." error={errors[`stops.${i}.landmark`]}>
                    <TextInput value={s.landmark ?? ""} onChange={(e) => setStop(i, { landmark: e.target.value })} invalid={!!errors[`stops.${i}.landmark`]} />
                  </Field>
                  <Field label={`Stop ${i + 1} Ghana Post GPS`} hint="Such as GA-123-4567." error={errors[`stops.${i}.digitalAddress`]}>
                    <TextInput value={s.digitalAddress ?? ""} onChange={(e) => setStop(i, { digitalAddress: e.target.value })} invalid={!!errors[`stops.${i}.digitalAddress`]} />
                  </Field>
                  <Field label={`Stop ${i + 1} latitude`} error={errors[`stops.${i}.latitude`]}>
                    <TextInput value={s.latitude ?? ""} onChange={(e) => setStop(i, { latitude: e.target.value })} invalid={!!errors[`stops.${i}.latitude`]} inputMode="decimal" />
                  </Field>
                  <Field label={`Stop ${i + 1} longitude`} error={errors[`stops.${i}.longitude`]}>
                    <TextInput value={s.longitude ?? ""} onChange={(e) => setStop(i, { longitude: e.target.value })} invalid={!!errors[`stops.${i}.longitude`]} inputMode="decimal" />
                  </Field>
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
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; passenger: Passenger } | { mode: "import" } | null>(null);
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
      <TableCard
        title="Passenger roster"
        summary={`${rows.length} of ${db.passengers.length} shown · ${db.passengers.filter((p) => !p.routeId).length} not yet on a route · personal data, capture only what the route needs`}
        actions={
          allowed("passengers:create") ? (
            <div className="flex flex-wrap gap-2">
              {/* EMP-02: a new client's roster arrives as a spreadsheet, not as sixty typed rows. */}
              <Button onClick={() => setPanel({ mode: "import" })}>Import CSV</Button>
              <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add passenger</Button>
            </div>
          ) : undefined
        }
        toolbar={
          <>
            <SearchInput placeholder="Search name, employee ref, client" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search passengers" />
            <Select className="max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filter by status">
              <option value="all">All</option>
              {PASSENGER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </>
        }
      >
      <DataTable
        rows={rows}
        rowKey={(p) => p.id}
        emptyState={<EmptyState title={db.passengers.length ? "No passengers match" : "No passengers yet"} body="Add employees to a client's roster and assign each one a route and pickup stop." />}
        columns={[
          { key: "name", header: "Name", render: (p) => <span className="font-semibold text-foreground">{p.fullName}</span> },
          { key: "ref", header: "Employee ref", render: (p) => p.employeeRef || <span className="text-dim">-</span> },
          { key: "client", header: "Client", render: (p) => clientName(p.clientId) },
          { key: "route", header: "Route", render: (p) => (routeOf(p) ? `${routeOf(p)!.reference} ${routeOf(p)!.name}` : <span className="text-dim">Not on a route</span>) },
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
      </TableCard>

      {panel?.mode === "import" && <ImportPanel kind="passengers" onClose={() => setPanel(null)} />}
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
  const [panel, setPanel] = useState<{ mode: "assign" | "complete" | "stop" | "cancel" | "correct" | "delay"; trip: Trip } | null>(null);
  const [creating, setCreating] = useState(false);

  const trips = db.trips.filter((t) => t.serviceDate === date).sort((a, b) => a.reference.localeCompare(b.reference));
  const routeOf = (routeId: string) => db.routes.find((r) => r.id === routeId);
  const vehicleReg = (id: string | null) => db.vehicles.find((v) => v.id === id)?.registration ?? "-";
  const driverName = (id: string | null) => db.drivers.find((d) => d.id === id)?.fullName ?? "-";
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
    // DSP-04, D-105: a run that is out and behind can say so, with a reason, while the client is
    // still on the phone. Offered wherever a delay can exist, not only once somebody complains.
    if ((t.status === "dispatched" || t.status === "in_progress") && allowed("trips:record"))
      out.push(
        <Button key="delay" variant="ghost" onClick={() => setPanel({ mode: "delay", trip: t })}>
          {liveDelay(t) ? "Update delay" : "Report delay"}
        </Button>,
      );
    // A run that has started can still be stopped (Q-47): a breakdown or an ill driver must have a
    // recorded way out, or the dispatcher is left with a run that can never be closed.
    if ((t.status === "planned" || t.status === "dispatched" || t.status === "in_progress") && allowed("trips:cancel"))
      out.push(
        <Button key="cancel" variant="danger" onClick={() => setPanel({ mode: "cancel", trip: t })}>
          {t.status === "in_progress" ? "Stop run" : "Cancel"}
        </Button>,
      );
    // A correction is for something already recorded, so it appears once there is a record to fix —
    // on a running or finished run, never on one that has not started (D-74).
    if ((t.status === "in_progress" || t.status === "completed") && t.stopLogs.length > 0 && allowed("trips:correct"))
      out.push(<Button key="correct" variant="ghost" onClick={() => setPanel({ mode: "correct", trip: t })}>Correct a record</Button>);
    return <div className="flex justify-end gap-1">{out}</div>;
  };

  const panelRoute = panel ? routeOf(panel.trip.routeId) : undefined;
  // D-85: the people a run is expected to carry are the roster *and* the seats sold for it.
  const manifest: ManifestRider[] = panel ? manifestFor(db, panel.trip) : [];

  // The day at a glance, derived from the runs actually on the sheet — no stored counters.
  const byStatus = (status: TripStatus) => trips.filter((t) => t.status === status).length;
  const unassigned = trips.filter((t) => !t.vehicleId || !t.driverId);
  // RTE-04: the day's still-to-crew runs, each with its ranked pairs. Read for the desk only — the
  // aid is a list of suggestions, not a queue of jobs it has done.
  const plans = new Map(planDay(db, date, todayYmd()).map((plan) => [plan.tripId, plan]));
  const assignFromPlan = (tripId: string, candidate: PlanCandidate) =>
    void report(dispatch({ type: "assign_trip", id: tripId, input: { vehicleId: candidate.vehicleId, driverId: candidate.driverId } }));
  const nextToLeave = trips.find((t) => t.status === "planned" || t.status === "dispatched");
  const startOf = (t: Trip) => routeOf(t.routeId)?.stops[0]?.scheduledTime ?? "";

  return (
    <div>
      <div className="rts-toolbar">
        <Field label="Service date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button onClick={() => setDate(todayYmd())}>Today</Button>
        {allowed("trips:dispatch") && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add an ad hoc run
          </Button>
        )}
        <p className="rts-toolbar-note">
          {trips.length} run{trips.length === 1 ? "" : "s"} on {formatDate(date)}
          {trips.length > 0 && ` · first at ${startOf(trips[0]) || "—"}`}
        </p>
      </div>

      <div className="rts-spread">
        <section className="rts-card" aria-labelledby="run-sheet-heading">
          <div className="rts-card-head">
            <div className="rts-head-text">
              <h3 id="run-sheet-heading" className="rts-card-title">Run sheet</h3>
              <p className="rts-card-desc">In departure order. The next action on each run sits beside it.</p>
            </div>
            <span className="rts-stamp">{trips.length} run{trips.length === 1 ? "" : "s"} · {formatDate(date)}</span>
          </div>

          {trips.length === 0 ? (
            <div className="rts-card-body">
              <EmptyState
                title="No trips on this date"
                body="Generate trips from a route on the Routes tab. Nothing is scheduled automatically. If a bus is needed outside the schedule, add an ad hoc run."
              />
            </div>
          ) : (
            <div className="rts-runs">
              {trips.map((t) => {
                const route = routeOf(t.routeId);
                return (
                  <article className="rts-run" key={t.id}>
                    <div className="rts-run-time">
                      <b>{startOf(t) || "—"}</b>
                      <span>{route ? route.stops[route.stops.length - 1]?.scheduledTime : ""}</span>
                    </div>
                    <div>
                      <p className="rts-run-route">
                        {route?.name ?? "Unknown route"} <span className="rts-run-ref">{t.reference}</span>
                      </p>
                      <p className="rts-run-meta">
                        {route?.reference ?? "—"} · {route ? `${t.stopLogs.length}/${route.stops.length} stops recorded` : "route missing"}
                        {t.corrections.length > 0 && (
                          <span className="rts-run-ref"> · {t.corrections.length} correction{t.corrections.length === 1 ? "" : "s"}</span>
                        )}
                        {t.rosterChanges.length > 0 && (
                          <span className="rts-run-ref"> · roster changed {t.rosterChanges.length}×</span>
                        )}
                        {/* DSP-03: an out-of-schedule run says so, and says why, on the sheet itself. */}
                        {t.origin === "adhoc" && (
                          <>
                            <span className="rts-run-ref rts-run-ref--adhoc">{" "}ad hoc</span>
                            {t.originReason && <span className="rts-run-why"> · {t.originReason}</span>}
                          </>
                        )}
                      </p>
                      <p className="rts-run-crew">
                        <span>{t.vehicleId ? vehicleReg(t.vehicleId) : <em className="rts-unset">no vehicle</em>}</span>
                        <span>{t.driverId ? driverName(t.driverId) : <em className="rts-unset">no driver</em>}</span>
                      </p>
                      {/* D-105: the sentence, not a badge. A dispatcher reads it out to the client. */}
                      {liveDelay(t) && <p className="rts-run-late">{delayLine(liveDelay(t)!)}</p>}
                    </div>
                    <div className="rts-run-state">
                      <span className={`rts-flag rts-flag--${t.status}`}>{TRIP_STATUS_LABELS[t.status]}</span>
                      <div className="rts-run-actions">{actions(t)}</div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="rts-desk" aria-label="Dispatch desk">
          <p className="rts-kicker">Dispatch desk</p>
          <p className="rts-desk-figure">
            {nextToLeave ? startOf(nextToLeave) || "—" : "—"}
            <span>{nextToLeave ? "next to leave" : "nothing left to run"}</span>
          </p>

          <div className="rts-statusline" style={{ marginTop: 14 }}>
            <span className="rts-statusline-cell">
              <b>{byStatus("planned")}</b>
              <span>planned</span>
            </span>
            <span className="rts-statusline-cell">
              <b>{byStatus("dispatched")}</b>
              <span>on the road</span>
            </span>
            <span className="rts-statusline-cell">
              <b>{byStatus("in_progress")}</b>
              <span>running</span>
            </span>
            <span className="rts-statusline-cell">
              <b>{byStatus("completed")}</b>
              <span>finished</span>
            </span>
          </div>

          {/* D-105: the desk's own count, because "how many are running late" is the question a
              supervisor asks at 07:30, not something to answer by reading every row. */}
          {runningLate(trips).length > 0 && (
            <p className="rts-desk-late">
              {runningLate(trips).length} run{runningLate(trips).length === 1 ? "" : "s"} behind schedule
              <span>{runningLate(trips).map((t) => t.reference).join(" · ")}</span>
            </p>
          )}

          <p className="rts-desk-head">Waiting on a crew</p>
          {unassigned.length === 0 ? (
            <p className="rts-band-empty">Every run on this date has a vehicle and a driver.</p>
          ) : (
            <ul className="rts-desk-list">
              {unassigned.map((t) => {
                const plan = plans.get(t.id);
                const suggestion = plan?.workable[0];
                return (
                  <li key={t.id}>
                    {/* Times and the missing part only: the run sheet already carries the reference,
                        and repeating it here would make an operator read the same line twice. */}
                    <span>{startOf(t) || "No time"}</span>
                    <span className="rts-desk-wait">
                      {t.vehicleId ? "no driver" : t.driverId ? "no vehicle" : "no vehicle, no driver"}
                      {/* The aid's own sentence, so the desk says who to send rather than only what
                          is missing. Nothing is assigned without the operator's press. */}
                      {/* Offered only to the role that can act on it: a suggestion a reader cannot
                          take is a line of text pretending to be an action. */}
                      {!allowed("trips:assign") ? null : suggestion ? (
                        <span className="rts-desk-suggest">
                          Send {suggestion.vehicleLabel} + {suggestion.driverLabel}
                          <Button
                            variant="ghost"
                            onClick={() => assignFromPlan(t.id, suggestion)}
                            aria-label={`Assign ${suggestion.vehicleLabel} and ${suggestion.driverLabel} to ${t.reference}`}
                          >
                            Assign
                          </Button>
                        </span>
                      ) : (
                        plan && <span className="rts-desk-suggest rts-desk-suggest--none">Nobody free to send</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="rts-desk-note">
            A run can only be dispatched once a vehicle and a driver are assigned. Both lists come from
            the registers — nothing is assumed by the system. A suggestion is the pairing the rules
            would accept, best first; the choice stays with you.
          </p>
        </aside>
      </div>

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
          manifest={manifest}
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
          manifest={manifest}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "record_trip_stop", id: panel.trip.id, input });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel && panelRoute && panel.mode === "correct" && (
        <CorrectForm
          trip={panel.trip}
          route={panelRoute}
          riders={manifest.map((entry) => entry.passenger)}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "correct_trip_record", id: panel.trip.id, input });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {creating && (
        <AdhocForm
          defaultDate={date}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "create_adhoc_trip", input });
            report(result);
            if (result.ok) {
              setCreating(false);
              // Show the day the run was made for, so the dispatcher sees the thing they just created.
              setDate(input.serviceDate);
            }
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel && panel.mode === "delay" && (
        <TripDelayForm
          trip={panel.trip}
          onClose={() => setPanel(null)}
          onSubmit={async (input: TripDelayInput) => {
            const result = await dispatch({ type: "record_trip_delay", id: panel.trip.id, input });
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
          onSubmit={async (reason, incidentId) => {
            const result = await dispatch({ type: "cancel_trip", id: panel.trip.id, reason, incidentId });
            report(result);
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

/**
 * An ad hoc run (DSP-03). Three things have to be true and the form asks for all three plainly: which
 * route, which day, and why. The vehicle and driver are optional because a run is often created while
 * the only free bus is still out; it can be assigned once it comes back.
 */
function AdhocForm({
  defaultDate,
  onClose,
  onSubmit,
}: {
  defaultDate: string;
  onClose: () => void;
  onSubmit: (input: AdhocTripInput) => Errors | Promise<Errors>;
}) {
  const { db } = useTms();
  const routes = db.routes.filter((r) => r.status === "active");
  const [values, setValues] = useState<AdhocTripInput>({ routeId: routes[0]?.id ?? "", serviceDate: defaultDate, reason: "", vehicleId: "", driverId: "" });
  const [errors, setErrors] = useState<Errors>({});
  const route = db.routes.find((r) => r.id === values.routeId);
  const vehicles = db.vehicles.filter((v) => v.status !== "retired" && (!route || v.categoryId === route.vehicleCategoryId));
  const drivers = db.drivers.filter((d) => d.status === "active");

  return (
    <Panel
      title="Add a run outside the schedule"
      description="For a day the route does not operate, or to replace a run that could not go out. It carries its own reference and appears on the run sheet like any other run."
      onClose={onClose}
    >
      <form onSubmit={async (e) => { e.preventDefault(); setErrors(await onSubmit(values)); }} className="space-y-4">
        {routes.length === 0 ? (
          <Notice tone="warning">No active routes exist. Create a route first: a run always serves a route's roster.</Notice>
        ) : (
          <>
            <Field label="Route" error={errors.routeId}>
              <Select value={values.routeId} onChange={(e) => setValues({ ...values, routeId: e.target.value, vehicleId: "", driverId: "" })} invalid={!!errors.routeId}>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.reference} · {r.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date" hint="Today or later. A date that has passed is recorded as it happened, not invented." error={errors.serviceDate}>
              <TextInput type="date" value={values.serviceDate} onChange={(e) => setValues({ ...values, serviceDate: e.target.value })} invalid={!!errors.serviceDate} />
            </Field>
            {route && !route.weekdays.includes(new Date(`${values.serviceDate}T00:00:00Z`).getUTCDay()) && values.serviceDate && (
              <Notice tone="info">This route does not normally operate on that day, which is exactly what an ad hoc run is for.</Notice>
            )}
            <Field label="Why is this run needed?" hint="Kept with the run and in the audit log." error={errors.reason}>
              <TextInput value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} invalid={!!errors.reason} placeholder="Replacement for TR-0004, which would not start" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vehicle (optional)" error={errors.vehicleId}>
                <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
                  <option value="">Assign later</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.registration} ({v.seatCapacity} seats, {VEHICLE_STATUS_LABELS[v.status]})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Driver (optional)" error={errors.driverId}>
                <Select value={values.driverId} onChange={(e) => setValues({ ...values, driverId: e.target.value })} invalid={!!errors.driverId}>
                  <option value="">Assign later</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.fullName}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Notice tone="info">The same checks apply as for any run: papers, category, seats, licence and double-booking. Only one ad hoc run can exist per route per day.</Notice>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={routes.length === 0}>Create run</Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * The planning aid's face (RTE-04, D-96).
 *
 * It answers "who can take this run?" with the pairs the save would accept, best first, and says what
 * makes each one workable. Nothing here assigns anything: a suggestion fills the two fields below and
 * the dispatcher's own button saves it, so the aid can never put a bus on the road behind a person's
 * back. A pair it would not accept is stated as a reason, not hidden — "there is no bus" and "there is
 * a bus but it is under maintenance" are different problems.
 */
function PlanSuggestions({ plan, onPick }: { plan: RunPlan; onPick: (candidate: PlanCandidate) => void }) {
  const shortlist = plan.workable.slice(0, PLAN_SHORTLIST);
  return (
    <section className="rts-plan" aria-label="Planning aid">
      <p className="rts-plan-head">
        Who can take this run <span className="rts-plan-window">{plan.window}</span>
      </p>
      <p className="rts-plan-line">{plan.headline}</p>
      <p className="rts-plan-meta">
        {plan.needs.riders} to carry ({plan.needs.roster} on the roster
        {plan.needs.booked > 0 ? `, ${plan.needs.booked} booked seat${plan.needs.booked === 1 ? "" : "s"}` : ""}) ·{" "}
        {plan.workable.length} of {plan.examined} vehicle-and-driver pairs can take it
      </p>

      {shortlist.length > 0 && (
        <ul className="rts-plan-list">
          {shortlist.map((candidate) => (
            <li key={`${candidate.vehicleId}:${candidate.driverId}`}>
              <div className="min-w-0">
                <p className="rts-plan-pick">
                  {candidate.vehicleLabel} with {candidate.driverLabel}
                </p>
                {candidate.reasons.map((reason) => (
                  <p key={reason} className="rts-plan-reason">{reason}</p>
                ))}
                {candidate.notes.map((note) => (
                  <p key={note} className="rts-plan-note">Worth reading: {note}</p>
                ))}
              </div>
              <Button variant="ghost" onClick={() => onPick(candidate)} aria-label={`Use ${candidate.vehicleLabel} with ${candidate.driverLabel}`}>
                Use this pair
              </Button>
            </li>
          ))}
        </ul>
      )}

      {plan.workable.length === 0 && plan.refusals.length > 0 && (
        <ul className="rts-plan-list">
          {plan.refusals.map((refusal) => (
            <li key={`${refusal.vehicleId}:${refusal.driverId}`}>
              <div className="min-w-0">
                <p className="rts-plan-pick">
                  {refusal.vehicleLabel} with {refusal.driverLabel} <span className="rts-plan-no">cannot</span>
                </p>
                {refusal.reasons.map((reason) => (
                  <p key={reason} className="rts-plan-reason">{reason}</p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="rts-plan-limits">
        <summary>What this aid cannot see</summary>
        <ul>
          {PLANNING_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function AssignForm({ trip, route, onClose, onSubmit }: { trip: Trip; route: BusRoute; onClose: () => void; onSubmit: (input: TripAssignInput) => Errors | Promise<Errors> }) {
  const { db } = useTms();
  const [values, setValues] = useState<TripAssignInput>({ vehicleId: trip.vehicleId ?? "", driverId: trip.driverId ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  // RTE-04 (D-96): the aid is a reading of the records, offered here because this panel is where the
  // two decisions are made. It fills the fields and never saves — the panel's own button still does.
  const plan = planRun(db, trip.id, todayYmd());
  const vehicles = db.vehicles.filter((v) => v.categoryId === route.vehicleCategoryId && v.status !== "retired");
  const drivers = db.drivers.filter((d) => d.status === "active");
  // Q-43: the overdue service is named in the list itself, so the dispatcher sees it before choosing.
  const overdue = new Set(readinessReport(db, todayYmd()).vehicles.filter((v) => v.status === "overdue").map((v) => v.vehicleId));

  return (
    <Panel title={`Assign ${trip.reference}`} description={`${route.name} on ${formatDate(trip.serviceDate)}. The system blocks overlapping runs and rental clashes.`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors(await onSubmit(values)); }} className="space-y-4">
        {plan && <PlanSuggestions plan={plan} onPick={(candidate) => setValues({ vehicleId: candidate.vehicleId, driverId: candidate.driverId })} />}
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration} ({v.seatCapacity} seats, {VEHICLE_STATUS_LABELS[v.status]}){overdue.has(v.id) ? " - service overdue" : ""}
              </option>
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
  manifest,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  route: BusRoute;
  manifest: ManifestRider[];
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
        boardings: manifest.map((entry) => ({ passengerId: entry.passenger.id, outcome: outcomes[entry.passenger.id] ?? "boarded" })),
      })) ?? {},
    );
  };

  return (
    <Panel
      title={`Record completion: ${trip.reference}`}
      description="Enter the actual time at every stop and an outcome for everyone this run is expected to carry — the roster and any booked seats."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actual stop times</h3>
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
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Riders ({manifest.length})</h3>
          {manifest.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nobody is expected on this run. It can be completed with stop times only.</p>
          ) : (
            <ul className="space-y-2">
              {manifest.map((entry) => {
                const stop = route.stops.find((s) => s.id === entry.pickupStopId);
                const hint =
                  entry.source === "booking"
                    ? `Booked seat ${entry.bookingReference ?? ""}${stop ? ` · pickup ${stop.name}` : ""}`
                    : stop
                      ? `Pickup: ${stop.name}`
                      : undefined;
                return (
                  <li key={entry.passenger.id}>
                    <Field label={`Outcome for ${entry.passenger.fullName}`} hint={hint}>
                      <Select
                        value={outcomes[entry.passenger.id] ?? "boarded"}
                        onChange={(e) => setOutcomes({ ...outcomes, [entry.passenger.id]: e.target.value as BoardingOutcome })}
                      >
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

/**
 * Cancel a run, or stop one that has already started (Q-47).
 *
 * When the run is on the road the screen offers the incidents recorded against it or its vehicle:
 * the command will not accept a mid-run cancellation while an unresolved breakdown sits on the same
 * vehicle unacknowledged, because two records describing the same morning differently is how an
 * operator loses the thread (D-75).
 */
function CancelForm({
  trip,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  onClose: () => void;
  onSubmit: (reason: string, incidentId?: string) => Errors | Promise<Errors>;
}) {
  const { db } = useTms();
  const [reason, setReason] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const running = trip.status === "in_progress";
  const causes = db.incidents.filter(
    (incident) =>
      incident.status !== "resolved" &&
      incident.status !== "closed" &&
      (incident.tripId === trip.id || (!!trip.vehicleId && incident.vehicleId === trip.vehicleId)),
  );

  return (
    <Panel
      title={running ? `Stop ${trip.reference}` : `Cancel ${trip.reference}`}
      description={
        running
          ? `${trip.stopLogs.length} stop(s) already recorded stay on the run, and each rider's outcome is kept.`
          : undefined
      }
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors((await onSubmit(reason, incidentId || undefined)) ?? {});
        }}
        className="space-y-4"
      >
        <Field label="Reason" hint="Recorded in the audit log with your name." error={errors.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} autoFocus />
        </Field>
        {running && causes.length > 0 && (
          <Field
            label="Incident that stopped the run"
            hint="An unresolved incident is recorded against this run or its vehicle. Link it so the two records agree."
            error={errors.incidentId}
          >
            <Select value={incidentId} onChange={(e) => setIncidentId(e.target.value)} invalid={!!errors.incidentId}>
              <option value="">Select the incident</option>
              {causes.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.reference} — {incident.type}, {incident.status}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="danger">{running ? "Stop this run" : "Cancel this trip"}</Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Correct something already recorded on a run (D-74).
 *
 * The panel offers only the stops that have a recorded time, and only the riders with an outcome
 * already recorded, because a correction is not a way to add a record that was missed — that is what
 * the run itself is for. The reason field is required and lands in the audit log.
 */
function CorrectForm({
  trip,
  route,
  riders,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  route: BusRoute;
  /** Only used to put a name against a recorded outcome, which may belong to a booked rider (D-85). */
  riders: Passenger[];
  onClose: () => void;
  onSubmit: (input: TripCorrectionInput) => Errors | Promise<Errors>;
}) {
  const [field, setField] = useState<"stop_time" | "boarding_outcome">("stop_time");
  const [stopId, setStopId] = useState(trip.stopLogs[0]?.stopId ?? "");
  const [passengerId, setPassengerId] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const recordedStops = trip.stopLogs
    .map((log) => ({ log, stop: route.stops.find((candidate) => candidate.id === log.stopId) }))
    .filter((entry) => entry.stop);
  const stopBoardings = trip.boardings.filter((record) => record.stopId === stopId);
  const nameOf = (id: string) => riders.find((p) => p.id === id)?.fullName ?? "Former rider";
  const currentTime = trip.stopLogs.find((log) => log.stopId === stopId)?.actualTime ?? "";
  const currentOutcome = trip.boardings.find((record) => record.passengerId === passengerId && record.stopId === stopId)?.outcome ?? "";

  return (
    <Panel
      title={`Correct a record on ${trip.reference}`}
      description="Nothing is overwritten silently: the change, the reason and your name are kept, and the run shows how many corrections it has."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors(
            (await onSubmit({
              field,
              stopId,
              passengerId: field === "boarding_outcome" ? passengerId : undefined,
              newValue,
              reason,
            })) ?? {},
          );
        }}
        className="space-y-4"
      >
        <Field label="What is wrong?" error={errors.field}>
          <Select
            value={field}
            onChange={(e) => {
              setField(e.target.value as "stop_time" | "boarding_outcome");
              setNewValue("");
              setPassengerId("");
            }}
          >
            <option value="stop_time">{TRIP_CORRECTION_FIELD_LABELS.stop_time}</option>
            <option value="boarding_outcome">{TRIP_CORRECTION_FIELD_LABELS.boarding_outcome}</option>
          </Select>
        </Field>

        <Field label="Stop" error={errors.stopId}>
          <Select value={stopId} onChange={(e) => { setStopId(e.target.value); setPassengerId(""); setNewValue(""); }} invalid={!!errors.stopId}>
            {recordedStops.map(({ stop }) => (
              <option key={stop!.id} value={stop!.id}>{stop!.name}</option>
            ))}
          </Select>
        </Field>

        {field === "stop_time" ? (
          <Field label="Corrected arrival time" hint={currentTime ? `Recorded as ${currentTime}.` : undefined} error={errors.newValue}>
            <TextInput type="time" value={newValue} onChange={(e) => setNewValue(e.target.value)} invalid={!!errors.newValue} autoFocus />
          </Field>
        ) : (
          <>
            <Field label="Rider" error={errors.passengerId}>
              <Select value={passengerId} onChange={(e) => { setPassengerId(e.target.value); setNewValue(""); }} invalid={!!errors.passengerId}>
                <option value="">Select the rider</option>
                {stopBoardings.map((record) => (
                  <option key={record.passengerId} value={record.passengerId}>
                    {nameOf(record.passengerId)} ({record.outcome === "boarded" ? "boarded" : "did not board"})
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Corrected outcome"
              hint={currentOutcome ? `Recorded as ${currentOutcome === "boarded" ? "boarded" : "did not board"}.` : "Choose the rider first."}
              error={errors.newValue}
            >
              <Select value={newValue} onChange={(e) => setNewValue(e.target.value)} invalid={!!errors.newValue}>
                <option value="">Select an outcome</option>
                <option value="boarded">Boarded</option>
                <option value="no_show">Did not board</option>
              </Select>
            </Field>
          </>
        )}

        <Field label="Why is it being corrected?" hint="Required. Kept in the audit log with your name." error={errors.reason}>
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>

        {trip.corrections.length > 0 && (
          <div className="rounded-sm border border-border p-3">
            <p className="rts-kicker">Already corrected on this run</p>
            <ul className="mt-2 space-y-1 text-xs">
              {trip.corrections.map((correction) => (
                <li key={correction.id}>
                  <b>{TRIP_CORRECTION_FIELD_LABELS[correction.field]}</b> at{" "}
                  {route.stops.find((candidate) => candidate.id === correction.stopId)?.name ?? "a stop"}:{" "}
                  {correction.previousValue ?? "nothing"} → {correction.newValue} · {correction.correctedBy} · {correction.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary">Record correction</Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------- Performance ----------------

// ---------------- Bookings (BKG-01..06, D-83) ----------------
//
// A booking is one named rider's seat on one named run — a visitor, a new hire, somebody from
// another site. It is deliberately not a second roster: the roster is how a client's own staff
// travel every day. The seat line counts both together, because that is what the vehicle carries.
// Nothing here is confirmed by the system: a freed seat is offered to the oldest waiter, and a
// person still has to confirm it.

const BOOKING_TONE: Record<BookingStatus, Tone | "neutral"> = {
  requested: "info",
  confirmed: "success",
  waitlisted: "neutral",
  offered: "warning",
  rejected: "error",
  cancelled: "neutral",
};

/** Confirmed seats first, then offers, requests, the waiting list, and what is finished. */
const BOOKING_ORDER: Record<BookingStatus, number> = {
  confirmed: 0,
  offered: 1,
  requested: 2,
  waitlisted: 3,
  rejected: 4,
  cancelled: 5,
};

type BookingPanel =
  | { mode: "create" }
  | { mode: "reject"; booking: Booking }
  | { mode: "cancel"; booking: Booking }
  | null;

function BookingsTab() {
  const { db, allowed, currentUser, dispatch, setFlash } = useTms();
  const [date, setDate] = useState(todayYmd());
  const [panel, setPanel] = useState<BookingPanel>(null);

  const trips = db.trips.filter((trip) => trip.serviceDate === date).sort((a, b) => a.reference.localeCompare(b.reference));
  const routeOf = (routeId: string) => db.routes.find((route) => route.id === routeId);
  const riderOf = (passengerId: string) => db.passengers.find((passenger) => passenger.id === passengerId);
  const riderName = (passengerId: string) => riderOf(passengerId)?.fullName ?? "Unknown rider";
  const startOf = (trip: Trip) => routeOf(trip.routeId)?.stops[0]?.scheduledTime ?? "";

  const report = async (pending: Promise<CommandResult>) => {
    const result = await pending;
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    return result;
  };

  const bookingsFor = (tripId: string) =>
    db.bookings
      .filter((booking) => booking.tripId === tripId)
      .sort((a, b) => (BOOKING_ORDER[a.status] === BOOKING_ORDER[b.status] ? a.reference.localeCompare(b.reference) : BOOKING_ORDER[a.status] - BOOKING_ORDER[b.status]));

  const canDecide = allowed("bookings:manage");
  // A client's own contact may cancel its own company's seats; the office may cancel anything.
  const canCancel = canDecide || (currentUser?.role === "client_contact" && allowed("bookings:create"));
  const tripIds = new Set(trips.map((trip) => trip.id));
  const live = db.bookings.filter((booking) => tripIds.has(booking.tripId) && booking.status !== "cancelled" && booking.status !== "rejected").length;

  const actions = (booking: Booking) => {
    const out: ReactNode[] = [];
    if (canDecide && (booking.status === "requested" || booking.status === "offered"))
      out.push(
        <Button key="confirm" variant="primary" onClick={() => void report(dispatch({ type: "confirm_booking", id: booking.id }))}>
          Confirm
        </Button>,
      );
    if (canDecide && ["requested", "offered", "waitlisted"].includes(booking.status))
      out.push(
        <Button key="reject" variant="ghost" onClick={() => setPanel({ mode: "reject", booking })}>
          Refuse
        </Button>,
      );
    if (canCancel && ["requested", "confirmed", "waitlisted", "offered"].includes(booking.status))
      out.push(
        <Button key="cancel" variant="danger" onClick={() => setPanel({ mode: "cancel", booking })}>
          Cancel
        </Button>,
      );
    return <div className="flex justify-end gap-1">{out}</div>;
  };

  return (
    <div>
      <div className="rts-toolbar">
        <Field label="Service date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Button onClick={() => setDate(todayYmd())}>Today</Button>
        {allowed("bookings:create") && (
          <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>
            Request a seat
          </Button>
        )}
        <p className="rts-toolbar-note">
          {trips.length} run{trips.length === 1 ? "" : "s"} on {formatDate(date)} · {live} live booking{live === 1 ? "" : "s"} · seats count the roster and the bookings together
        </p>
      </div>

      {trips.length === 0 ? (
        <EmptyState
          title="No runs on this date"
          body="A seat is booked onto a run, so there has to be a run first. Generate trips from a route, or pick another date."
        />
      ) : (
        <div className="space-y-4">
          {trips.map((trip) => {
            const route = routeOf(trip.routeId);
            const capacity = capacityOf(db, trip);
            const rows = bookingsFor(trip.id);
            const seats = capacity.vehicle ? `${capacity.booked} of ${capacity.seats} seats held` : "seats unknown until a vehicle is assigned";
            return (
              <TableCard
                key={trip.id}
                title={`${route?.name ?? "Route missing"} · ${trip.reference}`}
                summary={`${startOf(trip) || "—"} · ${capacity.vehicle ?? "no vehicle yet"} · ${seats} · ${capacity.roster} on the roster · ${capacity.free} free`}
                actions={<CopyButton value={trip.reference} what="trip reference" />}
              >
                <DataTable
                  rows={rows}
                  rowKey={(booking) => booking.id}
                  emptyState={
                    <EmptyState
                      title="No bookings on this run"
                      body="Only visitors and newcomers need a seat booked. The client's roster already travels."
                    />
                  }
                  columns={[
                    {
                      key: "rider",
                      header: "Rider",
                      render: (booking) => (
                        <div>
                          <p className="font-medium text-foreground">{riderName(booking.passengerId)}</p>
                          <p className="text-xs text-muted-foreground">{riderOf(booking.passengerId)?.employeeRef || "no staff number"}</p>
                        </div>
                      ),
                    },
                    { key: "ref", header: "Booking", render: (booking) => <span className="font-mono text-xs font-semibold text-foreground">{booking.reference}</span> },
                    { key: "kind", header: "Kind", render: (booking) => <span className="text-xs text-muted-foreground">{BOOKING_TYPE_LABELS[booking.type]}</span> },
                    { key: "status", header: "Status", render: (booking) => <Badge tone={BOOKING_TONE[booking.status]}>{BOOKING_STATUS_LABELS[booking.status]}</Badge> },
                    {
                      key: "last",
                      header: "Last change",
                      render: (booking) => {
                        const last = booking.history[booking.history.length - 1];
                        return (
                          <div className="text-xs">
                            <p className="text-foreground">{last ? last.action : "Recorded"}</p>
                            <p className="text-muted-foreground">{last ? `${last.by} · ${formatDateTime(last.at)}` : "—"}</p>
                          </div>
                        );
                      },
                    },
                    { key: "actions", header: "Actions", render: actions, className: "text-right" },
                  ]}
                />
              </TableCard>
            );
          })}
          <p className="text-xs text-muted-foreground">
            A full run does not lose the request: confirming it puts the rider on the waiting list. When a seat is
            cancelled it is <em>offered</em> to the oldest waiter, and stays an offer until somebody confirms it.
          </p>
        </div>
      )}

      {panel?.mode === "create" && (
        <BookingForm
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await report(dispatch({ type: "create_booking", input }));
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel?.mode === "reject" && (
        <BookingReasonForm
          title={`Refuse ${panel.booking.reference}`}
          description={`${riderName(panel.booking.passengerId)} on ${formatDate(panel.booking.serviceDate)}. The reason is kept with the booking and in the audit log.`}
          submitLabel="Refuse request"
          onClose={() => setPanel(null)}
          onSubmit={async (reason) => {
            const result = await report(dispatch({ type: "reject_booking", id: panel.booking.id, reason }));
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel?.mode === "cancel" && (
        <BookingReasonForm
          title={`Cancel ${panel.booking.reference}`}
          description={`${riderName(panel.booking.passengerId)} on ${formatDate(panel.booking.serviceDate)}. A held seat is offered to the oldest person waiting; nobody is confirmed automatically.`}
          submitLabel="Cancel booking"
          onClose={() => setPanel(null)}
          onSubmit={async (reason) => {
            const result = await report(dispatch({ type: "cancel_booking", id: panel.booking.id, reason }));
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

/** One seat, one rider, one run — or the same seat on every operating day of a series. */
function BookingForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: BookingRequestInput) => Errors | Promise<Errors> }) {
  const { db, currentUser } = useTms();
  const routes = db.routes.filter((route) => route.status !== "ended");
  const riders = db.passengers.filter(
    (passenger) => passenger.status === "active" && (currentUser?.role !== "client_contact" || passenger.clientId === currentUser.clientId),
  );
  const [values, setValues] = useState<BookingRequestInput>({
    passengerId: "",
    routeId: routes[0]?.id ?? "",
    serviceDate: todayYmd(),
    toDate: todayYmd(),
    type: "one_time",
    note: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const blocked = riders.length === 0 || routes.length === 0;

  return (
    <Panel
      title="Request a seat"
      description="For somebody who is not already on the route's roster. The seat is requested first — the office confirms it once the vehicle's seats are counted."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors(await onSubmit(values));
        }}
        className="space-y-4"
      >
        {riders.length === 0 && <Notice tone="warning">No active riders exist for you to book. Add the person to Passengers first.</Notice>}
        {routes.length === 0 && <Notice tone="warning">No route is open. Create a route before booking a seat.</Notice>}
        <Field label="Rider" hint="A rider already on the route's roster needs no booking." error={errors.passengerId}>
          <Select value={values.passengerId} onChange={(e) => setValues({ ...values, passengerId: e.target.value })} invalid={!!errors.passengerId}>
            <option value="">Select a rider</option>
            {riders.map((rider) => (
              <option key={rider.id} value={rider.id}>
                {rider.fullName}
                {rider.employeeRef ? ` (${rider.employeeRef})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Route" error={errors.routeId}>
          <Select value={values.routeId} onChange={(e) => setValues({ ...values, routeId: e.target.value })} invalid={!!errors.routeId}>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.reference} · {route.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date of travel" error={errors.serviceDate}>
            <TextInput type="date" value={values.serviceDate} onChange={(e) => setValues({ ...values, serviceDate: e.target.value })} invalid={!!errors.serviceDate} />
          </Field>
          <Field label="How often" error={errors.type}>
            <Select value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value as BookingRequestInput["type"] })} invalid={!!errors.type}>
              <option value="one_time">{BOOKING_TYPE_LABELS.one_time}</option>
              <option value="recurring">{BOOKING_TYPE_LABELS.recurring}</option>
            </Select>
          </Field>
        </div>
        {values.type === "recurring" && (
          <Field
            label="Every operating day until"
            hint="One booking per run, at most 62 days. Dates with no run are reported, not invented."
            error={errors.toDate}
          >
            <TextInput type="date" value={values.toDate} onChange={(e) => setValues({ ...values, toDate: e.target.value })} invalid={!!errors.toDate} />
          </Field>
        )}
        <Field label="Why is the seat needed? (optional)" hint="Kept with the booking and in its history.">
          <TextInput value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} placeholder="Interview candidate, covering for Ama" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={blocked}>
            Request seat
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Refusing or cancelling a booking: both require a reason, and both keep it. */
function BookingReasonForm({
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Errors | Promise<Errors>;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  return (
    <Panel title={title} description={description} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors(await onSubmit(reason));
        }}
        className="space-y-4"
      >
        <Field label="Reason" hint="Required. It is written into the booking's history." error={errors.reason}>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="primary">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

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
