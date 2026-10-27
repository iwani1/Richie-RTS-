// What a driver is licensed to drive, and whether this vehicle is theirs to take (FLT-04, D-103).
//
// Before this, dispatch checked one thing about a driver's licence: that it had not expired. Nothing
// checked what the licence allowed, so a driver licensed for a small car could be signed to a coach
// and the system would report the licence as in order. The rule here is deliberately narrow and
// honest:
//
//   1. **An unclassified category checks nothing.** The office has not said which classes may drive
//      a minibus, so this program does not invent an answer and does not ground a working fleet.
//   2. **Once a category is classified, blank fails closed.** "The class was never written down" is
//      not the same as "the driver holds the right one", and the refusal says which it is.
//   3. **The vocabulary is the office's.** Classes are stored as they are printed and compared
//      ignoring case; nothing here decides that a D covers a 45-seater.
import { describe, expect, it } from "vitest";

import { DRIVING_LIMITS, driverAvailabilityLine, licenceClassProblem, parseTags, validateTags } from "./driving";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, type Database, type Driver, type VehicleCategory } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const at = "2026-01-01T00:00:00.000Z";

const admin = (db: Database): Actor => ({ id: db.users[0].id, fullName: db.users[0].fullName, role: db.users[0].role });

function base(): Database {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  return setup.db;
}

const category = (overrides: Partial<VehicleCategory> = {}): VehicleCategory => ({
  id: "cat-coach",
  name: "Coach",
  licenceClasses: [],
  ...overrides,
});

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: "d1",
  fullName: "Kofi Mensah",
  phone: "+233201234567",
  licenceNumber: "DL-001",
  licenceExpiry: "2031-05-01",
  licenceClasses: [],
  qualifications: [],
  status: "active",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const world = (options: { classes?: string[]; held?: string[] } = {}): Database => {
  const db = base();
  return {
    ...db,
    settings: {
      ...db.settings,
      rental: emptyRentalSettings(),
      vehicleCategories: [category({ licenceClasses: options.classes ?? [] })],
    },
    drivers: [driver({ licenceClasses: options.held ?? [] })],
  };
};

