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
// A payment can be cancelled — recorded against the wrong invoice, or for money that never arrived
// (D-88). A cancelled payment is not money received: it is excluded here, once, so the invoice, the
// two money reports, the finance home and the printed sheet cannot each decide for themselves.
//
// A **refund** is money the office gave back (D-92). It does not change what the customer paid, so it
// is not subtracted from `paid`; what it does is settle the amount owed back, so it is subtracted from
// `refundDue`. Leaving it out would let the same over-credit be paid out twice, because the second
// reader would still see the full amount owed back. A cancelled refund gave nothing back, so it counts
// as nothing.
//
// All comparison happens in whole pesewas (audit D-04): floats show a pesewa of balance forever.
import { fromMinor, toMinor } from "./money";
import type { CreditNote, Database, Invoice, Payment, Refund } from "./types";

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

/** A payment that still counts: one that has not been cancelled (D-88). */
export function isLivePayment(payment: Payment): boolean {
  return !payment.voidedAt;
}

/** The payments that still count, optionally only those received by a given day. */
export function livePayments(db: Database, upTo?: string): Payment[] {
  return db.payments.filter((payment) => isLivePayment(payment) && (!upTo || payment.paidOn.slice(0, 10) <= upTo));
}

/** A refund that still counts: one the office has not cancelled (D-92). */
export function isLiveRefund(refund: Refund): boolean {
  return refund.status !== "void";
}

/**
 * The refunds that still count, optionally only those paid out by a given day.
 *
 * `upTo` matters for the balance of a closed period: a refund paid in July must not reduce the amount
 * that was owed back at the end of June, in the same way a July payment does not.
 */
export function liveRefunds(db: Database, invoiceId?: string, upTo?: string): Refund[] {
  return db.refunds.filter(
    (refund) =>
      isLiveRefund(refund) &&
      (!invoiceId || refund.invoiceId === invoiceId) &&
      (!upTo || refund.paidOn.slice(0, 10) <= upTo),
  );
}

/** What the office has already paid back on one invoice, in the invoice's currency. */
export function refundedTotal(db: Database, invoice: Invoice, upTo?: string): number {
  return fromMinor(liveRefunds(db, invoice.id, upTo).reduce((sum, refund) => sum + toMinor(refund.amount), 0));
}

/** What the customer has actually paid, in the invoice's currency. Cancelled payments do not count. */
export function paidTotal(db: Database, invoice: Invoice, upTo?: string): number {
  return fromMinor(
    livePayments(db, upTo).reduce(
      (sum, payment) => (payment.invoiceId === invoice.id ? sum + toMinor(payment.amount) : sum),
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
  /** Already paid back to the customer, from live refunds (D-92). */
  refunded: number;
  /** Still owed back by the office: paid + credited − total − refunded, floored at zero. */
  refundDue: number;
  /** True when nothing is left to collect and nothing has to be given back. */
  settled: boolean;
}

/**
 * The numbers an invoice's balance is made of.
 *
 * One function rather than four call sites, so a screen, a report and a tile cannot disagree about
 * the same invoice. `upTo` limits both payments and credit notes to a date, which is what a statement
 * for a closed period needs.
 */
export function invoiceBalance(db: Database, invoice: Invoice, upTo?: string): InvoiceBalance {
  const total = toMinor(invoice.total);
  const paid = toMinor(paidTotal(db, invoice, upTo));
  const credited = toMinor(creditedTotal(db, invoice, upTo));
  const refunded = toMinor(refundedTotal(db, invoice, upTo));
  const remaining = total - paid - credited;
  // A refund settles money the office owed back; it never turns into money the customer owes us, so
  // the amount owed back is floored at zero rather than allowed to go negative.
  const refund = paid + credited - total - refunded;
  return {
    total: fromMinor(total),
    paid: fromMinor(paid),
    credited: fromMinor(credited),
    refunded: fromMinor(refunded),
    outstanding: fromMinor(remaining > 0 ? remaining : 0),
    refundDue: fromMinor(refund > 0 ? refund : 0),
    settled: remaining <= 0 && refund <= 0,
  };
}

/** The credit notes on a set of invoices, for a report that has to state what was credited. */
export function creditedBetween(db: Database, from: string, to: string): CreditNote[] {
  return db.creditNotes.filter((note) => note.status === "issued" && note.issuedOn >= from && note.issuedOn <= to);
}
