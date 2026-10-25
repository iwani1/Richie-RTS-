// A customer's statement of account: everything that moved on their invoices in a period, with the
// balance carried in, the balance carried out, and how old the money still owed is (FIN-02, D-90).
//
// An invoice answers "what is this bill?". A statement answers the question the office asks every
// month and could not answer before: "what does this customer owe us, and since when?" — the paper a
// business sends when it chases money, and the only view in this system that reads *all* of one
// customer's documents together.
//
// Three rules keep it honest:
//
//   * **The arithmetic is the shared balance rule**, not a second one written for this screen.
//     `invoiceBalance` (D-86) already knows that outstanding is total − paid − credited and that a
//     cancelled payment never arrived (D-88). A statement that subtracted on its own would be the
//     fourth place for those figures to disagree, which is exactly what D-86 exists to prevent.
//   * **The period is bounded on both ends.** The opening balance is the customer's balance as at the
//     day before the period starts, so a statement for one month still shows the arrears it inherited.
//     Payments and credit notes are filed by their own dates, not by the invoice they belong to.
//   * **Nothing is netted quietly.** An over-credited account shows a negative balance and the words
//     "in credit", because a zero would hide money the office owes back.
//
// Every amount is added in whole pesewas and converted once (audit D-04): floats show a pesewa of
// balance that nobody can find.
import { invoiceBalance, liveCreditNotes, livePayments } from "./creditNotes";
import { formatAmount, fromMinor, toMinor } from "./money";
import type { Database, Invoice } from "./types";

/** What a row on the statement is. Debits add to what the customer owes; credits take away. */
export type StatementRowKind = "invoice" | "creditNote" | "payment";

export interface StatementRow {
  id: string;
  /** The date it happened: the invoice date, the credit note date, the day the money arrived. */
  date: string;
  kind: StatementRowKind;
  reference: string;
  description: string;
  /** What it added to the debt (an invoice). */
  debit: number;
  /** What it took off the debt (a payment or a credit note). */
  credit: number;
  /** What the customer owed after this row. Negative means the office owes them. */
  balance: number;
}

/** One invoice still owing money as at the statement date, and how late it is. */
export interface AgedInvoice {
  invoiceId: string;
  reference: string;
  issuedOn: string;
  dueOn: string;
  outstanding: number;
  /** Whole days past the due date; 0 while it is not yet due. */
  daysOverdue: number;
  bucket: AgeBucket;
}

export type AgeBucket = "notYetDue" | "days1to30" | "days31to60" | "days61plus";

export interface StatementAgeing {
  notYetDue: number;
  days1to30: number;
  days31to60: number;
  days61plus: number;
  total: number;
}

export type CustomerStatementStatus =
  | "ok"
  | "no_customer"
  | "no_invoices"
  | "mixed_currency"
  | "invalid_range";

export interface CustomerStatement {
  customerName: string;
  /** Null when the customer has no live invoice, or when their invoices disagree about currency. */
  currencyCode: string | null;
  from: string;
  to: string;
  /** What they already owed when the period began. Negative means they were in credit. */
  openingBalance: number;
  /** What they owe when the period ends. Negative means the office owes them. */
  closingBalance: number;
  invoiced: number;
  received: number;
  credited: number;
  rows: StatementRow[];
  openInvoices: AgedInvoice[];
  ageing: StatementAgeing;
  status: CustomerStatementStatus;
  message: string;
}

/** A customer the office can print a statement for, with what they owe as at the date asked for. */
export interface StatementCustomer {
  name: string;
  clientId: string | null;
  invoiceCount: number;
  currencyCode: string | null;
  outstanding: number;
  /** The oldest money still owed is this late; 0 when nothing is overdue. */
  oldestDaysOverdue: number;
}

/** Invoices with no customer name are grouped under this, as the financial report does. */
export const UNNAMED_CUSTOMER = "No customer named";

const ymd = (iso: string) => iso.slice(0, 10);

/** `YYYY-MM-DD` shifted by whole days, in UTC so a daylight-saving hour cannot move a date. */
function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `earlier` to `later`; negative when `later` is before `earlier`. */
function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * A real calendar date. `Date.parse("2026-02-30T00:00:00Z")` quietly rolls over to 2 March, so the
 * round trip is the check: only a date that survives it unchanged was a date.
 */
const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** The customer name an invoice belongs to on a statement. */
export function statementNameOf(invoice: Invoice): string {
  return invoice.customerName.trim() || UNNAMED_CUSTOMER;
}

/**
 * The money one invoice contributes to a customer's balance as at a date.
 *
 * Signed, and never floored: an invoice that has been credited below what was paid contributes a
 * negative amount, which is what turns into "in credit" on the statement. The flooring in
 * `invoiceBalance` belongs to a single invoice's "amount due" line, not to a running account.
 */
