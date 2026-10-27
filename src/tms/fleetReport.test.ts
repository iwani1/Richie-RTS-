// What the fleet did with its days (FLT-05, D-112).
//
// The counts have to add up: every vehicle-day in the period lands in exactly one bucket, and the
// figure the owner reads — utilisation — is worked days over the days the bus was ours and not in
// the workshop. The cases that matter are the ones where records disagree: a bus that worked and
// went into the workshop the same day, a repair finished but never released, a retired bus, a
// vehicle registered halfway through the month, and a day that was booked and never ran.
import { describe, expect, it } from "vitest";
import { currentMonthToDate, fleetDayBucket, fleetReport, fleetReportCsv, previousPeriod, FLEET_BUCKETS } from "./fleetReport";
import { emptyDatabase, migrate, SCHEMA_VERSION, type Database, type Rental, type Trip, type Vehicle, type WorkOrder } from "./types";

const at = "2026-01-01T06:00:00.000Z";

const vehicle = (id: string, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration: `GT ${id.toUpperCase()}`,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity: 30,
  status: "available",
  fuelType: "Diesel",
  ownership: "owned",
  ownerName: "",
  usualDriverId: null,
  photo: null,
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const trip = (id: string, serviceDate: string, vehicleId: string, overrides: Partial<Trip> = {}): Trip => ({
  id,
  reference: `TR-${id}`,
  routeId: "r1",
  serviceDate,
  status: "completed",
  origin: "schedule",
  originReason: null,
  vehicleId,
  driverId: "d1",
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: null,
  corrections: [],
  delays: [],
  rosterChanges: [],
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const rental = (id: string, vehicleId: string, startDate: string, endDate: string, overrides: Partial<Rental> = {}): Rental => ({
  id,
  reference: `RR-${id}`,
  clientId: null,
  customerName: "Ama Transport",
  customerPhone: "",
  customerEmail: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate,
  endDate,
  passengers: 12,
  vehicleCategoryId: "cat",
  driverRequired: true,
  notes: "",
  status: "confirmed",
  quote: null,
  quoteHistory: [],
  acceptance: null,
    run: null,
  assignedVehicleId: vehicleId,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: null,
  resolutionReason: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const workOrder = (id: string, vehicleId: string, overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id,
  reference: `WO-${id}`,
  vehicleId,
  title: "Brakes",
  workType: "Repair",
  workshop: "",
  description: "",
  reportedOdometer: null,
  plannedDate: null,
  incidentId: null,
  status: "in_progress",
  holdReason: null,
  completedAt: null,
  resetsServiceInterval: false,
  costEntries: [],
  costsConfirmedComplete: false,
  completionNote: null,
  releasedBy: null,
  releasedAt: null,
  log: [],
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

/**
 * Ten days in June. A is the fleet's workhorse; B arrives halfway through the month; C is sold;
 * D was taken off the road by hand; M is "in the workshop" with no work order behind it.
 */
function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    settings: {
      ...db.settings,
      currencyCode: "GHS",
      vehicleCategories: [{ id: "cat", name: "Coach", licenceClasses: [] }],
    },
    vehicles: [
      vehicle("a", { registration: "GT 1" }),
      vehicle("b", { registration: "GT 2", createdAt: "2026-06-06T07:00:00.000Z" }),
      vehicle("c", { registration: "GT 3", status: "retired" }),
      vehicle("d", { registration: "GT 4", status: "out_of_service" }),
      vehicle("m", { registration: "GT 5", status: "maintenance" }),
    ],
    trips: [
      trip("1", "2026-06-02", "a"),
      trip("2", "2026-06-03", "a", { status: "planned" }),
      trip("3", "2026-06-07", "b"),
      trip("4", "2026-06-02", "d"),
    ],
    rentals: [rental("1", "a", "2026-06-04", "2026-06-05"), rental("2", "b", "2026-06-06", "2026-06-06", { status: "in_progress" })],
    workOrders: [
      workOrder("1", "a", { createdAt: "2026-06-08T09:00:00.000Z", releasedAt: "2026-06-11T09:00:00.000Z" }),
    ],
    ...overrides,
  } as Database;
}

const FROM = "2026-06-01";
const TO = "2026-06-10";

describe("the fleet's days over a period", () => {
  it("puts every vehicle-day in exactly one bucket, and the buckets add up", () => {
    const report = fleetReport(world(), FROM, TO);
    const days = report.vehicleDays;
    expect(days.inFleet).toBe(35); // A 10, B 5 (registered on the 6th), D 10, M 10
    expect(days.worked).toBe(4); // A 2nd, B 6th and 7th, D 2nd
    expect(days.booked).toBe(3); // A planned on the 3rd, hire covering the 4th and 5th
    expect(days.workshop).toBe(3); // A raised on the 8th, released on the 11th
    expect(days.idle).toBe(25);
    expect(days.worked + days.booked + days.workshop + days.idle).toBe(days.inFleet);
    expect(report.dayCount).toBe(10);
  });

  it("states the approved utilisation: committed vehicle-days over the fleet in service", () => {
    const report = fleetReport(world(), FROM, TO);
    // Committed: A on the 2nd–5th, B on the 6th and 7th, D on the 2nd — 7 days. Available: the four
    // vehicles in service × ten days, which is the definition the owner approved (Q-29, D-78).
    expect(report.committedVehicleDays).toBe(7);
    expect(report.availableVehicleDays).toBe(40);
    expect(report.utilisation).toBeCloseTo(7 / 40, 10);
    expect(report.message).toMatch(/18% of the available vehicle-days were committed to work: 7 of 40/);
  });

  it("states the stricter measure beside it: days actually worked, not merely committed", () => {
    const report = fleetReport(world(), FROM, TO);
    // 4 worked of 32 serviceable vehicle-days (35 in the fleet less 3 in the workshop).
    expect(report.workedShare).toBeCloseTo(4 / 32, 10);
    expect(report.message).toMatch(/4 vehicle-day\(s\) were actually worked — 13% of the 32 serviceable day\(s\)/);
  });

  it("counts a day held by a run or hire as committed even when it never ran", () => {
    const report = fleetReport(world(), FROM, TO);
    // A's hire on the 4th and 5th is committed and booked, never worked.
    const a = report.byVehicle.find((row) => row.vehicleId === "a");
    expect(a?.committedDays).toBe(4);
    expect(a?.workedDays).toBe(1);
    expect(a?.bookedDays).toBe(3);
  });

  it("counts a day that was sold and never ran apart from idle, and says so", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.coverage.bookedNotWorked).toBe(3);
    expect(report.message).toMatch(/3 day\(s\) were booked and never ran/);
  });

  it("treats a repair that is finished but not released as downtime", () => {
    // The order has no releasedAt, so it still holds the vehicle on every later day of the period.
    const db = world({ workOrders: [workOrder("1", "a", { createdAt: "2026-06-08T09:00:00.000Z", completedAt: "2026-06-09T09:00:00.000Z" })] });
    const usage = fleetReport(db, FROM, TO).byVehicle.find((row) => row.vehicleId === "a");
    expect(usage?.workshopDays).toBe(3);
  });

  it("counts real work before a workshop day, so a bus that carried people is not hidden", () => {
    const db = world({
      workOrders: [workOrder("1", "a", { createdAt: "2026-06-01T09:00:00.000Z", releasedAt: "2026-06-10T09:00:00.000Z" })],
    });
    const usage = fleetReport(db, FROM, TO).byVehicle.find((row) => row.vehicleId === "a");
    // In the workshop from the 1st (released on the 10th, so the 10th is free), except the 2nd, when
    // the record says it carried people. The hire booked for the 4th–5th is inside the downtime, so
    // it is downtime here — the double booking is named on the vehicle register, not counted as work.
    expect(usage?.workedDays).toBe(1);
    expect(usage?.workshopDays).toBe(8);
    expect(usage?.bookedDays).toBe(0);
    expect(usage?.idleDays).toBe(1);
    // The hire in that downtime is still a committed day: utilisation counts what was allocated, the
    // buckets count what the day looked like.
    expect(usage?.committedDays).toBe(4);
  });

  it("leaves a retired vehicle out of every day, and says how many", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.byVehicle.some((row) => row.vehicleId === "c")).toBe(false);
    expect(report.coverage.retiredExcluded).toBe(1);
    expect(report.totals).toEqual({ vehicles: 5, inService: 4, retired: 1 });
    expect(report.message).toMatch(/retired vehicle\(s\) are left out of every day/);
  });

  it("counts a vehicle only from the day it was registered", () => {
    const usage = fleetReport(world(), FROM, TO).byVehicle.find((row) => row.vehicleId === "b");
    expect(usage?.inFleetDays).toBe(5);
    expect(usage?.lastWorkedOn).toBe("2026-06-07");
  });

  it("says which vehicles in the workshop have no work order to date the days by", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.coverage.workshopWithoutRecord).toBe(1);
    const usage = report.byVehicle.find((row) => row.vehicleId === "m");
    expect(usage?.workshopDays).toBe(0);
    expect(usage?.idleDays).toBe(10);
    expect(report.message).toMatch(/no work order, so their days cannot be dated/);
  });

  it("lists the idle vehicles first, because that is the row somebody acts on", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.byVehicle.map((row) => row.registration)).toEqual(["GT 5", "GT 4", "GT 1", "GT 2"]);
    expect(report.coverage.vehiclesWithNoWork).toBe(1);
  });

  it("puts no money on an idle day until the company supplies a daily cost", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.idleCost).toEqual({ perDay: null, currencyCode: "GHS", idleDays: 25, total: null });
    expect(report.message).toMatch(/no money on them/);
  });

  it("prices the idle days from the standing cost, in whole pesewas", () => {
    const db = world();
    const report = fleetReport({ ...db, settings: { ...db.settings, fleetStandingCostPerDay: 450.05 } }, FROM, TO);
    // 25 × 450.05 = 11,251.25 — not 11251.249999999998.
    expect(report.idleCost.total).toBe(11251.25);
    expect(report.message).toMatch(/25 idle day\(s\) at the standing cost set in Settings come to GHS 11251.25/);
  });

  it("has nothing to say about an empty register", () => {
    const report = fleetReport(emptyDatabase(), FROM, TO);
    expect(report.status).toBe("empty");
    expect(report.message).toMatch(/No vehicles are on the register/);
    expect(report.utilisation).toBe(null);
  });

  it("reads today from the same function the register uses", () => {
    const report = fleetReport(world(), FROM, TO);
    expect(report.today.total).toBe(5);
    expect(report.today.retired).toBe(1);
    expect(report.today.available + report.today.reserved + report.today.assigned + report.today.on_trip + report.today.pending_inspection + report.today.maintenance + report.today.out_of_service + report.today.retired).toBe(5);
  });

  it("refuses to walk more than two years, and says the figures were cut short", () => {
    const report = fleetReport(world(), "2020-01-01", "2026-06-10");
    expect(report.truncated).toBe(true);
    expect(report.dayCount).toBe(732);
    expect(report.message).toMatch(/longer than two years/);
  });
});

