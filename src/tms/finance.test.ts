// Invoices and manual payments (FIN-02, FIN-03): arithmetic, immutability and the guards that stop
// the same service being billed twice or a payment being recorded twice.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { execute, type Actor, type Credential, type CommandResult } from "./service";
import { emptyDatabase, emptyRentalSettings, type Database } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const EMAILS = { admin: "admin@example.test", ops: "ops@example.test", finance: "fin@example.test" } as const;
type Who = keyof typeof EMAILS;

interface World {
  db: Database;
  rentalId: string;
}

function actorOf(db: Database, who: Who): Actor {
  const user = db.users.find((candidate) => candidate.email === EMAILS[who]);
  if (!user) throw new Error(`missing user ${who}`);
  return { id: user.id, fullName: user.fullName, role: user.role };
}

const step = (w: World, who: Who, command: AnyCommand): CommandResult => {
  const result = executeCommand(w.db, actorOf(w.db, who), command, NOW);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
};
const attempt = (w: World, who: Who, command: AnyCommand): CommandResult => executeCommand(w.db, actorOf(w.db, who), command, NOW);
const errorsOf = (result: CommandResult): Record<string, string> => (result.ok ? {} : result.errors);

const settings = (overrides: Record<string, unknown> = {}) => ({
  companyName: "Richie Transport Services",
  currencyCode: "GHS",
  onTimeThresholdMinutes: 5,
  vehicleCategories: [{ id: "", name: "Coaster" }],
  shifts: [],
  rental: { ...emptyRentalSettings(), pricingBasis: "per_day" as const, depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Cash", "Bank transfer", "Mobile money"] },
  documentTypes: [],
  documentReminderLeadDays: null,
  taxPosition: "registered" as const,
  taxLines: [
    { id: "", name: "VAT", ratePercent: 15 },
    { id: "", name: "NHIL", ratePercent: 2.5 },
  ],
  invoiceDueDays: 14,
  workTypes: ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other"],
  costCategories: ["Parts", "Labour", "Tyres"],
  maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
  ...overrides,
});

/** A completed rental worth GHS 4,000.00: two days at 1,500 plus one extra at 1,000. */
function completedRental(overrides: Record<string, unknown> = {}): World {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: EMAILS.admin }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  const w: World = { db: setup.db, rentalId: "" };
  step(w, "admin", { type: "create_user", input: { fullName: "Ops", email: EMAILS.ops, role: "operations", active: true }, credential: cred });
  step(w, "admin", { type: "create_user", input: { fullName: "Fin", email: EMAILS.finance, role: "finance", active: true }, credential: cred });
  step(w, "admin", { type: "update_settings", input: settings(overrides) });
  const categoryId = w.db.settings.vehicleCategories[0].id;
  step(w, "ops", { type: "create_vehicle", input: { registration: "GT 500-26", categoryId, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } });
  step(w, "ops", {
    type: "create_rental",
    input: {
      clientId: null,
      customerName: "Acme Ltd",
      customerPhone: "0244000000",
      customerEmail: "ops@acme.test",
      purpose: "Staff retreat",
      pickupLocation: "Accra",
      dropoffLocation: "Kumasi",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      passengers: "20",
      vehicleCategoryId: categoryId,
      driverRequired: false,
      notes: "",
    },
  });
  w.rentalId = w.db.rentals[0].id;
  const id = w.rentalId;
  step(w, "ops", { type: "quote_rental", id, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } });
  step(w, "admin", { type: "confirm_rental", id, input: { amount: "600", method: "Bank transfer", reference: "SLIP-1" } });
  step(w, "ops", { type: "assign_rental", id, input: { vehicleId: w.db.vehicles[0].id, driverId: "" } });
  step(w, "ops", { type: "start_rental", id });
  step(w, "ops", {
    type: "complete_rental",
    id,
    input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }, { description: "Extra day", quantity: "1", unitAmount: "1000" }] },
  });
  return w;
}

