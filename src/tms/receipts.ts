// The scanned copy of an expense receipt (Q-51 answered 2026-10-26, D-100).
//
// The expense register already holds the number printed on the paper and whether the paper is in the
// file. An auditor asking "show me the receipt" could be given a number and a tick, which is a claim,
// not evidence. This module holds the index to the image itself.
//
// Three rules, and each one is a decision the owner made rather than a preference of the code:
//
//   * **The file lives outside the database**, in a folder beside it on the same machine. A backup
//     that carries a thousand photographs is slow to move; a folder that carries none is not a backup
//     of the paper. So the row is an index and the bytes are elsewhere — which is also why nothing
//     here reads or writes a file: that is `src/server/receiptStore.ts`, kept out of the pure layer.
//   * **Three years, then gone.** Retention is a number in `RECEIPT_LIMITS`, stated on screen, so
//     nobody has to guess whether the folder can be emptied.
//   * **Finance and administrators only.** Operations may read the expense register — fuel and tolls
//     are part of what its runs cost — but a receipt photographs a supplier, a bank reference and
//     sometimes a card. It is not operations' to read, and the permission is checked on the server
//     before a byte leaves the disk.
//
// A scan is never deleted. One that is wrong is **removed** with a reason, and one that is replaced
// points at its replacement, so "why is there no scan on this expense?" has an answer a year later.
import { audit, authorise, fail, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type { Database, ReceiptFile } from "./types";

export const RECEIPT_COMMAND_TYPES = ["attach_receipt", "remove_receipt"] as const;

/** What the folder will accept, and for how long it is kept. Stated on screen, not discovered. */
export const RECEIPT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  /** Types a phone camera or a scanner actually produces, plus a PDF. Matched on the file's own bytes. */
  mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const,
  /** How long a scan is kept, in years, before it may be removed from the folder. */
  retentionYears: 3,
} as const;

export type ReceiptMimeType = (typeof RECEIPT_LIMITS.mimeTypes)[number];

/**
 * What the server learned about the file before it wrote it to disk.
 *
 * This is not a browser-supplied value: the route sniffs the bytes, so a `.jpg` that is really a PDF
 * — or a script with an image name — is classified as what it is, and refused if that is not on the
 * list above. The original name is kept only to be shown to a reader.
 */
export interface ReceiptUpload {
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storedName: string;
}

export type ReceiptCommand =
  | { type: "attach_receipt"; expenseId: string; upload: ReceiptUpload }
  | { type: "remove_receipt"; id: string; reason: string };

export function isReceiptCommand(command: { type: string }): command is ReceiptCommand {
  return (RECEIPT_COMMAND_TYPES as readonly string[]).includes(command.type);
}

/** The scan currently on file for an expense, if any. There is at most one. */
export function receiptFor(db: Database, expenseId: string): ReceiptFile | null {
  return db.receipts.find((receipt) => receipt.expenseId === expenseId && receipt.status === "attached") ?? null;
}

export const MAX_ORIGINAL_NAME = 160;

/**
 * Everything that would make a scan a bad record, in the words the person attaching it needs.
 *
 * Kept apart from the command so the route can refuse before writing two megabytes to a disk, and so
 * the same sentences are used whichever door the file arrives through.
 */
