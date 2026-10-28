// The fleet dashboard (FLT-05, D-112).
//
// Three things an owner asks about the fleet, on one screen: what we have and where it is today,
// how much of it worked over a period, and what standing still cost. Every number is counted from
// records on this machine — nothing is estimated, and where a figure needs a fact only the company
// can supply (the daily cost of a standing vehicle) the screen says so instead of inventing one.
//
// The rules behind the four day buckets, and why work outranks the workshop, are written in
// `src/tms/fleetReport.ts` and repeated on the page in plain words, because the person reading the
// dashboard is the person who has to explain it.
import { useMemo, useState } from "react";
import { FLEET_STATE_LABELS, FLEET_STATE_ORDER, type FleetState } from "../tms/fleetState";
import { FLEET_BUCKETS, currentMonthToDate, fleetReport, fleetReportCsv, previousPeriod } from "../tms/fleetReport";
import { csvFileName, downloadTextFile } from "../ui/download";
import { formatAmount } from "../tms/money";
import { useTms } from "../tms/useTms";
import { Badge, Band, Button, DataTable, EmptyState, Field, Notice, PageHeader, Stat, TableCard, TextInput, formatDate, todayYmd } from "../ui/primitives";

const STATE_TONE: Record<FleetState, "success" | "info" | "warning" | "error" | "neutral"> = {
  available: "success",
  reserved: "info",
  assigned: "info",
  on_trip: "info",
  pending_inspection: "warning",
  maintenance: "warning",
  out_of_service: "error",
  retired: "neutral",
};

const percent = (share: number | null) => (share === null ? "—" : `${Math.round(share * 100)}%`);
const money = (currency: string | null, amount: number) => (currency ? `${currency} ${formatAmount(amount)}` : formatAmount(amount));

