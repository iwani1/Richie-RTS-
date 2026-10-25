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
            <Stat label="Invoiced" value={money(currency, home.figures.invoicedTotal)} caption={`${home.figures.invoiceCount} invoices issued in the period`} />
            <Stat label="Received" value={money(currency, home.figures.receivedTotal)} caption={`${home.figures.paymentCount} payments recorded in the period`} />
            <Stat label="Costs recorded" value={money(currency, home.figures.expensesTotal)} caption={`${home.figures.expenseLineCount} cost lines in the period`} />
            <Stat
              label="Margin"
              value={home.margin.available ? money(currency, home.margin.amount ?? 0) : "Not available"}
              caption={
                home.margin.available
                  ? `Hires billed less costs recorded${home.margin.percent === null ? "" : ` — ${(home.margin.percent * 100).toFixed(1)}% of revenue`}`
                  : home.margin.reason
              }
            />
            <Stat
              label="Cash movement"
              value={home.movement ? money(currency, home.movement.difference) : "Not available"}
              caption="Recorded payments in minus recorded spend — cash, not profit: what is owed and what is held are not in it"
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
              completed but never invoiced is listed above rather than counted as revenue. PDF statements are not built yet.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
