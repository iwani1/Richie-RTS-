// Financial reporting (RPT-03) with the owner's definitions (Q-29, D-78).
//
// Each test pins one sentence from docs/KPIS.md: what counts as revenue, as received, as owed at
// the period end, as an expense, and what "cost per trip" divides by. If the code and the document
// disagree, one of them is a defect — so these tests are the document's evidence.
import { describe, expect, it } from "vitest";
import { financialReport, financialReportCsv } from "./financialReport";
import { emptyDatabase, emptyRentalSettings, type CostEntry, type Database, type Invoice, type Payment, type Refund, type Trip } from "./types";

const JUNE = { from: "2026-06-01", to: "2026-06-30" };
const at = "2026-06-01T08:00:00.000Z";

const settings = (overrides: Partial<Database["settings"]> = {}) => ({
  companyName: "Richie Transport Services",
  currencyCode: "GHS" as string | null,
  onTimeThresholdMinutes: 5,
  vehicleCategories: [],
  shifts: [],
  rental: { ...emptyRentalSettings(), pricingBasis: "per_day" as const, depositPercent: 20, quotationValidityDays: 14, paymentMethods: ["Cash"] },
  documentTypes: [],
  documentReminderLeadDays: null,
  taxPosition: "registered" as const,
  taxLines: [],
  invoiceDueDays: 14,
  workTypes: ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other"],
  costCategories: ["Parts", "Labour"],
  maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
  ...overrides,
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1",
    reference: "INV-2026-0001",
    kind: "rental",
    rentalId: "r1",
    clientId: null,
    customerName: "Northstar Foods",
    buyerAddress: "",
    buyerTin: "",
    currencyCode: "GHS",
    lines: [{ id: "l1", description: "Hire", quantity: 1, unitAmount: 2000 }],
    taxLines: [],
    subtotal: 2000,
    total: 2000,
    amountPaid: 0,
    status: "issued",
    billableEvent: "rental:r1",
    issuedOn: "2026-06-05",
    dueOn: "2026-06-19",
    notes: "",
    voidReason: null,
    voidedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
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
    voidReason: null,
    voidedAt: null,
    ...overrides,
  };
}

