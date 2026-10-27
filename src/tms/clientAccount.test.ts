// What the corporate dashboard says a client owes (CLI-03, D-114).
//
// The failure this file guards against is the one a customer notices immediately: a balance that
// disagrees with the invoice in their hand. So the numbers here are checked against the same
// statements a person would make from the documents — billed, paid, credited, still owed — and against
// the rules the office's own screens obey: a cancelled payment never arrived, a void invoice never
// asked for money, and two currencies are never added together.
import { describe, expect, it } from "vitest";
import { clientAccount } from "./clientAccount";
import { emptyDatabase, type CreditNote, type Database, type Invoice, type Payment, type Refund } from "./types";

const AT = "2026-06-01T09:00:00.000Z";
const CLIENT = "c1";

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: "r1",
  clientId: CLIENT,
  customerName: "Acme Ltd",
  buyerAddress: "",
  buyerTin: "",
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
  ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: "p1",
  reference: "PAY-2026-0001",
  invoiceId: "inv1",
  amount: 1000,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-10",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Fin",
  recordedAt: AT,
  voidReason: null,
  voidedAt: null,
  ...overrides,
});

const credit = (overrides: Partial<CreditNote> = {}): CreditNote => ({
  id: "cn1",
  reference: "CN-2026-0001",
  invoiceId: "inv1",
  invoiceReference: "INV-2026-0001",
  clientId: CLIENT,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "cl1", description: "One day not operated", quantity: 1, unitAmount: 500 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 75 }],
  subtotal: 500,
  total: 575,
  reason: "One day not operated",
  issuedOn: "2026-06-20",
  status: "issued",
  voidReason: null,
  voidedAt: null,
  createdBy: "Fin",
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

const refund = (overrides: Partial<Refund> = {}): Refund => ({
  id: "rf1",
  reference: "REF-2026-0001",
  invoiceId: "inv1",
  invoiceReference: "INV-2026-0001",
  clientId: CLIENT,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  amount: 1150,
  method: "Bank transfer",
  paidOn: "2026-06-25",
  externalReference: "",
  reason: "Service cancelled after payment",
  status: "paid",
  voidReason: null,
  voidedAt: null,
  recordedBy: "Fin",
  recordedAt: AT,
  updatedAt: AT,
  ...overrides,
});

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return { ...db, invoices: [invoice()], payments: [payment()], creditNotes: [credit()], settings: { ...db.settings, currencyCode: "GHS" }, ...overrides };
}

