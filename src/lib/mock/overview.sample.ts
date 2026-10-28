import type { ActivityEntry, Kpi, LiveTrip, OverviewData, RangeKey, RingSummary } from "./types";

/**
 * SAMPLE DATA — for the interface review only.
 *
 * Nothing here is a record, and nothing here is read from the database. The application's real
 * records live behind sign-in at `/`; this file exists so the design system can be judged before
 * the feature screens are rebuilt on it. Every screen that renders it says so, and the shapes are
 * the ones a Prisma query will fill later.
 */

const todayKpis: Kpi[] = [
  {
    key: "active_trips",
    label: "Active trips",
    value: "18",
    delta: { value: "3", trend: "up", caption: "vs yesterday" },
    series: [34, 42, 38, 55, 61, 58, 72],
    seriesLabel: "Seven service days, oldest first: 34, 42, 38, 55, 61, 58, 72 runs.",
  },
  {
    key: "available_vehicles",
    label: "Available vehicles",
    value: "7",
    delta: { value: "2", trend: "down", caption: "2 in the workshop" },
    series: [64, 58, 66, 52, 49, 55, 47],
    seriesLabel: "Seven service days, oldest first: 64, 58, 66, 52, 49, 55, 47 per cent available.",
  },
  {
    key: "on_time_rate",
    label: "On-time rate",
    value: "94.2%",
    delta: { value: "1.4", trend: "up", caption: "vs last week" },
    series: [88, 90, 87, 92, 93, 94, 94],
    seriesLabel: "Seven service days, oldest first: 88, 90, 87, 92, 93, 94, 94 per cent on time.",
  },
  {
    key: "monthly_revenue",
    label: "Revenue, month to date",
    value: "GH₵ 48,200",
    delta: { value: "6.8%", trend: "up", caption: "vs last month" },
    series: [41, 44, 42, 47, 46, 49, 52],
    seriesLabel: "Seven service days, oldest first: 41, 44, 42, 47, 46, 49, 52 thousand cedis.",
  },
];

const weekKpis: Kpi[] = [
  {
    key: "active_trips",
    label: "Trips this week",
    value: "126",
    delta: { value: "12", trend: "up", caption: "vs last week" },
    series: [92, 104, 98, 118, 121, 119, 126],
    seriesLabel: "Seven weeks, oldest first: 92, 104, 98, 118, 121, 119, 126 trips.",
  },
  {
    key: "available_vehicles",
    label: "Available vehicles",
    value: "8",
    delta: { value: "1", trend: "up", caption: "1 back from service" },
    series: [52, 49, 55, 58, 61, 57, 64],
    seriesLabel: "Seven weeks, oldest first: 52, 49, 55, 58, 61, 57, 64 per cent available.",
  },
  {
    key: "on_time_rate",
    label: "On-time rate",
    value: "92.8%",
    delta: { value: "0.6", trend: "down", caption: "vs last week" },
    series: [91, 93, 92, 94, 93, 93, 93],
    seriesLabel: "Seven weeks, oldest first: 91, 93, 92, 94, 93, 93, 93 per cent on time.",
  },
  {
    key: "monthly_revenue",
    label: "Revenue, month to date",
    value: "GH₵ 48,200",
    delta: { value: "6.8%", trend: "up", caption: "vs last month" },
    series: [41, 44, 42, 47, 46, 49, 52],
    seriesLabel: "Seven weeks, oldest first: 41, 44, 42, 47, 46, 49, 52 thousand cedis.",
  },
];

const monthKpis: Kpi[] = [
  {
    key: "active_trips",
    label: "Trips this month",
    value: "512",
    delta: { value: "38", trend: "up", caption: "vs last month" },
    series: [430, 452, 468, 471, 489, 501, 512],
    seriesLabel: "Seven months, oldest first: 430, 452, 468, 471, 489, 501, 512 trips.",
  },
  {
    key: "available_vehicles",
    label: "Available vehicles",
    value: "9",
    delta: { value: "2", trend: "up", caption: "avg. over the month" },
    series: [48, 51, 55, 57, 60, 62, 64],
    seriesLabel: "Seven months, oldest first: 48, 51, 55, 57, 60, 62, 64 per cent available.",
  },
  {
    key: "on_time_rate",
    label: "On-time rate",
    value: "93.5%",
    delta: { value: "0.9", trend: "up", caption: "vs last month" },
    series: [90, 91, 92, 92, 93, 93, 94],
    seriesLabel: "Seven months, oldest first: 90, 91, 92, 92, 93, 93, 94 per cent on time.",
  },
  {
    key: "monthly_revenue",
    label: "Revenue, month to date",
    value: "GH₵ 48,200",
    delta: { value: "6.8%", trend: "up", caption: "vs last month" },
    series: [41, 44, 42, 47, 46, 49, 52],
    seriesLabel: "Seven months, oldest first: 41, 44, 42, 47, 46, 49, 52 thousand cedis.",
  },
];

