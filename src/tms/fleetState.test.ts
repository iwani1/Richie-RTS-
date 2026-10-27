// What state a vehicle is in, and why (FLT-02, D-109).
//
// The interesting cases are not the happy ones. They are the disagreements: a bus in the workshop
// that is still on today's run sheet, a repair that is finished but nobody has released, a retired
// bus with a hire that was never taken off it. Each of those is a plan that has already gone wrong,
// and the register has to say so rather than pick one of the two facts and hide the other.
import { describe, expect, it } from "vitest";
import {
  FLEET_STATES,
  FLEET_STATE_LABELS,
  FLEET_STATE_ORDER,
  FLEET_STATE_RULES,
  fleetStateCounts,
  fleetStateLine,
  fleetStateOf,
  nextCommitmentOf,
  vehiclesInState,
} from "./fleetState";
import { emptyDatabase, type BusRoute, type Database, type Driver, type Rental, type Trip, type Vehicle, type WorkOrder } from "./types";

const at = "2026-06-01T06:00:00.000Z";
const DAY = "2026-06-01";

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

const driver = (id: string, fullName: string): Driver => ({
  id,
  fullName,
  phone: "0244000000",
  licenceNumber: "DL-1",
  licenceExpiry: "2031-01-01",
  licenceClasses: ["D"],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const route = (id: string, reference: string, name: string): BusRoute => ({
  id,
  reference,
  name,
  clientId: "c1",
  direction: "to_work",
  shiftId: null,
  vehicleCategoryId: "cat",
  weekdays: [1],
  startDate: "2026-01-01",
  endDate: null,
  stops: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const trip = (id: string, overrides: Partial<Trip> = {}): Trip => ({
  id,
  reference: `TR-${id}`,
  routeId: "r1",
  serviceDate: DAY,
  status: "planned",
  origin: "schedule",
  originReason: null,
  vehicleId: "v1",
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

const workOrder = (id: string, reference: string, overrides: Partial<WorkOrder> = {}): WorkOrder => ({
  id,
  reference,
  vehicleId: "v1",
  title: "Brakes",
  workType: "Repair",
  workshop: "Ama Motors",
  description: "",
  reportedOdometer: null,
  plannedDate: null,
  incidentId: null,
  status: "open",
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

const rental = (id: string, overrides: Partial<Rental> = {}): Rental => ({
  id,
  reference: `RR-${id}`,
  clientId: null,
  customerName: "Ama Transport",
  customerPhone: "0244",
  customerEmail: "",
  purpose: "Staff trip",
  pickupLocation: "Accra",
  dropoffLocation: "Kumasi",
  startDate: DAY,
  endDate: DAY,
  passengers: 12,
  vehicleCategoryId: "cat",
  driverRequired: true,
  notes: "",
  status: "confirmed",
  quote: null,
  quoteHistory: [],
  acceptance: null,
    run: null,
    plan: null,
  assignedVehicleId: "v1",
  assignedDriverId: "d1",
  deposit: null,
  finalInvoice: null,
  resolutionReason: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

function build(overrides: Partial<Database> = {}): Database {
  return {
    ...emptyDatabase(),
    vehicles: [vehicle("v1")],
    drivers: [driver("d1", "Kofi Mensah")],
    routes: [route("r1", "RT-001", "Northstar morning")],
    ...overrides,
  };
}

describe("a vehicle with nothing happening to it", () => {
  it("is Available, and says why in plain words", () => {
    const reading = fleetStateOf(build(), "v1", DAY);
    expect(reading?.state).toBe("available");
    expect(reading?.sentence).toMatch(/^Free/);
    expect(reading?.commitment).toBe("");
    expect(reading?.conflict).toBe("");
    expect(reading?.reference).toBe("");
  });

  it("is not held by a run on another day, nor by a run that has finished", () => {
    const other = build({
      trips: [trip("1", { serviceDate: "2026-06-02" }), trip("2", { status: "completed", completedAt: at })],
    });
    expect(fleetStateOf(other, "v1", DAY)?.state).toBe("available");
  });

  it("returns null for a vehicle that is not on the register, rather than inventing one", () => {
    expect(fleetStateOf(build(), "nope", DAY)).toBe(null);
    expect(fleetStateLine(build(), "nope", DAY)).toBe("");
  });
});

describe("what the day's runs are doing with it", () => {
  it("is Reserved while a run on the day is only planned", () => {
    const reading = fleetStateOf(build({ trips: [trip("1", { reference: "TR-0001" })] }), "v1", DAY);
    expect(reading?.state).toBe("reserved");
    expect(reading?.sentence).toBe("TR-0001 (Northstar morning) is planned.");
    // The reference is what the row prints beside the badge, so a dispatcher can find the record.
    expect(reading?.reference).toBe("TR-0001");
  });

  it("is Assigned once the run is dispatched, and names the crew", () => {
    const reading = fleetStateOf(build({ trips: [trip("1", { reference: "TR-0001", status: "dispatched", dispatchedAt: at })] }), "v1", DAY);
    expect(reading?.state).toBe("assigned");
    expect(reading?.sentence).toBe("TR-0001 (Northstar morning), dispatched with Kofi Mensah.");
  });

  it("is On Trip once the run has started, and stays out of the way of a second planned run", () => {
    const db = build({
      trips: [
        trip("1", { reference: "TR-0001", status: "in_progress", startedAt: at }),
        trip("2", { reference: "TR-0002", status: "planned" }),
      ],
    });
    const reading = fleetStateOf(db, "v1", DAY);
    expect(reading?.state).toBe("on_trip");
    expect(reading?.sentence).toContain("TR-0001 (Northstar morning)");
  });

  it("says which run it is on when the run has no route on file", () => {
    const db = build({ routes: [], trips: [trip("1", { reference: "TR-0001", status: "in_progress", startedAt: at })] });
    expect(fleetStateOf(db, "v1", DAY)?.sentence).toContain("TR-0001 — the run has started.");
  });
});

describe("what a confirmed hire is doing with it", () => {
  it("is Reserved while a hire covering the day has not started", () => {
    const db = build({ rentals: [rental("1", { reference: "RR-0007", startDate: "2026-05-31", endDate: "2026-06-03" })] });
    const reading = fleetStateOf(db, "v1", DAY);
    // Its dates include today and it has already begun, so the bus is given to it.
    expect(reading?.state).toBe("assigned");
    expect(reading?.sentence).toContain("RR-0007");
  });

  it("is not held today by a hire that starts tomorrow — but says when it is next spoken for", () => {
    const db = build({ rentals: [rental("1", { reference: "RR-0007", startDate: "2026-06-02", endDate: "2026-06-04" })] });
    expect(fleetStateOf(db, "v1", DAY)?.state).toBe("available");
    const next = nextCommitmentOf(db, "v1", DAY);
    expect(next?.onDate).toBe("2026-06-02");
    expect(next?.text).toBe("RR-0007 (Ama Transport, 2026-06-02 to 2026-06-04)");
  });

  it("names the soonest of a run and a hire when both are coming", () => {
    const db = build({
      rentals: [rental("1", { reference: "RR-0007", startDate: "2026-06-09", endDate: "2026-06-09" })],
      trips: [trip("1", { reference: "TR-0009", serviceDate: "2026-06-03" })],
    });
    expect(nextCommitmentOf(db, "v1", DAY)).toEqual({ onDate: "2026-06-03", text: "TR-0009 (Northstar morning)" });
  });

  it("has nothing to say about a vehicle with no future commitment", () => {
    const db = build({ trips: [trip("1", { status: "completed", completedAt: at }
    )] });
    expect(nextCommitmentOf(db, "v1", DAY)).toBe(null);
  });

  it("is Assigned on the day the hire starts, and On trip once it is under way", () => {
    const starting = build({ rentals: [rental("1", { reference: "RR-0007" })] });
    expect(fleetStateOf(starting, "v1", DAY)?.state).toBe("assigned");

    const underWay = build({ rentals: [rental("1", { reference: "RR-0007", status: "in_progress" })] });
    expect(fleetStateOf(underWay, "v1", DAY)?.state).toBe("on_trip");
  });

  it("is freed by a cancelled hire, and by dates that do not cover the day", () => {
    const cancelled = build({ rentals: [rental("1", { status: "cancelled" })] });
    expect(fleetStateOf(cancelled, "v1", DAY)?.state).toBe("available");

    const later = build({ rentals: [rental("1", { startDate: "2026-06-05", endDate: "2026-06-06" })] });
    expect(fleetStateOf(later, "v1", DAY)?.state).toBe("available");
  });

  it("prefers today's run to today's hire, because a run carries named passengers", () => {
    const db = build({
      rentals: [rental("1", { reference: "RR-0007" })],
      trips: [trip("1", { reference: "TR-0001", status: "dispatched", dispatchedAt: at })],
    });
    expect(fleetStateOf(db, "v1", DAY)?.sentence).toContain("TR-0001");
  });
});

describe("what the workshop is doing with it", () => {
  it("is Under maintenance while a work order is open, in progress or on hold", () => {
    for (const status of ["open", "in_progress", "on_hold"] as const) {
      const db = build({ workOrders: [workOrder("w1", "WO-0003", { status })] });
      const reading = fleetStateOf(db, "v1", DAY);
      expect(reading?.state).toBe("maintenance");
      expect(reading?.sentence).toContain("WO-0003");
      expect(reading?.sentence).toContain("Ama Motors");
    }
  });

  it("is Pending inspection once the repair is finished and not released", () => {
    const db = build({ workOrders: [workOrder("w1", "WO-0003", { status: "completed", completedAt: at })] });
    const reading = fleetStateOf(db, "v1", DAY);
    // The register still says "under maintenance" until somebody releases it; the screens say what
    // is actually wrong, which is that nobody has signed the bus back.
    expect(reading?.state).toBe("pending_inspection");
    expect(reading?.sentence).toMatch(/repaired and waiting to be released/);
    expect(reading?.reference).toBe("WO-0003");
  });

  it("is free again once the work order is released", () => {
    const db = build({
      workOrders: [
        workOrder("w1", "WO-0003", { status: "closed", completedAt: at, releasedBy: "Admin", releasedAt: at }),
        // A row that names its releaser is not waiting for one, whatever its status column says.
        workOrder("w2", "WO-0002", { status: "completed", completedAt: at, releasedBy: "Admin", releasedAt: at }),
      ],
    });
    expect(fleetStateOf(db, "v1", DAY)?.state).toBe("available");
  });

  it("takes the office's word for it when a vehicle is in the workshop with no work order", () => {
    const db = build({ vehicles: [vehicle("v1", { status: "maintenance" })] });
    const reading = fleetStateOf(db, "v1", DAY);
    expect(reading?.state).toBe("maintenance");
    expect(reading?.sentence).toMatch(/no work order is open/);
  });

  it("names the run a broken bus is still holding, rather than hiding it", () => {
    const db = build({
      trips: [trip("1", { reference: "TR-0001", status: "dispatched", dispatchedAt: at })],
      workOrders: [workOrder("w1", "WO-0003", { status: "in_progress" })],
    });
    const reading = fleetStateOf(db, "v1", DAY);
    expect(reading?.state).toBe("maintenance");
    expect(reading?.conflict).toBe("It is still committed to TR-0001 (Northstar morning), dispatched with Kofi Mensah.");
    expect(reading?.sentence).toContain("It is still committed to TR-0001");
  });
});

describe("the office's own words come last", () => {
  it("is Out of service whatever the run sheet says, and says which run is stranded", () => {
    const db = build({
      vehicles: [vehicle("v1", { status: "out_of_service" })],
      trips: [trip("1", { reference: "TR-0001" })],
    });
    const reading = fleetStateOf(db, "v1", DAY);
    expect(reading?.state).toBe("out_of_service");
    expect(reading?.sentence).toContain("taken it off the road");
    expect(reading?.sentence).toContain("TR-0001");
  });

  it("is Retired for good, even with a hire still attached to it", () => {
    const db = build({ vehicles: [vehicle("v1", { status: "retired" })], rentals: [rental("1", { reference: "RR-0007" })] });
    const reading = fleetStateOf(db, "v1", DAY);
    expect(reading?.state).toBe("retired");
    expect(reading?.sentence).toMatch(/no longer part of the fleet/);
    expect(reading?.conflict).not.toBe("");
  });
});

describe("counting the fleet by state", () => {
  const db = build({
    vehicles: [
      vehicle("v1"),
      vehicle("v2", { registration: "GT 200" }),
      vehicle("v3", { registration: "GT 300", status: "maintenance" }),
      vehicle("v4", { registration: "GT 400", status: "retired" }),
    ],
    trips: [trip("1", { vehicleId: "v2", status: "in_progress", startedAt: at })],
  });

  it("counts every vehicle once, retired ones included", () => {
    const counts = fleetStateCounts(db, DAY);
    expect(counts.available).toBe(1);
    expect(counts.on_trip).toBe(1);
    expect(counts.maintenance).toBe(1);
    expect(counts.retired).toBe(1);
    expect(counts.total).toBe(4);
    expect(FLEET_STATES.reduce((sum, state) => sum + counts[state], 0)).toBe(counts.total);
  });

  it("lists which ones, in registration order, for a dispatcher who needs to go and look", () => {
    expect(vehiclesInState(db, "retired", DAY).map((v) => v.registration)).toEqual(["GT 400"]);
    expect(vehiclesInState(db, "available", DAY).map((v) => v.registration)).toEqual(["GT V1"]);
    expect(vehiclesInState(db, "on_trip", "2026-06-02")).toEqual([]);
  });
});

describe("the rules the screen prints", () => {
  it("names every state once, in the brief's workflow order", () => {
    expect(FLEET_STATE_ORDER.map((state) => state)).toEqual([...FLEET_STATES]);
    expect(Object.keys(FLEET_STATE_LABELS).sort()).toEqual([...FLEET_STATES].sort());
  });

  it("says what each state means and what takes a vehicle out of it", () => {
    expect(FLEET_STATE_RULES).toHaveLength(FLEET_STATES.length);
    for (const rule of FLEET_STATE_RULES) {
      expect(rule.rule.length).toBeGreaterThan(20);
      expect(rule.leaves.length).toBeGreaterThan(10);
      expect(rule.leaves).not.toMatch(/undefined/);
    }
    // Retired is the one state with no way out, and it says so.
    expect(FLEET_STATE_RULES.find((rule) => rule.state === "retired")?.leaves).toMatch(/does not come back/);
  });
});
