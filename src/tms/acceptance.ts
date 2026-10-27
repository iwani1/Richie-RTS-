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

export function acceptanceStateOf(rental: Rental, today: string): AcceptanceState {
  if (rental.acceptance) return acceptanceIsCurrent(rental) ? "current" : "superseded";
  if (rental.quote && ymd(rental.quote.validUntil) < today) return "expired";
  return "none";
}

/** The sentence a screen prints about the customer's answer. Empty when there is nothing to say. */
export function acceptanceLine(rental: Rental, today: string): string {
  const acceptance = rental.acceptance;
  const state = acceptanceStateOf(rental, today);
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
export function canAcceptQuotation(rental: Rental, today: string): AcceptanceProblems {
  const problems: AcceptanceProblems = {};
  if (rental.status === "draft") {
    problems.status = "No quotation has been issued yet, so there is nothing to accept.";
  } else if (rental.status === "confirmed" || rental.status === "in_progress" || rental.status === "completed") {
    problems.status = `This rental was already agreed and is ${rental.status === "in_progress" ? "under way" : rental.status}.`;
  } else if (rental.status === "declined" || rental.status === "cancelled") {
    problems.status = "A declined or cancelled rental cannot be accepted.";
  }
  if (!rental.quote) problems.quote = "There is no quotation on this rental to accept.";
  else if (ymd(rental.quote.validUntil) < today) {
    problems.quote = `The quotation expired on ${ymd(rental.quote.validUntil)}. Issue a new one before the customer accepts.`;
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
