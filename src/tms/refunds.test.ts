// Money going back out to a customer (FIN-03, D-92).
//
// A credit note only *states* that money is owed back. Before this, the day the office actually paid
// it was booked as a plain expense, which lost the customer, the invoice and the reason. These tests
// hold three things worth breaking a build over:
//
//   * a refund settles what is owed back and never anything else — it must not change what the
//     customer paid, or the invoice would claim money that came back in;
//   * the same over-credit cannot be paid out twice, and cancelling a refund makes the money owed
//     back again;
//   * the ceiling is checked in pesewas, by the same balance helper every screen and report uses, so
//     the amount on the button is the amount the service accepts.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { invoiceBalance, refundedTotal } from "./creditNotes";
import type { Actor, Credential, CommandResult } from "./service";
import { emptyDatabase, emptyRentalSettings, type CreditNote, type Database, type Invoice, type Payment, type User } from "./types";

const AT = "2026-06-10T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

const invoice: Invoice = {
  id: "inv1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: null,
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 2000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 600 }],
  subtotal: 4000,
  total: 4600,
  amountPaid: 0,
  status: "issued",
  billableEvent: "rental:r1:final",
  issuedOn: "2026-06-01",
  dueOn: "2026-06-15",
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: AT,
  updatedAt: AT,
};

const creditNote: CreditNote = {
  id: "cn1",
  reference: "CN-2026-0001",
  invoiceId: invoice.id,
  invoiceReference: invoice.reference,
  clientId: null,
  customerName: invoice.customerName,
  currencyCode: "GHS",
  lines: [{ id: "cl1", description: "Service not delivered", quantity: 1, unitAmount: 1000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 150 }],
  subtotal: 1000,
  total: 1150,
  reason: "Service not delivered",
  issuedOn: "2026-06-05",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Fin",
  createdAt: AT,
  updatedAt: AT,
};

/** The invoice paid in full, then credited 1,150 — so GHS 1,150.00 is genuinely owed back. */
function world(overrides: Partial<Database> = {}): Database {
  const paid: Payment = {
    id: "p1",
    reference: "PAY-2026-0001",
    invoiceId: invoice.id,
    amount: 4600,
    currencyCode: "GHS",
    method: "Bank transfer",
    paidOn: "2026-06-02",
    externalReference: "SLIP-1",
    status: "reconciled",
    note: "",
    log: [],
    recordedBy: "Fin",
    recordedAt: AT,
    voidReason: null,
    voidedAt: null,
  };
  const base = emptyDatabase();
  const finance = createUser("u-fin", "Finance Officer", "fin@example.test", "finance");
  const ops = createUser("u-ops", "Ops Planner", "ops@example.test", "operations");
  return {
    ...base,
    users: [finance, ops],
    settings: { ...base.settings, currencyCode: "GHS", rental: { ...emptyRentalSettings(), paymentMethods: ["Cash", "Bank transfer", "Mobile money"] } },
    invoices: [{ ...invoice, amountPaid: 4600, status: "paid" }],
    payments: [paid],
    creditNotes: [creditNote],
    ...overrides,
  };
}

function createUser(id: string, fullName: string, email: string, role: User["role"]): User {
  return {
    id,
    fullName,
    email,
    role,
    active: true,
    driverId: null,
    clientId: null,
    passengerId: null,
    primaryContact: false,
    passwordHash: cred.passwordHash,
    passwordSalt: cred.passwordSalt,
    createdAt: AT,
    updatedAt: AT,
  };
}

const actor = (role: User["role"] = "finance"): Actor => ({ id: role === "finance" ? "u-fin" : "u-ops", fullName: role === "finance" ? "Finance Officer" : "Ops Planner", role });

interface World {
  db: Database;
}

const step = (w: World, command: AnyCommand, who: User["role"] = "finance"): CommandResult => {
  const result = executeCommand(w.db, actor(who), command, AT);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
};
const attempt = (w: World, command: AnyCommand, who: User["role"] = "finance"): CommandResult => executeCommand(w.db, actor(who), command, AT);
const errorsOf = (result: CommandResult): Record<string, string> => (result.ok ? {} : result.errors);

const refund = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: invoice.id,
  amount: "1150",
  method: "Bank transfer",
  paidOn: "2026-06-10",
  externalReference: "TRF-77",
  reason: "Service cancelled after payment",
  ...overrides,
});

