// The scanned receipt (Q-51 answered 2026-10-26, D-100).
//
// Four things are being pinned here, and each one is a way this feature could quietly go wrong:
//
//   1. **It is finance's paper, not operations'.** Operations reads the expense register because fuel
//      and tolls are part of what its runs cost; it must not read the supplier's photograph. The
//      refusal is in the command layer, so hiding a button cannot be the only guard.
//   2. **One scan on file.** Filing a second replaces the first rather than sitting beside it, and the
//      replaced row keeps its file and says what happened to it.
//   3. **Nothing is deleted.** Removing a scan is a fact with a reason and a time, recorded on the row
//      and in the audit trail, because "why is there no scan on this expense?" is asked a year later.
//   4. **A voided expense takes no paper.** Filing evidence against a figure no report counts would
//      attach a receipt to spending the business has said was not real.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { receiptFor, RECEIPT_LIMITS, receiptProblems, type ReceiptUpload } from "./receipts";
import { execute, type Actor } from "./service";
import { emptyDatabase, type Database, type Expense } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

interface World {
  db: Database;
  admin: Actor;
  finance: Actor;
  ops: Actor;
  expense: Expense;
}

function run(db: Database, actor: Actor | null, command: AnyCommand, now = NOW): Database {
  const result = executeCommand(db, actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}

function refuse(db: Database, actor: Actor | null, command: AnyCommand) {
  const result = executeCommand(db, actor, command, NOW);
  if (result.ok) throw new Error(`${command.type} was accepted and should not have been`);
  return result;
}

const upload = (overrides: Partial<ReceiptUpload> = {}): ReceiptUpload => ({
  originalName: "Total filing 4 Aug.pdf",
  mimeType: "application/pdf",
  byteSize: 184_320,
  sha256: "c".repeat(64),
  storedName: "rcpt_9f2c1ab34d5e6f708192a3b4.pdf",
  ...overrides,
});

function build(): World {
  let db = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin: Actor = { id: db.users[0].id, fullName: "Admin One", role: "administrator" };
  db = run(db, admin, { type: "create_user", input: { fullName: "Fin", email: "fin@example.test", role: "finance", active: true }, credential: cred });
  db = run(db, admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  const finance: Actor = { id: db.users[1].id, fullName: "Fin", role: "finance" };
  const ops: Actor = { id: db.users[2].id, fullName: "Ops", role: "operations" };
  db = run(db, admin, {
    type: "update_settings",
    input: { ...db.settings, companyName: "Richie Transport Services", currencyCode: "GHS", vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }], shifts: [] },
  });
  db = run(db, finance, {
    type: "record_expense",
    input: {
      incurredOn: "2026-06-01",
      category: "",
      description: "Diesel at the Total station",
      payee: "Total",
      amount: "240.00",
      method: "",
      receiptReference: "TF-88421",
      receiptHeld: true,
      notes: "",
    },
  });
  return { db, admin, finance, ops, expense: db.expenses[0] };
}

