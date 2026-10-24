// Rental reporting (brief RPT-01).
//
// Every figure is counted from records that exist. Where a figure needs something the business has
// not supplied — a currency, an invoice — it is returned as null with the reason, never as zero
// dressed up as a fact. The report also states its own coverage: how many requests fell in the range
// and how many of them never reached a quotation, because an acceptance rate over a handful of
// quotations is not the same statement as one over the whole quarter.
//
// Formulas are documented in docs/KPIS.md. Changing one here without changing it there is a defect.

import type { Database, Invoice, Payment, Rental } from "./types";

export interface CancellationReason {
  reason: string;
  count: number;
}

export interface RentalReport {
  from: string;
  to: string;
  currencyCode: string | null;
  /** Requests received in the range. */
  enquiries: number;
  /** Quotations issued in the range (a revision counts once, at its latest issue). */
  quotationsIssued: number;
  /** Quoted requests that reached confirmed, in progress or completed. */
  accepted: number;
  declined: number;
  cancelled: number;
  confirmed: number;
  completed: number;
  /** Accepted / quoted, 0–1. Null when nothing was quoted. */
  acceptanceRate: number | null;
  /** Invoices issued in the range, excluding voids. */
  invoicedTotal: number;
  invoiceCount: number;
  /** Payments received in the range, whatever the invoice date. */
  receivedTotal: number;
  paymentCount: number;
  /** Invoices issued on or before `to` that are still not paid in full. */
  outstandingTotal: number;
  outstandingCount: number;
  /** Rental vehicle-days committed inside the range. */
  vehicleDays: number;
  /** The denominator: vehicles in the fleet (excluding retired) × days in the range. */
  availableVehicleDays: number;
  utilisation: number | null;
  cancellationReasons: CancellationReason[];
  coverage: {
    rentalsInRange: number;
    rentalsWithoutQuote: number;
    rentalsWithoutVehicle: number;
    invoicesWithoutCurrency: number;
  };
  status: "ok" | "currency_not_set" | "empty";
  message: string;
}

const dayMs = 86_400_000;
const ymd = (iso: string) => iso.slice(0, 10);
const dayIndex = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);

/** Inclusive list of calendar days, so a one-day range is one day and not zero. */
export function daysInRange(from: string, to: string): string[] {
  const start = dayIndex(from);
  const end = dayIndex(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => new Date((start + offset) * dayMs).toISOString().slice(0, 10));
}

const paidOn = (payments: Payment[], invoice: Invoice) =>
  payments.filter((payment) => payment.invoiceId === invoice.id).reduce((sum, payment) => sum + payment.amount, 0);

/** Vehicle-days a rental commits inside the range. Only a committed rental occupies a vehicle. */
function rentalVehicleDays(rental: Rental, days: string[]): number {
  if (rental.status !== "confirmed" && rental.status !== "in_progress" && rental.status !== "completed") return 0;
  if (!rental.assignedVehicleId) return 0;
  return days.filter((day) => day >= rental.startDate && day <= rental.endDate).length;
}

