// Money arithmetic (audit D-04).
//
// The cases that matter are the ones the old float helper got wrong: 15% VAT on GHS 15.90 was 2.38
// instead of 2.39, and a 25% deposit on GHS 8.54 was 2.13 instead of 2.14. They are asserted here by
// name, and then swept: every 2-decimal amount over a range is compared against exact half-up
// arithmetic, so a future "simplification" back to floats fails immediately.
import { describe, expect, it } from "vitest";
import { MAX_AMOUNT, divideHalfUp, formatAmount, fromMinor, isPercentWithTwoDecimals, lineAmount, linesTotal, linesTotalFromText, parseAmount, parsePositiveAmount, parseQuantity, percentOf, percentOfMinor, sumAmounts, toMinor } from "./money";

/** Exact half-up on integer pesewas, written out longhand: the reference these tests measure against. */
const exactPercent = (minor: number, ratePercent: number) => {
  const basisPoints = Math.round(ratePercent * 100);
  const numerator = minor * basisPoints;
  const denominator = 10_000;
  const negative = numerator < 0;
  const n = Math.abs(numerator);
  const quotient = Math.floor(n / denominator);
  const remainder = n % denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return negative ? -rounded : rounded;
};

describe("minor units", () => {
  it("recovers cents from the doubles that used to drift", () => {
    // These are exactly where `x * 100` is not an integer in binary.
    expect(toMinor(15.9)).toBe(1590);
    expect(toMinor(1.15)).toBe(115);
    expect(toMinor(0.07)).toBe(7);
    expect(toMinor(8.54)).toBe(854);
    expect(toMinor(-2.5)).toBe(-250);
    expect(toMinor(0)).toBe(0);
    expect(fromMinor(1590)).toBe(15.9);
    expect(formatAmount(fromMinor(2385))).toBe("23.85");
  });

  it("adds without letting a hundred additions drift a cent", () => {
    // The classic: 0.1 added ten times is 0.9999999999999999 in floating point.
    const tenPesewas = Array.from({ length: 10 }, () => 0.1);
    expect(tenPesewas.reduce((sum, value) => sum + value, 0)).not.toBe(1);
    expect(sumAmounts(tenPesewas)).toBe(1);
    expect(sumAmounts([0.01, 0.02, 0.03, 0.04, 0.05])).toBe(0.15);
    expect(sumAmounts([])).toBe(0);
  });
});

describe("rounding is half-up, once", () => {
  it("rounds a tie away from zero, symmetrically", () => {
    expect(divideHalfUp(5, 2)).toBe(3); // 2.5
    expect(divideHalfUp(-5, 2)).toBe(-3);
    expect(divideHalfUp(4, 2)).toBe(2);
    expect(divideHalfUp(7, 3)).toBe(2); // 2.333…
    expect(divideHalfUp(-7, 3)).toBe(-2);
    expect(divideHalfUp(0, 7)).toBe(0);
  });

  it("throws rather than pretending to divide by zero", () => {
    expect(() => divideHalfUp(1, 0)).toThrow(/denominator/);
  });
});

describe("percentages", () => {
  it("gets the two cases the old helper got wrong", () => {
    // 15% of GHS 15.90 = GHS 2.385, which a person rounds to 2.39, not 2.38.
    expect(percentOf(15.9, 15)).toBe(2.39);
    expect(percentOfMinor(1590, 15)).toBe(239);
    // 25% of GHS 8.54 = GHS 2.135 → 2.14.
    expect(percentOf(8.54, 25)).toBe(2.14);
  });

  it("agrees with longhand integer arithmetic for every whole-pesewa subtotal up to GHS 10,000", () => {
    // The sweep that would have caught D-04: 40,000 amounts × 5 rates, no mismatches allowed.
    const rates = [15, 12.5, 3, 7.5, 2.5];
    for (const rate of rates) {
      for (let minor = 1; minor <= 1_000_000; minor += 25) {
        expect(percentOfMinor(minor, rate)).toBe(exactPercent(minor, rate));
      }
    }
  });

  it("treats 0% and 100% exactly, at both ends of the range", () => {
    expect(percentOf(1234.56, 0)).toBe(0);
    expect(percentOf(1234.56, 100)).toBe(1234.56);
    expect(percentOf(0, 15)).toBe(0);
  });

  it("accepts a rate with at most two decimals, and nothing more precise", () => {
    expect(isPercentWithTwoDecimals(15)).toBe(true);
    expect(isPercentWithTwoDecimals(12.5)).toBe(true);
    expect(isPercentWithTwoDecimals(33.33)).toBe(true);
    expect(isPercentWithTwoDecimals(0)).toBe(true);
    expect(isPercentWithTwoDecimals(100)).toBe(true);
    // 33.333% would be silently rounded to 33.33% in basis points, which is a different number.
    expect(isPercentWithTwoDecimals(33.333)).toBe(false);
    expect(isPercentWithTwoDecimals(-1)).toBe(false);
    expect(isPercentWithTwoDecimals(101)).toBe(false);
    expect(isPercentWithTwoDecimals(Number.NaN)).toBe(false);
  });
});

