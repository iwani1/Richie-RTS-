// Invoices and manual payments (FIN-02, FIN-03): arithmetic, immutability and the guards that stop
// the same service being billed twice or a payment being recorded twice.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { invoiceBalance } from "./creditNotes";
import { outstanding } from "./finance";
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
  vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
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
    // The payment commands are record, advance and cancel; neither advancing nor cancelling may
    // touch the financial fields.
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

describe("FIN-03 cancelling a payment recorded in error (D-88)", () => {
  function invoiced(overrides: Record<string, unknown> = {}) {
    const w = completedRental(overrides);
    step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    return w;
  }

  it("puts the invoice back to what it actually owed and keeps the record", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "2000" }) });
    expect(w.db.invoices[0].amountPaid).toBe(2000);
    expect(w.db.invoices[0].status).toBe("part_paid");

    const cancelled = step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Recorded against the wrong invoice" });
    expect(cancelled.ok && cancelled.message).toMatch(/PAY-2026-0001 cancelled\. INV-2026-0001 outstanding: GHS 4700\.00\./);

    const subject = w.db.invoices[0];
    expect(subject.amountPaid).toBe(0);
    expect(subject.status).toBe("issued");
    expect(outstanding(w.db, subject)).toBe(4700);
    expect(invoiceBalance(w.db, subject).paid).toBe(0);

    // The payment keeps its number, its amount and its date: only the cancellation was added.
    const kept = w.db.payments[0];
    expect(kept.reference).toBe("PAY-2026-0001");
    expect(kept.amount).toBe(2000);
    expect(kept.paidOn).toBe("2026-06-01");
    expect(kept.voidReason).toBe("Recorded against the wrong invoice");
    expect(kept.voidedAt).toBe(NOW);
    expect(kept.status).toBe("recorded");
    expect(kept.log.at(-1)).toMatchObject({ note: "Payment cancelled: Recorded against the wrong invoice", fromStatus: "recorded", toStatus: "recorded" });
    expect(w.db.audit[0].action).toBe("finance:payment_void");
    expect(w.db.audit[0].summary).toMatch(/Recorded against the wrong invoice/);
  });

  it("is a one-way door: a cancelled payment cannot be cancelled twice", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "500" }) });
    step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Money never arrived" });
    const again = attempt(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Changed my mind" });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.message).toMatch(/already cancelled/);
    expect(w.db.payments[0].voidReason).toBe("Money never arrived");
  });

  it("requires a reason, and refuses an unknown payment", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "500" }) });
    const blank = attempt(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "   " });
    expect(blank.ok).toBe(false);
    expect(errorsOf(blank).reason).toMatch(/why this payment is being cancelled/i);
    expect(w.db.payments[0].voidedAt).toBeNull();

    const missing = attempt(w, "finance", { type: "void_payment", id: "nope", reason: "Typo" });
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.message).toMatch(/Payment not found/);
  });

  it("recomputes the invoice from the payments that still count, not from the cancelled one", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "1000", externalReference: "SLIP-A" }) });
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "1500", externalReference: "SLIP-B" }) });
    expect(w.db.invoices[0].amountPaid).toBe(2500);
    expect(w.db.invoices[0].status).toBe("part_paid");

    step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Wrong amount keyed in" });
    expect(w.db.invoices[0].amountPaid).toBe(1500);
    expect(w.db.invoices[0].status).toBe("part_paid");

    // A later payment is measured against the corrected balance, and the total stays consistent.
    const tooMuch = attempt(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "3300", externalReference: "SLIP-C" }) });
    expect(tooMuch.ok).toBe(false);
    expect(errorsOf(tooMuch).amount).toMatch(/GHS 3200\.00 outstanding/);
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "3200", externalReference: "SLIP-C" }) });
    expect(w.db.invoices[0].amountPaid).toBe(4700);
    expect(w.db.invoices[0].status).toBe("paid");
  });

  it("lets a wrongly paid invoice be voided once its only payment is cancelled", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "4700" }) });
    expect(attempt(w, "finance", { type: "void_invoice", id: invoiceId, reason: "Wrong customer" }).ok).toBe(false);

    step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Paid by the other customer" });
    step(w, "finance", { type: "void_invoice", id: invoiceId, reason: "Wrong customer" });
    expect(w.db.invoices[0].status).toBe("void");
    // A cancelled payment on a void invoice does not bring it back to life.
    expect(w.db.invoices[0].amountPaid).toBe(0);
  });

  it("cancels a reconciled payment, and says what that does to the reconciliation", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "500" }) });
    step(w, "finance", { type: "advance_payment", id: w.db.payments[0].id, to: "verified" });
    step(w, "finance", { type: "advance_payment", id: w.db.payments[0].id, to: "reconciled" });

    const cancelled = step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Matched to the wrong statement line" });
    expect(cancelled.ok && cancelled.message).toMatch(/reconciled with the bank statement/);
    // The verification status is not rewritten: the payment was reconciled, and it was cancelled.
    expect(w.db.payments[0].status).toBe("reconciled");
    expect(w.db.payments[0].voidedAt).toBe(NOW);
    expect(w.db.invoices[0].amountPaid).toBe(0);
  });

  it("is closed to operations: cancelling money needs payments:void", () => {
    const w = invoiced();
    step(w, "finance", { type: "record_payment", input: payment(w.db.invoices[0].id, { amount: "500" }) });
    const denied = attempt(w, "ops", { type: "void_payment", id: w.db.payments[0].id, reason: "Trying it on" });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.message).toMatch(/payments:void/);
    expect(w.db.payments[0].voidedAt).toBeNull();
  });

  it("leaves a credit note and a cancellation independent of one another", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "2000" }) });
    step(w, "finance", {
      type: "issue_credit_note",
      input: { invoiceId, issuedOn: "2026-06-02", amount: "1000", description: "Airport transfer not operated", reason: "Service not delivered" },
    });
    // 4,700 − 2,000 paid − 1,175 credited = 1,525 still owed.
    expect(invoiceBalance(w.db, w.db.invoices[0]).outstanding).toBe(1525);

    step(w, "finance", { type: "void_payment", id: w.db.payments[0].id, reason: "Customer's transfer bounced" });
    // Only the payment moved: the credit note still stands, so 4,700 − 1,175 = 3,525.
    expect(w.db.creditNotes[0].status).toBe("issued");
    expect(invoiceBalance(w.db, w.db.invoices[0]).outstanding).toBe(3525);
    expect(invoiceBalance(w.db, w.db.invoices[0]).refundDue).toBe(0);
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

