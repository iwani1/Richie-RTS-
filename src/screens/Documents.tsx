// The paper the office hands to a customer: an invoice, the credit note that corrects it, and the
// statement of their whole account (FIN-02, D-86, D-87, D-90).
//
// The sheet itself is `components/tms/Sheet` — one A4 vocabulary, four documents, and the management
// report on the same page. This file is what each document says, not how paper looks.
//
// The rules the paper keeps:
//   * the amount due is the figure the shared balance helper produced (`creditNotes.ts`) — never a
//     second subtraction written here, which is how a printed total starts disagreeing with the screen;
//   * a document that has been voided says so in words, at the top, before any figure;
//   * money received, money credited and money owed back are all on the page, so nobody has to ask;
//   * nothing is invented. A company name that has not been set is named as missing, and the preview
//     says where to set it — a plausible-looking placeholder is worse than an honest gap, because it
//     is the one thing on the page a customer would read as fact.
import { invoiceBalance } from "../tms/creditNotes";
import type { CustomerStatement, StatementRowKind } from "../tms/customerStatement";
import { formatAmount, lineAmount } from "../tms/money";
import type { CreditNote, Invoice } from "../tms/types";
import { CREDIT_NOTE_STATUS_LABELS, INVOICE_STATUS_LABELS } from "../tms/types";
import { useTms } from "../tms/useTms";
import { formatDate, todayYmd } from "@/lib/format";
import {
  Sheet,
  SheetFoot,
  SheetHeader,
  SheetMeta,
  SheetMetaItem,
  SheetNotice,
  SheetNote,
  SheetRow,
  SheetSection,
  SheetTable,
  SheetTd,
  SheetTh,
  SheetTotals,
  SheetWords,
} from "@/components/tms/Sheet";

export { PrintPreview } from "@/components/tms/PrintPreview";

const money = (currency: string, amount: number) => `${currency} ${formatAmount(amount)}`;

/** The foot of every document: what this paper is, and the day it was printed. */
function Foot({ reference }: { reference: string }) {
  return <SheetFoot reference={reference} printed={`Printed ${formatDate(todayYmd())}`} />;
}