export function FleetPage() {
  const { db, allowed } = useTms();
  const today = todayYmd();
  const [range, setRange] = useState(() => currentMonthToDate(today));
  const valid = range.from !== "" && range.to !== "" && range.from <= range.to;

  const report = useMemo(() => (valid ? fleetReport(db, range.from, range.to) : null), [db, range.from, range.to, valid]);
  const before = useMemo(() => (valid ? previousPeriod(range.from, range.to) : null), [range.from, range.to, valid]);
  const previous = useMemo(
    () => (before ? fleetReport(db, before.from, before.to) : null),
    [db, before],
  );

  const serviceableDays = report ? report.vehicleDays.inFleet - report.vehicleDays.workshop : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Fleet"
        title="Fleet dashboard"
        description="What the fleet had, what it did with its days, and what standing still cost. Every figure is counted from the records on this machine."
        actions={
          // The export is the figures on this screen, written out: it cannot contain a vehicle the
          // signed-in role could not see, because the payload arrived already narrowed on the server.
          <Button
            onClick={() => report && downloadTextFile(csvFileName("fleet-dashboard", report.from, report.to), fleetReportCsv(report))}
            disabled={!report || report.status === "empty"}
          >
            Download CSV
          </Button>
        }
      />

      <div className="space-y-5">
        <Band
          label="The period"
          note="Measured in vehicle-days: one vehicle on one calendar day. Not hours — nothing in this program records an hour of a vehicle's time, so an hours figure would be a guess (Q-29)."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-lg">
            <Field label="From" hint="A vehicle counts from the day it was registered">
              <TextInput
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(event) => setRange({ ...range, from: event.target.value })}
              />
            </Field>
            <Field label="To" hint="Usually today: the future has no records">
              <TextInput
                type="date"
                value={range.to}
                min={range.from || undefined}
                max={today}
                onChange={(event) => setRange({ ...range, to: event.target.value })}
              />
            </Field>
          </div>
          {!valid && <Notice tone="warning" className="mt-3">The start date is after the end date, so there is no period to measure.</Notice>}
          {report && report.status === "empty" && (
            <Notice tone="info" className="mt-3">No vehicles are on the register, so there is nothing to measure.</Notice>
          )}
          {report && report.status !== "empty" && (
            <p className="mt-3 text-xs text-muted-foreground">{report.message}</p>
          )}
        </Band>

        {report && report.status !== "empty" && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Stat
                label="Vehicles"
                value={report.totals.vehicles}
                caption={`${report.totals.inService} in service · ${report.totals.retired} retired`}
              />
              <Stat label="Available today" value={report.availableToday} caption="Nothing wrong with it, nothing holding it" />
              <Stat label="Working today" value={report.workingToday} caption="Assigned to a run, or on one" />
              <Stat
                label="Utilisation"
                value={percent(report.utilisation)}
                caption={`${report.committedVehicleDays} of ${report.availableVehicleDays} committed vehicle-days`}
              />
              <Stat
                label="Days worked"
                value={report.vehicleDays.worked}
                caption={`${percent(report.workedShare)} of ${serviceableDays} serviceable vehicle-days`}
              />
              <Stat
                label="Idle days"
                value={report.vehicleDays.idle}
                caption={`of ${report.vehicleDays.inFleet} vehicle-days in the period`}
              />
              <Stat
                label="Cost of idle days"
                value={report.idleCost.total === null ? "Not priced" : money(report.idleCost.currencyCode, report.idleCost.total)}
                caption={report.idleCost.perDay === null ? "No standing cost set" : `${money(report.idleCost.currencyCode, report.idleCost.perDay)} per vehicle-day`}
              />
            </div>

            {report.idleCost.perDay === null && (
              <Notice tone="info" title="No money is put on an idle day">
                What one vehicle costs the company on a day it does not work — finance, insurance, licensing, the driver
                on retainer — is a figure only the company can supply, so nothing here assumes one.{" "}
                {allowed("settings:update")
                  ? "Set it under Settings → Fleet and these idle days get a price."
                  : "An administrator can set it under Settings → Fleet."}
              </Notice>
            )}

            <Band
              label="Today, one state each"
              note="Read from the same function the vehicle register uses, so the two screens cannot disagree. A retired vehicle is counted here and left out of the period below."
            >
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {FLEET_STATE_ORDER.map((state) => (
                  <li key={state} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2">
                    <span className="text-xs text-foreground">{FLEET_STATE_LABELS[state]}</span>
                    <Badge tone={STATE_TONE[state]}>{report.today[state]}</Badge>
                  </li>
                ))}
              </ul>
            </Band>

            <Band
              label="How the period's days fell"
              note="Every vehicle-day lands in exactly one of these. Work comes first: a bus that carried people and went into the workshop the same afternoon worked that day."
            >
              <DataTable
                rows={FLEET_BUCKETS.map((bucket) => ({
                  key: bucket.key,
                  label: bucket.label,
                  note: bucket.note,
                  days: report.vehicleDays[bucket.key],
                }))}
                rowKey={(row) => row.key}
                emptyState={<EmptyState title="No days in this period" body="Pick a start date on or before the end date." />}
                columns={[
                  { key: "bucket", header: "Bucket", render: (row) => <span className="font-semibold text-foreground">{row.label}</span> },
                  { key: "note", header: "What it means", render: (row) => <span className="text-xs text-muted-foreground">{row.note}</span> },
                  { key: "days", header: "Vehicle-days", className: "rts-num", render: (row) => <span className="tabular-nums">{row.days}</span> },
                  {
                    key: "share",
                    header: "Share of days in the fleet",
                    render: (row) => {
                      const share = report.vehicleDays.inFleet > 0 ? row.days / report.vehicleDays.inFleet : 0;
                      return (
                        <div className="rts-interval-row">
                          <span className="text-xs tabular-nums">{percent(share)}</span>
                          {/* Decorative: the same figure is set beside it, so the bar carries nothing alone. */}
                          <span className="rts-interval" aria-hidden="true">
                            <span className="rts-interval-fill" style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
                          </span>
                        </div>
                      );
                    },
                  },
                ]}
              />
              {previous && previous.status !== "empty" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  The period before this one ({formatDate(before!.from)} to {formatDate(before!.to)}) worked{" "}
                  {percent(previous.utilisation)} of its serviceable days, against {percent(report.utilisation)} here.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                <strong>Utilisation</strong> is the figure agreed with management (Q-29): the days a run or hire held a vehicle,
                over the days the fleet in service could have held one — {report.committedVehicleDays} of{" "}
                {report.availableVehicleDays} here. <strong>Days worked</strong> is the stricter measure: only days a run
                actually started or a hire was under way, over the days a vehicle was ours and not in the workshop (
                {serviceableDays} here). A day that was sold and never ran is counted apart from idle, because losing a day
                somebody wanted is a different problem from nobody wanting it.
              </p>
            </Band>

            <TableCard
              title="By vehicle"
              summary={`Idle days first, because that is the row somebody acts on · ${report.byVehicle.length} vehicle(s) in the period`}
            >
              <DataTable
                rows={report.byVehicle}
                rowKey={(row) => row.vehicleId}
                emptyState={<EmptyState title="No vehicle was on the register in this period" body="A vehicle counts from the day it was registered and until it is retired." />}
                columns={[
                  {
                    key: "vehicle",
                    header: "Vehicle",
                    render: (row) => (
                      <div>
                        <p className="font-mono text-xs font-semibold text-foreground">{row.registration}</p>
                        <p className="text-xs text-muted-foreground">{row.categoryName}</p>
                      </div>
                    ),
                  },
                  { key: "infleet", header: "Days in fleet", className: "rts-num", render: (row) => <span className="tabular-nums">{row.inFleetDays}</span> },
                  { key: "committed", header: "Committed", className: "rts-num", render: (row) => <span className="tabular-nums">{row.committedDays}</span> },
                  { key: "worked", header: "Worked", className: "rts-num", render: (row) => <span className="tabular-nums">{row.workedDays}</span> },
                  { key: "booked", header: "Booked", className: "rts-num", render: (row) => <span className="tabular-nums">{row.bookedDays}</span> },
                  { key: "workshop", header: "Workshop", className: "rts-num", render: (row) => <span className="tabular-nums">{row.workshopDays}</span> },
                  { key: "idle", header: "Idle", className: "rts-num", render: (row) => <span className="tabular-nums">{row.idleDays}</span> },
                  {
                    key: "last",
                    header: "Last worked",
                    render: (row) =>
                      row.lastWorkedOn ? (
                        <span className="text-xs">{formatDate(row.lastWorkedOn)}</span>
                      ) : (
                        <span className="text-xs text-dim">not in this period</span>
                      ),
                  },
                ]}
              />
              <div className="mt-4 border-t border-border pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">What the records cannot say</h3>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {report.coverage.retiredExcluded > 0 && (
                    <li>
                      {report.coverage.retiredExcluded} retired vehicle(s) are left out of every day: the program knows a
                      vehicle is retired, not the date it left, so dating it would be a guess.
                    </li>
                  )}
                  {report.coverage.workshopWithoutRecord > 0 && (
                    <li>
                      {report.coverage.workshopWithoutRecord} vehicle(s) the register calls &ldquo;in the workshop&rdquo; have no
                      work order, so there is nothing to date the days by. They are counted as idle here; raise a work order and
                      the days become downtime.
                    </li>
                  )}
                  {report.coverage.undatedOutOfService > 0 && (
                    <li>
                      {report.coverage.undatedOutOfService} vehicle(s) are off the road by a recording with no end date. Today
                      they are counted as out of service; their earlier days cannot be reconstructed.
                    </li>
                  )}
                  <li>
                    Hours are not measured at all. A run has stop times and a hire has dates; neither records how long a vehicle
                    was actually on the road, so utilisation is counted in days (Q-29).
                  </li>
                  <li>
                    The utilisation denominator counts every vehicle in service for every day of the period, as the agreed
                    definition does — so a vehicle registered halfway through the month still counts for the whole of it.
                  </li>
                  {report.coverage.bookedNotWorked > 0 && (
                    <li>
                      {report.coverage.bookedNotWorked} booked day(s) never had a start recorded. They are counted as booked,
                      not worked, even where the wheels may have moved.
                    </li>
                  )}
                </ul>
              </div>
            </TableCard>
          </>
        )}
      </div>
    </div>
  );
}
