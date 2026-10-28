// The two proofs the Phase 1A gate asks for that no unit test can give.
//
//   1. Workflow C end to end, through the same command path the HTTP route uses, against real
//      PostgreSQL — including a reload in the middle, so "it survived a restart" is demonstrated
//      rather than assumed.
//   2. Parallel assignment: six operators asking for the same vehicle for the same days at the same
//      moment. Exactly one may win, the rest must be refused with a sentence rather than a 500.
//
// Run with:
//   TEST_DATABASE_URL="postgresql://richie:…@127.0.0.1:5432/richie_tms_test" npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { closeDb, db } from "./db";
import { loadDatabase, truncateAll } from "./repository";
import { runCommand } from "./commands";
import type { AnyCommand } from "../tms/commands";
import type { Database } from "../tms/types";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

async function wipe(): Promise<void> {
  await db()
    .transaction()
    .execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
      await truncateAll(trx);
    });
}

async function command<T extends AnyCommand>(
  type: T["type"],
  body: Partial<T>,
  userId: string | null,
  now: string,
): Promise<{ ok: boolean; message: string; status: number; database?: Database; errors: Record<string, string> }> {
  return (await runCommand({ type, ...body } as T, { userId, now })) as {
    ok: boolean;
    message: string;
    status: number;
    database?: Database;
    errors: Record<string, string>;
  };
}

/** Fails loudly: a fixture that silently did not run would make every later assertion a lie. */
async function step<T extends AnyCommand>(type: T["type"], body: Partial<T>, userId: string | null, now: string): Promise<Database> {
  const result = await command(type, body, userId, now);
  if (!result.ok || !result.database) throw new Error(`${type} failed (${result.status}): ${result.message} ${JSON.stringify(result.errors)}`);
  return result.database;
}

const TODAY = "2026-06-01T07:00:00.000Z";

/** An administrator, one category, one vehicle and the settings a rental needs. */
async function world(): Promise<{ adminId: string; vehicleId: string; settings: Database["settings"] }> {
  const setup = await step("setup_administrator", { input: { fullName: "Admin", email: "admin@example.test" }, credential: cred } as never, null, TODAY);
  const adminId = setup.users[0].id;
  const configured = await step(
    "update_settings",
    {
      input: {
        ...setup.settings,
        companyName: "Richie Transport Services",
        currencyCode: "GHS",
        vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
        rental: {
          ...setup.settings.rental,
          quotationTerms: "Prices are firm for the validity period.",
      quotationApprovalAbove: null,
          pricingBasis: "per_day",
          depositPercent: 20,
          quotationValidityHours: 336,
          paymentMethods: ["Cash", "Bank transfer"],
        },
        taxPosition: "registered",
        taxLines: [{ id: "", name: "VAT", ratePercent: 15 }],
        invoiceDueDays: 14,
      },
    } as never,
    adminId,
    TODAY,
  );
  const created = await step(
    "create_vehicle",
    { input: { registration: "GT 1000-26", categoryId: configured.settings.vehicleCategories[0].id, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } } as never,
    adminId,
    TODAY,
  );
  return { adminId, vehicleId: created.vehicles[0].id, settings: created.settings };
}

async function confirmedRental(adminId: string, start: string, end: string): Promise<string> {
  const created = await step(
    "create_rental",
    {
      input: {
        clientId: null,
        customerName: "Acme Ltd",
        customerPhone: "0244000000",
        customerEmail: "ops@acme.test",
        purpose: "Staff retreat",
        pickupLocation: "Accra",
        dropoffLocation: "Kumasi",
        startDate: start,
        endDate: end,
        passengers: "12",
        vehicleCategoryId: (await loadDatabase()).settings.vehicleCategories[0].id,
        driverRequired: false,
        notes: "",
      },
    } as never,
    adminId,
    TODAY,
  );
  const id = created.rentals[created.rentals.length - 1].id;
  const quoted = await step("quote_rental", { id, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } } as never, adminId, TODAY);
  // The deposit is the company's percentage of the quotation's own total (RNT-04, D-121), so it is
  // read back rather than assumed: a registered company adds tax, and the share follows the total.
  const deposit = String(quoted.rentals.find((rental) => rental.id === id)?.quote?.depositRequired ?? 0);
  await step("confirm_rental", { id, input: { amount: deposit, method: "Cash", reference: "DEP-1" } } as never, adminId, TODAY);
  return id;
}

