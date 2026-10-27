// What the fleet register says about the vehicle itself (FLT-01, D-106).
//
// The register knew a registration, a category, a seat count and a status. These are the four facts
// it was missing, and what is pinned here:
//
//   1. **Blank is a fact, not a zero.** No fuel type recorded is not "runs on nothing"; no ownership
//      recorded is not "owned". A hired bus must never appear on the company's asset list by default.
//   2. **A third-party vehicle names its owner.** Leased or hire purchase without a lessor is half a
//      record, and the half that is missing is the name of the person to ring when the bus is taken
//      back.
//   3. **The usual driver is a driver on the register**, not a name typed into a box.
//   4. **What is missing is counted**, so a register that looks complete can be checked.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, migrate, SCHEMA_VERSION, type Database, type Vehicle } from "./types";
import { fleetDetailGaps, isThirdParty, normaliseOwnership, ownershipLine, readVehicleDetail, usualDriverOf, vehicleDetailLine, VEHICLE_DETAIL_LIMITS } from "./vehicles";

const NOW = "2026-06-01T06:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

interface World {
  db: Database;
}

function build(): World {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  const w: World = { db: setup.db };
  run(w, {
    type: "update_settings",
    input: {
      ...w.db.settings,
      currencyCode: "GHS",
      vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
      shifts: [],
      rental: emptyRentalSettings(),
    },
  });
  const admin: Actor = { id: w.db.users[0].id, fullName: "Admin", role: "administrator" };
  run(w, { type: "create_driver", input: { fullName: "Kojo Mensah", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } }, admin);
  run(w, { type: "create_driver", input: { fullName: "Ama Boateng", phone: "020", licenceNumber: "L-2", licenceExpiry: "2030-01-01", status: "inactive" } }, admin);
  return w;
}

function run(w: World, command: AnyCommand, actor?: Actor) {
  const who: Actor = actor ?? { id: w.db.users[0].id, fullName: "Admin", role: "administrator" };
  const result = executeCommand(w.db, who, command, NOW);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
}

function attempt(w: World, command: AnyCommand) {
  const actor: Actor = { id: w.db.users[0].id, fullName: "Admin", role: "administrator" };
  return executeCommand(w.db, actor, command, NOW);
}

const category = (w: World) => w.db.settings.vehicleCategories[0].id;

function addVehicle(w: World, over: Record<string, string> = {}) {
  return run(w, {
    type: "create_vehicle",
    input: { registration: "GT 100-26", categoryId: category(w), make: "", model: "", seatCapacity: "30", notes: "", ...over },
  });
}

