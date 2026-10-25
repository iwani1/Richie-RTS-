// The finance home screen's figures (brief FIN-07).
//
// The brief asks for a money-only home screen for finance; until now that role landed on the
// operations dashboard, which is built around runs, rosters and the fleet. This module answers the
// three questions a finance officer opens the system with:
//
//   what came in and what went out in the period   — the figures from `financialReport`, unchanged;
//   the margin, and only when it can be trusted     — hires billed less costs recorded, shown only
//                                                     when both sides are complete (see below);
//   who owes us money, and how late                 — invoices past their due date, at today's date;
//   what work is waiting on me                       — unbilled completed hires, and payments that
//                                                     have been recorded but not yet verified or
//                                                     reconciled.
//
// Two rules keep it honest:
//
//   * **One set of books.** The period figures are `financialReport(db, from, to)` — the very same
//     function the Reports screen and its CSV use (Q-29, D-78). This module adds no figure of its
//     own to that set, so the dashboard can never disagree with the report behind it.
//   * **Open work is not a period figure.** Overdue invoices, unbilled hires and unverified payments
//     are measured **as at today**, not inside the chosen period: they are things to do now, and a
//     deadline does not disappear because somebody changed a date filter. Each one says the date it
//     is measured against.
//
// Money is added in whole pesewas (money.ts, audit D-04) and every amount is withheld when the
// company currency is not configured, because a total without a currency is a guess.

import { billableEventFor, outstanding } from "./finance";
import { financialReport, type ExpensesByCategory, type FinancialReport, type RevenueByCustomer } from "./financialReport";
import { fromMinor, toMinor } from "./money";
import type { Database, Payment } from "./types";

export interface OverdueInvoice {
  id: string;
  reference: string;
  customerName: string;
  issuedOn: string;
  dueOn: string;
  /** Whole days past the due date as at the day this is read. Always at least 1. */
  daysOverdue: number;
  outstanding: number;
}

export interface UnbilledHire {
  rentalId: string;
  reference: string;
  customerName: string;
  /** The completion record's date, which is when the money was earned. */
  completedOn: string;
  /** What the completion record says the hire came to. Null when it recorded no total. */
  finalTotal: number | null;
}

export interface AwaitingPayment {
  id: string;
  reference: string;
  invoiceReference: string;
  customerName: string;
  amount: number;
  paidOn: string;
  status: Payment["status"];
  /** The next step a finance officer can take: verify it, or reconcile it. */
  nextStep: "verify" | "reconcile";
}

/**
 * The margin, and whether it can honestly be stated.
 *
 * The brief says margin is shown only when cost and revenue data are sufficient, so "sufficient" is
 * a written rule rather than a feeling: a currency, at least one invoice in the period, at least one
 * recorded cost, and **no completed hire in the period left unbilled** — because an unbilled hire is
 * revenue that exists and has not been written down yet, which would make a margin overstated. When
 * the rule fails, the figure is withheld and `reason` says what is missing.
 */
export interface MarginView {
  available: boolean;
  revenue: number | null;
  costs: number | null;
  amount: number | null;
  /** `amount ÷ revenue` as a fraction, or null when revenue is zero or the figure is withheld. */
  percent: number | null;
  reason: string;
}

export interface FinanceHome {
  /** The period the money figures cover, and the day the open work is measured against. */
  from: string;
  to: string;
  asAt: string;
  currencyCode: string | null;
  /** Straight from `financialReport` — nothing recomputed here. */
  figures: {
    invoicedTotal: number;
    invoiceCount: number;
    receivedTotal: number;
    paymentCount: number;
    outstandingTotal: number;
    outstandingCount: number;
    expensesTotal: number;
    expenseLineCount: number;
    costPerTrip: number | null;
    costPerPassenger: number | null;
    completedTrips: number;
    passengersBoarded: number;
  };
  /**
   * Hires billed less costs recorded for the period, with the money that came in kept separate.
   * `movement` is cash; `margin` is what the work earned. They differ by what is owed and what was
   * spent before it was billed, and the screen shows both rather than one blended number.
   */
  margin: MarginView;
  movement: { received: number; expenses: number; difference: number } | null;
  byCustomer: RevenueByCustomer[];
  byCategory: ExpensesByCategory[];
  overdue: OverdueInvoice[];
  overdueTotal: number;
  unbilled: UnbilledHire[];
  awaitingPayments: AwaitingPayment[];
  awaitingTotal: number;
  coverage: FinancialReport["coverage"];
  status: "ok" | "currency_not_set";
  message: string;
}

const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/**
 * The finance home figures.
 *
 * `asAt` is the day the open work is measured against and defaults to `to`; the screen passes today,
 * so a period ending in the past still shows the invoices that are late now.
 */
