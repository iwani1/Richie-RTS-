// The folder a vehicle photograph lives in (FLT-01, D-108).
//
// This is deliberately a sibling of `receiptStore.ts` rather than a second invention: the rules are
// the same ones, and they are defensive for the same reasons. Writing a file a stranger uploads is
// the most dangerous thing this application does, so:
//
//   * **the name is never the caller's.** A photograph is stored as `vhcl_<random>.<ext>`, generated
//     here. The phone's own file name is kept in the record to be *shown*, never used on the disk —
//     which is what makes `../../.env` impossible rather than merely rejected;
//   * **the type is read from the bytes.** A file named `bus.jpg` that begins with `%PDF-` is a PDF,
//     and a PDF is refused here: a vehicle photograph is a picture, and documents have their own
//     register with expiry dates;
//   * **there is a ceiling**, checked before the write;
//   * **reads are validated too.** The stored name is matched against the exact shape written here
//     before it is joined to the folder, so a record edited by hand cannot become a file read from
//     anywhere on the machine.
//
// What differs from a receipt is only the folder and the prefix, and both are exported so the guide,
// the backup notes and the tests name the same thing.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fingerprint, sniffType } from "./receiptStore";

export const STORED_PHOTO_PATTERN = /^vhcl_[A-Za-z0-9._-]{8,80}$/;

/**
 * Where photographs are kept: `VEHICLE_PHOTO_DIR`, or `data/vehicle-photos` beside the application.
 *
 * Separate from the receipt folder on purpose. The two folders have different retention stories —
 * receipts are kept three years for tax, a photograph of a bus is kept while the bus is in the
 * fleet and is the office's own judgement after that — and one folder emptied with the other's rule
 * would delete the wrong thing.
 */
export function vehiclePhotoDir(): string {
  const configured = process.env.VEHICLE_PHOTO_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), "data", "vehicle-photos");
}

export interface SavedVehiclePhoto {
  storedName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export type SaveVehiclePhotoResult = { ok: true; saved: SavedVehiclePhoto } | { ok: false; message: string };

/**
 * Sniffs, checks the ceiling, and writes the file.
 *
 * `flag: "wx"` refuses to overwrite anything that already exists, so a collision is an error rather
 * than a silent replacement of somebody's photograph.
 */
export async function saveVehiclePhoto(options: {
  bytes: Buffer;
  maxBytes: number;
  allowedMimeTypes: readonly string[];
}): Promise<SaveVehiclePhotoResult> {
  const { bytes, maxBytes, allowedMimeTypes } = options;
  if (bytes.length === 0) return { ok: false, message: "That file is empty. Take the photograph again." };
  if (bytes.length > maxBytes)
    return { ok: false, message: "That photograph is too large to keep. A phone camera's smaller size is enough to recognise a bus." };

  const kind = sniffType(bytes);
  if (!kind) return { ok: false, message: "That file is not a JPEG, a PNG or a WebP image." };
  if (!allowedMimeTypes.includes(kind.mimeType)) {
    return { ok: false, message: "That kind of file is not kept as a vehicle photograph." };
  }

  const directory = vehiclePhotoDir();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const name = `vhcl_${randomBytes(18).toString("hex")}.${kind.extension}`;
  await writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 });
  return { ok: true, saved: { storedName: name, mimeType: kind.mimeType, byteSize: bytes.length, sha256: fingerprint(bytes) } };
}

/** The bytes of a stored photograph. Throws when the name is not one this module writes. */
export async function readStoredVehiclePhoto(name: string): Promise<Buffer> {
  if (!STORED_PHOTO_PATTERN.test(name)) throw new Error("That is not a stored vehicle photograph name.");
  return readFile(path.join(vehiclePhotoDir(), name));
}

/** Removes a file this module wrote. Used only to undo a save whose command was refused. */
export async function discardStoredVehiclePhoto(name: string): Promise<void> {
  if (!STORED_PHOTO_PATTERN.test(name)) throw new Error("That is not a stored vehicle photograph name.");
  await unlink(path.join(vehiclePhotoDir(), name)).catch(() => undefined);
}
