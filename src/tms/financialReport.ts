// Financial reporting (brief RPT-03), with the definitions the owner approved in Q-29 and D-78.
//
// The brief names RPT-03 but does not define its figures. These are the definitions this build
// implements, and they are the same ones written in docs/KPIS.md:
//
//   revenue by customer  — invoices issued in the period, grouped by the name billed, not void;
//   revenue by service   — the same invoices grouped by what was sold (only vehicle hire is
//                          invoiced in this build, and the report says so rather than inventing a
//                          second service line);
//   payments received    — money recorded as received in the period, whatever the invoice date;
//   outstanding          — invoices issued on or before the period end that are not paid in full,
//                          valued at the period end (payments after that date do not count);
//   expenses by category — cost entries incurred in the period, grouped by the names configured in
//                          Settings; anything without a category is shown as "Uncategorised";
//   cost per trip        — recorded expenses ÷ scheduled runs completed in the period (Q-29);
//   cost per passenger   — recorded expenses ÷ riders actually boarded on those completed runs.
//
// Every money figure is added in whole pesewas (money.ts, audit D-04) and withheld entirely when
// the company currency is not set, because a total without a currency is a guess.

import { costReport } from "./costs";
import { toCsv } from "./csv";
import { creditedTotal, invoiceBalance, isLivePayment, liveRefunds } from "./creditNotes";
import { fromMinor, sumAmounts, toMinor } from "./money";
import type { Database, Invoice, Payment } from "./types";

export interface RevenueByCustomer {
  customerName: string;
  invoiceCount: number;
  invoiced: number;
  /** Taken off those invoices by credit notes issued on or before the period end (D-86). */
  credited: number;
  paid: number;
  outstanding: number;
}

export interface RevenueByService {
  service: string;
  invoiceCount: number;
  invoiced: number;
}

export interface ExpensesByCategory {
  category: string;
  lineCount: number;
  amount: number;
}

export interface FinancialReport {
  from: string;
  to: string;
  currencyCode: string | null;
  revenueByCustomer: RevenueByCustomer[];
  revenueByService: RevenueByService[];
  /** Invoices issued in the period, excluding voids. */
  invoicedTotal: number;
  invoiceCount: number;
  /** Payments recorded in the period. */
  receivedTotal: number;
  paymentCount: number;
  /** Credit notes issued in the period: money taken off the bills, not money received. */
  creditedTotal: number;
  creditNoteCount: number;
  /**
   * Money paid back to customers in the period (D-92). Cash out, and deliberately kept apart from
   * recorded costs: a refund is not spending on the business, and folding it into expenses would make
   * the month look as though it cost more to run than it did.
   */
  refundedTotal: number;
  refundCount: number;
  /** Not paid and not credited in full as at the period end. */
  outstandingTotal: number;
  outstandingCount: number;
  expensesByCategory: ExpensesByCategory[];
  expensesTotal: number;
  expenseLineCount: number;
  /** Scheduled runs completed in the period (staff transport). */
  completedTrips: number;
  passengersBoarded: number;
  /** Recorded expenses ÷ completed runs (Q-29). Null when no run was completed. */
  costPerTrip: number | null;
  /** Recorded expenses ÷ riders boarded. Null when nobody was recorded as boarded. */
  costPerPassenger: number | null;
  coverage: {
    invoicesInPeriod: number;
    invoicesWithoutCustomer: number;
    uncategorisedExpenseLines: number;
    completedTripsWithoutVehicle: number;
  };
  status: "ok" | "currency_not_set" | "empty" | "invalid_range";
  message: string;
}

const ymd = (iso: string) => iso.slice(0, 10);

/** What was sold. Only hire invoices exist in this build; an agreement invoice would add a row (FIN-02). */
const SERVICE_LABELS: Record<Invoice["kind"], string> = { rental: "Vehicle hire" };