describe("reading the fleet facts", () => {
  it("keeps an unrecorded ownership unrecorded, rather than calling it ours", () => {
    const w = build();
    const { errors, value } = readVehicleDetail(w.db, {});
    expect(errors).toEqual({});
    expect(value).toEqual({ fuelType: "", ownership: null, ownerName: "", usualDriverId: null });
    expect(isThirdParty(value.ownership)).toBe(false);
    expect(ownershipLine({ ownership: null, ownerName: "" })).toBe("");
  });

  it("takes fuel in the office's own words, trimmed, and keeps it short", () => {
    expect(readVehicleDetail(build().db, { fuelType: "  Diesel  " }).value.fuelType).toBe("Diesel");
    const long = readVehicleDetail(build().db, { fuelType: "x".repeat(VEHICLE_DETAIL_LIMITS.fuelType + 1) });
    expect(long.errors.fuelType).toMatch(new RegExp(String(VEHICLE_DETAIL_LIMITS.fuelType)));
  });

  it("refuses an ownership it does not know rather than guessing", () => {
    const w = build();
    expect(readVehicleDetail(w.db, { ownership: "borrowed" }).errors.ownership).toMatch(/owned, leased or hire purchase/i);
    expect(readVehicleDetail(w.db, { ownership: "leased" }).value.ownership).toBe("leased");
  });

  it("reads the ownership the way people write it, and refuses anything else", () => {
    expect(normaliseOwnership("Owned")).toBe("owned");
    expect(normaliseOwnership("Lease")).toBe("leased");
    expect(normaliseOwnership("hire-purchase")).toBe("hire_purchase");
    expect(normaliseOwnership("  Financed ")).toBe("hire_purchase");
    expect(normaliseOwnership("borrowed")).toBe("borrowed");
  });

  it("makes a leased or hire-purchase vehicle name its owner", () => {
    const w = build();
    expect(readVehicleDetail(w.db, { ownership: "leased" }).errors.ownerName).toMatch(/whose vehicle it is/i);
    expect(readVehicleDetail(w.db, { ownership: "hire_purchase" }).errors.ownerName).toMatch(/whose vehicle it is/i);
    expect(readVehicleDetail(w.db, { ownership: "leased", ownerName: "Ama Transport" }).errors).toEqual({});
  });

  it("refuses an owner on a vehicle that is ours, instead of storing a name nobody will see", () => {
    const w = build();
    expect(readVehicleDetail(w.db, { ownership: "owned", ownerName: "Ama Transport" }).errors.ownerName).toMatch(/recorded as ours/i);
    expect(readVehicleDetail(w.db, { ownership: "owned", ownerName: "" }).errors).toEqual({});
  });

  it("requires the usual driver to be a driver on the register, and one who still works here", () => {
    const w = build();
    const [kojo, ama] = w.db.drivers;
    expect(readVehicleDetail(w.db, { usualDriverId: "nobody" }).errors.usualDriverId).toMatch(/not on the register/i);
    expect(readVehicleDetail(w.db, { usualDriverId: ama.id }).errors.usualDriverId).toMatch(/inactive/i);
    expect(readVehicleDetail(w.db, { usualDriverId: kojo.id }).value.usualDriverId).toBe(kojo.id);
  });
});

describe("how the register reads a vehicle", () => {
  it("says what it runs on and whose it is, on one line", () => {
    expect(vehicleDetailLine({ fuelType: "Diesel", ownership: "owned", ownerName: "" })).toBe("Diesel · Owned");
    expect(vehicleDetailLine({ fuelType: "Petrol", ownership: "leased", ownerName: "Ama Transport" })).toBe("Petrol · Leased from Ama Transport");
    // Nothing recorded prints nothing: the column header already says what the line is about.
    expect(vehicleDetailLine({ fuelType: "", ownership: null, ownerName: "" })).toBe("");
  });

  it("finds the usual driver, and copes with one who has left the register", () => {
    const w = build();
    addVehicle(w, { usualDriverId: w.db.drivers[0].id });
    const vehicle = w.db.vehicles[0];
    expect(usualDriverOf(w.db, vehicle)?.fullName).toBe("Kojo Mensah");
    expect(usualDriverOf(w.db, { usualDriverId: "gone" })).toBe(null);
    expect(usualDriverOf(w.db, { usualDriverId: null })).toBe(null);
  });

  it("counts the gaps in the live fleet, and leaves retired vehicles out of the count", () => {
    const w = build();
    addVehicle(w, { registration: "GT 100-26", fuelType: "Diesel", ownership: "owned" });
    addVehicle(w, { registration: "GT 200-26" });
    addVehicle(w, { registration: "GT 300-26" });
    const retired = w.db.vehicles[2];
    run(w, { type: "transition_vehicle", id: retired.id, to: "retired", reason: "Scrapped" });

    const gaps = fleetDetailGaps(w.db);
    expect(gaps.total).toBe(2);
    expect(gaps.noFuelType).toBe(1);
    expect(gaps.noOwnership).toBe(1);
    expect(gaps.noUsualDriver).toBe(2);
  });
});

