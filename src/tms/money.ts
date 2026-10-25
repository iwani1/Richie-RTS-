// Money (audit D-04).
//
// Every amount in this application is a currency amount with two decimal places. JavaScript numbers
// are binary fractions, so `0.1 + 0.2` is not `0.3` and a naive `Math.round(x * 100) / 100` rounds by
// whatever the nearest double happens to be. That was not academic: with the old helper, 15% VAT on
// GHS 15.90 came out as 2.38 instead of 2.39, and a 25% deposit on GHS 8.54 as 2.13 instead of 2.14
// (3,707 and 16,390 wrong values per million, respectively). A cent wrong on a tax line is a wrong
// document.
//
// So the rule of this module:
//
//   * **Store and pass around ordinary numbers**, because that is what the domain model, the JSON
//     snapshot and the screens use. Nothing outside this file needs to know about minor units.
//   * **Compute in integer pesewas**, never in floating point: every operation below converts to
//     whole cents, does integer arithmetic, and converts back once.
//   * **Parse input as decimal text**, never with `parseFloat`. Three decimals in an amount field is
//     a mistake the operator can see and fix, not something to round on their behalf — and rounding
//     silently here is exactly how the screen and the `numeric(14,2)` column drift apart.
//   * **Round half-up, once**, at the end of each calculation, and state it. Half-up is what a
//     Ghanaian invoice expects: 2.385 rounds to 2.39, and a negative line rounds away from zero.
//
// The conversion `toMinor` is exact for any value that is already a 2-decimal amount: `15.9 * 100`
// is 1589.9999999999998 in binary, but `Math.round` recovers 1590, and for |amount| < 2^45 the error
// is far below half a cent.

/** The largest amount this application accepts, in major units. Above this, a typo is more likely. */
export const MAX_AMOUNT = 1_000_000_000;

/** Cents in one major unit. */
const MINOR_PER_UNIT = 100;

/** Thousandths in one unit of quantity, so `1.5` days is exact integer arithmetic. */
const QUANTITY_SCALE = 1000;

/**
 * A 2-decimal amount as whole pesewas.
 *
 * `Math.round` rather than `Math.trunc`: the value arrives as the nearest double to a 2-decimal
 * decimal, which can sit a hair either side of the true value (15.9 → 1589.9999999999998).
 */
export function toMinor(amount: number): number {
  return Math.round(amount * MINOR_PER_UNIT);
}

/** Whole pesewas back to the amount the rest of the application uses. */
export function fromMinor(minor: number): number {
  return minor / MINOR_PER_UNIT;
}

/** Adds amounts without letting binary fractions accumulate. */
export function sumAmounts(amounts: readonly number[]): number {
  let minor = 0;
  for (const amount of amounts) minor += toMinor(amount);
  return fromMinor(minor);
}

/**
 * `numerator / denominator`, rounded half-up, in integers.
 *
 * Half-up means "away from zero on a tie", so 2.385 → 2.39 and −2.385 → −2.39. That is the rule an
 * invoice reader applies with a pen, and it is symmetric for credit lines.
 */
export function divideHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("divideHalfUp: denominator is zero");
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const rounded = Math.floor((n * 2 + d) / (2 * d));
  return negative ? -rounded : rounded;
}

/**
 * A percentage of an amount, exactly.
 *
 * Rates are percents with at most two decimals (15, 12.5, 33.33). They are turned into integer basis
 * points first, so `subtotal × rate` is integer × integer before a single rounding — which is what
 * makes 15% of 15.90 equal 2.39 rather than 2.38.
 */
export function percentOfMinor(minor: number, ratePercent: number): number {
  const basisPoints = Math.round(ratePercent * 100);
  return divideHalfUp(minor * basisPoints, 100 * 100);
}

/** A percentage of an amount, as an amount. */
export function percentOf(amount: number, ratePercent: number): number {
  return fromMinor(percentOfMinor(toMinor(amount), ratePercent));
}

/**
 * `quantity × unitAmount`, exactly: the quantity is scaled to thousandths, multiplied as integers,
 * and rounded once.
 */
