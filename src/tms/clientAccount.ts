// What a client owes, stated to the client (CLI-03, D-114).
//
// The portal could say what was agreed with a customer — the routes, the roster, the term of the
// agreement — and not what the customer owed. That is the question a client contact is actually rung
// up to answer, and answering it from a screen the customer can open is the whole point of a corporate
// dashboard.
//
// Four rules, and each of them is a figure the customer could otherwise read wrongly:
//
//   * **The balance is the shared rule**, not a second one written for the portal: `invoiceBalance`
//     (D-86) already knows that outstanding is total − paid − credited and that a cancelled payment
//     never arrived (D-88). A portal that subtracted on its own would be another place for the same
//     figure to disagree with the invoice the customer is holding.
//   * **A void invoice never appears** — it never asked for money — and nothing is shown as at a date
//     before it was issued.
//   * **Nothing is netted quietly.** An invoice credited below what was paid says "Refund due", and an
//     over-credited account keeps its negative sign, because a zero would hide money the office owes
//     back (D-92).
//   * **A mixed-currency account states no total.** Adding cedis to dollars produces a number that is
//     not money; the invoices are still listed, each with its own currency.
//
// Everything is added in whole pesewas and converted once (audit D-04), so a hundred receipts cannot
// land a pesewa out.
import { invoiceBalance, isLivePayment, isLiveRefund } from "./creditNotes";
import { fromMinor, toMinor } from "./money";
import type { Database, Invoice } from "./types";

/** How one invoice stands, in a word a customer understands. */
export type ClientInvoiceState = "Awaiting payment" | "Part paid" | "Overdue" | "Part paid, overdue" | "Settled" | "Refund due";

export interface ClientInvoiceRow {
  id: string;
  reference: string;
  issuedOn: string;
  dueOn: string;
  currencyCode: string;
  /** What the invoice asked for. */
  total: number;
  paid: number;
  credited: number;
  /** Still owed on this invoice: total − paid − credited, floored at zero. */
  outstanding: number;
  /** Still owed back by the office on this invoice. */
  refundDue: number;
  /** Whole days past the due date; 0 while it is not yet due or nothing is owed on it. */
  daysOverdue: number;
  state: ClientInvoiceState;
}

export interface ClientPaymentRow {
  id: string;
  reference: string;
  invoiceReference: string;
  paidOn: string;
  method: string;
  amount: number;
  currencyCode: string;
}

/** Money taken off an invoice, or money paid back: both change what the customer owes. */
export interface ClientAdjustmentRow {
  id: string;
  kind: "creditNote" | "refund";
  reference: string;
  invoiceReference: string;
  date: string;
  amount: number;
  currencyCode: string;
  /** Why it happened. Required on both, and the reason a customer asks about. */
  reason: string;
}

export interface ClientAccountTotals {
  currencyCode: string;
  billed: number;
  received: number;
  credited: number;
  refunded: number;
  /** What the customer owes on the invoices that are still open. */
  outstanding: number;
  /** The part of `outstanding` that is past its due date. */
  overdue: number;
  /** The oldest money still owed is this many days past its due date; 0 when nothing is late. */
  oldestDaysOverdue: number;
}

export type ClientAccountStatus = "ok" | "no_invoices" | "mixed_currency";

export interface ClientAccount {
  asAt: string;
  status: ClientAccountStatus;
  message: string;
  /** The single currency the account is kept in, or null when there is nothing to add up. */
  currencyCode: string | null;
  /** Null when the invoices disagree about currency: no total is stated rather than a wrong one. */
  totals: ClientAccountTotals | null;
  invoices: ClientInvoiceRow[];
  payments: ClientPaymentRow[];
  adjustments: ClientAdjustmentRow[];
}

const ymd = (iso: string) => iso.slice(0, 10);

/** Whole days from `earlier` to `later`, in UTC so a daylight-saving hour cannot move a date. */
function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Where one invoice stands, in words, from the balance the shared rule produced.
 *
 * The state is never inferred from the stored status alone: an invoice marked `issued` whose money has
 * since been recorded is settled in fact, and the customer reading the row is owed the fact.
 */
function stateOf(balance: { paid: number; credited: number; outstanding: number; refundDue: number }, daysOverdue: number): ClientInvoiceState {
  if (balance.refundDue > 0) return "Refund due";
  if (balance.outstanding <= 0) return "Settled";
  const part = balance.paid > 0 || balance.credited > 0;
  if (daysOverdue > 0) return part ? "Part paid, overdue" : "Overdue";
  return part ? "Part paid" : "Awaiting payment";
}

/**
 * The account of one client, as at a date, from a snapshot already narrowed to that client.
 *
 * `db` is the payload the server sent this account: its own invoices and the payments, credit notes
 * and refunds against them. This function adds nothing of its own and reads no other collection, so it
 * cannot widen what the account may see.
 */
