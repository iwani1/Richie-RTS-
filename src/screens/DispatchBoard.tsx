// The dispatch board (DSP-01, D-115).
//
// One day's runs, the problems on them, and who is still free. It reads; it changes nothing. The run
// sheet on Staff busing is where a run is crewed, released and closed, and duplicating those buttons
// here would mean two places to press the same thing and two places to get it wrong.
//
// What it adds to the run sheet is the other question a supervisor asks at half past six: not "what is
// next on this run" but "what is wrong with today" — which runs have no crew, which are over the seats
// on the bus, which are standing in the workshop when they should be on the road, and who is free to
// take the work. Filters narrow the list; the figures and the alerts are the whole day's, and the
// screen says so.
import { useMemo, useState } from "react";
import { dispatchBoard, type BoardCandidate, type BoardRun } from "../tms/dispatchBoard";
import { TRIP_STATUS_LABELS, type TripStatus } from "../tms/types";
import { useTms } from "../tms/useTms";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Select,
  Stat,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";
import type { Route } from "../routes";

const STATUS_TONE = {
  planned: "neutral",
  dispatched: "warning",
  in_progress: "warning",
  completed: "success",
  cancelled: "error",
} as const;

const clean = (filters: { status: string; routeId: string; driverId: string; vehicleId: string; clientId: string }) => ({
  status: (filters.status || "") as TripStatus | "",
  routeId: filters.routeId || undefined,
  driverId: filters.driverId || undefined,
  vehicleId: filters.vehicleId || undefined,
  clientId: filters.clientId || undefined,
});

