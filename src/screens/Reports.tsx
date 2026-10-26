// Rental report (RPT-01).
//
// The screen is a reading of records, not a second set of books: every figure comes from
// `rentalReport`, which is tested on its own, and the CSV is the same numbers written out so the
// owner can check them against their own spreadsheet. Nothing here is permission-scoped in the
// browser alone — the payload the screen receives has already been narrowed on the server, so an
// export can never contain a record the signed-in role cannot read.
import { useMemo, useState } from "react";
import { formatAmount } from "../tms/money";
import { financialReport, financialReportCsv } from "../tms/financialReport";
import { printableReport } from "../tms/printableReport";
import { ReportPrintPreview } from "./PrintableReport";
import { StaffTransportReport } from "./StaffTransportReport";
import { rentalReport, rentalReportCsv } from "../tms/rentalReport";
import { useTms } from "../tms/useTms";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Stat,
  TableCard,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const money = (currency: string | null, amount: number) => (currency ? `${currency} ${formatAmount(amount)}` : "Not configured");
const percent = (value: number | null) => (value === null ? "Not available" : `${(value * 100).toFixed(1)}%`);

const firstOfMonth = (today: string) => `${today.slice(0, 7)}-01`;

/**
 * The Reports destination, in two tabs (RPT-01/RPT-03 and RPT-02).
 *
 * Two reports with two different questions and two different date ranges do not belong stacked on one
 * page: the hire report is about money, the staff report about people on buses, and a reader is only
 * ever after one of them. The staff tab is offered only to a role that may read the employee roster —
 * the server has already withheld it from finance, so drawing the tab would be a dead end.
 */
export function ReportsPage() {
  const { allowed } = useTms();
  const tabs = [
    { id: "hire" as const, label: "Hire and money" },
    ...(allowed("passengers:read") ? [{ id: "staff" as const, label: "Staff transport" }] : []),
  ];
  const [requested, setRequested] = useState<"hire" | "staff">("hire");
  const tab = tabs.some((candidate) => candidate.id === requested) ? requested : "hire";

  return (
    <div>
      <PageHeader
        eyebrow="Reporting"
        title="Reports"
        description={tab === "hire" ? "What was quoted, what was hired, what came in and what it cost." : "What the buses did: runs worked, riders carried, no-shows, empty seats and on-time performance."}
      />
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Report sections" className="rts-tabs">
          {tabs.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={tab === candidate.id}
              onClick={() => setRequested(candidate.id)}
              className="rts-tab"
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}
      {tab === "staff" ? <StaffTransportReport /> : <HireReport />}
    </div>
  );
}