export function financeHome(db: Database, from: string, to: string, asAt: string = to): FinanceHome {
  const report = financialReport(db, from, to);
  const currencyCode = db.settings.currencyCode;

  // --- who owes us money, and how late (as at `asAt`) ------------------------------------------
  const overdue: OverdueInvoice[] = [];
  for (const invoice of db.invoices) {
    // A void invoice is not owed, and an invoice paid in full is not late. Everything else with a
    // due date before the day being read is late, whether or not part of it has been paid.
    if (invoice.status === "void" || invoice.status === "paid") continue;
    const late = daysBetween(invoice.dueOn, asAt);
    if (!(late >= 1)) continue;
    const owed = outstanding(db, invoice);
    if (toMinor(owed) <= 0) continue;
    overdue.push({
      id: invoice.id,
      reference: invoice.reference,
      customerName: invoice.customerName,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      daysOverdue: late,
      outstanding: owed,
    });
  }
  overdue.sort((a, b) => (a.daysOverdue === b.daysOverdue ? a.reference.localeCompare(b.reference) : b.daysOverdue - a.daysOverdue));

  // --- completed hires nobody has billed (as at `asAt`) ---------------------------------------
  // A hire counts as unbilled when it is completed and no live invoice exists for its completion
  // record. The billable-event key is the same one the invoice command enforces, so this cannot
  // list something the office is unable to bill.
  const unbilled: UnbilledHire[] = db.rentals
    .filter((rental) => rental.status === "completed" && !db.invoices.some((invoice) => invoice.billableEvent === billableEventFor(rental.id) && invoice.status !== "void"))
    .map((rental) => ({
      rentalId: rental.id,
      reference: rental.reference,
      customerName: db.clients.find((client) => client.id === rental.clientId)?.name ?? "",
      completedOn: (rental.finalInvoice?.issuedAt ?? rental.updatedAt).slice(0, 10),
      finalTotal: rental.finalInvoice ? rental.finalInvoice.total : null,
    }))
    .filter((hire) => hire.completedOn <= asAt)
    .sort((a, b) => (a.completedOn === b.completedOn ? a.reference.localeCompare(b.reference) : a.completedOn < b.completedOn ? -1 : 1));

  // --- payments recorded but not yet taken all the way --------------------------------------
  const awaitingPayments: AwaitingPayment[] = db.payments
    .filter((payment) => payment.status !== "reconciled")
    .map((payment) => {
      const invoice = db.invoices.find((candidate) => candidate.id === payment.invoiceId);
      return {
        id: payment.id,
        reference: payment.reference,
        invoiceReference: invoice?.reference ?? "invoice missing",
        customerName: invoice?.customerName ?? "",
        amount: payment.amount,
        paidOn: payment.paidOn,
        status: payment.status,
        nextStep: payment.status === "recorded" ? ("verify" as const) : ("reconcile" as const),
      };
    })
    .sort((a, b) => (a.paidOn === b.paidOn ? a.reference.localeCompare(b.reference) : a.paidOn < b.paidOn ? -1 : 1));

  const sum = (amounts: number[]) => fromMinor(amounts.reduce((total, amount) => total + toMinor(amount), 0));

  // --- the margin, if the period's data can carry one (FIN-07) --------------------------------
  const unbilledInPeriod = unbilled.filter((hire) => hire.completedOn >= from && hire.completedOn <= to);
  const margin: MarginView = (() => {
    const withheld = (reason: string): MarginView => ({ available: false, revenue: null, costs: null, amount: null, percent: null, reason });
    if (currencyCode === null) return withheld("No company currency is configured, so no amount is stated.");
    if (report.invoiceCount === 0) return withheld("No invoice was issued in the period, so there is no revenue to measure a margin against.");
    if (report.expenseLineCount === 0) return withheld("No cost was recorded in the period, so a margin would only repeat the revenue.");
    if (unbilledInPeriod.length > 0)
      return withheld(
        `${unbilledInPeriod.length} completed hire${unbilledInPeriod.length === 1 ? "" : "s"} in the period ${unbilledInPeriod.length === 1 ? "has" : "have"} no invoice yet, so revenue is incomplete.`,
      );
    const amount = fromMinor(toMinor(report.invoicedTotal) - toMinor(report.expensesTotal));
    const revenueMinor = toMinor(report.invoicedTotal);
    return {
      available: true,
      revenue: report.invoicedTotal,
      costs: report.expensesTotal,
      amount,
      percent: revenueMinor > 0 ? Math.round(((toMinor(amount) / revenueMinor) * 1000)) / 1000 : null,
      reason: "",
    };
  })();

  return {
    from,
    to,
    asAt,
    currencyCode,
    figures: {
      invoicedTotal: report.invoicedTotal,
      invoiceCount: report.invoiceCount,
      receivedTotal: report.receivedTotal,
      paymentCount: report.paymentCount,
      outstandingTotal: report.outstandingTotal,
      outstandingCount: report.outstandingCount,
      expensesTotal: report.expensesTotal,
      expenseLineCount: report.expenseLineCount,
      costPerTrip: report.costPerTrip,
      costPerPassenger: report.costPerPassenger,
      completedTrips: report.completedTrips,
      passengersBoarded: report.passengersBoarded,
    },
    movement:
      currencyCode === null
        ? null
        : {
            received: report.receivedTotal,
            expenses: report.expensesTotal,
            difference: fromMinor(toMinor(report.receivedTotal) - toMinor(report.expensesTotal)),
          },
    margin,
    byCustomer: report.revenueByCustomer,
    byCategory: report.expensesByCategory,
    overdue,
    overdueTotal: sum(overdue.map((invoice) => invoice.outstanding)),
    unbilled,
    awaitingPayments,
    awaitingTotal: sum(awaitingPayments.map((payment) => payment.amount)),
    coverage: report.coverage,
    status: currencyCode === null ? "currency_not_set" : "ok",
    message:
      currencyCode === null
        ? "No company currency is configured, so amounts are withheld. An administrator sets it in Settings."
        : overdue.length === 0
          ? `Nothing is overdue as at the ${asAt}.`
          : `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} overdue as at the ${asAt}.`,
  };
}
