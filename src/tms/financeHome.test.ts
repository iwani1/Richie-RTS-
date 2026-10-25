// The finance home figures (FIN-07).
//
// Two properties matter and both are tested here. First: the period figures are exactly the ones the
// financial report produces, so a finance home screen can never tell a different story from the
// report behind it. Second: the open work — late invoices, unbilled hires, payments still to verify —
// is measured **as at the day it is read**, not inside the chosen period, because a deadline does not
// move when somebody changes a date filter.
import { describe, expect, it } from "vitest";
import { financeHome } from "./financeHome";
import { financialReport } from "./financialReport";
import { emptyDatabase, emptyRentalSettings, type Client, type CostEntry, type Database, type Invoice, type Payment, type Rental } from "./types";

const at = "2026-06-01T08:00:00.000Z";
const JUNE = { from: "2026-06-01", to: "2026-06-30" };

const settings = (overrides: Partial<Database["settings"]> = {}): Database["settings"] => ({
  companyName: "Richie Transport Services",
  currencyCode: "GHS" as string | null,
  onTimeThresholdMinutes: 5,
  vehicleCategories: [],
  shifts: [],
  rental: { ...emptyRentalSettings(), pricingBasis: "per_day", depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Cash"] },
  documentTypes: [],
  documentReminderLeadDays: null,
  taxPosition: "registered",
  taxLines: [],
  invoiceDueDays: 14,
  workTypes: ["Service"],
  costCategories: ["Parts", "Labour"],
  maintenance: { schedules: [], blockOnOverdueService: false },
  booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
  ...overrides,
});

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: "r1",
  clientId: "c1",
  customerName: "Northstar Foods",
  currencyCode: "GHS",
  lines: [{ id: "l1", description: "Hire", quantity: 1, unitAmount: 2000 }],
  taxLines: [],
  subtotal: 2000,
  total: 2000,
  amountPaid: 0,
  status: "issued",
  billableEvent: "rental:r1:final",
  issuedOn: "2026-06-05",
  dueOn: "2026-06-19",
  notes: "",
  voidReason: null,
  voidedAt: null,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: "pay1",
  reference: "PAY-2026-0001",
  invoiceId: "inv1",
  amount: 500,
  currencyCode: "GHS",
  method: "Bank transfer",
  paidOn: "2026-06-10",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Fin",
  recordedAt: at,
  ...overrides,
});

