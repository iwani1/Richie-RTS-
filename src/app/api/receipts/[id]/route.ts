// Opening a filed receipt scan (Q-51, D-100).
//
// Finance and administrators only, checked against the account's role in the database before a byte
// is read from the folder. Two details matter more than they look:
//
//   * **`content-disposition: inline` with a name this server chooses.** A file is served back under
//     its original name, but that name is stripped of quotes, newlines and path separators first: a
//     header built from what somebody typed is a header injection waiting to happen.
//   * **`x-content-type-options: nosniff` and the type from the record.** The type was decided by
//     looking at the bytes when the file arrived, so a browser is told what the file really is and is
//     told not to guess.
//
// A scan whose file is missing from the folder is a 404 with a sentence about the backup, not a 500
// and not an empty file. That state means the folder and the database disagreed, which is exactly the
// thing an operator needs to be told.
import { json } from "../../../../server/api";
import { db } from "../../../../server/db";
import { loadDatabase } from "../../../../server/repository";
import { readStoredReceipt } from "../../../../server/receiptStore";
import { currentUserId } from "../../../../server/session";
import { can } from "../../../../tms/permissions";

export const dynamic = "force-dynamic";

/** A name safe to put in a header: no quotes, no separators, no control characters. */
function safeFileName(name: string, mimeType: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "receipt";
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
  if (!user) return json(401, { ok: false, message: "Sign in is required." });
  if (!can(user.role, "receipts:read")) return json(403, { ok: false, message: "Not permitted." });

  const { id } = await context.params;
  const receipt = database.receipts.find((candidate) => candidate.id === id);
  if (!receipt) return json(404, { ok: false, message: "That scan is not on file." });

  let bytes: Buffer;
  try {
    bytes = await readStoredReceipt(receipt.storedName);
  } catch {
    return json(404, {
      ok: false,
      message:
        "The register has a scan whose file is not in the receipt folder. Restore that folder from the last backup before relying on this receipt.",
    });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": receipt.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": `inline; filename="${safeFileName(receipt.originalName, receipt.mimeType)}"`,
      // The bytes are evidence, not an asset: never cached by a shared proxy, never sniffed.
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