/**
 * Money paid towards one invoice by a given day, in whole pesewas.
 *
 * A cancelled payment is skipped: it was recorded in error, so reporting it as money received would
 * overstate the period and overstate what the customer has paid (D-88).
 */
const paidToward = (payments: Payment[], invoice: Invoice, upTo?: string) =>
  payments.reduce(
    (sum, payment) =>
      payment.invoiceId === invoice.id && isLivePayment(payment) && (!upTo || ymd(payment.paidOn) <= upTo)
        ? sum + toMinor(payment.amount)
        : sum,
    0,
  );

export function financialReport(db: Database, from: string, to: string): FinancialReport {
  const currencyCode = db.settings.currencyCode;
  const inRange = (date: string) => date >= from && date <= to;

  const invoices = db.invoices.filter((invoice) => invoice.status !== "void" && inRange(invoice.issuedOn));
  const payments = db.payments.filter((payment) => isLivePayment(payment) && inRange(ymd(payment.paidOn)));
  const refunds = liveRefunds(db).filter((refund) => inRange(ymd(refund.paidOn)));

  // Revenue by customer. A missing name is its own line: folding it into "other" would hide that
  // the invoice cannot be traced to anybody.
  const customers = new Map<string, { invoiceCount: number; invoiced: number; credited: number; paid: number }>();
  for (const invoice of invoices) {
    const key = invoice.customerName.trim() || "No customer named";
    const bucket = customers.get(key) ?? { invoiceCount: 0, invoiced: 0, credited: 0, paid: 0 };
    bucket.invoiceCount += 1;
    bucket.invoiced += toMinor(invoice.total);
    bucket.credited += toMinor(creditedTotal(db, invoice, to));
    bucket.paid += paidToward(db.payments, invoice, to);
    customers.set(key, bucket);
  }
  const revenueByCustomer: RevenueByCustomer[] = [...customers.entries()]
    .map(([customerName, bucket]) => ({
      customerName,
      invoiceCount: bucket.invoiceCount,
      invoiced: fromMinor(bucket.invoiced),
      credited: fromMinor(bucket.credited),
      // Paid is capped at what is still asked for after credits: a customer whose overpayment became
      // a refund has not paid more than the invoice, and the row has to add up on screen.
      paid: fromMinor(Math.min(bucket.paid, Math.max(bucket.invoiced - bucket.credited, 0))),
      outstanding: fromMinor(Math.max(bucket.invoiced - bucket.credited - bucket.paid, 0)),
    }))
    .sort((a, b) => (b.invoiced === a.invoiced ? a.customerName.localeCompare(b.customerName) : b.invoiced - a.invoiced));

  const services = new Map<string, { invoiceCount: number; invoiced: number }>();
  for (const invoice of invoices) {
    const key = SERVICE_LABELS[invoice.kind] ?? invoice.kind;
    const bucket = services.get(key) ?? { invoiceCount: 0, invoiced: 0 };
    bucket.invoiceCount += 1;
    bucket.invoiced += toMinor(invoice.total);
    services.set(key, bucket);
  }
  const revenueByService: RevenueByService[] = [...services.entries()]
    .map(([service, bucket]) => ({ service, invoiceCount: bucket.invoiceCount, invoiced: fromMinor(bucket.invoiced) }))
    .sort((a, b) => b.invoiced - a.invoiced);

  // Outstanding as at the period end: an invoice issued later does not belong in a statement about
  // what was owed at that date, and a payment made later does not settle it retroactively.
  const openInvoices = db.invoices.filter((invoice) => invoice.status !== "void" && invoice.issuedOn <= to);
  // Both payments and credits are measured as at the period end, and the balance itself is the one
  // shared helper (creditNotes.ts) so this statement cannot disagree with the invoice screen.
  const balances = openInvoices.map((invoice) => invoiceBalance(db, invoice, to));
  const outstandingMinor = balances.reduce((sum, balance) => sum + toMinor(balance.outstanding), 0);
  const outstandingCount = balances.filter((balance) => toMinor(balance.outstanding) > 0).length;

  const creditNotes = db.creditNotes.filter((note) => note.status === "issued" && inRange(note.issuedOn));

  // Expenses: the cost report already decides what a recorded cost is and refuses to total across
  // currencies, so the two screens cannot disagree about the same entries.
  const costs = costReport(db, from, to);
  const byCategory = new Map<string, { lineCount: number; amount: number }>();
  for (const line of costs.lines) {
    const key = line.category.trim() || "Uncategorised";
    const bucket = byCategory.get(key) ?? { lineCount: 0, amount: 0 };
    bucket.lineCount += 1;
    bucket.amount += toMinor(line.amount);
    byCategory.set(key, bucket);
  }
  const expensesByCategory: ExpensesByCategory[] = [...byCategory.entries()]
    .map(([category, bucket]) => ({ category, lineCount: bucket.lineCount, amount: fromMinor(bucket.amount) }))
    .sort((a, b) => (b.amount === a.amount ? a.category.localeCompare(b.category) : b.amount - a.amount));

  const completed = db.trips.filter((trip) => trip.status === "completed" && inRange(trip.serviceDate));
  const passengersBoarded = completed.reduce(
    (sum, trip) => sum + trip.boardings.filter((boarding) => boarding.outcome === "boarded").length,
    0,
  );

  const report: FinancialReport = {
    from,
    to,
    currencyCode,
    revenueByCustomer,
    revenueByService,
    invoicedTotal: sumAmounts(invoices.map((invoice) => invoice.total)),
    invoiceCount: invoices.length,
    receivedTotal: sumAmounts(payments.map((payment) => payment.amount)),
    paymentCount: payments.length,
    creditedTotal: sumAmounts(creditNotes.map((note) => note.total)),
    creditNoteCount: creditNotes.length,
    refundedTotal: sumAmounts(refunds.map((refund) => refund.amount)),
    refundCount: refunds.length,
    outstandingTotal: fromMinor(outstandingMinor),
    outstandingCount,
    expensesByCategory,
    expensesTotal: costs.total,
    expenseLineCount: costs.lines.length,
    completedTrips: completed.length,
    passengersBoarded,
    // A cost per trip over no trips is not zero, it is "not available" — dividing by nothing would
    // produce a number nobody can act on.
    costPerTrip: completed.length > 0 ? divide(costs.total, completed.length) : null,
    costPerPassenger: passengersBoarded > 0 ? divide(costs.total, passengersBoarded) : null,
    coverage: {
      invoicesInPeriod: invoices.length,
      invoicesWithoutCustomer: invoices.filter((invoice) => !invoice.customerName.trim()).length,
      uncategorisedExpenseLines: costs.lines.filter((line) => !line.category.trim()).length,
      completedTripsWithoutVehicle: completed.filter((trip) => !trip.vehicleId).length,
    },
    status: "ok",
    message: "",
  };
  report.status = statusOf(report, from, to, costs.lines.length);
  report.message = describe(report);
  return report;
}