export function clientAccount(db: Database, asAt: string): ClientAccount {
  const base: ClientAccount = {
    asAt,
    status: "no_invoices",
    message: "",
    currencyCode: null,
    totals: null,
    invoices: [],
    payments: [],
    adjustments: [],
  };

  // A void invoice never asked for money, and one dated after the date asked for has not been sent.
  const live: Invoice[] = db.invoices
    .filter((invoice) => invoice.status !== "void" && ymd(invoice.issuedOn) <= asAt)
    .sort((a, b) => (a.issuedOn === b.issuedOn ? a.reference.localeCompare(b.reference) : a.issuedOn < b.issuedOn ? 1 : -1));

  if (live.length === 0) {
    return { ...base, message: "Nothing has been billed to this account yet." };
  }

  const invoices: ClientInvoiceRow[] = live.map((invoice) => {
    const balance = invoiceBalance(db, invoice, asAt);
    const daysOverdue = balance.outstanding > 0 ? Math.max(daysBetween(invoice.dueOn, asAt), 0) : 0;
    return {
      id: invoice.id,
      reference: invoice.reference,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      currencyCode: invoice.currencyCode,
      total: balance.total,
      paid: balance.paid,
      credited: balance.credited,
      outstanding: balance.outstanding,
      refundDue: balance.refundDue,
      daysOverdue,
      state: stateOf(balance, daysOverdue),
    };
  });

  const invoiceIds = new Set(live.map((invoice) => invoice.id));
  const referenceOf = new Map(live.map((invoice) => [invoice.id, invoice.reference]));

  const payments: ClientPaymentRow[] = db.payments
    .filter((payment) => invoiceIds.has(payment.invoiceId) && isLivePayment(payment) && ymd(payment.paidOn) <= asAt)
    .map((payment) => ({
      id: payment.id,
      reference: payment.reference,
      invoiceReference: referenceOf.get(payment.invoiceId) ?? "",
      paidOn: payment.paidOn,
      method: payment.method,
      amount: payment.amount,
      currencyCode: payment.currencyCode,
    }))
    .sort((a, b) => (a.paidOn === b.paidOn ? a.reference.localeCompare(b.reference) : a.paidOn < b.paidOn ? 1 : -1));

  const liveRefunds = db.refunds.filter(
    (refund) => invoiceIds.has(refund.invoiceId) && isLiveRefund(refund) && ymd(refund.paidOn) <= asAt,
  );

  const adjustments: ClientAdjustmentRow[] = [
    ...db.creditNotes
      .filter((note) => invoiceIds.has(note.invoiceId) && note.status === "issued" && ymd(note.issuedOn) <= asAt)
      .map((note) => ({
        id: note.id,
        kind: "creditNote" as const,
        reference: note.reference,
        invoiceReference: note.invoiceReference,
        date: note.issuedOn,
        amount: note.total,
        currencyCode: note.currencyCode,
        reason: note.reason,
      })),
    ...liveRefunds.map((refund) => ({
        id: refund.id,
        kind: "refund" as const,
        reference: refund.reference,
        invoiceReference: refund.invoiceReference,
        date: refund.paidOn,
        amount: refund.amount,
        currencyCode: refund.currencyCode,
        reason: refund.reason,
      })),
  ].sort((a, b) => (a.date === b.date ? a.reference.localeCompare(b.reference) : a.date < b.date ? 1 : -1));

  const currencies = new Set(invoices.map((invoice) => invoice.currencyCode));
  if (currencies.size > 1) {
    return {
      ...base,
      status: "mixed_currency",
      message: `These invoices are in ${[...currencies].sort().join(", ")}. They are listed one by one, but they cannot be added together.`,
      invoices,
      payments,
      adjustments,
    };
  }

  const currencyCode = [...currencies][0] ?? null;
  const sum = (pick: (row: ClientInvoiceRow) => number) => invoices.reduce((total, row) => total + toMinor(pick(row)), 0);
  return {
    ...base,
    status: "ok",
    currencyCode,
    totals: {
      currencyCode: currencyCode ?? "",
      billed: fromMinor(sum((row) => row.total)),
      received: fromMinor(sum((row) => row.paid)),
      credited: fromMinor(sum((row) => row.credited)),
      refunded: fromMinor(liveRefunds.reduce((total, refund) => total + toMinor(refund.amount), 0)),
      outstanding: fromMinor(sum((row) => row.outstanding)),
      overdue: fromMinor(invoices.reduce((total, row) => total + (row.daysOverdue > 0 ? toMinor(row.outstanding) : 0), 0)),
      oldestDaysOverdue: invoices.reduce((oldest, row) => Math.max(oldest, row.daysOverdue), 0),
    },
    invoices,
    payments,
    adjustments,
  };
}