export const kpisFor = (range: RangeKey): Kpi[] =>
  range === "week" ? weekKpis : range === "month" ? monthKpis : todayKpis;

const ring: RingSummary = {
  percent: 64,
  caption: "14 of 22 vehicles are on route. Read from today's trip sheets.",
  slices: [
    { key: "on_route", label: "On route", count: 14 },
    { key: "available", label: "Available", count: 5 },
    { key: "maintenance", label: "Maintenance", count: 3 },
  ],
};

const trips: LiveTrip[] = [
  { id: "TRP-2418", route: "East Legon → Airport", driver: "Kojo Mensah", vehicle: "GT 4821-24", status: "on_route", eta: "14:32", delayMinutes: 0 },
  { id: "TRP-2419", route: "Tema Community 1 → Tema Port", driver: "Adjoa Yeboah", vehicle: "GW 1194-23", status: "on_route", eta: "14:40", delayMinutes: 0 },
  { id: "TRP-2421", route: "Madina → Ridge", driver: "Samuel Botchwey", vehicle: "GR 5502-22", status: "delayed", eta: "14:52", delayMinutes: 9 },
  { id: "TRP-2423", route: "Achimota → Airport Residential", driver: "Efua Kumi", vehicle: "GE 2201-25", status: "boarding", eta: "15:05", delayMinutes: 0 },
  { id: "TRP-2424", route: "Kasoa → Weija", driver: "Yaw Dartey", vehicle: "GS 7710-21", status: "on_route", eta: "15:18", delayMinutes: 0 },
  { id: "TRP-2426", route: "Spintex → Tema Industrial", driver: "Not assigned", vehicle: "GT 5540-24", status: "scheduled", eta: "16:00", delayMinutes: 0 },
  { id: "TRP-2412", route: "Osu → Labone", driver: "Nana Adu", vehicle: "GX 3391-20", status: "completed", eta: "", delayMinutes: 0 },
  { id: "TRP-2410", route: "Dansoman → Accra Central", driver: "Kwesi Owusu", vehicle: "GR 1188-19", status: "cancelled", eta: "", delayMinutes: 0 },
];

// Offsets in minutes behind the payload's capture time, so the feed reads the way it would on a
// working morning however long after this file was written it is opened. Nothing here is a record.
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const activity: ActivityEntry[] = [
  { id: "a1", kind: "dispatch", title: "TRP-2418 left the yard for East Legon", actor: "Kojo Mensah", at: minutesAgo(9) },
  { id: "a2", kind: "alert", title: "TRP-2421 reported 9 minutes behind at Madina", actor: "Samuel Botchwey", at: minutesAgo(24) },
  { id: "a3", kind: "status", title: "GT 5540-24 released from the workshop", actor: "Ama Boateng", at: minutesAgo(51) },
  { id: "a4", kind: "finance", title: "INV-2026-0142 settled in full", actor: "Finance desk", at: minutesAgo(76) },
  { id: "a5", kind: "maintenance", title: "Work order WO-0091 raised for GR 5502-22", actor: "Yaw Dartey", at: minutesAgo(152) },
  { id: "a6", kind: "system", title: "Route RT-014 timetable changed for the 06:30 run", actor: "Ama Boateng", at: minutesAgo(235) },
];

export function overviewSample(range: RangeKey): OverviewData {
  return {
    sampleLabel: "Sample data — not records",
    capturedAt: new Date().toISOString(),
    company: "Richie Transport Services",
    operator: "Ama Boateng",
    kpis: kpisFor(range),
    map: {
      caption: "Illustrative positions. No vehicle in this build reports a live location.",
      routes: [
        { id: "r1", points: [[18, 62], [28, 55], [38, 58], [48, 47], [58, 44], [68, 36], [78, 30]] },
        { id: "r2", points: [[22, 74], [33, 70], [44, 72], [55, 64], [66, 60], [74, 52]] },
        { id: "r3", points: [[52, 82], [58, 70], [63, 58], [70, 48], [80, 44]] },
      ],
      markers: [
        { id: "GT 4821-24", x: 38, y: 58, label: "TRP-2418 · on route", status: "moving" },
        { id: "GW 1194-23", x: 66, y: 60, label: "TRP-2419 · on route", status: "moving" },
        { id: "GR 5502-22", x: 58, y: 44, label: "TRP-2421 · 9 min late", status: "alert" },
        { id: "GE 2201-25", x: 28, y: 55, label: "TRP-2423 · boarding", status: "idle" },
      ],
    },
    ring,
    trips,
    activity,
  };
}