/** Money divided and rounded to the pesewa, so a per-unit figure is still a real amount. */
function divide(total: number, count: number): number {
  return fromMinor(Math.round(toMinor(total) / count));
}

function statusOf(report: FinancialReport, from: string, to: string, costLines: number): FinancialReport["status"] {
  if (from > to) return "invalid_range";
  if (!report.currencyCode) return "currency_not_set";
  const nothing =
    report.invoiceCount === 0 &&
    report.paymentCount === 0 &&
    report.creditNoteCount === 0 &&
    report.refundCount === 0 &&
    costLines === 0 &&
    report.completedTrips === 0;
  return nothing ? "empty" : "ok";
}

function describe(report: FinancialReport): string {
  if (report.status === "invalid_range") return "The reporting period is invalid: the start date is after the end date.";
  if (report.status === "currency_not_set")
    return "Money figures are withheld: the company currency is not set in Settings, and a total without a currency would be a guess.";
  if (report.status === "empty")
    return `No invoices, payments, credit notes, refunds, recorded costs or completed runs between ${report.from} and ${report.to}.`;
  const cost =
    report.costPerTrip === null
      ? "no run was completed in the period, so cost per trip is not available"
      : `cost per trip ${report.currencyCode} ${report.costPerTrip.toFixed(2)} over ${report.completedTrips} completed run${report.completedTrips === 1 ? "" : "s"}`;
  const credited = report.creditNoteCount
    ? `, ${report.currencyCode} ${report.creditedTotal.toFixed(2)} credited back on ${report.creditNoteCount} credit note${report.creditNoteCount === 1 ? "" : "s"}`
    : "";
  const refunded = report.refundCount
    ? `, ${report.currencyCode} ${report.refundedTotal.toFixed(2)} paid back on ${report.refundCount} refund${report.refundCount === 1 ? "" : "s"}`
    : "";
  return `${report.invoiceCount} invoice${report.invoiceCount === 1 ? "" : "s"} issued for ${report.currencyCode} ${report.invoicedTotal.toFixed(2)}${credited}${refunded}; ${report.expenseLineCount} recorded cost line${report.expenseLineCount === 1 ? "" : "s"}; ${cost}.`;
}

