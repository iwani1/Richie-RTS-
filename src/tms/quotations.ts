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
import type { Quote } from "./types";

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
