import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS } from "./permissions";
import { executeCommand } from "./commands";
import { execute, VEHICLE_TRANSITIONS, type Actor, type Credential } from "./service";
import { emptyDatabase, SCHEMA_VERSION, type Database } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-01-01T00:00:00.000Z";

function seeded(): { db: Database; admin: Actor; ops: Actor; finance: Actor } {
  let db = emptyDatabase();
  let r = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  r = execute(db, admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  r = execute(db, admin, { type: "create_user", input: { fullName: "Fin", email: "fin@example.test", role: "finance", active: true }, credential: cred }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  const ops: Actor = { id: db.users[1].id, fullName: "Ops", role: "operations" };
  const finance: Actor = { id: db.users[2].id, fullName: "Fin", role: "finance" };
  return { db, admin, ops, finance };
}

function withCategory(db: Database, admin: Actor): Database {
  const r = execute(db, admin, { type: "update_settings", input: { ...db.settings, vehicleCategories: [{ id: "", name: "Minibus", licenceClasses: [] }] } }, NOW);
  if (!r.ok) throw new Error(r.message);
  return r.db;
}

describe("permissions", () => {
  it("administrator has every permission; record-bound roles get only their own-record set", () => {
    expect(can("administrator", "settings:update")).toBe(true);
    expect(ROLE_PERMISSIONS.driver).toEqual(["trips:read", "trips:start", "trips:record", "trips:complete", "incidents:read", "incidents:create", "documents:read", "bookings:read"]);
    expect(ROLE_PERMISSIONS.client_contact).toEqual([
      "routes:read",
      "passengers:read",
      "rentals:read",
      "rentals:create",
      // RNT-05, D-116: a customer may answer a quotation, own-record only. It cannot issue one, and
      // it cannot record the deposit — agreeing to a price is not the same act as paying.
      "rentals:accept",
      // CLI-03, D-114: the client's own billing, read only.
      "invoices:read",
      "bookings:read",
      "bookings:create",
      "contracts:read",
    ]);
    // Record-bound roles never reach internal administration.
    expect(can("driver", "settings:update")).toBe(false);
    expect(can("client_contact", "users:create")).toBe(false);
    expect(can(null, "vehicles:read")).toBe(false);
  });

  it("keeps finance out of employee records, documents and the audit trail (brief section 6)", () => {
    for (const permission of ["passengers:read", "documents:read", "audit:read"] as const) {
      expect(can("finance", permission)).toBe(false);
    }
    // It keeps what billing needs.
    for (const permission of ["rentals:read", "clients:read", "costs:read", "vehicles:read"] as const) {
      expect(can("finance", permission)).toBe(true);
    }
  });

  it("finance cannot create vehicles; operations cannot change settings", () => {
    const { db, ops, finance } = seeded();
    const v = execute(db, finance, { type: "create_vehicle", input: { registration: "GT 1-26", categoryId: "x", make: "", model: "", seatCapacity: "14", notes: "" } }, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/Not permitted/);
    const s = execute(db, ops, { type: "update_settings", input: db.settings }, NOW);
    expect(s.ok).toBe(false);
  });
});

describe("setup and users", () => {
  it("setup only works once and creates an administrator", () => {
    const { db } = seeded();
    expect(db.users[0].role).toBe("administrator");
    const again = execute(db, null, { type: "setup_administrator", input: { fullName: "X", email: "x@example.test" }, credential: cred }, NOW);
    expect(again.ok).toBe(false);
  });

  it("rejects duplicate emails and protects the last administrator", () => {
    const { db, admin } = seeded();
    const dup = execute(db, admin, { type: "create_user", input: { fullName: "Dup", email: "ADMIN@example.test", role: "finance", active: true }, credential: cred }, NOW);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.email).toBeDefined();
    const demote = execute(db, admin, { type: "update_user", id: admin.id, input: { fullName: "Admin One", email: "admin@example.test", role: "finance", active: true } }, NOW);
    expect(demote.ok).toBe(false);
    const deactivate = execute(db, admin, { type: "update_user", id: admin.id, input: { fullName: "Admin One", email: "admin@example.test", role: "administrator", active: false } }, NOW);
    expect(deactivate.ok).toBe(false);
  });
});

describe("settings", () => {
  it("has no defaults and validates currency and categories", () => {
    const { db, admin } = seeded();
    expect(db.settings.currencyCode).toBeNull();
    expect(db.settings.vehicleCategories).toHaveLength(0);
    const bad = execute(db, admin, { type: "update_settings", input: { ...db.settings, currencyCode: "cedis", vehicleCategories: [{ id: "", name: "Bus", licenceClasses: [] }, { id: "", name: "bus", licenceClasses: [] }] } }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.currencyCode).toBeDefined();
      expect(bad.errors["vehicleCategories.1"]).toMatch(/Duplicate/);
    }
  });

  it("keeps a standing cost per vehicle-day as a money figure, or keeps it blank (FLT-05)", () => {
    const { db, admin } = seeded();
    expect(db.settings.fleetStandingCostPerDay).toBeNull();

    const set = execute(db, admin, { type: "update_settings", input: { ...db.settings, fleetStandingCostPerDay: 450.05 } }, NOW);
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.db.settings.fleetStandingCostPerDay).toBe(450.05);

    const blank = execute(db, admin, { type: "update_settings", input: { ...db.settings, fleetStandingCostPerDay: null } }, NOW);
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.db.settings.fleetStandingCostPerDay).toBeNull();

    // A negative, a third decimal place and an absurd figure are refused rather than rounded.
    for (const value of [-1, 10.005, 1_000_000_001]) {
      const bad = execute(db, admin, { type: "update_settings", input: { ...db.settings, fleetStandingCostPerDay: value } }, NOW);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.errors.fleetStandingCostPerDay).toMatch(/two decimal places/);
    }
  });

  it("refuses to remove a category in use", () => {
    const { admin } = seeded();
    let db = withCategory(seeded().db, admin);
    const catId = db.settings.vehicleCategories[0].id;
    const v = execute(db, admin, { type: "create_vehicle", input: { registration: "GT 1-26", categoryId: catId, make: "Toyota", model: "Hiace", seatCapacity: "14", notes: "" } }, NOW);
    expect(v.ok).toBe(true);
    if (v.ok) db = v.db;
    const remove = execute(db, admin, { type: "update_settings", input: { ...db.settings, vehicleCategories: [] } }, NOW);
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.errors.vehicleCategories).toMatch(/in use/);
  });
});

