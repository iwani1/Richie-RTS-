// Statements of account (FIN-02, D-90).
//
// Every other money screen answers "what is this document?". This one answers the question the office
// asks when it chases a debt, and which the system could not answer before: **what does this customer
// owe us, what has moved on their account, and how old is the debt?** It reads one customer's
// invoices, payments and credit notes together, for a period the operator chooses, and prints the
// result as the sheet a business sends.
//
// Two habits are deliberate:
//   * the arithmetic is `customerStatement()` — the screen formats, it does not add up, so the tiles,
//     the table and the printed sheet are the same three renderings of one calculation;
//   * nothing is explained by colour. Age is printed as a number of days and as a named band, and an
//     account in credit says so in words rather than showing a minus sign on its own.
import { useMemo, useState } from "react";
import {
  customerStatement,
  statementCsv,
  statementCustomers,
  type CustomerStatement,
  type StatementRowKind,
} from "../tms/customerStatement";
import { formatAmount } from "../tms/money";
import { csvFileName, downloadTextFile } from "../ui/download";
import { useTms } from "../tms/useTms";
import { PrintPreview, StatementSheet } from "./Documents";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SearchInput,
  Stat,
  TableCard,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";
import { KeylineList } from "../components/tms/KeylineList";

const money = (currency: string, amount: number) => `${currency} ${formatAmount(Math.abs(amount))}`;

const KIND_LABEL: Record<StatementRowKind, string> = {
  invoice: "Invoice",
  creditNote: "Credit note",
  payment: "Payment",
  refund: "Refund paid back",
};

const KIND_TONE: Record<StatementRowKind, "info" | "success" | "neutral" | "warning"> = {
  invoice: "info",
  creditNote: "neutral",
  payment: "success",
  refund: "warning",
};

/** The first day of the month `date` falls in: a statement is most often read month by month. */
function firstOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

