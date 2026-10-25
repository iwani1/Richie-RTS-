// Rental reporting (RPT-01). The figures are the ones an owner checks against their own records, so
// each test pins one definition: what counts as an enquiry, as accepted, as received, and as
// outstanding, and what happens to money when no currency is configured.
import { describe, expect, it } from "vitest";
import { daysInRange, rentalReport, rentalReportCsv } from "./rentalReport";
import { emptyDatabase, emptyRentalSettings, type Database, type Invoice, type Payment, type Rental } from "./types";

const settings = () => ({
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
  costCategories: [],
  maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
});

function rental(overrides: Partial<Rental>): Rental {
  return {
    id: "r1",
    reference: "RR-0001",
    clientId: null,
    customerName: "Acme Ltd",
    customerPhone: "0244000000",
    customerEmail: "",
    purpose: "",
    pickupLocation: "Accra",
    dropoffLocation: "Kumasi",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    passengers: 10,
    vehicleCategoryId: "cat",
    driverRequired: false,
    notes: "",
    status: "draft",
    quote: null,
    quoteHistory: [],
    assignedVehicleId: null,
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    ...overrides,
  };
}

const quoteAt = (quotedAt: string) => ({
  currencyCode: "GHS",
  pricingBasis: "per_day" as const,
  lines: [{ id: "l1", description: "Hire", quantity: 2, unitAmount: 1000 }],
  subtotal: 2000,
  depositPercent: 20,
  depositRequired: 400,
  validUntil: "2026-06-20",
  quotedAt,
  quotedBy: "Ama",
});

const invoice = (overrides: Partial<Invoice>): Invoice => ({
  id: "i1",
  reference: "INV-2026-0001",
  kind: "rental",
  rentalId: "r1",
  clientId: null,
  customerName: "Acme Ltd",
  currencyCode: "GHS",
  lines: [],
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
  createdAt: "2026-06-05T09:00:00.000Z",
  updatedAt: "2026-06-05T09:00:00.000Z",
  ...overrides,
});

const payment = (overrides: Partial<Payment>): Payment => ({
  id: "p1",
  reference: "PAY-2026-0001",
  invoiceId: "i1",
  amount: 500,
  currencyCode: "GHS",
  method: "Cash",
  paidOn: "2026-06-08",
  externalReference: "",
  status: "recorded",
  note: "",
  log: [],
  recordedBy: "Ama",
  recordedAt: "2026-06-08T09:00:00.000Z",
  voidReason: null,
  voidedAt: null,
  ...overrides,
});

