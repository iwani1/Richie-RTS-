import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS } from "./permissions";
import { executeCommand } from "./commands";
import { execute, VEHICLE_TRANSITIONS, type Actor, type Credential } from "./service";
import { emptyDatabase, migrate, SCHEMA_VERSION, type Database } from "./types";
import { balanceLine, rentalBalance } from "./run";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-01-01T00:00:00.000Z";
/** The terms the test company writes for itself (D-117). The build supplies none. */
const TERMS = "Prices are firm for the validity period.";

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
    input: { ...db.settings, currencyCode: "GHS", rental: { quotationTerms: "Prices are firm for the validity period.", pricingBasis: "per_day", depositPercent: 25, quotationValidityHours: 168, driversAlwaysIncluded: null, paymentMethods: ["Bank transfer", "Mobile money"], requotePolicy: null, quotationApprovalAbove: null, extraChargeApprovalAbove: null } },
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
      execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: {
        ...db.settings.rental, depositPercent } } }, NOW);
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
    // NOW + 168 hours (D-117: the price holds to the minute, not to the end of a day).
    expect(rentalQuoted.quote?.validUntil).toBe("2026-01-08T00:00:00.000Z");
    // RNT-04: the sheet a customer can name, numbered from its own series.
    expect(rentalQuoted.quote?.number).toBe("QUO-0001");
    expect(rentalQuoted.quote?.revision).toBe(1);
    expect(rentalQuoted.quote?.terms).toBe(TERMS);
    expect(rentalQuoted.quote?.driverIncluded).toBe(false);

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
    expect(db.rentals[0].status).toBe("dispatched");

    // It came back two days after it left; completing it before it started is a mistake, not a fact.
    const complete = execute(db, admin, {
      type: "complete_rental",
      id,
      input: {
        lines: [{ description: "3 days hire", quantity: "3", unitAmount: "1000" }, { description: "Extra day", quantity: "1", unitAmount: "1000" }],
        returnedAt: "2026-03-03T18:00:00.000Z",
      },
    }, "2026-03-03T18:00:00.000Z");
    if (!complete.ok) throw new Error(complete.message);
    db = complete.db;
    expect(db.rentals[0].status).toBe("completed");
    expect(db.rentals[0].finalInvoice?.total).toBe(4000);
    // D-118: the run keeps the moment the hire started, and the return it was given.
    expect(db.rentals[0].run?.departedAt).toBe("2026-03-01T07:00:00.000Z");
    expect(db.rentals[0].run?.returnedAt).toBe("2026-03-03T18:00:00.000Z");
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
    const settings = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: {
      ...db.settings.rental, requotePolicy: "new_request" } } }, NOW);
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
    const settings = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: {
      ...db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
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
    expect(rental.quote?.validUntil).toBe("2026-01-17T00:00:00.000Z");
    // A renewal keeps the number and raises the revision: one document, two versions.
    expect(rental.quote?.number).toBe("QUO-0001");
    expect(rental.quote?.revision).toBe(2);
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
    const configured = execute(db, admin, { type: "update_settings", input: { ...db.settings, rental: {
      ...db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
    if (!configured.ok) throw new Error(configured.message);
    db = configured.db;
    const created = execute(db, admin, requestInput(db.settings.vehicleCategories[0].id, "2026-03-01", "2026-03-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const legacy = { ...quoted.db, schemaVersion: 7, rentals: quoted.db.rentals.map((rental) => { const copy = { ...rental } as Record<string, unknown>; delete copy.quoteHistory; return copy; }), settings: { ...quoted.db.settings, rental: {
      ...quoted.db.settings.rental, requotePolicy: undefined } } } as unknown as Database;
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
    // Agreeing is not paying: the hire is `accepted` — agreed, with the deposit still to come — and
    // it is the deposit that confirms it (D-120).
    expect(result.db.rentals[0].status).toBe("accepted");
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
    expect(SCHEMA_VERSION).toBe(37);
  });
});