export function StatementsPage() {
  const { db } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // Customers come from the invoices themselves: that is the only key the documents share, and a
  // customer who has been invoiced and fully paid still deserves a statement.
  const customers = useMemo(() => statementCustomers(db, to), [db, to]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return customers.filter((customer) => !needle || customer.name.toLowerCase().includes(needle));
  }, [customers, query]);

  const customerName = selected && customers.some((customer) => customer.name === selected) ? selected : null;
  const statement: CustomerStatement | null = customerName ? customerStatement(db, customerName, from, to) : null;
  const ready = statement !== null && statement.status === "ok";
  const currency = statement?.currencyCode ?? db.settings.currencyCode ?? "";

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Statements"
        description="One customer's whole account: what was charged, what came in, what was credited, and how old the money still owed is."
        actions={
          <>
            {/* The sheet is what a customer receives; the CSV is the same rows for whoever
                reconciles the account in a spreadsheet (D-113). */}
            <Button
              onClick={() => {
                if (!statement) return;
                const slug = statement.customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                downloadTextFile(csvFileName(`statement-${slug}`, statement.from, statement.to), statementCsv(statement));
              }}
              disabled={!ready}
            >
              Download CSV
            </Button>
            <Button variant="primary" onClick={() => setPrinting(true)} disabled={!ready}>
              Print statement
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-md">
        <Field label="From" hint="Balance brought forward is taken from the day before">
          <TextInput type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="As at" hint={`Ages are measured to ${formatDate(to)}`}>
          <TextInput type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <TableCard
          title="Customers"
          summary={
            customers.length === 0
              ? "No customer has been invoiced yet"
              : `${visible.length} of ${customers.length} with invoices, largest balance first`
          }
          toolbar={
            <SearchInput
              placeholder="Find a customer"
              aria-label="Find a customer"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          }
        >
          <DataTable
            rows={visible}
            rowKey={(customer) => customer.name}
            emptyState={
              <EmptyState
                title={customers.length === 0 ? "Nothing to state yet" : "No customer matches"}
                body={
                  customers.length === 0
                    ? "An invoice has to be issued before a customer has an account to state."
                    : "Clear the search to see every customer with an invoice."
                }
              />
            }
            columns={[
              {
                key: "customer",
                header: "Customer",
                render: (customer) => (
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => setSelected(customer.name)}
                        aria-pressed={customer.name === customerName}
                      >
                        {customer.name}
                      </button>
                      {/* Which customer is on screen is said in words as well as by the panel beside
                          it, so it does not depend on noticing a colour change. */}
                      {customer.name === customerName && <Badge tone="info">Showing</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {customer.invoiceCount} invoice{customer.invoiceCount === 1 ? "" : "s"}
                      {customer.oldestDaysOverdue > 0 ? ` · ${customer.oldestDaysOverdue} days late` : " · up to date"}
                    </span>
                  </span>
                ),
              },
              {
                key: "owed",
                header: "Owed",
                className: "text-right tms-num",
                render: (customer) =>
                  customer.currencyCode ? (
                    <span className={customer.outstanding > 0 ? "font-medium" : "text-muted-foreground"}>
                      {money(customer.currencyCode, customer.outstanding)}
                    </span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        </TableCard>

        <div>
          {!statement && (
            <TableCard title="Statement" summary="Choose a customer on the left">
              <EmptyState
                title="No customer chosen"
                body="Pick a customer to see their account, or print it once it is on screen. The statement covers the period above, and carries in anything owed from before it."
              />
            </TableCard>
          )}

          {statement && !ready && (
            <TableCard title="Statement" summary={statement.customerName}>
              <Notice tone="warning" title="This account cannot be stated">
                {statement.message}
              </Notice>
            </TableCard>
          )}

          {statement && ready && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Stat label="Brought forward" value={money(currency, statement.openingBalance)} caption={`as at ${formatDate(from)}`} />
                <Stat label="Invoiced" value={money(currency, statement.invoiced)} caption="in the period" />
                <Stat label="Received" value={money(currency, statement.received)} caption="payments that count" />
                <Stat label="Credited" value={money(currency, statement.credited)} caption="credit notes issued" />
                <Stat label="Refunded" value={money(currency, statement.refunded)} caption="paid back in the period" />
                <Stat
                  label={statement.closingBalance < 0 ? "In credit" : "Balance due"}
                  value={money(currency, statement.closingBalance)}
                  caption={`as at ${formatDate(to)}`}
                />
              </div>

              <Notice tone={statement.closingBalance < 0 ? "warning" : "info"} className="mb-4">
                {statement.message}
              </Notice>

              <div className="grid gap-4">
                <TableCard title="What moved" summary={`${statement.rows.length} entr${statement.rows.length === 1 ? "y" : "ies"} in the period`}>
                  <DataTable
                    rows={statement.rows}
                    rowKey={(row) => `${row.kind}-${row.id}`}
                    emptyState={
                      <EmptyState
                        title="Nothing moved"
                        body="No invoice, payment or credit note falls in this period. The balance is carried through unchanged."
                      />
                    }
                    columns={[
                      { key: "date", header: "Date", render: (row) => formatDate(row.date) },
                      {
                        key: "kind",
                        header: "What",
                        render: (row) => (
                          <span className="flex flex-col">
                            <span className="flex items-center gap-2">
                              <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
                              <span className="tms-num text-xs">{row.reference}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">{row.description}</span>
                          </span>
                        ),
                      },
                      {
                        key: "charged",
                        header: "Charged",
                        className: "text-right tms-num",
                        render: (row) => (row.debit > 0 ? money(currency, row.debit) : "—"),
                      },
                      {
                        key: "paid",
                        header: "Paid or credited",
                        className: "text-right tms-num",
                        render: (row) => (row.credit > 0 ? money(currency, row.credit) : "—"),
                      },
                      {
                        key: "balance",
                        header: "Balance",
                        className: "text-right tms-num",
                        render: (row) => money(currency, row.balance),
                      },
                    ]}
                  />
                </TableCard>

                <div className="grid gap-4 lg:grid-cols-2">
                  <TableCard
                    title="How old the money is"
                    summary={statement.ageing.total > 0 ? `${money(currency, statement.ageing.total)} still owed` : "Nothing is owed"}
                  >
                    <KeylineList
                      rows={(
                        [
                          ["Not yet due", statement.ageing.notYetDue, "within the payment terms"],
                          ["1–30 days late", statement.ageing.days1to30, "worth a reminder"],
                          ["31–60 days late", statement.ageing.days31to60, "worth a call"],
                          ["Over 60 days late", statement.ageing.days61plus, "decide what to do"],
                        ] as const
                      ).map(([label, amount, hint]) => ({
                        key: label,
                        label,
                        hint,
                        value: amount > 0 ? money(currency, amount) : "—",
                      }))}
                    />
                  </TableCard>

                  <TableCard
                    title="Invoices still owing"
                    summary={`${statement.openInvoices.length} open`}
                  >
                    <DataTable
                      rows={statement.openInvoices}
                      rowKey={(row) => row.invoiceId}
                      emptyState={<EmptyState title="Nothing outstanding" body="Every invoice on this account is settled." />}
                      columns={[
                        { key: "ref", header: "Invoice", render: (row) => <span className="tms-num text-xs">{row.reference}</span> },
                        { key: "due", header: "Due", render: (row) => formatDate(row.dueOn) },
                        {
                          key: "late",
                          header: "Late",
                          render: (row) => (row.daysOverdue > 0 ? `${row.daysOverdue} days` : "Not yet due"),
                        },
                        { key: "amount", header: "Outstanding", className: "text-right tms-num", render: (row) => money(currency, row.outstanding) },
                      ]}
                    />
                  </TableCard>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {printing && statement && ready && (
        <PrintPreview label={`Statement for ${statement.customerName}`} onClose={() => setPrinting(false)}>
          <StatementSheet statement={statement} />
        </PrintPreview>
      )}
    </div>
  );
}
