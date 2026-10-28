import { useMemo, useState } from "react";
import { scopedView } from "../tms/scope";
import { stopDetailLine } from "../tms/stops";
import { useTms } from "../tms/useTms";
import {
  cancellationProblem,
  eligibleRunsFor,
  journeysOf,
  nextJourney,
  pastJourneys,
  sortByPickup,
  travelPolicy,
  upcomingJourneys,
  PASSENGER_LIMITS,
  type Journey,
} from "../tms/passenger";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  type Incident,
  type IncidentSeverity,
  type IncidentType,
} from "../tms/types";
import type { Errors } from "../tms/service";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  Select,
  TextArea,
  formatDate,
  todayYmd,
} from "../ui/primitives";

// Passenger portal (brief 1C, PAX-01, D-97).
//
// One rider, one page: the run it is on, the seat it holds, the reference the office asked it to
// quote, and a way to ask for another seat or report something wrong with a journey. Everything is
// read through `scopedView`, so the payload holds this rider's own record and its own seats — never a
// colleague's, and never the office's roster.
//
// What the page cannot say is where the bus is. Nothing records a position, so there is no map and no
// countdown; the page says the run has started instead, and `PASSENGER_LIMITS` explains the silence
// rather than letting a rider mistake it for a broken screen (PAX-02 stays deferred).
export function PassengerPortalPage() {
  const { db, actor, currentUser, dispatch, setFlash } = useTms();
  const view = useMemo(() => scopedView(db, actor), [db, actor]);
  const rider = view.link.passenger;

  const now = new Date().toISOString();
  const today = todayYmd();
  const [panel, setPanel] = useState<{ mode: "request" } | { mode: "cancel"; journey: Journey } | { mode: "feedback"; journey: Journey | null } | null>(null);

  const journeys = useMemo(() => (rider ? journeysOf(db, rider, view.bookings) : []), [db, rider, view.bookings]);
  const upcoming = sortByPickup(upcomingJourneys(journeys, today));
  const history = pastJourneys(journeys, today);
  const next = nextJourney(journeys, today);
  const policy = travelPolicy(db);
  const myFeedback = view.incidents;

  const send = async (command: Parameters<typeof dispatch>[0]) => {
    const result = await dispatch(command);
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    return result;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Passenger"
        title={currentUser?.fullName ?? "My journeys"}
        description="Your bus, your stop, your seat — and the reference to quote when you ring the office."
      />

      {!rider && (
        <Notice tone="warning" title="Account not linked to a rider record">
          This account has the passenger role but is not linked to a rider record, so it can see no
          journeys. An administrator links accounts on the Users screen. Until then this page stays
          empty by design.
        </Notice>
      )}

      {rider && (
        <>
          <Card
            title="Your next journey"
            description="Read from the timetable and the run's status. It is not a tracking view."
            actions={
              next && next.booking?.status === "confirmed" && cancellationProblem(db, next.booking, now) === null ? (
                <Button onClick={() => setPanel({ mode: "cancel", journey: next })}>Cancel this seat</Button>
              ) : undefined
            }
          >
            {next ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Leaves</p>
                  <p className="text-lg font-semibold text-foreground">{next.pickupTime ?? "time not set"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(next.date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Your stop</p>
                  <p className="font-medium text-foreground">{next.pickupStop?.name ?? "not recorded"}</p>
                  {/* RTE-01: where to wait, in the rider's own words — not the office's coordinates. */}
                  {next.pickupStop && stopDetailLine(next.pickupStop) && (
                    <p className="text-xs text-muted-foreground">{stopDetailLine(next.pickupStop)}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{next.route.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Bus</p>
                  <p className="font-medium text-foreground">{next.vehicle ?? "not assigned yet"}</p>
                  <p className="text-xs text-muted-foreground">{next.trip.reference}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-1"><Badge tone={next.state.tone}>{next.state.label}</Badge></p>
                  <p className="mt-1 text-xs text-muted-foreground">{next.booking ? `Reference ${next.booking.reference}` : "No booking — you travel on your route's roster."}</p>
                </div>
                <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">{next.state.detail}</p>
              </div>
            ) : (
              <EmptyState
                title="No journey ahead of you"
                body="Nothing is scheduled for your route in the coming days. When operations generates the runs, they appear here."
              />
            )}
          </Card>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setPanel({ mode: "request" })}>Request a seat on another run</Button>
            <Button onClick={() => setPanel({ mode: "feedback", journey: next })}>Report a problem with a journey</Button>
          </div>

          <div className="mt-5">
            <DataTable
              rows={upcoming}
              rowKey={(journey: Journey) => journey.trip.id}
              emptyState={<EmptyState title="No upcoming journeys" body="Runs on your route, and any run you hold a seat on, appear here as soon as they are scheduled." />}
              columns={[
                { key: "date", header: "Date", render: (j: Journey) => formatDate(j.date) },
                { key: "time", header: "Pickup", render: (j: Journey) => <span className="font-medium">{j.pickupTime ?? "-"}</span> },
                { key: "stop", header: "Stop", render: (j: Journey) => j.pickupStop?.name ?? "not recorded" },
                { key: "route", header: "Route", render: (j: Journey) => j.route.name },
                { key: "bus", header: "Bus", render: (j: Journey) => j.vehicle ?? <span className="text-dim">not assigned</span> },
                { key: "ref", header: "Reference", render: (j: Journey) => (j.booking ? <span className="font-mono text-xs">{j.booking.reference}</span> : <span className="text-xs text-muted-foreground">on roster</span>) },
                {
                  key: "status",
                  header: "Status",
                  render: (j: Journey) => (
                    <div>
                      <Badge tone={j.state.tone}>{j.state.label}</Badge>
                      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{j.state.detail}</p>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (j: Journey) => {
                    const blocked = j.booking ? cancellationProblem(db, j.booking, now) : "You travel on your route's roster; there is no booking to cancel.";
                    return blocked === null && j.booking ? (
                      <Button onClick={() => setPanel({ mode: "cancel", journey: j })}>Cancel seat</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{blocked}</span>
                    );
                  },
                },
              ]}
            />
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-semibold text-foreground">Where you have been</h2>
            <p className="mb-3 text-xs text-muted-foreground">Finished and cancelled runs, newest first. These are the journeys the office would review if you queried a fare or a no-show.</p>
            <DataTable
              rows={history}
              rowKey={(journey: Journey) => journey.trip.id}
              emptyState={<EmptyState title="No past journeys yet" body="Once a run you travelled on finishes, it is kept here." />}
              columns={[
                { key: "date", header: "Date", render: (j: Journey) => formatDate(j.date) },
                { key: "route", header: "Route", render: (j: Journey) => j.route.name },
                { key: "stop", header: "Boarded at", render: (j: Journey) => j.pickupStop?.name ?? "not recorded" },
                { key: "ref", header: "Reference", render: (j: Journey) => (j.booking ? <span className="font-mono text-xs">{j.booking.reference}</span> : <span className="text-xs text-muted-foreground">on roster</span>) },
                {
                  key: "status",
                  header: "What happened",
                  render: (j: Journey) => (
                    <div>
                      <Badge tone={j.state.tone}>{j.state.label}</Badge>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{j.state.detail}</p>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <Card title="Company transport policy" description="As the office has set it. Nothing here is a guess: an unset rule is shown as unset.">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Ask for a seat</dt>
                  <dd className="font-medium text-foreground">
                    {policy.requestCutoffMinutes === null
                      ? "No cut-off set — ask any time before the run leaves"
                      : `At least ${policy.requestCutoffMinutes} minutes before departure`}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Cancel a seat</dt>
                  <dd className="font-medium text-foreground">
                    {policy.cancellationCutoffMinutes === null
                      ? "No cut-off set — cancel any time before the run leaves"
                      : `At least ${policy.cancellationCutoffMinutes} minutes before departure`}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Your route</dt>
                  <dd className="font-medium text-foreground">
                    {db.routes.find((route) => route.id === rider.routeId)?.name ?? "not assigned"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Your stop</dt>
                  <dd className="font-medium text-foreground">
                    {db.routes.flatMap((route) => route.stops).find((stop) => stop.id === rider.stopId)?.name ?? "not recorded"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 rounded-sm border border-border bg-muted p-3">
                <p className="text-xs font-semibold text-foreground">What this page cannot tell you</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {PASSENGER_LIMITS.map((limit) => <li key={limit}>{limit}</li>)}
                </ul>
              </div>
            </Card>

            <Card title="What you have reported" description="Feedback goes to operations as an incident, on the same log they triage breakdowns from.">
              {myFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing reported. If a journey went wrong, say so — the office sees it against the run.</p>
              ) : (
                <ul className="space-y-3">
                  {myFeedback.map((incident: Incident) => (
                    <li key={incident.id} className="border-l-2 border-border pl-3">
                      <p className="text-sm font-medium text-foreground">
                        <span className="font-mono text-xs text-muted-foreground">{incident.reference}</span> · {incident.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Badge tone={incident.status === "resolved" || incident.status === "closed" ? "success" : "info"}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge>{" "}
                        {formatDate(incident.reportedDate)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {panel?.mode === "request" && rider && (
        <RequestForm
          riderId={rider.id}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await send({ type: "create_booking", input });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}

      {panel?.mode === "cancel" && (
        <CancelForm
          journey={panel.journey}
          onClose={() => setPanel(null)}
          onSubmit={async (reason) => {
            const result = await send({ type: "cancel_booking", id: panel.journey.booking!.id, reason });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}

      {panel?.mode === "feedback" && rider && (
        <FeedbackForm
          journeys={journeys}
          initial={panel.journey}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await send({ type: "create_incident", input });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

/**
 * The runs a rider may ask for, with the office's reasons for the ones it may not.
 *
 * Showing the refusals is the point: "you already hold a seat on this run" and "requests close 60
 * minutes before departure" are answers, and a list that silently omitted those runs would leave the
 * rider ringing to ask why.
 */
function RequestForm({ riderId, onClose, onSubmit }: { riderId: string; onClose: () => void; onSubmit: (input: { passengerId: string; routeId: string; serviceDate: string; toDate: string; type: "one_time"; note: string }) => Errors | Promise<Errors> }) {
  const { db } = useTms();
  const rider = db.passengers.find((candidate) => candidate.id === riderId);
  const now = new Date().toISOString();
  const today = todayYmd();
  const horizon = new Date(Date.parse(`${today}T00:00:00.000Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const runs = rider ? eligibleRunsFor(db, rider, now, today, horizon) : [];
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const ask = async (runId: string, routeId: string, date: string) => {
    setBusyId(runId);
    setErrors(await onSubmit({ passengerId: riderId, routeId, serviceDate: date, toDate: date, type: "one_time", note }));
    setBusyId(null);
  };

  return (
    <Panel title="Request a seat" description="Two weeks ahead. A request is a request: the office confirms it." onClose={onClose}>
      {runs.length === 0 ? (
        <EmptyState title="Nothing to ask for" body="No runs are scheduled in the next two weeks. Once operations generates them, they are listed here." />
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.trip.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(run.date)} · {run.departureTime || "time not set"} · {run.route.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {run.bookable ? `${run.seatsFree} seat(s) free · ${run.trip.reference}` : run.why}
                </p>
              </div>
              {run.bookable && (
                <Button variant="primary" disabled={busyId === run.trip.id} onClick={() => void ask(run.trip.id, run.route.id, run.date)}>
                  {busyId === run.trip.id ? "Requesting..." : "Request"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Field label="Anything the office should know" hint="Optional. Kept with the request so the person confirming it sees why." error={errors.note}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} invalid={!!errors.note} />
        </Field>
        {Object.entries(errors).filter(([, message]) => message).length > 0 && (
          <Notice tone="error" title="Not requested">
            {Object.values(errors).filter(Boolean).join(" ")}
          </Notice>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Panel>
  );
}

function CancelForm({ journey, onClose, onSubmit }: { journey: Journey; onClose: () => void; onSubmit: (reason: string) => Errors | Promise<Errors> }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  return (
    <Panel
      title={`Cancel ${journey.booking?.reference ?? "this seat"}`}
      description={`${journey.route.name} on ${formatDate(journey.date)} at ${journey.pickupTime ?? "the scheduled time"}. A cancelled seat goes to the oldest person waiting; nobody is confirmed automatically.`}
      onClose={onClose}
    >
      <Field label="Why are you cancelling?" hint="Kept with the booking and in the audit log." error={errors.reason}>
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} invalid={!!errors.reason} autoFocus />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Keep the seat</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErrors(await onSubmit(reason));
            setBusy(false);
          }}
        >
          {busy ? "Cancelling..." : "Cancel seat"}
        </Button>
      </div>
    </Panel>
  );
}

function FeedbackForm({ journeys, initial, onClose, onSubmit }: { journeys: Journey[]; initial: Journey | null; onClose: () => void; onSubmit: (input: { type: IncidentType; severity: IncidentSeverity; vehicleId: string; tripId: string; reportedDate: string; description: string; assignedTo: string; takeVehicleOutOfService: boolean }) => Errors | Promise<Errors> }) {
  const [tripId, setTripId] = useState(initial?.trip.id ?? journeys[0]?.trip.id ?? "");
  const [type, setType] = useState<IncidentType>("other");
  const [severity, setSeverity] = useState<IncidentSeverity>("low");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  return (
    <Panel
      title="Report a problem with a journey"
      description="This goes to operations as an incident against the run. It is not a message board: somebody is expected to act on it."
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="Which journey" error={errors.tripId}>
          <Select value={tripId} onChange={(e) => setTripId(e.target.value)} invalid={!!errors.tripId}>
            {journeys.length === 0 && <option value="">No journeys on file</option>}
            {journeys.map((journey) => (
              <option key={journey.trip.id} value={journey.trip.id}>
                {formatDate(journey.date)} · {journey.route.name} · {journey.trip.reference}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What kind of problem" error={errors.type}>
          <Select value={type} onChange={(e) => setType(e.target.value as IncidentType)} invalid={!!errors.type}>
            <option value="safety_concern">Safety concern</option>
            <option value="other">Other</option>
            <option value="breakdown">The bus broke down</option>
            <option value="accident">An accident</option>
            <option value="damage">Damage to the bus</option>
          </Select>
        </Field>
        <Field label="How serious" error={errors.severity}>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} invalid={!!errors.severity}>
            {INCIDENT_SEVERITIES.map((value) => <option key={value} value={value}>{INCIDENT_SEVERITY_LABELS[value]}</option>)}
          </Select>
        </Field>
        <Field label="What happened" hint="Include the stop or the time if you can." error={errors.description}>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} invalid={!!errors.description} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !tripId}
          onClick={async () => {
            setBusy(true);
            // The vehicle is decided by the run, never by this form: the command substitutes it.
            setErrors(
              await onSubmit({
                type,
                severity,
                vehicleId: "",
                tripId,
                reportedDate: todayYmd(),
                description,
                assignedTo: "",
                takeVehicleOutOfService: false,
              }),
            );
            setBusy(false);
          }}
        >
          {busy ? "Sending..." : "Send to operations"}
        </Button>
      </div>
    </Panel>
  );
}