describe("filing the scanned copy of a receipt", () => {
  it("files a scan against the expense and keeps who filed it", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });

    const filed = receiptFor(w.db, w.expense.id);
    expect(filed).not.toBeNull();
    expect(filed!.originalName).toBe("Total filing 4 Aug.pdf");
    expect(filed!.mimeType).toBe("application/pdf");
    expect(filed!.byteSize).toBe(184_320);
    expect(filed!.uploadedBy).toBe("Fin");
    expect(filed!.status).toBe("attached");
    // The file is named by the server, not by whatever the phone called it.
    expect(filed!.storedName).toMatch(/^rcpt_/);
    // And the fact is in the audit trail, where a person's name is attached to it.
    expect(w.db.audit[0].action).toBe("finance:receipt_attach");
    expect(w.db.audit[0].summary).toContain("EXP-2026-0001");
  });

  it("refuses operations the paper, and says which permission is missing", () => {
    const w = build();
    const denied = refuse(w.db, w.ops, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    expect(denied.message).toContain("receipts:write");
    // Operations may still read the expense register: that is the point of a separate permission.
    expect(w.db.expenses).toHaveLength(1);
  });

  it("refuses a signed-out caller outright", () => {
    const w = build();
    const denied = refuse(w.db, null, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    expect(denied.message).toMatch(/Sign in is required/i);
  });

  it("replaces an earlier scan rather than sitting beside it, and keeps the earlier one on the record", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    const first = receiptFor(w.db, w.expense.id)!;

    w.db = run(w.db, w.finance, {
      type: "attach_receipt",
      expenseId: w.expense.id,
      upload: upload({ originalName: "Total filing (clearer).jpg", mimeType: "image/jpeg", storedName: "rcpt_77aa88bb99cc00dd11ee22ff.jpg" }),
    });

    const second = receiptFor(w.db, w.expense.id)!;
    expect(second.id).not.toBe(first.id);
    expect(receiptFor(w.db, w.expense.id)!.originalName).toBe("Total filing (clearer).jpg");
    // Exactly one scan on file, and the replaced one explains itself.
    expect(w.db.receipts.filter((receipt) => receipt.expenseId === w.expense.id && receipt.status === "attached")).toHaveLength(1);
    const replaced = w.db.receipts.find((receipt) => receipt.id === first.id)!;
    expect(replaced.status).toBe("removed");
    expect(replaced.removedReason).toBe("Replaced by a new scan");
    expect(replaced.supersededById).toBe(second.id);
    // The file that was replaced is still on the record, so nobody has to guess where it went.
    expect(replaced.storedName).toBe(first.storedName);
  });

  it("refuses paper against a voided expense", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "void_expense", id: w.expense.id, reason: "Keyed twice" });
    const denied = refuse(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    expect(denied.errors.expenseId).toContain("voided");
  });

  it("refuses an expense that is not on the register", () => {
    const w = build();
    const denied = refuse(w.db, w.finance, { type: "attach_receipt", expenseId: "not-an-expense", upload: upload() });
    expect(denied.errors.expenseId).toContain("not on the register");
  });

  it("refuses a file that is too large, in words that say what to do", () => {
    const w = build();
    const denied = refuse(w.db, w.finance, {
      type: "attach_receipt",
      expenseId: w.expense.id,
      upload: upload({ byteSize: RECEIPT_LIMITS.maxBytes + 1 }),
    });
    expect(denied.errors.file).toContain("2.0 MB");
    expect(denied.errors.file).toMatch(/photograph it smaller|save it as a PDF/i);
  });

  it("refuses a kind of file the folder does not keep", () => {
    const w = build();
    const denied = refuse(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload({ mimeType: "text/html" }) });
    expect(denied.errors.file).toContain("PDF, a JPEG, a PNG or a WebP");
  });

  it("refuses a stored name the server would not have written", () => {
    // The name is what gets joined to the folder path, so anything hand-made is refused in the
    // domain as well as in the store: two independent refusals, because this is the dangerous one.
    const w = build();
    expect(receiptProblems(w.db, w.expense.id, upload({ storedName: "../../.env" })).file).toBeTruthy();
    expect(receiptProblems(w.db, w.expense.id, upload({ storedName: "rcpt_abc.pdf/../../x" })).file).toBeTruthy();
    expect(receiptProblems(w.db, w.expense.id, upload()).file).toBeUndefined();
  });
});

describe("taking a scan off an expense", () => {
  it("keeps the row, its file name and the reason it went", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    const filed = receiptFor(w.db, w.expense.id)!;

    w.db = run(w.db, w.finance, { type: "remove_receipt", id: filed.id, reason: "Scanned the wrong receipt" });

    expect(receiptFor(w.db, w.expense.id)).toBeNull();
    const removed = w.db.receipts.find((receipt) => receipt.id === filed.id)!;
    expect(removed.status).toBe("removed");
    expect(removed.removedReason).toBe("Scanned the wrong receipt");
    expect(removed.removedBy).toBe("Fin");
    expect(removed.removedAt).toBe(NOW);
    // The file stays in the folder: removal is a record, not a shredder.
    expect(removed.storedName).toBe(filed.storedName);
    expect(w.db.audit[0].action).toBe("finance:receipt_remove");
  });

  it("will not remove the same scan twice", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    const filed = receiptFor(w.db, w.expense.id)!;
    w.db = run(w.db, w.finance, { type: "remove_receipt", id: filed.id, reason: "Wrong receipt" });
    const again = refuse(w.db, w.finance, { type: "remove_receipt", id: filed.id, reason: "Wrong receipt" });
    expect(again.message).toMatch(/not on file any more/i);
  });

  it("insists on a reason", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    const filed = receiptFor(w.db, w.expense.id)!;
    const denied = refuse(w.db, w.finance, { type: "remove_receipt", id: filed.id, reason: "   " });
    expect(denied.errors.reason).toBeTruthy();
  });

  it("refuses operations, who may not even know a scan exists", () => {
    const w = build();
    w.db = run(w.db, w.finance, { type: "attach_receipt", expenseId: w.expense.id, upload: upload() });
    const filed = receiptFor(w.db, w.expense.id)!;
    const denied = refuse(w.db, w.ops, { type: "remove_receipt", id: filed.id, reason: "Not mine to remove" });
    expect(denied.message).toContain("receipts:write");
    expect(receiptFor(w.db, w.expense.id)!.id).toBe(filed.id);
  });
});
