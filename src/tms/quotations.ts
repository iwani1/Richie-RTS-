// A quotation as a document: its number, how long the price holds, and what it says (RNT-04, D-117).
//
// Two gaps were worth closing together, because a customer meets them at the same moment.
//
//   * **A quotation had no number.** The request had one — RR-0001 — but the sheet the customer reads
//     was identified only by the request behind it, so "which version of this price am I agreeing to?"
//     had no answer a person could write down. Now every issue draws `QUO-0001` from its own series and
//     carries a revision number, and a renewal keeps the number with revision 2, 3, …
//   * **It had no terms and no clock.** The price was said to be valid "until" a date computed in whole
//     days from the moment of issue, which is not how a validity period behaves: a quote issued at 16:50
//     on a Friday for seven days ends at a different hour from one issued at 09:10, and the office had
//     nothing it could print about deposit, cancellation or what the price includes. The period is now
//     held in **hours** and counted to the minute, and the terms are the company's own words — the
//     build invents none (there is no default text, and a company that has not written any cannot
//     issue a quotation).
//
// Nothing here decides a price or sends anything: it shapes the document, and the command in
// `service.ts` writes it.
import { formatAmount, fromMinor, parseAmount, percentOf, percentOfMinor, toMinor } from "./money";
import type { Quote, TaxLine, TaxPosition } from "./types";

/** How long a quotation may hold, in hours: a day to a year. Outside that it is a typo. */
export const VALIDITY_HOURS_MIN = 24;
export const VALIDITY_HOURS_MAX = 8760;

/** How much text a set of terms may carry. Long enough for deposit and cancellation, not a contract. */
export const QUOTATION_TERMS_LIMIT = 2000;

/** The moment a quotation stops holding: its issue time plus the configured hours. */
export function validityEndsAt(quotedAt: string, hours: number): string {
  return new Date(new Date(quotedAt).getTime() + hours * 3_600_000).toISOString();
}

/**
 * Whether a quotation is still live at `now`.
 *
 * Compared to the minute, not the day: a quotation that ran out at 09:00 cannot be accepted at noon,
 * and the office should not be told at one minute past midnight that yesterday's price still stands.
 */
export function quotationIsLive(quote: Quote, now: string): boolean {
  return new Date(quote.validUntil).getTime() >= new Date(now).getTime();
}

/**
 * How the remaining validity reads on a screen or a printed sheet.
 *
 * Days while there is more than a day and a half left, then hours, then the plain statement that it has
 * gone. Never a negative number, and never "0 hours" beside a price somebody can still accept.
 */
