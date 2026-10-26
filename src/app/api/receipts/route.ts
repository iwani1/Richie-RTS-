// Filing a scanned receipt (Q-51 answered, D-100).
//
// This is the only route in the application that accepts a file, so it is written as if the file were
// hostile, which it might be:
//
//   1. **Origin and session first.** A cross-site post is refused before the body is read, and a
//      request with no session is refused before anything is parsed.
//   2. **Permission, from the database.** `receipts:write` — finance and administrators only. The
//      role is read from the record, not from the request.
//   3. **The bytes are sniffed, not trusted.** `saveReceipt` decides what the file is from its first
//      bytes; the browser's own `Content-Type` is ignored entirely.
//   4. **The name on disk is generated.** The name the phone gave it is stored to be shown, never used
//      to write a path.
//   5. **The row and the file are made together.** If the command is refused — a voided expense, a
//      size the database will not take — the file that was just written is deleted again, so the
//      folder never fills with scans nothing points at.
//
// What this route deliberately does *not* do: it never returns file bytes (that is the GET route,
// which checks `receipts:read`), and it never accepts a command from the browser. The row is written
// by the server after the disk write, which is why `attach_receipt` is not in the browser's command
// vocabulary at all.
import { json, sameOrigin } from "../../../server/api";
import { findActor, runCommand } from "../../../server/commands";
import { db } from "../../../server/db";
import { loadDatabase } from "../../../server/repository";
import { discardStoredReceipt, saveReceipt } from "../../../server/receiptStore";
import { currentUserId } from "../../../server/session";
import { visibleSnapshot } from "../../../server/visibility";
import { can } from "../../../tms/permissions";
import { RECEIPT_LIMITS, MAX_ORIGINAL_NAME } from "../../../tms/receipts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { ok: false, message: "This request did not come from the application." });

  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
  if (!user) return json(401, { ok: false, message: "Sign in is required." });
  if (!can(user.role, "receipts:write")) return json(403, { ok: false, message: "Not permitted." });

  // A malformed body is a bad request, not a server error: say so plainly rather than throwing.
  const form = await request.formData().catch(() => null);
  if (!form) return json(400, { ok: false, message: "A receipt must be sent as a form with the expense and the file." });

  const expenseId = typeof form.get("expenseId") === "string" ? (form.get("expenseId") as string).slice(0, 64) : "";
  if (!expenseId) return json(400, { ok: false, message: "Choose the expense the receipt belongs to." });

  const file = form.get("file");
  if (!file || typeof file === "string") return json(400, { ok: false, message: "Attach the scan or photograph of the receipt." });

  const uploaded = file as File;
  // Refused before reading a byte more than the ceiling: a client that streams 200 MB should not be
  // able to make the server hold it in memory to find out it is too big.
  if (uploaded.size > RECEIPT_LIMITS.maxBytes) {
    return json(413, {
      ok: false,
      message: `That file is too large. A receipt scan must be under ${Math.round(RECEIPT_LIMITS.maxBytes / (1024 * 1024))} MB.`,
      errors: { file: "Photograph the receipt smaller, or save it as a PDF." },
    });
  }

  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const saved = await saveReceipt({ bytes, maxBytes: RECEIPT_LIMITS.maxBytes, allowedMimeTypes: RECEIPT_LIMITS.mimeTypes });
  if (!saved.ok) return json(400, { ok: false, message: saved.message, errors: { file: saved.message } });

  const originalName = (uploaded.name || "receipt").trim().slice(0, MAX_ORIGINAL_NAME);
  const result = await runCommand(
    {
      type: "attach_receipt",
      expenseId,
      upload: {
        originalName,
        mimeType: saved.saved.mimeType,
        byteSize: saved.saved.byteSize,
        sha256: saved.saved.sha256,
        storedName: saved.saved.storedName,
      },
    },
    { userId },
  );

  if (!result.ok) {
    // The row was refused, so the file must not stay: an unindexed scan is a file nobody can find,
    // nobody can open and nobody will ever delete.
    await discardStoredReceipt(saved.saved.storedName);
    return json(result.status, { ok: false, message: result.message, errors: result.errors });
  }

  const { actor } = findActor(result.database, userId);
  const visible = visibleSnapshot(result.database, actor);
  return json(200, { ok: true, message: result.message, database: visible.database, auditTotal: visible.auditTotal });
}