describe("a client's account, stated to the client", () => {
  it("states what was billed, what came in, what was credited and what is still owed", () => {
    // As at 20 June the invoice (due 15 June) is five days late and 575 has just been credited.
    const account = clientAccount(world(), "2026-06-20");
    expect(account.status).toBe("ok");
    expect(account.currencyCode).toBe("GHS");
    expect(account.totals).toEqual({
      currencyCode: "GHS",
      billed: 4600,
      received: 1000,
      credited: 575,
      refunded: 0,
      outstanding: 3025,
      overdue: 3025,
      oldestDaysOverdue: 5,
    });
    expect(account.invoices[0]).toMatchObject({ reference: "INV-2026-0001", total: 4600, paid: 1000, credited: 575, outstanding: 3025, daysOverdue: 5 });
    expect(account.invoices[0].state).toBe("Part paid, overdue");
  });

  it("leaves a bill that is not yet due alone, and names what it is waiting for", () => {
    // On 5 June nothing has been paid and nothing credited yet: the bill stands at its full amount,
    // and it is not late.
    const account = clientAccount(world(), "2026-06-05");
    expect(account.totals).toMatchObject({ received: 0, outstanding: 4600, overdue: 0, oldestDaysOverdue: 0 });
    expect(account.invoices[0].state).toBe("Awaiting payment");
  });

  it("counts a cancelled payment for nothing, because the money never arrived", () => {
    const account = clientAccount(world({ payments: [payment({ voidReason: "Wrong invoice", voidedAt: "2026-06-12T09:00:00.000Z" })] }), "2026-06-20");
    // Still owed: 4,600 billed less the 575 credited on 20 June. The cancelled thousand is not there.
    expect(account.totals).toMatchObject({ received: 0, outstanding: 4025 });
    // Nor is a cancelled payment listed as money the customer paid.
    expect(account.payments).toEqual([]);
  });

  it("adds in whole pesewas, so a hundred bills cannot land a pesewa out", () => {
    const account = clientAccount(
      world({
        invoices: [
          invoice({ id: "inv1", reference: "INV-2026-0001", total: 0.1, subtotal: 0.1, taxLines: [], billableEvent: "a" }),
          invoice({ id: "inv2", reference: "INV-2026-0002", total: 0.2, subtotal: 0.2, taxLines: [], billableEvent: "b" }),
        ],
        payments: [],
        creditNotes: [],
      }),
      "2026-06-20",
    );
    expect(account.totals?.outstanding).toBe(0.3);
    expect(account.totals?.billed).toBe(0.3);
  });

  it("lists credit notes and refunds with the reason the office recorded", () => {
    const account = clientAccount(world({ refunds: [refund()] }), "2026-06-30");
    expect(account.adjustments.map((row) => [row.kind, row.reference, row.amount, row.reason])).toEqual([
      ["refund", "REF-2026-0001", 1150, "Service cancelled after payment"],
      ["creditNote", "CN-2026-0001", 575, "One day not operated"],
    ]);
    // A refund is money given back, so it is stated as such rather than netted off silently.
    expect(account.totals?.refunded).toBe(1150);
  });

  it("calls a bill credited below what was paid a refund due, rather than settled", () => {
    const account = clientAccount(
      world({
        invoices: [invoice({ total: 1000, subtotal: 1000, taxLines: [] })],
        payments: [payment({ amount: 1000 })],
        creditNotes: [credit({ total: 400, subtotal: 400, taxLines: [] })],
      }),
      "2026-06-30",
    );
    expect(account.invoices[0]).toMatchObject({ outstanding: 0, refundDue: 400, state: "Refund due" });
    expect(account.totals).toMatchObject({ outstanding: 0, overdue: 0 });
  });

  it("never adds two currencies together, and still lists the bills one by one", () => {
    const account = clientAccount(
      world({
        invoices: [invoice(), invoice({ id: "inv2", reference: "INV-2026-0002", currencyCode: "USD", billableEvent: "b" })],
        payments: [],
        creditNotes: [],
      }),
      "2026-06-20",
    );
    expect(account.status).toBe("mixed_currency");
    expect(account.totals).toBeNull();
    expect(account.message).toMatch(/cannot be added together/);
    expect(account.invoices.map((row) => row.currencyCode).sort()).toEqual(["GHS", "USD"]);
  });

  it("leaves out a void invoice and a bill dated after the date asked for", () => {
    const account = clientAccount(
      world({
        invoices: [
          invoice(),
          invoice({ id: "inv2", reference: "INV-2026-0002", status: "void", voidReason: "Issued in error", voidedAt: AT, billableEvent: "b" }),
          invoice({ id: "inv3", reference: "INV-2026-0003", issuedOn: "2026-07-02", dueOn: "2026-07-16", billableEvent: "c" }),
        ],
      }),
      "2026-06-20",
    );
    expect(account.invoices.map((row) => row.reference)).toEqual(["INV-2026-0001"]);
    expect(account.totals?.billed).toBe(4600);
  });

  it("says there is nothing to state when nothing has been billed", () => {
    const account = clientAccount(world({ invoices: [], payments: [], creditNotes: [], refunds: [] }), "2026-06-20");
    expect(account.status).toBe("no_invoices");
    expect(account.totals).toBeNull();
    expect(account.message).toMatch(/Nothing has been billed/);
  });

  it("keeps the newest payment at the top, so the list reads like a bank statement", () => {
    const account = clientAccount(
      world({
        payments: [payment(), payment({ id: "p2", reference: "PAY-2026-0002", amount: 500, paidOn: "2026-06-18" })],
      }),
      "2026-06-20",
    );
    expect(account.payments.map((row) => row.reference)).toEqual(["PAY-2026-0002", "PAY-2026-0001"]);
  });
});