/** The report as CSV, so the owner can check the arithmetic in a spreadsheet. */
export function financialReportCsv(report: FinancialReport): string {
  const money = (value: number) => (report.currencyCode ? `${report.currencyCode} ${value.toFixed(2)}` : "not configured");
  const rows: string[][] = [
    ["Metric", "Value", "Note"],
    ["Period from", report.from, ""],
    ["Period to", report.to, ""],
    ["Invoiced", money(report.invoicedTotal), `${report.invoiceCount} live invoices issued in the period`],
    ["Received", money(report.receivedTotal), `${report.paymentCount} payments received in the period`],
    ["Credited", money(report.creditedTotal), `${report.creditNoteCount} credit notes issued in the period`],
    ["Refunded", money(report.refundedTotal), `${report.refundCount} refunds paid back in the period`],
    ["Outstanding at period end", money(report.outstandingTotal), `${report.outstandingCount} invoices not fully paid or credited`],
    ["Costs recorded", money(report.expensesTotal), `${report.expenseLineCount} cost lines incurred in the period`],
    ["Completed runs", String(report.completedTrips), "scheduled runs completed in the period"],
    ["Passengers boarded", String(report.passengersBoarded), "riders recorded as boarded on those runs"],
    ["Cost per trip", report.costPerTrip === null ? "not available" : money(report.costPerTrip), "recorded costs / completed runs"],
    ["Cost per passenger", report.costPerPassenger === null ? "not available" : money(report.costPerPassenger), "recorded costs / riders boarded"],
    ["", "", ""],
    ["Revenue by customer", "Invoiced", "Credited · Paid · Outstanding · Invoices"],
    ...report.revenueByCustomer.map((row) => [
      row.customerName,
      money(row.invoiced),
      `${money(row.credited)} · ${money(row.paid)} · ${money(row.outstanding)} · ${row.invoiceCount}`,
    ]),
    ["", "", ""],
    ["Revenue by service", "Invoiced", "Invoices"],
    ...report.revenueByService.map((row) => [row.service, money(row.invoiced), String(row.invoiceCount)]),
    ["", "", ""],
    ["Expenses by category", "Amount", "Lines"],
    ...report.expensesByCategory.map((row) => [row.category, money(row.amount), String(row.lineCount)]),
    ["", "", ""],
    ["Invoices with no customer name", String(report.coverage.invoicesWithoutCustomer), "coverage"],
    ["Uncategorised cost lines", String(report.coverage.uncategorisedExpenseLines), "coverage — configure cost categories in Settings"],
    ["Completed runs with no vehicle recorded", String(report.coverage.completedTripsWithoutVehicle), "coverage — should be zero"],
  ];
  return toCsv(rows);
}
