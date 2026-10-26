// The folder a receipt scan lives in, and the only code that touches it (Q-51, D-100).
//
// The owner's answer was a folder on the office machine beside the database, kept three years and
// backed up nightly by the office itself. That is what this module implements, and it implements it
// defensively, because writing a file a stranger uploads is the single most dangerous thing this
// application does:
//
//   * **the name is never the caller's.** A scan is stored as `rcpt_<random>.<ext>`, generated here.
//     The name the person's phone gave it is kept in the database row to be *shown*, never used on the
//     disk. That is what makes a path like `../../.env` impossible rather than merely rejected.
//   * **the type is read from the bytes.** A file declared as JPEG that starts with `%PDF-` is a PDF;
//     a file that starts with anything else at all is refused. Trusting `Content-Type` would let an
//     HTML page with a `.jpg` name be served back to a browser later.
//   * **there is a ceiling.** 2 MB, checked before the write and enforced again by a database check
//     constraint, because a disk filled by four phone photographs is an outage.
//   * **reads are validated too.** The stored name is matched against the exact shape written here
//     before it is joined to the folder, so an index row corrupted by hand cannot become a file read
//     from anywhere on the machine.
//
// Nothing in this file knows about permissions or commands: it saves bytes and returns a fingerprint.
// The route decides who may ask, and the domain decides whether the answer is allowed.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** The types the store will keep, by the bytes that identify them. */
const SIGNATURES: { mime: string; ext: string; test: (bytes: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (bytes) => bytes.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", ext: "jpg", test: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  {
    mime: "image/png",
    ext: "png",
    test: (bytes) =>
      bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    ext: "webp",
    // "RIFF" …… "WEBP": four bytes of size sit between the two words.
    test: (bytes) => bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

export const STORED_NAME_PATTERN = /^rcpt_[A-Za-z0-9._-]{8,80}$/;

/**
 * Where scans are kept: `RECEIPT_DIR`, or `data/receipts` beside the application.
 *
 * A relative setting is resolved against the working directory the server was started in, which is
 * the project folder in every documented way of starting it. The folder is created on first write,
 * not at import time, so a read-only deployment that never files a receipt never breaks.
 */
export function receiptDir(): string {
  const configured = process.env.RECEIPT_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data", "receipts");
}

/** What a file really is, decided from its own bytes. Null when it is none of the kept types. */
export function sniffType(bytes: Buffer): { mimeType: string; extension: string } | null {
  const match = SIGNATURES.find((signature) => signature.test(bytes));
  return match ? { mimeType: match.mime, extension: match.ext } : null;
}

/** The 64-character fingerprint stored beside the file, so the same scan can be recognised again. */
export function fingerprint(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The name a file is stored under. Never derived from the original name — see the note at the top.
 * The 18 random bytes are what makes a guess impractical, and the prefix is what `STORED_NAME_PATTERN`
 * checks before any read.
 */
export function storedName(extension: string): string {
  return `rcpt_${randomBytes(18).toString("hex")}.${extension}`;
}

export interface SavedReceipt {
  storedName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export type SaveResult = { ok: true; saved: SavedReceipt } | { ok: false; message: string };

/**
 * Sniffs, checks the ceiling, and writes the file atomically enough for this purpose.
 *
 * `flag: "wx"` refuses to overwrite anything that already exists, so a collision — even a
 * deliberate one — is an error rather than a silent replacement of somebody's receipt.
 */
export async function saveReceipt(options: {
  bytes: Buffer;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}): Promise<SaveResult> {
  const { bytes, maxBytes, allowedMimeTypes } = options;
  if (bytes.length === 0) return { ok: false, message: "That file is empty. Scan or photograph the receipt again." };
  if (bytes.length > maxBytes) return { ok: false, message: "That file is too large to keep. Photograph the receipt smaller, or save it as a PDF." };

  const kind = sniffType(bytes);
  if (!kind) return { ok: false, message: "That file is not a PDF, a JPEG, a PNG or a WebP image." };
  // A file may be a PDF named `receipt.jpg`; it is stored as a PDF. What is refused is a type the
  // folder does not keep at all, which `sniffType` has already decided.
  if (!allowedMimeTypes.includes(kind.mimeType)) {
    return { ok: false, message: "That kind of file is not kept as a receipt." };
  }

  const directory = receiptDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = storedName(kind.extension);
  await writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 });
  return { ok: true, saved: { storedName: name, mimeType: kind.mimeType, byteSize: bytes.length, sha256: fingerprint(bytes) } };
}

/** The bytes of a stored scan. Throws when the name is not one this module writes. */
export async function readStoredReceipt(name: string): Promise<Buffer> {
  if (!STORED_NAME_PATTERN.test(name)) throw new Error("That is not a stored receipt name.");
  return readFile(path.join(receiptDir(), name));
}

/** Removes a file this module wrote. Used only to undo a save whose command was refused. */
export async function discardStoredReceipt(name: string): Promise<void> {
  if (!STORED_NAME_PATTERN.test(name)) throw new Error("That is not a stored receipt name.");
  await unlink(path.join(receiptDir(), name)).catch(() => undefined);
}

/**
 * The retention date of a scan, three years after it was filed. Stated on screen so an office knows
 * when the folder may be emptied, and computed here so the screen and the guide cannot disagree.
 */
export function retentionDate(uploadedAt: string, years: number): string {
  const at = new Date(uploadedAt);
  if (Number.isNaN(at.getTime())) return "";
  at.setUTCFullYear(at.getUTCFullYear() + years);
  return at.toISOString().slice(0, 10);
}
