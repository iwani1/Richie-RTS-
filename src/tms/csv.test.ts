// The one CSV writer (RPT-04, D-113).
//
// The cases that matter are the ones a spreadsheet turns into damage: a comma inside a description, a
// quote inside a name, and a cell somebody typed beginning with `=` that the accountant's program
// would run as a formula.
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("one CSV cell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("Diesel, Kumasi depot".replace(", ", " "))).toBe("Diesel Kumasi depot");
    expect(csvCell("GHS 450.00")).toBe("GHS 450.00");
    expect(csvCell(17)).toBe("17");
    expect(csvCell(0)).toBe("0");
  });

  it("quotes a comma, a quote or a line break, and doubles the quote", () => {
    expect(csvCell("Diesel, Kumasi depot")).toBe('"Diesel, Kumasi depot"');
    expect(csvCell('He said "pay Friday"')).toBe('"He said ""pay Friday"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://example.test\")")).toBe('"\'=HYPERLINK(""http://example.test"")"');
    expect(csvCell("+233 24 000 0000")).toBe("'+233 24 000 0000");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5 late")).toBe("'-5 late");
  });

  it("does not defuse a number, because a negative amount is a number", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(-450.05)).toBe("-450.05");
  });

  it("writes null and undefined as empty, and an infinite number as nothing rather than NaN", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("a whole file", () => {
  it("joins cells with commas and rows with newlines, keeping a blank row blank", () => {
    expect(toCsv([["Metric", "Value"], ["Invoiced", "GHS 10.00"], [], ["End", "1"]])).toBe(
      "Metric,Value\nInvoiced,GHS 10.00\n\nEnd,1",
    );
  });

  it("has no trailing newline, so a reader does not see a phantom row", () => {
    expect(toCsv([["a"]]).endsWith("\n")).toBe(false);
  });
});