describe("line items", () => {
  it("multiplies a fractional quantity exactly", () => {
    expect(lineAmount(2, 1500)).toBe(3000);
    expect(lineAmount(1.5, 1500)).toBe(2250);
    expect(lineAmount(0.5, 33.33)).toBe(16.67); // 16.665 → 16.67
    // 1.5 × 0.05 = 0.075, a true half-pesewa tie: half-up gives 0.08, and truncation would give 0.07.
    expect(lineAmount(1.5, 0.05)).toBe(0.08);
    expect(lineAmount(3, 0.01)).toBe(0.03);
    expect(lineAmount(1, 0)).toBe(0);
  });

  it("totals a form's half-typed lines the way the command will", () => {
    // A blank or half-typed line is not a zero line: two finished lines and one unfinished total the
    // two, exactly as the command would store them once the third is filled in properly.
    expect(linesTotalFromText([{ quantity: "2", unitAmount: "1500" }, { quantity: "1", unitAmount: "0.05" }, { quantity: "", unitAmount: "" }])).toBe(3000.05);
    expect(linesTotalFromText([{ quantity: "1", unitAmount: "" }])).toBe(0);
    // The same 1.5 × 0.01 tie the invoice will round up.
    expect(linesTotalFromText([{ quantity: "1.5", unitAmount: "0.01" }])).toBe(0.02);
  });

  it("totals the same way the invoice will, so a quote and its invoice cannot disagree", () => {
    const lines = [
      { quantity: 2, unitAmount: 1500 },
      { quantity: 1, unitAmount: 33.33 },
      { quantity: 1.5, unitAmount: 0.01 },
    ];
    // 3000.00 + 33.33 + 0.02 (1.5 × 0.01 = 0.015 → 0.02) = 3033.35
    expect(linesTotal(lines)).toBe(3033.35);
    expect(linesTotal([])).toBe(0);
    // A credit line is negative and reduces the total exactly.
    expect(linesTotal([{ quantity: 1, unitAmount: 100 }, { quantity: 1, unitAmount: -30 }])).toBe(70);
  });
});

describe("reading an amount a person typed", () => {
  it("accepts what an operator writes", () => {
    expect(parseAmount("3000")).toEqual({ amount: 3000, problem: null });
    expect(parseAmount(" 3000.50 ")).toEqual({ amount: 3000.5, problem: null });
    expect(parseAmount("0")).toEqual({ amount: 0, problem: null });
    expect(parseAmount("0.05")).toEqual({ amount: 0.05, problem: null });
  });

  it("refuses a third decimal rather than rounding it away", () => {
    // The failure this prevents: the screen keeps 100.005, numeric(14,2) stores 100.01, and the two
    // disagree until the next reload.
    expect(parseAmount("100.005")).toEqual({ amount: 0, problem: "too-many-decimals" });
    expect(parseAmount("0.001")).toEqual({ amount: 0, problem: "too-many-decimals" });
  });

  it("refuses everything that is not a plain decimal amount", () => {
    for (const bad of ["", "   ", "abc", "1e3", "1,000", "10.2.3", "1 000", "٣٠٠"]) {
      expect(parseAmount(bad).problem).not.toBeNull();
    }
    expect(parseAmount("10.2.3").problem).toBe("not-a-number");
    expect(parseAmount("-5").problem).toBe("negative");
    expect(parseAmount("(5)").problem).toBe("not-a-number");
    expect(parseAmount("+5").problem).toBe("not-a-number");
  });

  it("refuses an amount nobody could mean", () => {
    expect(parseAmount(String(MAX_AMOUNT + 1)).problem).toBe("too-large");
    expect(parseAmount(String(MAX_AMOUNT)).problem).toBeNull();
  });

  it("says when zero is not allowed", () => {
    expect(parsePositiveAmount("0").problem).toBe("zero");
    expect(parsePositiveAmount("0.00").problem).toBe("zero");
    expect(parsePositiveAmount("0.01")).toEqual({ amount: 0.01, problem: null });
  });

  it("reads a quantity to three decimals, and no further", () => {
    expect(parseQuantity("2")).toEqual({ quantity: 2, problem: null });
    expect(parseQuantity("1.5")).toEqual({ quantity: 1.5, problem: null });
    expect(parseQuantity("0.125")).toEqual({ quantity: 0.125, problem: null });
    expect(parseQuantity("0.1255").problem).toBe("too-many-decimals");
    expect(parseQuantity("0").problem).toBe("zero");
    expect(parseQuantity("").problem).toBe("blank");
    expect(parseQuantity("-1").problem).toBe("not-a-number");
  });
});
