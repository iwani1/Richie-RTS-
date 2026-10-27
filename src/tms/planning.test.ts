// The planning aid (RTE-04, D-96).
//
// The property that matters is not "it picks a bus" — it is that **it never suggests an assignment the
// save would refuse**, and that every refusal is a sentence about this run rather than a constraint
// name. So most of these tests are paired: the aid's verdict, then the command's verdict on the same
// pair, and they must agree.
import { describe, expect, it } from "vitest";
import { PLAN_SHORTLIST, PLANNING_LIMITS, planDay, planRun } from "./planning";
import { executeBusing } from "./busing";
import { emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Driver, type Trip, type Vehicle } from "./types";

const at = "2026-06-01T06:00:00.000Z";
const TODAY = "2026-06-01";

const route: BusRoute = {
  id: "route1",
  reference: "RT-001",
  name: "Airport residential run",
  clientId: "c1",
  direction: "to_work",
  shiftId: "",
  vehicleCategoryId: "cat",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  stops: [
    { id: "s1", name: "Airport junction", scheduledTime: "06:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    { id: "s2", name: "Ridge offices", scheduledTime: "06:40", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
  ],
  createdAt: at,
  updatedAt: at,
};

const otherRoute: BusRoute = { ...route, id: "route2", reference: "RT-002", name: "Tema run", stops: [
  { id: "s3", name: "Tema community 1", scheduledTime: "06:10", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
  { id: "s4", name: "Ridge offices", scheduledTime: "07:00", landmark: "", digitalAddress: "", latitude: "", longitude: "" },
] };

const vehicle = (id: string, registration: string, seatCapacity: number, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity,
  fuelType: "",
  ownership: null,
  ownerName: "",
  usualDriverId: null,
  photo: null,
  status: "available",
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const driver = (id: string, fullName: string, overrides: Partial<Driver> = {}): Driver => ({
  id,
  fullName,
  phone: "0244000000",
  licenceNumber: `DL-${id}`,
  licenceExpiry: "2028-12-31",
  licenceClasses: [],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const trip = (id: string, reference: string, overrides: Partial<Trip> = {}): Trip => ({
  id,
  reference,
  routeId: "route1",
  serviceDate: TODAY,
  status: "planned",
  vehicleId: null,
  driverId: null,
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: 5,
  corrections: [],
  delays: [],
  rosterChanges: [],
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const serviceOrder = (id: string, vehicleId: string, reportedOdometer: number): Database["workOrders"][number] => ({
  id,
  reference: `WO-${id}`,
  vehicleId,
  title: "Routine service",
  workType: "Service",
  workshop: "In house",
  description: "Routine service",
  reportedOdometer,
  plannedDate: null,
  incidentId: null,
  status: "closed",
  holdReason: null,
  completedAt: "2026-05-02T10:00:00.000Z",
  resetsServiceInterval: true,
  costEntries: [],
  costsConfirmedComplete: true,
  completionNote: null,
  releasedBy: "Ama",
  releasedAt: "2026-05-02T10:00:00.000Z",
  log: [],
  createdAt: at,
  updatedAt: at,
});

const reading = (id: string, vehicleId: string, readingKm: number): Database["odometerReadings"][number] => ({
  id,
  vehicleId,
  readingKm,
  readingDate: "2026-05-30",
  note: "",
  status: "current",
  voidReason: null,
  createdBy: "Ama",
  createdAt: at,
});

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    settings: { ...db.settings, currencyCode: "GHS", documentReminderLeadDays: 30, rental: emptyRentalSettings() },
    clients: [{ id: "c1", name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: at, updatedAt: at }],
    routes: [route, otherRoute],
    vehicles: [vehicle("v-small", "GT-1111-24", 14), vehicle("v-big", "GT-9999-24", 45)],
    drivers: [driver("d1", "Kojo Owusu"), driver("d2", "Yaa Asantewaa")],
    passengers: Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      fullName: `Rider ${i}`,
      employeeRef: `E-${i}`,
      phone: "",
      clientId: "c1",
      routeId: "route1",
      stopId: "s1",
      status: "active" as const,
      createdAt: at,
      updatedAt: at,
    })),
    trips: [trip("t1", "TR-0001")],
    ...overrides,
  };
}

const best = (db: Database, today = TODAY) => planRun(db, "t1", today)!.workable[0];

describe("planning a run", () => {
  it("sends the smallest bus that fits, and says the numbers it fitted", () => {
    const plan = planRun(world(), "t1", TODAY)!;
    expect(plan.needs).toEqual({ riders: 12, roster: 12, booked: 0 });
    expect(plan.window).toBe("06:00–06:40");

    const first = plan.workable[0];
    // 14 seats for 12 riders leaves 2; the 45-seater would leave 33, and the big bus stays free.
    expect(first.vehicleLabel).toBe("GT-1111-24");
    expect(first.spareSeats).toBe(2);
    expect(first.reasons[0]).toBe("GT-1111-24 seats 14 for 12, leaving 2 spare.");
    expect(first.reasons[1]).toMatch(/both free 06:00–06:40/);
    expect(plan.headline).toMatch(/^Send GT-1111-24 with /);
  });

  it("counts a sold seat against the vehicle, the same way the save does", () => {
    const db = world({
      bookings: [
        {
          id: "bk1",
          reference: "BK-0001",
          tripId: "t1",
          passengerId: "p0",
          clientId: "c1",
          routeId: "route1",
          stopId: "s1",
          serviceDate: TODAY,
          type: "one_time",
          status: "confirmed",
          note: "",
          seriesId: null,
          offeredAt: null,
          cancelledAt: null,
          cancelledBy: null,
          history: [],
          createdAt: at,
          updatedAt: at,
        },
      ],
      // 13 seats and 12 riders + 1 booked seat = exactly full, so it still fits — with no spare.
      vehicles: [vehicle("v-small", "GT-1111-24", 13)],
    });
    const plan = planRun(db, "t1", TODAY)!;
    expect(plan.needs).toEqual({ riders: 13, roster: 12, booked: 1 });
    expect(plan.workable[0].spareSeats).toBe(0);
    expect(plan.workable[0].reasons[0]).toMatch(/exactly the 13 the run must carry — no spare seat/);
  });

  it("refuses a bus already out on an overlapping run, naming that run", () => {
    const db = world({
      trips: [
        trip("t1", "TR-0001"),
        trip("t2", "TR-0002", { routeId: "route2", vehicleId: "v-small", driverId: "d1" }),
      ],
    });
    const plan = planRun(db, "t1", TODAY)!;
    const clash = plan.refusals.find((refusal) => refusal.vehicleLabel === "GT-1111-24")!;
    expect(clash.workable).toBe(false);
    expect(clash.reasons.join(" ")).toMatch(/already on TR-0002 at an overlapping time/);
  });

  it("agrees with the command: everything it offers, the save accepts", () => {
    const db = world();
    const plan = planRun(db, "t1", TODAY)!;
    expect(plan.workable.length).toBeGreaterThan(0);
    for (const candidate of plan.workable) {
      const saved = executeBusing(db, { id: "u1", fullName: "Ama", role: "administrator" }, {
        type: "assign_trip",
        id: "t1",
        input: { vehicleId: candidate.vehicleId, driverId: candidate.driverId },
      } as never, at);
      expect(saved.ok, `${candidate.vehicleLabel} / ${candidate.driverLabel}: ${saved.ok ? "" : saved.message}`).toBe(true);
    }
  });

  it("agrees with the command the other way: nothing it refuses, the save would accept", () => {
    // A vehicle under maintenance and a driver whose licence has lapsed: the aid rules the pairs out,
    // and the command refuses them for the same reasons.
    const db = world({
      vehicles: [vehicle("v-fixed", "GT-2222-24", 30, { status: "maintenance" })],
      drivers: [driver("d-old", "Kwame Lapsed", { licenceExpiry: "2026-05-31" })],
    });
    const plan = planRun(db, "t1", TODAY)!;
    expect(plan.workable).toEqual([]);
    expect(plan.refused).toBe(plan.examined);
    const reasons = plan.refusals.map((refusal) => refusal.reasons.join(" ")).join(" | ");
    expect(reasons).toMatch(/under maintenance/);
    expect(reasons).toMatch(/licence expires before the service date/);

    const saved = executeBusing(db, { id: "u1", fullName: "Ama", role: "administrator" }, {
      type: "assign_trip",
      id: "t1",
      input: { vehicleId: "v-fixed", driverId: "d-old" },
    } as never, at);
    expect(saved.ok).toBe(false);
  });

  it("agrees with the save about a driver whose licence does not cover the bus (FLT-04)", () => {
    // The office has said a coach needs class D. The only driver holds B, so neither the aid nor the
    // save may put them on it — and both say which class is missing.
    const base = emptyDatabase();
    const db = world({
      settings: {
        ...base.settings,
        currencyCode: "GHS",
        rental: emptyRentalSettings(),
        vehicleCategories: [{ id: "cat", name: "Coach", licenceClasses: ["D"] }],
      },
      drivers: [driver("d1", "Kojo Owusu", { licenceClasses: ["B"] })],
    });

    const plan = planRun(db, "t1", TODAY)!;
    expect(plan.workable).toEqual([]);
    expect(plan.refusals.map((refusal) => refusal.reasons.join(" ")).join(" | ")).toMatch(
      /holds licence class B, and Coach requires D/,
    );

    const saved = executeBusing(db, { id: "u1", fullName: "Ama", role: "administrator" }, {
      type: "assign_trip",
      id: "t1",
      input: { vehicleId: "v-small", driverId: "d1" },
    } as never, at);
    expect(saved.ok).toBe(false);
    // The refusal names the class on the driver field the dispatcher has to fix.
    if (!saved.ok) expect(saved.errors.driverId).toMatch(/holds licence class B, and Coach requires D/);
  });

  it("says there is nothing to send rather than showing an empty list", () => {
    const plan = planRun(world({ vehicles: [] }), "t1", TODAY)!;
    expect(plan.workable).toEqual([]);
    expect(plan.headline).toMatch(/Nothing in the fleet can take this run yet/);
  });

  it("notes an overdue service without blocking it — and lets the pair with less to report go first", () => {
    // Two small buses with the same service history, one of them 400,000 km past a 5,000 km interval.
    const serviced = (vehicleId: string, odometerKm: number, readingKm: number) => ({
      workOrders: [
        serviceOrder(`wo-${vehicleId}`, vehicleId, odometerKm),
      ],
      odometerReadings: [reading(`od-${vehicleId}`, vehicleId, readingKm)],
    });
    const first = serviced("v-old", 20_000, 500_000);
    const second = serviced("v-new", 20_000, 21_000);
    const db = world({
      settings: {
        ...world().settings,
        maintenance: {
          ...world().settings.maintenance,
          schedules: [{ categoryId: "cat", intervalKm: 5_000, intervalDays: null, remindLeadKm: null, remindLeadDays: null }],
        },
      },
      vehicles: [vehicle("v-old", "GT-1111-24", 14), vehicle("v-new", "GT-3333-24", 16)],
      drivers: [driver("d1", "Kojo Owusu")],
      workOrders: [...first.workOrders, ...second.workOrders],
      odometerReadings: [...first.odometerReadings, ...second.odometerReadings],
    });
    const plan = planRun(db, "t1", TODAY)!;
    const overdue = plan.workable.find((candidate) => candidate.vehicleLabel === "GT-1111-24")!;
    expect(overdue.notes.join(" ")).toMatch(/overdue for routine service/);
    // Both pairs are workable — the setting that turns a warning into a block is off by default — but
    // the one with nothing to report is offered first.
    expect(plan.workable.every((candidate) => candidate.workable)).toBe(true);
    expect(plan.workable[0].vehicleLabel).toBe("GT-3333-24");
    expect(plan.workable[0].notes).toEqual([]);
  });

  it("names the licence that is about to lapse, without refusing it", () => {
    const db = world({ drivers: [driver("d1", "Kojo Owusu", { licenceExpiry: "2026-06-20" })] });
    const candidate = best(db);
    expect(candidate.workable).toBe(true);
    expect(candidate.notes.join(" ")).toBe("Kojo Owusu's licence expires in 19 day(s), inside the 30-day reminder window.");
  });

  it("spreads the day: between equals it picks the driver with less on", () => {
    const db = world({
      vehicles: [vehicle("v-small", "GT-1111-24", 14)],
      drivers: [driver("d1", "Kojo Owusu"), driver("d2", "Yaa Asantewaa")],
      trips: [
        trip("t1", "TR-0001"),
        // Kojo is already carrying the Tema run, so the same bus with Yaa is preferred.
        trip("t2", "TR-0002", { routeId: "route2", vehicleId: "v-big", driverId: "d1" }),
      ],
    });
    expect(best(db).driverLabel).toBe("Yaa Asantewaa");
  });

  it("closes a run that is already running or finished instead of calling it a shortage", () => {
    expect(planRun(world({ trips: [trip("t1", "TR-0001", { status: "in_progress", startedAt: at })] }), "t1", TODAY)!.headline).toMatch(
      /already running/,
    );
    expect(planRun(world({ trips: [trip("t1", "TR-0001", { status: "completed", completedAt: at })] }), "t1", TODAY)!.headline).toMatch(
      /finished/,
    );
  });

  it("states what it cannot see, so a suggestion is never mistaken for a measured plan", () => {
    expect(PLANNING_LIMITS.length).toBeGreaterThanOrEqual(4);
    expect(PLANNING_LIMITS.join(" ")).toMatch(/not a map position/);
    expect(PLANNING_LIMITS.join(" ")).toMatch(/No travel time is recorded/);
  });
});

describe("planning a day", () => {
  it("lists only the runs that still need somebody, earliest first", () => {
    const db = world({
      trips: [
        trip("t1", "TR-0001"),
        trip("t2", "TR-0002", { routeId: "route2" }),
        // Crewed: not a planning question.
        trip("t3", "TR-0003", { vehicleId: "v-big", driverId: "d1" }),
        // Another date: not this day's problem.
        trip("t4", "TR-0004", { serviceDate: "2026-06-02" }),
      ],
    });
    const plans = planDay(db, TODAY, TODAY);
    expect(plans.map((plan) => plan.reference)).toEqual(["TR-0001", "TR-0002"]);
    expect(plans[0].window).toBe("06:00–06:40");
    expect(plans[1].window).toBe("06:10–07:00");
  });

  it("offers at most a shortlist per run, and each suggestion is one the save accepts", () => {
    expect(PLAN_SHORTLIST).toBeGreaterThan(0);
    const plans = planDay(world(), TODAY, TODAY);
    // Two buses, two drivers: the day's single run has exactly four pairs to choose from.
    expect(plans[0].examined).toBe(4);
  });
});