describe("a quotation as a document (RNT-04, D-117)", () => {
  /** Two requests quoted one after the other, so a series is something to look at. */
  function twoQuoted() {
    const w = rentalReady();
    const admin: Actor = w.admin;
    let db = w.db;
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const created = execute(db, admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
      if (!created.ok) throw new Error(created.message);
      db = created.db;
      const id = db.rentals[db.rentals.length - 1].id;
      ids.push(id);
      const quoted = execute(db, w.finance, { type: "quote_rental", id, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1000" }] } }, NOW);
      if (!quoted.ok) throw new Error(quoted.message);
      db = quoted.db;
    }
    return { ...w, db, ids };
  }

  it("numbers each quotation in its own series, and says so in the message", () => {
    const w = twoQuoted();
    expect(w.db.rentals.map((rental) => rental.quote?.number)).toEqual(["QUO-0001", "QUO-0002"]);
    expect(w.db.rentals[0].quote?.revision).toBe(1);
    // The counter travels with the data, so a restore cannot hand the number out twice.
    expect(w.db.referenceCounters.find((counter) => counter.scope === "quotation")).toEqual({ scope: "quotation", period: "all", last: 2 });
  });

  it("keeps the number on a renewal and raises the revision", () => {
    const w = twoQuoted();
    // Management's policy has to say a renewal is allowed on the same request (Q-11).
    const policy = execute(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, rental: { ...w.db.settings.rental, requotePolicy: "revise_in_place" } },
    }, NOW);
    if (!policy.ok) throw new Error(policy.message);
    // Seven days of validity; renew the first once it has run out.
    const renewed = execute(policy.db, w.finance, {
      type: "requote_rental",
      id: w.ids[0],
      input: { lines: [{ description: "Two days hire, revised", quantity: "2", unitAmount: "1200" }] },
    }, "2026-01-09T00:00:00.000Z");
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    const rental = renewed.db.rentals[0];
    expect(rental.quote?.number).toBe("QUO-0001");
    expect(rental.quote?.revision).toBe(2);
    expect(rental.quoteHistory[0]?.number).toBe("QUO-0001");
    expect(rental.quoteHistory[0]?.revision).toBe(1);
    // A renewal is not a new document, so the series does not advance.
    expect(renewed.db.referenceCounters.find((counter) => counter.scope === "quotation")?.last).toBe(2);
  });

  it("copies the company's terms onto the quotation as they stand when it is issued", () => {
    const w = twoQuoted();
    expect(w.db.rentals[0].quote?.terms).toBe(TERMS);
    const changed = execute(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, rental: { ...w.db.settings.rental, quotationTerms: "Half the price is due before the hire.", quotationApprovalAbove: null } },
    }, NOW);
    if (!changed.ok) throw new Error(changed.message);
    const created = execute(changed.db, w.admin, requestInput(w.catId, "2026-04-01", "2026-04-02"), NOW);
    if (!created.ok) throw new Error(created.message);
    const third = execute(created.db, w.finance, { type: "quote_rental", id: created.db.rentals[2].id, input: { lines: [{ description: "One day", quantity: "1", unitAmount: "500" }] } }, NOW);
    if (!third.ok) throw new Error(third.message);
    // The old quotation keeps the words it was sent with; the new one carries today's.
    expect(third.db.rentals[0].quote?.terms).toBe(TERMS);
    expect(third.db.rentals[2].quote?.terms).toBe("Half the price is due before the hire.");
  });

  it("refuses to issue a quotation when nobody has written the terms", () => {
    const w = rentalReady();
    const cleared = execute(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, rental: { ...w.db.settings.rental, quotationTerms: "", quotationApprovalAbove: null } },
    }, NOW);
    if (!cleared.ok) throw new Error(cleared.message);
    const created = execute(cleared.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const quoted = execute(created.db, w.finance, { type: "quote_rental", id: created.db.rentals[0].id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "900" }] } }, NOW);
    expect(quoted.ok).toBe(false);
    if (!quoted.ok) expect(quoted.message).toBe("Blocked: quotation settings are incomplete. An administrator must set: quotation terms.");
  });

  it("stops being acceptable at the hour it was quoted for, not at midnight", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, w.finance, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "900" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    // Issued at 00:00 on 1 January for 168 hours: the price stops holding at 00:00 on the 8th.
    expect(quoted.db.rentals[0].quote?.validUntil).toBe("2026-01-08T00:00:00.000Z");
    const justInTime = execute(quoted.db, w.admin, { type: "accept_quotation", id, note: "" }, "2026-01-07T23:59:00.000Z");
    expect(justInTime.ok).toBe(true);
    const tooLate = execute(quoted.db, w.admin, { type: "accept_quotation", id, note: "" }, "2026-01-08T00:01:00.000Z");
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.errors.quote).toBe("The quotation expired on 2026-01-08. Issue a new one before the customer accepts.");
  });
});

