// Rental report (RPT-01).
//
// The screen is a reading of records, not a second set of books: every figure comes from
// `rentalReport`, which is tested on its own, and the CSV is the same numbers written out so the
// owner can check them against their own spreadsheet. Nothing here is permission-scoped in the
// browser alone — the payload the screen receives has already been narrowed on the server, so an
// export can never contain a record the signed-in role cannot read.
import { useMemo, useState } from "react";
import { formatAmount } from "../tms/money";
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

export function ReportsPage() {
  const { db } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);

  const report = useMemo(() => rentalReport(db, from, to), [db, from, to]);
  const reversed = from > to;

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
      <PageHeader
        eyebrow="Reporting"
        title="Rental report"
        description="What came in, what was quoted, what was accepted, what was billed and what is still owed — counted from the rental, invoice and payment records, with the coverage stated."
        actions={
          <Button onClick={download} disabled={reversed || report.status === "currency_not_set"}>
            Download CSV
          </Button>
        }
      />

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
        </>
      )}
    </div>
  );
}
