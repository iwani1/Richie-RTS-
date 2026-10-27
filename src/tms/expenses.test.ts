// Spending that is not a repair (FIN-05, D-93).
//
// The failure this file guards against is a quiet one: before expenses existed, "costs recorded" meant
// "maintenance recorded", because every cost had to hang off an incident or a work order. A month of
// fuel and tolls simply was not in the report, and the report did not say so.
//
// So these tests assert three things: an expense is a real, numbered record with the receipt facts on
// it; it lands in the one cost report every other figure is built from; and voiding it removes it from
// that report while keeping the number and the reason.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { costReport } from "./costs";
import { expensesCsv, type ExpenseExport, type ExpenseExportRow } from "./expenses";
import type { Actor, Credential, CommandResult } from "./service";
import { emptyDatabase, emptyRentalSettings, type Database, type Expense, type User } from "./types";

const AT = "2026-06-10T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

function createUser(id: string, fullName: string, role: User["role"]): User {
  return {
    id,
    fullName,
    email: `${id}@example.test`,
    role,
    active: true,
    driverId: null,
    clientId: null,
    passengerId: null,
    primaryContact: false,
    passwordHash: cred.passwordHash,
    passwordSalt: cred.passwordSalt,
    createdAt: AT,
    updatedAt: AT,
  };
}

const FINANCE: Actor = { id: "u-fin", fullName: "Finance Officer", role: "finance" };
const OPS: Actor = { id: "u-ops", fullName: "Ops Planner", role: "operations" };
const DRIVER: Actor = { id: "u-driver", fullName: "Kofi Driver", role: "driver" };

function world(overrides: Partial<Database> = {}): Database {
  const base = emptyDatabase();
  return {
    ...base,
    users: [createUser("u-fin", "Finance Officer", "finance"), createUser("u-ops", "Ops Planner", "operations")],
    settings: {
      ...base.settings,
      currencyCode: "GHS",
      costCategories: ["Fuel", "Tolls", "Permits"],
      rental: { ...emptyRentalSettings(), paymentMethods: ["Cash", "Bank transfer", "Mobile money"] },
    },
    ...overrides,
  };
}

interface Harness {
  db: Database;
}

