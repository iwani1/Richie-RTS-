import { useMemo, useState, type FormEvent } from "react";
import { documentStatus } from "../tms/compliance";
import type { IncidentInput } from "../tms/logistics";
import { TripStopForm } from "./TripStopForm";
import { scopedView } from "../tms/scope";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
  TRIP_STATUS_LABELS,
  type Incident,
  type Trip,
} from "../tms/types";
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
  Panel,
  Select,
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const TRIP_TONE = {
  planned: "info",
  dispatched: "warning",
  in_progress: "warning",
  completed: "success",
  cancelled: "neutral",
} as const;

// Driver portal. Own-record scope: everything here comes from scopedView(), which
// returns only the runs and incidents for the linked driver record.
export function DriverPortalPage() {
  const { db, actor, currentUser, allowed, dispatch, setFlash } = useTms();
  const view = useMemo(() => scopedView(db, actor), [db, actor]);
  const [reporting, setReporting] = useState(false);
  const [recordingStop, setRecordingStop] = useState<Trip | null>(null);
  const [dateFilter, setDateFilter] = useState<"today" | "all">("today");

  const driver = view.link.driver;
  const today = todayYmd();
  const trips = view.trips
    .filter((t) => (dateFilter === "today" ? t.serviceDate === today : true))
    .sort((a, b) => (a.serviceDate === b.serviceDate ? a.reference.localeCompare(b.reference) : a.serviceDate < b.serviceDate ? -1 : 1));
  const routeName = (routeId: string) => db.routes.find((r) => r.id === routeId)?.name ?? "Unknown route";
  const routeOf = (routeId: string) => db.routes.find((r) => r.id === routeId);
  const vehicleReg = (id: string | null) => db.vehicles.find((v) => v.id === id)?.registration ?? "-";
  const upcoming = view.trips.filter((t) => t.serviceDate >= today && t.status !== "cancelled").length;

  return (
    <div>
      <PageHeader
        eyebrow="Driver"
        title={currentUser?.fullName ?? "My work"}
        description="Your assigned runs, and a way to report a problem with a vehicle assigned to you."
      />

      {!driver && (
        <Notice tone="warning" title="Account not linked to a driver record">
          This account has the driver role but is not linked to a driver record, so it can see no runs.
          An administrator links accounts on the Users screen. Until then this page stays empty by design.
        </Notice>
      )}

      {driver && (
        <>
          <Card title="My licence" description="Kept by operations. Raise it with them if anything here is wrong.">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><p className="text-xs text-stone-500">Licence number</p><p className="font-medium">{driver.licenceNumber}</p></div>
              <div><p className="text-xs text-stone-500">Phone</p><p className="font-medium">{driver.phone || "not recorded"}</p></div>
              <div><p className="text-xs text-stone-500">Expires</p><p className="font-medium">{formatDate(driver.licenceExpiry)}</p></div>
              <div><p className="text-xs text-stone-500">Status</p><Badge tone={driver.status === "active" ? "success" : driver.status === "suspended" ? "warning" : "neutral"}>{driver.status}</Badge></div>
            </div>
          </Card>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant={dateFilter === "today" ? "primary" : "secondary"} onClick={() => setDateFilter("today")}>Today</Button>
              <Button variant={dateFilter === "all" ? "primary" : "secondary"} onClick={() => setDateFilter("all")}>All my runs ({view.trips.length})</Button>
            </div>
            {allowed("incidents:create") && <Button variant="primary" onClick={() => setReporting(true)}>Report a problem</Button>}
          </div>

          <div className="mt-3">
            <DataTable
              rows={trips}
              rowKey={(t: Trip) => t.id}
              emptyState={
                <EmptyState
                  title={dateFilter === "today" ? "No runs assigned to you today" : "No runs assigned to you"}
                  body={dateFilter === "today" ? `You have ${upcoming} upcoming run(s). Switch to "All my runs" to see them.` : "When operations assigns you a run it appears here."}
                />
              }
              columns={[
                { key: "date", header: "Date", render: (t: Trip) => formatDate(t.serviceDate) },
                { key: "ref", header: "Run", render: (t: Trip) => <span className="font-mono text-xs">{t.reference}</span> },
                { key: "route", header: "Route", render: (t: Trip) => <span className="font-medium">{routeName(t.routeId)}</span> },
                { key: "vehicle", header: "Vehicle", render: (t: Trip) => vehicleReg(t.vehicleId) },
                {
                  key: "status",
                  header: "Status",
                  render: (t: Trip) => <Badge tone={TRIP_TONE[t.status]}>{TRIP_STATUS_LABELS[t.status]}</Badge>,
                },
                {
                  key: "progress",
                  header: "Run progress",
                  render: (t: Trip) => {
                    const route = routeOf(t.routeId);
                    return route ? `${t.stopLogs.length} / ${route.stops.length} stops` : "-";
                  },
                },
                {
                  key: "actions",
                  header: "",
                  className: "text-right",
                  render: (t: Trip) => {
                    const route = routeOf(t.routeId);
                    if (t.status === "dispatched" && allowed("trips:start")) {
                      return <Button variant="primary" onClick={() => {
                        const result = dispatch({ type: "start_trip", id: t.id });
                        setFlash({ tone: result.ok ? "success" : "error", message: result.message });
                      }}>Start run</Button>;
                    }
                    if (t.status === "in_progress" && allowed("trips:record") && route && route.stops[t.stopLogs.length]) {
                      return <Button variant="primary" onClick={() => setRecordingStop(t)}>Record next stop</Button>;
                    }
                    if (t.status === "in_progress" && allowed("trips:complete") && route && t.stopLogs.length === route.stops.length) {
                      return <Button variant="primary" onClick={() => {
                        const result = dispatch({ type: "complete_trip", id: t.id });
                        setFlash({ tone: result.ok ? "success" : "error", message: result.message });
                      }}>Complete run</Button>;
                    }
                    if (t.status === "completed") return <span className="text-xs text-stone-500">Recorded</span>;
                    return null;
                  },
                },
              ]}
            />
          </div>

          <div className="mt-5">
            <Card title="Problems I have reported" description="Only incidents you reported, or that concern a vehicle assigned to you.">
              {view.incidents.length === 0 ? (
                <EmptyState title="Nothing reported" body="If a vehicle assigned to you breaks down or is damaged, report it so operations can respond." />
              ) : (
                <ul className="space-y-2">
                  {view.incidents.map((incident: Incident) => (
                    <li key={incident.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-stone-200 px-3 py-2">
                      <span className="font-mono text-xs font-semibold">{incident.reference}</span>
                      <span className="text-sm">{INCIDENT_TYPE_LABELS[incident.type]}</span>
                      <Badge tone={incident.severity === "high" || incident.severity === "critical" ? "error" : "neutral"}>{INCIDENT_SEVERITY_LABELS[incident.severity]}</Badge>
                      <Badge tone="neutral">{INCIDENT_STATUS_LABELS[incident.status]}</Badge>
                      <span className="text-xs text-stone-500">{formatDate(incident.reportedDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {allowed("documents:read") && (
            <div className="mt-5">
              <Card title="My compliance documents" description="Documents for your driver record and vehicles assigned to you. Read-only; operations keeps these current.">
                {view.documents.length === 0 ? (
                  <EmptyState title="No documents on file" body="Compliance documents for you or your assigned vehicles will appear here once recorded." />
                ) : (
                  <ul className="space-y-2">
                    {view.documents.map((doc) => {
                      const typeName = db.settings.documentTypes.find((t) => t.id === doc.documentTypeId)?.name ?? "Document";
                      const status = documentStatus(doc.expiryDate, db.settings.documentReminderLeadDays, today);
                      return (
                        <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-stone-200 px-3 py-2">
                          <span className="font-medium text-sm">{typeName}</span>
                          <Badge tone={doc.ownerType === "driver" ? "neutral" : "info"}>{doc.ownerType === "driver" ? "You" : vehicleReg(doc.ownerId)}</Badge>
                          <span className="text-xs text-stone-500">Expires {formatDate(doc.expiryDate)}</span>
                          <Badge tone={status === "expired" ? "error" : status === "expiring_soon" ? "warning" : status === "valid" ? "success" : "neutral"}>
                            {status === "expired" ? "Expired" : status === "expiring_soon" ? "Expiring soon" : status === "valid" ? "Valid" : "Unknown"}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </>
      )}

      {reporting && driver && (
        <ReportIncident
          vehicles={view.vehicles}
          onClose={() => setReporting(false)}
          onSubmit={(input) => {
            const result = dispatch({ type: "create_incident", input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setReporting(false);
            return result.ok ? null : result.errors;
          }}
        />
      )}

      {recordingStop && driver && routeOf(recordingStop.routeId) && (
        <TripStopForm
          trip={recordingStop}
          route={routeOf(recordingStop.routeId)!}
          roster={view.passengers.filter((passenger) => passenger.routeId === recordingStop.routeId && passenger.status === "active")}
          onClose={() => setRecordingStop(null)}
          onSubmit={(input) => {
            const result = dispatch({ type: "record_trip_stop", id: recordingStop.id, input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setRecordingStop(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

function ReportIncident({
  vehicles,
  onClose,
  onSubmit,
}: {
  vehicles: { id: string; registration: string }[];
  onClose: () => void;
  onSubmit: (input: IncidentInput) => Record<string, string> | null;
}) {
  const [values, setValues] = useState<IncidentInput>({
    type: "breakdown",
    severity: "high",
    vehicleId: vehicles[0]?.id ?? "",
    tripId: "",
    reportedDate: todayYmd(),
    description: "",
    assignedTo: "",
    takeVehicleOutOfService: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSubmit(values);
    setErrors(result ?? {});
  };

  return (
    <Panel
      title="Report a problem"
      description="Report only what happened. Operations decides whether the vehicle comes off the road."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" error={errors.type}>
            <Select value={values.type} onChange={(e) => setValues({ ...values, type: e.target.value as IncidentInput["type"] })} invalid={!!errors.type}>
              {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="How serious is it?" error={errors.severity}>
            <Select value={values.severity} onChange={(e) => setValues({ ...values, severity: e.target.value as IncidentInput["severity"] })} invalid={!!errors.severity}>
              {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
          </Select>
        </Field>
        <Field label="Date reported" error={errors.reportedDate}>
          <TextInput type="date" value={values.reportedDate} onChange={(e) => setValues({ ...values, reportedDate: e.target.value })} invalid={!!errors.reportedDate} />
        </Field>
        <Field label="What happened?" hint="Facts only. Operations and finance may read this." error={errors.description}>
          <TextArea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} invalid={!!errors.description} autoFocus />
        </Field>
        <Notice tone="info">
          This report does not change vehicle status. Operations decides whether the vehicle is withdrawn from service.
        </Notice>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Send report</Button>
        </div>
      </form>
    </Panel>
  );
}