const client = (id: string, name: string): Client => ({
  id,
  name,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const rental = (overrides: Partial<Rental> = {}): Rental => ({
  id: "r2",
  reference: "RR-0002",
  clientId: "c1",
  customerName: "Northstar Foods",
  customerPhone: "",
  customerEmail: "",
  purpose: "Wedding",
  pickupLocation: "Accra",
  dropoffLocation: "Aburi",
  startDate: "2026-06-02",
  endDate: "2026-06-03",
  passengers: 20,
  vehicleCategoryId: "cat",
  driverRequired: true,
  notes: "",
  status: "completed",
  quote: null,
  quoteHistory: [],
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: { currencyCode: "GHS", lines: [], total: 1800, issuedAt: "2026-06-04T17:00:00.000Z", issuedBy: "Ops" },
  resolutionReason: null,
  createdAt: at,
  updatedAt: "2026-06-04T17:00:00.000Z",
  ...overrides,
});

const cost = (overrides: Partial<CostEntry> = {}): CostEntry => ({
  id: "c1",
  description: "Brake pads",
  category: "Parts",
  amount: 300,
  incurredDate: "2026-06-12",
  recordedAt: at,
  recordedBy: "Fin",
  ...overrides,
});

function build(overrides: Partial<Database> = {}): Database {
  return {
    ...emptyDatabase(),
    settings: settings(),
    clients: [client("c1", "Northstar Foods")],
    invoices: [invoice()],
    payments: [payment()],
    ...overrides,
  };
}

describe("finance home - the period figures", () => {
  it("repeats the financial report's figures rather than computing its own", () => {
    const db = build();
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    const report = financialReport(db, JUNE.from, JUNE.to);

    expect(home.figures.invoicedTotal).toBe(report.invoicedTotal);
    expect(home.figures.receivedTotal).toBe(report.receivedTotal);
    expect(home.figures.expensesTotal).toBe(report.expensesTotal);
    expect(home.figures.outstandingTotal).toBe(report.outstandingTotal);
    expect(home.figures.costPerTrip).toBe(report.costPerTrip);
    expect(home.byCustomer).toEqual(report.revenueByCustomer);
    expect(home.byCategory).toEqual(report.expensesByCategory);
    expect(home.coverage).toEqual(report.coverage);
    expect(home.status).toBe("ok");
  });

  it("states money in minus money out as cash movement, separately from the margin", () => {
    const db = build();
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    // GHS 500 came in and nothing was recorded as spent.
    expect(home.movement).toEqual({ received: 500, expenses: 0, difference: 500 });
  });

  it("withholds every amount when no currency is configured", () => {
    const db = build({ settings: settings({ currencyCode: null }) });
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.status).toBe("currency_not_set");
    expect(home.movement).toBeNull();
    expect(home.margin.available).toBe(false);
    expect(home.message).toMatch(/amounts are withheld/i);
  });
});

describe("finance home - margin, only when the data can carry it (FIN-07)", () => {
  // Costs are recorded on a work order, which is where the money actually gets spent.
  const spent = (amount: number): Database["workOrders"] => [
    {
      id: "wo1",
      reference: "WO-0001",
      vehicleId: "v1",
      title: "Brakes",
      workType: "Repair",
      workshop: "",
      description: "",
      reportedOdometer: null,
      plannedDate: null,
      incidentId: null,
      status: "open",
      holdReason: null,
      completedAt: null,
      resetsServiceInterval: false,
      costEntries: [cost({ amount })],
      costsConfirmedComplete: true,
      completionNote: null,
      releasedBy: null,
      releasedAt: null,
      log: [],
      createdAt: at,
      updatedAt: at,
    },
  ];

  const billedAndSpent = () =>
    build({
      invoices: [invoice({ total: 2000, issuedOn: "2026-06-05" })],
      workOrders: spent(800),
    });

  it("states the margin when both sides of the period are complete", () => {
    const home = financeHome(billedAndSpent(), JUNE.from, JUNE.to, "2026-06-25");
    expect(home.margin.available).toBe(true);
    expect(home.margin).toMatchObject({ revenue: 2000, costs: 800, amount: 1200 });
    // 1,200 of 2,000 is 60%.
    expect(home.margin.percent).toBe(0.6);
    expect(home.margin.reason).toBe("");
  });

  it("keeps cash movement and margin apart, because they are different questions", () => {
    const home = financeHome(billedAndSpent(), JUNE.from, JUNE.to, "2026-06-25");
    // GHS 500 was received and GHS 800 was spent, so cash went down 300 — while the work earned 1,200.
    expect(home.movement).toEqual({ received: 500, expenses: 800, difference: -300 });
    expect(home.margin.amount).toBe(1200);
  });

  it("withholds the margin when nothing was billed in the period", () => {
    const home = financeHome(build({ invoices: [], workOrders: spent(300) }), JUNE.from, JUNE.to, "2026-06-25");
    expect(home.margin.available).toBe(false);
    expect(home.margin.amount).toBeNull();
    expect(home.margin.reason).toMatch(/no invoice was issued/i);
  });

  it("withholds the margin when no cost was recorded, rather than repeating revenue as profit", () => {
    const home = financeHome(build(), JUNE.from, JUNE.to, "2026-06-25");
    expect(home.margin.available).toBe(false);
    expect(home.margin.reason).toMatch(/no cost was recorded/i);
  });

  it("withholds the margin while a completed hire in the period is still unbilled", () => {
    const db = { ...billedAndSpent(), rentals: [rental()] };
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.margin.available).toBe(false);
    expect(home.margin.reason).toMatch(/1 completed hire in the period has no invoice yet/i);
  });
});