function world(overrides: Partial<Database> = {}): Database {
  return {
    ...emptyDatabase(),
    settings: settings(),
    vehicles: [
      {
        id: "v1",
        registration: "GT 100-26",
        categoryId: "cat",
        make: "Toyota",
        model: "Coaster",
        seatCapacity: 30,
        status: "available",
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "v2",
        registration: "GT 101-26",
        categoryId: "cat",
        make: "Toyota",
        model: "Coaster",
        seatCapacity: 30,
        status: "retired",
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

const JUNE = { from: "2026-06-01", to: "2026-06-30" };

describe("rental report (RPT-01)", () => {
  it("counts one day as one day and refuses a backwards range", () => {
    expect(daysInRange("2026-06-01", "2026-06-01")).toEqual(["2026-06-01"]);
    expect(daysInRange("2026-06-01", "2026-06-03")).toHaveLength(3);
    expect(daysInRange("2026-06-03", "2026-06-01")).toEqual([]);
  });

  it("separates enquiries, quotations and acceptance, and states its coverage", () => {
    const db = world({
      rentals: [
        rental({ id: "r1", status: "confirmed", quote: quoteAt("2026-06-02T10:00:00.000Z") }),
        rental({ id: "r2", status: "completed", quote: quoteAt("2026-06-03T10:00:00.000Z"), assignedVehicleId: "v1" }),
        rental({ id: "r3", status: "declined", quote: quoteAt("2026-06-04T10:00:00.000Z"), resolutionReason: "Price" }),
        rental({ id: "r4", status: "draft" }),
      ],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.enquiries).toBe(4);
    expect(report.quotationsIssued).toBe(3);
    expect(report.accepted).toBe(2);
    expect(report.declined).toBe(1);
    expect(report.acceptanceRate).toBeCloseTo(2 / 3, 6);
    expect(report.coverage.rentalsWithoutQuote).toBe(1);
    expect(report.status).toBe("ok");
    expect(report.message).toMatch(/4 requests received, 3 quoted; 67% of quotations were accepted/);
  });

  it("excludes voids from invoiced totals and reports outstanding as at the period end", () => {
    const db = world({
      rentals: [rental({ id: "r1", status: "completed", quote: quoteAt("2026-06-02T10:00:00.000Z"), assignedVehicleId: "v1" })],
      invoices: [
        invoice({ id: "i1", total: 2000, issuedOn: "2026-06-05" }),
        invoice({ id: "i2", reference: "INV-2026-0002", total: 999, issuedOn: "2026-06-06", status: "void" }),
        invoice({ id: "i3", reference: "INV-2026-0003", total: 1000, issuedOn: "2026-07-02" }),
      ],
      payments: [payment({ id: "p1", invoiceId: "i1", amount: 500, paidOn: "2026-06-08" })],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.invoicedTotal).toBe(2000); // the void and the July invoice are excluded
    expect(report.invoiceCount).toBe(1);
    expect(report.receivedTotal).toBe(500);
    // Outstanding is as at the end of the period: the July invoice falls outside it, so it does not count.
    expect(report.outstandingTotal).toBe(1500);
    expect(report.outstandingCount).toBe(1);
  });

  it("does not report a cancelled payment as money received", () => {
    const db = world({
      invoices: [invoice({ id: "i1", total: 2000, issuedOn: "2026-06-05" })],
      payments: [
        payment({ id: "p1", invoiceId: "i1", amount: 500, paidOn: "2026-06-08" }),
        payment({ id: "p2", invoiceId: "i1", amount: 700, paidOn: "2026-06-09", voidReason: "Bounced", voidedAt: "2026-06-10T09:00:00.000Z" }),
      ],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.receivedTotal).toBe(500);
    expect(report.paymentCount).toBe(1);
    // The cancelled money was never received, so the invoice still owes it.
    expect(report.outstandingTotal).toBe(1500);
  });

  it("computes utilisation from committed rental vehicle-days and the acting fleet", () => {
    const db = world({
      rentals: [
        rental({ id: "r1", status: "in_progress", quote: quoteAt("2026-06-02T10:00:00.000Z"), assignedVehicleId: "v1", startDate: "2026-06-02", endDate: "2026-06-04" }),
        // A draft request reserves nothing, so it adds no vehicle-days.
        rental({ id: "r2", status: "draft", startDate: "2026-06-10", endDate: "2026-06-12" }),
      ],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.vehicleDays).toBe(3);
    // The retired vehicle is not part of the acting fleet: 1 vehicle × 30 days.
    expect(report.availableVehicleDays).toBe(30);
    expect(report.utilisation).toBeCloseTo(0.1, 6);
  });

  it("groups cancellation and decline reasons, most frequent first", () => {
    const db = world({
      rentals: [
        rental({ id: "r1", status: "declined", resolutionReason: "Price", quote: quoteAt("2026-06-02T10:00:00.000Z"), updatedAt: "2026-06-09T10:00:00.000Z" }),
        rental({ id: "r2", status: "cancelled", resolutionReason: "Price", updatedAt: "2026-06-10T10:00:00.000Z" }),
        rental({ id: "r3", status: "cancelled", resolutionReason: "Vehicle unavailable", updatedAt: "2026-06-11T10:00:00.000Z" }),
        rental({ id: "r4", status: "cancelled", updatedAt: "2026-06-12T10:00:00.000Z" }),
      ],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.cancellationReasons).toEqual([
      { reason: "Price", count: 2 },
      { reason: "No reason recorded", count: 1 },
      { reason: "Vehicle unavailable", count: 1 },
    ]);
  });

  it("withholds money figures when the currency is not configured rather than printing bare numbers", () => {
    const db = world({
      settings: { ...settings(), currencyCode: null },
      rentals: [rental({ id: "r1", status: "completed", quote: quoteAt("2026-06-02T10:00:00.000Z") })],
      invoices: [invoice({})],
    });
    const report = rentalReport(db, JUNE.from, JUNE.to);
    expect(report.status).toBe("currency_not_set");
    expect(report.message).toMatch(/Money figures are withheld/);
    expect(report.invoicedTotal).toBe(2000); // the number exists…
    expect(rentalReportCsv(report)).toMatch(/Invoiced,not configured/); // …but is never printed without a currency
  });

  it("exports the same figures as CSV, with reasons quoted safely", () => {
    const db = world({
      rentals: [rental({ id: "r1", status: "declined", quote: quoteAt("2026-06-02T10:00:00.000Z"), resolutionReason: 'Too dear, "by far"', updatedAt: "2026-06-09T10:00:00.000Z" })],
    });
    const csv = rentalReportCsv(rentalReport(db, JUNE.from, JUNE.to));
    expect(csv).toContain("Enquiries (requests received),1");
    expect(csv).toContain("Acceptance rate,0.0%");
    expect(csv).toContain('"Too dear, ""by far""",1');
  });
});