const invoice = (overrides: Record<string, unknown> = {}) => ({
  rentalId: "",
  issuedOn: "2026-06-01",
  discountAmount: "",
  discountReason: "",
  notes: "",
  ...overrides,
});

const payment = (invoiceId: string, overrides: Record<string, unknown> = {}) => ({
  invoiceId,
  amount: "1000",
  method: "Bank transfer",
  paidOn: "2026-06-01",
  externalReference: "SLIP-9001",
  note: "",
  ...overrides,
});

describe("FIN-02 invoices", () => {
  it("issues a numbered invoice from the completed rental, with configured tax lines", () => {
    const w = completedRental();
    const issued = step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    const subject = w.db.invoices[0];
    expect(subject.reference).toBe("INV-2026-0001");
    expect(subject.lines.map((line) => line.description)).toEqual(["Two days hire", "Extra day"]);
    expect(subject.subtotal).toBe(4000);
    // Tax lines are snapshots: 15% VAT and 2.5% NHIL on the pre-tax subtotal of 4,000.
    expect(subject.taxLines).toEqual([
      { name: "VAT", ratePercent: 15, amount: 600 },
      { name: "NHIL", ratePercent: 2.5, amount: 100 },
    ]);
    expect(subject.total).toBe(4700);
    expect(subject.amountPaid).toBe(0);
    expect(subject.status).toBe("issued");
    expect(subject.dueOn).toBe("2026-06-15"); // 14 day terms from settings
    expect(subject.currencyCode).toBe("GHS");
    expect(issued.ok && issued.message).toMatch(/INV-2026-0001 issued: GHS 4700\.00 due 2026-06-15/);
    expect(w.db.audit[0].action).toBe("finance:invoice_issue");
  });

  it("refuses a second live invoice for the same service and allows one after a void", () => {
    const w = completedRental();
    step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });

    const duplicate = attempt(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    expect(duplicate.ok).toBe(false);
    expect(errorsOf(duplicate).rentalId).toMatch(/already invoiced as INV-2026-0001/);

    step(w, "finance", { type: "void_invoice", id: w.db.invoices[0].id, reason: "Wrong customer name" });
    expect(w.db.invoices[0].status).toBe("void");
    expect(w.db.invoices[0].voidReason).toBe("Wrong customer name");

    const again = step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    expect(again.ok).toBe(true);
    expect(w.db.invoices).toHaveLength(2);
    expect(w.db.invoices[1].reference).toBe("INV-2026-0002");
    // The voided number is never reused.
    expect(w.db.invoices[0].reference).toBe("INV-2026-0001");
  });

  it("blocks issue until the settings that have no default are set", () => {
    const noTax = completedRental({ taxPosition: null, taxLines: [] });
    const taxBlocked = attempt(noTax, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: noTax.rentalId }) });
    expect(errorsOf(taxBlocked).taxPosition).toMatch(/tax position/i);

    const noTerms = completedRental({ invoiceDueDays: null });
    const termsBlocked = attempt(noTerms, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: noTerms.rentalId }) });
    expect(errorsOf(termsBlocked).invoiceDueDays).toMatch(/payment terms/i);
  });

  it("cannot issue against a rental that was never completed", () => {
    const w = completedRental();
    step(w, "ops", {
      type: "create_rental",
      input: {
        clientId: null,
        customerName: "Beta Ltd",
        customerPhone: "0244000001",
        customerEmail: "",
        purpose: "Conference",
        pickupLocation: "Accra",
        dropoffLocation: "Accra",
        startDate: "2026-06-05",
        endDate: "2026-06-06",
        passengers: "10",
        vehicleCategoryId: w.db.settings.vehicleCategories[0].id,
        driverRequired: false,
        notes: "",
      },
    });
    const pending = w.db.rentals[1];
    const refused = attempt(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: pending.id }) });
    expect(refused.ok).toBe(false);
    expect(errorsOf(refused).rentalId).toMatch(/complete the rental first/i);
  });

  it("applies a discount as its own line and keeps the arithmetic exact", () => {
    const w = completedRental();
    const missingReason = attempt(w, "finance", {
      type: "issue_rental_invoice",
      input: invoice({ rentalId: w.rentalId, discountAmount: "500" }),
    });
    expect(errorsOf(missingReason).discountReason).toBeDefined();

    step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId, discountAmount: "500.55", discountReason: "Goodwill" }) });
    const subject = w.db.invoices[0];
    expect(subject.lines[2]).toMatchObject({ description: "Discount: Goodwill", quantity: 1, unitAmount: -500.55 });
    expect(subject.subtotal).toBe(3499.45);
    expect(subject.total).toBe(4111.86); // 3,499.45 + 524.92 VAT + 87.49 NHIL, each rounded to the cent
    expect(subject.total).toBeGreaterThanOrEqual(0);
  });

  it("is finance-only: operations can complete a rental but not bill it", () => {
    const w = completedRental();
    const denied = attempt(w, "ops", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.message).toMatch(/invoices:issue/);
  });
});