describe("reading licence classes off a licence (FLT-04)", () => {
  it("splits what a person typed and upper-cases it, because that is how it is printed", () => {
    expect(parseTags("c, d", { upper: true })).toEqual(["C", "D"]);
    expect(parseTags(" C1E ;  D1 ", { upper: true })).toEqual(["C1E", "D1"]);
  });

  it("does not turn one class into two by case, a stray space or a repeated entry", () => {
    expect(parseTags("C, c , C", { upper: true })).toEqual(["C"]);
    expect(parseTags("Costal  driving, costal driving")).toEqual(["Costal driving"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(" , ; ")).toEqual([]);
  });

  it("keeps the office's own wording for a qualification", () => {
    // A qualification is whatever the office wrote on the certificate, not a code this program owns.
    expect(parseTags("PSV, Defensive driving")).toEqual(["PSV", "Defensive driving"]);
  });

  it("refuses a list that is too long, and a class that is not a class", () => {
    expect(validateTags("licenceClasses", Array.from({ length: DRIVING_LIMITS.classesPerDriver + 1 }, (_, i) => `C${i}`), {
      max: DRIVING_LIMITS.classesPerDriver,
      length: DRIVING_LIMITS.classLength,
      label: "licence class",
    }).licenceClasses).toBe(`Keep this to ${DRIVING_LIMITS.classesPerDriver} entries.`);

    expect(
      validateTags("licenceClasses", ["C".repeat(DRIVING_LIMITS.classLength + 1)], {
        max: DRIVING_LIMITS.classesPerDriver,
        length: DRIVING_LIMITS.classLength,
        label: "licence class",
      }).licenceClasses,
    ).toMatch(/too long for a licence class/);
  });
});

describe("recording a driver's licence class (FLT-04)", () => {
  it("stores the classes and qualifications as lists", () => {
    const db = base();
    const result = execute(db, admin(db), {
      type: "create_driver",
      input: {
        fullName: "Kofi Mensah",
        phone: "+233201234567",
        licenceNumber: "dl-001",
        licenceExpiry: "2031-05-01",
        licenceClasses: "c, D, c",
        qualifications: "PSV, Defensive driving",
        status: "active",
      },
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.drivers[0].licenceClasses).toEqual(["C", "D"]);
    expect(result.db.drivers[0].qualifications).toEqual(["PSV", "Defensive driving"]);
    // The licence number keeps its own rule.
    expect(result.db.drivers[0].licenceNumber).toBe("DL-001");
  });

  it("leaves both blank for a driver nobody has the certificate for, rather than guessing", () => {
    const db = base();
    const result = execute(db, admin(db), {
      type: "create_driver",
      input: { fullName: "Ama Boateng", phone: "+233207654321", licenceNumber: "DL-002", licenceExpiry: "2030-01-01", status: "active" },
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.drivers[0].licenceClasses).toEqual([]);
    expect(result.db.drivers[0].qualifications).toEqual([]);
  });

  it("reports an unusable class list on the field the form can point at", () => {
    const db = base();
    const tooMany = execute(db, admin(db), {
      type: "create_driver",
      input: {
        fullName: "Kofi Mensah",
        phone: "+233201234567",
        licenceNumber: "DL-001",
        licenceExpiry: "2031-05-01",
        licenceClasses: Array.from({ length: DRIVING_LIMITS.classesPerDriver + 1 }, (_, i) => `C${i}`).join(", "),
        status: "active",
      },
    }, NOW);
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.errors.licenceClasses).toContain(`${DRIVING_LIMITS.classesPerDriver} entries`);
  });

  it("keeps the classes when the rest of the driver record is edited", () => {
    const db = world({ held: ["C", "D"] });
    const result = execute(db, admin(db), {
      type: "update_driver",
      id: "d1",
      input: {
        fullName: "Kofi Mensah",
        phone: "+233200000000",
        licenceNumber: "DL-001",
        licenceExpiry: "2032-05-01",
        licenceClasses: "C, D",
        qualifications: "PSV",
        status: "active",
      },
    }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.drivers[0].licenceClasses).toEqual(["C", "D"]);
    expect(result.db.drivers[0].qualifications).toEqual(["PSV"]);
  });
});

describe("whether a driver may take this vehicle (FLT-04)", () => {
  it("checks nothing when the office has not said what may drive the category", () => {
    const db = world({ classes: [], held: [] });
    expect(licenceClassProblem(db, db.drivers[0], "cat-coach")).toBeNull();
  });

  it("allows a driver whose licence includes a class the vehicle needs", () => {
    const db = world({ classes: ["D"], held: ["C", "D"] });
    expect(licenceClassProblem(db, db.drivers[0], "cat-coach")).toBeNull();
  });

  it("compares classes without case, so a licence read as \"d\" still counts", () => {
    const db = world({ classes: ["D"], held: ["d"] });
    expect(licenceClassProblem(db, db.drivers[0], "cat-coach")).toBeNull();
  });

  it("refuses a driver licensed for another class, and names both", () => {
    const db = world({ classes: ["D"], held: ["B"] });
    expect(licenceClassProblem(db, db.drivers[0], "cat-coach")).toBe(
      "Driver Kofi Mensah holds licence class B, and Coach requires D. A driver may only be signed to a vehicle they are licensed to drive.",
    );
  });

  it("refuses a blank class rather than treating it as permission, and says what to do", () => {
    const db = world({ classes: ["D"], held: [] });
    expect(licenceClassProblem(db, db.drivers[0], "cat-coach")).toBe(
      "Driver Kofi Mensah's licence class is not recorded, and Coach requires D. Record the class from their licence before assigning this vehicle.",
    );
  });

  it("does not refuse over a category that no longer exists", () => {
    // A deleted category is a different problem, caught where the vehicle is checked.
    const db = world({ classes: ["D"], held: ["B"] });
    expect(licenceClassProblem(db, db.drivers[0], "gone")).toBeNull();
  });
});

describe("what a driver is doing today (FLT-04)", () => {
  const today = "2026-06-01";

  it("says free when nothing names them for today", () => {
    expect(driverAvailabilityLine(world(), "d1", today)).toBe("Free today");
  });

  it("names the run they are on today, with the route", () => {
    const db = world();
    db.routes = [{ id: "r1", reference: "R-0001", name: "Northstar morning", clientId: "", vehicleCategoryId: "cat-coach", direction: "to_work", shiftId: "", weekdays: [1], startDate: "2026-01-01", endDate: "", origin: "", destination: "", notes: "", createdAt: at, updatedAt: at } as never];
    db.trips = [
      { id: "t1", reference: "TR-0001", routeId: "r1", serviceDate: today, driverId: "d1", vehicleId: null, status: "dispatched", startedAt: null, completedAt: null, cancelledReason: null, corrections: [], log: [], createdAt: at, updatedAt: at } as never,
    ];
    expect(driverAvailabilityLine(db, "d1", today)).toBe("On TR-0001 (Northstar morning) today");
  });

  it("does not keep a driver busy with a run that already finished or is another day's", () => {
    const db = world();
    db.trips = [
      { id: "t1", reference: "TR-0001", routeId: "r1", serviceDate: today, driverId: "d1", vehicleId: null, status: "completed", startedAt: null, completedAt: null, cancelledReason: null, corrections: [], log: [], createdAt: at, updatedAt: at } as never,
      { id: "t2", reference: "TR-0002", routeId: "r1", serviceDate: "2026-06-02", driverId: "d1", vehicleId: null, status: "planned", startedAt: null, completedAt: null, cancelledReason: null, corrections: [], log: [], createdAt: at, updatedAt: at } as never,
    ];
    expect(driverAvailabilityLine(db, "d1", today)).toBe("Free today");
  });

  it("names the hire they are driving today", () => {
    const db = world();
    db.rentals = [
      {
        id: "rr1",
        reference: "RR-0007",
        clientId: null,
        customerName: "Walk-in",
        customerPhone: "",
        customerEmail: "",
        purpose: "",
        pickupLocation: "",
        dropoffLocation: "",
        startDate: "2026-05-30",
        endDate: "2026-06-03",
        passengers: 1,
        vehicleCategoryId: "cat-coach",
        driverRequired: true,
        notes: "",
        status: "in_progress",
        quote: null,
        quoteHistory: [],
  acceptance: null,
        assignedVehicleId: null,
        assignedDriverId: "d1",
        deposit: null,
        finalInvoice: null,
        resolutionReason: null,
        createdAt: at,
        updatedAt: at,
      } as never,
    ];
    expect(driverAvailabilityLine(db, "d1", today)).toBe("On hire RR-0007 today");
  });
});

describe("the refusal reaches the save, not just the register (FLT-04)", () => {
  /** A hire that needs a driver, in a category the office has said requires class D. */
  function hire(): { db: Database; actor: Actor; rentalId: string; vehicleId: string } {
    let db = base();
    const actor = admin(db);
    const run = (command: Parameters<typeof execute>[2]) => {
      const result = execute(db, actor, command, NOW);
      if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
      db = result.db;
      return result.db;
    };

    run({
      type: "update_settings",
      input: {
        ...db.settings,
        currencyCode: "GHS",
        vehicleCategories: [{ id: "", name: "Coach", licenceClasses: ["D"] }],
        rental: { ...emptyRentalSettings(), quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day", depositPercent: 25, quotationValidityHours: 168, paymentMethods: ["Cash"] },
      },
    });
    const categoryId = db.settings.vehicleCategories[0].id;
    run({ type: "create_vehicle", input: { registration: "GT 500-26", categoryId, make: "Toyota", model: "Coaster", seatCapacity: "45", notes: "" } });
    run({
      type: "create_driver",
      input: { fullName: "Kofi Mensah", phone: "+233201234567", licenceNumber: "DL-001", licenceExpiry: "2031-05-01", licenceClasses: "B", status: "active" },
    });
    run({
      type: "create_rental",
      input: {
        clientId: null,
        customerName: "Acme Ltd",
        customerPhone: "+233244000111",
        customerEmail: "",
        purpose: "Staff retreat",
        pickupLocation: "Accra",
        dropoffLocation: "Kumasi",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        passengers: "20",
        vehicleCategoryId: categoryId,
        driverRequired: true,
        notes: "",
      },
    });
    const rentalId = db.rentals[0].id;
    run({ type: "quote_rental", id: rentalId, input: { lines: [{ description: "Hire", quantity: "2", unitAmount: "1500" }] } });
    run({ type: "confirm_rental", id: rentalId, input: { amount: "750", method: "Cash", reference: "TX-1" } });

    return { db, actor, rentalId, vehicleId: db.vehicles[0].id };
  }

  it("refuses a hire to a driver whose licence does not cover the vehicle", () => {
    const b = hire();
    const driverId = b.db.drivers[0].id;

    const refused = execute(b.db, b.actor, { type: "assign_rental", id: b.rentalId, input: { vehicleId: b.vehicleId, driverId } }, NOW);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.driverId).toBe(
      "Driver Kofi Mensah holds licence class B, and Coach requires D. A driver may only be signed to a vehicle they are licensed to drive.",
    );
    // Nothing was written: a refusal carries no database to save.
    expect(Object.keys(refused.errors)).toEqual(["driverId"]);
  });

  it("accepts the same hire once the driver's licence class is recorded", () => {
    const b = hire();
    const driverId = b.db.drivers[0].id;
    const fixed = execute(b.db, b.actor, {
      type: "update_driver",
      id: driverId,
      input: { fullName: "Kofi Mensah", phone: "+233201234567", licenceNumber: "DL-001", licenceExpiry: "2031-05-01", licenceClasses: "C, D", status: "active" },
    }, NOW);
    if (!fixed.ok) throw new Error(fixed.message);

    const assigned = execute(fixed.db, b.actor, { type: "assign_rental", id: b.rentalId, input: { vehicleId: b.vehicleId, driverId } }, NOW);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.db.rentals[0].assignedDriverId).toBe(driverId);
  });
});