export function validityLine(validUntil: string, now: string): string {
  const left = new Date(validUntil).getTime() - new Date(now).getTime();
  if (Number.isNaN(left)) return "The validity of this quotation is not recorded.";
  if (left < 0) return "This quotation has expired.";
  const hours = left / 3_600_000;
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(left / 60_000));
    return `Holds for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;
  }
  if (hours < 36) {
    const whole = Math.floor(hours);
    return `Holds for ${whole} more hour${whole === 1 ? "" : "s"}.`;
  }
  const days = Math.floor(hours / 24);
  return `Holds for ${days} more day${days === 1 ? "" : "s"}.`;
}

/** The number on the quotation: QUO-0001, whatever revision of it this is. */
export function quotationHeading(quote: Quote): string {
  return `${quote.number} (revision ${quote.revision})`;
}

/**
 * Whether a quotation issued before numbering existed can be shown as it is.
 *
 * An old quotation has no number and no terms, and the screen says so rather than printing a made-up
 * reference. It cannot be quoted to a customer as a document, which is exactly what the office needs
 * to know: reissue it.
 */
export function quotationIsNumbered(quote: Quote): boolean {
  return typeof quote.number === "string" && quote.number !== "" && Number.isInteger(quote.revision);
}

/** What a company's terms must satisfy before a quotation can be issued, in words. */
export function termsProblem(terms: string): string | null {
  const text = terms.trim();
  if (!text) return "Quotation terms are not set. An administrator must write them in Settings → Bus rentals.";
  if (text.length > QUOTATION_TERMS_LIMIT) return `Quotation terms are too long (${text.length} characters; the limit is ${QUOTATION_TERMS_LIMIT}).`;
  return null;
}

/** What a validity period must satisfy, in words, or null when it is usable. */
export function validityProblem(hours: number | null): string | null {
  if (hours === null) return "Quotation validity is not set. An administrator must set it in Settings → Bus rentals.";
  if (!Number.isInteger(hours) || hours < VALIDITY_HOURS_MIN || hours > VALIDITY_HOURS_MAX)
    return `Quotation validity must be a whole number of hours from ${VALIDITY_HOURS_MIN} to ${VALIDITY_HOURS_MAX}.`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// The figures under the lines, and the second signature (RNT-04, D-121).
//
// A quotation used to be the line items added up and nothing else: no reduction for the client who
// haggled, no levy, no signature. The invoice beside it had all three, so the sheet the customer
// agreed to and the document they were billed on could differ by more than rounding — and nobody at
// the office could say who had approved a large price.
//
// Four rules, each one a way the two documents drift apart:
//
//   * **One arithmetic.** The discount comes off the lines; tax is charged on what is left; the total
//     is the sum of those three, computed in whole pesewas (money.ts) exactly as the invoice does.
//   * **A reduction is declared, not hidden.** A discount is an amount with a reason beside it, and it
//     may not exceed the price — a negative total is a typing mistake, not an offer.
//   * **The rates are copied.** The tax lines a quotation prints are the rates in force when it was
//     issued, kept on the document. A later rate change must not rewrite a price somebody agreed to.
//   * **A second signature is a policy, and an empty policy is not a signature.** Who signs off a price
//     is the company's decision: until they set the figure at or above which it must happen, the
//     screens say no approval is required rather than pretending every price is checked by two people.

/** The figures a quotation carries, once the lines are known. */
export interface QuoteFigures {
  discountAmount: number;
  taxLines: TaxLine[];
  /** Lines less the discount, plus tax. What the customer owes. */
  total: number;
  /** The deposit: the configured share of the total, not of the untaxed lines. */
  depositRequired: number;
}

export interface QuoteFigureInput {
  subtotal: number;
  /** Decimal text from the form; blank means no discount. */
  discountAmount: string;
  discountReason: string;
  taxPosition: TaxPosition | null;
  taxLines: { name: string; ratePercent: number }[];
  depositPercent: number;
}

export function readQuoteFigures(input: QuoteFigureInput): { errors: Record<string, string>; figures: QuoteFigures } {
  const errors: Record<string, string> = {};
  const parsed = input.discountAmount.trim() === "" ? { amount: 0, problem: null } : parseAmount(input.discountAmount);
  const discount = parsed.amount;
  if (parsed.problem === "too-many-decimals") errors.discountAmount = "Use at most two decimal places: amounts are in pesewas.";
  else if (parsed.problem === "too-large") errors.discountAmount = "That amount looks wrong. Check the figure.";
  else if (parsed.problem) errors.discountAmount = "Enter the discount as an amount of 0 or more, or leave it blank.";
  const reason = input.discountReason.trim();
  if (!errors.discountAmount && discount > 0 && !reason) errors.discountReason = "Give a reason for the discount.";
  if (!errors.discountAmount && discount > 0 && toMinor(discount) > toMinor(input.subtotal)) {
    errors.discountAmount = "The discount is larger than the price, so the total would be negative.";
  }

  const discountedMinor = toMinor(input.subtotal) - toMinor(discount);
  const taxLines: TaxLine[] =
    input.taxPosition === "registered"
      ? input.taxLines.map((line) => ({
          name: line.name,
          ratePercent: line.ratePercent,
          // Each rate is applied once to the discounted subtotal and rounded once, half-up, exactly as
          // the invoice does, so the two documents agree to the pesewa.
          amount: fromMinor(percentOfMinor(discountedMinor, line.ratePercent)),
        }))
      : [];
  const totalMinor = discountedMinor + taxLines.reduce((sum, line) => sum + toMinor(line.amount), 0);
  const total = fromMinor(totalMinor);
  return {
    errors,
    figures: {
      discountAmount: discount,
      taxLines,
      total,
      // A deposit is a share of what the customer actually pays, so it follows the total: charging tax
      // on the price but taking the deposit off the untaxed lines would leave the two figures disagreeing
      // about what 25% means.
      depositRequired: percentOf(total, input.depositPercent),
    },
  };
}

/**
 * Whether this quotation must carry a second signature — and the sentence that says so.
 *
 * Returns null when no approval is required, which includes the case where the company has not set a
 * threshold: an unset policy is "nobody has asked for this", not "everything is approved".
 */
export function approvalRequiredAt(total: number, threshold: number | null): boolean {
  return threshold !== null && Number.isFinite(threshold) && toMinor(total) >= toMinor(threshold);
}

/** True when the price on record has been signed off by a second person. */
export function quotationIsApproved(quote: Quote): boolean {
  return quote.approval !== null && typeof quote.approval.at === "string";
}

/** True when the approval on record belongs to the figure and revision on the quotation now. */
export function approvalIsCurrent(quote: Quote): boolean {
  const approval = quote.approval;
  return approval !== null && toMinor(approval.total) === toMinor(quote.total);
}

/**
 * Why this person cannot sign this quotation off, in words, or null when they can.
 *
 * The rule is four eyes: the person who wrote the price is not the person who approves it. A name is
 * compared as a fallback for quotations written before the author's account was recorded, because a
 * control that silently passes on old records is not a control.
 */
export function approvalProblem(quote: Quote, approverId: string | null, approverName: string): string | null {
  if (approvalIsCurrent(quote)) {
    const who = quote.approval!.byName;
    return `This quotation was already approved by ${who} on ${quote.approval!.at.slice(0, 10)}.`;
  }
  const sameAccount = quote.quotedById !== "" && approverId !== null && quote.quotedById === approverId;
  const sameName = quote.quotedById === "" && quote.quotedBy.trim().toLowerCase() === approverName.trim().toLowerCase();
  if (sameAccount || sameName) {
    return "The person who wrote this quotation cannot also approve it. Somebody else has to sign it off.";
  }
  return null;
}

/** The sentence a screen prints about the signature, or null when there is nothing to say. */
export function approvalLine(quote: Quote, threshold: number | null): string | null {
  if (approvalIsCurrent(quote)) {
    const approval = quote.approval!;
    const note = approval.note ? ` "${approval.note}"` : "";
    return `Approved by ${approval.byName} on ${approval.at.slice(0, 10)}.${note}`;
  }
  if (quote.approval) return `The approval on record was for ${quote.currencyCode} ${formatAmount(quote.approval.total)}, which is not the figure on this revision. It has to be signed off again.`;
  if (approvalRequiredAt(quote.total, threshold)) {
    return `A second signature is required: this price is at or above ${quote.currencyCode} ${formatAmount(threshold!)}.`;
  }
  return threshold === null ? "No approval is required: the company has not set a figure that needs one." : null;
}