describe("the small helpers the screen leans on", () => {
  it("names one vehicle's day, in the same order the whole report uses", () => {
    const db = world();
    const a = db.vehicles.find((candidate) => candidate.id === "a")!;
    expect(fleetDayBucket(db, a, "2026-06-02")).toBe("worked");
    expect(fleetDayBucket(db, a, "2026-06-03")).toBe("booked");
    expect(fleetDayBucket(db, a, "2026-06-09")).toBe("workshop");
    expect(fleetDayBucket(db, a, "2026-06-01")).toBe("idle");
    // A day before it was registered is still "idle" for this helper: the report is what decides
    // whether the vehicle was in the fleet at all, and it does so by date.
    expect(FLEET_BUCKETS.map((bucket) => bucket.key)).toEqual(["worked", "booked", "workshop", "idle"]);
  });

  it("defaults the period to this month so far", () => {
    expect(currentMonthToDate("2026-06-14")).toEqual({ from: "2026-06-01", to: "2026-06-14" });
  });

  it("offers the previous period of the same length for comparison", () => {
    expect(previousPeriod("2026-06-01", "2026-06-10")).toEqual({ from: "2026-05-22", to: "2026-05-31" });
    expect(previousPeriod("2026-06-10", "2026-06-01")).toBe(null);
  });
});