/** An issued invoice as the customer reads it, including what has been paid and credited since. */
export function InvoiceSheet({ invoice }: { invoice: Invoice }) {
  const { db } = useTms();
  // The same helper the screen, the reports and the finance home use (D-86). A printed total must
  // never be its own arithmetic.
  const balance = invoiceBalance(db, invoice);
  const rental = db.rentals.find((candidate) => candidate.id === invoice.rentalId) ?? null;
  const isVoid = invoice.status === "void";

  return (
    <Sheet label={`Invoice ${invoice.reference}`}>
      <SheetHeader
        docType="Invoice"
        reference={invoice.reference}
        state={INVOICE_STATUS_LABELS[invoice.status]}
        companyName={db.settings.companyName}
      />

      {isVoid && (
        <SheetNotice tone="void">
          <strong>This invoice is void and does not stand.</strong>{" "}
          {invoice.voidReason ? `Reason recorded: ${invoice.voidReason}.` : "No reason was recorded."}
        </SheetNotice>
      )}

      <SheetMeta>
        <SheetMetaItem
          label="Billed to"
          value={invoice.customerName}
          // The buyer's details as the invoice was issued (CUS-01): copied then, never re-read.
          detail={
            <>
              {invoice.buyerAddress && <span className="block">{invoice.buyerAddress}</span>}
              {invoice.buyerTin && <span className="block">TIN {invoice.buyerTin}</span>}
            </>
          }
        />
        <SheetMetaItem label="Issued" value={formatDate(invoice.issuedOn)} />
        <SheetMetaItem label="Payment due" value={formatDate(invoice.dueOn)} />
        {rental && <SheetMetaItem label="Hire" value={rental.reference} />}
      </SheetMeta>

      <SheetTable
        label="Line items"
        head={
          <>
            <SheetTh>Description</SheetTh>
            <SheetTh num>Qty</SheetTh>
            <SheetTh num>Unit price</SheetTh>
            <SheetTh num>Amount</SheetTh>
          </>
        }
      >
        {invoice.lines.map((line) => (
          <tr key={line.id}>
            <SheetTd>{line.description}</SheetTd>
            <SheetTd num>{line.quantity}</SheetTd>
            <SheetTd num>{money(invoice.currencyCode, line.unitAmount)}</SheetTd>
            <SheetTd num>{money(invoice.currencyCode, lineAmount(line.quantity, line.unitAmount))}</SheetTd>
          </tr>
        ))}
      </SheetTable>

      <SheetTotals>
        <SheetRow label="Subtotal" value={money(invoice.currencyCode, invoice.subtotal)} />
        {invoice.taxLines.map((line) => (
          <SheetRow key={line.name} label={`${line.name} at ${line.ratePercent}%`} value={money(invoice.currencyCode, line.amount)} />
        ))}
        {invoice.taxLines.length === 0 && <SheetRow label="Tax" value="Not charged" />}
        <SheetRow label="Total" value={money(invoice.currencyCode, invoice.total)} emphasis="total" />
        {!isVoid && balance.paid > 0 && <SheetRow label="Received" value={money(invoice.currencyCode, balance.paid)} />}
        {!isVoid && balance.credited > 0 && (
          <SheetRow label="Credited by credit note" value={money(invoice.currencyCode, balance.credited)} />
        )}
        {!isVoid &&
          (balance.refundDue > 0 ? (
            <SheetRow label="Refund due to the customer" value={money(invoice.currencyCode, balance.refundDue)} emphasis="due" />
          ) : (
            <SheetRow label="Amount due" value={money(invoice.currencyCode, balance.outstanding)} emphasis="due" />
          ))}
      </SheetTotals>

      <SheetWords>
        {isVoid
          ? "A voided invoice keeps its number and stays on record; a corrected invoice carries the next number."
          : balance.refundDue > 0
            ? "Credit notes have taken this invoice below what the customer paid, so the difference shown is owed back to them."
            : balance.outstanding > 0
              ? `Please pay ${money(invoice.currencyCode, balance.outstanding)} by ${formatDate(invoice.dueOn)}.`
              : "Nothing is owed on this invoice."}
      </SheetWords>

      {invoice.notes && <SheetNote label="Note">{invoice.notes}</SheetNote>}

      <Foot reference={invoice.reference} />
    </Sheet>
  );
}

/** A credit note as the customer reads it: what came off, off which invoice, and why. */
export function CreditNoteSheet({ note }: { note: CreditNote }) {
  const { db } = useTms();
  const isVoid = note.status === "void";

  return (
    <Sheet label={`Credit note ${note.reference}`}>
      <SheetHeader
        docType="Credit note"
        reference={note.reference}
        state={CREDIT_NOTE_STATUS_LABELS[note.status]}
        companyName={db.settings.companyName}
      />

      {isVoid && (
        <SheetNotice tone="void">
          <strong>This credit note is void and does not stand.</strong>{" "}
          {note.voidReason ? `Reason recorded: ${note.voidReason}.` : "No reason was recorded."} The amount below is back on{" "}
          {note.invoiceReference}.
        </SheetNotice>
      )}

      <SheetMeta>
        <SheetMetaItem label="Credited to" value={note.customerName} />
        <SheetMetaItem label="Issued" value={formatDate(note.issuedOn)} />
        <SheetMetaItem label="Against invoice" value={note.invoiceReference} />
      </SheetMeta>

      <SheetTable
        label="Credited lines"
        head={
          <>
            <SheetTh>Description</SheetTh>
            <SheetTh num>Qty</SheetTh>
            <SheetTh num>Unit price</SheetTh>
            <SheetTh num>Amount</SheetTh>
          </>
        }
      >
        {note.lines.map((line) => (
          <tr key={line.id}>
            <SheetTd>{line.description}</SheetTd>
            <SheetTd num>{line.quantity}</SheetTd>
            <SheetTd num>{money(note.currencyCode, line.unitAmount)}</SheetTd>
            <SheetTd num>{money(note.currencyCode, lineAmount(line.quantity, line.unitAmount))}</SheetTd>
          </tr>
        ))}
      </SheetTable>

      <SheetTotals>
        <SheetRow label="Subtotal" value={money(note.currencyCode, note.subtotal)} />
        {note.taxLines.map((line) => (
          <SheetRow key={line.name} label={`${line.name} at ${line.ratePercent}%`} value={money(note.currencyCode, line.amount)} />
        ))}
        <SheetRow label="Total credited" value={money(note.currencyCode, note.total)} emphasis="total" />
      </SheetTotals>

      <SheetWords>
        {isVoid
          ? `This credit note is void, so nothing is taken off ${note.invoiceReference}.`
          : `This credit note reduces the amount due on ${note.invoiceReference} by ${money(note.currencyCode, note.total)}. It is not a payment and it does not change any payment already recorded.`}
      </SheetWords>

      <SheetNote label="Reason">{note.reason}</SheetNote>

      <Foot reference={note.reference} />
    </Sheet>
  );
}