export function lineAmount(quantity: number, unitAmount: number): number {
  const thousandths = Math.round(quantity * QUANTITY_SCALE);
  return fromMinor(divideHalfUp(thousandths * toMinor(unitAmount), QUANTITY_SCALE));
}

/** The total of the line items on a quote, an invoice or a completion record. */
export function linesTotal(lines: readonly { quantity: number; unitAmount: number }[]): number {
  let minor = 0;
  for (const line of lines) {
    const thousandths = Math.round(line.quantity * QUANTITY_SCALE);
    minor += divideHalfUp(thousandths * toMinor(line.unitAmount), QUANTITY_SCALE);
  }
  return fromMinor(minor);
}

/**
 * The total of line items as they are still being typed.
 *
 * A half-filled line is left out instead of counted as zero, so the running subtotal a form shows is
 * the total of the lines that will actually be sent — and it is computed the way the command will
 * compute it, so the figure on screen cannot differ from the figure stored.
 */
export function linesTotalFromText(lines: readonly { quantity: string; unitAmount: string }[]): number {
  const parsed: { quantity: number; unitAmount: number }[] = [];
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity);
    const unitAmount = parseAmount(line.unitAmount);
    if (quantity.problem === null && unitAmount.problem === null) parsed.push({ quantity: quantity.quantity, unitAmount: unitAmount.amount });
  }
  return linesTotal(parsed);
}

/** An amount as the operator reads it: two decimals, no thousands separators (the UI groups). */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

export type MoneyProblem = "blank" | "not-a-number" | "too-many-decimals" | "negative" | "zero" | "too-large";

export interface MoneyParse {
  /** The amount, when it parsed. */
  amount: number;
  /** What was wrong, when it did not. */
  problem: MoneyProblem | null;
}

/**
 * Reads an amount typed by a person.
 *
 * Accepted: digits with an optional decimal point and at most two decimals, with surrounding space.
 * Everything else is refused rather than coerced — `1,000`, `1e3`, `100.005`, `-5`, `NaN`. Callers
 * turn the problem into the sentence that belongs beside the field; this function has no opinion
 * about currency or about whether a negative is meaningful.
 */
export function parseAmount(text: string): MoneyParse {
  const trimmed = text.trim();
  if (!trimmed) return { amount: 0, problem: "blank" };
  // A leading minus is refused here even for lines that could carry one: a discount is entered as a
  // positive amount and negated by the code that builds the line, so a minus in the box is a typo.
  if (trimmed.startsWith("-")) return { amount: 0, problem: "negative" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { amount: 0, problem: "not-a-number" };
  const [, decimals = ""] = trimmed.split(".");
  if (decimals.length > 2) return { amount: 0, problem: "too-many-decimals" };
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) return { amount: 0, problem: "not-a-number" };
  if (amount > MAX_AMOUNT) return { amount: 0, problem: "too-large" };
  return { amount, problem: null };
}

/** The same rules for a monetary amount that must be greater than zero. */
export function parsePositiveAmount(text: string): MoneyParse {
  const parsed = parseAmount(text);
  if (parsed.problem) return parsed;
  if (parsed.amount <= 0) return { amount: 0, problem: "zero" };
  return parsed;
}

/** A quantity typed by a person: greater than zero, at most three decimals. */
export function parseQuantity(text: string): { quantity: number; problem: "blank" | "not-a-number" | "too-many-decimals" | "zero" | null } {
  const trimmed = text.trim();
  if (!trimmed) return { quantity: 0, problem: "blank" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { quantity: 0, problem: "not-a-number" };
  const [, decimals = ""] = trimmed.split(".");
  if (decimals.length > 3) return { quantity: 0, problem: "too-many-decimals" };
  const quantity = Number(trimmed);
  if (!Number.isFinite(quantity)) return { quantity: 0, problem: "not-a-number" };
  if (quantity <= 0) return { quantity: 0, problem: "zero" };
  return { quantity, problem: null };
}

/** A percentage from settings or a tax line: 0–100 with at most two decimals. */
export function isPercentWithTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > 100) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}
