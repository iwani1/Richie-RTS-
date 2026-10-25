// The customer statement (FIN-02, D-90): what one customer owes, what moved, and how old the debt is.
//
// The test that matters most is the last one in the first block: the closing balance worked out from
// the statement's own rows must equal the closing balance worked out from the invoices one by one.
// Those are two independent routes to the same number — a row filed on the wrong date, a payment
// counted twice, or a credit note left out shows up as a difference between them, which is exactly the
// class of mistake a statement mailed to a customer makes public.
import { describe, expect, it } from "vitest";
import { ageBucketFor, customerStatement, debtAgeing, statementCustomers } from "./customerStatement";
import { invoiceBalance } from "./creditNotes";
import { emptyDatabase, type CreditNote, type Database, type Invoice, type Payment } from "./types";

const AT = "2026-06-01T09:00:00.000Z";

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
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
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [{ id: "cl1", description: "One day not operated", quantity: 1, unitAmount: 1000 }],
  taxLines: [{ name: "VAT", ratePercent: 15, amount: 150 }],
  subtotal: 1000,
  total: 1150,
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

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    invoices: [invoice()],
    payments: [payment()],
    creditNotes: [credit()],
    settings: { ...db.settings, currencyCode: "GHS", taxPosition: "registered", invoiceDueDays: 14 },
    ...overrides,
  };
}

