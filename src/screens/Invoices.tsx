// Invoices and payments (FIN-02, FIN-03).
//
// The list is the money the business is owed: what was billed, what came in, what is still open.
// An invoice is raised from a completed rental rather than typed here, so the amounts on the screen
// always trace back to a priced quotation and a completion record. Nothing on this screen edits an
// issued invoice: it can be paid, verified or voided, and the void path is refused once money has
// been recorded against it.
import { useMemo, useState, type FormEvent } from "react";
import type { CommandResult } from "../tms/service";
import type { Invoice, InvoiceStatus, Payment, PaymentStatus } from "../tms/types";
import { INVOICE_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../tms/types";
import { useTms } from "../tms/useTms";
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

const STATUS_TONE: Record<InvoiceStatus, "success" | "warning" | "error" | "neutral" | "info"> = {
  issued: "info",
  part_paid: "warning",
  paid: "success",
  void: "neutral",
};

const money = (currency: string, amount: number) => `${currency} ${amount.toFixed(2)}`;

type CommandNotify = ReturnType<typeof useTms>["setFlash"];

type StatusFilter = "all" | InvoiceStatus;

export function InvoicesPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const today = todayYmd();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const paidOn = (invoice: Invoice) =>
    db.payments.filter((payment) => payment.invoiceId === invoice.id).reduce((sum, payment) => sum + payment.amount, 0);
  const live = db.invoices.filter((invoice) => invoice.status !== "void");

  const totals = useMemo(() => {
    const sumPaid = (invoice: Invoice) =>
      db.payments.filter((payment) => payment.invoiceId === invoice.id).reduce((sum, payment) => sum + payment.amount, 0);
    const open = db.invoices.filter((invoice) => invoice.status !== "void");
    const billed = open.reduce((sum, invoice) => sum + invoice.total, 0);
    const received = open.reduce((sum, invoice) => sum + sumPaid(invoice), 0);
    const overdue = open
      .filter((invoice) => invoice.status !== "paid" && invoice.dueOn < today)
      .reduce((sum, invoice) => sum + (invoice.total - sumPaid(invoice)), 0);
    return { billed, received, outstanding: Math.max(billed - received, 0), overdue };
  }, [db.invoices, db.payments, today]);

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
        description="Invoices raised from completed rentals, and the money received against them. An issued invoice is never edited: it is paid, verified or voided."
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
        <Stat label="Outstanding" value={money(currency, totals.outstanding)} caption="billed less received" />
        <Stat label="Overdue" value={money(currency, totals.overdue)} caption={`due before ${formatDate(today)}`} />
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
              {live.filter((invoice) => invoice.status !== "paid").length} open · {billable.length} waiting to be invoiced
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
            { key: "paid", header: "Paid", className: "text-right rts-mono", render: (invoice) => money(invoice.currencyCode, paidOn(invoice)) },
            {
              key: "outstanding",
              header: "Outstanding",
              className: "text-right rts-mono",
              render: (invoice) =>
                invoice.status === "void" ? (
                  <span className="text-stone-400">-</span>
                ) : (
                  money(invoice.currencyCode, Math.max(invoice.total - paidOn(invoice), 0))
                ),
            },
            { key: "status", header: "Status", render: (invoice) => <Badge tone={STATUS_TONE[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge> },
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
  const subtotal = rental?.finalInvoice?.lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0) ?? 0;

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
                  <span className="rts-mono">{money(rental.finalInvoice!.currencyCode, line.quantity * line.unitAmount)}</span>
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
  const payments = db.payments.filter((payment) => payment.invoiceId === invoice.id);
  const received = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = Math.max(invoice.total - received, 0);
  const rental = db.rentals.find((candidate) => candidate.id === invoice.rentalId) ?? null;

  const advance = async (payment: Payment, to: PaymentStatus) => {
    const result = await dispatch({ type: "advance_payment", id: payment.id, to });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
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
            {allowed("payments:record") && invoice.status !== "void" && outstanding > 0 && (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Record a payment
              </Button>
            )}
            {allowed("invoices:void") && invoice.status !== "void" && payments.length === 0 && (
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
      {payments.length > 0 && invoice.status !== "void" && invoice.status !== "paid" && (
        <Notice tone="info" className="mb-4">
          {money(invoice.currencyCode, received)} received; {money(invoice.currencyCode, outstanding)} still outstanding. This invoice cannot be voided while payments stand against it.
        </Notice>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Subtotal" value={money(invoice.currencyCode, invoice.subtotal)} caption="before tax" />
        <Stat label="Tax" value={money(invoice.currencyCode, invoice.total - invoice.subtotal)} caption={invoice.taxLines.length ? invoice.taxLines.map((line) => `${line.name} ${line.ratePercent}%`).join(" · ") : "not registered"} />
        <Stat label="Total" value={money(invoice.currencyCode, invoice.total)} caption={INVOICE_STATUS_LABELS[invoice.status]} />
        <Stat label="Outstanding" value={money(invoice.currencyCode, outstanding)} caption={`${payments.length} payment${payments.length === 1 ? "" : "s"} recorded`} />
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
              { key: "amount", header: "Amount", className: "text-right rts-mono", render: (line) => money(invoice.currencyCode, line.quantity * line.unitAmount) },
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

        <TableCard title="Payments" summary={`${money(invoice.currencyCode, received)} received`}>
          <DataTable
            rows={payments}
            rowKey={(payment) => payment.id}
            emptyState={<EmptyState title="No payments yet" body="Payments recorded against this invoice appear here." />}
            columns={[
              { key: "ref", header: "Payment", render: (payment) => <span className="rts-mono text-xs">{payment.reference}</span> },
              { key: "date", header: "Received", render: (payment) => formatDate(payment.paidOn) },
              { key: "method", header: "Method", render: (payment) => payment.method },
              { key: "amount", header: "Amount", className: "text-right rts-mono", render: (payment) => money(payment.currencyCode, payment.amount) },
              { key: "status", header: "Status", render: (payment) => <Badge tone={payment.status === "reconciled" ? "success" : "info"}>{PAYMENT_STATUS_LABELS[payment.status]}</Badge> },
              {
                key: "actions",
                header: "",
                className: "text-right",
                render: (payment) =>
                  allowed("payments:advance") && payment.status !== "reconciled" ? (
                    <Button variant="ghost" onClick={() => advance(payment, payment.status === "recorded" ? "verified" : "reconciled")}>
                      {payment.status === "recorded" ? "Verify" : "Reconcile"}
                    </Button>
                  ) : null,
              },
            ]}
          />
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
