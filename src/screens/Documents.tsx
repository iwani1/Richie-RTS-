// The paper the office hands to a customer: an invoice, the credit note that corrects it, and the
// statement of their whole account (FIN-02, D-86, D-87, D-90).
//
// This is a printable sheet, not a PDF service. The browser already has a print engine that knows the
// page size, the margins and how to write a file, so the document needs no dependency, works with no
// network, and prints exactly what the person checking it saw on screen. The overlay is a preview of
// that sheet; the stylesheet removes the navigation, the buttons and every other screen from the
// printed page.
//
// The rules the paper keeps:
//   * the amount due is the figure the shared balance helper produced (`creditNotes.ts`) — never a
//     second subtraction written here, which is how a printed total starts disagreeing with the screen;
//   * a document that has been voided says so in words, at the top, before any figure;
//   * money received, money credited and money owed back are all on the page, so nobody has to ask;
//   * nothing is invented. A company name that has not been set is named as missing, and the preview
//     says where to set it — a plausible-looking placeholder is worse than an honest gap, because it
//     is the one thing on the page a customer would read as fact.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoiceBalance } from "../tms/creditNotes";
import type { CustomerStatement, StatementRowKind } from "../tms/customerStatement";
import { formatAmount, lineAmount } from "../tms/money";
import type { CreditNote, Invoice } from "../tms/types";
import { CREDIT_NOTE_STATUS_LABELS, INVOICE_STATUS_LABELS } from "../tms/types";
import { useTms } from "../tms/useTms";
import { Button, formatDate, todayYmd } from "../ui/primitives";
import { useDialogFocus } from "../ui/useDialogFocus";

const money = (currency: string, amount: number) => `${currency} ${formatAmount(amount)}`;

/**
 * The preview, and the only place the print command is triggered.
 *
 * Rendered into `document.body` so the print stylesheet can hide everything else by hiding the
 * body's other children; a sheet nested inside the application shell would drag the shell onto the
 * page with it. The document title is set to the document's own name while it is open, because that
 * is what the browser suggests as the file name in "Save as PDF".
 */
