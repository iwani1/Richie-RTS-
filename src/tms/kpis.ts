// KPI calculations. Each result carries its reporting period, data coverage and an explicit
// status so the UI never shows a number without its inputs (Integrity rule 4).
// Definitions are proposals pending management confirmation; see docs/KPIS.md.

import { tripOnTime } from "./busing";
import type { Database } from "./types";

export interface OnTimeReport {
  from: string;
  to: string;
  scheduled: number; // trips in the period that are not cancelled
  completed: number; // completed trips in the period
  timed: number; // completed trips that have a threshold snapshot
  onTime: number;
  rate: number | null; // onTime / timed, 0..1
  coverage: number | null; // completed / scheduled, 0..1
  status: "ok" | "insufficient_data" | "threshold_not_set";
  message: string;
}

export function onTimeReport(db: Database, from: string, to: string): OnTimeReport {
  const inPeriod = db.trips.filter((t) => t.serviceDate >= from && t.serviceDate <= to);
  const scheduled = inPeriod.filter((t) => t.status !== "cancelled").length;
  const completedTrips = inPeriod.filter((t) => t.status === "completed");
  const timedTrips = completedTrips.filter((t) => t.onTimeThresholdMinutes !== null);
  const coverage = scheduled > 0 ? completedTrips.length / scheduled : null;
  const base = { from, to, scheduled, completed: completedTrips.length, coverage };

  if (from > to)
    return { ...base, timed: 0, onTime: 0, rate: null, status: "insufficient_data", message: "The reporting period is invalid (from is after to)." };
  if (completedTrips.length === 0)
    return { ...base, timed: 0, onTime: 0, rate: null, status: "insufficient_data", message: "No trips have been completed in this period, so no on-time rate can be computed." };
  if (timedTrips.length === 0)
    return {
      ...base,
      timed: 0,
      onTime: 0,
      rate: null,
      status: "threshold_not_set",
      message: "The on-time threshold was not set when these trips were completed (OPEN_QUESTIONS Q-06). Completed trips are not re-judged retrospectively.",
    };

  let onTime = 0;
  for (const trip of timedTrips) {
    const route = db.routes.find((r) => r.id === trip.routeId);
    if (route && tripOnTime(trip, route, trip.onTimeThresholdMinutes as number)) onTime += 1;
  }
  const excluded = completedTrips.length - timedTrips.length;
  return {
    ...base,
    timed: timedTrips.length,
    onTime,
    rate: onTime / timedTrips.length,
    status: "ok",
    message: excluded > 0 ? `${excluded} completed trip(s) were finished before the threshold was set and are excluded.` : "",
  };
}
