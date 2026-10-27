// Invoices and payments (FIN-02, FIN-03).
//
// The list is the money the business is owed: what was billed, what came in, what was credited back
// and what is still open. An invoice is raised from a completed rental rather than typed here, so the
// amounts on the screen always trace back to a priced quotation and a completion record. Nothing on
// this screen edits an issued invoice: it can be paid, verified or voided, and the void path is
// refused once money has been recorded against it.
//
// When an invoice is wrong after it has gone out — an overcharge, a service not delivered, a goodwill
// discount agreed late — the correction is a credit note (D-86), opened from the invoice itself. It is
// its own numbered document, it does not touch the payment rows, and every balance on this screen is
// worked out by the one shared helper in creditNotes.ts so the tiles, the rows and the reports agree.
import { useMemo, useState, type FormEvent } from "react";
import { invoiceBalance, isLivePayment, type InvoiceBalance } from "../tms/creditNotes";
import { formatAmount, fromMinor, lineAmount, linesTotal, parseAmount, percentOfMinor, toMinor } from "../tms/money";
import type { CommandResult } from "../tms/service";
import type { CreditNote, Invoice, InvoiceStatus, Payment, PaymentStatus, Refund } from "../tms/types";
import { CREDIT_NOTE_STATUS_LABELS, INVOICE_STATUS_LABELS, PAYMENT_STATUS_LABELS, REFUND_STATUS_LABELS } from "../tms/types";
import { useTms } from "../tms/useTms";
import { CreditNoteSheet, InvoiceSheet, PrintPreview } from "./Documents";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  Stat,
  TableCard,
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";
import { CopyButton } from "../ui/CopyButton";

const STATUS_TONE: Record<InvoiceStatus, "success" | "warning" | "error" | "neutral" | "info"> = {
  issued: "info",
  part_paid: "warning",
  paid: "success",
  void: "neutral",
};

// Displayed and previewed with the same arithmetic the server will use, so the figure on screen
// is the figure on the document (audit D-04).
const money = (currency: string, amount: number) => `${currency} ${formatAmount(amount)}`;

/**
 * How "received" is described when some payments have been cancelled (D-88).
 *
 * The figure beside this caption counts only the payments that still stand, so the caption has to
 * say so: "2 payments recorded" next to a total from one payment is the kind of sentence that erodes
 * trust in every other number on the page.
 */
function paymentsCaption(recorded: number, live: number): string {
  const plural = (count: number) => `${count} payment${count === 1 ? "" : "s"}`;
  if (recorded === live) return `${plural(recorded)} recorded`;
  return `${plural(live)} counting of ${recorded} recorded · ${recorded - live} cancelled`;
}

type CommandNotify = ReturnType<typeof useTms>["setFlash"];

type StatusFilter = "all" | InvoiceStatus;