const refund = (overrides: Partial<Refund> = {}): Refund => ({
  id: "rf1",
  reference: "REF-2026-0001",
  invoiceId: "inv1",
  invoiceReference: "INV-2026-0001",
  clientId: null,
  customerName: "Northstar Foods",
  currencyCode: "GHS",
  amount: 200,
  method: "Bank transfer",
  paidOn: "2026-06-20",
  externalReference: "",
  reason: "Day not operated",
  status: "paid",
  voidReason: null,
  voidedAt: null,
  recordedBy: "Fin",
  recordedAt: at,
  updatedAt: at,
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

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    reference: "TR-0001",
    routeId: "route1",
    serviceDate: "2026-06-10",
    status: "completed",
    vehicleId: "v1",
    driverId: "d1",
    dispatchedAt: at,
    startedAt: at,
    completedAt: at,
    cancelReason: null,
    cancelledAt: null,
    cancelledBy: null,
    incidentId: null,
    stopLogs: [],
    boardings: [
      { passengerId: "p1", stopId: "s1", outcome: "boarded" },
      { passengerId: "p2", stopId: "s1", outcome: "no_show" },
    ],
    onTimeThresholdMinutes: 5,
    corrections: [],
    delays: [],
    rosterChanges: [],
    origin: "schedule",
    originReason: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function world(overrides: Partial<Database> = {}): Database {
  return {
    ...emptyDatabase(),
    settings: settings(),
    workOrders: [
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
        costEntries: [cost({ id: "c1", category: "Parts", amount: 300 }), cost({ id: "c2", category: "Labour", amount: 120.5 }), cost({ id: "c3", category: "", amount: 79.5 })],
        costsConfirmedComplete: true,
        completionNote: null,
        releasedBy: null,
        releasedAt: null,
        log: [],
        createdAt: at,
        updatedAt: at,
      },
    ],
    ...overrides,
  };
}

describe("financial report (RPT-03)", () => {
  it("splits revenue by the customer billed and by what was sold", () => {
    const db = world({
      invoices: [invoice({}), invoice({ id: "inv2", reference: "INV-2026-0002", customerName: "Harbour Logistics", total: 800, issuedOn: "2026-06-20" })],
    });
    const report = financialReport(db, JUNE.from, JUNE.to);
    expect(report.revenueByCustomer).toEqual([
      { customerName: "Northstar Foods", invoiceCount: 1, invoiced: 2000, credited: 0, paid: 0, outstanding: 2000 },
      { customerName: "Harbour Logistics", invoiceCount: 1, invoiced: 800, credited: 0, paid: 0, outstanding: 800 },
    ]);
    // Only hire is invoiced in this build, and the row says so rather than inventing a service.
    expect(report.revenueByService).toEqual([{ service: "Vehicle hire", invoiceCount: 2, invoiced: 2800 }]);
    expect(report.invoicedTotal).toBe(2800);
  });

  it("counts payments received in the period and values what is owed at the period end", () => {
    const db = world({
      invoices: [invoice({})],
      payments: [
        payment({ id: "pay1", amount: 500, paidOn: "2026-06-10" }),
        // Paid after the period: received in July, and it does not settle June's statement.
        payment({ id: "pay2", amount: 1500, paidOn: "2026-07-02" }),
      ],
    });
    const report = financialReport(db, JUNE.from, JUNE.to);
    expect(report.receivedTotal).toBe(500);
    expect(report.paymentCount).toBe(1);
    expect(report.outstandingTotal).toBe(1500);
    expect(report.outstandingCount).toBe(1);
    expect(report.revenueByCustomer[0].paid).toBe(500);
  });

  it("leaves a cancelled payment out of what was received, and out of what the customer has paid", () => {
    // A payment recorded in error and then cancelled never arrived, so the month's statement must not
    // count it as income, and the customer's row must not say they paid it (D-88).
    const db = world({
      invoices: [invoice({})],
      payments: [
        payment({ id: "pay1", amount: 500, paidOn: "2026-06-10" }),
        payment({ id: "pay2", amount: 400, paidOn: "2026-06-11", voidReason: "Wrong invoice", voidedAt: "2026-06-12T09:00:00.000Z" }),
      ],
    });
    const report = financialReport(db, JUNE.from, JUNE.to);
    expect(report.receivedTotal).toBe(500);
    expect(report.paymentCount).toBe(1);
    expect(report.revenueByCustomer[0].paid).toBe(500);
    expect(report.revenueByCustomer[0].outstanding).toBe(1500);
  });

  it("groups expenses by the configured category, keeping uncategorised costs visible", () => {
    const report = financialReport(world(), JUNE.from, JUNE.to);
    expect(report.expensesByCategory).toEqual([
      { category: "Parts", lineCount: 1, amount: 300 },
      { category: "Labour", lineCount: 1, amount: 120.5 },
      { category: "Uncategorised", lineCount: 1, amount: 79.5 },
    ]);
    expect(report.expensesTotal).toBe(500);
    expect(report.coverage.uncategorisedExpenseLines).toBe(1);
  });

  it("divides recorded costs by the runs completed in the period, and by riders boarded", () => {
    const db = world({ trips: [trip({}), trip({ id: "t2", reference: "TR-0002" }), trip({ id: "t3", reference: "TR-0003", status: "cancelled" })] });
    const report = financialReport(db, JUNE.from, JUNE.to);
    expect(report.completedTrips).toBe(2);
    // Two riders boarded (one per run); the no-show is not a passenger carried.
    expect(report.passengersBoarded).toBe(2);
    expect(report.costPerTrip).toBe(250);
    expect(report.costPerPassenger).toBe(250);
  });

  it("does not invent a cost per trip when no run was completed", () => {
    const report = financialReport(world(), JUNE.from, JUNE.to);
    expect(report.completedTrips).toBe(0);
    expect(report.costPerTrip).toBeNull();
    expect(report.costPerPassenger).toBeNull();
    expect(report.status).toBe("ok");
  });

  it("ignores records outside the period and voided invoices", () => {
    const db = world({
      invoices: [invoice({}), invoice({ id: "void", status: "void", total: 9999 }), invoice({ id: "july", issuedOn: "2026-07-01", total: 700 })],
      payments: [payment({ id: "may", paidOn: "2026-05-31" })],
    });
    const report = financialReport(db, JUNE.from, JUNE.to);
    expect(report.invoiceCount).toBe(1);
    expect(report.invoicedTotal).toBe(2000);
    expect(report.paymentCount).toBe(0);
  });

  it("withholds every money figure when the currency is not configured", () => {
    const report = financialReport(world({ settings: settings({ currencyCode: null }), invoices: [invoice({})] }), JUNE.from, JUNE.to);
    expect(report.status).toBe("currency_not_set");
    expect(report.message).toMatch(/Money figures are withheld/);
    // The counts are still facts and are still reported; only the money is withheld.
    expect(report.invoiceCount).toBe(1);
  });

  it("says so when the period is the wrong way round or contains nothing", () => {
    const reversed = financialReport(world(), "2026-06-30", "2026-06-01");
    expect(reversed.status).toBe("invalid_range");
    const empty = financialReport(world({ workOrders: [] }), JUNE.from, JUNE.to);
    expect(empty.status).toBe("empty");
    expect(empty.message).toMatch(/No invoices, payments, credit notes, refunds, recorded costs or completed runs/);
  });

  it("writes the same figures to CSV", () => {
    const report = financialReport(world({ invoices: [invoice({})], trips: [trip({})] }), JUNE.from, JUNE.to);
    const csv = financialReportCsv(report);
    expect(csv.split("\n")[0]).toBe("Metric,Value,Note");
    expect(csv).toContain("Invoiced,GHS 2000.00");
    expect(csv).toContain("Cost per trip,GHS 500.00");
    expect(csv).toContain("Northstar Foods,GHS 2000.00");
    expect(csv).toContain("Parts,GHS 300.00");
    // A customer name with a comma has to survive the round trip through a spreadsheet.
    const quoted = financialReportCsv(financialReport(world({ invoices: [invoice({ customerName: "Acme, Ltd" })] }), JUNE.from, JUNE.to));
    expect(quoted).toContain('"Acme, Ltd"');
  });
});

describe("money paid back in the report (D-92)", () => {
  it("states refunds separately from costs, and files them by the day they were paid", () => {
    const db = world({ invoices: [invoice()], refunds: [refund(), refund({ id: "rf2", reference: "REF-2026-0002", paidOn: "2026-07-02" })] });
    const report = financialReport(db, JUNE.from, JUNE.to);
    // Only June's refund is in June, and it is not counted as a cost: the business did not spend it.
    expect(report.refundCount).toBe(1);
    expect(report.refundedTotal).toBe(200);
    // A refund is cash out, not a cost of the work: dropping it into expenses would make the month
    // look as though it cost more to run than it did.
    expect(report.expensesTotal).toBe(financialReport(world({ invoices: [invoice()] }), JUNE.from, JUNE.to).expensesTotal);
    expect(report.message).toMatch(/GHS 200\.00 paid back on 1 refund/);
    expect(financialReportCsv(report)).toContain("Refunded,GHS 200.00");
  });

  it("ignores a cancelled refund", () => {
    const report = financialReport(world({ invoices: [invoice()], refunds: [refund({ status: "void", voidReason: "Never left", voidedAt: at })] }), JUNE.from, JUNE.to);
    expect(report.refundCount).toBe(0);
    expect(report.refundedTotal).toBe(0);
  });

  it("is not an empty period just because a refund is the only thing in it", () => {
    const report = financialReport(world({ invoices: [], refunds: [refund()] }), JUNE.from, JUNE.to);
    expect(report.status).toBe("ok");
  });
});