// Credit notes (FIN-02, D-86): the only way to take money off an invoice that has already gone out.
//
// The invoice in these tests is worth GHS 4,000.00 before tax, VAT 15% and NHIL 2.5% on top, so its
// total is GHS 4,700.00. A credit note is typed before tax and carries the invoice's own rates.
describe("FIN-02 credit notes", () => {
  function invoiced(overrides: Record<string, unknown> = {}) {
    const w = completedRental(overrides);
    step(w, "finance", { type: "issue_rental_invoice", input: invoice({ rentalId: w.rentalId }) });
    return w;
  }

  const credit = (invoiceId: string, overrides: Record<string, unknown> = {}) => ({
    invoiceId,
    issuedOn: "2026-06-02",
    amount: "1000",
    description: "Airport transfer not operated",
    reason: "Service not delivered",
    ...overrides,
  });

  it("issues a numbered credit note with the invoice's own tax, and reduces what is owed", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    const issued = step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });

    const note = w.db.creditNotes[0];
    expect(note.reference).toBe("CN-2026-0001");
    expect(note.invoiceReference).toBe("INV-2026-0001");
    expect(note.subtotal).toBe(1000);
    // The same two rates the invoice was charged at, on the amount being credited.
    expect(note.taxLines).toEqual([
      { name: "VAT", ratePercent: 15, amount: 150 },
      { name: "NHIL", ratePercent: 2.5, amount: 25 },
    ]);
    expect(note.total).toBe(1175);
    expect(note.status).toBe("issued");
    expect(note.createdBy).toBe("Fin");
    expect(issued.ok && issued.message).toMatch(/CN-2026-0001 issued for GHS 1175\.00/);
    expect(issued.ok && issued.message).toMatch(/outstanding: GHS 3525\.00/);
    // The invoice itself does not change: an issued invoice is immutable, and its payments are facts.
    expect(w.db.invoices[0].total).toBe(4700);
    expect(w.db.invoices[0].amountPaid).toBe(0);
    expect(w.db.audit[0].action).toBe("finance:credit_note_issue");
  });

  it("refuses more than the invoice has left, and accepts the exact ceiling", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    const tooMuch = attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "5000" }) });
    expect(tooMuch.ok).toBe(false);
    expect(errorsOf(tooMuch).amount).toMatch(/GHS 4700\.00 including tax/);
    expect(w.db.creditNotes).toHaveLength(0);

    // 4,000 before tax is the whole invoice: 4,000 + 600 + 100 = 4,700.
    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "4000" }) });
    expect(w.db.creditNotes[0].total).toBe(4700);

    const full = attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "1" }) });
    expect(full.ok).toBe(false);
    expect(errorsOf(full).amount).toMatch(/credited in full|more than INV-2026-0001 has left/);
  });

  it("closes the balance when payments and credits together cover the invoice", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "2000" }) });
    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "2000" }) });
    expect(outstanding(w.db, w.db.invoices[0])).toBe(350);

    // The last 350.00 including tax: 297.87 + 44.68 VAT + 7.45 NHIL = 350.00 exactly.
    const last = step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "297.87", description: "Balance written off" }) });
    const balance = invoiceBalance(w.db, w.db.invoices[0]);
    expect(balance.credited).toBe(2700);
    expect(balance.paid).toBe(2000);
    expect(balance.outstanding).toBe(0);
    expect(balance.refundDue).toBe(0);
    expect(balance.settled).toBe(true);
    // Nothing was paid beyond what was received, and the money received was not rewritten.
    expect(w.db.invoices[0].amountPaid).toBe(2000);
    expect(last.ok && last.message).toMatch(/outstanding: GHS 0\.00/);
  });

  it("says plainly when a credit takes the bill below the cash received", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "4700" }) });
    expect(w.db.invoices[0].status).toBe("paid");

    const issued = step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });
    const balance = invoiceBalance(w.db, w.db.invoices[0]);
    expect(balance.outstanding).toBe(0);
    expect(balance.refundDue).toBe(1175);
    expect(issued.ok && issued.message).toMatch(/GHS 1175\.00 is owed back to the customer as a refund/);
    // The payment is untouched: a refund is money out, not a smaller receipt.
    expect(w.db.payments[0].amount).toBe(4700);
  });

  it("voids a credit note, puts the money back on the bill, and never reuses the number", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });
    const noteId = w.db.creditNotes[0].id;
    expect(outstanding(w.db, w.db.invoices[0])).toBe(3525);

    const voided = step(w, "finance", { type: "void_credit_note", id: noteId, reason: "Issued against the wrong invoice" });
    expect(voided.ok && voided.message).toMatch(/CN-2026-0001 voided\. INV-2026-0001 outstanding: GHS 4700\.00/);
    expect(w.db.creditNotes[0].status).toBe("void");
    expect(w.db.creditNotes[0].voidReason).toBe("Issued against the wrong invoice");
    expect(outstanding(w.db, w.db.invoices[0])).toBe(4700);

    const twice = attempt(w, "finance", { type: "void_credit_note", id: noteId, reason: "Again" });
    expect(twice.ok).toBe(false);
    expect(twice.ok === false && twice.message).toMatch(/already void/);

    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });
    expect(w.db.creditNotes[1].reference).toBe("CN-2026-0002");
  });

  it("refuses to void an invoice while a credit note stands, and allows it once the note is void", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });

    const refused = attempt(w, "finance", { type: "void_invoice", id: invoiceId, reason: "Wrong customer" });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.message).toMatch(/credit note CN-2026-0001 against it/);
    expect(w.db.invoices[0].status).toBe("issued");

    // Void the credit note and the invoice is voidable again: the document has nothing against it.
    step(w, "finance", { type: "void_credit_note", id: w.db.creditNotes[0].id, reason: "Issued in error" });
    step(w, "finance", { type: "void_invoice", id: invoiceId, reason: "Wrong customer" });
    expect(w.db.invoices[0].status).toBe("void");
  });

  it("needs a description, a reason and a date on or after the invoice", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    expect(errorsOf(attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { description: "  " }) })).description).toMatch(/Say what this credit is for/);
    expect(errorsOf(attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { reason: "" }) })).reason).toMatch(/short reason/);
    expect(errorsOf(attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { issuedOn: "2026-05-30" }) })).issuedOn).toMatch(/pre-date/);
    expect(errorsOf(attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "0" }) })).amount).toBeDefined();
    expect(errorsOf(attempt(w, "finance", { type: "issue_credit_note", input: credit(invoiceId, { amount: "1.005" }) })).amount).toMatch(/two decimal places/);
    expect(w.db.creditNotes).toHaveLength(0);
  });

  it("is closed to operations, like the rest of the money", () => {
    const w = invoiced();
    const refusal = attempt(w, "ops", { type: "issue_credit_note", input: credit(w.db.invoices[0].id) });
    expect(refusal.ok).toBe(false);
    expect(refusal.ok === false && refusal.message).toMatch(/lacks credits:issue/);
    expect(attempt(w, "ops", { type: "void_credit_note", id: "missing", reason: "x" }).ok).toBe(false);
  });

  it("makes a later payment respect what the credit already took off", () => {
    const w = invoiced();
    const invoiceId = w.db.invoices[0].id;
    step(w, "finance", { type: "issue_credit_note", input: credit(invoiceId) });
    const over = attempt(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "4700" }) });
    expect(over.ok).toBe(false);
    expect(errorsOf(over).amount).toMatch(/GHS 3525\.00 outstanding/);

    step(w, "finance", { type: "record_payment", input: payment(invoiceId, { amount: "3525" }) });
    expect(invoiceBalance(w.db, w.db.invoices[0]).settled).toBe(true);
    expect(w.db.invoices[0].amountPaid).toBe(3525);
  });
});