describe("a customer statement for a period", () => {
  it("states the invoice, what came in, what came off, and the balance out", () => {
    const statement = customerStatement(world(), "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.status).toBe("ok");
    expect(statement.currencyCode).toBe("GHS");
    expect(statement.openingBalance).toBe(0);
    expect(statement.invoiced).toBe(4600);
    expect(statement.received).toBe(1000);
    expect(statement.credited).toBe(1150);
    expect(statement.closingBalance).toBe(2450);
    expect(statement.rows.map((row) => [row.date, row.kind, row.reference, row.balance])).toEqual([
      ["2026-06-01", "invoice", "INV-2026-0001", 4600],
      ["2026-06-10", "payment", "PAY-2026-0001", 3600],
      ["2026-06-20", "creditNote", "CN-2026-0001", 2450],
    ]);
    // Debits and credits are on the row as well as the running balance, so the paper can be checked.
    expect(statement.rows[0]).toMatchObject({ debit: 4600, credit: 0 });
    expect(statement.rows[1]).toMatchObject({ debit: 0, credit: 1000 });
  });

  it("agrees with the invoices one by one, which is the check that catches a misfiled row", () => {
    const db = world({
      invoices: [
        invoice(),
        invoice({ id: "inv2", reference: "INV-2026-0002", issuedOn: "2026-05-20", dueOn: "2026-06-03", total: 1000, subtotal: 1000, taxLines: [] }),
      ],
      payments: [payment(), payment({ id: "p2", reference: "PAY-2026-0002", invoiceId: "inv2", amount: 400, paidOn: "2026-05-25" })],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    // June: 4,600 invoiced, 1,000 paid, 1,150 credited. The May invoice and its May payment are
    // carried in, so the opening balance is 600 and is not stated again as a row.
    expect(statement.openingBalance).toBe(600);
    expect(statement.rows.every((row) => row.date >= "2026-06-01")).toBe(true);
    expect(statement.closingBalance).toBe(3050);
    const perInvoice = db.invoices
      .filter((entry) => entry.customerName === "Acme Ltd")
      .reduce((sum, entry) => {
        const balance = invoiceBalance(db, entry, "2026-06-30");
        return sum + balance.total - balance.paid - balance.credited;
      }, 0);
    expect(statement.closingBalance).toBe(perInvoice);
  });

  it("carries arrears in and out of a month that contains none of the activity", () => {
    const statement = customerStatement(world(), "Acme Ltd", "2026-07-01", "2026-07-31");
    expect(statement.rows).toEqual([]);
    expect(statement.openingBalance).toBe(2450);
    expect(statement.closingBalance).toBe(2450);
    expect(statement.message).toMatch(/owes GHS 2450\.00 as at 2026-07-31/);
  });

  it("leaves a cancelled payment off, because that money never arrived", () => {
    const db = world({
      payments: [payment(), payment({ id: "p2", reference: "PAY-2026-0002", amount: 500, paidOn: "2026-06-12", voidReason: "Wrong invoice", voidedAt: "2026-06-13T09:00:00.000Z" })],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.rows.map((row) => row.reference)).toEqual(["INV-2026-0001", "PAY-2026-0001", "CN-2026-0001"]);
    expect(statement.received).toBe(1000);
    expect(statement.closingBalance).toBe(2450);
  });

  it("leaves a voided invoice and a voided credit note off", () => {
    const db = world({
      invoices: [invoice(), invoice({ id: "inv2", reference: "INV-2026-0002", status: "void", voidReason: "Wrong customer", voidedAt: AT })],
      creditNotes: [credit(), credit({ id: "cn2", reference: "CN-2026-0002", status: "void", voidReason: "Issued in error", voidedAt: AT })],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.rows.map((row) => row.reference)).toEqual(["INV-2026-0001", "PAY-2026-0001", "CN-2026-0001"]);
    expect(statement.invoiced).toBe(4600);
    expect(statement.credited).toBe(1150);
  });

  it("dates a credit note by its own date, not by the invoice it corrects", () => {
    const db = world({ creditNotes: [credit({ issuedOn: "2026-07-04" })] });
    const june = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(june.credited).toBe(0);
    expect(june.closingBalance).toBe(3600);

    const july = customerStatement(db, "Acme Ltd", "2026-07-01", "2026-07-31");
    expect(july.openingBalance).toBe(3600);
    expect(july.credited).toBe(1150);
    expect(july.closingBalance).toBe(2450);
  });

  it("says a customer is in credit rather than netting the difference to zero", () => {
    const db = world({
      invoices: [invoice({ total: 1000, subtotal: 1000, taxLines: [] })],
      payments: [payment({ amount: 1000 })],
      creditNotes: [credit({ total: 400, subtotal: 400, taxLines: [] })],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.closingBalance).toBe(-400);
    expect(statement.message).toMatch(/in credit by GHS 400\.00/);
    // Nothing is "due" on this account, so the ageing is empty even though money is owed back.
    expect(statement.ageing.total).toBe(0);
    expect(statement.openInvoices).toEqual([]);
  });
});

describe("how old the money is", () => {
  it("puts each open invoice in the bucket its due date earns", () => {
    const db = world({
      invoices: [
        invoice({ id: "inv1", reference: "INV-2026-0001", issuedOn: "2026-06-01", dueOn: "2026-06-30", total: 1000, subtotal: 1000, taxLines: [] }),
        invoice({ id: "inv2", reference: "INV-2026-0002", issuedOn: "2026-05-01", dueOn: "2026-06-10", total: 2000, subtotal: 2000, taxLines: [] }),
        invoice({ id: "inv3", reference: "INV-2026-0003", issuedOn: "2026-04-01", dueOn: "2026-05-15", total: 3000, subtotal: 3000, taxLines: [] }),
        invoice({ id: "inv4", reference: "INV-2026-0004", issuedOn: "2026-02-01", dueOn: "2026-03-01", total: 4000, subtotal: 4000, taxLines: [] }),
      ],
      payments: [],
      creditNotes: [],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    // As at 30 June: inv1 due today (not yet late), inv2 20 days late, inv3 46 days late, inv4 121 days.
    expect(statement.ageing).toEqual({
      notYetDue: 1000,
      days1to30: 2000,
      days31to60: 3000,
      days61plus: 4000,
      total: 10000,
    });
    expect(statement.openInvoices.map((row) => [row.reference, row.daysOverdue, row.bucket])).toEqual([
      ["INV-2026-0004", 121, "days61plus"],
      ["INV-2026-0003", 46, "days31to60"],
      ["INV-2026-0002", 20, "days1to30"],
      ["INV-2026-0001", 0, "notYetDue"],
    ]);
    expect(statement.message).toMatch(/9000\.00 is past its due date and 121 days is the oldest/);
  });

  it("counts a partly paid invoice at what is left, not at its total", () => {
    const db = world({
      invoices: [invoice({ total: 1000, subtotal: 1000, taxLines: [], dueOn: "2026-06-02" })],
      payments: [payment({ amount: 250 })],
      creditNotes: [],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.openInvoices).toEqual([
      expect.objectContaining({ reference: "INV-2026-0001", outstanding: 750, daysOverdue: 28, bucket: "days1to30" }),
    ]);
    expect(statement.ageing.days1to30).toBe(750);
  });
});

describe("choosing a customer", () => {
  it("lists every customer with a live invoice, biggest debtor first, and ignores void invoices", () => {
    const db = world({
      invoices: [
        invoice(),
        invoice({ id: "inv2", reference: "INV-2026-0002", customerName: "Harbour Logistics", total: 5000, subtotal: 5000, taxLines: [], dueOn: "2026-06-20" }),
        invoice({ id: "inv3", reference: "INV-2026-0003", customerName: "Harbour Logistics", status: "void", voidReason: "Duplicate", voidedAt: AT }),
        invoice({ id: "inv4", reference: "INV-2026-0004", customerName: "  ", total: 200, subtotal: 200, taxLines: [] }),
      ],
      payments: [],
      creditNotes: [],
    });
    const customers = statementCustomers(db, "2026-06-30");
    expect(customers.map((entry) => entry.name)).toEqual(["Harbour Logistics", "Acme Ltd", "No customer named"]);
    expect(customers[0]).toMatchObject({ invoiceCount: 1, outstanding: 5000, currencyCode: "GHS", oldestDaysOverdue: 10 });
    // The unnamed invoice is its own group rather than being folded into another customer.
    expect(customers[2]).toMatchObject({ name: "No customer named", invoiceCount: 1 });
  });

  it("asks for a customer, and for a period that runs forwards", () => {
    expect(customerStatement(world(), "  ", "2026-06-01", "2026-06-30").status).toBe("no_customer");
    expect(customerStatement(world(), "Acme Ltd", "2026-06-30", "2026-06-01").status).toBe("invalid_range");
    expect(customerStatement(world(), "Acme Ltd", "2026-02-30", "2026-06-30").status).toBe("invalid_range");
    const none = customerStatement(world(), "Nobody Ltd", "2026-06-01", "2026-06-30");
    expect(none.status).toBe("no_invoices");
    expect(none.message).toMatch(/no invoice dated on or before 2026-06-30/);
  });

  it("refuses to add two currencies together", () => {
    const db = world({
      invoices: [invoice(), invoice({ id: "inv2", reference: "INV-2026-0002", currencyCode: "USD", customerName: "Acme Ltd" })],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    expect(statement.status).toBe("mixed_currency");
    expect(statement.message).toMatch(/GHS, USD/);
    expect(statement.rows).toEqual([]);
  });
});

describe("how bad the debt is, across customers (RPT-04, D-91)", () => {
  it("totals the same four bands a statement prints", () => {
    const db = world({
      invoices: [
        // Acme: one invoice due 30 June (not yet late) and one 20 days late.
        invoice({ id: "inv1", reference: "INV-2026-0001", issuedOn: "2026-06-01", dueOn: "2026-06-30", total: 1000, subtotal: 1000, taxLines: [] }),
        invoice({ id: "inv2", reference: "INV-2026-0002", issuedOn: "2026-05-01", dueOn: "2026-06-10", total: 2000, subtotal: 2000, taxLines: [] }),
        // Harbour: one invoice 121 days late.
        invoice({ id: "inv3", reference: "INV-2026-0003", customerName: "Harbour Logistics", issuedOn: "2026-02-01", dueOn: "2026-03-01", total: 4000, subtotal: 4000, taxLines: [] }),
      ],
      payments: [],
      creditNotes: [],
    });
    const ageing = debtAgeing(db, "2026-06-30");
    expect(ageing.status).toBe("ok");
    expect(ageing).toMatchObject({
      currencyCode: "GHS",
      notYetDue: 1000,
      days1to30: 2000,
      days31to60: 0,
      days61plus: 4000,
      total: 7000,
      overdueTotal: 6000,
      openInvoices: 3,
    });
    expect(ageing.customers.map((row) => [row.customerName, row.total, row.oldestDaysOverdue])).toEqual([
      ["Harbour Logistics", 4000, 121],
      ["Acme Ltd", 3000, 20],
    ]);
    expect(ageing.message).toMatch(/2 customers owe GHS 7000\.00 as at 2026-06-30/);
    expect(ageing.message).toMatch(/GHS 6000\.00 of it is past its due date and GHS 4000\.00 is over 60 days old/);
  });

  it("counts a part-paid invoice at what is left, and leaves void and cancelled money out", () => {
    const db = world({
      invoices: [
        invoice({ id: "inv1", reference: "INV-2026-0001", dueOn: "2026-06-20", total: 1000, subtotal: 1000, taxLines: [] }),
        invoice({ id: "inv2", reference: "INV-2026-0002", dueOn: "2026-06-01", total: 5000, subtotal: 5000, taxLines: [], status: "void", voidReason: "Wrong", voidedAt: AT }),
        invoice({ id: "inv3", reference: "INV-2026-0003", issuedOn: "2026-07-05", dueOn: "2026-07-19", total: 900, subtotal: 900, taxLines: [] }),
      ],
      payments: [
        payment({ amount: 250 }),
        payment({ id: "p2", reference: "PAY-2026-0002", amount: 900, voidReason: "Bounced", voidedAt: AT }),
      ],
      creditNotes: [credit({ total: 100, subtotal: 100, taxLines: [] })],
    });
    const ageing = debtAgeing(db, "2026-06-30");
    // 1,000 − 250 paid − 100 credited = 650, ten days late. The void invoice, the July invoice and the
    // cancelled payment all contribute nothing.
    expect(ageing.days1to30).toBe(650);
    expect(ageing.total).toBe(650);
    expect(ageing.openInvoices).toBe(1);
    expect(ageing.customers).toEqual([expect.objectContaining({ customerName: "Acme Ltd", total: 650, oldestDaysOverdue: 10, openInvoices: 1 })]);
  });

  it("says nothing is owed when nothing is, rather than showing four zero rows as a fact", () => {
    const db = world({ invoices: [], payments: [], creditNotes: [] });
    const ageing = debtAgeing(db, "2026-06-30");
    expect(ageing).toMatchObject({ status: "ok", total: 0, overdueTotal: 0, openInvoices: 0, customers: [] });
    expect(ageing.message).toBe("Nothing is owed as at 2026-06-30.");
  });

  it("withholds the total when the invoices are in two currencies", () => {
    const db = world({
      invoices: [
        invoice({ id: "inv1", currencyCode: "GHS" }),
        invoice({ id: "inv2", reference: "INV-2026-0002", customerName: "Harbour Logistics", currencyCode: "USD" }),
      ],
    });
    const ageing = debtAgeing(db, "2026-06-30");
    expect(ageing.status).toBe("mixed_currency");
    expect(ageing.total).toBe(0);
    expect(ageing.customers).toEqual([]);
    expect(ageing.message).toMatch(/GHS, USD/);
  });

  it("uses one definition of a band, so a statement and the company total agree", () => {
    // The boundary values are the whole point: 0 is not late, 30 and 60 are still the earlier band,
    // and 61 starts the last one. A second implementation would drift on exactly these numbers.
    expect([0, 1, 30, 31, 60, 61, 400].map(ageBucketFor)).toEqual([
      "notYetDue",
      "days1to30",
      "days1to30",
      "days31to60",
      "days31to60",
      "days61plus",
      "days61plus",
    ]);

    const db = world({
      invoices: [
        invoice({ id: "inv1", reference: "INV-2026-0001", dueOn: "2026-05-01", total: 1000, subtotal: 1000, taxLines: [] }), // 60 days at 30 June
        invoice({ id: "inv2", reference: "INV-2026-0002", dueOn: "2026-03-01", total: 2000, subtotal: 2000, taxLines: [] }), // 121 days
      ],
      payments: [],
      creditNotes: [],
    });
    const statement = customerStatement(db, "Acme Ltd", "2026-06-01", "2026-06-30");
    const ageing = debtAgeing(db, "2026-06-30");
    expect(statement.ageing.days31to60).toBe(ageing.days31to60);
    expect(statement.ageing.days61plus).toBe(ageing.days61plus);
    expect(statement.ageing.total).toBe(ageing.total);
  });
});