describe("FIN-03 manual payments", () => {
  function invoiced(overrides: Record<string, unknown> = {}) {
    const w = completedRental(overrides);
    step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    return w;
  }

  it("records a part payment, then settles the invoice and reports what is outstanding", () => {
    const w = invoiced();
    const id = w.db.invoices[0].id;
    const part = step(w, "finance", { type: "record_payment", input: payment(id, { amount: "2000" }) });
    expect(part.ok && part.message).toMatch(/PAY-2026-0001 recorded\. INV-2026-0001 outstanding: GHS 2700\.00/);
    expect(w.db.payments[0].status).toBe("recorded");
    expect(w.db.payments[0].currencyCode).toBe("GHS");
    expect(w.db.payments[0].recordedBy).toBe("Fin");
    expect(w.db.invoices[0].amountPaid).toBe(2000);
    expect(w.db.invoices[0].status).toBe("part_paid");

    const rest = step(w, "finance", { type: "record_payment", input: payment(id, { amount: "2700", externalReference: "SLIP-9002" }) });
    expect(rest.ok).toBe(true);
    expect(w.db.invoices[0].amountPaid).toBe(4700);
    expect(w.db.invoices[0].status).toBe("paid");
    expect(w.db.payments[1].reference).toBe("PAY-2026-0002");
  });

  it("refuses an overpayment and names the outstanding balance", () => {
    const w = invoiced();
    const over = attempt(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "5000" }) });
    expect(over.ok).toBe(false);
    expect(errorsOf(over).amount).toMatch(/4700\.00 outstanding/);
    expect(w.db.payments).toHaveLength(0);
  });

  it("treats the external reference as an idempotency key", () => {
    const w = invoiced();
    const id = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "1000", externalReference: "MOMO-777" }) });
    const replay = step(w, "finance", { type: "record_payment", input: payment(id, { amount: "1000", externalReference: "MOMO-777" }) });
    expect(replay.ok && replay.message).toMatch(/already recorded as PAY-2026-0001/);
    expect(w.db.payments).toHaveLength(1);
    expect(w.db.invoices[0].amountPaid).toBe(1000);
  });

  it("requires a configured payment method and a date on or after the invoice date", () => {
    const w = invoiced();
    const id = w.db.invoices[0].id;
    expect(errorsOf(attempt(w, "finance", { type: "record_payment", input: payment(id, { method: "Cheque" }) })).method).toMatch(/Unknown payment method/);
    expect(errorsOf(attempt(w, "finance", { type: "record_payment", input: payment(id, { paidOn: "2026-05-30" }) })).paidOn).toMatch(/pre-date/);
    expect(errorsOf(attempt(w, "finance", { type: "record_payment", input: payment(id, { amount: "0" }) })).amount).toBeDefined();
  });

  it("refuses to void an invoice that has money against it", () => {
    const w = invoiced();
    const id = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "500" }) });
    const refused = attempt(w, "finance", { type: "void_invoice", id, reason: "Wrong amount" });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toMatch(/1 payment recorded against it/);
    expect(w.db.invoices[0].status).toBe("part_paid");
  });

  it("advances verification forwards only", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id) });
    const paymentId = w.db.payments[0].id;
    step(w, "finance", { type: "advance_payment", id: paymentId, to: "verified" });
    expect(w.db.payments[0].status).toBe("verified");
    expect(w.db.payments[0].log.at(-1)).toMatchObject({ fromStatus: "recorded", toStatus: "verified" });
    step(w, "finance", { type: "advance_payment", id: paymentId, to: "reconciled" });
    expect(w.db.payments[0].status).toBe("reconciled");

    const backwards = attempt(w, "finance", { type: "advance_payment", id: paymentId, to: "verified" });
    expect(backwards.ok).toBe(false);
    expect(backwards.ok === false && backwards.message).toMatch(/only moves forwards/);
  });

  it("keeps the payment record immutable: no command edits an amount", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "750" }) });
    const snapshot = JSON.stringify(w.db.payments[0]);
    // The only payment commands are record_payment and advance_payment; advancing must not touch
    // the financial fields.
    step(w, "finance", { type: "advance_payment", id: w.db.payments[0].id, to: "verified" });
    const after = w.db.payments[0];
    expect(after.amount).toBe(750);
    expect(after.paidOn).toBe(JSON.parse(snapshot).paidOn);
    expect(after.externalReference).toBe("SLIP-9001");
    expect(after.recordedBy).toBe(JSON.parse(snapshot).recordedBy);
  });

  it("is closed to operations: recording money needs payments:record", () => {
    const w = invoiced();
    const denied = attempt(w, "ops", { type: "record_payment", input: payment(w.db.invoices[0].id) });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.message).toMatch(/payments:record/);
  });
});

