// Staff transport on the Reports screen (brief RPT-02).
//
// The counts a client asks about at a review, read straight off the run records: what was scheduled,
// what was worked, how many riders were actually carried, who did not appear, where the empty seats
// are, and what happened to the seats people asked for. The on-time figure beside it is the same one
// the busing screen has always shown (`kpis.ts`), so the two screens cannot disagree.
//
// Two habits this screen keeps, because they are the difference between a report and a guess:
//   * **a figure it cannot state says so** — average delay with no recorded stop, occupancy with no
//     vehicle, a boarding rate with nobody on the runs;
//   * **the gaps are named** — riders expected on a completed run with no outcome recorded, runs with
//     no vehicle, roster riders with no pickup stop. Those are the numbers that explain a surprising
//     total, so they travel with it (D-99).
import { useMemo, useState } from "react";
import { STAFF_REPORT_LIMITS, staffReport, staffReportCsv } from "../tms/staffReport";
import { useTms } from "../tms/useTms";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Notice,
  Stat,
  TableCard,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const percent = (value: number | null) => (value === null ? "Not available" : `${(value * 100).toFixed(1)}%`);
const firstOfMonth = (today: string) => `${today.slice(0, 7)}-01`;

export function StaffTransportReport() {
  const { db } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const report = useMemo(() => staffReport(db, from, to), [db, from, to]);
  const reversed = from > to;

  const download = () => {
    const blob = new Blob([staffReportCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `staff-transport-${report.from}-to-${report.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">
            <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Report from date" />
          </Field>
          <Field label="To">
            <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Report to date" />
          </Field>
        </div>
        <Button onClick={download} disabled={reversed || report.status === "invalid_range"}>
          Download CSV
        </Button>
      </div>

      {reversed ? (
        <Notice tone="error" title="The range is the wrong way round">
          The start date must be on or before the end date. Nothing is reported for a backwards period.
        </Notice>
      ) : (
        <>
          <Notice tone={report.status === "ok" ? "info" : "warning"} className="mb-4">
            {report.message}
          </Notice>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Runs scheduled" value={report.runsScheduled} caption={`${report.runsCancelled} cancelled · ${report.runsAdhoc} outside the schedule`} />
            <Stat label="Runs worked" value={report.runsCompleted} caption="completed in the period" />
            <Stat label="Riders carried" value={report.carried} caption={`of ${report.expected} expected on those runs`} />
            <Stat label="No-shows" value={report.noShows} caption="recorded as not boarding" />
            <Stat label="Boarding rate" value={percent(report.boardingRate)} caption="carried ÷ (carried + no-shows)" />
            <Stat label="Occupancy" value={percent(report.occupancy)} caption={`${report.carried} riders over ${report.seatsOffered} seats offered`} />
            <Stat
              label="Average delay"
              value={report.averageDelayMinutes === null ? "Not available" : `${report.averageDelayMinutes} min`}
              caption={report.averageDelayMinutes === null ? "no stop was recorded late" : `over ${report.lateStops} late stop(s)`}
            />
            <Stat
              label="On time"
              value={percent(report.onTimeRate)}
              caption={report.onTimeTimed > 0 ? `${report.onTimeTimed} run(s) judged against the threshold` : "no completed run had a threshold"}
            />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <TableCard title="Seats people asked for" summary={`${report.bookings.total} request(s) on runs in this period`}>
              <DataTable
                rows={[
                  { label: "Requested, not yet answered", value: report.bookings.requested },
                  { label: "Confirmed", value: report.bookings.confirmed },
                  { label: "On the waiting list", value: report.bookings.waitlisted },
                  { label: "Offered after a cancellation", value: report.bookings.offered },
                  { label: "Refused by the office", value: report.bookings.rejected },
                  { label: "Cancelled", value: report.bookings.cancelled },
                ]}
                rowKey={(row) => row.label}
                emptyState={<EmptyState title="No seats asked for" body="Nobody requested a seat on a run in this period." />}
                columns={[
                  { key: "label", header: "Where the seat stands", render: (row) => row.label },
                  { key: "value", header: "Seats", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.value },
                ]}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {report.seatsNotHeld} seat(s) were asked for and are not held now — refused, cancelled, waiting, or still unanswered. On the
                roster table below, a rider counted as carried was recorded as boarding at the door, not assumed from the roster.
              </p>
            </TableCard>

            <TableCard title="Why seats were lost" summary={`${report.bookings.rejected + report.bookings.cancelled} refused or cancelled`}>
              <DataTable
                rows={report.seatReasons}
                rowKey={(row) => row.reason}
                emptyState={<EmptyState title="No seat was lost" body="Nothing was refused or cancelled in this period." />}
                columns={[
                  { key: "reason", header: "Reason the office recorded", render: (row) => row.reason },
                  { key: "count", header: "Seats", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.count },
                ]}
              />
            </TableCard>
          </div>

          <TableCard title="By route" summary={`${report.routes.length} route(s) with runs in this period`}>
            <DataTable
              rows={report.routes}
              rowKey={(row) => row.routeId}
              emptyState={<EmptyState title="No route ran" body="No run on any route has a service date in this period." />}
              columns={[
                { key: "route", header: "Route", render: (row) => <span><span className="font-mono text-[11.5px] tabular-nums text-xs">{row.reference}</span> {row.name}</span> },
                { key: "client", header: "Client", render: (row) => row.clientName },
                { key: "runs", header: "Runs", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => `${row.runsCompleted} of ${row.runsScheduled}` },
                { key: "carried", header: "Carried", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.carried },
                { key: "noshow", header: "No-shows", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.noShows },
                { key: "unrecorded", header: "Not recorded", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.notRecorded },
                { key: "seats", header: "Seats offered", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.seatsOffered },
                { key: "occupancy", header: "Occupancy", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => percent(row.occupancy) },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Occupancy is riders carried divided by the seat capacity of the bus on each worked run, not the roster size. A route whose runs
              were all cancelled stays on the list with zero worked runs, because that is the thing worth seeing.
            </p>
          </TableCard>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <TableCard title="By client" summary={`${report.clients.length} client(s) had runs in this period`}>
              <DataTable
                rows={report.clients}
                rowKey={(row) => row.clientId}
                emptyState={<EmptyState title="No client" body="No run in this period belonged to a client route." />}
                columns={[
                  { key: "client", header: "Client", render: (row) => row.clientName },
                  { key: "routes", header: "Routes", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.routes },
                  { key: "carried", header: "Carried", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.carried },
                  { key: "noshow", header: "No-shows", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.noShows },
                  { key: "booked", header: "Booked seats", className: "text-right font-mono text-[11.5px] tabular-nums", render: (row) => row.bookedSeats },
                ]}
              />
            </TableCard>

            <TableCard title="What this report cannot say" summary="Named, so nothing here is read as a zero">
              <ul className="space-y-2 text-sm text-foreground">
                {STAFF_REPORT_LIMITS.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
              <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm text-foreground">
                <li className="flex justify-between gap-4">
                  <span>Runs with no vehicle assigned</span>
                  <span className="font-mono text-[11.5px] tabular-nums">{report.coverage.runsWithoutVehicle}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Completed runs with no boarding recorded</span>
                  <span className="font-mono text-[11.5px] tabular-nums">{report.coverage.completedRunsWithoutBoardings}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Stops recorded</span>
                  <span className="font-mono text-[11.5px] tabular-nums">
                    {report.coverage.stopsRecorded} of {report.coverage.stopsExpected}
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Roster riders with no pickup stop</span>
                  <span className="font-mono text-[11.5px] tabular-nums">{report.coverage.runsFromRosterWithoutStop}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Period</span>
                  <span className="font-mono text-[11.5px] tabular-nums">
                    {formatDate(report.from)} – {formatDate(report.to)}
                  </span>
                </li>
              </ul>
            </TableCard>
          </div>
        </>
      )}
    </div>
  );
}