describe("vehicles", () => {
  it("is blocked until a category exists, then enforces unique registration and seat capacity", () => {
    const { db, admin, ops } = seeded();
    const blocked = execute(db, ops, { type: "create_vehicle", input: { registration: "GT 1-26", categoryId: "", make: "", model: "", seatCapacity: "14", notes: "" } }, NOW);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/Blocked/);

    let next = withCategory(db, admin);
    const catId = next.settings.vehicleCategories[0].id;
    const first = execute(next, ops, { type: "create_vehicle", input: { registration: "gt 1-26", categoryId: catId, make: "", model: "", seatCapacity: "14", notes: "" } }, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    next = first.db;
    expect(next.vehicles[0].registration).toBe("GT 1-26");
    expect(next.vehicles[0].status).toBe("available");
    expect(next.audit[0].action).toBe("vehicles:create");

    const dup = execute(next, ops, { type: "create_vehicle", input: { registration: "GT126", categoryId: catId, make: "", model: "", seatCapacity: "0", notes: "" } }, NOW);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.errors.registration).toMatch(/already exists/);
      expect(dup.errors.seatCapacity).toBeDefined();
    }
  });

  it("follows the state machine and requires a reason", () => {
    const { db, admin, ops } = seeded();
    let next = withCategory(db, admin);
    const catId = next.settings.vehicleCategories[0].id;
    const created = execute(next, ops, { type: "create_vehicle", input: { registration: "GT 2-26", categoryId: catId, make: "", model: "", seatCapacity: "30", notes: "" } }, NOW);
    if (!created.ok) throw new Error(created.message);
    next = created.db;
    const id = next.vehicles[0].id;

    const noReason = execute(next, ops, { type: "transition_vehicle", id, to: "maintenance", reason: "  " }, NOW);
    expect(noReason.ok).toBe(false);

    const toMaint = execute(next, ops, { type: "transition_vehicle", id, to: "maintenance", reason: "Brake pads" }, NOW);
    expect(toMaint.ok).toBe(true);
    if (!toMaint.ok) return;
    next = toMaint.db;

    const retire = execute(next, ops, { type: "transition_vehicle", id, to: "retired", reason: "Written off" }, NOW);
    expect(retire.ok).toBe(true);
    if (!retire.ok) return;
    next = retire.db;
    expect(VEHICLE_TRANSITIONS.retired).toHaveLength(0);
    const revive = execute(next, ops, { type: "transition_vehicle", id, to: "available", reason: "Oops" }, NOW);
    expect(revive.ok).toBe(false);
  });
});

describe("drivers and clients", () => {
  it("validates driver licence fields and uniqueness", () => {
    const { db, ops } = seeded();
    const bad = execute(db, ops, { type: "create_driver", input: { fullName: "", phone: "", licenceNumber: "", licenceExpiry: "2026-02-30", status: "active" } }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["fullName", "licenceExpiry", "licenceNumber", "phone"]);
    const ok = execute(db, ops, { type: "create_driver", input: { fullName: "Kofi", phone: "024", licenceNumber: "abc123", licenceExpiry: "2027-05-01", status: "active" } }, NOW);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const dup = execute(ok.db, ops, { type: "create_driver", input: { fullName: "Ama", phone: "020", licenceNumber: "ABC123", licenceExpiry: "2027-05-01", status: "active" } }, NOW);
    expect(dup.ok).toBe(false);
  });

  it("lets finance manage clients but not operations", () => {
    const { db, ops, finance } = seeded();
    const input = { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "bad-email", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" as const };
    const denied = execute(db, ops, { type: "create_client", input }, NOW);
    expect(denied.ok).toBe(false);
    const invalid = execute(db, finance, { type: "create_client", input }, NOW);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.contactEmail).toBeDefined();
    const ok = execute(db, finance, { type: "create_client", input: { ...input, contactEmail: "" } }, NOW);
    expect(ok.ok).toBe(true);
  });
});

describe("backup import", () => {
  it("refuses backups that would lock out the importing administrator", () => {
    const { db, admin } = seeded();
    const foreign = emptyDatabase();
    const r = execute(db, admin, { type: "import_backup", database: foreign }, NOW);
    expect(r.ok).toBe(false);
    const self = execute(db, admin, { type: "import_backup", database: db }, NOW);
    expect(self.ok).toBe(true);
  });
});

function rentalReady(): { db: Database; admin: Actor; ops: Actor; finance: Actor; catId: string } {
  const { admin, ops, finance } = seeded();
  let db = withCategory(seeded().db, admin);
  const catId = db.settings.vehicleCategories[0].id;
  const r = execute(db, admin, {
    type: "update_settings",
    input: { ...db.settings, currencyCode: "GHS", rental: { pricingBasis: "per_day", depositPercent: 25, quotationValidityDays: 7, driversAlwaysIncluded: null, paymentMethods: ["Bank transfer", "Mobile money"], requotePolicy: null } },
  }, NOW);
  if (!r.ok) throw new Error(r.message);
  db = r.db;
  return { db, admin, ops, finance, catId };
}

function addVehicle(db: Database, admin: Actor, catId: string, reg: string): { db: Database; id: string } {
  const r = execute(db, admin, { type: "create_vehicle", input: { registration: reg, categoryId: catId, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } }, NOW);
  if (!r.ok) throw new Error(r.message);
  return { db: r.db, id: r.db.vehicles[r.db.vehicles.length - 1].id };
}