describe("money arithmetic on real documents (audit D-04)", () => {
  /**
   * A hire whose subtotal makes the tax a half-pesewa tie: GHS 15.90 at 15% is GHS 2.385, which a
   * person writing the invoice puts down as 2.39. The old float helper produced 2.38, so this test
   * fails against the code this pass replaced.
   */
  function tieRental(taxLines: { id: string; name: string; ratePercent: number }[], depositPercent = 20): World {
    const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: EMAILS.admin }, credential: cred }, NOW);
    if (!setup.ok) throw new Error(setup.message);
    const w: World = { db: setup.db, rentalId: "" };
    step(w, "admin", { type: "create_user", input: { fullName: "Ops", email: EMAILS.ops, role: "operations", active: true }, credential: cred });
    step(w, "admin", { type: "create_user", input: { fullName: "Fin", email: EMAILS.finance, role: "finance", active: true }, credential: cred });
    step(w, "admin", {
      type: "update_settings",
      input: settings({
        taxPosition: "registered",
        taxLines,
        rental: { ...emptyRentalSettings(), pricingBasis: "per_day", depositPercent, quotationValidityDays: 14, paymentMethods: ["Cash", "Bank transfer"] },
      }),
    });
    const categoryId = w.db.settings.vehicleCategories[0].id;
    step(w, "ops", { type: "create_vehicle", input: { registration: "GT 501-26", categoryId, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } });
    step(w, "ops", {
      type: "create_rental",
      input: {
        clientId: null,
        customerName: "Tie Ltd",
        customerPhone: "0244000001",
        customerEmail: "",
        purpose: "",
        pickupLocation: "Accra",
        dropoffLocation: "Tema",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        passengers: "10",
        vehicleCategoryId: categoryId,
        driverRequired: false,
        notes: "",
      },
    });
    w.rentalId = w.db.rentals[0].id;
    const id = w.rentalId;
    step(w, "ops", { type: "quote_rental", id, input: { lines: [{ description: "One day", quantity: "1", unitAmount: "15.90" }] } });
    // Pay exactly the deposit the quotation asks for, whatever percentage the test configured.
    const deposit = w.db.rentals[0].quote!.depositRequired;
    step(w, "admin", { type: "confirm_rental", id, input: { amount: deposit.toFixed(2), method: "Cash", reference: "DEP-TIE" } });
    step(w, "ops", { type: "assign_rental", id, input: { vehicleId: w.db.vehicles[0].id, driverId: "" } });
    step(w, "ops", { type: "start_rental", id });
    step(w, "ops", { type: "complete_rental", id, input: { lines: [{ description: "One day", quantity: "1", unitAmount: "15.90" }] } });
    return w;
  }

  it("puts the tax on a half-pesewa tie up, not down, on the invoice it issues", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }]);
    step(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId } });
    const issued = w.db.invoices[0];
    expect(issued.subtotal).toBe(15.9);
    // 2.385 → 2.39, half-up. The float helper gave 2.38.
    expect(issued.taxLines[0].amount).toBe(2.39);
    expect(issued.total).toBe(18.29);
  });

  it("puts the deposit on a half-pesewa tie up in the quotation", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }], 25);
    // 25% of 15.90 is 3.975 → 3.98 (the float helper gave 3.97 for the 8.54-style cases).
    expect(w.db.rentals[0].quote?.depositRequired).toBe(3.98);
  });

  it("settles an invoice exactly, with no residual pesewa claimed as outstanding", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }]);
    step(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId } });
    const id = w.db.invoices[0].id;
    // Three payments of a third each: the classic float trap. 6.10 + 6.10 + 6.09 = 18.29 exactly.
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "6.10", externalReference: "A" }) });
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "6.10", externalReference: "B" }) });
    const last = step(w, "finance", { type: "record_payment", input: payment(id, { amount: "6.09", externalReference: "C" }) });
    expect(w.db.invoices[0].amountPaid).toBe(18.29);
    expect(w.db.invoices[0].status).toBe("paid");
    expect(last.message).toMatch(/outstanding: GHS 0\.00/);
  });

  it("refuses one pesewa more than the balance, and accepts the balance itself", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }]);
    step(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId } });
    const id = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "18.28", externalReference: "PART" }) });
    const tooMuch = attempt(w, "finance", { type: "record_payment", input: payment(id, { amount: "0.02", externalReference: "OVER" }) });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.errors.amount).toMatch(/0\.01 outstanding/);
    // The exact balance is accepted — no 0.001 fudge factor needed.
    step(w, "finance", { type: "record_payment", input: payment(id, { amount: "0.01", externalReference: "REST" }) });
    expect(w.db.invoices[0].status).toBe("paid");
  });

  it("refuses an amount with a third decimal instead of rounding it", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }]);
    step(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId } });
    const id = w.db.invoices[0].id;
    const result = attempt(w, "finance", { type: "record_payment", input: payment(id, { amount: "5.005" }) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toMatch(/two decimal places/);
    // Nothing was recorded, and the invoice is untouched.
    expect(w.db.payments).toHaveLength(0);
    expect(w.db.invoices[0].amountPaid).toBe(0);
  });

  it("refuses a discount with a third decimal, and adds an exact one", () => {
    const w = tieRental([{ id: "", name: "VAT", ratePercent: 15 }]);
    const bad = attempt(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId, discountAmount: "1.005", discountReason: "Goodwill" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.discountAmount).toMatch(/two decimal places/);

    step(w, "finance", { type: "issue_rental_invoice", input: { ...invoice(), rentalId: w.rentalId, discountAmount: "0.55", discountReason: "Goodwill" } });
    const issued = w.db.invoices[0];
    // 15.90 − 0.55 = 15.35, tax 15% = 2.3025 → 2.30, total 17.65.
    expect(issued.subtotal).toBe(15.35);
    expect(issued.taxLines[0].amount).toBe(2.3);
    expect(issued.total).toBe(17.65);
  });
});
