// Spending that is not a repair (FIN-05, D-93).
//
// Costs used to arrive only through an incident or a work order, so the system could hold maintenance
// costs and nothing else. Fuel, tolls, permits, rent and driver allowances had nowhere to go; the
// month's "costs recorded" figure therefore meant "maintenance recorded", which is the most flattering
// possible reading of a transport business's spending.
//
// An expense is a fact an operator types from a receipt. This module never invents a category, a
// method or a rate: categories come from the list in Settings, methods from the company's own list,
// and an expense with no category is reported as "Uncategorised" rather than folded into another line.
//
// Two rules keep the record trustworthy:
//   * it is numbered (EXP-YYYY-NNNN) and filed by the day the money was spent, so a receipt in a
//     shoebox can be traced to a line and a report for a closed month does not move when somebody
//     types a late receipt;
//   * it is never edited. A figure that was wrong when it was written is voided with a reason and
//     entered again, so the number a report was built on stays on the record with its explanation.
import { toCsv } from "./csv";
import { formatAmount, parsePositiveAmount } from "./money";
import { allocateReference } from "./references";
import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type { Database, Expense } from "./types";

export const EXPENSE_COMMAND_TYPES = ["record_expense", "void_expense"] as const;

export interface ExpenseInput {
  incurredOn: string;
  category: string;
  description: string;
  payee: string;
  amount: string;
  method: string;
  receiptReference: string;
  receiptHeld: boolean;
  notes: string;
}

export type ExpenseCommand =
  | { type: "record_expense"; input: ExpenseInput }
  | { type: "void_expense"; id: string; reason: string };

export function isExpenseCommand(command: { type: string }): command is ExpenseCommand {
  return (EXPENSE_COMMAND_TYPES as readonly string[]).includes(command.type);
}

export function executeExpenses(
  db: Database,
  actor: Actor | null,
  command: ExpenseCommand,
  now = new Date().toISOString(),
): CommandResult {
  switch (command.type) {
    case "record_expense": {
      const denied = authorise(actor, "expenses:record");
      if (denied) return denied;
      const errors: Errors = {};
      const input = command.input;

      // No currency, no total: an amount with no currency beside it cannot be added to anything, and
      // a report that guessed one would be inventing a fact (the same rule invoices follow).
      const currencyCode = db.settings.currencyCode;
      if (!currencyCode) {
        return fail("The company currency is not set, so an expense cannot be recorded yet.", {
          currencyCode: "Set the company currency in Settings first.",
        });
      }

      if (!isValidDate(input.incurredOn)) errors.incurredOn = "Enter the date the money was spent.";

      const parsed = parsePositiveAmount(input.amount ?? "");
      const amount = parsed.amount;
      if (parsed.problem === "too-many-decimals") errors.amount = "Use at most two decimal places: amounts are in pesewas.";
      else if (parsed.problem === "too-large") errors.amount = "That amount looks wrong. Check the receipt.";
      else if (parsed.problem) errors.amount = "Enter the amount spent.";

      const description = input.description.trim();
      if (!description) errors.description = "Say what the money was spent on, as it reads on the receipt.";
      else if (description.length > 200) errors.description = "Keep the description to 200 characters.";

      // Categories are the company's own list. An empty one is allowed and reported as uncategorised;
      // a name that is not on the list is refused rather than quietly creating a category.
      const category = input.category.trim();
      if (category && !db.settings.costCategories.includes(category)) {
        errors.category = "Unknown category. Add it in Settings first, or leave it blank.";
      }

      const payee = input.payee.trim();
      if (payee.length > 120) errors.payee = "Keep the name of who was paid to 120 characters.";

      // A method is optional — a fresh installation has no methods configured, and refusing to record
      // real spending until one is typed would push it back onto paper. When one is given it must be
      // one the company recognises.
      const method = input.method.trim();
      if (method && !db.settings.rental.paymentMethods.includes(method)) {
        errors.method = "Unknown method. Add it in Settings first, or leave it blank.";
      }

      const receiptReference = input.receiptReference.trim();
      if (receiptReference.length > 120) errors.receiptReference = "Keep the receipt number to 120 characters.";
      if (input.notes.trim().length > 500) errors.notes = "Keep the note to 500 characters.";
      // A receipt number and the claim that the paper is held are two different facts. Saying the
      // paper is held when no number was written down is almost always a slip, so it is asked about.
      if (input.receiptHeld && !receiptReference) {
        errors.receiptReference = "Write the number on the receipt, or untick that the paper is held.";
      }

      if (Object.keys(errors).length) return fail("Please correct the expense details.", errors);

      const period = input.incurredOn.slice(0, 4);
      const { reference, counters } = allocateReference(db, "expense", period);
      const expense: Expense = {
        id: makeId(),
        reference,
        incurredOn: input.incurredOn,
        category,
        description,
        payee,
        amount,
        currencyCode,
        method,
        receiptReference,
        receiptHeld: input.receiptHeld,
        notes: input.notes.trim(),
        status: "recorded",
        voidReason: null,
        voidedAt: null,
        recordedBy: actor?.fullName ?? "System",
        recordedAt: now,
        updatedAt: now,
      };
      const next = audit(
        { ...db, referenceCounters: counters, expenses: [...db.expenses, expense] },
        actor,
        {
          action: "finance:expense_record",
          entity: "expense",
          entityId: expense.id,
          summary: `${expense.reference} ${expense.currencyCode} ${formatAmount(expense.amount)} on ${expense.incurredOn}: ${description}${category ? ` (${category})` : " (uncategorised)"}${payee ? `, paid to ${payee}` : ""}${receiptReference ? `, receipt ${receiptReference}` : ", no receipt number"}.`,
        },
        now,
      );
      const receiptNote = receiptReference ? ` Receipt ${receiptReference}${input.receiptHeld ? " held" : " recorded as not held"}.` : " No receipt number recorded.";
      return {
        ok: true,
        db: next,
        message: `${expense.reference} recorded: ${expense.currencyCode} ${formatAmount(expense.amount)} on ${expense.incurredOn}.${receiptNote}`,
      };
    }

    case "void_expense": {
      // A wrong amount, a duplicate receipt, money that was refunded by the supplier: the record is
      // voided with a reason and entered again. It keeps its number so the correction can be read
      // later, and it stops counting in every report at once.
      const denied = authorise(actor, "expenses:void");
      if (denied) return denied;
      const expense = db.expenses.find((record) => record.id === command.id);
      if (!expense) return fail("Expense not found.");
      if (expense.status === "void") return fail(`${expense.reference} is already void.`);
      const reason = command.reason.trim();
      if (!reason) return fail("A reason is required.", { reason: "Say why this expense is being voided." });
      if (reason.length > 300) return fail("Keep the reason to 300 characters.", { reason: "Keep the reason to 300 characters." });

      const voided: Expense = { ...expense, status: "void", voidReason: reason, voidedAt: now, updatedAt: now };
      const next = audit(
        { ...db, expenses: db.expenses.map((record) => (record.id === voided.id ? voided : record)) },
        actor,
        {
          action: "finance:expense_void",
          entity: "expense",
          entityId: voided.id,
          summary: `${voided.reference} voided: ${voided.currencyCode} ${formatAmount(voided.amount)} on ${voided.incurredOn}. Reason: ${reason}`,
        },
        now,
      );
      return { ok: true, db: next, message: `${voided.reference} voided. It no longer counts in any report.` };
    }
  }
}

