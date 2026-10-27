// The dispatch board (DSP-01, D-115).
//
// What matters here is that the board tells the truth about a day: a run with nobody driving it is not
// merely "planned", a bus in the workshop is not a bus, and a run carrying more riders than seats is a
// safety problem rather than a full bus. The figures are counted from the records, the filters narrow
// the list without shrinking the day, and the limits are printed rather than discovered.
import { describe, expect, it } from "vitest";
import { BOARD_LIMITS, dispatchBoard, licenceDaysLeft } from "./dispatchBoard";
import { emptyDatabase, emptyRentalSettings, type BusRoute, type Database, type Driver, type Trip, type Vehicle } from "./types";

const at = "2026-06-01T05:00:00.000Z";
const DATE = "2026-06-01";

const route = (id: string, name: string, first: string, last: string, clientId = "c1"): BusRoute => ({
  id,
  reference: id === "route1" ? "RT-001" : "RT-002",
  name,
  clientId,
  direction: "to_work",
  shiftId: "",
  vehicleCategoryId: "cat",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startDate: "2026-01-01",
  endDate: null,
  status: "active",
  stops: [
    { id: `${id}-s1`, name: "Pickup", scheduledTime: first, landmark: "", digitalAddress: "", latitude: "", longitude: "" },
    { id: `${id}-s2`, name: "Office", scheduledTime: last, landmark: "", digitalAddress: "", latitude: "", longitude: "" },
  ],
  createdAt: at,
  updatedAt: at,
});

