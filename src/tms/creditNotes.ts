// Credit notes: the arithmetic every balance in the application has to agree on (FIN-02, D-86).
//
// Four places used to answer "what is still owed?" on their own — the invoice screen, the finance
// report, the rentals report and the finance home tiles — and each of them subtracted payments from
// the invoice total. A credit note is a second way for an invoice's ask to fall, so the arithmetic
// moves here once and every reader calls it. If these drift apart, the invoice says one thing and the
// month's statement another, which is the failure this module exists to prevent.
//
// The rule, in one line:
//
//     outstanding = total − paid − credited        (never below zero)
//
// and, when credits take the bill below the cash already received,
//
//     refund due  = paid + credited − total        (never below zero)
//
// A credit note is not a payment and a payment is not a credit note. Money that arrived stays on the
// invoice as recorded, untouched; a credit reduces what was asked for. Where the two cross, the
// difference is a refund the office owes back, stated plainly rather than netted quietly into a zero.
//
// All comparison happens in whole pesewas (audit D-04): floats show a pesewa of balance forever.
import { fromMinor, toMinor } from "./money";
import type { CreditNote, Database, Invoice } from "./types";

/**
 * The credit notes that still count: an issued one does, a voided one does not.
 *
 * `upTo` exists for the reports. A statement for a month that ended in June must not be changed by a
 * credit note typed in July, the same way it is not changed by a payment received in July.
 */
export function liveCreditNotes(db: Database, invoiceId: string, upTo?: string): CreditNote[] {
  return db.creditNotes.filter(
    (note) => note.invoiceId === invoiceId && note.status === "issued" && (!upTo || note.issuedOn <= upTo),
  );
}

/** Everything a credit note has taken off one invoice, in the invoice's currency. */
export function creditedTotal(db: Database, invoice: Invoice, upTo?: string): number {
  return fromMinor(
    liveCreditNotes(db, invoice.id, upTo).reduce((sum, note) => sum + toMinor(note.total), 0),
  );
}

/** What the customer has actually paid, in the invoice's currency. */
export function paidTotal(db: Database, invoice: Invoice, upTo?: string): number {
  return fromMinor(
    db.payments.reduce(
      (sum, payment) =>
        payment.invoiceId === invoice.id && (!upTo || payment.paidOn.slice(0, 10) <= upTo)
          ? sum + toMinor(payment.amount)
          : sum,
      0,
    ),
  );
}

export interface InvoiceBalance {
  /** What the invoice asked for, before payments and credits. */
  total: number;
  paid: number;
  credited: number;
  /** Still owed by the customer: total − paid − credited, floored at zero. */
  outstanding: number;
  /** Owed back by the office: paid + credited − total, floored at zero. */
  refundDue: number;
  /** True when nothing is left to collect and nothing has to be given back. */
  settled: boolean;
}

/**
 * The four numbers an invoice's balance is made of.
 *
 * One function rather than four call sites, so a screen, a report and a tile cannot disagree about
 * the same invoice. `upTo` limits both payments and credit notes to a date, which is what a statement
 * for a closed period needs.
 */
export function invoiceBalance(db: Database, invoice: Invoice, upTo?: string): InvoiceBalance {
  const total = toMinor(invoice.total);
  const paid = toMinor(paidTotal(db, invoice, upTo));
  const credited = toMinor(creditedTotal(db, invoice, upTo));
  const remaining = total - paid - credited;
  const refund = paid + credited - total;
  return {
    total: fromMinor(total),
    paid: fromMinor(paid),
    credited: fromMinor(credited),
    outstanding: fromMinor(remaining > 0 ? remaining : 0),
    refundDue: fromMinor(refund > 0 ? refund : 0),
    settled: remaining <= 0 && refund <= 0,
  };
}

/** The credit notes on a set of invoices, for a report that has to state what was credited. */
export function creditedBetween(db: Database, from: string, to: string): CreditNote[] {
  return db.creditNotes.filter((note) => note.status === "issued" && note.issuedOn >= from && note.issuedOn <= to);
}
