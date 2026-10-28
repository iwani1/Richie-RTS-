// The customer's yes to a quotation (RNT-05, D-116).
//
// The gap this closes is small and expensive: a quotation went out, the customer agreed on the phone,
// and the next thing the record knew was the deposit. So the two questions a dispute turns on — *who
// agreed, and to what figure* — had no answer that was not somebody's memory.
//
// Three rules, and each one is a way an agreement can be misunderstood:
//
//   * **A yes applies to one quotation.** The acceptance copies the quotation's own timestamp and
//     figures. A requote after acceptance does not inherit it: the screen says the customer agreed to
//     the old figure, and the office can see the difference rather than discovering it in a dispute.
//   * **An expired quotation cannot be accepted.** Saying yes to a price that has lapsed is not an
//     agreement the office can act on, and quietly accepting it would bind nobody. The refusal says to
//     issue a new one.
//   * **A yes is recorded once.** Accepting the same quotation twice is refused with the name and date
//     of the first, so the record cannot be rewritten by pressing a button again.
//
// Nothing here decides the price or changes the rental's status: accepting a quotation is not the
// same act as taking the deposit, and the deposit stays where it was (D-90's rule, one money rule).
import { formatAmount } from "./money";
import { quotationIsLive } from "./quotations";
import { PRE_QUOTE_STATUSES } from "./rentalWorkflow";
import { approvalIsCurrent, approvalRequiredAt } from "./quotations";
import type { Rental, RentalAcceptance } from "./types";

/** How long a note on an acceptance may be. A sentence, not a paragraph. */
export const ACCEPTANCE_NOTE_LIMIT = 200;

/**
 * How the customer's answer stands, as a word a screen can print.
 *
 *   none       — nobody has said yes yet
 *   current    — they agreed to the quotation on the record now
 *   superseded — they agreed to an earlier quotation; the figure has changed since
 *   expired    — a quotation is out and its validity date has passed, so it cannot be accepted
 */
export type AcceptanceState = "none" | "current" | "superseded" | "expired";

const ymd = (value: string) => value.slice(0, 10);

/** True when the acceptance is for the quotation the rental carries now. */
export function acceptanceIsCurrent(rental: Rental): boolean {
  const acceptance = rental.acceptance;
  if (!acceptance || !rental.quote) return false;
  return acceptance.quotedAt === rental.quote.quotedAt;
}

/**
 * How the answer stands at `now` — a moment, not a date, because a price can run out at 09:00 on a day
 * the customer rings at noon (D-117 moved validity from whole days to hours for exactly this reason).
 */
export function acceptanceStateOf(rental: Rental, now: string): AcceptanceState {
  if (rental.acceptance) return acceptanceIsCurrent(rental) ? "current" : "superseded";
  if (rental.quote && !quotationIsLive(rental.quote, now)) return "expired";
  return "none";
}

/** The sentence a screen prints about the customer's answer. Empty when there is nothing to say. */
export function acceptanceLine(rental: Rental, now: string): string {
  const acceptance = rental.acceptance;
  const state = acceptanceStateOf(rental, now);
  if (!acceptance) {
    if (state === "expired") return "The quotation's validity date has passed, so it cannot be accepted as it stands.";
    return "";
  }
  const when = acceptance.at.slice(0, 10);
  const figure = `${acceptance.currencyCode} ${formatAmount(acceptance.total)}`;
  const how = acceptance.channel === "client_portal" ? "in the customer portal" : "by phone, recorded by the office";
  if (state === "current") {
    return `${acceptance.byName} accepted the quotation of ${figure} on ${when} (${how}).`;
  }
  return `${acceptance.byName} accepted the quotation of ${figure} on ${when} (${how}), but the quotation has been replaced since. The figure on record now is different.`;
}

export interface AcceptanceProblems {
  [field: string]: string;
}

/**
 * Whether this rental can be accepted now, in words the office can act on.
 *
 * The same check runs in the service and on the screen: the screen hides the button, the service
 * refuses the command, and neither is the control on its own (the rule D-60 set out).
 */
export function canAcceptQuotation(rental: Rental, now: string, approvalThreshold: number | null = null): AcceptanceProblems {
  const problems: AcceptanceProblems = {};
  if (PRE_QUOTE_STATUSES.includes(rental.status)) {
    problems.status = "No quotation has been issued yet, so there is nothing to accept.";
  } else if (rental.status === "accepted") {
    // Agreed and unpaid. The sentence names who agreed and when, because that is the thing the office
    // is about to be asked about on the phone.
    problems.acceptance = rental.acceptance
      ? `This quotation was already accepted on ${ymd(rental.acceptance.at)} by ${rental.acceptance.byName}.`
      : "The customer has already agreed to this quotation; the deposit is what confirms the hire.";
  } else if (rental.status === "confirmed" || rental.status === "dispatched" || rental.status === "completed") {
    problems.status = `This rental was already agreed and is ${rental.status === "dispatched" ? "under way" : rental.status}.`;
  } else if (rental.status === "declined" || rental.status === "cancelled") {
    problems.status = "A declined or cancelled rental cannot be accepted.";
  }
  if (!rental.quote) problems.quote = "There is no quotation on this rental to accept.";
  else if (!quotationIsLive(rental.quote, now)) {
    problems.quote = `The quotation expired on ${ymd(rental.quote.validUntil)}. Issue a new one before the customer accepts.`;
  }
  // A price the company has not finished checking is not one to put in front of a customer as agreed
  // (RNT-04, D-121). The words are the customer's, not the office's: they do not need to know who
  // signs what internally, only that the figure is not ready to accept yet.
  if (rental.quote && !problems.quote && approvalRequiredAt(rental.quote.total, approvalThreshold) && !approvalIsCurrent(rental.quote)) {
    problems.approval = "The office is still checking this price, so it cannot be accepted yet. Call them if it is urgent.";
  }
  if (Object.keys(problems).length === 0 && acceptanceIsCurrent(rental)) {
    problems.acceptance = `This quotation was already accepted on ${rental.acceptance!.at.slice(0, 10)} by ${rental.acceptance!.byName}.`;
  }
  return problems;
}

/**
 * The record to write when a customer says yes.
 *
 * Handed the rental and who is recording it, so the figures and the quotation's identity come from the
 * record rather than from whatever the browser sent.
 */
export function buildAcceptance(
  rental: Rental,
  by: { actorId: string | null; name: string; channel: RentalAcceptance["channel"] },
  note: string,
  now: string,
): RentalAcceptance {
  const quote = rental.quote!;
  return {
    at: now,
    byActorId: by.actorId,
    byName: by.name,
    channel: by.channel,
    quotedAt: quote.quotedAt,
    total: quote.subtotal,
    depositRequired: quote.depositRequired,
    currencyCode: quote.currencyCode,
    note: note.trim().slice(0, ACCEPTANCE_NOTE_LIMIT),
  };
}