function signedBalance(db: Database, invoice: Invoice, upTo: string): number {
  const balance = invoiceBalance(db, invoice, upTo);
  return toMinor(balance.total) - toMinor(balance.paid) - toMinor(balance.credited);
}

/** Same-day order: the bill, then what came off it, then what was paid. */
const KIND_ORDER: Record<StatementRowKind, number> = { invoice: 0, creditNote: 1, payment: 2 };

/**
 * Everybody the office can print a statement for: the customers on live invoices, which is the only
 * key the documents share. A customer who has been invoiced and fully paid still appears — that is
 * the customer most likely to ask for a statement.
 */
export function statementCustomers(db: Database, asAt: string): StatementCustomer[] {
  const groups = new Map<string, Invoice[]>();
  for (const invoice of db.invoices) {
    if (invoice.status === "void" || invoice.issuedOn > asAt) continue;
    const name = statementNameOf(invoice);
    const existing = groups.get(name);
    if (existing) existing.push(invoice);
    else groups.set(name, [invoice]);
  }

  return [...groups.entries()]
    .map(([name, invoices]) => {
      const currencies = new Set(invoices.map((invoice) => invoice.currencyCode));
      const outstandingMinor = invoices.reduce((sum, invoice) => sum + Math.max(signedBalance(db, invoice, asAt), 0), 0);
      const oldestDaysOverdue = invoices.reduce((oldest, invoice) => {
        if (signedBalance(db, invoice, asAt) <= 0) return oldest;
        return Math.max(oldest, daysBetween(invoice.dueOn, asAt));
      }, 0);
      return {
        name,
        clientId: invoices.find((invoice) => invoice.clientId)?.clientId ?? null,
        invoiceCount: invoices.length,
        currencyCode: currencies.size === 1 ? [...currencies][0] : null,
        outstanding: fromMinor(outstandingMinor),
        oldestDaysOverdue,
      };
    })
    .sort((a, b) => (a.outstanding === b.outstanding ? a.name.localeCompare(b.name) : b.outstanding - a.outstanding));
}

function bucketFor(daysOverdue: number): AgeBucket {
  if (daysOverdue <= 0) return "notYetDue";
  if (daysOverdue <= 30) return "days1to30";
  if (daysOverdue <= 60) return "days31to60";
  return "days61plus";
}

/**
 * One customer's account for a period.
 *
 * The rows are what moved between `from` and `to`; the opening balance is the account as at the day
 * before `from`. Together they must equal the account as at `to` worked out from the invoices
 * themselves, and a test asserts exactly that — it is the check that catches a row being filed on the
 * wrong date.
 */