describe("recording money paid back (D-92)", () => {
  it("numbers the refund, settles what was owed back, and leaves what the customer paid alone", () => {
    const w: World = { db: world() };
    expect(invoiceBalance(w.db, invoice).refundDue).toBe(1150);

    const result = step(w, { type: "record_refund", input: refund() });
    expect(w.db.refunds).toHaveLength(1);
    const paid = w.db.refunds[0];
    expect(paid.reference).toBe("REF-2026-0001");
    expect(paid.status).toBe("paid");
    expect(paid.customerName).toBe("Acme Ltd");
    expect(paid.invoiceReference).toBe("INV-2026-0001");
    expect(paid.reason).toBe("Service cancelled after payment");
    if (result.ok) expect(result.message).toMatch(/REF-2026-0001 recorded: GHS 1150\.00 paid back against INV-2026-0001/);

    // The over-credit is settled, and the money the customer paid is untouched: a refund is what the
    // office gave back, not a correction to what arrived.
    const balance = invoiceBalance(w.db, invoice);
    expect(balance.refunded).toBe(1150);
    expect(balance.refundDue).toBe(0);
    expect(balance.paid).toBe(4600);
    expect(balance.outstanding).toBe(0);
    expect(refundedTotal(w.db, invoice)).toBe(1150);
    // The invoice's own paid figure is not rewritten by money going out.
    expect(w.db.invoices[0].amountPaid).toBe(4600);
    expect(w.db.invoices[0].status).toBe("paid");
    expect(w.db.audit[0].action).toBe("finance:refund_record");
  });

  it("refuses more than is owed back, in the amount that is actually left", () => {
    const w: World = { db: world() };
    step(w, { type: "record_refund", input: refund({ amount: "400", externalReference: "TRF-1" }) });

    const tooMuch = attempt(w, { type: "record_refund", input: refund({ amount: "800", externalReference: "TRF-2" }) });
    expect(tooMuch.ok).toBe(false);
    expect(errorsOf(tooMuch).amount).toBe("INV-2026-0001 has GHS 750.00 left to refund, so this amount is too large.");

    // The same over-credit cannot be paid out twice: after the first refund only the remainder moves.
    step(w, { type: "record_refund", input: refund({ amount: "750", externalReference: "TRF-3" }) });
    expect(w.db.refunds).toHaveLength(2);
    expect(invoiceBalance(w.db, invoice).refundDue).toBe(0);

    const nothingLeft = attempt(w, { type: "record_refund", input: refund({ amount: "1", externalReference: "TRF-4" }) });
    expect(errorsOf(nothingLeft).amount).toBe(
      "INV-2026-0001 has no refund due: nothing has been received or credited past its total.",
    );
  });

  it("requires a reason, a known method and a real date", () => {
    const w: World = { db: world() };
    const blank = attempt(w, { type: "record_refund", input: refund({ reason: "  ", method: "Cheque", paidOn: "2026-02-30" }) });
    expect(blank.ok).toBe(false);
    expect(errorsOf(blank)).toMatchObject({
      reason: "Say why the money was paid back. It is kept on the record.",
      method: "Unknown method. Add it in Settings first.",
      paidOn: "Enter the date the money went back.",
    });
    expect(w.db.refunds).toHaveLength(0);
  });

  it("will not pay money back against a void invoice, or an invoice with nothing owed back", () => {
    const voided: World = { db: world({ invoices: [{ ...invoice, status: "void" }] }) };
    const againstVoid = attempt(voided, { type: "record_refund", input: refund() });
    expect(errorsOf(againstVoid).invoiceId).toMatch(/is void, so no refund can be recorded/);

    // Nothing credited below what was paid: there is no refund to record, whatever the amount.
    const plain: World = { db: world({ creditNotes: [] }) };
    const noneDue = attempt(plain, { type: "record_refund", input: refund({ amount: "100" }) });
    expect(errorsOf(noneDue).amount).toMatch(/no refund due/);
    expect(plain.db.refunds).toHaveLength(0);
  });

  it("records the same transfer reference once, and reports the one already there", () => {
    const w: World = { db: world() };
    const first = step(w, { type: "record_refund", input: refund({ amount: "500" }) });
    const again = step(w, { type: "record_refund", input: refund({ amount: "500" }) });
    if (first.ok && again.ok) expect(again.message).toMatch(/already recorded as REF-2026-0001; nothing was added/);
    expect(w.db.refunds).toHaveLength(1);
  });

  it("cancels a refund once, with a reason, and makes the money owed back again", () => {
    const w: World = { db: world() };
    step(w, { type: "record_refund", input: refund() });
    const id = w.db.refunds[0].id;

    const withoutReason = attempt(w, { type: "void_refund", id, reason: " " });
    expect(withoutReason.ok).toBe(false);
    expect(errorsOf(withoutReason).reason).toBe("Say why this refund is being cancelled.");

    const cancelled = step(w, { type: "void_refund", id, reason: "Transfer never left the bank" });
    const record = w.db.refunds[0];
    // The number and the reason stay: what changed is that the money was not paid back after all.
    expect(record.status).toBe("void");
    expect(record.reference).toBe("REF-2026-0001");
    expect(record.voidReason).toBe("Transfer never left the bank");
    expect(record.voidedAt).toBe(AT);
    expect(invoiceBalance(w.db, invoice).refundDue).toBe(1150);
    if (cancelled.ok) expect(cancelled.message).toMatch(/GHS 1150\.00 is owed back again/);

    const twice = attempt(w, { type: "void_refund", id, reason: "Again" });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.message).toMatch(/is already cancelled/);

    // With the first cancelled, the same amount can lawfully be paid back as the next document.
    step(w, { type: "record_refund", input: refund({ externalReference: "TRF-77B" }) });
    expect(w.db.refunds.map((entry) => entry.reference)).toEqual(["REF-2026-0001", "REF-2026-0002"]);
    expect(invoiceBalance(w.db, invoice).refundDue).toBe(0);
  });

  it("is a finance job: operations may not pay money back or cancel a refund", () => {
    const w: World = { db: world() };
    const denied = attempt(w, { type: "record_refund", input: refund() }, "operations");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toMatch(/not permitted|permission/i);
    expect(w.db.refunds).toHaveLength(0);

    step(w, { type: "record_refund", input: refund() });
    const id = w.db.refunds[0].id;
    const deniedCancel = attempt(w, { type: "void_refund", id, reason: "Nothing to do with me" }, "operations");
    expect(deniedCancel.ok).toBe(false);
    expect(w.db.refunds[0].status).toBe("paid");
  });
});
