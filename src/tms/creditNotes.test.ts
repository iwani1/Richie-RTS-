// Credit-note arithmetic, and the agreement between every place that states a balance (FIN-02, D-86).
//
// The failure this file exists to catch is not a wrong subtraction — it is *four* subtractions that
// are each slightly different. Before credit notes the invoice screen, the finance report, the hire
// report and the finance home tiles each worked out "still owed" for themselves. They agreed only
// because they made the same assumption. Add a credit note to that arrangement and three of them
// quietly report the gross balance while the fourth reports the corrected one.
//
// So the tests below do not only check the helper. They check that the reports and the screen helper
// say the same thing about the same invoice, and that a credit note dated after a closed period does
// not rewrite that period.
import { describe, expect, it } from "vitest";
import { creditedTotal, creditedBetween, invoiceBalance, liveCreditNotes } from "./creditNotes";
import { financeHome } from "./financeHome";
import { financialReport, financialReportCsv } from "./financialReport";
import { outstanding } from "./finance";
import { rentalReport } from "./rentalReport";
import { emptyDatabase, type CreditNote, type Database, type Invoice, type Payment } from "./types";

const AT = "2026-06-01T09:00:00.000Z";

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

function note(overrides: Partial<CreditNote> = {}): CreditNote {
  return {
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
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "p1",
    reference: "PAY-2026-0001",
    invoiceId: invoice.id,
    amount: 1000,
    currencyCode: "GHS",
    method: "Bank transfer",
    paidOn: "2026-06-03",
    externalReference: "",
    status: "recorded",
    note: "",
    log: [],
    recordedBy: "Fin",
    recordedAt: AT,
    voidReason: null,
    voidedAt: null,
    ...overrides,
  };
}

function world(overrides: Partial<Database> = {}): Database {
  const db = emptyDatabase();
  return {
    ...db,
    invoices: [invoice],
    payments: [payment()],
    creditNotes: [note()],
    settings: { ...db.settings, currencyCode: "GHS", taxPosition: "registered", invoiceDueDays: 14 },
    ...overrides,
  };
}

describe("credit-note arithmetic (D-86)", () => {
  it("subtracts both the money received and the money credited, and never goes below zero", () => {
    const balance = invoiceBalance(world(), invoice);
    expect(balance).toEqual({ total: 4600, paid: 1000, credited: 1150, outstanding: 2450, refundDue: 0, settled: false });
    expect(outstanding(world(), invoice)).toBe(2450);
    // The same invoice with nothing credited is the balance the old helper produced.
    expect(invoiceBalance(world({ creditNotes: [] }), invoice).outstanding).toBe(3600);
  });

  it("states a refund when credits take the bill below the cash received, and calls it settled", () => {
    const paidInFull = world({ payments: [payment({ amount: 4600 })] });
    const balance = invoiceBalance(paidInFull, invoice);
    expect(balance.outstanding).toBe(0);
    expect(balance.refundDue).toBe(1150);
    expect(balance.settled).toBe(false);

    // A credit that lands exactly on the amount paid leaves nothing owed either way.
    const exact = world({ payments: [payment({ amount: 3450 })], creditNotes: [note({ total: 1150, subtotal: 1000 })] });
    expect(invoiceBalance(exact, invoice)).toMatchObject({ outstanding: 0, refundDue: 0, settled: true });
  });

  it("ignores voided credit notes and counts issued ones", () => {
    const db = world({
      creditNotes: [note(), note({ id: "cn2", reference: "CN-2026-0002", total: 500, status: "void" })],
    });
    expect(creditedTotal(db, invoice)).toBe(1150);
    expect(liveCreditNotes(db, invoice.id).map((entry) => entry.reference)).toEqual(["CN-2026-0001"]);
    expect(invoiceBalance(db, invoice).outstanding).toBe(2450);
  });

  it("leaves a closed period alone: a credit dated later does not change an earlier statement", () => {
    const later = world({ creditNotes: [note(), note({ id: "cn2", reference: "CN-2026-0002", issuedOn: "2026-07-02", total: 500 })] });
    // As at the end of June only the June credit counts; the July one belongs to July.
    expect(invoiceBalance(later, invoice, "2026-06-30").credited).toBe(1150);
    expect(invoiceBalance(later, invoice, "2026-06-30").outstanding).toBe(2450);
    expect(invoiceBalance(later, invoice).credited).toBe(1650);
    expect(creditedBetween(later, "2026-07-01", "2026-07-31").map((entry) => entry.reference)).toEqual(["CN-2026-0002"]);
  });

  it("adds up in pesewas, not floats, when a credit has an awkward amount", () => {
    // 0.01 credited three times, and a payment of 0.03: the invoice is settled, not 0.01 short.
    const small: Invoice = { ...invoice, subtotal: 0.03, total: 0.03, taxLines: [] };
    const db = world({
      invoices: [small],
      payments: [payment({ amount: 0.03 })],
      creditNotes: [note({ total: 0.01, subtotal: 0.01, taxLines: [] })],
    });
    expect(invoiceBalance(db, small)).toMatchObject({ outstanding: 0, refundDue: 0.01, settled: false });
    const withoutCredit = { ...db, creditNotes: [] };
    expect(invoiceBalance(withoutCredit, small).settled).toBe(true);
  });

  it("is the one balance the reports and the finance home all state", () => {
    const db = world();
    const balance = invoiceBalance(db, invoice);

    const finance = financialReport(db, "2026-06-01", "2026-06-30");
    expect(finance.outstandingTotal).toBe(balance.outstanding);
    expect(finance.outstandingCount).toBe(1);
    expect(finance.creditedTotal).toBe(1150);
    expect(finance.creditNoteCount).toBe(1);
    // Billed, less credited, less paid, is what the customer row says is owed.
    const row = finance.revenueByCustomer[0];
    expect(row.invoiced - row.credited - row.paid).toBe(row.outstanding);
    expect(row.outstanding).toBe(balance.outstanding);

    const hires = rentalReport(db, "2026-06-01", "2026-06-30");
    expect(hires.outstandingTotal).toBe(balance.outstanding);
    expect(hires.outstandingCount).toBe(1);
    expect(hires.creditedTotal).toBe(1150);
    expect(hires.creditNoteCount).toBe(1);

    const home = financeHome(db, "2026-06-01", "2026-06-30", "2026-06-20");
    expect(home.figures.outstandingTotal).toBe(balance.outstanding);
    expect(home.overdueTotal).toBe(balance.outstanding);
    expect(home.figures.creditedTotal).toBe(1150);
  });

  it("keeps a fully credited invoice out of the overdue list", () => {
    // Credited down to nothing: there is no money to chase, so it is not late, it is closed.
    const db = world({
      creditNotes: [note({ subtotal: 4000, total: 4600 })],
      payments: [],
    });
    expect(invoiceBalance(db, invoice).outstanding).toBe(0);
    expect(financeHome(db, "2026-06-01", "2026-06-30", "2026-07-20").overdue).toEqual([]);
  });

  it("says what was credited in the report's own words and in its CSV", () => {
    const report = financialReport(world(), "2026-06-01", "2026-06-30");
    expect(report.message).toMatch(/GHS 1150\.00 credited back on 1 credit note/);
    const csv = financialReportCsv(report);
    expect(csv).toContain("Credited");
    expect(csv).toMatch(/CN|1150\.00/);
    // A credit note is not "paid in full": the count of open invoices is about money still owed.
    expect(report.outstandingCount).toBe(1);
  });
});