export function receiptProblems(db: Database, expenseId: string, upload: ReceiptUpload): Errors {
  const errors: Errors = {};
  const expense = db.expenses.find((candidate) => candidate.id === expenseId);
  if (!expense) {
    errors.expenseId = "That expense is not on the register. Reload the page and try again.";
    return errors;
  }
  // A voided expense is spending the business has said was not real. Filing paper against it would
  // attach evidence to a figure no report counts.
  if (expense.status === "void") {
    errors.expenseId = `${expense.reference} was voided, so there is nothing to file a receipt against.`;
  }

  if (!(RECEIPT_LIMITS.mimeTypes as readonly string[]).includes(upload.mimeType)) {
    errors.file = "A receipt must be a PDF, a JPEG, a PNG or a WebP image.";
  }
  if (!Number.isInteger(upload.byteSize) || upload.byteSize <= 0) {
    errors.file = "That file is empty. Scan or photograph the receipt again.";
  } else if (upload.byteSize > RECEIPT_LIMITS.maxBytes) {
    errors.file = `That file is ${megabytes(upload.byteSize)}. A receipt scan must be under ${megabytes(RECEIPT_LIMITS.maxBytes)} — photograph it smaller, or save it as a PDF.`;
  }
  const name = upload.originalName.trim();
  if (!name) errors.file = "The file has no name. Save it with a name before attaching it.";
  else if (name.length > MAX_ORIGINAL_NAME) errors.file = `Keep the file name to ${MAX_ORIGINAL_NAME} characters.`;
  // A fingerprint is what makes "the same file twice" a fact rather than an opinion.
  if (!/^[0-9a-f]{64}$/.test(upload.sha256)) errors.file = "The file could not be read. Try attaching it again.";
  if (!/^rcpt_[A-Za-z0-9._-]{8,80}$/.test(upload.storedName)) errors.file = "The file could not be stored. Try again.";
  return errors;
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value >= 1 ? value.toFixed(1) : Math.max(1, Math.round(value * 100) / 100)} MB`;
}

export function executeReceipts(
  db: Database,
  actor: Actor | null,
  command: ReceiptCommand,
  now = new Date().toISOString(),
): CommandResult {
  switch (command.type) {
    case "attach_receipt": {
      const denied = authorise(actor, "receipts:write");
      if (denied) return denied;
      const { expenseId, upload } = command;
      const errors = receiptProblems(db, expenseId, upload);
      if (Object.keys(errors).length) return fail("That receipt could not be filed.", errors);

      const expense = db.expenses.find((candidate) => candidate.id === expenseId)!;
      const existing = receiptFor(db, expenseId);

      // Filing a second scan against the same expense replaces the first rather than sitting beside
      // it: two images of one receipt is an invitation to wonder which one is the receipt.
      const superseded = existing
        ? db.receipts.map((receipt) =>
            receipt.id === existing.id
              ? { ...receipt, status: "removed" as const, removedReason: "Replaced by a new scan", removedBy: actor?.fullName ?? "System", removedAt: now }
              : receipt,
          )
        : db.receipts;

      const receipt: ReceiptFile = {
        id: makeId(),
        expenseId,
        storedName: upload.storedName,
        originalName: upload.originalName.trim(),
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        sha256: upload.sha256,
        status: "attached",
        removedReason: null,
        removedBy: null,
        removedAt: null,
        supersededById: null,
        uploadedBy: actor?.fullName ?? "System",
        uploadedAt: now,
      };
      const receipts = existing
        ? superseded.map((candidate) => (candidate.id === existing.id ? { ...candidate, supersededById: receipt.id } : candidate))
        : superseded;

      return {
        ok: true,
        db: audit(
          { ...db, receipts: [...receipts, receipt] },
          actor,
          {
            action: "finance:receipt_attach",
            entity: "expense",
            entityId: expenseId,
            summary: `Scan filed against ${expense.reference}: ${receipt.originalName} (${receipt.mimeType}, ${megabytes(receipt.byteSize)})${existing ? ", replacing the scan already on file" : ""}.`,
          },
          now,
        ),
        message: existing ? `New scan filed against ${expense.reference}; the earlier one is kept as replaced.` : `Scan filed against ${expense.reference}.`,
      };
    }

    case "remove_receipt": {
      const denied = authorise(actor, "receipts:write");
      if (denied) return denied;
      const receipt = db.receipts.find((candidate) => candidate.id === command.id);
      if (!receipt) return fail("That scan is not on file.", { id: "Reload the page: it may already have been removed." });
      if (receipt.status !== "attached") return fail("That scan is not on file any more.", { id: "It has already been removed." });
      const reason = command.reason.trim();
      if (!reason) return fail("Say why the scan is being removed.", { reason: "A removal without a reason is an edit with extra steps." });
      if (reason.length > 200) return fail("Keep the reason to 200 characters.", { reason: "Keep the reason to 200 characters." });

      const expense = db.expenses.find((candidate) => candidate.id === receipt.expenseId);
      return {
        ok: true,
        db: audit(
          {
            ...db,
            receipts: db.receipts.map((candidate) =>
              candidate.id === receipt.id
                ? { ...candidate, status: "removed" as const, removedReason: reason, removedBy: actor?.fullName ?? "System", removedAt: now }
                : candidate,
            ),
          },
          actor,
          {
            action: "finance:receipt_remove",
            entity: "expense",
            entityId: receipt.expenseId,
            summary: `Scan ${receipt.originalName} taken off ${expense?.reference ?? "an expense"}: ${reason}. The file stays in the folder until its retention date.`,
          },
          now,
        ),
        message: `Scan removed from ${expense?.reference ?? "the expense"}. The image stays in the folder until it is due for deletion.`,
      };
    }
  }
}