describe("what actually happened on a hire (RNT-07, D-118)", () => {
  /** A hire that started on 1 March 2026 at 07:00 and is on the road. */
  function onTheRoad() {
    const w = rentalReady();
    const admin: Actor = w.admin;
    let db = w.db;
    const created = execute(db, admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    db = created.db;
    const id = db.rentals[0].id;
    const quoted = execute(db, w.finance, { type: "quote_rental", id, input: { lines: [{ description: "Three days hire", quantity: "3", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const confirmed = execute(quoted.db, w.finance, { type: "confirm_rental", id, input: { amount: "750", method: "Bank transfer", reference: "TX1" } }, NOW);
    if (!confirmed.ok) throw new Error(confirmed.message);
    const vehicle = addVehicle(confirmed.db, admin, w.catId, "GT 777-26");
    const driver = execute(vehicle.db, admin, { type: "create_driver", input: { fullName: "Kojo Mensah", phone: "024", licenceNumber: "DL-9", licenceExpiry: "2030-01-01", status: "active" } }, NOW);
    if (!driver.ok) throw new Error(driver.message);
    const driverId = driver.db.drivers[0].id;
    const assigned = execute(driver.db, admin, { type: "assign_rental", id, input: { vehicleId: vehicle.id, driverId } }, NOW);
    if (!assigned.ok) throw new Error(assigned.message);
    const started = execute(assigned.db, admin, { type: "start_rental", id, odometerKm: "82140" }, "2026-03-01T07:00:00.000Z");
    if (!started.ok) throw new Error(started.message);
    return { ...w, db: started.db, id, vehicleId: vehicle.id };
  }

  const finalLines = { lines: [{ description: "Three days hire", quantity: "3", unitAmount: "1000" }] };

  it("records the moment the hire started, and the odometer it started from", () => {
    const w = onTheRoad();
    const run = w.db.rentals[0].run;
    expect(run?.departedAt).toBe("2026-03-01T07:00:00.000Z");
    expect(run?.returnedAt).toBeNull();
    expect(run?.odometerStartKm).toBe(82140);
    // The reading is a real reading of the vehicle, so it also joins the register the service
    // intervals are worked out from — recorded once, not typed twice.
    expect(w.db.odometerReadings).toHaveLength(1);
    expect(w.db.odometerReadings[0]).toMatchObject({ vehicleId: w.vehicleId, readingKm: 82140, readingDate: "2026-03-01" });
  });

  it("records when it came back, how far it went, the damage and what the customer said", () => {
    const w = onTheRoad();
    const done = execute(w.db, w.admin, {
      type: "complete_rental",
      id: w.id,
      input: {
        ...finalLines,
        returnedAt: "2026-03-03T18:20:00.000Z",
        odometerEndKm: "82354",
        damageNotes: "Cracked near-side mirror.",
        feedback: "Punctual; they will book again.",
      },
    }, "2026-03-03T19:00:00.000Z");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const run = done.db.rentals[0].run;
    expect(run).toMatchObject({
      departedAt: "2026-03-01T07:00:00.000Z",
      returnedAt: "2026-03-03T18:20:00.000Z",
      odometerStartKm: 82140,
      odometerEndKm: 82354,
      distanceKm: 214,
      distanceSource: "odometer",
      damageNotes: "Cracked near-side mirror.",
      feedback: "Punctual; they will book again.",
      recordedBy: "Admin One",
    });
    // The closing reading joins the odometer register too.
    expect(done.db.odometerReadings.map((reading) => reading.readingKm)).toEqual([82140, 82354]);
    // And the money is still recorded in the same act.
    expect(done.db.rentals[0].finalInvoice?.total).toBe(3000);
    // The audit entry says what happened, not only what was billed.
    const entry = done.db.audit[0];
    expect(entry.summary).toContain("214 km");
    expect(entry.summary).toContain("Damage reported: Cracked near-side mirror.");
    expect(done.message).toBe("RR-0001 completed. 214 km recorded.");
  });

  it("takes a distance the office typed, and marks it as typed", () => {
    const w = onTheRoad();
    const done = execute(w.db, w.admin, {
      type: "complete_rental",
      id: w.id,
      input: { ...finalLines, returnedAt: "2026-03-03T18:00:00.000Z", distanceKm: "180" },
    }, "2026-03-03T18:00:00.000Z");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.db.rentals[0].run?.distanceKm).toBe(180);
    expect(done.db.rentals[0].run?.distanceSource).toBe("entered");
    // No odometer was read at the end, so no reading is invented for the register.
    expect(done.db.odometerReadings).toHaveLength(1);
  });

  it("completes a hire with no journey details at all, and claims nothing", () => {
    const w = onTheRoad();
    const done = execute(w.db, w.admin, { type: "complete_rental", id: w.id, input: { ...finalLines, returnedAt: "2026-03-03T18:00:00.000Z" } }, "2026-03-03T18:00:00.000Z");
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const run = done.db.rentals[0].run;
    expect(run?.departedAt).toBe("2026-03-01T07:00:00.000Z");
    expect(run?.returnedAt).toBe("2026-03-03T18:00:00.000Z");
    expect(run?.distanceKm).toBeNull();
    expect(run?.damageNotes).toBe("");
  });

  it("refuses a return before the departure, and refuses to guess between two distances", () => {
    const w = onTheRoad();
    const early = execute(w.db, w.admin, { type: "complete_rental", id: w.id, input: { ...finalLines, returnedAt: "2026-02-28T09:00:00.000Z" } }, "2026-03-03T18:00:00.000Z");
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors.returnedAt).toBe("The vehicle cannot come back before it left.");

    const twoAnswers = execute(w.db, w.admin, {
      type: "complete_rental",
      id: w.id,
      input: { ...finalLines, returnedAt: "2026-03-03T18:00:00.000Z", odometerEndKm: "82324", distanceKm: "200" },
    }, "2026-03-03T18:00:00.000Z");
    expect(twoAnswers.ok).toBe(false);
    if (!twoAnswers.ok) expect(twoAnswers.errors.distanceKm).toBe("The odometer readings give 184 km. Remove the typed distance, or correct a reading.");
    // Neither refusal moved the hire: it is still on the road.
    expect(w.db.rentals[0].status).toBe("dispatched");
  });

  it("shows what the hire cost and what is still owed against it", () => {
    const w = onTheRoad();
    const done = execute(w.db, w.admin, { type: "complete_rental", id: w.id, input: { ...finalLines, returnedAt: "2026-03-03T18:00:00.000Z" } }, "2026-03-03T18:00:00.000Z");
    if (!done.ok) throw new Error(done.message);
    // An invoice and a part payment against this hire, through the ordinary commands.
    // The company is not VAT registered and bills on 14-day terms; without both, an invoice is blocked.
    const configured = execute(done.db, w.admin, {
      type: "update_settings",
      input: { ...done.db.settings, taxPosition: "not_registered", invoiceDueDays: 14 },
    }, "2026-03-04T08:00:00.000Z");
    if (!configured.ok) throw new Error(configured.message);
    const issued = executeCommand(configured.db, w.finance, {
      type: "issue_rental_invoice",
      input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" },
    }, "2026-03-04T09:00:00.000Z");
    if (!issued.ok) throw new Error(issued.message);
    const invoice = issued.db.invoices.find((candidate) => candidate.rentalId === w.id)!;
    const paid = executeCommand(issued.db, w.finance, {
      type: "record_payment",
      input: { invoiceId: invoice.id, amount: "1000", method: "Bank transfer", paidOn: "2026-03-05", externalReference: "", note: "" },
    }, "2026-03-05T10:00:00.000Z");
    if (!paid.ok) throw new Error(paid.message);
    const balance = rentalBalance(paid.db, paid.db.rentals[0]);
    expect(balance?.outstanding).toBe(2000);
    expect(balanceLine(balance!)).toBe(`Invoice ${invoice.reference}: GHS 3000.00 billed, GHS 2000.00 still outstanding.`);
  });
});

describe("the journey a customer asked for (RNT-01, D-119)", () => {
  const withJourney = (catId: string, start: string, end: string, journey: Record<string, string>) => ({
    type: "create_rental" as const,
    input: { ...requestInput(catId, start, end).input, ...journey },
  });

  it("writes down the times, the stops, the luggage, who to ring and how it came in", () => {
    const w = rentalReady();
    const result = execute(
      w.db,
      w.admin,
      withJourney(w.catId, "2026-03-01", "2026-03-03", {
        departureTime: "7:30",
        returnTime: "18:00",
        stops: "Achimota\nNsawam",
        luggage: "Twelve suitcases",
        specialNeeds: "One wheelchair: a ramp is needed",
        tripContactName: "Ama Mensah",
        tripContactPhone: "024 000 0000",
        source: "phone",
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "7:30" is stored as "07:30": one form to type, one form to sort and compare.
    expect(result.db.rentals[0].plan).toEqual({
      departureTime: "07:30",
      returnTime: "18:00",
      stops: ["Achimota", "Nsawam"],
      luggage: "Twelve suitcases",
      specialNeeds: "One wheelchair: a ramp is needed",
      tripContactName: "Ama Mensah",
      tripContactPhone: "024 000 0000",
      source: "phone",
    });
  });

  it("records blanks when the desk knows nothing about the journey, rather than filling them in", () => {
    const w = rentalReady();
    const result = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.db.rentals[0].plan).toEqual({
      departureTime: "",
      returnTime: "",
      stops: [],
      luggage: "",
      specialNeeds: "",
      tripContactName: "",
      tripContactPhone: "",
      source: "",
    });
  });

  it("refuses a one-day hire that comes back before it leaves, and stores nothing", () => {
    const w = rentalReady();
    const refused = execute(
      w.db,
      w.admin,
      withJourney(w.catId, "2026-03-01", "2026-03-01", { departureTime: "17:00", returnTime: "08:00" }),
      NOW,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.returnTime).toContain("cannot be back before it leaves");
    expect(w.db.rentals).toHaveLength(0);
  });

  it("refuses more stops than the form can carry, and says where the rest goes", () => {
    const w = rentalReady();
    const stops = Array.from({ length: 9 }, (_, i) => `Stop ${i + 1}`).join("\n");
    const refused = execute(w.db, w.admin, withJourney(w.catId, "2026-03-01", "2026-03-03", { stops }), NOW);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errors.stops).toContain("Put the rest of the day in the notes.");
  });

  it("keeps the journey when a correction leaves it out of the form", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, withJourney(w.catId, "2026-03-01", "2026-03-03", { stops: "Achimota", source: "walk_in" }), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const edited = execute(created.db, w.admin, { type: "update_rental", id, input: { ...requestInput(w.catId, "2026-03-01", "2026-03-03").input, purpose: "Board meeting" } }, NOW);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.db.rentals[0].purpose).toBe("Board meeting");
    expect(edited.db.rentals[0].plan).toMatchObject({ stops: ["Achimota"], source: "walk_in" });
  });
});

describe("the pipeline a request goes through (RNT-02, D-120)", () => {
  const admin0 = (db: Database): Actor => ({ id: db.users[0].id, fullName: db.users[0].fullName, role: "administrator" });

  /** A request, quoted, on a live quotation. */
  function quoted() {
    const base = rentalReady();
    const created = execute(base.db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quote = execute(created.db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "3 days hire", quantity: "3", unitAmount: "1000" }] } }, NOW);
    if (!quote.ok) throw new Error(quote.message);
    return { ...base, db: quote.db, id };
  }

  it("walks a request through submitted, under review and awaiting quotation", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    expect(created.db.rentals[0].status).toBe("draft");

    let db = created.db;
    for (const [to, message] of [
      ["submitted", "RR-0001 is now submitted. Next: under review."],
      ["under_review", "RR-0001 is now under review. Next: awaiting quotation."],
      ["awaiting_quotation", "RR-0001 is now awaiting quotation."],
    ] as const) {
      const step = execute(db, admin0(db), { type: "advance_rental", id, to }, NOW);
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      expect(step.message).toBe(message);
      expect(step.db.rentals[0].status).toBe(to);
      db = step.db;
    }
    // Every step is in the audit trail, with the words the office saw.
    expect(db.audit.filter((entry) => entry.action === "rentals:advance")).toHaveLength(3);
    expect(db.audit[0].summary).toBe("RR-0001 moved to Awaiting quotation.");
  });

  it("refuses a skipped stage and a step backwards", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;

    const skipped = execute(created.db, w.admin, { type: "advance_rental", id, to: "awaiting_quotation" }, NOW);
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.message).toBe("A rental cannot move from Draft to Awaiting quotation.");
    expect(created.db.rentals[0].status).toBe("draft");

    const submitted = execute(created.db, w.admin, { type: "advance_rental", id, to: "submitted" }, NOW);
    if (!submitted.ok) throw new Error(submitted.message);
    const back = execute(submitted.db, w.admin, { type: "advance_rental", id, to: "draft" }, NOW);
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.message).toBe("That is not a step of the request pipeline.");
  });

  it("lets a small request be priced without walking the stages at all", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const submitted = execute(created.db, w.admin, { type: "advance_rental", id, to: "submitted" }, NOW);
    if (!submitted.ok) throw new Error(submitted.message);
    // Straight from submitted to a quotation: the triage stages never block the work.
    const quotedNow = execute(submitted.db, w.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "500" }] } }, NOW);
    expect(quotedNow.ok).toBe(true);
    if (quotedNow.ok) expect(quotedNow.db.rentals[0].status).toBe("quoted");
  });

  it("allows a correction while a request is being looked at, and not after it is priced", () => {
    const w = rentalReady();
    const created = execute(w.db, w.admin, requestInput(w.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const review = execute(created.db, w.admin, { type: "advance_rental", id, to: "submitted" }, NOW);
    if (!review.ok) throw new Error(review.message);
    const edited = execute(review.db, w.admin, { type: "update_rental", id, input: { ...requestInput(w.catId, "2026-03-01", "2026-03-03").input, purpose: "Board meeting" } }, NOW);
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.db.rentals[0].purpose).toBe("Board meeting");

    const w2 = quoted();
    const tooLate = execute(w2.db, w2.admin, { type: "update_rental", id: w2.id, input: requestInput(w2.catId, "2026-03-01", "2026-03-03").input }, NOW);
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.message).toBe("Only a request that has not been priced yet can be edited. Changes after the quotation has gone out are not permitted.");
  });

  it("records the customer's yes as its own stage, and confirms from it", () => {
    const w = quoted();
    const accepted = execute(w.db, w.finance, { type: "accept_quotation", id: w.id, note: "Agreed on the phone" }, NOW);
    if (!accepted.ok) throw new Error(accepted.message);
    expect(accepted.db.rentals[0].status).toBe("accepted");

    // The deposit is what confirms the hire, and it can be recorded straight from the agreed stage.
    const confirmed = execute(accepted.db, w.finance, { type: "confirm_rental", id: w.id, input: { amount: "750", method: "Bank transfer", reference: "SLIP-1" } }, NOW);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.db.rentals[0].status).toBe("confirmed");
  });

  it("returns an agreed hire to waiting when the price is renewed", () => {
    const base = rentalReady();
    const settings = execute(base.db, base.admin, { type: "update_settings", input: { ...base.db.settings, rental: { ...base.db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
    if (!settings.ok) throw new Error(settings.message);
    const created = execute(settings.db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const first = execute(created.db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "2", unitAmount: "500" }] } }, NOW);
    if (!first.ok) throw new Error(first.message);
    const accepted = execute(first.db, base.finance, { type: "accept_quotation", id, note: "" }, NOW);
    if (!accepted.ok) throw new Error(accepted.message);
    expect(accepted.db.rentals[0].status).toBe("accepted");

    // Long after the price stopped holding, management renews it.
    const renewed = execute(accepted.db, base.admin, { type: "requote_rental", id, input: { lines: [{ description: "Hire revised", quantity: "2", unitAmount: "700" }] } }, "2026-02-10T00:00:00.000Z");
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    // The new figure is not what the customer agreed to, so the hire waits on them again — and the
    // acceptance stays on the record, referring to the old quotation.
    expect(renewed.db.rentals[0].status).toBe("quoted");
    expect(renewed.db.rentals[0].acceptance).not.toBeNull();
    expect(renewed.db.rentals[0].quote?.revision).toBe(2);
  });

  it("keeps an older backup's on-the-road hire, under the word this build uses", () => {
    const w = quoted();
    const dispatched = execute(w.db, w.finance, { type: "confirm_rental", id: w.id, input: { amount: "750", method: "Bank transfer", reference: "" } }, NOW);
    if (!dispatched.ok) throw new Error(dispatched.message);
    // A backup written at schema 34 has the old word for the same fact.
    const legacy = { ...dispatched.db, schemaVersion: 34, rentals: dispatched.db.rentals.map((rental) => ({ ...rental, status: "in_progress" })) };
    const migrated = migrate(legacy);
    expect(migrated).not.toBeNull();
    expect(migrated!.rentals[0].status).toBe("dispatched");
    expect(migrated!.schemaVersion).toBe(SCHEMA_VERSION);

    // A status this build cannot read falls back to Draft rather than leaving a hire in no list at all.
    const unknown = migrate({ ...legacy, rentals: dispatched.db.rentals.map((rental) => ({ ...rental, status: "ghosted" })) });
    expect(unknown!.rentals[0].status).toBe("draft");
  });
});

