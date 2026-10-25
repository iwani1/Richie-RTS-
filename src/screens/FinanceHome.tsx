// The finance home screen (brief FIN-07).
//
// Finance used to land on the operations dashboard, which is about runs, rosters and the fleet. This
// screen answers the questions the money side opens the system with: what came in and went out in the
// period, who is late paying, and what is waiting on a finance decision.
//
// Every figure comes from `financeHome`, which is tested on its own and repeats `financialReport` for
// the period rather than recomputing it — so this screen cannot disagree with the report behind it.
// The open work (late invoices, unbilled hires, payments to verify) is measured **as at today** and
// says so, because changing the date filter must not make a deadline disappear.
import { useMemo, useState } from "react";
import { AGE_BUCKETS, AGE_BUCKET_LABELS } from "../tms/customerStatement";
import { financeHome } from "../tms/financeHome";
import { formatAmount } from "../tms/money";
import { useTms } from "../tms/useTms";
import { PAYMENT_STATUS_LABELS } from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, Notice, PageHeader, Stat, TableCard, TextInput, formatDate, todayYmd } from "../ui/primitives";
import type { Route } from "../routes";

const money = (currency: string | null, amount: number) => (currency ? `${currency} ${formatAmount(amount)}` : "Not configured");
const firstOfMonth = (today: string) => `${today.slice(0, 7)}-01`;