// The expenses screen, written out for a spreadsheet (RPT-04, D-113).
//
// The screen's own figures are handed in rather than recomputed, so a file can never disagree with
// the page it came from. Voided entries are listed with their status and counted in nothing, which is
// what voiding means (D-93). The receipt columns are printed as they stand, including the empty ones:
// spending with no receipt number is a weaker fact and the file says so rather than leaving the cell
// to be read as "fine".
export interface ExpenseExportRow {
  reference: string;
  incurredOn: string;
  category: string;
  description: string;
  payee: string;
  method: string;
  amount: number;
  status: string;
  receiptReference: string;
  receiptHeld: boolean;
  /** Whether a scan is on file for this entry (D-100). */
  hasScan: boolean;
}

export interface ExpenseExport {
  from: string;
  to: string;
  currency: string | null;
  /** Live (not voided) spending in the period, added in whole pesewas. */
  total: number;
  liveCount: number;
  noReceiptCount: number;
  noReceiptAmount: number;
  noScanCount: number;
  byCategory: { name: string; count: number; amount: number }[];
  /** The rows the screen is showing, in the order it shows them. */
  rows: ExpenseExportRow[];
}

const UNCATEGORISED_EXPORT = "Uncategorised";

export function expensesCsv(view: ExpenseExport): string {
  const rows: (string | number)[][] = [
    ["Expenses", `${view.from} to ${view.to}`],
    [],
    ["Metric", "Value"],
    ["Currency", view.currency ?? "Not configured"],
    ["Spent (live entries)", formatAmount(view.total)],
    ["Entries in the period", view.liveCount],
    ["Entries with no receipt number", view.noReceiptCount],
    ["Amount with no receipt number", formatAmount(view.noReceiptAmount)],
    ["Entries with no scan on file", view.noScanCount],
    [],
    ["By category"],
    ["Category", "Entries", "Amount"],
  ];
  if (view.byCategory.length === 0) rows.push(["none", "", ""]);
  for (const group of view.byCategory) rows.push([group.name, group.count, formatAmount(group.amount)]);
  rows.push([]);
  rows.push(["Entries"]);
  rows.push(["Date", "Reference", "Category", "Description", "Payee", "Method", "Amount", "Status", "Receipt number", "Receipt held", "Scan"]);
  if (view.rows.length === 0) rows.push(["none"]);
  for (const row of view.rows) {
    rows.push([
      row.incurredOn,
      row.reference,
      row.category || UNCATEGORISED_EXPORT,
      row.description,
      row.payee,
      row.method,
      formatAmount(row.amount),
      row.status,
      row.receiptReference,
      row.receiptHeld ? "yes" : "no",
      row.hasScan ? "on file" : "none",
    ]);
  }
  return toCsv(rows);
}