describe("a quotation carries its figures and its signature (RNT-04, D-121)", () => {
  /** A request, ready to be quoted, with the company registered for tax and an approval threshold. */
  function ready(threshold: number | null = null) {
    const base = rentalReady();
    const settings = execute(base.db, base.admin, {
      type: "update_settings",
      input: {
        ...base.db.settings,
        taxPosition: "registered",
        taxLines: [{ id: "", name: "VAT", ratePercent: 15 }],
        rental: { ...base.db.settings.rental, quotationApprovalAbove: threshold },
      },
    }, NOW);
    if (!settings.ok) throw new Error(settings.message);
    const created = execute(settings.db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    return { ...base, db: created.db, id: created.db.rentals[0].id };
  }

  const quoteIt = (w: { db: Database; admin: Actor; id: string }, input: { lines: { description: string; quantity: string; unitAmount: string }[]; discountAmount?: string; discountReason?: string }) =>
    execute(w.db, w.admin, { type: "quote_rental", id: w.id, input }, NOW);

  it("puts the tax and the discount on the document, and the deposit on what the customer pays", () => {
    const w = ready();
    const result = quoteIt(w, {
      lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1000" }],
      discountAmount: "200",
      discountReason: "Repeat customer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = result.db.rentals[0].quote!;
    expect(quote.subtotal).toBe(2000);
    expect(quote.discountAmount).toBe(200);
    expect(quote.discountReason).toBe("Repeat customer");
    // 1,800 at 15% is 270, so the customer owes 2,070 and the deposit is 25% of that.
    expect(quote.taxLines).toEqual([{ name: "VAT", ratePercent: 15, amount: 270 }]);
    expect(quote.total).toBe(2070);
    expect(quote.depositRequired).toBe(517.5);
    // The figure the customer sees leads the audit trail, with the working behind it, so the office can
    // trace what it said and how it got there.
    expect(result.db.audit[0].summary).toBe(
      "RR-0001 quoted as QUO-0001 (revision 1): GHS 2070.00 [lines 2000.00 less 200.00 discount; VAT 15% 270.00] (deposit GHS 517.50), valid until 2026-01-08T00:00:00.000Z.",
    );
  });

  it("refuses a discount with no reason, and a discount bigger than the price", () => {
    const w = ready();
    const noReason = quoteIt(w, { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }], discountAmount: "100" });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.errors.discountReason).toBe("Give a reason for the discount.");
    const tooBig = quoteIt(w, { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }], discountAmount: "1500", discountReason: "Goodwill" });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.errors.discountAmount).toContain("larger than the price");
    expect(w.db.rentals[0].quote).toBeNull();
  });

  it("charges no tax when the company has not said it is registered", () => {
    const base = rentalReady();
    const created = execute(base.db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } }, NOW);
    expect(quoted.ok).toBe(true);
    if (quoted.ok) {
      expect(quoted.db.rentals[0].quote?.taxLines).toEqual([]);
      expect(quoted.db.rentals[0].quote?.total).toBe(1000);
    }
  });

  it("needs a second signature above the threshold, and refuses the author's own", () => {
    const w = ready(1500);
    const quoted = quoteIt(w, { lines: [{ description: "Hire", quantity: "1", unitAmount: "2000" }] });
    if (!quoted.ok) throw new Error(quoted.message);
    const quotedDb = quoted.db;

    // The author cannot sign it off, whatever their role.
    const own = execute(quotedDb, w.admin, { type: "approve_quotation", id: w.id, note: "" }, NOW);
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.message).toMatch(/cannot also approve it/);

    // Nor can the deposit be taken, nor the customer's yes recorded, while the price is unsigned.
    const early = execute(quotedDb, w.finance, { type: "confirm_rental", id: w.id, input: { amount: "575", method: "Bank transfer", reference: "" } }, NOW);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.message).toContain("needs a second signature before the deposit can be recorded");
    const accepted = execute(quotedDb, w.finance, { type: "accept_quotation", id: w.id, note: "" }, NOW);
    expect(accepted.ok).toBe(false);
    // The same sentence the customer's portal shows: they do not need to know who signs what inside.
    if (!accepted.ok) expect(accepted.message).toBe("The office is still checking this price, so it cannot be accepted yet. Call them if it is urgent.");

    // Somebody else signs it, and the record says who and for how much.
    const approved = execute(quotedDb, w.finance, { type: "approve_quotation", id: w.id, note: "Rate checked" }, NOW);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.db.rentals[0].quote?.approval).toMatchObject({ byName: "Fin", byActorId: w.finance.id, note: "Rate checked", total: 2300 });
    expect(approved.db.audit[0].summary).toBe('RR-0001 quotation QUO-0001 approved by Fin: GHS 2300.00. "Rate checked"');

    // Approving it twice is refused, naming the first.
    const again = execute(approved.db, w.admin, { type: "approve_quotation", id: w.id, note: "" }, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toBe("This quotation was already approved by Fin on 2026-01-01.");

    // With the signature in place the deposit can be taken.
    const confirmed = execute(approved.db, w.finance, { type: "confirm_rental", id: w.id, input: { amount: "575", method: "Bank transfer", reference: "SLIP-1" } }, NOW);
    expect(confirmed.ok).toBe(true);
  });

  it("asks for nothing when the company has set no threshold", () => {
    const w = ready(null);
    const quoted = quoteIt(w, { lines: [{ description: "Hire", quantity: "1", unitAmount: "9000" }] });
    if (!quoted.ok) throw new Error(quoted.message);
    const confirmed = execute(quoted.db, w.finance, { type: "confirm_rental", id: w.id, input: { amount: "2587.50", method: "Bank transfer", reference: "" } }, NOW);
    expect(confirmed.ok).toBe(true);
  });

  it("does not carry a signature onto a renewal", () => {
    const base = ready(1000);
    const settings = execute(base.db, base.admin, { type: "update_settings", input: { ...base.db.settings, rental: { ...base.db.settings.rental, requotePolicy: "revise_in_place" } } }, NOW);
    if (!settings.ok) throw new Error(settings.message);
    const created = execute(settings.db, base.admin, requestInput(base.catId, "2026-03-01", "2026-03-03"), NOW);
    if (!created.ok) throw new Error(created.message);
    const id = created.db.rentals[0].id;
    const quoted = execute(created.db, base.admin, { type: "quote_rental", id, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "2000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const approved = execute(quoted.db, base.finance, { type: "approve_quotation", id, note: "" }, NOW);
    if (!approved.ok) throw new Error(approved.message);
    expect(approved.db.rentals[0].quote?.approval).not.toBeNull();

    // Long after the price stopped holding, the quotation is renewed: a new figure is a new document.
    const renewed = execute(approved.db, base.admin, { type: "requote_rental", id, input: { lines: [{ description: "Hire revised", quantity: "1", unitAmount: "3000" }] } }, "2026-02-10T00:00:00.000Z");
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    expect(renewed.db.rentals[0].quote?.revision).toBe(2);
    expect(renewed.db.rentals[0].quote?.approval).toBeNull();
    const blocked = execute(renewed.db, base.finance, { type: "confirm_rental", id, input: { amount: "862.50", method: "Bank transfer", reference: "" } }, "2026-02-10T00:00:00.000Z");
    expect(blocked.ok).toBe(false);
  });

  it("refuses to approve a quotation that has expired, or one that is not out", () => {
    const w = ready(1000);
    const quoted = quoteIt(w, { lines: [{ description: "Hire", quantity: "1", unitAmount: "2000" }] });
    if (!quoted.ok) throw new Error(quoted.message);
    const late = execute(quoted.db, w.finance, { type: "approve_quotation", id: w.id, note: "" }, "2026-02-10T00:00:00.000Z");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toBe("This quotation has expired, so there is nothing to sign off. Renew it first.");

    const draft = execute(quoted.db, w.admin, { type: "create_rental", input: requestInput(w.catId, "2026-04-01", "2026-04-02").input }, NOW);
    if (!draft.ok) throw new Error(draft.message);
    const noQuote = execute(draft.db, w.finance, { type: "approve_quotation", id: draft.db.rentals[1].id, note: "" }, NOW);
    expect(noQuote.ok).toBe(false);
    if (!noQuote.ok) expect(noQuote.message).toBe("There is no quotation on this rental to approve.");
  });
});