function HireReport() {
  const { db } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  // The printed sheet is built from the two reports already on screen, so what is printed cannot
  // disagree with what was checked (RPT-05, D-98).
  const [printing, setPrinting] = useState(false);

  const report = useMemo(() => rentalReport(db, from, to), [db, from, to]);
  const moneyReport = useMemo(() => financialReport(db, from, to), [db, from, to]);
  const sheet = useMemo(
    () => printableReport({ rental: report, financial: moneyReport, companyName: db.settings.companyName, generatedAt: new Date().toISOString() }),
    [report, moneyReport, db.settings.companyName],
  );
  const reversed = from > to;
  const downloadMoney = () => {
    const blob = new Blob([financialReportCsv(moneyReport)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `financial-report-${moneyReport.from}-to-${moneyReport.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const download = () => {
    const csv = rentalReportCsv(report);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rental-report-${report.from}-to-${report.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-stone-800">Hire report</h2>
          <p className="max-w-2xl text-sm text-stone-600">
            What came in, what was quoted, what was accepted, what was billed and what is still owed — counted from the rental, invoice and
            payment records, with the coverage stated.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={download} disabled={reversed || report.status === "currency_not_set"}>
            Download CSV
          </Button>
          {/* Printing is offered even when no currency is set: the sheet then says the money is
              withheld, which is a truthful document, where a disabled button is a dead end. */}
          <Button variant="primary" onClick={() => setPrinting(true)} disabled={reversed}>
            Print or save as PDF
          </Button>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From">
          <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Report from date" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Report to date" />
        </Field>
      </div>

      {reversed ? (
        <Notice tone="error" title="The range is the wrong way round" className="mb-4">
          The start date must be on or before the end date.
        </Notice>
      ) : (
        <>
          <Notice tone={report.status === "currency_not_set" ? "warning" : "info"} className="mb-4">
            {report.message}
          </Notice>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Enquiries" value={report.enquiries} caption="requests received in the period" />
            <Stat label="Quotations issued" value={report.quotationsIssued} caption="latest issue counted once" />
            <Stat label="Acceptance rate" value={percent(report.acceptanceRate)} caption={`${report.accepted} accepted · ${report.declined} declined`} />
            <Stat label="Completed" value={report.completed} caption={`${report.confirmed} confirmed now`} />
            <Stat label="Invoiced" value={money(report.currencyCode, report.invoicedTotal)} caption={`${report.invoiceCount} invoices issued`} />
            <Stat label="Received" value={money(report.currencyCode, report.receivedTotal)} caption={`${report.paymentCount} payments received`} />
            <Stat label="Outstanding" value={money(report.currencyCode, report.outstandingTotal)} caption={`${report.outstandingCount} invoices not fully paid`} />
            <Stat label="Utilisation" value={percent(report.utilisation)} caption={`${report.vehicleDays} of ${report.availableVehicleDays} vehicle-days`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TableCard title="Why rentals were lost" summary={`${report.cancellationReasons.reduce((sum, reason) => sum + reason.count, 0)} cancelled or declined in the period`}>
              <DataTable
                rows={report.cancellationReasons}
                rowKey={(reason) => reason.reason}
                emptyState={<EmptyState title="No cancellations" body="No rental was cancelled or declined in this period." />}
                columns={[
                  { key: "reason", header: "Reason", render: (reason) => reason.reason },
                  { key: "count", header: "Count", className: "text-right rts-mono", render: (reason) => reason.count },
                ]}
              />
            </TableCard>

            <TableCard title="Coverage" summary="What the figures above do and do not include">
              <ul className="space-y-2 text-sm text-stone-700">
                <li className="flex justify-between gap-4">
                  <span>Requests in the period without a quotation</span>
                  <span className="rts-mono">{report.coverage.rentalsWithoutQuote}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Confirmed rentals with no vehicle assigned</span>
                  <span className="rts-mono">{report.coverage.rentalsWithoutVehicle}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Invoices with no currency</span>
                  <span className="rts-mono">{report.coverage.invoicesWithoutCurrency}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Period</span>
                  <span className="rts-mono">
                    {formatDate(report.from)} – {formatDate(report.to)}
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                Accepted means confirmed, in progress or completed. Vehicle-days count confirmed, in-progress and completed rentals that have a
                vehicle, divided by the acting fleet multiplied by the days in the period. A draft request reserves nothing.
              </p>
            </TableCard>
          </div>

          <section className="mt-6 space-y-4" aria-labelledby="financial-report">
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-stone-200 pt-5">
              <div>
                <h2 id="financial-report" className="text-sm font-semibold uppercase tracking-wider text-stone-500">
                  Money and cost (RPT-03)
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-stone-600">
                  Revenue by customer and service, what came in, what is still owed at the period end, and what the fleet cost to keep
                  running — grouped by the cost categories configured in Settings. Cost per trip is recorded costs divided by scheduled
                  runs completed in the period, the definition agreed with the owner (Q-29).
                </p>
              </div>
              <Button onClick={downloadMoney} disabled={moneyReport.status === "currency_not_set"}>
                Download financial CSV
              </Button>
            </div>

            <Notice tone={moneyReport.status === "currency_not_set" ? "warning" : "info"}>{moneyReport.message}</Notice>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Invoiced" value={money(moneyReport.currencyCode, moneyReport.invoicedTotal)} caption={`${moneyReport.invoiceCount} invoices issued`} />
              <Stat label="Received" value={money(moneyReport.currencyCode, moneyReport.receivedTotal)} caption={`${moneyReport.paymentCount} payments in the period`} />
              <Stat label="Outstanding" value={money(moneyReport.currencyCode, moneyReport.outstandingTotal)} caption={`${moneyReport.outstandingCount} invoices not fully paid`} />
              <Stat label="Costs recorded" value={money(moneyReport.currencyCode, moneyReport.expensesTotal)} caption={`${moneyReport.expenseLineCount} cost lines`} />
              <Stat
                label="Refunded"
                value={money(moneyReport.currencyCode, moneyReport.refundedTotal)}
                caption={`${moneyReport.refundCount} refund${moneyReport.refundCount === 1 ? "" : "s"} paid back — cash out, not a cost of running the work`}
              />
              <Stat
                label="Cost per trip"
                value={moneyReport.costPerTrip === null ? "Not available" : money(moneyReport.currencyCode, moneyReport.costPerTrip)}
                caption={`over ${moneyReport.completedTrips} completed run${moneyReport.completedTrips === 1 ? "" : "s"}`}
              />
              <Stat
                label="Cost per passenger"
                value={moneyReport.costPerPassenger === null ? "Not available" : money(moneyReport.currencyCode, moneyReport.costPerPassenger)}
                caption={`over ${moneyReport.passengersBoarded} riders boarded`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard title="Revenue by customer" summary={`${moneyReport.revenueByCustomer.length} customers billed in the period`}>
                <DataTable
                  rows={moneyReport.revenueByCustomer}
                  rowKey={(row) => row.customerName}
                  emptyState={<EmptyState title="Nothing invoiced" body="No invoice was issued in this period." />}
                  columns={[
                    { key: "customer", header: "Customer", render: (row) => row.customerName },
                    { key: "invoiced", header: "Invoiced", className: "text-right rts-mono", render: (row) => money(moneyReport.currencyCode, row.invoiced) },
                    { key: "paid", header: "Paid", className: "text-right rts-mono", render: (row) => money(moneyReport.currencyCode, row.paid) },
                    { key: "outstanding", header: "Owed", className: "text-right rts-mono", render: (row) => money(moneyReport.currencyCode, row.outstanding) },
                  ]}
                />
              </TableCard>

              <TableCard title="Expenses by category" summary={`${moneyReport.expensesByCategory.length} categories with costs in the period`}>
                <DataTable
                  rows={moneyReport.expensesByCategory}
                  rowKey={(row) => row.category}
                  emptyState={<EmptyState title="No costs recorded" body="Nothing was entered for this period. That is not the same as zero cost." />}
                  columns={[
                    { key: "category", header: "Category", render: (row) => row.category },
                    { key: "lines", header: "Lines", className: "text-right rts-mono", render: (row) => row.lineCount },
                    { key: "amount", header: "Amount", className: "text-right rts-mono", render: (row) => money(moneyReport.currencyCode, row.amount) },
                  ]}
                />
              </TableCard>
            </div>

            <TableCard title="Money coverage" summary="What the financial figures above do and do not include">
              <ul className="space-y-2 text-sm text-stone-700">
                <li className="flex justify-between gap-4">
                  <span>Uncategorised cost lines</span>
                  <span className="rts-mono">{moneyReport.coverage.uncategorisedExpenseLines}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Invoices with no customer name</span>
                  <span className="rts-mono">{moneyReport.coverage.invoicesWithoutCustomer}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Completed runs with no vehicle recorded</span>
                  <span className="rts-mono">{moneyReport.coverage.completedTripsWithoutVehicle}</span>
                </li>
                <li className="flex justify-between gap-4">
                  <span>Revenue by service</span>
                  <span className="rts-mono">{moneyReport.revenueByService.map((row) => `${row.service}: ${money(moneyReport.currencyCode, row.invoiced)}`).join(" · ") || "nothing invoiced"}</span>
                </li>
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                Outstanding is valued at the period end: a payment made later does not settle an invoice that was unpaid then. Only vehicle
                hire is invoiced in this build, so revenue by service has one line — staff-transport contracts are not billed by this system yet.
              </p>
            </TableCard>
          </section>
        </>
      )}

      {printing && <ReportPrintPreview report={sheet} onClose={() => setPrinting(false)} />}
    </div>
  );
}