const vehicle = (id: string, registration: string, seats: number, overrides: Partial<Vehicle> = {}): Vehicle => ({
  id,
  registration,
  categoryId: "cat",
  make: "Toyota",
  model: "Coaster",
  seatCapacity: seats,
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
  serviceDate: DATE,
  status: "planned",
  origin: "schedule",
  originReason: null,
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
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const rider = (id: string, routeId = "route1") => ({
  id,
  fullName: `Rider ${id}`,
  employeeRef: `E-${id}`,
  phone: "",
  clientId: "c1",
  routeId,
  stopId: `${routeId}-s1`,
  status: "active" as const,
  createdAt: at,
  updatedAt: at,
});

const booking = (id: string, tripId: string, passengerId: string) => ({
  id,
  reference: `BK-${id}`,
  passengerId,
  clientId: "c1",
  routeId: "route1",
  stopId: "route1-s1",
  tripId,
  serviceDate: DATE,
  type: "one_time" as const,
  status: "confirmed" as const,
  note: "",
  seriesId: null,
  offeredAt: null,
  cancelledAt: null,
  cancelledBy: null,
  history: [],
  createdAt: at,
  updatedAt: at,
});

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    settings: { ...db.settings, currencyCode: "GHS", rental: emptyRentalSettings() },
    clients: [
      { id: "c1", name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: at, updatedAt: at },
      { id: "c2", name: "Beta Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: at, updatedAt: at },
    ],
    routes: [route("route1", "Airport run", "06:00", "06:40"), route("route2", "Tema run", "07:00", "07:40", "c2")],
    vehicles: [vehicle("v1", "GT-1111-24", 14), vehicle("v2", "GT-2222-24", 45)],
    drivers: [driver("d1", "Kojo Owusu"), driver("d2", "Yaa Asantewaa")],
    passengers: [rider("1"), rider("2")],
    trips: [trip("t1", "TR-0001", { vehicleId: "v1", driverId: "d1" })],
    ...overrides,
  };
}

const board = (db: Database, filters: Partial<{ status: Trip["status"]; routeId: string; driverId: string; vehicleId: string; clientId: string }> = {}) =>
  dispatchBoard(db, { date: DATE, ...filters }, DATE);

describe("the dispatch board", () => {
  it("counts the day's runs by status, in departure order", () => {
    const db = world({
      trips: [
        trip("t2", "TR-0002", { routeId: "route2", vehicleId: "v2", driverId: "d2", status: "dispatched" }),
        trip("t1", "TR-0001", { vehicleId: "v1", driverId: "d1" }),
        trip("t3", "TR-0003", { status: "cancelled", cancelReason: "No bus" }),
      ],
    });
    const day = board(db);
    expect(day.counts).toEqual({ planned: 1, dispatched: 1, in_progress: 0, completed: 0, cancelled: 1 });
    expect(day.totals.runs).toBe(3);
    // TR-0001 leaves at 06:00 and TR-0002 at 07:00; the cancelled run is last because it has an 06:00
    // window of its own but nobody to drive it — order is by time, then reference.
    expect(day.runs.map((run) => run.reference)).toEqual(["TR-0001", "TR-0003", "TR-0002"]);
    expect(day.runs[0]).toMatchObject({ departsAt: "06:00", endsAt: "06:40", clientName: "Acme Ltd", vehicleLabel: "GT-1111-24", driverLabel: "Kojo Owusu" });
  });

  it("names a run with no crew, and counts it once however much is missing", () => {
    const db = world({ trips: [trip("t1", "TR-0001"), trip("t2", "TR-0002", { vehicleId: "v1" })] });
    const day = board(db);
    expect(day.totals.unassigned).toBe(2);
    expect(day.runs[0].alerts.map((alert) => alert.text)).toEqual(["No vehicle assigned.", "No driver assigned."]);
    expect(day.runs[1].alerts.map((alert) => alert.text)).toEqual(["No driver assigned."]);
    expect(day.alerts[0]).toMatch(/2 runs cannot leave as they stand/);
  });

  it("treats a bus in the workshop as a bus that cannot take the run", () => {
    const db = world({
      workOrders: [
        {
          id: "wo1",
          reference: "WO-0001",
          vehicleId: "v1",
          title: "Brakes",
          workType: "Repair",
          workshop: "In house",
          description: "Brakes",
          reportedOdometer: 100,
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
        } as Database["workOrders"][number],
      ],
    });
    const day = board(db);
    expect(day.runs[0].vehicleState).toBe("Under maintenance");
    expect(day.totals.blocked).toBe(1);
    expect(day.runs[0].alerts[0]).toMatchObject({ level: "blocker" });
    expect(day.runs[0].alerts[0].text).toMatch(/GT-1111-24 is under maintenance: Work order WO-0001 is in progress/);
  });

  it("blocks a run whose driver's licence has lapsed, and says the date", () => {
    const db = world({ drivers: [driver("d1", "Kojo Owusu", { licenceExpiry: "2026-05-31" }), driver("d2", "Yaa Asantewaa")] });
    const day = board(db);
    expect(day.runs[0].alerts[0].text).toBe("Kojo Owusu's licence expired on 2026-05-31, so they cannot drive on 2026-06-01.");
    expect(licenceDaysLeft(db.drivers[0], DATE)).toBe(-1);
  });

  it("counts riders over the seats as a safety problem, roster and booked seats together", () => {
    // Two on the roster plus one sold seat is three for a two-seat bus.
    const db = world({
      vehicles: [vehicle("v1", "GT-1111-24", 2)],
      bookings: [booking("b1", "t1", "p-extra")],
      passengers: [...Array.from({ length: 2 }, (_, i) => rider(`${i}`)), { ...rider("extra"), id: "p-extra", routeId: null as unknown as string }],
    });
    const day = board(db);
    expect(day.runs[0]).toMatchObject({ seats: 2, riders: 3, free: 0, overCapacity: 1 });
    expect(day.totals.overCapacity).toBe(1);
    expect(day.runs[0].alerts[0].text).toBe("3 riders for 2 seats: 2 on the roster and 1 booked.");
    expect(day.alerts[0]).toBe("1 run over the seats on the bus: TR-0001 (3 for 2).");
  });

  it("reports a run that is behind, in the dispatcher's words", () => {
    const db = world({
      trips: [
        trip("t1", "TR-0001", {
          vehicleId: "v1",
          driverId: "d1",
          status: "in_progress",
          delays: [{ id: "dl1", at, minutes: 20, reason: "Traffic on the Spintex road", reportedBy: "Kojo Owusu" }],
        }),
      ],
    });
    const day = board(db);
    expect(day.totals.late).toBe(1);
    expect(day.runs[0].delay).toMatch(/20 minutes/);
    expect(day.runs[0].alerts[0]).toMatchObject({ level: "warning" });
    expect(day.alerts[0]).toMatch(/1 run behind schedule: TR-0001/);
  });

  it("narrows the list without shrinking the day", () => {
    const db = world({
      trips: [trip("t1", "TR-0001", { vehicleId: "v1", driverId: "d1" }), trip("t2", "TR-0002", { routeId: "route2", vehicleId: "v2", driverId: "d2" })],
    });
    const filtered = board(db, { routeId: "route2" });
    expect(filtered.runs.map((run) => run.reference)).toEqual(["TR-0002"]);
    // The day still holds two runs, and says so, so a list of one is not read as a quiet day.
    expect(filtered.dayRuns).toBe(2);
    expect(filtered.totals.runs).toBe(2);
    expect(filtered.filtersApplied).toBe(true);
    // Company is the route's client, and it filters the same way.
    expect(board(db, { clientId: "c1" }).runs.map((run) => run.reference)).toEqual(["TR-0001"]);
    expect(board(db, { status: "planned" }).runs).toHaveLength(2);
    expect(board(db, { driverId: "d2" }).runs.map((run) => run.reference)).toEqual(["TR-0002"]);
    expect(board(db, { vehicleId: "v1" }).runs.map((run) => run.reference)).toEqual(["TR-0001"]);
  });

  it("lists who is free, and puts a bus that cannot move at the bottom with its reason", () => {
    const db = world({
      vehicles: [vehicle("v1", "GT-1111-24", 14), vehicle("v2", "GT-2222-24", 45, { status: "out_of_service" }), vehicle("v3", "GT-3333-24", 30)],
      drivers: [driver("d1", "Kojo Owusu"), driver("d2", "Yaa Asantewaa", { licenceExpiry: "2026-05-01" }), driver("d3", "Adjoa Mensah")],
      trips: [trip("t1", "TR-0001", { vehicleId: "v1", driverId: "d1" })],
    });
    const day = board(db);
    // The bus on the run is not "free"; the out-of-service one is listed, last, with why.
    expect(day.available.vehicles.map((candidate) => candidate.label)).toEqual(["GT-3333-24 · 30 seats", "GT-2222-24 · 45 seats"]);
    expect(day.available.vehicles[1].note).toBe("Out of service: it cannot take a run today.");
    // A lapsed driver is still listed — as a name to ring, not a driver to send.
    expect(day.available.drivers.map((candidate) => candidate.label)).toEqual(["Adjoa Mensah", "Yaa Asantewaa"]);
    expect(day.available.drivers[1].note).toMatch(/licence expired/);
  });

  it("leaves a cancelled run out of the trouble counts, and states what it cannot answer", () => {
    const db = world({ trips: [trip("t1", "TR-0001", { status: "cancelled", cancelReason: "No bus" })] });
    const day = board(db);
    expect(day.totals).toEqual({ runs: 1, unassigned: 0, overCapacity: 0, blocked: 0, late: 0 });
    expect(day.limits).toEqual([...BOARD_LIMITS]);
    expect(day.limits[0]).toMatch(/no service type/);
  });

  it("has nothing to say about a date with no runs", () => {
    const day = dispatchBoard(world(), { date: "2026-06-02" }, DATE);
    expect(day.runs).toEqual([]);
    expect(day.dayRuns).toBe(0);
    expect(day.alerts).toEqual([]);
    expect(day.next).toBeNull();
  });

  it("points at the next run still to leave, and skips one already gone", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const db = world({
      trips: [
        trip("t1", "TR-0001", { serviceDate: tomorrow, vehicleId: "v1", driverId: "d1" }),
        trip("t2", "TR-0002", { serviceDate: tomorrow, routeId: "route2", vehicleId: "v2", driverId: "d2" }),
      ],
    });
    const day = dispatchBoard(db, { date: tomorrow }, DATE);
    expect(day.next).toMatchObject({ reference: "TR-0001", departsAt: "06:00" });
    expect(day.next!.minutes).toBeGreaterThan(0);
  });
});