export function InvoicesPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const today = todayYmd();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  // Every balance on this screen comes from the shared helper, so a credit note cannot make the
  // tiles, the rows and the invoice's own page tell three different stories (D-86). It is worked out
  // once per snapshot rather than per row, and in whole pesewas (audit D-04).
  const balances = useMemo(() => {
    const byInvoice = new Map<string, InvoiceBalance>();
    for (const invoice of db.invoices) byInvoice.set(invoice.id, invoiceBalance(db, invoice));
    return byInvoice;
  }, [db]);
  const balanceOf = (invoice: Invoice) => balances.get(invoice.id) ?? invoiceBalance(db, invoice);
  const live = db.invoices.filter((invoice) => invoice.status !== "void");

  // KPI totals are added in whole pesewas (money.ts). Summed as floats, "billed less received and
  // credited" can sit a pesewa away from the invoices it is made of, and the operator sees a balance
  // that is not owed (audit D-04).
  const totals = useMemo(() => {
    const open = db.invoices.filter((invoice) => invoice.status !== "void");
    const minor = { billed: 0, received: 0, credited: 0, outstanding: 0, overdue: 0, refundsDue: 0 };
    for (const invoice of open) {
      // `balances` is built from the same snapshot, so every live invoice has an entry here.
      const balance = balances.get(invoice.id);
      if (!balance) continue;
      minor.billed += toMinor(balance.total);
      minor.received += toMinor(balance.paid);
      minor.credited += toMinor(balance.credited);
      minor.outstanding += toMinor(balance.outstanding);
      minor.refundsDue += toMinor(balance.refundDue);
      if (invoice.dueOn < today) minor.overdue += toMinor(balance.outstanding);
    }
    // Converting back once keeps every total an exact multiple of a pesewa (audit D-04).
    return {
      billed: fromMinor(minor.billed),
      received: fromMinor(minor.received),
      credited: fromMinor(minor.credited),
      outstanding: fromMinor(minor.outstanding),
      overdue: fromMinor(minor.overdue),
      refundsDue: fromMinor(minor.refundsDue),
    };
  }, [db.invoices, balances, today]);

  const currency = db.settings.currencyCode ?? live[0]?.currencyCode ?? "";

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.invoices
      .filter((invoice) => statusFilter === "all" || invoice.status === statusFilter)
      .filter((invoice) => !q || `${invoice.reference} ${invoice.customerName} ${invoice.rentalId ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.reference.localeCompare(a.reference));
  }, [db.invoices, query, statusFilter]);

  // Rentals that can be billed: completed, with a final invoice, and not already invoiced.
  const billable = db.rentals.filter(
    (rental) =>
      rental.finalInvoice !== null &&
      !db.invoices.some((invoice) => invoice.billableEvent === `rental:${rental.id}:final` && invoice.status !== "void"),
  );

  const selected = selectedId ? db.invoices.find((invoice) => invoice.id === selectedId) ?? null : null;
  const settingsBlocked =
    db.settings.taxPosition === null || db.settings.invoiceDueDays === null || !db.settings.currencyCode;

  if (selected) return <InvoiceDetail invoice={selected} onBack={() => setSelectedId(null)} />;

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Invoices & payments"
        description="Invoices raised from completed rentals, the money received against them, and the credit notes that take money back off them. An issued invoice is never edited: it is paid, credited or voided."
        actions={
          allowed("invoices:issue") ? (
            <Button variant="primary" disabled={billable.length === 0} title={billable.length === 0 ? "Complete a rental first" : undefined} onClick={() => setIssuing(true)}>
              Issue an invoice
            </Button>
          ) : undefined
        }
      />

      {settingsBlocked && (
        <Notice tone="warning" title="Invoicing is not configured" className="mb-4">
          {db.settings.taxPosition === null && "Set the company tax position in Settings. "}
          {db.settings.invoiceDueDays === null && "Set the payment terms in days in Settings. "}
          {!db.settings.currencyCode && "Set the company currency in Settings. "}
          Until then an invoice cannot be issued, because a legal document cannot be issued with a guess on it.
        </Notice>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Billed" value={money(currency, totals.billed)} caption={`${live.length} live invoice${live.length === 1 ? "" : "s"}`} />
        <Stat label="Received" value={money(currency, totals.received)} caption="recorded payments" />
        <Stat
          label="Credited"
          value={money(currency, totals.credited)}
          caption={db.creditNotes.filter((note) => note.status === "issued").length === 1 ? "1 credit note issued" : `${db.creditNotes.filter((note) => note.status === "issued").length} credit notes issued`}
        />
        <Stat label="Outstanding" value={money(currency, totals.outstanding)} caption="billed less received and credited" />
        <Stat label="Overdue" value={money(currency, totals.overdue)} caption={`due before ${formatDate(today)}`} />
        {totals.refundsDue > 0 && (
          <Stat
            label="Refunds due"
            value={money(currency, totals.refundsDue)}
            caption="credited below what the customer already paid"
          />
        )}
      </div>

      {db.invoices.length === 0 && billable.length === 0 && (
        <Notice tone="info" className="mb-4">
          Nothing to invoice yet. Complete a rental in Bus rentals; the final line items recorded there become the invoice.
        </Notice>
      )}

      <TableCard
        title="Invoices"
        summary={`${rows.length} of ${db.invoices.length} shown`}
        toolbar={
          <>
            <SearchInput placeholder="Search reference, customer" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search invoices" />
            <Select className="max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(["issued", "part_paid", "paid", "void"] as InvoiceStatus[]).map((status) => (
                <option key={status} value={status}>
                  {INVOICE_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <p className="rts-filter-bar-note" role="status">
              {live.filter((invoice) => balanceOf(invoice).outstanding > 0).length} open · {billable.length} waiting to be invoiced
            </p>
          </>
        }
      >
        <DataTable
          rows={rows}
          rowKey={(invoice) => invoice.id}
          emptyState={<EmptyState title={db.invoices.length ? "No invoices match" : "No invoices yet"} body="Issue one from a completed rental to start the payment record." />}
          columns={[
            { key: "ref", header: "Invoice", render: (invoice) => <span className="rts-mono text-xs font-semibold">{invoice.reference}</span> },
            { key: "customer", header: "Customer", render: (invoice) => <span className="font-medium">{invoice.customerName}</span> },
            { key: "issued", header: "Issued", render: (invoice) => formatDate(invoice.issuedOn) },
            { key: "due", header: "Due", render: (invoice) => formatDate(invoice.dueOn) },
            { key: "total", header: "Total", className: "text-right rts-mono", render: (invoice) => money(invoice.currencyCode, invoice.total) },
            {
              key: "credited",
              header: "Credited",
              className: "text-right rts-mono",
              // A dash rather than 0.00: nothing was taken off this invoice, and a column of zeroes
              // reads as though something happened.
              render: (invoice) => {
                const credited = balanceOf(invoice).credited;
                return credited > 0 ? money(invoice.currencyCode, credited) : <span className="text-stone-400">-</span>;
              },
            },
            { key: "paid", header: "Paid", className: "text-right rts-mono", render: (invoice) => money(invoice.currencyCode, balanceOf(invoice).paid) },
            {
              key: "outstanding",
              header: "Outstanding",
              className: "text-right rts-mono",
              render: (invoice) => {
                if (invoice.status === "void") return <span className="text-stone-400">-</span>;
                const balance = balanceOf(invoice);
                // Money owed back is stated on the row, not turned into a zero balance: the office has
                // a refund to make, and a dash here would hide it (D-86).
                if (balance.refundDue > 0) return <span className="text-amber-800">{money(invoice.currencyCode, balance.refundDue)} back</span>;
                return money(invoice.currencyCode, balance.outstanding);
              },
            },
            {
              key: "status",
              header: "Status",
              render: (invoice) => (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge tone={STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
                  {invoice.status !== "void" && balanceOf(invoice).settled && balanceOf(invoice).credited > 0 && <Badge tone="success">Settled by credit</Badge>}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (invoice) => (
                <Button variant="ghost" onClick={() => setSelectedId(invoice.id)} aria-label={`Open ${invoice.reference}`}>
                  Open
                </Button>
              ),
            },
          ]}
        />
      </TableCard>

      {issuing && (
        <IssueInvoiceForm
          onClosed={() => setIssuing(false)}
          onSubmit={async (input) => dispatch({ type: "issue_rental_invoice", input })}
          notify={setFlash}
        />
      )}
    </div>
  );
}

function IssueInvoiceForm({
  onSubmit,
  notify,
  onClosed,
}: {
  onClosed: () => void;
  onSubmit: (input: { rentalId: string; issuedOn: string; discountAmount: string; discountReason: string; notes: string }) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const { db } = useTms();
  const today = todayYmd();
  const billable = db.rentals.filter(
    (rental) =>
      rental.finalInvoice !== null &&
      !db.invoices.some((invoice) => invoice.billableEvent === `rental:${rental.id}:final` && invoice.status !== "void"),
  );
  const [values, setValues] = useState({
    rentalId: billable[0]?.id ?? "",
    issuedOn: today,
    discountAmount: "",
    discountReason: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rental = billable.find((candidate) => candidate.id === values.rentalId);
  // The preview the operator reads before pressing Issue: the same rounding the invoice will apply.
  const subtotal = rental?.finalInvoice ? linesTotal(rental.finalInvoice.lines) : 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(values);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title="Issue an invoice"
      description="Billed amounts come from the completed rental's final invoice. Tax lines and the due date come from Settings and are fixed on the document."
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Rental" error={errors.rentalId}>
          <Select value={values.rentalId} onChange={(e) => setValues({ ...values, rentalId: e.target.value })} invalid={!!errors.rentalId}>
            <option value="">Select a completed rental</option>
            {billable.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.reference} · {candidate.customerName}
              </option>
            ))}
          </Select>
        </Field>
        {rental?.finalInvoice && (
          <div className="rts-summary">
            <p className="text-xs text-stone-600">Pre-tax amount from completion: {money(rental.finalInvoice.currencyCode, subtotal)}</p>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              {rental.finalInvoice.lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span>
                    {line.description} × {line.quantity}
                  </span>
                  <span className="rts-mono">{money(rental.finalInvoice!.currencyCode, lineAmount(line.quantity, line.unitAmount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice date" error={errors.issuedOn}>
            <TextInput type="date" value={values.issuedOn} max={today} onChange={(e) => setValues({ ...values, issuedOn: e.target.value })} invalid={!!errors.issuedOn} />
          </Field>
          <Field label="Discount (optional)" hint={db.settings.currencyCode ? `In ${db.settings.currencyCode}` : "Set the currency in Settings"} error={errors.discountAmount}>
            <TextInput inputMode="decimal" value={values.discountAmount} onChange={(e) => setValues({ ...values, discountAmount: e.target.value })} invalid={!!errors.discountAmount} />
          </Field>
        </div>
        {values.discountAmount.trim() !== "" && (
          <Field label="Reason for the discount" error={errors.discountReason}>
            <TextInput value={values.discountReason} onChange={(e) => setValues({ ...values, discountReason: e.target.value })} invalid={!!errors.discountReason} />
          </Field>
        )}
        <Field label="Note on the invoice (optional)" error={errors.notes}>
          <TextArea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} invalid={!!errors.notes} />
        </Field>
        {errors.taxPosition && <Notice tone="warning">{errors.taxPosition}</Notice>}
        {errors.invoiceDueDays && <Notice tone="warning">{errors.invoiceDueDays}</Notice>}
        {errors.currencyCode && <Notice tone="warning">{errors.currencyCode}</Notice>}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Issue invoice
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function InvoiceDetail({ invoice, onBack }: { invoice: Invoice; onBack: () => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [voidingCredit, setVoidingCredit] = useState<CreditNote | null>(null);
  // The payment being cancelled, with the reason typed into the panel (D-88).
  const [cancellingPayment, setCancellingPayment] = useState<Payment | null>(null);
  // Money going back out: the refund form, and the refund being cancelled (D-92).
  const [refunding, setRefunding] = useState(false);
  const [cancellingRefund, setCancellingRefund] = useState<Refund | null>(null);
  // Which document is open in the print preview: this invoice, or one of its credit notes (D-87).
  const [printing, setPrinting] = useState<{ kind: "invoice" } | { kind: "creditNote"; note: CreditNote } | null>(null);
  const payments = db.payments.filter((payment) => payment.invoiceId === invoice.id);
  // A cancelled payment is shown, struck out of the figure, and still listed: the record is the
  // reason the invoice is owed again, so hiding it would leave the operator with an unexplained
  // balance (D-88).
  const livePaymentsForInvoice = payments.filter(isLivePayment);
  const credits = db.creditNotes.filter((note) => note.invoiceId === invoice.id);
  // A cancelled refund is still listed: the number was issued and the office decided not to pay it,
  // which is a fact the next reader needs (D-92).
  const refunds = db.refunds.filter((refund) => refund.invoiceId === invoice.id);
  const balance = invoiceBalance(db, invoice);
  const outstanding = balance.outstanding;
  const rental = db.rentals.find((candidate) => candidate.id === invoice.rentalId) ?? null;
  // Room left for another credit note: the invoice's own total, less what has already been credited.
  const creditRoom = Math.max(invoice.total - balance.credited, 0);

  const advance = async (payment: Payment, to: PaymentStatus) => {
    const result = await dispatch({ type: "advance_payment", id: payment.id, to });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
  };

  const cancelPayment = async (payment: Payment, reason: string) => {
    const result = await dispatch({ type: "void_payment", id: payment.id, reason });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setCancellingPayment(null);
    return result;
  };

  const cancelRefund = async (refund: Refund, reason: string) => {
    const result = await dispatch({ type: "void_refund", id: refund.id, reason });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setCancellingRefund(null);
    return result;
  };

  const voidCredit = async (note: CreditNote, reason: string) => {
    const result = await dispatch({ type: "void_credit_note", id: note.id, reason });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setVoidingCredit(null);
    return result;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title={invoice.reference}
        description={`${invoice.customerName}${rental ? ` · ${rental.reference}` : ""} · issued ${formatDate(invoice.issuedOn)} · due ${formatDate(invoice.dueOn)}`}
        actions={
          <>
            <Button onClick={onBack}>Back to invoices</Button>
            <CopyButton value={invoice.reference} what="invoice number" />
            <Button onClick={() => setPrinting({ kind: "invoice" })}>Print invoice</Button>
            {allowed("payments:record") && invoice.status !== "void" && outstanding > 0 && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Record a payment
              </Button>
            )}
            {allowed("refunds:record") && invoice.status !== "void" && toMinor(balance.refundDue) > 0 && (
              <Button onClick={() => setRefunding(true)}>Pay a refund</Button>
            )}
            {allowed("credits:issue") && invoice.status !== "void" && toMinor(creditRoom) > 0 && (
              <Button onClick={() => setCrediting(true)}>Credit the invoice</Button>
            )}
            {allowed("invoices:void") && invoice.status !== "void" && livePaymentsForInvoice.length === 0 && credits.length === 0 && (
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Void invoice
              </Button>
            )}
          </>
        }
      />

      {invoice.status === "void" && (
        <Notice tone="warning" title="This invoice is void" className="mb-4">
          {invoice.voidReason ?? "No reason recorded."} A voided invoice keeps its number; a corrected invoice gets the next one.
        </Notice>
      )}
      {invoice.status !== "void" && (
        <Notice tone="info" className="mb-4">
          {money(invoice.currencyCode, balance.paid)} received
          {balance.credited > 0 && <> and {money(invoice.currencyCode, balance.credited)} credited back</>};{" "}
          {money(invoice.currencyCode, outstanding)} still outstanding. This invoice cannot be edited, and cannot be voided while a payment still
          counts against it: a payment recorded in error is cancelled with a reason, and a correction to the bill is a credit note. Both keep
          their own number and leave the other record untouched.
        </Notice>
      )}
      {balance.refundDue > 0 && (
        <Notice tone="warning" title="A refund is due" className="mb-4">
          Credit notes have taken this invoice below what the customer paid, so {money(invoice.currencyCode, balance.refundDue)} is owed back. A credit note never moves money: record the
          refund here when the money actually leaves, so the date, the method and the reason are on the account rather than only in the bank statement.
        </Notice>
      )}
      {balance.refundDue === 0 && balance.refunded > 0 && (
        <Notice tone="info" title="The refund has been paid" className="mb-4">
          {money(invoice.currencyCode, balance.refunded)} has been paid back to the customer, so nothing further is owed back on this invoice. Refunds never change what was received: they are
          listed below with their own numbers.
        </Notice>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Subtotal" value={money(invoice.currencyCode, invoice.subtotal)} caption="before tax" />
        <Stat label="Tax" value={money(invoice.currencyCode, invoice.total - invoice.subtotal)} caption={invoice.taxLines.length ? invoice.taxLines.map((line) => `${line.name} ${line.ratePercent}%`).join(" · ") : "not registered"} />
        <Stat label="Total" value={money(invoice.currencyCode, invoice.total)} caption={INVOICE_STATUS_LABELS[invoice.status]} />
        <Stat
          label="Received"
          value={money(invoice.currencyCode, balance.paid)}
          caption={paymentsCaption(payments.length, livePaymentsForInvoice.length)}
        />
        <Stat
          label="Credited"
          value={money(invoice.currencyCode, balance.credited)}
          caption={`${credits.filter((note) => note.status === "issued").length} credit note${credits.filter((note) => note.status === "issued").length === 1 ? "" : "s"} issued`}
        />
        <Stat label="Outstanding" value={money(invoice.currencyCode, outstanding)} caption="total less received and credited" />
        <Stat
          label="Refunded"
          value={money(invoice.currencyCode, balance.refunded)}
          caption={balance.refundDue > 0 ? `${money(invoice.currencyCode, balance.refundDue)} still to pay back` : "nothing owed back"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard title="Line items" summary={`${invoice.lines.length} on the document`}>
          <DataTable
            rows={invoice.lines}
            rowKey={(line) => line.id}
            emptyState={<EmptyState title="No lines" body="This invoice has no line items." />}
            columns={[
              { key: "description", header: "Description", render: (line) => line.description },
              { key: "quantity", header: "Qty", className: "text-right rts-mono", render: (line) => line.quantity },
              { key: "unit", header: "Unit", className: "text-right rts-mono", render: (line) => money(invoice.currencyCode, line.unitAmount) },
              { key: "amount", header: "Amount", className: "text-right rts-mono", render: (line) => money(invoice.currencyCode, lineAmount(line.quantity, line.unitAmount)) },
            ]}
          />
          {invoice.taxLines.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-stone-600">
              {invoice.taxLines.map((line) => (
                <li key={line.name} className="flex justify-between gap-3">
                  <span>
                    {line.name} at {line.ratePercent}%
                  </span>
                  <span className="rts-mono">{money(invoice.currencyCode, line.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </TableCard>

        <TableCard title="Payments" summary={`${money(invoice.currencyCode, balance.paid)} received`}>
          <DataTable
            rows={payments}
            rowKey={(payment) => payment.id}
            emptyState={<EmptyState title="No payments yet" body="Payments recorded against this invoice appear here." />}
            columns={[
              { key: "ref", header: "Payment", render: (payment) => <span className="rts-mono text-xs">{payment.reference}</span> },
              { key: "date", header: "Received", render: (payment) => formatDate(payment.paidOn) },
              { key: "method", header: "Method", render: (payment) => payment.method },
              {
                key: "amount",
                header: "Amount",
                className: "text-right rts-mono",
                render: (payment) => (
                  <span className={payment.voidedAt ? "text-stone-500 line-through" : undefined}>{money(payment.currencyCode, payment.amount)}</span>
                ),
              },
              {
                key: "status",
                header: "Status",
                // A cancelled payment says so in words, not only in colour: the badge carries the
                // meaning and the struck-through amount carries it a second time (D-88).
                render: (payment) =>
                  payment.voidedAt ? (
                    <Badge tone="neutral">Cancelled</Badge>
                  ) : (
                    <Badge tone={payment.status === "reconciled" ? "success" : "info"}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                  ),
              },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (payment) =>
                  payment.voidedAt ? null : (
                    <span className="inline-flex gap-1">
                      {allowed("payments:advance") && payment.status !== "reconciled" && (
                        <Button variant="ghost" onClick={() => advance(payment, payment.status === "recorded" ? "verified" : "reconciled")}>
                          {payment.status === "recorded" ? "Verify" : "Reconcile"}
                        </Button>
                      )}
                      {allowed("payments:void") && (
                        <Button
                          variant="ghost"
                          onClick={() => setCancellingPayment(payment)}
                          aria-label={`Cancel ${payment.reference}`}
                        >
                          Cancel
                        </Button>
                      )}
                    </span>
                  ),
              },
            ]}
          />
          {payments.some((payment) => payment.voidedAt) && (
            <ul className="mt-3 space-y-1 text-xs text-stone-600">
              {payments
                .filter((payment) => payment.voidedAt)
                .map((payment) => (
                  <li key={payment.id}>
                    <span className="rts-mono">{payment.reference}</span> cancelled: {payment.voidReason ?? "no reason recorded"} — it no longer counts
                    towards what was received.
                  </li>
                ))}
            </ul>
          )}
          {payments.some((payment) => payment.externalReference) && (
            <ul className="mt-3 space-y-1 text-xs text-stone-600">
              {payments
                .filter((payment) => payment.externalReference)
                .map((payment) => (
                  <li key={payment.id}>
                    <span className="rts-mono">{payment.reference}</span> external reference {payment.externalReference}
                  </li>
                ))}
            </ul>
          )}
        </TableCard>

        <TableCard
          title="Credit notes"
          summary={
            credits.length
              ? `${money(invoice.currencyCode, balance.credited)} credited · ${money(invoice.currencyCode, creditRoom)} left to credit, including tax`
              : "Nothing has been taken off this invoice"
          }
        >
          <DataTable
            rows={credits}
            rowKey={(note) => note.id}
            emptyState={<EmptyState title="No credit notes" body="Money taken back off this invoice appears here, with the reason recorded." />}
            columns={[
              { key: "ref", header: "Credit note", render: (note) => <span className="rts-mono text-xs">{note.reference}</span> },
              { key: "date", header: "Issued", render: (note) => formatDate(note.issuedOn) },
              {
                key: "reason",
                header: "What it is for",
                // Both are kept on the note and both matter: the line is what the document says, the
                // reason is why the office decided to give the money back.
                render: (note) => (
                  <span className="flex flex-col">
                    <span className="text-xs font-medium text-stone-800">{note.lines.map((line) => line.description).join(" · ")}</span>
                    <span className="text-xs text-stone-600">{note.reason}</span>
                  </span>
                ),
              },
              { key: "amount", header: "Amount", className: "text-right rts-mono", render: (note) => money(note.currencyCode, note.total) },
              { key: "status", header: "Status", render: (note) => <Badge tone={note.status === "void" ? "neutral" : "info"}>{CREDIT_NOTE_STATUS_LABELS[note.status]}</Badge> },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (note) => (
                  <span className="inline-flex gap-1">
                    <Button variant="ghost" onClick={() => setPrinting({ kind: "creditNote", note })} aria-label={`Print ${note.reference}`}>
                      Print
                    </Button>
                    {allowed("credits:void") && note.status === "issued" && (
                      <Button variant="ghost" onClick={() => setVoidingCredit(note)} aria-label={`Void ${note.reference}`}>
                        Void
                      </Button>
                    )}
                  </span>
                ),
              },
            ]}
          />
          {credits.some((note) => note.status === "void") && (
            <ul className="mt-3 space-y-1 text-xs text-stone-600">
              {credits
                .filter((note) => note.status === "void")
                .map((note) => (
                  <li key={note.id}>
                    <span className="rts-mono">{note.reference}</span> void: {note.voidReason ?? "no reason recorded"}
                  </li>
                ))}
            </ul>
          )}
        </TableCard>

        <TableCard
          title="Refunds paid back"
          summary={
            refunds.length
              ? `${money(invoice.currencyCode, balance.refunded)} paid back · ${money(invoice.currencyCode, balance.refundDue)} still owed back`
              : "Money returned to the customer appears here, with its own number"
          }
        >
          <DataTable
            rows={refunds}
            rowKey={(refund) => refund.id}
            emptyState={
              <EmptyState
                title="No refunds"
                body="A refund is recorded here when money actually leaves. A credit note only states that it is owed."
              />
            }
            columns={[
              { key: "ref", header: "Refund", render: (refund) => <span className="rts-mono text-xs">{refund.reference}</span> },
              { key: "date", header: "Paid back", render: (refund) => formatDate(refund.paidOn) },
              { key: "method", header: "How", render: (refund) => <span className="text-xs text-stone-700">{refund.method}</span> },
              {
                key: "reason",
                header: "Why",
                render: (refund) => (
                  <span className="flex flex-col">
                    <span className="text-xs text-stone-800">{refund.reason}</span>
                    {refund.voidReason && <span className="text-xs text-stone-600">Cancelled: {refund.voidReason}</span>}
                  </span>
                ),
              },
              { key: "amount", header: "Amount", className: "text-right rts-mono", render: (refund) => money(refund.currencyCode, refund.amount) },
              { key: "status", header: "Status", render: (refund) => <Badge tone={refund.status === "void" ? "neutral" : "info"}>{REFUND_STATUS_LABELS[refund.status]}</Badge> },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (refund) =>
                  allowed("refunds:void") && refund.status === "paid" ? (
                    <Button variant="ghost" onClick={() => setCancellingRefund(refund)} aria-label={`Cancel ${refund.reference}`}>
                      Cancel
                    </Button>
                  ) : null,
              },
            ]}
          />
        </TableCard>
      </div>

      {invoice.notes && (
        <p className="mt-4 text-sm text-stone-600">
          <span className="font-medium text-stone-800">Note on the invoice:</span> {invoice.notes}
        </p>
      )}

      {paying && (
        <RecordPaymentForm
          invoice={invoice}
          outstanding={outstanding}
          onClosed={() => setPaying(false)}
          onSubmit={async (input) => dispatch({ type: "record_payment", input })}
          notify={setFlash}
        />
      )}
      {crediting && (
        <CreditNoteForm
          invoice={invoice}
          room={creditRoom}
          onClosed={() => setCrediting(false)}
          onSubmit={async (input) => dispatch({ type: "issue_credit_note", input })}
          notify={setFlash}
        />
      )}
      {cancellingPayment && (
        <CancelPaymentForm
          payment={cancellingPayment}
          invoiceReference={invoice.reference}
          onClosed={() => setCancellingPayment(null)}
          onSubmit={(reason) => cancelPayment(cancellingPayment, reason)}
          notify={setFlash}
        />
      )}
      {refunding && (
        <RefundForm
          invoice={invoice}
          refundDue={balance.refundDue}
          onClosed={() => setRefunding(false)}
          onSubmit={async (input) => dispatch({ type: "record_refund", input })}
          notify={setFlash}
        />
      )}
      {cancellingRefund && (
        <CancelRefundForm
          refund={cancellingRefund}
          invoiceReference={invoice.reference}
          onClosed={() => setCancellingRefund(null)}
          onSubmit={(reason) => cancelRefund(cancellingRefund, reason)}
          notify={setFlash}
        />
      )}
      {voidingCredit && (
        <VoidCreditNoteForm
          note={voidingCredit}
          onClosed={() => setVoidingCredit(null)}
          onSubmit={(reason) => voidCredit(voidingCredit, reason)}
          notify={setFlash}
        />
      )}
      {printing && (
        <PrintPreview
          label={printing.kind === "invoice" ? `Invoice ${invoice.reference}` : `Credit note ${printing.note.reference}`}
          onClose={() => setPrinting(null)}
        >
          {printing.kind === "invoice" ? <InvoiceSheet invoice={invoice} /> : <CreditNoteSheet note={printing.note} />}
        </PrintPreview>
      )}
      {voiding && (
        <VoidInvoiceForm
          invoice={invoice}
          onClosed={() => setVoiding(false)}
          onSubmit={async (reason) => dispatch({ type: "void_invoice", id: invoice.id, reason })}
          notify={setFlash}
        />
      )}
    </div>
  );
}

function RecordPaymentForm({
  invoice,
  outstanding,
  onSubmit,
  notify,
  onClosed,
}: {
  invoice: Invoice;
  outstanding: number;
  onClosed: () => void;
  onSubmit: (input: { invoiceId: string; amount: string; method: string; paidOn: string; externalReference: string; note: string }) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const { db } = useTms();
  const today = todayYmd();
  const methods = db.settings.rental.paymentMethods;
  const [values, setValues] = useState({
    amount: outstanding.toFixed(2),
    method: methods[0] ?? "",
    paidOn: today,
    externalReference: "",
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit({ invoiceId: invoice.id, ...values });
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Record a payment against ${invoice.reference}`}
      description="A payment is written once. The external reference is the bank slip or mobile money transaction id: recording the same one twice adds nothing."
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        {methods.length === 0 && <Notice tone="warning">No payment methods are configured. Add them in Settings before recording money.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount received" error={errors.amount} hint={`Outstanding ${money(invoice.currencyCode, outstanding)}`}>
            <TextInput inputMode="decimal" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} invalid={!!errors.amount} />
          </Field>
          <Field label="Date received" error={errors.paidOn}>
            <TextInput type="date" value={values.paidOn} onChange={(e) => setValues({ ...values, paidOn: e.target.value })} invalid={!!errors.paidOn} />
          </Field>
        </div>
        <Field label="Method" error={errors.method}>
          <Select value={values.method} onChange={(e) => setValues({ ...values, method: e.target.value })} invalid={!!errors.method}>
            <option value="">Select a method</option>
            {methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="External reference (optional)" hint="Bank slip or mobile money transaction id" error={errors.externalReference}>
          <TextInput value={values.externalReference} onChange={(e) => setValues({ ...values, externalReference: e.target.value })} invalid={!!errors.externalReference} />
        </Field>
        <Field label="Note (optional)" error={errors.note}>
          <TextArea value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} invalid={!!errors.note} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Record payment
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function VoidInvoiceForm({
  invoice,
  onSubmit,
  notify,
  onClosed,
}: {
  invoice: Invoice;
  onClosed: () => void;
  onSubmit: (reason: string) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(reason);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel title={`Void ${invoice.reference}`} description="The invoice keeps its number and stays on record. A corrected invoice will take the next number." onClose={onClosed}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" error={errors.reason}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="danger">
            Void invoice
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Cancelling a payment recorded in error (FIN-03, D-88).
 *
 * The record keeps its number, stays in the list and stops counting towards what was received; the
 * invoice goes back to what it actually owed. A reason is required because a year later it is the
 * only thing that explains why a payment that is still on the page is not in the total.
 *
 * A reconciled payment may still be cancelled — otherwise a mis-click on "Reconcile" would lock the
 * figure for good — but the panel says out loud what it does to the reconciliation first.
 */
function CancelPaymentForm({
  payment,
  invoiceReference,
  onSubmit,
  notify,
  onClosed,
}: {
  payment: Payment;
  invoiceReference: string;
  onClosed: () => void;
  onSubmit: (reason: string) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(reason);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Cancel ${payment.reference}`}
      description={`${money(payment.currencyCode, payment.amount)} stops counting towards what was received on ${invoiceReference}, and the invoice goes back to what it actually owed. The payment keeps its number and stays on record with this reason.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        {payment.status === "reconciled" && (
          <Notice tone="warning" title="Already reconciled with the bank statement">
            This payment was matched to the bank statement. Cancelling it leaves that statement
            unmatched by {money(payment.currencyCode, payment.amount)}: check the bank before going
            ahead.
          </Notice>
        )}
        <Field label="Reason" hint="Kept on the record and in the audit trail" error={errors.reason}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Keep the payment</Button>
          <Button type="submit" variant="danger">
            Cancel payment
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Taking money off an invoice that has already gone out (FIN-02, D-86).
 *
 * The operator types what to credit **before tax**. The tax follows from the invoice's own tax lines,
 * so the credit reverses exactly the tax that was charged rather than today's rate, and the total is
 * previewed with the same arithmetic the service will use before the document is numbered.
 */
function CreditNoteForm({
  invoice,
  room,
  onSubmit,
  notify,
  onClosed,
}: {
  invoice: Invoice;
  /** What is left to credit, including tax. */
  room: number;
  onClosed: () => void;
  onSubmit: (input: { invoiceId: string; issuedOn: string; amount: string; description: string; reason: string }) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const today = todayYmd();
  const [values, setValues] = useState({
    issuedOn: today < invoice.issuedOn ? invoice.issuedOn : today,
    amount: "",
    description: "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parsed = parseAmount(values.amount);
  const subtotal = parsed.problem ? 0 : parsed.amount;
  const taxMinor = invoice.taxLines.reduce((sum, line) => sum + percentOfMinor(toMinor(subtotal), line.ratePercent), 0);
  const total = fromMinor(toMinor(subtotal) + taxMinor);
  const tooMuch = toMinor(total) > toMinor(room);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit({ invoiceId: invoice.id, ...values });
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Credit ${invoice.reference}`}
      description={`A credit note takes money off this invoice and keeps its own number. Payments already recorded are not changed. ${money(invoice.currencyCode, room)} is left to credit, including tax.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount to credit, before tax" hint={`In ${invoice.currencyCode}`} error={errors.amount}>
            <TextInput inputMode="decimal" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} invalid={!!errors.amount} />
          </Field>
          <Field label="Date of the credit note" error={errors.issuedOn}>
            <TextInput type="date" value={values.issuedOn} min={invoice.issuedOn} onChange={(e) => setValues({ ...values, issuedOn: e.target.value })} invalid={!!errors.issuedOn} />
          </Field>
        </div>
        <Field label="What it is for" hint="This line is printed on the credit note" error={errors.description}>
          <TextInput
            value={values.description}
            onChange={(e) => setValues({ ...values, description: e.target.value })}
            invalid={!!errors.description}
            placeholder="e.g. Airport transfer not operated on 4 June"
          />
        </Field>
        <Field label="Reason for the credit" hint="Kept on the record and in the audit trail" error={errors.reason}>
          <TextArea value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} invalid={!!errors.reason} />
        </Field>

        <div className="rts-summary">
          <p className="text-xs text-stone-600">Credit note total: {money(invoice.currencyCode, total)}</p>
          <ul className="mt-2 space-y-1 text-xs text-stone-600">
            <li className="flex justify-between gap-3">
              <span>Before tax</span>
              <span className="rts-mono">{money(invoice.currencyCode, subtotal)}</span>
            </li>
            {invoice.taxLines.map((line) => (
              <li key={line.name} className="flex justify-between gap-3">
                <span>
                  {line.name} at {line.ratePercent}% (the invoice&apos;s rate)
                </span>
                <span className="rts-mono">{money(invoice.currencyCode, fromMinor(percentOfMinor(toMinor(subtotal), line.ratePercent)))}</span>
              </li>
            ))}
          </ul>
          {invoice.taxLines.length === 0 && <p className="mt-2 text-xs text-stone-600">This invoice carried no tax, so neither does its credit note.</p>}
        </div>

        {tooMuch && (
          <Notice tone="warning">
            That is more than is left on this invoice. {money(invoice.currencyCode, room)} is the most that can still be credited, including tax.
          </Notice>
        )}
        {toMinor(room) <= 0 && <Notice tone="warning">This invoice has already been credited in full.</Notice>}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Issue credit note
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Voiding a credit note: the amount goes back onto the bill, and the note keeps its number. */
function VoidCreditNoteForm({
  note,
  onSubmit,
  notify,
  onClosed,
}: {
  note: CreditNote;
  onClosed: () => void;
  onSubmit: (reason: string) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(reason);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Void ${note.reference}`}
      description={`${money(note.currencyCode, note.total)} goes back onto ${note.invoiceReference}. The note keeps its number and stays on record; issue a new credit note instead of editing this one.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" error={errors.reason}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="danger">
            Void credit note
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Recording money going back to a customer (FIN-03, D-92).
 *
 * The mirror of the payment form, with one difference that matters: the reason is required. A payment
 * explains itself with a bank slip; a refund does not, and "why did we send this customer money" is the
 * question asked a year later.
 */
function RefundForm({
  invoice,
  refundDue,
  onSubmit,
  notify,
  onClosed,
}: {
  invoice: Invoice;
  refundDue: number;
  onClosed: () => void;
  onSubmit: (input: { invoiceId: string; amount: string; method: string; paidOn: string; externalReference: string; reason: string }) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const { db } = useTms();
  const today = todayYmd();
  const methods = db.settings.rental.paymentMethods;
  const [values, setValues] = useState({
    amount: refundDue.toFixed(2),
    method: methods[0] ?? "",
    paidOn: today,
    externalReference: "",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit({ invoiceId: invoice.id, ...values });
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Pay a refund against ${invoice.reference}`}
      description="This records money leaving the business. It does not change what the customer has paid — the credit note already reduced the bill — and the amount cannot exceed what is still owed back."
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        {methods.length === 0 && <Notice tone="warning">No payment methods are configured. Add them in Settings before recording a refund.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Amount paid back" error={errors.amount} hint={`Owed back ${money(invoice.currencyCode, refundDue)}`}>
            <TextInput inputMode="decimal" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} invalid={!!errors.amount} />
          </Field>
          <Field label="Date paid back" error={errors.paidOn}>
            <TextInput type="date" value={values.paidOn} onChange={(e) => setValues({ ...values, paidOn: e.target.value })} invalid={!!errors.paidOn} />
          </Field>
        </div>
        <Field label="How the money went back" error={errors.method}>
          <Select value={values.method} onChange={(e) => setValues({ ...values, method: e.target.value })} invalid={!!errors.method}>
            <option value="">Select a method</option>
            {methods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference (optional)" hint="Transfer id or receipt number, if the bank gave one" error={errors.externalReference}>
          <TextInput value={values.externalReference} onChange={(e) => setValues({ ...values, externalReference: e.target.value })} invalid={!!errors.externalReference} />
        </Field>
        <Field label="Why the money was paid back" error={errors.reason} hint="Kept on the record: a refund with no explanation cannot be audited">
          <TextInput value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Record the refund
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Cancelling a refund that never left the bank (D-92). The amount goes back to being owed. */
function CancelRefundForm({
  refund,
  invoiceReference,
  onSubmit,
  notify,
  onClosed,
}: {
  refund: Refund;
  invoiceReference: string;
  onClosed: () => void;
  onSubmit: (reason: string) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(reason);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Cancel ${refund.reference}`}
      description={`${money(refund.currencyCode, refund.amount)} becomes owed back to the customer again on ${invoiceReference}. The refund keeps its number and stays on record with this reason.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" hint="Kept on the record and in the audit trail" error={errors.reason}>
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Keep the refund</Button>
          <Button type="submit" variant="danger">
            Cancel refund
          </Button>
        </div>
      </form>
    </Panel>
  );
}