/**
 * A customer's statement of account for a period (FIN-02, D-90).
 *
 * This is the sheet an office sends when it chases money, so it has to survive being read by the
 * customer's bookkeeper: every row carries a date, a document number and what it did to the balance,
 * the balance carried in comes from the day before the period, and the balance carried out is stated
 * once at the bottom with its age in bands. The figures are the ones `customerStatement()` produced —
 * this component formats, it does not add up — so the paper, the screen and the reports cannot
 * diverge.
 */
export function StatementSheet({ statement }: { statement: CustomerStatement }) {
  const { db } = useTms();
  // A statement has no document number of its own; the period is what identifies it.
  const period = `${formatDate(statement.from)} – ${formatDate(statement.to)}`;
  const currency = statement.currencyCode ?? "";
  const kindLabel: Record<StatementRowKind, string> = {
    invoice: "Invoice",
    creditNote: "Credit note",
    payment: "Payment",
    // "Paid back", not "Refund": the customer's bookkeeper is reading a column headed Debit, and the
    // word has to say which way the money went (D-92).
    refund: "Refund paid back",
  };

  return (
    <Sheet label={`Statement for ${statement.customerName}`}>
      <SheetHeader
        docType="Statement of account"
        reference={period}
        referenceLabel="Period"
        state={`As at ${formatDate(statement.to)}`}
        companyName={db.settings.companyName}
      />

      <SheetMeta className="sm:grid-cols-3">
        <SheetMetaItem label="Account of" value={statement.customerName} />
        <SheetMetaItem label="Period" value={period} />
        <SheetMetaItem label="Currency" value={currency || "not set"} />
      </SheetMeta>

      <SheetTable
        label="Account activity"
        head={
          <>
            <SheetTh>Date</SheetTh>
            <SheetTh>What</SheetTh>
            <SheetTh>Reference</SheetTh>
            <SheetTh num>Charged</SheetTh>
            <SheetTh num>Paid or credited</SheetTh>
            <SheetTh num>Balance</SheetTh>
          </>
        }
      >
        <tr>
          <SheetTd>{formatDate(statement.from)}</SheetTd>
          <SheetTd colSpan={3}>Balance brought forward</SheetTd>
          <SheetTd num />
          <SheetTd num>{money(currency, statement.openingBalance)}</SheetTd>
        </tr>
        {statement.rows.map((row) => (
          <tr key={`${row.kind}-${row.id}`}>
            <SheetTd>{formatDate(row.date)}</SheetTd>
            <SheetTd>
              {kindLabel[row.kind]}
              {row.kind === "creditNote" && row.description ? ` — ${row.description}` : ""}
              {row.kind === "payment" && row.description ? ` — ${row.description.replace("Payment received — ", "")}` : ""}
              {row.kind === "refund" && row.description ? ` — ${row.description.replace("Refund paid back — ", "")}` : ""}
            </SheetTd>
            <SheetTd mono>{row.reference}</SheetTd>
            <SheetTd num>{row.debit > 0 ? money(currency, row.debit) : ""}</SheetTd>
            <SheetTd num>{row.credit > 0 ? money(currency, row.credit) : ""}</SheetTd>
            <SheetTd num>{money(currency, row.balance)}</SheetTd>
          </tr>
        ))}
        {statement.rows.length === 0 && (
          <tr>
            <SheetTd colSpan={6}>Nothing moved on this account in the period.</SheetTd>
          </tr>
        )}
      </SheetTable>

      <SheetTotals>
        {/* The opening balance is stated once, in the table's own "brought forward" row above: a
            totals block that repeated it would ask the reader to decide which one was authoritative. */}
        <SheetRow label="Invoiced in the period" value={money(currency, statement.invoiced)} />
        <SheetRow label="Payments received" value={money(currency, statement.received)} />
        <SheetRow label="Credit notes issued" value={money(currency, statement.credited)} />
        {statement.refunded > 0 && (
          // Stated as money that left the office, never netted off what the customer paid (D-92).
          <SheetRow label="Refunds paid back" value={money(currency, statement.refunded)} />
        )}
        <SheetRow
          label={statement.closingBalance < 0 ? "In credit — owed to the customer" : "Balance due"}
          value={money(currency, Math.abs(statement.closingBalance))}
          emphasis="due"
        />
      </SheetTotals>

      <SheetWords>
        {statement.closingBalance > 0
          ? `This is a statement of account, not a demand for payment. It lists every invoice, payment and credit note on this account in the period. ${money(currency, statement.closingBalance)} was owed as at ${formatDate(statement.to)}.`
          : statement.closingBalance < 0
            ? `This account is in credit by ${money(currency, -statement.closingBalance)} as at ${formatDate(statement.to)}: more has been paid or credited than invoiced.`
            : `Nothing is owed on this account as at ${formatDate(statement.to)}.`}
      </SheetWords>

      {statement.ageing.total > 0 && (
        <SheetSection label="How old the money is" intro={`Money still owed, by age at ${formatDate(statement.to)}.`}>
          <SheetTable
            label="Ageing of the balance"
            className="mt-2"
            head={
              <>
                <SheetTh>Not yet due</SheetTh>
                <SheetTh num>1–30 days late</SheetTh>
                <SheetTh num>31–60 days late</SheetTh>
                <SheetTh num>Over 60 days late</SheetTh>
                <SheetTh num>Total</SheetTh>
              </>
            }
          >
            <tr>
              <SheetTd>{money(currency, statement.ageing.notYetDue)}</SheetTd>
              <SheetTd num>{money(currency, statement.ageing.days1to30)}</SheetTd>
              <SheetTd num>{money(currency, statement.ageing.days31to60)}</SheetTd>
              <SheetTd num>{money(currency, statement.ageing.days61plus)}</SheetTd>
              <SheetTd num>{money(currency, statement.ageing.total)}</SheetTd>
            </tr>
          </SheetTable>
        </SheetSection>
      )}

      {statement.openInvoices.length > 0 && (
        <SheetSection label="Invoices still owing">
          <SheetTable
            label="Invoices still owing"
            className="mt-2"
            head={
              <>
                <SheetTh>Invoice</SheetTh>
                <SheetTh>Issued</SheetTh>
                <SheetTh>Payment due</SheetTh>
                <SheetTh num>Days late</SheetTh>
                <SheetTh num>Outstanding</SheetTh>
              </>
            }
          >
            {statement.openInvoices.map((row) => (
              <tr key={row.invoiceId}>
                <SheetTd mono>{row.reference}</SheetTd>
                <SheetTd>{formatDate(row.issuedOn)}</SheetTd>
                <SheetTd>{formatDate(row.dueOn)}</SheetTd>
                <SheetTd num>{row.daysOverdue > 0 ? row.daysOverdue : "—"}</SheetTd>
                <SheetTd num>{money(currency, row.outstanding)}</SheetTd>
              </tr>
            ))}
          </SheetTable>
        </SheetSection>
      )}

      <Foot reference={`Statement — ${statement.customerName}`} />
    </Sheet>
  );
}