export function customerStatement(db: Database, customerName: string, from: string, to: string): CustomerStatement {
  const name = customerName.trim();
  const empty: StatementAgeing = { notYetDue: 0, days1to30: 0, days31to60: 0, days61plus: 0, total: 0 };
  const base = { customerName: name, currencyCode: null, from, to, openingBalance: 0, closingBalance: 0, invoiced: 0, received: 0, credited: 0, rows: [], openInvoices: [], ageing: empty };

  if (!name) return { ...base, status: "no_customer", message: "Choose a customer to see their statement." };
  if (!isDate(from) || !isDate(to) || from > to) {
    return { ...base, status: "invalid_range", message: "Choose a period that starts on or before the day it ends." };
  }

  // A void invoice never asked for money, so it never appears on a statement — not even as a zero row.
  const invoices = db.invoices.filter(
    (invoice) => invoice.status !== "void" && statementNameOf(invoice) === name && invoice.issuedOn <= to,
  );
  if (invoices.length === 0) {
    return { ...base, status: "no_invoices", message: `${name} has no invoice dated on or before ${to}, so there is nothing to state.` };
  }

  // Adding pounds to cedis is not a statement; say so instead of printing one total.
  const currencies = new Set(invoices.map((invoice) => invoice.currencyCode));
  if (currencies.size > 1) {
    return {
      ...base,
      status: "mixed_currency",
      message: `${name}'s invoices are in ${[...currencies].sort().join(", ")}. A statement cannot add different currencies, so it is not prepared until they agree.`,
    };
  }
  const currencyCode = [...currencies][0] ?? db.settings.currencyCode;

  const dayBefore = shiftDays(from, -1);
  const openingMinor = invoices.reduce(
    (sum, invoice) => (invoice.issuedOn <= dayBefore ? sum + signedBalance(db, invoice, dayBefore) : sum),
    0,
  );

  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));

  type Draft = Omit<StatementRow, "balance">;
  const drafts: Draft[] = [];

  for (const invoice of invoices) {
    if (invoice.issuedOn < from) continue;
    drafts.push({
      id: invoice.id,
      date: invoice.issuedOn,
      kind: "invoice",
      reference: invoice.reference,
      description: "Invoice issued",
      debit: invoice.total,
      credit: 0,
    });
  }

  // Only credit notes that still stand: a void one took nothing off the bill (D-86).
  for (const invoice of invoices) {
    for (const note of liveCreditNotes(db, invoice.id, to)) {
      if (note.issuedOn < from) continue;
      drafts.push({
        id: note.id,
        date: note.issuedOn,
        kind: "creditNote",
        reference: note.reference,
        description: note.reason || "Credit note",
        debit: 0,
        credit: note.total,
      });
    }
  }

  // Only payments that still count: a cancelled payment never arrived, so stating it (or its
  // cancellation) would put money on the customer's page that they never sent (D-88).
  for (const payment of livePayments(db, to)) {
    if (!invoiceIds.has(payment.invoiceId)) continue;
    if (ymd(payment.paidOn) < from) continue;
    drafts.push({
      id: payment.id,
      date: ymd(payment.paidOn),
      kind: "payment",
      reference: payment.reference,
      description: payment.method ? `Payment received — ${payment.method}` : "Payment received",
      debit: 0,
      credit: payment.amount,
    });
  }

  drafts.sort((a, b) =>
    a.date === b.date
      ? KIND_ORDER[a.kind] === KIND_ORDER[b.kind]
        ? a.reference.localeCompare(b.reference)
        : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      : a.date < b.date
        ? -1
        : 1,
  );

  let running = openingMinor;
  const rows: StatementRow[] = drafts.map((draft) => {
    running += toMinor(draft.debit) - toMinor(draft.credit);
    return { ...draft, balance: fromMinor(running) };
  });

  const openInvoices: AgedInvoice[] = invoices
    .map((invoice) => {
      const balance = invoiceBalance(db, invoice, to);
      const daysOverdue = Math.max(0, daysBetween(invoice.dueOn, to));
      return {
        invoiceId: invoice.id,
        reference: invoice.reference,
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        outstanding: balance.outstanding,
        daysOverdue,
        bucket: bucketFor(balance.outstanding > 0 ? daysOverdue : 0),
      };
    })
    .filter((row) => toMinor(row.outstanding) > 0)
    .sort((a, b) => (a.dueOn === b.dueOn ? a.reference.localeCompare(b.reference) : a.dueOn < b.dueOn ? -1 : 1));

  const ageing: StatementAgeing = openInvoices.reduce(
    (totals, row) => {
      totals[row.bucket] += toMinor(row.outstanding);
      return totals;
    },
    { notYetDue: 0, days1to30: 0, days31to60: 0, days61plus: 0, total: 0 },
  );
  const aged: StatementAgeing = {
    notYetDue: fromMinor(ageing.notYetDue),
    days1to30: fromMinor(ageing.days1to30),
    days31to60: fromMinor(ageing.days31to60),
    days61plus: fromMinor(ageing.days61plus),
    total: fromMinor(ageing.notYetDue + ageing.days1to30 + ageing.days31to60 + ageing.days61plus),
  };

  const closingMinor = running;
  const invoicedMinor = drafts.filter((draft) => draft.kind === "invoice").reduce((sum, draft) => sum + toMinor(draft.debit), 0);
  const receivedMinor = drafts.filter((draft) => draft.kind === "payment").reduce((sum, draft) => sum + toMinor(draft.credit), 0);
  const creditedMinor = drafts.filter((draft) => draft.kind === "creditNote").reduce((sum, draft) => sum + toMinor(draft.credit), 0);

  const money = (minor: number) => `${currencyCode} ${formatAmount(fromMinor(minor))}`;
  const oldest = openInvoices.reduce((worst, row) => Math.max(worst, row.daysOverdue), 0);
  const message =
    closingMinor > 0
      ? `${name} owes ${money(closingMinor)} as at ${to}${oldest > 0 ? `, of which ${money(toMinor(aged.days61plus) + toMinor(aged.days31to60) + toMinor(aged.days1to30))} is past its due date and ${oldest} days is the oldest` : ", and nothing is past its due date"}.`
      : closingMinor < 0
        ? `${name} is in credit by ${money(-closingMinor)} as at ${to}: they have paid or been credited more than they were invoiced.`
        : `${name}'s account is settled as at ${to}.`;

  return {
    customerName: name,
    currencyCode,
    from,
    to,
    openingBalance: fromMinor(openingMinor),
    closingBalance: fromMinor(closingMinor),
    invoiced: fromMinor(invoicedMinor),
    received: fromMinor(receivedMinor),
    credited: fromMinor(creditedMinor),
    rows,
    openInvoices,
    ageing: aged,
    status: "ok",
    message,
  };
}
