// The photograph of the vehicle (FLT-01, D-108).
//
// The register can now say what a bus runs on and whose it is. The brief also asks for a photo, and a
// photo is not a field: it is a file. Every other file in this program goes through one order of
// operations, and this one follows it exactly (D-100):
//
//   1. the bytes are sniffed, never trusted, and a type the folder does not keep is refused;
//   2. the name on disk is generated here (`vhcl_…`), never taken from the phone;
//   3. the row is written by the server *after* the bytes are safely on the disk, so a row can never
//      point at a file that does not exist;
//   4. when the domain refuses the row, the file is deleted again.
//
// Which is why `attach_vehicle_photo` is not in the browser's command vocabulary: a browser that could
// send it could manufacture a row pointing at a file it never wrote, or at somebody else's file.
//
// Two decisions worth stating:
//
//   * **One photo, replaced rather than accumulated.** A register holding four photographs of the same
//     bus leaves a reader wondering which one is the bus. Filing a second replaces the first, and the
//     audit log keeps both statements.
//   * **Removal needs a reason, and removes the index only.** The file stays in the folder until the
//     office empties it, exactly as a removed receipt scan does — the same rule, because a photo of a
//     vehicle is the evidence behind an insurance claim or a damage dispute. Removal is a command, so
//     it travels through `/api/commands` like any other.
import { audit, authorise, fail, type Actor, type CommandResult, type Errors } from "./service";
import type { Database, VehiclePhoto } from "./types";

export const VEHICLE_PHOTO_COMMAND_TYPES = ["attach_vehicle_photo", "remove_vehicle_photo"] as const;

/**
 * What the folder accepts for a vehicle photograph.
 *
 * Smaller than a receipt's ceiling and images only: this is a picture to recognise a bus by, not a
 * document to read. A PDF would be a document, and documents have their own register with expiry
 * dates (FLT-03).
 */
export const VEHICLE_PHOTO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  /** Room for a phone's file name, which is only ever shown. */
  originalName: 160,
  reason: 200,
} as const;

/** What the server learned about the file before it wrote it. Never sent by the browser. */
export interface VehiclePhotoUpload {
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storedName: string;
}

export type VehiclePhotoCommand =
  | { type: "attach_vehicle_photo"; vehicleId: string; upload: VehiclePhotoUpload }
  | { type: "remove_vehicle_photo"; vehicleId: string; reason: string };

export function isVehiclePhotoCommand(command: { type: string }): command is VehiclePhotoCommand {
  return (VEHICLE_PHOTO_COMMAND_TYPES as readonly string[]).includes(command.type);
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value.toFixed(1)} MB`;
}

/**
 * Everything that would make a file a bad record, in the words the person filing it needs.
 *
 * Kept apart from the command so the route can refuse before writing two megabytes to a disk, and so
 * the same sentences are used whichever door the file arrives through.
 */
export function vehiclePhotoProblems(db: Database, vehicleId: string, upload: VehiclePhotoUpload): Errors {
  const errors: Errors = {};
  const vehicle = db.vehicles.find((candidate) => candidate.id === vehicleId);
  if (!vehicle) {
    errors.vehicleId = "That vehicle is not on the register. Reload the page and try again.";
    return errors;
  }
  // A retired bus keeps its photo: the picture is the history of the vehicle, and a register that
  // forgot what a sold bus looked like could not answer a question about it a year later.

  if (!(VEHICLE_PHOTO_LIMITS.mimeTypes as readonly string[]).includes(upload.mimeType)) {
    errors.file = "A vehicle photograph must be a JPEG, a PNG or a WebP image.";
  }
  if (!Number.isInteger(upload.byteSize) || upload.byteSize <= 0) {
    errors.file = "That file is empty. Take the photograph again.";
  } else if (upload.byteSize > VEHICLE_PHOTO_LIMITS.maxBytes) {
    errors.file = `That photograph is ${megabytes(upload.byteSize)}. Keep it under ${megabytes(VEHICLE_PHOTO_LIMITS.maxBytes)} — a phone camera's smaller size is enough to recognise a bus.`;
  }
  const name = upload.originalName.trim();
  if (!name) errors.file = "The file has no name. Save it with a name before filing it.";
  else if (name.length > VEHICLE_PHOTO_LIMITS.originalName) errors.file = `Keep the file name to ${VEHICLE_PHOTO_LIMITS.originalName} characters.`;
  if (!/^[0-9a-f]{64}$/.test(upload.sha256)) errors.file = "The file could not be read. Try filing it again.";
  if (!/^vhcl_[A-Za-z0-9._-]{8,80}$/.test(upload.storedName)) errors.file = "The file could not be stored. Try again.";
  return errors;
}