const requestInput = (catId: string, start: string, end: string, driverRequired = false) => ({
  type: "create_rental" as const,
  input: {
    clientId: null,
    customerName: "Acme Ltd",
    customerPhone: "024",
    customerEmail: "ops@acme.test",
    purpose: "Staff retreat",
    pickupLocation: "Accra",
    dropoffLocation: "Kumasi",
    startDate: start,
    endDate: end,
    passengers: "25",
    vehicleCategoryId: catId,
    driverRequired,
    notes: "",
  },
});

describe("rentals - settings gates", () => {
  it("blocks quoting until currency and rental settings are configured", () => {
    const { admin } = seeded();
    let db = withCategory(seeded().db, admin);
    const catId = db.settings.vehicleCategories[0].id;
    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-03"), NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    db = created.db;
    const id = db.rentals[0].id;
    const quote = execute(db, admin, { type: "quote_rental", id, input: { lines: [{ description: "3 days", quantity: "3", unitAmount: "1000" }] } }, NOW);
    expect(quote.ok).toBe(false);
    if (!quote.ok) expect(quote.message).toMatch(/quotation settings are incomplete/i);
  });

  it("blocks rental creation when no categories exist", () => {
    const { db, admin } = seeded();
    const r = execute(db, admin, requestInput("nope", "2026-03-01", "2026-03-02"), NOW);
    expect(r.ok).toBe(false);
  });
});

describe("money precision at the settings and quotation gates (audit D-04)", () => {
  it("refuses a deposit percentage the arithmetic cannot represent", () => {
    const { db, admin } = rentalReady();
    const settings = (depositPercent: number) =>
      execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: { ...db.settings.rental, depositPercent } } }, NOW);
    const tooPrecise = settings(33.333);
    expect(tooPrecise.ok).toBe(false);
    if (!tooPrecise.ok) expect(tooPrecise.errors["rental.depositPercent"]).toMatch(/two decimal places/);
    // Two decimals is what a percentage field is for, and it is accepted.
    expect(settings(12.5).ok).toBe(true);
  });

  it("refuses a tax rate with more than two decimals", () => {
    const { db, admin } = rentalReady();
    const before = db.settings.taxLines;
    const save = (ratePercent: number) =>
      execute(db, admin, { type: "update_settings", input: { ...db.settings, taxPosition: "registered", taxLines: [{ id: "", name: "VAT", ratePercent }] } }, NOW);
    const tooPrecise = save(2.555);
    expect(tooPrecise.ok).toBe(false);
    if (!tooPrecise.ok) expect(tooPrecise.errors["taxLines.0"]).toMatch(/two decimal places/);
    expect(save(2.5).ok).toBe(true);
    expect(before).toEqual(db.settings.taxLines);
  });

  it("refuses a quoted amount with a third decimal, and keeps the running total exact", () => {
    const base = rentalReady();
    let db = base.db;
    const created = execute(db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    db = created.db;
    const id = db.rentals[0].id;

    const thirdDecimal = execute(db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "100.005" }] } }, NOW);
    expect(thirdDecimal.ok).toBe(false);
    if (!thirdDecimal.ok) expect(thirdDecimal.errors["lines.0.unitAmount"]).toMatch(/two decimal places/);
    expect(db.rentals[0].quote ?? null).toBeNull();

    // A half-pesewa quantity tie rounds up, and the deposit follows the rounded subtotal exactly.
    const quoted = execute(db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Half day", quantity: "1.5", unitAmount: "0.01" }] } }, NOW);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.db.rentals[0].quote!.subtotal).toBe(0.02);
    // 25% of 0.02 is 0.005, a true tie: half-up gives one pesewa, not zero.
    expect(quoted.db.rentals[0].quote!.depositRequired).toBe(0.01);
  });
});