const step = (w: Harness, command: AnyCommand, actor: Actor = FINANCE): CommandResult => {
  const result = executeCommand(w.db, actor, command, AT);
  if (!result.ok) throw new Error(`${command.type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  w.db = result.db;
  return result;
};
const attempt = (w: Harness, command: AnyCommand, actor: Actor = FINANCE): CommandResult => executeCommand(w.db, actor, command, AT);
const errorsOf = (result: CommandResult): Record<string, string> => (result.ok ? {} : result.errors);

const expense = (overrides: Record<string, unknown> = {}) => ({
  incurredOn: "2026-06-05",
  category: "Fuel",
  description: "Diesel, Kumasi depot",
  payee: "Total Filling Station",
  amount: "320.50",
  method: "Cash",
  receiptReference: "RCPT-0091",
  receiptHeld: true,
  notes: "",
  ...overrides,
});

const recorded = (overrides: Partial<Expense> = {}): Expense => ({
  id: "ex1",
  reference: "EXP-2026-0001",
  incurredOn: "2026-06-05",
  category: "Fuel",
  description: "Diesel, Kumasi depot",
  payee: "Total Filling Station",
  amount: 320.5,
  currencyCode: "GHS",
  method: "Cash",
  receiptReference: "RCPT-0091",
  receiptHeld: true,
  notes: "",
  status: "recorded",
  voidReason: null,
  voidedAt: null,
  recordedBy: "Finance Officer",
  recordedAt: AT,
  updatedAt: AT,
  ...overrides,
});

describe("recording an expense (D-93)", () => {
  it("numbers it, keeps the receipt facts, and files it by the day the money was spent", () => {
    const w: Harness = { db: world() };
    const result = step(w, { type: "record_expense", input: expense() });

    expect(w.db.expenses).toHaveLength(1);
    const saved = w.db.expenses[0];
    expect(saved.reference).toBe("EXP-2026-0001");
    expect(saved).toMatchObject({
      incurredOn: "2026-06-05",
      category: "Fuel",
      payee: "Total Filling Station",
      amount: 320.5,
      currencyCode: "GHS",
      method: "Cash",
      receiptReference: "RCPT-0091",
      receiptHeld: true,
      status: "recorded",
      recordedBy: "Finance Officer",
    });
    if (result.ok) expect(result.message).toMatch(/EXP-2026-0001 recorded: GHS 320\.50 on 2026-06-05\. Receipt RCPT-0091 held\./);
    expect(w.db.audit[0].action).toBe("finance:expense_record");
    // The money spent is not an invoice, a payment or a refund: it is a fact of its own.
    expect(w.db.invoices).toHaveLength(0);
    expect(w.db.payments).toHaveLength(0);
  });

  it("counts in the one cost report, as its own kind of line", () => {
    const w: Harness = { db: world() };
    step(w, { type: "record_expense", input: expense() });
    step(w, { type: "record_expense", input: expense({ incurredOn: "2026-06-08", category: "Tolls", amount: "17.00", receiptReference: "TR-2" }) });
    // Outside the period: it must not be counted there, because it was not spent there.
    step(w, { type: "record_expense", input: expense({ incurredOn: "2026-07-02", amount: "99.00", receiptReference: "RCPT-3" }) });

    const report = costReport(w.db, "2026-06-01", "2026-06-30");
    expect(report.lines.map((line) => [line.source, line.sourceReference, line.amount])).toEqual([
      ["expense", "EXP-2026-0001", 320.5],
      ["expense", "EXP-2026-0002", 17],
    ]);
    expect(report.total).toBe(337.5);
    expect(report.expenseCount).toBe(2);
    expect(report.expenseTotal).toBe(337.5);
    expect(report.expensesWithoutReceipt).toBe(0);
    expect(report.expensesWithReceiptHeld).toBe(2);
    expect(report.message).toMatch(/2 standalone expenses \(2 with the paper receipt held\)/);
  });

  it("refuses an unknown category, method or empty description rather than inventing one", () => {
    const w: Harness = { db: world() };
    const refused = attempt(
      w,
      { type: "record_expense", input: expense({ description: "  ", category: "Snacks", method: "Barter", incurredOn: "2026-02-30" }) },
    );
    expect(refused.ok).toBe(false);
    expect(errorsOf(refused)).toMatchObject({
      description: "Say what the money was spent on, as it reads on the receipt.",
      category: "Unknown category. Add it in Settings first, or leave it blank.",
      method: "Unknown method. Add it in Settings first, or leave it blank.",
      incurredOn: "Enter the date the money was spent.",
    });
    expect(w.db.expenses).toHaveLength(0);
  });

  it("lets an expense be uncategorised, and refuses to say the paper is held without a receipt number", () => {
    const w: Harness = { db: world() };
    // No category is a real answer, and it is reported as "Uncategorised" rather than guessed at.
    step(w, { type: "record_expense", input: expense({ category: "", receiptReference: "", receiptHeld: false }) });
    expect(w.db.expenses[0].category).toBe("");
    expect(w.db.expenses[0].receiptReference).toBe("");

    const slip = attempt(w, { type: "record_expense", input: expense({ receiptHeld: true, receiptReference: "" }) });
    expect(slip.ok).toBe(false);
    expect(errorsOf(slip).receiptReference).toMatch(/Write the number on the receipt/);
  });

  it("refuses to record spending before the company currency is set", () => {
    const base = world();
    const w: Harness = { db: { ...base, settings: { ...base.settings, currencyCode: null } } };
    const refused = attempt(w, { type: "record_expense", input: expense() });
    expect(refused.ok).toBe(false);
    expect(errorsOf(refused).currencyCode).toMatch(/Set the company currency in Settings first/);
    expect(w.db.expenses).toHaveLength(0);
  });

  it("voids once, with a reason, and the voided entry stops counting everywhere", () => {
    const w: Harness = { db: world({ expenses: [recorded()] }) };
    const id = w.db.expenses[0].id;

    expect(attempt(w, { type: "void_expense", id, reason: "" }).ok).toBe(false);
    const cancelled = step(w, { type: "void_expense", id, reason: "Receipt was for the other vehicle and already recorded" });
    expect(w.db.expenses[0]).toMatchObject({ status: "void", voidReason: "Receipt was for the other vehicle and already recorded", voidedAt: AT });
    // The number stays: a correction has to be readable next to what it corrected.
    expect(w.db.expenses[0].reference).toBe("EXP-2026-0001");
    if (cancelled.ok) expect(cancelled.message).toBe("EXP-2026-0001 voided. It no longer counts in any report.");

    const report = costReport(w.db, "2026-06-01", "2026-06-30");
    expect(report.lines).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.expenseCount).toBe(0);

    const twice = attempt(w, { type: "void_expense", id, reason: "Again" });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.message).toMatch(/is already void/);

    expect(w.db.audit[0].action).toBe("finance:expense_void");
  });

  it("is a finance job: operations reads spending but does not enter or void it", () => {
    const w: Harness = { db: world() };
    expect(attempt(w, { type: "record_expense", input: expense() }, OPS).ok).toBe(false);
    expect(w.db.expenses).toHaveLength(0);

    step(w, { type: "record_expense", input: expense() });
    const id = w.db.expenses[0].id;
    expect(attempt(w, { type: "void_expense", id, reason: "Mine now" }, OPS).ok).toBe(false);
    expect(w.db.expenses[0].status).toBe("recorded");

    // A driver has no business reading the company's spending at all; the service refuses before it
    // can reach a collection the server would not even send them.
    expect(attempt(w, { type: "record_expense", input: expense() }, DRIVER).ok).toBe(false);
  });
});

// The expenses screen, written out for a spreadsheet (RPT-04, D-113). The builder is handed the
// screen's figures rather than recomputing them, so these tests pin the shape of the file: a heading
// on every block, a voided entry present but counted in nothing, and the receipt facts printed as
// they stand.
describe("the expenses spreadsheet", () => {
  const row = (overrides: Partial<ExpenseExportRow> = {}): ExpenseExportRow => ({
    reference: "EXP-2026-0001",
    incurredOn: "2026-06-05",
    category: "Fuel",
    description: "Diesel, Kumasi depot",
    payee: "Total Filling Station",
    method: "Cash",
    amount: 320.5,
    status: "Recorded",
    receiptReference: "RCPT-0091",
    receiptHeld: true,
    hasScan: true,
    ...overrides,
  });

  const view = (overrides: Partial<ExpenseExport> = {}): ExpenseExport => ({
    from: "2026-06-01",
    to: "2026-06-30",
    currency: "GHS",
    total: 320.5,
    liveCount: 1,
    noReceiptCount: 0,
    noReceiptAmount: 0,
    noScanCount: 0,
    byCategory: [{ name: "Fuel", count: 1, amount: 320.5 }],
    rows: [row()],
    ...overrides,
  });

  it("writes the period's figures, the categories and every entry", () => {
    const lines = expensesCsv(view()).split("\n");
    expect(lines[0]).toBe("Expenses,2026-06-01 to 2026-06-30");
    expect(lines).toContain("Currency,GHS");
    expect(lines).toContain("Spent (live entries),320.50");
    expect(lines).toContain("Entries with no receipt number,0");
    expect(lines).toContain("Category,Entries,Amount");
    expect(lines).toContain("Fuel,1,320.50");
    // The description carries a comma, so the cell is quoted rather than breaking the row.
    expect(lines).toContain('2026-06-05,EXP-2026-0001,Fuel,"Diesel, Kumasi depot",Total Filling Station,Cash,320.50,Recorded,RCPT-0091,yes,on file');
  });

  it("says none rather than ending a block silently, and keeps the weak receipt facts visible", () => {
    const lines = expensesCsv(
      view({
        byCategory: [],
        rows: [row({ category: "", receiptReference: "", receiptHeld: false, hasScan: false, status: "Void" })],
      }),
    ).split("\n");
    expect(lines).toContain("none,,");
    expect(lines).toContain("2026-06-05,EXP-2026-0001,Uncategorised,\"Diesel, Kumasi depot\",Total Filling Station,Cash,320.50,Void,,no,none");
  });

  it("exports nothing as none, rather than an empty file that looks like a quiet month", () => {
    const lines = expensesCsv(view({ total: 0, liveCount: 0, byCategory: [], rows: [] })).split("\n");
    expect(lines).toContain("Spent (live entries),0.00");
    expect(lines[lines.length - 1]).toBe("none");
  });
});
