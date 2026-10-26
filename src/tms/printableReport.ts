// The management report as a printed document (brief RPT-05).
//
// The runtime has no PDF library and no headless browser: adding one would put a few hundred megabytes
// of binary into an installation that runs on one workstation, and a second rendering engine beside
// the one already on the machine is a second thing that can disagree with the screen. So a report is
// built here as a **document model** — title, period, figures, tables, coverage and notes, every value
// already formatted — and the browser prints it to paper or to PDF through the same sheet the invoice
// and statement use (D-87, D-98).
//
// Three rules, and they are the whole reason this file exists rather than a component full of JSX:
//
//   1. **The figures are the report's own.** It takes `RentalReport` and `FinancialReport` and formats
//      them; it never adds anything up. A printed total that disagrees with the screen is the defect
//      this design makes impossible.
//   2. **A figure that cannot be stated is not printed as zero.** With no company currency set the
//      money figures are withheld and the sheet says why, on the page, where a reader of the paper
//      will see it rather than on a screen they no longer have.
//   3. **The page states its own limits.** Cost per trip is the agreed definition (Q-29), refunds are
//      cash out rather than a cost of the work, and only vehicle hire is invoiced in this build — so
//      a reader cannot mistake the revenue line for the whole business.
import type { FinancialReport } from "./financialReport";
import { formatAmount } from "./money";
import type { RentalReport } from "./rentalReport";

/** One figure on the sheet: already formatted, with the sentence that qualifies it. */
export interface PrintFigure {
  label: string;
  value: string;
  note: string;
}

/** A table on the sheet. Cells are formatted here, not in the component. */
export interface PrintSection {
  id: string;
  title: string;
  intro: string;
  columns: string[];
  rows: string[][];
  /** What is printed when the table has no rows. Never a blank area. */
  empty: string;
  /** True when every column but the first is a number, so the sheet can align it on the right. */
  numeric: boolean;
}

export interface PrintableReport {
  title: string;
  subtitle: string;
  /** The company as configured, or null when Settings has no name yet (shown as a gap, not invented). */
  companyName: string | null;
  period: { from: string; to: string };
  /** When the paper was produced, ISO. Printed on the sheet and in its file name. */
  generatedAt: string;
  /** Identifies this printing: period plus the minute it was produced. */
  reference: string;
  /** "complete" when every figure could be stated; "withheld" when the money cannot be. */
  state: "complete" | "withheld";
  stateLabel: string;
  stateDetail: string;
  figures: PrintFigure[];
  sections: PrintSection[];
  coverage: PrintFigure[];
  notes: string[];
}

export interface PrintableReportInput {
  rental: RentalReport;
  financial: FinancialReport;
  companyName: string | null;
  /** ISO timestamp of the printing. Passed in so the sheet is reproducible in a test. */
  generatedAt: string;
}

const percent = (value: number | null) => (value === null ? "Not available" : `${(value * 100).toFixed(1)}%`);
const count = (value: number) => String(value);

/**
 * Money, formatted once for the whole sheet.
 *
 * With no currency configured the amount is withheld rather than printed bare: "1 240.00" on a
 * customer-facing page reads as a currency the company uses, and the one thing this report must not
 * do is guess which.
 */
function moneyOf(currencyCode: string | null) {
  return (value: number) => (currencyCode ? `${currencyCode} ${formatAmount(value)}` : "Not stated");
}