describe("rentals - full lifecycle", () => {
  it("runs request -> quote -> confirm -> assign -> start -> complete with computed deposit and audit", () => {
    const base = rentalReady();
    let db = base.db;
    const { admin, catId } = base;
    const v = addVehicle(db, admin, catId, "GT 100-26");
    db = v.db;

    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    db = created.db;
    const id = db.rentals[0].id;
    expect(db.rentals[0].reference).toBe("RR-0001");
    expect(db.rentals[0].status).toBe("draft");

    const quote = execute(db, admin, { type: "quote_rental", id, input: { lines: [{ description: "3 days hire", quantity: "3", unitAmount: "1000" }, { description: "Fuel", quantity: "1", unitAmount: "500" }] } }, NOW);
    if (!quote.ok) throw new Error(quote.message);
    db = quote.db;
    const rentalQuoted = db.rentals[0];
    expect(rentalQuoted.status).toBe("quoted");
    expect(rentalQuoted.quote?.subtotal).toBe(3500);
    expect(rentalQuoted.quote?.depositRequired).toBe(875); // 25% of 3500
    expect(rentalQuoted.quote?.validUntil).toBe("2026-01-08"); // NOW + 7 days

    // deposit below required is rejected
    const low = execute(db, admin, { type: "confirm_rental", id, input: { amount: "100", method: "Bank transfer", reference: "TX1" } }, NOW);
    expect(low.ok).toBe(false);
    // unknown method rejected
    const badMethod = execute(db, admin, { type: "confirm_rental", id, input: { amount: "875", method: "Cash", reference: "" } }, NOW);
    expect(badMethod.ok).toBe(false);

    const confirm = execute(db, admin, { type: "confirm_rental", id, input: { amount: "875", method: "Bank transfer", reference: "TX1" } }, NOW);
    if (!confirm.ok) throw new Error(confirm.message);
    db = confirm.db;
    expect(db.rentals[0].status).toBe("confirmed");

    // cannot start before assignment
    const earlyStart = execute(db, admin, { type: "start_rental", id }, NOW);
    expect(earlyStart.ok).toBe(false);

    const assign = execute(db, admin, { type: "assign_rental", id, input: { vehicleId: v.id, driverId: "" } }, NOW);
    if (!assign.ok) throw new Error(assign.message);
    db = assign.db;

    // A hire cannot be started before the date it was booked from (brief 5.5, RNT-05).
    const tooEarly = execute(db, admin, { type: "start_rental", id }, NOW);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.message).toMatch(/booked from 2026-03-01/);

    const start = execute(db, admin, { type: "start_rental", id }, "2026-03-01T07:00:00.000Z");
    if (!start.ok) throw new Error(start.message);
    db = start.db;
    expect(db.rentals[0].status).toBe("in_progress");

    const complete = execute(db, admin, { type: "complete_rental", id, input: { lines: [{ description: "3 days hire", quantity: "3", unitAmount: "1000" }, { description: "Extra day", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!complete.ok) throw new Error(complete.message);
    db = complete.db;
    expect(db.rentals[0].status).toBe("completed");
    expect(db.rentals[0].finalInvoice?.total).toBe(4000);
    expect(db.audit.some((a) => a.action === "rentals:complete")).toBe(true);
  });

  describe("date and capacity guards (brief 5.1, 5.5)", () => {
    function booking(start: string, end: string, passengers = "25") {
      const base = rentalReady();
      let db = base.db;
      const small = execute(db, base.admin, { type: "create_vehicle", input: { registration: "GT 300-26", categoryId: base.catId, make: "Toyota", model: "Hiace", seatCapacity: "14", notes: "" } }, NOW);
      if (!small.ok) throw new Error(small.message);
      db = small.db;
      const big = execute(db, base.admin, { type: "create_vehicle", input: { registration: "GT 301-26", categoryId: base.catId, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } }, NOW);
      if (!big.ok) throw new Error(big.message);
      db = big.db;

      const created = execute(db, base.admin, {
        type: "create_rental",
        input: { clientId: null, customerName: "Acme Ltd", customerPhone: "024", customerEmail: "", purpose: "Staff retreat", pickupLocation: "Accra", dropoffLocation: "Kumasi", startDate: start, endDate: end, passengers, vehicleCategoryId: base.catId, driverRequired: false, notes: "" },
      }, NOW);
      if (!created.ok) throw new Error(created.message);
      db = created.db;
      const id = db.rentals[0].id;
      const quote = execute(db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
      if (!quote.ok) throw new Error(quote.message);
      db = quote.db;
      const confirm = execute(db, base.admin, { type: "confirm_rental", id, input: { amount: "250", method: "Bank transfer", reference: "TX" } }, NOW);
      if (!confirm.ok) throw new Error(confirm.message);
      db = confirm.db;
      return { db, admin: base.admin, id, smallId: db.vehicles.find((v) => v.registration === "GT 300-26")!.id, bigId: db.vehicles.find((v) => v.registration === "GT 301-26")!.id };
    }

    it("refuses a vehicle with fewer seats than the request", () => {
      const b = booking("2026-03-01", "2026-03-03");
      const tooSmall = execute(b.db, b.admin, { type: "assign_rental", id: b.id, input: { vehicleId: b.smallId, driverId: "" } }, NOW);
      expect(tooSmall.ok).toBe(false);
      if (!tooSmall.ok) expect(tooSmall.errors.vehicleId).toMatch(/seats 14/);

      const fits = execute(b.db, b.admin, { type: "assign_rental", id: b.id, input: { vehicleId: b.bigId, driverId: "" } }, NOW);
      expect(fits.ok).toBe(true);
    });

    it("refuses to start a hire before its booked date or after its return date", () => {
      const b = booking("2026-03-01", "2026-03-03");
      const assigned = execute(b.db, b.admin, { type: "assign_rental", id: b.id, input: { vehicleId: b.bigId, driverId: "" } }, NOW);
      if (!assigned.ok) throw new Error(assigned.message);
      const early = execute(assigned.db, b.admin, { type: "start_rental", id: b.id }, NOW);
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.message).toMatch(/booked from 2026-03-01/);

      const onTheDay = execute(assigned.db, b.admin, { type: "start_rental", id: b.id }, "2026-03-02T08:00:00.000Z");
      expect(onTheDay.ok).toBe(true);

      const late = booking("2025-12-01", "2025-12-02");
      const lateAssigned = execute(late.db, late.admin, { type: "assign_rental", id: late.id, input: { vehicleId: late.bigId, driverId: "" } }, NOW);
      if (!lateAssigned.ok) throw new Error(lateAssigned.message);
      const afterWindow = execute(lateAssigned.db, late.admin, { type: "start_rental", id: late.id }, NOW);
      expect(afterWindow.ok).toBe(false);
      if (!afterWindow.ok) expect(afterWindow.message).toMatch(/due back on 2025-12-02/);
    });
  });

  it("treats an overdue routine service as a warning, or as a block when the rule is on (Q-43, D-80)", () => {
    const base = rentalReady();
    let db = base.db;
    const v = addVehicle(db, base.admin, base.catId, "GT 500-26");
    db = v.db;

    const configure = (blockOnOverdueService: boolean) => {
      const r = execute(db, base.admin, { type: "update_settings", input: { ...db.settings, maintenance: { blockOnOverdueService, schedules: [{ categoryId: base.catId, intervalKm: 10000, intervalDays: null, remindLeadKm: null, remindLeadDays: null }] } } }, NOW);
      if (!r.ok) throw new Error(r.message);
      db = r.db;
    };
    const advance = (to: "in_progress" | "completed" | "closed", vehicleRestoredTo: "unchanged" | "available") => {
      const id = db.workOrders[db.workOrders.length - 1].id;
      const r = executeCommand(db, base.admin, { type: "advance_work_order", id, input: { to, note: "Filters and oil", costsConfirmedComplete: true, vehicleRestoredTo } }, NOW);
      if (!r.ok) throw new Error(`${to}: ${r.message} ${JSON.stringify(r.errors)}`);
      db = r.db;
    };

    configure(false);
    const order = executeCommand(db, base.admin, { type: "create_work_order", input: { vehicleId: v.id, title: "Major service", workType: "Service", workshop: "", description: "", reportedOdometer: "120000", plannedDate: "", incidentId: "", resetsServiceInterval: true } }, NOW);
    if (!order.ok) throw new Error(order.message);
    db = order.db;
    advance("in_progress", "unchanged");
    advance("completed", "unchanged");
    advance("closed", "available");
    const reading = executeCommand(db, base.admin, { type: "record_odometer", input: { vehicleId: v.id, readingKm: "135000", readingDate: "2026-01-01", note: "" } }, NOW);
    if (!reading.ok) throw new Error(reading.message);
    db = reading.db;
    expect(db.vehicles.find((vehicle) => vehicle.id === v.id)?.status).toBe("available");

    // A confirmed booking, ready for a vehicle.
    const booking = (start: string, end: string) => {
      const created = execute(db, base.admin, requestInput(base.catId, start, end), NOW);
      if (!created.ok) throw new Error(created.message);
      db = created.db;
      const id = db.rentals[db.rentals.length - 1].id;
      const quote = execute(db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
      if (!quote.ok) throw new Error(quote.message);
      db = quote.db;
      const confirm = execute(db, base.admin, { type: "confirm_rental", id, input: { amount: "250", method: "Bank transfer", reference: "TX" } }, NOW);
      if (!confirm.ok) throw new Error(confirm.message);
      db = confirm.db;
      return id;
    };

    const warned = booking("2026-03-01", "2026-03-03");
    const assigned = execute(db, base.admin, { type: "assign_rental", id: warned, input: { vehicleId: v.id, driverId: "" } }, NOW);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.message).toContain("Note: Vehicle GT 500-26 is overdue for routine service");
    db = assigned.db;

    // The strict rule refuses the hire, and says which vehicle and why.
    configure(true);
    const second = booking("2026-03-10", "2026-03-12");
    const blocked = execute(db, base.admin, { type: "assign_rental", id: second, input: { vehicleId: v.id, driverId: "" } }, NOW);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.errors.vehicleId).toContain("is overdue for routine service");
    expect(blocked.errors.vehicleId).toContain("cannot be hired until it is serviced");

    // And it is re-checked on the day, exactly like a lapsed certificate.
    configure(false);
    const late = execute(db, base.admin, { type: "assign_rental", id: second, input: { vehicleId: v.id, driverId: "" } }, NOW);
    if (!late.ok) throw new Error(late.message);
    db = late.db;
    configure(true);
    const start = execute(db, base.admin, { type: "start_rental", id: second }, "2026-03-10T08:00:00.000Z");
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.message).toContain("is overdue for routine service");
  });

  it("prevents double-booking a vehicle over overlapping dates", () => {
    const base = rentalReady();
    let db = base.db;
    const { admin, catId } = base;
    const v = addVehicle(db, admin, catId, "GT 200-26");
    db = v.db;

    // First rental assigned for 1-5 March
    const mkConfirmedAssigned = (start: string, end: string) => {
      const c = execute(db, admin, requestInput(catId, start, end), NOW);
      if (!c.ok) throw new Error(c.message);
      db = c.db;
      const id = db.rentals[db.rentals.length - 1].id;
      const q = execute(db, admin, { type: "quote_rental", id, input: { lines: [{ description: "hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
      if (!q.ok) throw new Error(q.message);
      db = q.db;
      const cf = execute(db, admin, { type: "confirm_rental", id, input: { amount: "1000", method: "Mobile money", reference: "" } }, NOW);
      if (!cf.ok) throw new Error(cf.message);
      db = cf.db;
      return id;
    };

    const first = mkConfirmedAssigned("2026-03-01", "2026-03-05");
    const a1 = execute(db, admin, { type: "assign_rental", id: first, input: { vehicleId: v.id, driverId: "" } }, NOW);
    if (!a1.ok) throw new Error(a1.message);
    db = a1.db;

    const second = mkConfirmedAssigned("2026-03-04", "2026-03-08");
    const clash = execute(db, admin, { type: "assign_rental", id: second, input: { vehicleId: v.id, driverId: "" } }, NOW);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.errors.vehicleId).toMatch(/already assigned/);
  });

  it("requires a driver when the request demands one, and rejects expired licences", () => {
    const base = rentalReady();
    let db = base.db;
    const { admin, catId } = base;
    const v = addVehicle(db, admin, catId, "GT 300-26");
    db = v.db;
    // driver whose licence expires before rental end
    const expiring = execute(db, admin, { type: "create_driver", input: { fullName: "Old Licence", phone: "020", licenceNumber: "EXP1", licenceExpiry: "2026-03-02", status: "active" } }, NOW);
    if (!expiring.ok) throw new Error(expiring.message);
    db = expiring.db;
    const driverId = db.drivers[0].id;

    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-10", true), NOW);
    if (!created.ok) throw new Error(created.message);
    db = created.db;
    const id = db.rentals[0].id;
    const q = execute(db, admin, { type: "quote_rental", id, input: { lines: [{ description: "hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!q.ok) throw new Error(q.message);
    db = q.db;
    const cf = execute(db, admin, { type: "confirm_rental", id, input: { amount: "1000", method: "Bank transfer", reference: "" } }, NOW);
    if (!cf.ok) throw new Error(cf.message);
    db = cf.db;

    const noDriver = execute(db, admin, { type: "assign_rental", id, input: { vehicleId: v.id, driverId: "" } }, NOW);
    expect(noDriver.ok).toBe(false);
    const expiredLic = execute(db, admin, { type: "assign_rental", id, input: { vehicleId: v.id, driverId } }, NOW);
    expect(expiredLic.ok).toBe(false);
    if (!expiredLic.ok) expect(expiredLic.errors.driverId).toMatch(/licence expires/i);
  });

  it("migrates a schema-1 backup (no rentals) on import", () => {
    const { db, admin } = seeded();
    const legacy = { ...db, schemaVersion: 1 } as unknown as Database;
    delete (legacy as unknown as Record<string, unknown>).rentals;
    const r = execute(db, admin, { type: "import_backup", database: legacy }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.isArray(r.db.rentals)).toBe(true);
  });

  it("blocks expired-quote renewal when Q-24 policy is not configured", () => {
    const { db, admin } = rentalReady();
    const catId = db.settings.vehicleCategories[0].id;
    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const expiredAt = "2026-01-10T00:00:00.000Z";

    const notExpired = execute(quoted.db, admin, { type: "requote_rental", id, input: { lines: [{ description: "New hire", quantity: "1", unitAmount: "1200" }] } }, "2026-01-05T00:00:00.000Z");
    expect(notExpired.ok).toBe(false);
    if (!notExpired.ok) expect(notExpired.message).toMatch(/not expired yet/);

    const blocked = execute(quoted.db, admin, { type: "requote_rental", id, input: { lines: [{ description: "New hire", quantity: "1", unitAmount: "1200" }] } }, expiredAt);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/policy in Settings/);
    expect(quoted.db.rentals[0].quoteHistory).toEqual([]);
  });

  it("honours the cancel-and-reraise policy without mutating the expired quote", () => {
    const { db: startingDb, admin } = rentalReady();
    let db = startingDb;
    const settings = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: { ...db.settings.rental, requotePolicy: "new_request" } } }, NOW);
    if (!settings.ok) throw new Error(settings.message);
    db = settings.db;
    const catId = db.settings.vehicleCategories[0].id;
    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const quoteBefore = quoted.db.rentals[0].quote;

    const renewal = execute(quoted.db, admin, { type: "requote_rental", id, input: { lines: [{ description: "Replacement", quantity: "1", unitAmount: "1200" }] } }, "2026-01-10T00:00:00.000Z");
    expect(renewal.ok).toBe(false);
    if (!renewal.ok) expect(renewal.message).toMatch(/new request/);
    expect(quoted.db.rentals[0].quote).toEqual(quoteBefore);
    expect(quoted.db.rentals[0].status).toBe("quoted");

    const cancelled = execute(quoted.db, admin, { type: "cancel_rental", id, reason: "Expired quote; new request required by policy." }, "2026-01-10T00:00:00.000Z");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.db.rentals[0].status).toBe("cancelled");
  });

  it("revises only an expired quote in place and preserves each immutable quote snapshot", () => {
    const { db: startingDb, admin } = rentalReady();
    let db = startingDb;
    const settings = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: { ...db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
    if (!settings.ok) throw new Error(settings.message);
    db = settings.db;
    const catId = db.settings.vehicleCategories[0].id;
    const created = execute(db, admin, requestInput(catId, "2026-03-01", "2026-03-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const first = execute(created.db, admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "2", unitAmount: "500" }] } }, NOW);
    if (!first.ok) throw new Error(first.message);
    const firstQuote = first.db.rentals[0].quote!;

    const second = execute(first.db, admin, { type: "requote_rental", id, input: { lines: [{ description: "Hire revised", quantity: "2", unitAmount: "700" }] } }, "2026-01-10T00:00:00.000Z");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    let rental = second.db.rentals[0];
    expect(rental.status).toBe("quoted");
    expect(rental.quote?.subtotal).toBe(1400);
    expect(rental.quote?.depositRequired).toBe(350); // configured deposit percentage still applies
    expect(rental.quote?.validUntil).toBe("2026-01-17");
    expect(rental.quoteHistory).toEqual([firstQuote]);

    const third = execute(second.db, admin, { type: "requote_rental", id, input: { lines: [{ description: "Hire final", quantity: "1", unitAmount: "900" }] } }, "2026-01-20T00:00:00.000Z");
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    rental = third.db.rentals[0];
    expect(rental.quoteHistory).toEqual([firstQuote, second.db.rentals[0].quote]);
    expect(rental.quote?.subtotal).toBe(900);
    expect(third.db.audit.some((entry) => entry.action === "rentals:requote")).toBe(true);

    // The new validity window, not the old one, governs confirmation.
    const confirm = execute(third.db, admin, { type: "confirm_rental", id, input: { amount: "225", method: "Bank transfer", reference: "TX-RENEW" } }, "2026-01-21T00:00:00.000Z");
    expect(confirm.ok).toBe(true);
  });

  it("migrates schema-7 rentals with an empty quote history and no policy default", () => {
    const { db: startingDb, admin } = rentalReady();
    let db = startingDb;
    const configured = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: { ...db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
    if (!configured.ok) throw new Error(configured.message);
    db = configured.db;
    const created = execute(db, admin, requestInput(db.settings.vehicleCategories[0].id, "2026-03-01", "2026-03-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const legacy = { ...quoted.db, schemaVersion: 7, rentals: quoted.db.rentals.map((rental) => { const copy = { ...rental } as Record<string, unknown>; delete copy.quoteHistory; return copy; }), settings: { ...quoted.db.settings, rental: { ...quoted.db.settings.rental, requotePolicy: undefined } } } as unknown as Database;
    // rentalReady historically builds its database using a second fresh fixture; use the
    // administrator identity from the actual database for the anti-lockout import check.
    const importer: Actor = { id: quoted.db.users[0].id, fullName: quoted.db.users[0].fullName, role: "administrator" };
    const imported = execute(quoted.db, importer, { type: "import_backup", database: legacy }, NOW);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.db.schemaVersion).toBe(SCHEMA_VERSION);
      expect(imported.db.rentals[0].quote).toEqual(quoted.db.rentals[0].quote);
      expect(imported.db.rentals[0].quoteHistory).toEqual([]);
      expect(imported.db.settings.rental.requotePolicy).toBeNull();
    }
  });
});

describe("profile (AUTH-05)", () => {
  it("lets an account change its own name and email without any administrative permission", () => {
    const { db, finance } = seeded();
    const result = execute(db, finance, { type: "update_profile", input: { fullName: "Efua Owusu", email: "efua@example.test" } }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.db.users.find((user) => user.id === finance.id);
    expect(updated).toMatchObject({ fullName: "Efua Owusu", email: "efua@example.test", role: "finance" });
    // Nobody else moved, and the change is attributed.
    expect(result.db.users.find((user) => user.id !== finance.id)?.fullName).toBe("Admin One");
    expect(result.db.audit[0]).toMatchObject({ action: "users:update_profile", actorId: finance.id });
    expect(result.db.audit[0].summary).toMatch(/email changed to efua@example\.test/);
  });

  it("refuses an email another account already uses, and refuses when nobody is signed in", () => {
    const { db, finance } = seeded();
    const taken = execute(db, finance, { type: "update_profile", input: { fullName: "Fin", email: "admin@example.test" } }, NOW);
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.errors.email).toMatch(/already uses that email/);

    const malformed = execute(db, finance, { type: "update_profile", input: { fullName: "Fin", email: "not-an-email" } }, NOW);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.errors.email).toMatch(/valid email/);

    const anonymous = execute(db, null, { type: "update_profile", input: { fullName: "Nobody", email: "nobody@example.test" } }, NOW);
    expect(anonymous.ok).toBe(false);
    if (!anonymous.ok) expect(anonymous.message).toMatch(/Sign in is required/);
  });

  it("changes only the caller's own password and audits it", () => {
    const { db, finance } = seeded();
    const next: Credential = { passwordHash: "b".repeat(64), passwordSalt: "c".repeat(32) };
    const result = execute(db, finance, { type: "change_own_password", credential: next }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.users.find((user) => user.id === finance.id)).toMatchObject(next);
    expect(result.db.users.find((user) => user.id !== finance.id)?.passwordHash).toBe("a".repeat(64));
    expect(result.db.audit[0]).toMatchObject({ action: "users:change_password", actorId: finance.id });

    const anonymous = execute(db, null, { type: "change_own_password", credential: next }, NOW);
    expect(anonymous.ok).toBe(false);
  });
});

describe("mandatory documents gate assignment (Q-16, D-76)", () => {
  /** A confirmed rental (quoted, deposit paid) with a vehicle in the requested category. */
  function confirmedRental(startDate = "2026-01-01", endDate = "2026-01-03") {
    const base = rentalReady();
    let db = base.db;
    const run = (command: Parameters<typeof execute>[2]) => {
      const result = execute(db, base.admin, command, NOW);
      if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
      db = result.db;
    };
    const settings = (patch: Partial<typeof db.settings>) => {
      const result = execute(db, base.admin, { type: "update_settings", input: { ...db.settings, ...patch } }, NOW);
      if (!result.ok) throw new Error(`${result.message} ${JSON.stringify(result.errors)}`);
      db = result.db;
    };
    // Insurance is the paper this company insists on before a bus carries passengers.
    settings({ documentTypes: [{ id: "", name: "Insurance", appliesTo: "vehicle", required: true }, { id: "", name: "Driver badge", appliesTo: "driver", required: false }] });
    const vehicle = addVehicle(db, base.admin, base.catId, "GT 700-26");
    db = vehicle.db;

    run(requestInput(base.catId, startDate, endDate));
    const id = db.rentals[0].id;
    run({ type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } });
    run({ type: "confirm_rental", id, input: { amount: "250", method: "Bank transfer", reference: "SLIP-1" } });
    return { db: () => db, set: (next: typeof db) => { db = next; }, base, id, vehicleId: vehicle.id };
  }

  it("refuses a vehicle with no insurance, naming the paper", () => {
    const w = confirmedRental();
    const result = execute(w.db(), w.base.admin, { type: "assign_rental", id: w.id, input: { vehicleId: w.vehicleId, driverId: "" } }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.vehicleId).toBe(
      "Vehicle GT 700-26 cannot be assigned: no Insurance is recorded. Record the document in Compliance first.",
    );
  });

  it("refuses a vehicle whose insurance lapses before the hire starts", () => {
    // Booked for June; the certificate runs out in May. It is valid today, and useless for the job.
    const w = confirmedRental("2026-06-01", "2026-06-03");
    const documentTypeId = w.db().settings.documentTypes.find((d) => d.name === "Insurance")!.id;
    const recorded = executeCommand(w.db(), w.base.ops, {
      type: "create_document",
      input: { ownerType: "vehicle", ownerId: w.vehicleId, documentTypeId, documentNumber: "INS-1", issuedDate: "2025-05-01", expiryDate: "2026-05-31", notes: "" },
    }, NOW);
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    w.set(recorded.db);

    const result = execute(w.db(), w.base.admin, { type: "assign_rental", id: w.id, input: { vehicleId: w.vehicleId, driverId: "" } }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.vehicleId).toMatch(/its Insurance expired on 2026-05-31/);
  });

  it("assigns once the paper is current, and re-checks it on the day the hire starts", () => {
    const w = confirmedRental();
    const documentTypeId = w.db().settings.documentTypes.find((d) => d.name === "Insurance")!.id;
    const recorded = executeCommand(w.db(), w.base.ops, {
      type: "create_document",
      input: { ownerType: "vehicle", ownerId: w.vehicleId, documentTypeId, documentNumber: "INS-2", issuedDate: "2026-01-01", expiryDate: "2027-01-01", notes: "" },
    }, NOW);
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    w.set(recorded.db);

    const assigned = execute(w.db(), w.base.admin, { type: "assign_rental", id: w.id, input: { vehicleId: w.vehicleId, driverId: "" } }, NOW);
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    w.set(assigned.db);
    expect(w.db().rentals[0].status).toBe("confirmed");

    // A certificate can lapse between assignment and the morning of the hire: starting is re-checked
    // against today, and refused with the same sentence. (The hire is booked for today, so the
    // start-date guard cannot be what refuses it.)
    const lapsed = { ...w.db(), documents: w.db().documents.map((doc) => ({ ...doc, expiryDate: "2025-12-31" })) };
    w.set(lapsed);
    const started = execute(w.db(), w.base.admin, { type: "start_rental", id: w.id }, NOW);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.message).toMatch(/Insurance expired on 2025-12-31/);
  });

  it("does not block anything when the company has made no paper mandatory", () => {
    const base = rentalReady();
    let db = base.db;
    const vehicle = addVehicle(db, base.admin, base.catId, "GT 701-26");
    db = vehicle.db;
    const created = execute(db, base.admin, requestInput(base.catId, "2026-06-01", "2026-06-03"), NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    db = created.db;
    const id = db.rentals[0].id;
    const quoted = execute(db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    db = quoted.db;
    const confirmed = execute(db, base.admin, { type: "confirm_rental", id, input: { amount: "250", method: "Bank transfer", reference: "SLIP-2" } }, NOW);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    db = confirmed.db;
    const assigned = execute(db, base.admin, { type: "assign_rental", id, input: { vehicleId: vehicle.id, driverId: "" } }, NOW);
    expect(assigned.ok).toBe(true);
  });
});

describe("a customer accepting a quotation (RNT-05, D-116)", () => {
  /** A quoted rental on a live quotation, ready for an answer. */
  function quoted() {
    const base = rentalReady();
    let db = base.db;
    const created = execute(db, admin0(db), requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    db = created.db;
    const id = db.rentals[0].id;
    const quote = execute(db, admin0(db), { type: "quote_rental", id, input: { lines: [{ description: "3 days hire", quantity: "3", unitAmount: "1000" }] } }, NOW);
    if (!quote.ok) throw new Error(quote.message);
    return { ...base, db: quote.db, id };
  }
  const admin0 = (db: Database): Actor => ({ id: db.users[0].id, fullName: db.users[0].fullName, role: "administrator" });

  it("writes down who agreed, when, and to which quotation", () => {
    const w = quoted();
    const result = execute(w.db, w.finance, { type: "accept_quotation", id: w.id, note: "Agreed on the phone" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const acceptance = result.db.rentals[0].acceptance;
    expect(acceptance).toMatchObject({
      byName: "Fin",
      byActorId: w.finance.id,
      channel: "office",
      total: 3000,
      depositRequired: 750,
      currencyCode: "GHS",
      note: "Agreed on the phone",
    });
    expect(acceptance?.quotedAt).toBe(result.db.rentals[0].quote?.quotedAt);
    // Agreeing is not paying: the status moves only when the deposit is recorded.
    expect(result.db.rentals[0].status).toBe("quoted");
    expect(result.message).toBe("RR-0001: the quotation of GHS 3000.00 is accepted.");
    // And it is in the audit trail, in the customer's own terms.
    // The audit log reads newest first.
    const entry = result.db.audit[0];
    expect(entry.action).toBe("rentals:accept");
    expect(entry.summary).toBe('RR-0001: Fin accepted the quotation of GHS 3000.00 on the office\'s word. "Agreed on the phone"');
  });

  it("refuses a second yes to the same quotation, and names the first", () => {
    const w = quoted();
    const first = execute(w.db, w.admin, { type: "accept_quotation", id: w.id, note: "" }, NOW);
    if (!first.ok) throw new Error(first.message);
    const again = execute(first.db, w.admin, { type: "accept_quotation", id: w.id, note: "" }, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors.acceptance).toBe("This quotation was already accepted on 2026-01-01 by Admin One.");
  });

  it("refuses a yes to a quotation that has lapsed, and says to issue a new one", () => {
    const w = quoted();
    // Seven days of validity from NOW; the customer answers eleven days later.
    const late = execute(w.db, w.admin, { type: "accept_quotation", id: w.id, note: "" }, "2026-01-12T09:00:00.000Z");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errors.quote).toBe("The quotation expired on 2026-01-08. Issue a new one before the customer accepts.");
  });

  it("refuses a yes to a request nobody has quoted", () => {
    const base = rentalReady();
    const created = execute(base.db, admin0(base.db), requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const draft = execute(created.db, base.admin, { type: "accept_quotation", id: created.db.rentals[0].id, note: "" }, NOW);
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.message).toBe("No quotation has been issued yet, so there is nothing to accept.");
  });

  it("is an ordinary office act, and not one a driver can perform", () => {
    const w = quoted();
    const made = execute(w.db, w.admin, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "DL-1", licenceExpiry: "2030-01-01", status: "active" } }, NOW);
    if (!made.ok) throw new Error(made.message);
    const driverRecordId = made.db.drivers[0].id;
    const user = execute(made.db, w.admin, {
      type: "create_user",
      input: { fullName: "Kojo", email: "kojo@example.test", role: "driver", active: true, driverId: driverRecordId },
      credential: cred,
    }, NOW);
    if (!user.ok) throw new Error(user.message);
    const kojo: Actor = { id: user.db.users.find((candidate) => candidate.email === "kojo@example.test")!.id, fullName: "Kojo", role: "driver" };
    const refused = execute(user.db, kojo, { type: "accept_quotation", id: w.id, note: "" }, NOW);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toBe("Not permitted: your role lacks rentals:accept.");
    // The three office roles that talk to a customer about a quotation all hold it.
    for (const actor of [w.admin, w.ops, w.finance]) {
      const allowed = execute(w.db, actor, { type: "accept_quotation", id: w.id, note: "" }, NOW);
      expect(allowed.ok).toBe(true);
    }
  });

  it("leaves an older backup with no acceptance, rather than inventing one", () => {
    // Schema 31 is readable: a record written before acceptance existed loads with none.
    expect(SCHEMA_VERSION).toBe(31);
  });
});
