// One CSV writer for every export in the program (RPT-04, D-113).
//
// Three reports had grown their own copy of the same two lines, and each copy was a little different.
// The screens that total money — the finance home, a customer's statement, the fleet dashboard — had
// no export at all. One writer means one answer to "what does a cell look like", and one place to fix
// it when the answer is wrong.
//
// Two rules, both about spreadsheets rather than about this program:
//
//   * **Quote anything that would break the row.** A comma, a quote or a line break inside a cell has
//     to be quoted, and the quote doubled. Half the text in this program is typed by people —
//     descriptions, reasons, customer names — so this is not a theoretical case.
//   * **Defuse a cell that a spreadsheet would execute.** A cell beginning `=`, `+`, `-` or `@` is a
//     formula in Excel, LibreOffice and Google Sheets. A description typed as `=HYPERLINK(...)` is a
//     real way to attack the accountant who opens the file, and it is not the kind of thing a person
//     entering an expense should have to think about. Such text is prefixed with an apostrophe, which
//     those programs show as text. **Numbers are not defused** — a negative amount is a number and
//     must stay one — so the rule applies to text only.
const UNSAFE_START = /^[=+\-@\t\r]/;

/** One cell, quoted if it has to be, and defused if a spreadsheet would run it. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = UNSAFE_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows in, one CSV string out. An empty row is a blank line — the existing reports use them. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