/** Period as a reader writes it: "1 – 30 June 2026" when both ends fall in one month. */
export function periodLabel(from: string, to: string): string {
  const parse = (date: string) => {
    const [year, month, day] = date.split("-").map((part) => Number(part));
    return { year, month, day };
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return `${from} to ${to}`;
  const a = parse(from);
  const b = parse(to);
  const monthName = (month: number) => new Date(Date.UTC(2000, month - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  if (a.year === b.year && a.month === b.month) return `${a.day} – ${b.day} ${monthName(b.month)} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${monthName(a.month)} – ${b.day} ${monthName(b.month)} ${b.year}`;
  return `${a.day} ${monthName(a.month)} ${a.year} – ${b.day} ${monthName(b.month)} ${b.year}`;
}

/**
 * The document model for one printing of the management report.
 *
 * Every section is kept even when it is empty, with a sentence saying so: a printed report with a
 * heading and nothing under it reads as a fault, and a missing heading reads as an omission.
 */
export function printableReport(input: PrintableReportInput): PrintableReport {
  const { rental, financial, companyName, generatedAt } = input;
  const money = moneyOf(financial.currencyCode);
  const withheld = financial.currencyCode === null;
  const reversed = financial.status === "invalid_range" || rental.from > rental.to;

  const state: PrintableReport["state"] = withheld || reversed ? "withheld" : "complete";
  const stateLabel = reversed
    ? "The period is the wrong way round"
    : withheld
      ? "Money withheld: no currency is set"
      : "Complete for the period";

  const stateDetail = reversed
    ? `The start date ${rental.from} is after the end date ${rental.to}. Nothing on this page is a report of any period.`
    : withheld
      ? "The company currency is not set in Settings, so no amount on this page is stated. The counts are real; the money is not printed, because a bare figure would be read as a currency the company has not chosen."
      : "Every figure below is counted from the records held at the time of printing, and the coverage section says what the records did not include.";

  const figures: PrintFigure[] = [
    { label: "Requests received", value: count(rental.enquiries), note: "rental requests created in the period" },
    { label: "Quotations issued", value: count(rental.quotationsIssued), note: "a revision counts once, at its latest issue" },
    { label: "Acceptance rate", value: percent(rental.acceptanceRate), note: `${rental.accepted} accepted of ${rental.quotationsIssued} quoted` },
    { label: "Hires completed", value: count(rental.completed), note: `${rental.confirmed} confirmed at the time of printing` },
    { label: "Invoiced", value: money(financial.invoicedTotal), note: `${financial.invoiceCount} invoices issued in the period` },
    { label: "Received", value: money(financial.receivedTotal), note: `${financial.paymentCount} payments recorded in the period` },
    { label: "Owed at period end", value: money(financial.outstandingTotal), note: `${financial.outstandingCount} invoices not fully paid or credited` },
    { label: "Costs recorded", value: money(financial.expensesTotal), note: `${financial.expenseLineCount} cost lines incurred in the period` },
  ];

  const sections: PrintSection[] = [
    {
      id: "revenue-by-customer",
      title: "Revenue by customer",
      intro: "What each customer was invoiced in the period, what they have paid against it, and what is still owed.",
      columns: ["Customer", "Invoices", "Invoiced", "Paid", "Owed"],
      rows: financial.revenueByCustomer.map((row) => [
        row.customerName,
        count(row.invoiceCount),
        money(row.invoiced),
        money(row.paid),
        money(row.outstanding),
      ]),
      empty: "No invoice was issued in this period, so no customer was billed.",
      numeric: false,
    },
    {
      id: "revenue-by-service",
      title: "Revenue by service",
      intro: "Only vehicle hire is invoiced by this system in its current form; staff-transport agreements are not billed here.",
      columns: ["Service", "Invoices", "Invoiced"],
      rows: financial.revenueByService.map((row) => [row.service, count(row.invoiceCount), money(row.invoiced)]),
      empty: "Nothing was invoiced in this period.",
      numeric: false,
    },
    {
      id: "costs-by-category",
      title: "Costs by category",
      intro: "Recorded spending in the period, grouped by the categories configured in Settings. Anything without a category is its own line.",
      columns: ["Category", "Lines", "Amount"],
      rows: financial.expensesByCategory.map((row) => [row.category, count(row.lineCount), money(row.amount)]),
      empty: "No cost was recorded in this period. That is not the same statement as the work having cost nothing.",
      numeric: false,
    },
    {
      id: "money-movement",
      title: "Money in and back out",
      intro: "Money taken off bills and money paid back to customers are separate from spending: neither is a cost of running the work.",
      columns: ["Movement", "Documents", "Amount"],
      rows: [
        ["Credited against invoices", count(financial.creditNoteCount), money(financial.creditedTotal)],
        ["Refunded to customers", count(financial.refundCount), money(financial.refundedTotal)],
      ],
      empty: "",
      numeric: false,
    },
    {
      id: "why-lost",
      title: "Why rentals were lost",
      intro: "Every request cancelled or declined in the period, by the reason the office recorded.",
      columns: ["Reason", "Requests"],
      rows: rental.cancellationReasons.map((row) => [row.reason, count(row.count)]),
      empty: "No rental was cancelled or declined in this period.",
      numeric: false,
    },
    {
      id: "utilisation",
      title: "How hard the fleet worked",
      intro: "Vehicle-days committed by confirmed, in-progress and completed hires, against the fleet multiplied by the days in the period. A draft request reserves nothing.",
      columns: ["Measure", "Value", "Of"],
      rows: [
        ["Rental vehicle-days committed", count(rental.vehicleDays), count(rental.availableVehicleDays)],
        ["Utilisation", percent(rental.utilisation), "of the available vehicle-days"],
      ],
      empty: "",
      numeric: false,
    },
    {
      id: "cost-per",
      title: "What the work cost, per unit",
      intro: "The definitions agreed with the owner (Q-29): recorded costs divided by the runs or the riders they carried.",
      columns: ["Measure", "Value", "Over"],
      rows: [
        ["Cost per completed run", financial.costPerTrip === null ? "Not available" : money(financial.costPerTrip), `${count(financial.completedTrips)} runs completed`],
        ["Cost per passenger carried", financial.costPerPassenger === null ? "Not available" : money(financial.costPerPassenger), `${count(financial.passengersBoarded)} riders boarded`],
      ],
      empty: "",
      numeric: false,
    },
  ];

  const coverage: PrintFigure[] = [
    { label: "Requests in the period", value: count(rental.coverage.rentalsInRange), note: "created with dates inside the period" },
    { label: "Requests never quoted", value: count(rental.coverage.rentalsWithoutQuote), note: "they count in requests, not in the acceptance rate" },
    { label: "Confirmed hires with no vehicle", value: count(rental.coverage.rentalsWithoutVehicle), note: "should be zero; anything else is work promised without a bus" },
    { label: "Invoices with no currency", value: count(rental.coverage.invoicesWithoutCurrency), note: "they cannot be added to any total" },
    { label: "Uncategorised cost lines", value: count(financial.coverage.uncategorisedExpenseLines), note: "recorded without a category from Settings" },
    { label: "Invoices with no customer name", value: count(financial.coverage.invoicesWithoutCustomer), note: "they cannot be traced to anybody" },
    { label: "Completed runs with no vehicle", value: count(financial.coverage.completedTripsWithoutVehicle), note: "the cost per run includes them, the utilisation does not" },
  ];

  const notes: string[] = [
    "Every figure is counted from the records held at the time of printing. The coverage figures above state what those records did not include.",
    "Accepted means confirmed, in progress or completed. An acceptance rate over a handful of quotations is not the same statement as one over a quarter, which is why the quotation count is printed beside it.",
    "Outstanding is valued at the period end: a payment made after that date does not settle an invoice that was unpaid then.",
    "Only vehicle hire is invoiced by this system, so revenue by service has one line. Staff-transport agreements are recorded, not billed, in this build.",
    withheld
      ? "No company currency is set, so no amount on this page is stated. Set it in Settings before printing a report for a reader outside the office."
      : `All amounts are in ${financial.currencyCode}.`,
  ];

  const stampMinute = generatedAt.slice(0, 16).replace(/[-:T]/g, "");

  return {
    title: "Management report",
    subtitle: "Hire activity, money and cost for a chosen period",
    companyName,
    period: { from: rental.from, to: rental.to },
    generatedAt,
    reference: `RPT-${rental.from}-to-${rental.to}-${stampMinute}`,
    state,
    stateLabel,
    stateDetail,
    figures,
    sections,
    coverage,
    notes,
  };
}

/** The file name a saved PDF is offered under: the period, so two printings never overwrite silently. */
export function printableReportFileName(report: PrintableReport): string {
  return `management-report-${report.period.from}-to-${report.period.to}.pdf`;
}