export function FinanceHomePage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, allowed } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);

  // `asAt` is today, always: the open work is what is late or waiting now.
  const home = useMemo(() => financeHome(db, from, to, today), [db, from, to, today]);
  const reversed = from > to;
  const currency = home.currencyCode;

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Finance"
        description="Money in, money out, who is late and what is waiting on a decision. Every figure is counted from the invoice, payment and cost records; nothing is estimated."
        actions={
          allowed("invoices:read") ? (
            <Button variant="primary" onClick={() => navigate("invoices")}>
              Open invoices
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From">
          <TextInput type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Finance period from" />
        </Field>
        <Field label="To">
          <TextInput type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Finance period to" />
        </Field>
      </div>

      {reversed ? (
        <Notice tone="error" title="The range is the wrong way round" className="mb-4">
          The start date must be on or before the end date.
        </Notice>
      ) : (
        <>
          <Notice tone={home.status === "currency_not_set" ? "warning" : "info"} className="mb-4">
            {home.message} The money figures cover {formatDate(home.from)} to {formatDate(home.to)}; the open work below is measured as at{" "}
            {formatDate(home.asAt)}.
          </Notice>

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Invoiced"
              value={money(currency, home.figures.invoicedTotal)}
              caption={
                home.figures.creditNoteCount > 0
                  ? `${home.figures.invoiceCount} invoices issued · ${money(currency, home.figures.creditedTotal)} credited back on ${home.figures.creditNoteCount} note${home.figures.creditNoteCount === 1 ? "" : "s"}`
                  : `${home.figures.invoiceCount} invoices issued in the period`
              }
            />
            <Stat label="Received" value={money(currency, home.figures.receivedTotal)} caption={`${home.figures.paymentCount} payments recorded in the period`} />
            <Stat label="Costs recorded" value={money(currency, home.figures.expensesTotal)} caption={`${home.figures.expenseLineCount} cost lines in the period`} />
            <Stat
              label="Margin"
              value={home.margin.available ? money(currency, home.margin.amount ?? 0) : "Not available"}
              caption={
                home.margin.available
                  ? `Hires billed${home.figures.creditNoteCount > 0 ? " less credits" : ""} less costs recorded${home.margin.percent === null ? "" : ` — ${(home.margin.percent * 100).toFixed(1)}% of revenue`}`
                  : home.margin.reason
              }
            />
            <Stat
              label="Cash movement"
              value={home.movement ? money(currency, home.movement.difference) : "Not available"}
              caption={
                home.movement && home.figures.refundCount > 0
                  ? `Received less spend less ${money(currency, home.movement.refunds)} paid back to customers — cash, not profit`
                  : "Recorded payments in minus recorded spend — cash, not profit: what is owed and what is held are not in it"
              }
            />
            <Stat
              label="Overdue now"
              value={money(currency, home.overdueTotal)}
              caption={`${home.overdue.length} invoice${home.overdue.length === 1 ? "" : "s"} past the due date as at ${formatDate(home.asAt)}`}
            />
            <Stat
              label="Unbilled work"
              value={home.unbilled.length}
              caption="completed hires with no invoice issued"
            />
            <Stat
              label="Paid back"
              value={money(currency, home.figures.refundedTotal)}
              caption={`${home.figures.refundCount} refund${home.figures.refundCount === 1 ? "" : "s"} to customers in the period`}
            />
            <Stat
              label="To check"
              value={money(currency, home.awaitingTotal)}
              caption={`${home.awaitingPayments.length} payment${home.awaitingPayments.length === 1 ? "" : "s"} recorded but not reconciled`}
            />
            <Stat
              label="Cost per trip"
              value={home.figures.costPerTrip === null ? "Not available" : money(currency, home.figures.costPerTrip)}
              caption={`${home.figures.completedTrips} completed runs · per passenger ${home.figures.costPerPassenger === null ? "not available" : money(currency, home.figures.costPerPassenger)}`}
            />
          </div>

          <div className="space-y-4">
            {/* How bad the debt is, before the list of what to chase today (D-91). The bands are the
                ones a customer statement prints, so a figure read here and the same figure on a
                statement sent to the customer are the same band of the same money. */}
            <TableCard
              title="Debt by age"
              summary={`Everything still owed, whatever its invoice date, measured as at ${formatDate(home.asAt)}. The bands are the ones a customer statement prints.`}
              actions={
                allowed("invoices:read") ? (
                  <Button onClick={() => navigate("statements")}>Open statements</Button>
                ) : undefined
              }
            >
              <Notice tone={home.ageing.status === "ok" ? "info" : "warning"} className="mb-4">
                {home.ageing.message}
              </Notice>
              {home.ageing.status === "ok" && (
                <>
                  <dl className="rts-ageing">
                    {AGE_BUCKETS.map((bucket) => (
                      <div key={bucket} className="rts-ageing-row">
                        <dt>
                          <span className="rts-ageing-label">{AGE_BUCKET_LABELS[bucket]}</span>
                          <span className="rts-ageing-hint">
                            {bucket === "notYetDue"
                              ? "within the payment terms"
                              : bucket === "days1to30"
                                ? "worth a reminder"
                                : bucket === "days31to60"
                                  ? "worth a call"
                                  : "decide what to do"}
                          </span>
                        </dt>
                        <dd className="rts-mono">{home.ageing[bucket] > 0 ? money(currency, home.ageing[bucket]) : "—"}</dd>
                      </div>
                    ))}
                    <div className="rts-ageing-row">
                      <dt>
                        <span className="rts-ageing-label rts-ageing-label--total">Total still owed</span>
                        <span className="rts-ageing-hint">
                          {home.ageing.openInvoices} open invoice{home.ageing.openInvoices === 1 ? "" : "s"} ·{" "}
                          {home.ageing.customers.length} customer{home.ageing.customers.length === 1 ? "" : "s"}
                        </span>
                      </dt>
                      <dd className="rts-mono">{money(currency, home.ageing.total)}</dd>
                    </div>
                  </dl>

                  <div className="mt-5">
                    <DataTable
                      rows={home.ageing.customers}
                      rowKey={(row) => row.customerName}
                      emptyState={<EmptyState title="Nothing is owed" body="Every invoice issued so far is settled." />}
                      columns={[
                        {
                          key: "customer",
                          header: "Customer",
                          render: (row) => (
                            <span className="flex flex-col">
                              <span>{row.customerName}</span>
                              <span className="text-xs text-stone-600">
                                {row.openInvoices} invoice{row.openInvoices === 1 ? "" : "s"}
                                {row.oldestDaysOverdue > 0 ? ` · oldest ${row.oldestDaysOverdue} days late` : " · nothing late"}
                              </span>
                            </span>
                          ),
                        },
                        ...AGE_BUCKETS.slice(1).map((bucket) => ({
                          key: bucket,
                          header: AGE_BUCKET_LABELS[bucket],
                          className: "text-right rts-mono",
                          render: (row: (typeof home.ageing.customers)[number]) => (row[bucket] > 0 ? money(currency, row[bucket]) : "—"),
                        })),
                        {
                          key: "total",
                          header: "Owed",
                          className: "text-right rts-mono",
                          render: (row: (typeof home.ageing.customers)[number]) => money(currency, row.total),
                        },
                      ]}
                    />
                  </div>
                </>
              )}
            </TableCard>

            <TableCard
              title="Overdue"
              summary={`Measured as at ${formatDate(home.asAt)}, not inside the period. An invoice part paid is shown at what is still owed.`}
              actions={
                allowed("invoices:read") ? (
                  <Button onClick={() => navigate("invoices")}>Chase in Invoices</Button>
                ) : undefined
              }
            >
              <DataTable
                rows={home.overdue}
                rowKey={(row) => row.id}
                emptyState={<EmptyState title="Nothing is overdue" body="No invoice is past its due date with money still owed." />}
                columns={[
                  { key: "ref", header: "Invoice", render: (row) => <span className="font-mono text-xs font-semibold text-stone-900">{row.reference}</span> },
                  { key: "customer", header: "Customer", render: (row) => row.customerName || <em className="rts-unset">no name recorded</em> },
                  { key: "due", header: "Due", render: (row) => formatDate(row.dueOn) },
                  {
                    key: "late",
                    header: "Late by",
                    // The number and the word: a colour never carries the state on its own.
                    render: (row) => <Badge tone={row.daysOverdue >= 30 ? "error" : "warning"}>{`${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"}`}</Badge>,
                  },
                  { key: "owed", header: "Still owed", className: "text-right rts-mono", render: (row) => money(currency, row.outstanding) },
                ]}
              />
            </TableCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard title="Completed but not billed" summary="A hire earns its money when it is completed. These have no invoice yet.">
                <DataTable
                  rows={home.unbilled}
                  rowKey={(row) => row.rentalId}
                  emptyState={<EmptyState title="Every completed hire is billed" body="Nothing is waiting for an invoice." />}
                  columns={[
                    { key: "ref", header: "Hire", render: (row) => <span className="font-mono text-xs font-semibold text-stone-900">{row.reference}</span> },
                    { key: "customer", header: "Customer", render: (row) => row.customerName || <em className="rts-unset">no name recorded</em> },
                    { key: "done", header: "Completed", render: (row) => formatDate(row.completedOn) },
                    {
                      key: "total",
                      header: "Recorded total",
                      className: "text-right rts-mono",
                      render: (row) => (row.finalTotal === null ? <em className="rts-unset">none recorded</em> : money(currency, row.finalTotal)),
                    },
                  ]}
                />
              </TableCard>

              <TableCard
                title="Money paid back"
                summary={
                  home.refunds.length
                    ? `${money(currency, home.figures.refundedTotal)} refunded in the period. A refund settles a credit, it is not a cost of the work.`
                    : "Refunds recorded in the period appear here, with the invoice and the reason."
                }
              >
                <DataTable
                  rows={home.refunds}
                  rowKey={(row) => row.id}
                  emptyState={<EmptyState title="Nothing paid back" body="No refund was recorded in this period." />}
                  columns={[
                    { key: "ref", header: "Refund", render: (row) => <span className="font-mono text-xs font-semibold text-stone-900">{row.reference}</span> },
                    { key: "invoice", header: "Against", render: (row) => <span className="font-mono text-xs">{row.invoiceReference}</span> },
                    { key: "customer", header: "Customer", render: (row) => row.customerName || <em className="rts-unset">no name recorded</em> },
                    { key: "paid", header: "Paid back", render: (row) => formatDate(row.paidOn) },
                    { key: "reason", header: "Why", render: (row) => <span className="text-xs text-stone-600">{row.reason}</span> },
                    { key: "amount", header: "Amount", className: "text-right rts-mono", render: (row) => money(currency, row.amount) },
                  ]}
                />
              </TableCard>

              <TableCard title="Payments to check" summary="Recorded money is not settled money: each one still has a step to take.">
                <DataTable
                  rows={home.awaitingPayments}
                  rowKey={(row) => row.id}
                  emptyState={<EmptyState title="Nothing to check" body="Every recorded payment has been reconciled." />}
                  columns={[
                    { key: "ref", header: "Payment", render: (row) => <span className="font-mono text-xs font-semibold text-stone-900">{row.reference}</span> },
                    { key: "invoice", header: "Against", render: (row) => <span className="font-mono text-xs">{row.invoiceReference}</span> },
                    { key: "paid", header: "Paid on", render: (row) => formatDate(row.paidOn) },
                    {
                      key: "next",
                      header: "Status · next step",
                      render: (row) => (
                        <span className="text-xs text-stone-700">
                          {PAYMENT_STATUS_LABELS[row.status]} · <b>{row.nextStep === "verify" ? "verify" : "reconcile"}</b>
                        </span>
                      ),
                    },
                    { key: "amount", header: "Amount", className: "text-right rts-mono", render: (row) => money(currency, row.amount) },
                  ]}
                />
              </TableCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TableCard title="Revenue by customer" summary={`Invoices issued in the period, per customer. ${home.byCustomer.length} customer${home.byCustomer.length === 1 ? "" : "s"}.`}>
                <DataTable
                  rows={home.byCustomer}
                  rowKey={(row) => row.customerName}
                  emptyState={<EmptyState title="Nothing invoiced" body="No invoice was issued in this period." />}
                  columns={[
                    { key: "customer", header: "Customer", render: (row) => row.customerName },
                    { key: "count", header: "Invoices", className: "text-right rts-mono", render: (row) => row.invoiceCount },
                    { key: "invoiced", header: "Invoiced", className: "text-right rts-mono", render: (row) => money(currency, row.invoiced) },
                    { key: "owed", header: "Owed", className: "text-right rts-mono", render: (row) => money(currency, row.outstanding) },
                  ]}
                />
              </TableCard>

              <TableCard title="Spend by category" summary={`Cost lines recorded in the period, by the categories set in Settings. ${home.figures.expenseLineCount} line${home.figures.expenseLineCount === 1 ? "" : "s"}.`}>
                <DataTable
                  rows={home.byCategory}
                  rowKey={(row) => row.category}
                  emptyState={<EmptyState title="Nothing spent" body="No cost was recorded in this period." />}
                  columns={[
                    { key: "category", header: "Category", render: (row) => row.category },
                    { key: "lines", header: "Lines", className: "text-right rts-mono", render: (row) => row.lineCount },
                    { key: "amount", header: "Amount", className: "text-right rts-mono", render: (row) => money(currency, row.amount) },
                  ]}
                />
              </TableCard>
            </div>

            <p className="text-xs text-stone-500">
              Coverage: {home.coverage.invoicesInPeriod} invoices in the period
              {home.coverage.invoicesWithoutCustomer > 0 && `, ${home.coverage.invoicesWithoutCustomer} with no customer name`}
              {home.coverage.uncategorisedExpenseLines > 0 && `, ${home.coverage.uncategorisedExpenseLines} cost lines with no category`}. A hire that was
              completed but never invoiced is listed above rather than counted as revenue. A customer
              statement prints from **Statements**, one customer at a time.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