suite("workflow C and concurrency, against PostgreSQL", () => {
  beforeAll(async () => {
    if (!connectionString) return;
    process.env.DATABASE_URL = connectionString;
    const { migrate } = await import("../../scripts/migrate");
    await migrate(connectionString, () => undefined);
  });

  beforeEach(async () => {
    if (!connectionString) return;
    await wipe();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("runs a rental from request to a paid invoice, and the records survive a reload", async () => {
    const { adminId, vehicleId } = await world();
    const rentalId = await confirmedRental(adminId, "2026-06-01", "2026-06-03");

    // A reload here is the stand-in for a restart: nothing in memory may be carrying this.
    const afterConfirm = await loadDatabase();
    expect(afterConfirm.rentals.map((rental) => rental.status)).toEqual(["confirmed"]);

    const assigned = await step("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } } as never, adminId, TODAY);
    expect(assigned.rentals[0].assignedVehicleId).toBe(vehicleId);

    await step("start_rental", { id: rentalId } as never, adminId, "2026-06-01T09:00:00.000Z");
    await step(
      "complete_rental",
      { id: rentalId, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } } as never,
      adminId,
      "2026-06-03T18:00:00.000Z",
    );

    const invoiced = await step("issue_rental_invoice", { input: { rentalId, issuedOn: "2026-06-03", discountAmount: "", discountReason: "", notes: "Thank you" } } as never, adminId, "2026-06-03T18:30:00.000Z");
    const invoice = invoiced.invoices[0];
    expect(invoice.reference).toBe("INV-2026-0001");
    expect(invoice.total).toBe(3450); // 3,000 plus 15% VAT
    expect(invoice.dueOn).toBe("2026-06-17");

    await step("record_payment", { input: { invoiceId: invoice.id, amount: "1000", method: "Cash", paidOn: "2026-06-04", externalReference: "RCPT-1", note: "" } } as never, adminId, "2026-06-04T10:00:00.000Z");
    const paid = await step("record_payment", { input: { invoiceId: invoice.id, amount: "2450", method: "Bank transfer", paidOn: "2026-06-10", externalReference: "SLIP-77", note: "" } } as never, adminId, "2026-06-10T10:00:00.000Z");
    expect(paid.invoices[0].status).toBe("paid");
    expect(paid.invoices[0].amountPaid).toBe(3450);

    // What a restart would see.
    const reloaded = await loadDatabase();
    expect(reloaded.rentals[0].status).toBe("completed");
    expect(reloaded.invoices[0]).toMatchObject({ reference: "INV-2026-0001", status: "paid", amountPaid: 3450, total: 3450 });
    expect(reloaded.payments.map((payment) => payment.reference)).toEqual(["PAY-2026-0001", "PAY-2026-0002"]);
    expect(reloaded.referenceCounters).toEqual(
      expect.arrayContaining([
        { scope: "invoice", period: "2026", last: 1 },
        { scope: "payment", period: "2026", last: 2 },
      ]),
    );
    // The audit trail is in the database, not just in the returned snapshot.
    const audit = await db().selectFrom("audit_entry").select(["action"]).orderBy("at", "asc").execute();
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["finance:invoice_issue", "finance:payment_record", "rentals:complete"]),
    );
  }, 60_000);

  it("refuses a second invoice for the same rental at the database level, not just in the service", async () => {
    const { adminId, vehicleId } = await world();
    const rentalId = await confirmedRental(adminId, "2026-06-01", "2026-06-03");
    await step("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } } as never, adminId, TODAY);
    await step("start_rental", { id: rentalId } as never, adminId, "2026-06-01T09:00:00.000Z");
    // The return has to be after the departure now that a hire records its run (D-118).
    await step("complete_rental", { id: rentalId, input: { lines: [{ description: "Hire", quantity: "1", unitAmount: "1000" }] } } as never, adminId, "2026-06-01T17:00:00.000Z");
    const first = await step("issue_rental_invoice", { input: { rentalId, issuedOn: TODAY.slice(0, 10), discountAmount: "", discountReason: "", notes: "" } } as never, adminId, TODAY);

    // A direct insert that the service layer would never attempt: the partial unique index on
    // billable_event is what must stop it.
    await expect(
      sql`
        insert into invoice (id, reference, kind, rental_id, client_id, customer_name, currency_code,
          subtotal, total, amount_paid, status, billable_event, issued_on, due_on, created_at, updated_at, data)
        values ('dupe', 'INV-2026-0099', 'rental', ${rentalId}, null, 'Acme Ltd', 'GHS',
          1000, 1000, 0, 'issued', ${first.invoices[0].billableEvent}, '2026-06-03'::date, '2026-06-17'::date, now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/invoice_billable_event_uq|duplicate key/);
  }, 60_000);

  it("takes money off an invoice with a credit note, and the database refuses to over-credit (D-86)", async () => {
    const { adminId, vehicleId } = await world();
    const rentalId = await confirmedRental(adminId, "2026-06-01", "2026-06-03");
    await step("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } } as never, adminId, TODAY);
    await step("start_rental", { id: rentalId } as never, adminId, "2026-06-01T09:00:00.000Z");
    await step("complete_rental", { id: rentalId, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } } as never, adminId, "2026-06-03T18:00:00.000Z");
    const invoiced = await step("issue_rental_invoice", { input: { rentalId, issuedOn: "2026-06-03", discountAmount: "", discountReason: "", notes: "" } } as never, adminId, "2026-06-03T18:30:00.000Z");
    const invoice = invoiced.invoices[0];

    const credited = await step(
      "issue_credit_note",
      { input: { invoiceId: invoice.id, issuedOn: "2026-06-04", amount: "1000", description: "One day not operated", reason: "Vehicle broke down" } } as never,
      adminId,
      "2026-06-04T10:00:00.000Z",
    );
    const note = credited.creditNotes[0];
    expect(note.reference).toBe("CN-2026-0001");
    // 1,000 before tax plus 15% VAT on the invoice's own rate.
    expect(note.total).toBe(1150);
    // The invoice itself is untouched; the credit is a document of its own.
    expect(credited.invoices[0]).toMatchObject({ reference: "INV-2026-0001", total: 3450, amountPaid: 0 });

    const reloaded = await loadDatabase();
    expect(reloaded.creditNotes.map((entry) => entry.reference)).toEqual(["CN-2026-0001"]);
    expect(reloaded.creditNotes[0]).toMatchObject({ total: 1150, status: "issued", reason: "Vehicle broke down" });
    expect(reloaded.referenceCounters).toEqual(expect.arrayContaining([{ scope: "creditNote", period: "2026", last: 1 }]));

    // The ceiling is in the database, not only in the service: a direct insert past the invoice total
    // is refused by the trigger, so an import or a hand-written row cannot credit more than was billed.
    await expect(
      sql`
        insert into credit_note (id, reference, invoice_id, client_id, customer_name, currency_code,
          subtotal, total, reason, issued_on, status, created_by, created_at, updated_at, data)
        values ('over', 'CN-2026-0099', ${invoice.id}, null, 'Acme Ltd', 'GHS',
          3000, 3450, 'Too much', '2026-06-05'::date, 'issued', 'Admin', now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/credit_note_within_invoice|exceeds/);

    // Voiding puts the money back on the bill, and the number is not reused.
    const voided = await step("void_credit_note", { id: note.id, reason: "Wrong invoice" } as never, adminId, "2026-06-05T10:00:00.000Z");
    expect(voided.creditNotes[0].status).toBe("void");
    const after = await loadDatabase();
    expect(after.creditNotes[0]).toMatchObject({ reference: "CN-2026-0001", status: "void", voidReason: "Wrong invoice" });

    // A deleted or edited credit note is refused outright, like an invoice.
    await expect(sql`delete from credit_note where id = ${note.id}`.execute(db())).rejects.toThrow(/never deleted/);
    await expect(sql`update credit_note set total = 1 where id = ${note.id}`.execute(db())).rejects.toThrow(/immutable/);

    // A credit for the whole invoice, then voided: the ceiling must not count the row being written.
    // Before 014 this was refused — "Credit of 3450.00 exceeds the 0.00 left" — because the void was
    // saved through an insert statement and the row still counted as issued against itself.
    const big = await step(
      "issue_credit_note",
      { input: { invoiceId: invoice.id, issuedOn: "2026-06-06", amount: "3000", description: "Whole hire not operated", reason: "Cancelled by the customer" } } as never,
      adminId,
      "2026-06-06T10:00:00.000Z",
    );
    const bigNote = big.creditNotes.find((entry) => entry.id !== note.id);
    expect(bigNote).toMatchObject({ reference: "CN-2026-0002", total: 3450 });
    const voidedBig = await step("void_credit_note", { id: bigNote!.id, reason: "Entered twice" } as never, adminId, "2026-06-06T11:00:00.000Z");
    expect(voidedBig.creditNotes.find((entry) => entry.id === bigNote!.id)).toMatchObject({ status: "void", voidReason: "Entered twice" });
  }, 60_000);

  it("cancels a payment recorded in error, and the database refuses to un-cancel it (D-88)", async () => {
    const { adminId, vehicleId } = await world();
    const rentalId = await confirmedRental(adminId, "2026-06-01", "2026-06-03");
    await step("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } } as never, adminId, TODAY);
    await step("start_rental", { id: rentalId } as never, adminId, "2026-06-01T09:00:00.000Z");
    await step("complete_rental", { id: rentalId, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } } as never, adminId, "2026-06-03T18:00:00.000Z");
    const invoiced = await step("issue_rental_invoice", { input: { rentalId, issuedOn: "2026-06-03", discountAmount: "", discountReason: "", notes: "" } } as never, adminId, "2026-06-03T18:30:00.000Z");
    const invoice = invoiced.invoices[0];
    const paid = await step(
      "record_payment",
      { input: { invoiceId: invoice.id, amount: "1000", method: "Cash", paidOn: "2026-06-04", externalReference: "RCPT-1", note: "" } } as never,
      adminId,
      "2026-06-04T10:00:00.000Z",
    );
    expect(paid.invoices[0]).toMatchObject({ status: "part_paid", amountPaid: 1000 });

    const cancelled = await step("void_payment", { id: paid.payments[0].id, reason: "Keyed against the wrong invoice" } as never, adminId, "2026-06-05T10:00:00.000Z");
    // The invoice and the payment are written together: the amount received falls to nothing and the
    // invoice is owed again, with no second command to remember.
    expect(cancelled.invoices[0]).toMatchObject({ status: "issued", amountPaid: 0 });
    expect(cancelled.payments[0]).toMatchObject({ status: "recorded", voidReason: "Keyed against the wrong invoice" });

    // What a restart would see: the cancellation is in the database, not only in the returned snapshot.
    const reloaded = await loadDatabase();
    expect(reloaded.payments[0]).toMatchObject({ reference: "PAY-2026-0001", amount: 1000, voidReason: "Keyed against the wrong invoice" });
    expect(reloaded.payments[0].voidedAt).toBe("2026-06-05T10:00:00.000Z");
    expect(reloaded.invoices[0]).toMatchObject({ status: "issued", amountPaid: 0 });

    // A cancellation is a one-way door, and it is settled in the database rather than only in the
    // service: un-cancelling would silently restore money the office decided it never received.
    await expect(sql`update payment set voided_at = null where id = ${reloaded.payments[0].id}`.execute(db())).rejects.toThrow(/stays cancelled/);
    await expect(sql`update payment set void_reason = 'Changed my mind' where id = ${reloaded.payments[0].id}`.execute(db())).rejects.toThrow(/stays cancelled/);
    // The financial fields are still frozen, cancellation or not.
    await expect(sql`update payment set amount = 1 where id = ${reloaded.payments[0].id}`.execute(db())).rejects.toThrow(/immutable/);

    // Cancelling without a reason is refused on the row itself: a year later the reason is the only
    // explanation, so the column pair cannot be set by halves.
    await expect(
      sql`
        insert into payment (id, reference, invoice_id, amount, currency_code, method, paid_on,
          external_reference, status, recorded_by, recorded_at, voided_at, data)
        values ('noreason', 'PAY-2026-0099', ${invoice.id}, 100, 'GHS', 'Cash', '2026-06-04'::date,
          '', 'recorded', 'Admin', now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/payment_void_has_reason|violates check constraint/);
    await expect(sql`delete from payment where id = ${reloaded.payments[0].id}`.execute(db())).rejects.toThrow(/never deleted/);
  }, 60_000);

  it("pays money back against what is owed, and the database refuses to pay it out twice (D-92)", async () => {
    const { adminId, vehicleId } = await world();
    const rentalId = await confirmedRental(adminId, "2026-06-01", "2026-06-03");
    await step("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } } as never, adminId, TODAY);
    await step("start_rental", { id: rentalId } as never, adminId, "2026-06-01T09:00:00.000Z");
    await step("complete_rental", { id: rentalId, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } } as never, adminId, "2026-06-03T18:00:00.000Z");
    const invoiced = await step("issue_rental_invoice", { input: { rentalId, issuedOn: "2026-06-03", discountAmount: "", discountReason: "", notes: "" } } as never, adminId, "2026-06-03T18:30:00.000Z");
    const invoice = invoiced.invoices[0];
    // Paid in full, then 1,000 + VAT credited: 1,150 is owed back.
    await step("record_payment", { input: { invoiceId: invoice.id, amount: "3450", method: "Bank transfer", paidOn: "2026-06-04", externalReference: "SLIP-9", note: "" } } as never, adminId, "2026-06-04T10:00:00.000Z");
    await step("issue_credit_note", { input: { invoiceId: invoice.id, issuedOn: "2026-06-05", amount: "1000", description: "One day not operated", reason: "Vehicle broke down" } } as never, adminId, "2026-06-05T10:00:00.000Z");

    // More than is owed back is refused with the figure that is left, not a constraint name.
    const tooMuch = await command("record_refund", { input: { invoiceId: invoice.id, amount: "1151", method: "Bank transfer", paidOn: "2026-06-06", externalReference: "", reason: "Goodwill" } } as never, adminId, "2026-06-06T10:00:00.000Z");
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.errors.amount).toMatch(/GHS 1150\.00 left to refund/);

    const refunded = await step("record_refund", { input: { invoiceId: invoice.id, amount: "1150", method: "Bank transfer", paidOn: "2026-06-06", externalReference: "TRF-1", reason: "One day not operated" } } as never, adminId, "2026-06-06T10:00:00.000Z");
    expect(refunded.refunds[0]).toMatchObject({ reference: "REF-2026-0001", amount: 1150, status: "paid" });
    // The payment is not rewritten by money going back out.
    expect(refunded.invoices[0].amountPaid).toBe(3450);

    const reloaded = await loadDatabase();
    expect(reloaded.refunds.map((refund) => refund.reference)).toEqual(["REF-2026-0001"]);
    expect(reloaded.referenceCounters).toEqual(expect.arrayContaining([{ scope: "refund", period: "2026", last: 1 }]));

    // A second refund past what is left is refused by the trigger even when the service is bypassed.
    await expect(
      sql`
        insert into refund (id, reference, invoice_id, client_id, customer_name, currency_code, amount,
          method, paid_on, external_reference, reason, status, recorded_by, recorded_at, data)
        values ('over', 'REF-2026-0099', ${invoice.id}, null, 'Acme Ltd', 'GHS', 10, 'Cash', '2026-06-07'::date,
          '', 'Again', 'paid', 'Admin', now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/refund_within_due|exceeds/);

    // Cancelling is one-way, needs a reason, and the row cannot be deleted or edited.
    const cancelled = await step("void_refund", { id: reloaded.refunds[0].id, reason: "The transfer bounced" } as never, adminId, "2026-06-07T10:00:00.000Z");
    expect(cancelled.refunds[0]).toMatchObject({ status: "void", voidReason: "The transfer bounced" });
    await expect(sql`update refund set voided_at = null where id = ${reloaded.refunds[0].id}`.execute(db())).rejects.toThrow(/stays cancelled/);
    await expect(sql`update refund set amount = 1 where id = ${reloaded.refunds[0].id}`.execute(db())).rejects.toThrow(/immutable/);
    await expect(sql`delete from refund where id = ${reloaded.refunds[0].id}`.execute(db())).rejects.toThrow(/never deleted/);
  }, 60_000);

  it("records spending that is not a repair, and the database refuses to edit it (D-93)", async () => {
    const { adminId } = await world();
    await step(
      "record_expense",
      {
        input: {
          incurredOn: "2026-06-05",
          category: "",
          description: "Diesel, Kumasi depot",
          payee: "Total Filling Station",
          amount: "320.50",
          method: "Cash",
          receiptReference: "RCPT-0091",
          receiptHeld: true,
          notes: "",
        },
      } as never,
      adminId,
      "2026-06-05T10:00:00.000Z",
    );

    const reloaded = await loadDatabase();
    expect(reloaded.expenses).toHaveLength(1);
    expect(reloaded.expenses[0]).toMatchObject({
      reference: "EXP-2026-0001",
      incurredOn: "2026-06-05",
      category: "",
      amount: 320.5,
      receiptReference: "RCPT-0091",
      receiptHeld: true,
      status: "recorded",
    });
    expect(reloaded.referenceCounters).toEqual(expect.arrayContaining([{ scope: "expense", period: "2026", last: 1 }]));

    // The receipt facts are enforced by the table, not only by the service: a hand-written row cannot
    // say the paper is held without a number on it, and cannot carry a void without a reason.
    await expect(
      sql`
        insert into expense (id, reference, incurred_on, category, description, payee, amount, currency_code,
          method, receipt_reference, receipt_held, status, recorded_by, recorded_at, updated_at, data)
        values ('held', 'EXP-2026-0098', '2026-06-06'::date, '', 'Fuel', 'Shell', 10, 'GHS', '', '',
          true, 'recorded', 'Admin', now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/expense_held_has_reference|violates check constraint/);
    await expect(
      sql`
        insert into expense (id, reference, incurred_on, category, description, payee, amount, currency_code,
          method, receipt_reference, receipt_held, status, recorded_by, recorded_at, updated_at, data)
        values ('voidless', 'EXP-2026-0097', '2026-06-06'::date, '', 'Fuel', 'Shell', 10, 'GHS', '', '',
          false, 'void', 'Admin', now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/expense_void_has_reason|violates check constraint/);

    // An expense is never edited and never deleted: the only way out of a wrong one is a void.
    const id = reloaded.expenses[0].id;
    await expect(sql`update expense set amount = 1 where id = ${id}`.execute(db())).rejects.toThrow(/immutable/);
    await expect(sql`update expense set category = 'Fuel' where id = ${id}`.execute(db())).rejects.toThrow(/immutable/);
    await expect(sql`delete from expense where id = ${id}`.execute(db())).rejects.toThrow(/never deleted/);

    const voided = await step("void_expense", { id, reason: "Receipt already recorded" } as never, adminId, "2026-06-07T10:00:00.000Z");
    expect(voided.expenses[0]).toMatchObject({ status: "void", voidReason: "Receipt already recorded" });
    // A void cannot be cleared, and the number is not reused.
    await expect(sql`update expense set voided_at = null where id = ${id}`.execute(db())).rejects.toThrow(/stays cancelled/);
  }, 60_000);

  it("cannot double-book one vehicle from six parallel requests", async () => {
    const { adminId, vehicleId } = await world();
    const rentals: string[] = [];
    for (let i = 0; i < 6; i += 1) rentals.push(await confirmedRental(adminId, "2026-07-01", "2026-07-03"));

    const attempts = await Promise.all(
      rentals.map((id) => command("assign_rental", { id, input: { vehicleId, driverId: "" } } as never, adminId, TODAY)),
    );

    const wins = attempts.filter((attempt) => attempt.ok);
    const losses = attempts.filter((attempt) => !attempt.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(5);
    // A refused booking is a readable 409, never a 500 leaking a constraint name.
    for (const loss of losses) {
      expect(loss.status).toBe(409);
      expect(loss.errors.vehicleId).toMatch(/already assigned to RR-/);
    }

    const assigned = await db().selectFrom("resource_reservation").select(["resource_id"]).where("resource_id", "=", vehicleId).execute();
    expect(assigned).toHaveLength(1);

    const stored = await loadDatabase();
    expect(stored.rentals.filter((rental) => rental.assignedVehicleId === vehicleId)).toHaveLength(1);
  }, 60_000);
});