describe("finance home - who owes us money", () => {
  it("lists only invoices that are actually late on the day it is read, longest overdue first", () => {
    const db = build({
      invoices: [
        invoice({ id: "a", reference: "INV-2026-0001", dueOn: "2026-06-10" }),
        invoice({ id: "b", reference: "INV-2026-0002", dueOn: "2026-06-20" }),
        // Due in the future as at the reading date: not late, so not listed.
        invoice({ id: "c", reference: "INV-2026-0003", dueOn: "2026-07-05" }),
        // Paid in full: nothing to chase.
        invoice({ id: "d", reference: "INV-2026-0004", dueOn: "2026-06-01", status: "paid" }),
        // Void: not owed at all.
        invoice({ id: "e", reference: "INV-2026-0005", dueOn: "2026-06-01", status: "void" }),
      ],
    });

    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.overdue.map((row) => row.reference)).toEqual(["INV-2026-0001", "INV-2026-0002"]);
    expect(home.overdue[0].daysOverdue).toBe(15);
    expect(home.overdue[1].daysOverdue).toBe(5);
    expect(home.message).toMatch(/2 invoices overdue as at the 2026-06-25/);
  });

  it("is measured as at the day it is read, not inside the period", () => {
    // An invoice issued in May and due in May is outside a June period, and still late in June.
    const db = build({ invoices: [invoice({ issuedOn: "2026-05-10", dueOn: "2026-05-24" })] });
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");

    expect(home.figures.invoiceCount).toBe(0); // nothing invoiced inside the period
    expect(home.overdue).toHaveLength(1);
    expect(home.overdue[0].daysOverdue).toBe(32);
    // GHS 2,000 invoiced, GHS 500 already recorded against it.
    expect(home.overdueTotal).toBe(1500);
  });

  it("values a late invoice at what is still owed, not at its total", () => {
    const db = build({ invoices: [invoice({ total: 2000, dueOn: "2026-06-01" })], payments: [payment({ amount: 1500 })] });
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.overdue).toHaveLength(1);
    expect(home.overdue[0].outstanding).toBe(500);
    expect(home.overdueTotal).toBe(500);
  });

  it("says plainly when nothing is late", () => {
    const db = build({ invoices: [invoice({ dueOn: "2026-07-30" })] });
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.overdue).toEqual([]);
    expect(home.overdueTotal).toBe(0);
    expect(home.message).toMatch(/Nothing is overdue/);
  });
});

describe("finance home - work waiting on finance", () => {
  it("lists a completed hire that nobody has billed, with what it came to", () => {
    const db = build({ rentals: [rental()] });
    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.unbilled).toHaveLength(1);
    expect(home.unbilled[0]).toMatchObject({ reference: "RR-0002", customerName: "Northstar Foods", finalTotal: 1800, completedOn: "2026-06-04" });
  });

  it("stops listing a hire once its invoice exists, and ignores a void invoice", () => {
    const billed = build({ rentals: [rental()], invoices: [invoice({ billableEvent: "rental:r2:final", rentalId: "r2" })] });
    expect(financeHome(billed, JUNE.from, JUNE.to, "2026-06-25").unbilled).toEqual([]);

    const voided = build({ rentals: [rental()], invoices: [invoice({ billableEvent: "rental:r2:final", rentalId: "r2", status: "void" })] });
    expect(financeHome(voided, JUNE.from, JUNE.to, "2026-06-25").unbilled).toHaveLength(1);
  });

  it("names the next step for each payment still to be checked", () => {
    const db = build({
      payments: [
        payment({ id: "p1", reference: "PAY-2026-0001", status: "recorded", amount: 500, paidOn: "2026-06-10" }),
        payment({ id: "p2", reference: "PAY-2026-0002", status: "verified", amount: 250, paidOn: "2026-06-12" }),
        payment({ id: "p3", reference: "PAY-2026-0003", status: "reconciled", amount: 900, paidOn: "2026-06-13" }),
      ],
    });

    const home = financeHome(db, JUNE.from, JUNE.to, "2026-06-25");
    expect(home.awaitingPayments.map((row) => [row.reference, row.nextStep])).toEqual([
      ["PAY-2026-0001", "verify"],
      ["PAY-2026-0002", "reconcile"],
    ]);
    expect(home.awaitingTotal).toBe(750);
  });
});