export function DispatchBoardPage({ navigate }: { navigate?: (route: Route) => void }) {
  const { db } = useTms();
  const today = todayYmd();
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState({ status: "", routeId: "", driverId: "", vehicleId: "", clientId: "" });

  const board = useMemo(() => dispatchBoard(db, { date, ...clean(filters) }, today), [db, date, filters, today]);

  const pilots = (list: BoardCandidate[], empty: string) =>
    list.length === 0 ? (
      <p className="rts-band-empty">{empty}</p>
    ) : (
      <ul className="rts-desk-list">
        {list.map((candidate) => (
          <li key={candidate.id}>
            <span>{candidate.label}</span>
            <span className="rts-desk-wait">{candidate.note}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Dispatch board"
        description="One day at a glance: what is leaving, what nobody is driving, what is over the seats on the bus, and who is free. Reading only — runs are crewed and released on Staff busing."
        actions={
          navigate ? (
            <Button onClick={() => navigate("busing")}>Open staff busing</Button>
          ) : undefined
        }
      />

      <div className="rts-toolbar">
        <Field label="Service date">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button onClick={() => setDate(today)}>Today</Button>
        <Field label="Status">
          <Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Any status</option>
            {(Object.keys(TRIP_STATUS_LABELS) as TripStatus[]).map((status) => (
              <option key={status} value={status}>
                {TRIP_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Route">
          <Select value={filters.routeId} onChange={(event) => setFilters({ ...filters, routeId: event.target.value })}>
            <option value="">Every route</option>
            {[...db.routes].sort((a, b) => a.name.localeCompare(b.name)).map((route) => (
              <option key={route.id} value={route.id}>
                {route.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Company">
          <Select value={filters.clientId} onChange={(event) => setFilters({ ...filters, clientId: event.target.value })}>
            <option value="">Every company</option>
            {[...db.clients].sort((a, b) => a.name.localeCompare(b.name)).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Driver">
          <Select value={filters.driverId} onChange={(event) => setFilters({ ...filters, driverId: event.target.value })}>
            <option value="">Every driver</option>
            {[...db.drivers].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vehicle">
          <Select value={filters.vehicleId} onChange={(event) => setFilters({ ...filters, vehicleId: event.target.value })}>
            <option value="">Every vehicle</option>
            {[...db.vehicles].sort((a, b) => a.registration.localeCompare(b.registration)).map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.registration}
              </option>
            ))}
          </Select>
        </Field>
        {board.filtersApplied && (
          <Button
            variant="ghost"
            onClick={() => setFilters({ status: "", routeId: "", driverId: "", vehicleId: "", clientId: "" })}
          >
            Clear filters
          </Button>
        )}
      </div>

      {board.alerts.length > 0 && (
        <Notice tone="warning" title={`${formatDate(board.date)} needs attention`} className="mb-4">
          <ul className="space-y-1">
            {board.alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Departures" value={board.totals.runs} caption={`${board.dayRuns} on the sheet for ${formatDate(board.date)}.`} />
        <Stat
          label="Waiting on a crew"
          value={board.totals.unassigned}
          caption={board.totals.unassigned === 0 ? "Every run still to leave has a vehicle and a driver." : "No vehicle or no driver on these runs."}
        />
        <Stat
          label="Over the seats"
          value={board.totals.overCapacity}
          caption={board.totals.overCapacity === 0 ? "Everybody who is expected fits." : "Roster plus booked seats exceed the bus."}
        />
        <Stat
          label="Behind schedule"
          value={board.totals.late}
          caption={board.next ? `Next to leave: ${board.next.reference} at ${board.next.departsAt}, in ${board.next.minutes} min.` : "Nothing left to leave on this date."}
        />
      </div>

      <div className="mt-5">
        <Card
          title="The day"
          description="In departure order. Filters narrow this list; the figures above and the warning are the whole day's, so a filtered list is never mistaken for a quiet one."
        >
          <DataTable
            rows={board.runs}
            rowKey={(run: BoardRun) => run.tripId}
            emptyState={
              <EmptyState
                title={board.dayRuns === 0 ? "No runs on this date" : "No runs match these filters"}
                body={
                  board.dayRuns === 0
                    ? "Runs are generated from a route on Staff busing, and an out-of-schedule run is added there. Nothing is scheduled automatically."
                    : `${board.dayRuns} run${board.dayRuns === 1 ? "" : "s"} exist on ${formatDate(board.date)}; none match the filters above. Clear them to see the day.`
                }
              />
            }
            columns={[
              {
                key: "time",
                header: "Leaves",
                render: (run: BoardRun) => (
                  <span className="font-mono text-xs">
                    {run.departsAt || "—"}
                    {run.endsAt ? <span className="text-stone-400">–{run.endsAt}</span> : null}
                  </span>
                ),
              },
              {
                key: "run",
                header: "Run",
                render: (run: BoardRun) => (
                  <span>
                    <span className="font-mono text-xs font-semibold">{run.reference}</span>{" "}
                    {run.origin === "adhoc" && <Badge tone="info">ad hoc</Badge>}
                  </span>
                ),
              },
              {
                key: "route",
                header: "Route",
                render: (run: BoardRun) => (
                  <span>
                    <span className="font-medium">{run.routeName}</span>
                    <span className="block text-xs text-stone-600">{run.routeReference}</span>
                  </span>
                ),
              },
              { key: "company", header: "Company", render: (run: BoardRun) => <span className="text-sm">{run.clientName}</span> },
              {
                key: "vehicle",
                header: "Vehicle",
                render: (run: BoardRun) =>
                  run.vehicleLabel ? (
                    <span>
                      <span className="font-mono text-xs">{run.vehicleLabel}</span>
                      {run.vehicleState && <span className="block text-xs text-stone-600">{run.vehicleState}</span>}
                    </span>
                  ) : (
                    <span className="text-stone-500">no vehicle</span>
                  ),
              },
              {
                key: "driver",
                header: "Driver",
                render: (run: BoardRun) => (run.driverLabel ? <span className="text-sm">{run.driverLabel}</span> : <span className="text-stone-500">no driver</span>),
              },
              {
                key: "seats",
                header: "Seats",
                render: (run: BoardRun) =>
                  run.seats === 0 ? (
                    <span className="text-stone-500">no bus</span>
                  ) : run.overCapacity > 0 ? (
                    <Badge tone="error">{`${run.riders} for ${run.seats}`}</Badge>
                  ) : (
                    <span className="text-sm">
                      {run.riders}/{run.seats}
                      <span className="block text-xs text-stone-600">{run.free} spare</span>
                    </span>
                  ),
              },
              {
                key: "status",
                header: "Status",
                render: (run: BoardRun) => <Badge tone={STATUS_TONE[run.status]}>{TRIP_STATUS_LABELS[run.status]}</Badge>,
              },
              {
                key: "alerts",
                header: "Needs attention",
                render: (run: BoardRun) =>
                  run.alerts.length === 0 ? (
                    <span className="text-xs text-stone-400">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {run.alerts.map((alert) => (
                        <li key={alert.text}>
                          <Badge tone={alert.level === "blocker" ? "error" : "warning"}>{alert.level === "blocker" ? "Blocks" : "Late"}</Badge>{" "}
                          <span className="text-xs text-stone-700">{alert.text}</span>
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Vehicles free today" description="Nothing on them today, and what to know before you use one.">
          {pilots(board.available.vehicles, "Every vehicle is committed today, or the fleet is empty.")}
        </Card>
        <Card title="Drivers free today" description="No run and no hire holding them. A lapsed licence is listed with the date.">
          {pilots(board.available.drivers, "Every driver is committed today, or nobody is on the register.")}
        </Card>
      </div>

      <div className="mt-5">
        <Card title="What this board cannot tell you" description="Limits of the records, not of the arithmetic. Each one is a fact nobody has entered.">
          <ul className="space-y-2 text-sm text-stone-700">
            {board.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