describe("a backup written before the dashboard existed", () => {
  it("has no standing cost, so no idle day is priced until somebody sets one", () => {
    const old = emptyDatabase();
    const migrated = migrate({ ...old, schemaVersion: 29, settings: { ...old.settings } as typeof old.settings });
    expect(migrated?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated?.settings.fleetStandingCostPerDay).toBeNull();
  });

  it("keeps a standing cost that is already recorded", () => {
    const old = emptyDatabase();
    const migrated = migrate({
      ...old,
      schemaVersion: 29,
      settings: { ...old.settings, fleetStandingCostPerDay: 300 } as typeof old.settings,
    });
    expect(migrated?.settings.fleetStandingCostPerDay).toBe(300);
  });
});

describe("handing the dashboard to a spreadsheet (RPT-04, D-113)", () => {
  it("writes the figures and then one row per vehicle", () => {
    const csv = fleetReportCsv(fleetReport(world(), FROM, TO));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Metric,Value,Note");
    expect(csv).toContain("Committed vehicle-days,7,a run or hire held the vehicle that day");
    expect(csv).toContain('Utilisation,17.5%,"committed / available (Q-29, D-78)"');
    expect(csv).toContain("Cost of idle days,not priced,idle days × the standing cost");
    // The per-vehicle block: idle days first, as on the screen.
    const header = lines.findIndex((line) => line.startsWith("Vehicle,Category,Days in fleet"));
    expect(header).toBeGreaterThan(0);
    expect(lines[header + 1]).toBe("GT 5,Coach,10,0,0,0,0,10,not in this period");
    expect(lines).toHaveLength(header + 5);
  });

  it("writes the money once somebody has supplied the standing cost", () => {
    const db = world();
    const csv = fleetReportCsv(fleetReport({ ...db, settings: { ...db.settings, fleetStandingCostPerDay: 450.05 } }, FROM, TO));
    expect(csv).toContain("Standing cost per vehicle-day,GHS 450.05,set in Settings → Fleet");
    expect(csv).toContain("Cost of idle days,GHS 11251.25,idle days × the standing cost");
  });
});