export function PrintPreview({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { db } = useTms();
  const root = useRef<HTMLDivElement>(null);
  useDialogFocus(root, onClose);

  // The preview only ever mounts from a click, so it is never part of a server render and the portal
  // always has a document to attach to.
  useEffect(() => {
    const previous = document.title;
    document.title = label;
    return () => {
      document.title = previous;
    };
  }, [label]);

  return createPortal(
    <div className="rts-print" role="dialog" aria-modal="true" aria-label={`Print preview: ${label}`} ref={root} tabIndex={-1}>
      <div className="rts-print-bar">
        <div className="rts-print-bar-text">
          <p className="rts-print-bar-title">{label}</p>
          <p className="rts-print-bar-hint">
            Print this page, or choose “Save as PDF” in the print dialog to send it as a file.
            {!db.settings.companyName && " The company name is not set in Settings, so this document carries no supplier name yet."}
          </p>
        </div>
        <div className="rts-print-bar-actions">
          <Button variant="primary" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="rts-print-stage">{children}</div>
    </div>,
    document.body,
  );
}

/** The letterhead both documents share: who is billing, what the document is, and its number. */
function SheetTop({
  docType,
  reference,
  state,
  companyName,
  referenceLabel = "Reference",
}: {
  docType: string;
  reference: string;
  state: string;
  companyName: string | null;
  /** What the second block is: a document number, or the period a statement covers. */
  referenceLabel?: string;
}) {
  return (
    <header className="rts-sheet-top">
      <div className="rts-sheet-issuer">
        <p className={companyName ? "rts-sheet-company" : "rts-sheet-company rts-sheet-company--missing"}>
          {companyName ?? "Company name not set in Settings"}
        </p>
        <p className="rts-sheet-doctype">{docType}</p>
      </div>
      <div className="rts-sheet-id">
        <p className="rts-sheet-label">{referenceLabel}</p>
        <p className="rts-sheet-reference">{reference}</p>
        <p className="rts-sheet-state">{state}</p>
      </div>
    </header>
  );
}

function SheetFoot({ reference }: { reference: string }) {
  return (
    <footer className="rts-sheet-foot">
      <span>{reference}</span>
      <span>Printed {formatDate(todayYmd())}</span>
    </footer>
  );
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
    <article className="rts-sheet" aria-label={`Invoice ${invoice.reference}`}>
      <SheetTop
        docType="Invoice"
        reference={invoice.reference}
        state={INVOICE_STATUS_LABELS[invoice.status]}
        companyName={db.settings.companyName}
      />

      {isVoid && (
        <p className="rts-sheet-void">
          <strong>This invoice is void and does not stand.</strong>{" "}
          {invoice.voidReason ? `Reason recorded: ${invoice.voidReason}.` : "No reason was recorded."}
        </p>
      )}

      <div className="rts-sheet-meta">
        <div>
          <p className="rts-sheet-label">Billed to</p>
          <p className="rts-sheet-value">{invoice.customerName}</p>
          {/* The buyer's details as the invoice was issued (CUS-01): copied then, never re-read. */}
          {invoice.buyerAddress && <p className="rts-sheet-detail">{invoice.buyerAddress}</p>}
          {invoice.buyerTin && <p className="rts-sheet-detail">TIN {invoice.buyerTin}</p>}
        </div>
        <div>
          <p className="rts-sheet-label">Issued</p>
          <p className="rts-sheet-value">{formatDate(invoice.issuedOn)}</p>
        </div>
        <div>
          <p className="rts-sheet-label">Payment due</p>
          <p className="rts-sheet-value">{formatDate(invoice.dueOn)}</p>
        </div>
        {rental && (
          <div>
            <p className="rts-sheet-label">Hire</p>
            <p className="rts-sheet-value">{rental.reference}</p>
          </div>
        )}
      </div>

      <table className="rts-sheet-table" aria-label="Line items">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col" className="rts-sheet-num">
              Qty
            </th>
            <th scope="col" className="rts-sheet-num">
              Unit price
            </th>
            <th scope="col" className="rts-sheet-num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="rts-sheet-num">{line.quantity}</td>
              <td className="rts-sheet-num">{money(invoice.currencyCode, line.unitAmount)}</td>
              <td className="rts-sheet-num">{money(invoice.currencyCode, lineAmount(line.quantity, line.unitAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rts-sheet-closing">
        <dl className="rts-sheet-totals">
          <div className="rts-sheet-row">
            <dt>Subtotal</dt>
            <dd>{money(invoice.currencyCode, invoice.subtotal)}</dd>
          </div>
          {invoice.taxLines.map((line) => (
            <div key={line.name} className="rts-sheet-row">
              <dt>
                {line.name} at {line.ratePercent}%
              </dt>
              <dd>{money(invoice.currencyCode, line.amount)}</dd>
            </div>
          ))}
          {invoice.taxLines.length === 0 && (
            <div className="rts-sheet-row">
              <dt>Tax</dt>
              <dd>Not charged</dd>
            </div>
          )}
          <div className="rts-sheet-row rts-sheet-row--total">
            <dt>Total</dt>
            <dd>{money(invoice.currencyCode, invoice.total)}</dd>
          </div>
          {!isVoid && balance.paid > 0 && (
            <div className="rts-sheet-row">
              <dt>Received</dt>
              <dd>{money(invoice.currencyCode, balance.paid)}</dd>
            </div>
          )}
          {!isVoid && balance.credited > 0 && (
            <div className="rts-sheet-row">
              <dt>Credited by credit note</dt>
              <dd>{money(invoice.currencyCode, balance.credited)}</dd>
            </div>
          )}
          {!isVoid &&
            (balance.refundDue > 0 ? (
              <div className="rts-sheet-row rts-sheet-row--due">
                <dt>Refund due to the customer</dt>
                <dd>{money(invoice.currencyCode, balance.refundDue)}</dd>
              </div>
            ) : (
              <div className="rts-sheet-row rts-sheet-row--due">
                <dt>Amount due</dt>
                <dd>{money(invoice.currencyCode, balance.outstanding)}</dd>
              </div>
            ))}
        </dl>

        <p className="rts-sheet-words">
          {isVoid
            ? "A voided invoice keeps its number and stays on record; a corrected invoice carries the next number."
            : balance.refundDue > 0
              ? "Credit notes have taken this invoice below what the customer paid, so the difference shown is owed back to them."
              : balance.outstanding > 0
                ? `Please pay ${money(invoice.currencyCode, balance.outstanding)} by ${formatDate(invoice.dueOn)}.`
                : "Nothing is owed on this invoice."}
        </p>
      </div>

      {invoice.notes && (
        <p className="rts-sheet-note">
          <span className="rts-sheet-label">Note</span> {invoice.notes}
        </p>
      )}

      <SheetFoot reference={invoice.reference} />
    </article>
  );
}

/** A credit note as the customer reads it: what came off, off which invoice, and why. */
export function CreditNoteSheet({ note }: { note: CreditNote }) {
  const { db } = useTms();
  const isVoid = note.status === "void";

  return (
    <article className="rts-sheet" aria-label={`Credit note ${note.reference}`}>
      <SheetTop
        docType="Credit note"
        reference={note.reference}
        state={CREDIT_NOTE_STATUS_LABELS[note.status]}
        companyName={db.settings.companyName}
      />

      {isVoid && (
        <p className="rts-sheet-void">
          <strong>This credit note is void and does not stand.</strong>{" "}
          {note.voidReason ? `Reason recorded: ${note.voidReason}.` : "No reason was recorded."} The amount below is back on{" "}
          {note.invoiceReference}.
        </p>
      )}

      <div className="rts-sheet-meta">
        <div>
          <p className="rts-sheet-label">Credited to</p>
          <p className="rts-sheet-value">{note.customerName}</p>
        </div>
        <div>
          <p className="rts-sheet-label">Issued</p>
          <p className="rts-sheet-value">{formatDate(note.issuedOn)}</p>
        </div>
        <div>
          <p className="rts-sheet-label">Against invoice</p>
          <p className="rts-sheet-value">{note.invoiceReference}</p>
        </div>
      </div>

      <table className="rts-sheet-table" aria-label="Credited lines">
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col" className="rts-sheet-num">
              Qty
            </th>
            <th scope="col" className="rts-sheet-num">
              Unit price
            </th>
            <th scope="col" className="rts-sheet-num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {note.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="rts-sheet-num">{line.quantity}</td>
              <td className="rts-sheet-num">{money(note.currencyCode, line.unitAmount)}</td>
              <td className="rts-sheet-num">{money(note.currencyCode, lineAmount(line.quantity, line.unitAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rts-sheet-closing">
        <dl className="rts-sheet-totals">
          <div className="rts-sheet-row">
            <dt>Subtotal</dt>
            <dd>{money(note.currencyCode, note.subtotal)}</dd>
          </div>
          {note.taxLines.map((line) => (
            <div key={line.name} className="rts-sheet-row">
              <dt>
                {line.name} at {line.ratePercent}%
              </dt>
              <dd>{money(note.currencyCode, line.amount)}</dd>
            </div>
          ))}
          <div className="rts-sheet-row rts-sheet-row--total">
            <dt>Total credited</dt>
            <dd>{money(note.currencyCode, note.total)}</dd>
          </div>
        </dl>

        <p className="rts-sheet-words">
          {isVoid
            ? `This credit note is void, so nothing is taken off ${note.invoiceReference}.`
            : `This credit note reduces the amount due on ${note.invoiceReference} by ${money(note.currencyCode, note.total)}. It is not a payment and it does not change any payment already recorded.`}
        </p>
      </div>

      <p className="rts-sheet-note">
        <span className="rts-sheet-label">Reason</span> {note.reason}
      </p>

      <SheetFoot reference={note.reference} />
    </article>
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
    <article className="rts-sheet" aria-label={`Statement for ${statement.customerName}`}>
      <SheetTop
        docType="Statement of account"
        reference={period}
        referenceLabel="Period"
        state={`As at ${formatDate(statement.to)}`}
        companyName={db.settings.companyName}
      />

      <div className="rts-sheet-meta">
        <div>
          <p className="rts-sheet-label">Account of</p>
          <p className="rts-sheet-value">{statement.customerName}</p>
        </div>
        <div>
          <p className="rts-sheet-label">Period</p>
          <p className="rts-sheet-value">{period}</p>
        </div>
        <div>
          <p className="rts-sheet-label">Currency</p>
          <p className="rts-sheet-value">{currency || "not set"}</p>
        </div>
      </div>

      <table className="rts-sheet-table" aria-label="Account activity">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">What</th>
            <th scope="col">Reference</th>
            <th scope="col" className="rts-sheet-num">
              Charged
            </th>
            <th scope="col" className="rts-sheet-num">
              Paid or credited
            </th>
            <th scope="col" className="rts-sheet-num">
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{formatDate(statement.from)}</td>
            <td colSpan={3}>Balance brought forward</td>
            <td className="rts-sheet-num" />
            <td className="rts-sheet-num">{money(currency, statement.openingBalance)}</td>
          </tr>
          {statement.rows.map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <td>{formatDate(row.date)}</td>
              <td>
                {kindLabel[row.kind]}
                {row.kind === "creditNote" && row.description ? ` — ${row.description}` : ""}
                {row.kind === "payment" && row.description ? ` — ${row.description.replace("Payment received — ", "")}` : ""}
                {row.kind === "refund" && row.description ? ` — ${row.description.replace("Refund paid back — ", "")}` : ""}
              </td>
              <td className="rts-mono">{row.reference}</td>
              <td className="rts-sheet-num">{row.debit > 0 ? money(currency, row.debit) : ""}</td>
              <td className="rts-sheet-num">{row.credit > 0 ? money(currency, row.credit) : ""}</td>
              <td className="rts-sheet-num">{money(currency, row.balance)}</td>
            </tr>
          ))}
          {statement.rows.length === 0 && (
            <tr>
              <td colSpan={6}>Nothing moved on this account in the period.</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="rts-sheet-closing">
        {/* The opening balance is stated once, in the table's own "brought forward" row above: a
            totals block that repeated it would ask the reader to decide which one was authoritative. */}
        <dl className="rts-sheet-totals">
          <div className="rts-sheet-row">
            <dt>Invoiced in the period</dt>
            <dd>{money(currency, statement.invoiced)}</dd>
          </div>
          <div className="rts-sheet-row">
            <dt>Payments received</dt>
            <dd>{money(currency, statement.received)}</dd>
          </div>
          <div className="rts-sheet-row">
            <dt>Credit notes issued</dt>
            <dd>{money(currency, statement.credited)}</dd>
          </div>
          {statement.refunded > 0 && (
            <div className="rts-sheet-row">
              {/* Stated as money that left the office, never netted off what the customer paid (D-92). */}
              <dt>Refunds paid back</dt>
              <dd>{money(currency, statement.refunded)}</dd>
            </div>
          )}
          <div className="rts-sheet-row rts-sheet-row--due">
            <dt>{statement.closingBalance < 0 ? "In credit — owed to the customer" : "Balance due"}</dt>
            <dd>{money(currency, Math.abs(statement.closingBalance))}</dd>
          </div>
        </dl>

        <p className="rts-sheet-words">
          {statement.closingBalance > 0
            ? `This is a statement of account, not a demand for payment. It lists every invoice, payment and credit note on this account in the period. ${money(currency, statement.closingBalance)} was owed as at ${formatDate(statement.to)}.`
            : statement.closingBalance < 0
              ? `This account is in credit by ${money(currency, -statement.closingBalance)} as at ${formatDate(statement.to)}: more has been paid or credited than invoiced.`
              : `Nothing is owed on this account as at ${formatDate(statement.to)}.`}
        </p>
      </div>

      {statement.ageing.total > 0 && (
        <section aria-label="How old the money is">
          <p className="rts-sheet-label">Money still owed, by age at {formatDate(statement.to)}</p>
          <table className="rts-sheet-table">
            <thead>
              <tr>
                <th scope="col">Not yet due</th>
                <th scope="col" className="rts-sheet-num">
                  1–30 days late
                </th>
                <th scope="col" className="rts-sheet-num">
                  31–60 days late
                </th>
                <th scope="col" className="rts-sheet-num">
                  Over 60 days late
                </th>
                <th scope="col" className="rts-sheet-num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{money(currency, statement.ageing.notYetDue)}</td>
                <td className="rts-sheet-num">{money(currency, statement.ageing.days1to30)}</td>
                <td className="rts-sheet-num">{money(currency, statement.ageing.days31to60)}</td>
                <td className="rts-sheet-num">{money(currency, statement.ageing.days61plus)}</td>
                <td className="rts-sheet-num">{money(currency, statement.ageing.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {statement.openInvoices.length > 0 && (
        <section aria-label="Invoices still owing">
          <p className="rts-sheet-label">Invoices still owing</p>
          <table className="rts-sheet-table">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Issued</th>
                <th scope="col">Payment due</th>
                <th scope="col" className="rts-sheet-num">
                  Days late
                </th>
                <th scope="col" className="rts-sheet-num">
                  Outstanding
                </th>
              </tr>
            </thead>
            <tbody>
              {statement.openInvoices.map((row) => (
                <tr key={row.invoiceId}>
                  <td className="rts-mono">{row.reference}</td>
                  <td>{formatDate(row.issuedOn)}</td>
                  <td>{formatDate(row.dueOn)}</td>
                  <td className="rts-sheet-num">{row.daysOverdue > 0 ? row.daysOverdue : "—"}</td>
                  <td className="rts-sheet-num">{money(currency, row.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <SheetFoot reference={`Statement — ${statement.customerName}`} />
    </article>
  );
}