export function rentalReport(db: Database, from: string, to: string): RentalReport {
  const days = daysInRange(from, to);
  const inRange = (date: string) => date >= from && date <= to;

  const requests = db.rentals.filter((rental) => inRange(ymd(rental.createdAt)));
  const quotations = db.rentals.filter((rental) => rental.quote !== null && inRange(ymd(rental.quote.quotedAt)));
  const replied = quotations.map((rental) => rental.status);
  const accepted = replied.filter((status) => status === "confirmed" || status === "in_progress" || status === "completed").length;
  const declined = replied.filter((status) => status === "declined").length;
  const cancelled = db.rentals.filter((rental) => rental.status === "cancelled" && inRange(ymd(rental.updatedAt))).length;

  const invoices = db.invoices.filter((invoice) => invoice.status !== "void" && inRange(invoice.issuedOn));
  const payments = db.payments.filter((payment) => inRange(payment.paidOn));
  const invoicedTotal = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const receivedTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const openInvoices = db.invoices.filter((invoice) => invoice.status !== "void" && invoice.issuedOn <= to);
  const outstandingTotal = openInvoices.reduce(
    (sum, invoice) => sum + Math.max(invoice.total - paidOn(db.payments, invoice), 0),
    0,
  );
  const outstandingCount = openInvoices.filter((invoice) => paidOn(db.payments, invoice) < invoice.total).length;

  const fleet = db.vehicles.filter((vehicle) => vehicle.status !== "retired");
  const vehicleDays = db.rentals.reduce((sum, rental) => sum + rentalVehicleDays(rental, days), 0);
  const availableVehicleDays = fleet.length * days.length;

  const reasons = new Map<string, number>();
  for (const rental of db.rentals) {
    if (rental.status !== "cancelled" && rental.status !== "declined") continue;
    if (!inRange(ymd(rental.updatedAt))) continue;
    const reason = rental.resolutionReason?.trim() || "No reason recorded";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const currencyCode = db.settings.currencyCode;
  const quotes = quotations.length;
  const report: RentalReport = {
    from,
    to,
    currencyCode,
    enquiries: requests.length,
    quotationsIssued: quotes,
    accepted,
    declined,
    cancelled,
    confirmed: db.rentals.filter((rental) => rental.status === "confirmed").length,
    completed: db.rentals.filter((rental) => rental.status === "completed" && inRange(ymd(rental.updatedAt))).length,
    acceptanceRate: quotes > 0 ? accepted / quotes : null,
    invoicedTotal,
    invoiceCount: invoices.length,
    receivedTotal,
    paymentCount: payments.length,
    outstandingTotal,
    outstandingCount,
    vehicleDays,
    availableVehicleDays,
    utilisation: availableVehicleDays > 0 ? vehicleDays / availableVehicleDays : null,
    cancellationReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => (b.count === a.count ? a.reason.localeCompare(b.reason) : b.count - a.count)),
    coverage: {
      rentalsInRange: requests.length,
      rentalsWithoutQuote: requests.filter((rental) => rental.quote === null).length,
      rentalsWithoutVehicle: db.rentals.filter(
        (rental) => rental.status === "confirmed" || rental.status === "in_progress" || rental.status === "completed",
      ).filter((rental) => !rental.assignedVehicleId).length,
      invoicesWithoutCurrency: db.invoices.filter((invoice) => !invoice.currencyCode).length,
    },
    status: currencyCode ? (requests.length === 0 && invoices.length === 0 && payments.length === 0 ? "empty" : "ok") : "currency_not_set",
    message: "",
  };
  report.message = describe(report);
  return report;
}

function describe(report: RentalReport): string {
  if (report.status === "currency_not_set")
    return "Money figures are withheld: the company currency is not set in Settings, and a total without a currency would be a guess.";
  if (report.status === "empty") return `No rental requests, invoices or payments between ${report.from} and ${report.to}.`;
  const acceptance =
    report.acceptanceRate === null
      ? "no quotation was issued, so no acceptance rate is shown"
      : `${Math.round(report.acceptanceRate * 100)}% of quotations were accepted`;
  return `${report.enquiries} request${report.enquiries === 1 ? "" : "s"} received, ${report.quotationsIssued} quoted; ${acceptance}.`;
}

/** The report as CSV, for the operator who wants to check the arithmetic in a spreadsheet. */
export function rentalReportCsv(report: RentalReport): string {
  const money = (value: number) => (report.currencyCode ? `${report.currencyCode} ${value.toFixed(2)}` : "not configured");
  const rows: string[][] = [
    ["Metric", "Value", "Note"],
    ["Period from", report.from, ""],
    ["Period to", report.to, ""],
    ["Enquiries (requests received)", String(report.enquiries), "rental requests created in the period"],
    ["Quotations issued", String(report.quotationsIssued), "latest issue counted once"],
    ["Accepted", String(report.accepted), "confirmed, in progress or completed"],
    ["Declined", String(report.declined), ""],
    ["Cancelled", String(report.cancelled), "cancelled in the period"],
    ["Acceptance rate", report.acceptanceRate === null ? "not available" : `${(report.acceptanceRate * 100).toFixed(1)}%`, "accepted / quotations issued"],
    ["Invoiced", money(report.invoicedTotal), `${report.invoiceCount} live invoices issued in the period`],
    ["Received", money(report.receivedTotal), `${report.paymentCount} payments received in the period`],
    ["Outstanding", money(report.outstandingTotal), `${report.outstandingCount} invoices not fully paid`],
    ["Rental vehicle-days", String(report.vehicleDays), "committed by confirmed, in-progress and completed rentals"],
    ["Available vehicle-days", String(report.availableVehicleDays), "fleet excluding retired × days in period"],
    ["Utilisation", report.utilisation === null ? "not available" : `${(report.utilisation * 100).toFixed(1)}%`, "vehicle-days / available vehicle-days"],
    ["Requests without a quotation", String(report.coverage.rentalsWithoutQuote), "coverage"],
    ["Confirmed rentals without a vehicle", String(report.coverage.rentalsWithoutVehicle), "coverage — should be zero"],
    [],
    ["Cancellation or decline reason", "Count", ""],
    ...report.cancellationReasons.map((reason) => [reason.reason, String(reason.count), ""]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
