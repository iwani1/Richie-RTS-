// The paper the office hands to a customer: an invoice, and the credit note that corrects it
// (FIN-02, D-86, D-87).
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
}: {
  docType: string;
  reference: string;
  state: string;
  companyName: string | null;
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
        <p className="rts-sheet-label">Reference</p>
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