describe("saving a vehicle with the new facts", () => {
  it("stores fuel, ownership, owner and usual driver, and audits the registration", () => {
    const w = build();
    addVehicle(w, { fuelType: "Diesel", ownership: "leased", ownerName: "Ama Transport", usualDriverId: w.db.drivers[0].id });
    expect(w.db.vehicles[0]).toMatchObject({
      fuelType: "Diesel",
      ownership: "leased",
      ownerName: "Ama Transport",
      usualDriverId: w.db.drivers[0].id,
    });
    expect(w.db.audit[0].action).toBe("vehicles:create");
  });

  it("still registers a vehicle when nobody knows any of it", () => {
    const w = build();
    expect(addVehicle(w).ok).toBe(true);
    expect(w.db.vehicles[0]).toMatchObject({ fuelType: "", ownership: null, ownerName: "", usualDriverId: null });
  });

  it("refuses a half-recorded lease, and says which box to fill", () => {
    const w = build();
    const refused = attempt(w, {
      type: "create_vehicle",
      input: { registration: "GT 400-26", categoryId: category(w), make: "", model: "", seatCapacity: "30", ownership: "leased", notes: "" },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.ownerName).toMatch(/whose vehicle it is/i);
    expect(w.db.vehicles).toHaveLength(0);
  });

  it("lets an edit fill in what was blank, and change a lease to owned", () => {
    const w = build();
    addVehicle(w, { fuelType: "", ownership: "leased", ownerName: "Ama Transport" });
    const vehicle = w.db.vehicles[0];
    run(w, {
      type: "update_vehicle",
      id: vehicle.id,
      input: {
        registration: vehicle.registration,
        categoryId: vehicle.categoryId,
        make: "",
        model: "",
        seatCapacity: "30",
        fuelType: "Diesel",
        ownership: "owned",
        ownerName: "",
        usualDriverId: w.db.drivers[0].id,
        notes: "",
      },
    });
    expect(w.db.vehicles[0]).toMatchObject({ fuelType: "Diesel", ownership: "owned", ownerName: "", usualDriverId: w.db.drivers[0].id });
  });

  it("does not refuse a vehicle because of its own usual driver", () => {
    const w = build();
    addVehicle(w, { usualDriverId: w.db.drivers[0].id });
    const vehicle = w.db.vehicles[0];
    const saved = run(w, {
      type: "update_vehicle",
      id: vehicle.id,
      input: {
        registration: vehicle.registration,
        categoryId: vehicle.categoryId,
        make: "Toyota",
        model: "Coaster",
        seatCapacity: "30",
        usualDriverId: w.db.drivers[0].id,
        notes: "",
      },
    });
    expect(saved.ok).toBe(true);
    expect(w.db.vehicles[0].make).toBe("Toyota");
  });
});

describe("a register written before the fleet facts existed", () => {
  it("gains blanks and a null ownership rather than claiming the fleet is ours", () => {
    const old = {
      id: "v1",
      registration: "GT 900-26",
      categoryId: "cat",
      make: "Toyota",
      model: "Coaster",
      seatCapacity: 30,
      status: "available",
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Vehicle;

    const migrated = migrate({ ...emptyDatabase(), schemaVersion: 26, vehicles: [old] });
    expect(migrated?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated?.vehicles[0]).toMatchObject({ fuelType: "", ownership: null, ownerName: "", usualDriverId: null });
  });

  it("keeps a fuel and ownership that are already there", () => {
    const existing = { ...(migrate({ ...emptyDatabase(), vehicles: [] })!), schemaVersion: 26 as never };
    const migrated = migrate({
      ...existing,
      vehicles: [{ ...existing.vehicles[0], id: "v1", registration: "GT 1", categoryId: "c", make: "", model: "", seatCapacity: 1, status: "available", fuelType: "Diesel", ownership: "leased", ownerName: "Ama", usualDriverId: "d1", notes: "", createdAt: NOW, updatedAt: NOW }],
    } as never);
    expect(migrated?.vehicles[0]).toMatchObject({ fuelType: "Diesel", ownership: "leased", ownerName: "Ama", usualDriverId: "d1" });
  });
});
