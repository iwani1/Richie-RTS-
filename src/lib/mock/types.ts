/**
 * The data shapes the interface consumes.
 *
 * These types are the seam between the screens and where the numbers come from: today they are
 * filled from `overview.sample.ts`, later from Prisma queries behind the same shapes. A component
 * never imports sample data — it takes props.
 */

export type RangeKey = "today" | "week" | "month";

export type Trend = "up" | "down" | "flat";

export interface Kpi {
  /** Stable key, used for animation stagger and test hooks. */
  key: string;
  /** Mono caption above the number, e.g. "Active trips". */
  label: string;
  /** Already formatted: "128", "94.2%", "GH₵ 48,200". */
  value: string;
  /** Change against the previous comparable period, already formatted. */
  delta?: { value: string; trend: Trend; caption: string };
  /** Relative bar heights 0–100 for the sparkline, oldest first. Empty when there is no series. */
  series?: number[];
  /** Announced instead of the sparkline, which is decoration. */
  seriesLabel?: string;
}

export type UtilisationKey = "on_route" | "available" | "maintenance" | "reserved";

export interface UtilisationSlice {
  key: UtilisationKey;
  label: string;
  count: number;
}

export interface RingSummary {
  /** Percentage of the measured fleet that is on route, 0–100. */
  percent: number;
  caption: string;
  slices: UtilisationSlice[];
}

export type TripStatus = "on_route" | "boarding" | "delayed" | "scheduled" | "completed" | "cancelled";

export interface LiveTrip {
  id: string;
  route: string;
  driver: string;
  vehicle: string;
  status: TripStatus;
  /** Already formatted clock time, e.g. "14:32". Empty when the run has finished. */
  eta: string;
  /** Minutes late; 0 when on time. */
  delayMinutes: number;
}

export type ActivityKind = "dispatch" | "status" | "alert" | "finance" | "maintenance" | "system";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  /** What happened, in the operator's words. */
  title: string;
  /** Who or what did it. */
  actor: string;
  /** ISO timestamp; the feed formats it as a relative time. */
  at: string;
}

export interface FleetMarker {
  id: string;
  /** Position on the map canvas, 0–100 (percent). A real build reads lat/lng. */
  x: number;
  y: number;
  label: string;
  status: "moving" | "idle" | "alert";
}

export interface RouteLine {
  id: string;
  /** Polyline points on the map canvas, 0–100. */
  points: Array<[number, number]>;
}

export interface FleetMapData {
  markers: FleetMarker[];
  routes: RouteLine[];
  /** Shown under the map: what the picture is drawn from. */
  caption: string;
}

export interface OverviewData {
  /** Shown on the page and on every card: this build is a review, not the register. */
  sampleLabel: string;
  /**
   * The moment the payload was assembled. Relative times in the feed are measured from this, not
   * from the reader's clock, so the same payload always reads the same way.
   */
  capturedAt: string;
  company: string;
  operator: string;
  kpis: Kpi[];
  map: FleetMapData;
  ring: RingSummary;
  trips: LiveTrip[];
  activity: ActivityEntry[];
}