export function executeVehiclePhoto(
  db: Database,
  actor: Actor | null,
  command: VehiclePhotoCommand,
  now = new Date().toISOString(),
): CommandResult {
  switch (command.type) {
    case "attach_vehicle_photo": {
      const denied = authorise(actor, "vehicles:update");
      if (denied) return denied;
      const { vehicleId, upload } = command;
      const errors = vehiclePhotoProblems(db, vehicleId, upload);
      if (Object.keys(errors).length) return fail("That photograph could not be filed.", errors);

      const vehicle = db.vehicles.find((candidate) => candidate.id === vehicleId)!;
      const photo: VehiclePhoto = {
        storedName: upload.storedName,
        originalName: upload.originalName.trim(),
        mimeType: upload.mimeType,
        byteSize: upload.byteSize,
        sha256: upload.sha256,
        uploadedBy: actor?.fullName ?? "System",
        uploadedAt: now,
      };
      const replaced = vehicle.photo !== null;
      const updated = { ...vehicle, photo, updatedAt: now };

      return {
        ok: true,
        db: audit({ ...db, vehicles: db.vehicles.map((candidate) => (candidate.id === vehicle.id ? updated : candidate)) }, actor, {
          action: "vehicles:photo",
          entity: "vehicle",
          entityId: vehicle.id,
          summary: `Photograph filed for ${vehicle.registration}: ${photo.originalName} (${photo.mimeType}, ${megabytes(photo.byteSize)})${replaced ? ", replacing the photograph on file" : ""}.`,
        }, now),
        message: replaced
          ? `New photograph filed for ${vehicle.registration}. The earlier one is replaced in the register and stays in the folder.`
          : `Photograph filed for ${vehicle.registration}.`,
      };
    }

    case "remove_vehicle_photo": {
      const denied = authorise(actor, "vehicles:update");
      if (denied) return denied;
      const vehicle = db.vehicles.find((candidate) => candidate.id === command.vehicleId);
      if (!vehicle) return fail("Vehicle not found.", { vehicleId: "Reload the page: it may have been removed." });
      if (!vehicle.photo) return fail(`${vehicle.registration} has no photograph on file.`, { vehicleId: "There is nothing to take off." });

      const reason = command.reason.trim();
      if (!reason) return fail("Say why the photograph is being taken off.", { reason: "A removal without a reason is an edit with extra steps." });
      if (reason.length > VEHICLE_PHOTO_LIMITS.reason)
        return fail(`Keep the reason to ${VEHICLE_PHOTO_LIMITS.reason} characters.`, { reason: `Keep the reason to ${VEHICLE_PHOTO_LIMITS.reason} characters.` });

      return {
        ok: true,
        db: audit(
          { ...db, vehicles: db.vehicles.map((candidate) => (candidate.id === vehicle.id ? { ...candidate, photo: null, updatedAt: now } : candidate)) },
          actor,
          {
            action: "vehicles:photo_remove",
            entity: "vehicle",
            entityId: vehicle.id,
            summary: `Photograph taken off ${vehicle.registration}: ${reason}. The file stays in the vehicle photograph folder until the office empties it.`,
          },
          now,
        ),
        message: `Photograph removed from ${vehicle.registration}. The file stays in the folder until the office empties it.`,
      };
    }
  }
}

/** The photograph on file for a vehicle, or null. */
export function vehiclePhotoOf(db: Database, vehicleId: string): VehiclePhoto | null {
  return db.vehicles.find((vehicle) => vehicle.id === vehicleId)?.photo ?? null;
}

/**
 * The sentence under a vehicle's photograph, or empty when there is none.
 *
 * Who filed it and when, because a photograph of a damaged bus is worth only as much as the answer
 * to "when was this taken".
 */
export function vehiclePhotoLine(photo: VehiclePhoto | null): string {
  if (!photo) return "";
  const when = photo.uploadedAt.slice(0, 10);
  return `Filed by ${photo.uploadedBy} on ${when}`;
}

/** How many live vehicles have no photograph — the same counted gap as the other fleet facts. */
export function vehiclesWithoutPhoto(db: Database): number {
  return db.vehicles.filter((vehicle) => vehicle.status !== "retired" && !vehicle.photo).length;
}