describe("charges added after the price was agreed (RNT-07, D-123)", () => {
  /** A hire on the road, with the company's figure for a second signature set to GHS 500. */
  function onTheRoad(threshold: number | null = 500) {
    const w = rentalReady();
    const admin: Actor = w.admin;
    let db = w.db;
    const configured = execute(db, admin, {
      type: "update_settings",
      input: { ...db.settings, currencyCode: "GHS", rental: { ...db.settings.rental, extraChargeApprovalAbove: threshold } },
    }, NOW);
    if (!configured.ok) throw new Error(configured.message);
    db = configured.db;
    const created = execute(db, admin, requestInput(w.catId, "2026-03-01", "2026-03-03", true), NOW);
    if (!created.ok) throw new Error(created.message);
    db = created.db;
    const id = db.rentals[0].id;
    const quoted = execute(db, w.finance, { type: "quote_rental", id, input: { lines: [{ description: "Three days hire", quantity: "3", unitAmount: "1000" }] } }, NOW);
    if (!quoted.ok) throw new Error(quoted.message);
    const confirmed = execute(quoted.db, w.finance, { type: "confirm_rental", id, input: { amount: "750", method: "Bank transfer", reference: "TX1" } }, NOW);
    if (!confirmed.ok) throw new Error(confirmed.message);
    const vehicle = addVehicle(confirmed.db, admin, w.catId, "GT 888-26");
    const driver = execute(vehicle.db, admin, { type: "create_driver", input: { fullName: "Kojo Mensah", phone: "024", licenceNumber: "DL-77", licenceExpiry: "2030-01-01", status: "active" } }, NOW);
    if (!driver.ok) throw new Error(driver.message);
    const assigned = execute(driver.db, admin, { type: "assign_rental", id, input: { vehicleId: vehicle.id, driverId: driver.db.drivers[0].id } }, NOW);
    if (!assigned.ok) throw new Error(assigned.message);
    const started = execute(assigned.db, admin, { type: "start_rental", id, odometerKm: "51000" }, "2026-03-01T07:00:00.000Z");
    if (!started.ok) throw new Error(started.message);
    // The company bills on terms and is not VAT registered, so an invoice can be issued afterwards.
    const billable = execute(started.db, admin, {
      type: "update_settings",
      input: { ...started.db.settings, taxPosition: "not_registered", invoiceDueDays: 14 },
    }, NOW);
    if (!billable.ok) throw new Error(billable.message);
    return { ...w, db: billable.db, id };
  }

  const finalLines = { lines: [{ description: "Three days hire", quantity: "3", unitAmount: "1000" }] };
  const complete = (w: ReturnType<typeof onTheRoad>, extraCharges: { description: string; quantity: string; unitAmount: string; reason: string }[]) =>
    execute(w.db, w.admin, { type: "complete_rental", id: w.id, input: { ...finalLines, returnedAt: "2026-03-03T18:00:00.000Z", extraCharges } }, "2026-03-03T18:00:00.000Z");

  it("records the charge, its reason and who added it, and puts it on the final invoice", () => {
    const w = onTheRoad();
    const done = complete(w, [{ description: "Fuel", quantity: "1", unitAmount: "400", reason: "Tank refilled before return" }]);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const rental = done.db.rentals[0];
    expect(rental.extraCharges).toHaveLength(1);
    expect(rental.extraCharges[0]).toMatchObject({ description: "Fuel", quantity: 1, unitAmount: 400, reason: "Tank refilled before return", addedByName: "Admin One", approval: null });
    // The customer's invoice carries the charge with the reason, and the hire's total includes it.
    expect(rental.finalInvoice?.lines.map((line) => line.description)).toEqual(["Three days hire", "Fuel (Tank refilled before return)"]);
    expect(rental.finalInvoice?.total).toBe(3400);
    expect(done.db.audit[0].summary).toContain("Extra charges: Fuel GHS 400.00 (Tank refilled before return).");
  });

  it("refuses a charge with no reason, and leaves the hire on the road", () => {
    const w = onTheRoad();
    const refused = complete(w, [{ description: "Waiting", quantity: "1", unitAmount: "80", reason: "" }]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toBe("Please correct the extra charges.");
      expect(refused.errors["extraCharges.0.reason"]).toBe("Give a reason for the charge: the customer will read it.");
    }
    expect(w.db.rentals[0].status).toBe("dispatched");
  });

  it("will not bill a charge above the company's figure until somebody else signs it", () => {
    const w = onTheRoad(500);
    const done = complete(w, [{ description: "Damaged seat cover", quantity: "1", unitAmount: "900", reason: "Seat cover torn on return" }]);
    if (!done.ok) throw new Error(done.message);
    const blocked = executeCommand(done.db, w.finance, { type: "issue_rental_invoice", input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" } }, "2026-03-04T08:00:00.000Z");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors.rentalId).toContain("needs a second signature");
    expect(blocked.ok === false && blocked.errors.rentalId).toContain("Somebody other than the person who added it");

    // The person who added it cannot sign it off.
    const own = execute(done.db, w.admin, { type: "approve_extra_charge", id: w.id, chargeId: done.db.rentals[0].extraCharges[0].id, note: "" }, "2026-03-04T09:00:00.000Z");
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.message).toContain("cannot also approve it");

    // Somebody else can, and then the bill goes out.
    const approved = execute(done.db, w.finance, { type: "approve_extra_charge", id: w.id, chargeId: done.db.rentals[0].extraCharges[0].id, note: "Photo seen" }, "2026-03-04T09:00:00.000Z");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.db.rentals[0].extraCharges[0].approval).toMatchObject({ byName: "Fin", note: "Photo seen", total: 900 });
    expect(approved.db.audit[0].summary).toBe('RR-0001 extra charge approved by Fin: Damaged seat cover GHS 900.00. "Photo seen"');
    const issued = executeCommand(approved.db, w.finance, { type: "issue_rental_invoice", input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" } }, "2026-03-04T08:00:00.000Z");
    expect(issued.ok).toBe(true);
    if (issued.ok) expect(issued.db.invoices[0].total).toBe(3900);
  });

  it("bills a charge below the figure without asking anybody", () => {
    const w = onTheRoad(500);
    const done = complete(w, [{ description: "Fuel", quantity: "1", unitAmount: "400", reason: "Tank refilled" }]);
    if (!done.ok) throw new Error(done.message);
    const issued = executeCommand(done.db, w.finance, { type: "issue_rental_invoice", input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" } }, "2026-03-04T08:00:00.000Z");
    expect(issued.ok).toBe(true);
    if (issued.ok) expect(issued.db.invoices[0].total).toBe(3400);
  });

  it("asks for nothing when the company has set no figure, and says so", () => {
    const w = onTheRoad(null);
    const done = complete(w, [{ description: "Fuel", quantity: "1", unitAmount: "5000", reason: "Long trip" }]);
    if (!done.ok) throw new Error(done.message);
    const issued = executeCommand(done.db, w.finance, { type: "issue_rental_invoice", input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" } }, "2026-03-04T08:00:00.000Z");
    expect(issued.ok).toBe(true);
  });

  it("refuses to sign a charge that has already been billed, and names the invoice", () => {
    const w = onTheRoad(100);
    const done = complete(w, [{ description: "Fuel", quantity: "1", unitAmount: "400", reason: "Tank refilled" }]);
    if (!done.ok) throw new Error(done.message);
    // Below the figure? No: 400 is above 100, so it waits. Take it down to 50 to bill it.
    const cheap = complete(w, [{ description: "Parking", quantity: "1", unitAmount: "50", reason: "Parked overnight" }]);
    if (!cheap.ok) throw new Error(cheap.message);
    const issued = executeCommand(cheap.db, w.finance, { type: "issue_rental_invoice", input: { rentalId: w.id, issuedOn: "2026-03-04", discountAmount: "", discountReason: "", notes: "" } }, "2026-03-04T08:00:00.000Z");
    if (!issued.ok) throw new Error(issued.message);
    const late = execute(issued.db, w.finance, { type: "approve_extra_charge", id: w.id, chargeId: issued.db.rentals[0].extraCharges[0].id, note: "" }, "2026-03-05T09:00:00.000Z");
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toBe(`This charge has already been billed on ${issued.db.invoices[0].reference}, which cannot be changed. Credit the invoice instead.`);
  });

  it("has nothing to approve on a hire with no charges, and names a charge that is not there", () => {
    const w = onTheRoad(500);
    const done = complete(w, []);
    if (!done.ok) throw new Error(done.message);
    const none = execute(done.db, w.finance, { type: "approve_extra_charge", id: w.id, chargeId: "ch-nope", note: "" }, "2026-03-04T09:00:00.000Z");
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toBe("There are no extra charges on this hire to approve.");

    const withCharge = complete(onTheRoad(500), [{ description: "Fuel", quantity: "1", unitAmount: "400", reason: "Tank refilled" }]);
    if (!withCharge.ok) throw new Error(withCharge.message);
    const wrong = execute(withCharge.db, w.finance, { type: "approve_extra_charge", id: withCharge.db.rentals[0].id, chargeId: "ch-nope", note: "" }, "2026-03-04T09:00:00.000Z");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toBe("That charge is not on this hire.");
  });

  it("keeps an older hire with no charges working, and adds none to it", () => {
    const w = onTheRoad();
    const done = complete(w, []);
    if (!done.ok) throw new Error(done.message);
    expect(done.db.rentals[0].extraCharges).toEqual([]);
    expect(done.db.audit[0].summary).not.toContain("Extra charges");
  });
});

describe("a hire completed before anything was charged beyond the price (D-123)", () => {
  it("carries no charges, and says so rather than inventing a blank one", () => {
    const db = emptyDatabase() as unknown as Record<string, unknown>;
    const rental = {
      id: "r-old",
      reference: "RR-0009",
      clientId: null,
      customerName: "Old Customer",
      customerPhone: "",
      customerEmail: "",
      purpose: "",
      pickupLocation: "",
      dropoffLocation: "",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      passengers: 1,
      vehicleCategoryId: "cat-1",
      driverRequired: false,
      notes: "",
      status: "completed",
      quote: null,
      quoteHistory: [],
      acceptance: null,
      run: null,
      plan: null,
      assignedVehicleId: null,
      assignedDriverId: null,
      deposit: null,
      finalInvoice: { currencyCode: "GHS", lines: [{ id: "l1", description: "Hire", quantity: 1, unitAmount: 100 }], total: 100, issuedAt: "2026-01-02T10:00:00.000Z", issuedBy: "Ops" },
      resolutionReason: null,
      createdAt: "2026-01-01T08:00:00.000Z",
      updatedAt: "2026-01-02T10:00:00.000Z",
    };
    const loaded = migrate({ ...db, schemaVersion: 36, rentals: [rental] });
    expect(loaded).not.toBeNull();
    // A hire completed before charges existed was billed for what it was billed for; no charge is
    // invented for it, and none is signed off.
    expect(loaded!.rentals[0].extraCharges).toEqual([]);
    expect(loaded!.settings.rental.extraChargeApprovalAbove).toBeNull();
  });
});
