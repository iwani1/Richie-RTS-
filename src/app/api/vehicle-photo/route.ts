// Filing a photograph of a vehicle (FLT-01, D-108).
//
// Written the same way as the receipt route (D-100), because the danger is the same: this accepts a
// file from a browser and writes it to a disk. The order of the checks is the design:
//
//   1. **Origin and session first** — a cross-site post is refused before the body is read, and a
//      request with no session is refused before anything is parsed.
//   2. **Permission from the database** — `vehicles:update`. The role is read from the record, never
//      from the request.
//   3. **The bytes are sniffed, not trusted** — `saveVehiclePhoto` decides what the file is from its
//      first bytes; the browser's own `Content-Type` is ignored entirely.
//   4. **The name on disk is generated** — the phone's file name is stored to be shown, never used to
//      build a path.
//   5. **The row and the file are made together** — if the command is refused, the file just written
//      is deleted again, so the folder never fills with photographs nothing points at.
//
// The route never returns file bytes; that is the GET route, which checks `vehicles:read` and the
// caller's own-record scope before a byte leaves the disk.
import { json, sameOrigin } from "../../../server/api";
import { findActor, runCommand } from "../../../server/commands";
import { db } from "../../../server/db";
import { loadDatabase } from "../../../server/repository";
import { currentUserId } from "../../../server/session";
import { discardStoredVehiclePhoto, saveVehiclePhoto } from "../../../server/vehiclePhotoStore";
import { visibleSnapshot } from "../../../server/visibility";
import { can } from "../../../tms/permissions";
import { VEHICLE_PHOTO_LIMITS } from "../../../tms/vehiclePhoto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, { ok: false, message: "This request did not come from the application." });

  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
  if (!user) return json(401, { ok: false, message: "Sign in is required." });
  if (!can(user.role, "vehicles:update")) return json(403, { ok: false, message: "Not permitted." });

  const form = await request.formData().catch(() => null);
  if (!form) return json(400, { ok: false, message: "A photograph must be sent as a form with the vehicle and the file." });

  const vehicleId = typeof form.get("vehicleId") === "string" ? (form.get("vehicleId") as string).slice(0, 64) : "";
  if (!vehicleId) return json(400, { ok: false, message: "Choose the vehicle the photograph belongs to." });

  const file = form.get("file");
  if (!file || typeof file === "string") return json(400, { ok: false, message: "Attach the photograph of the vehicle." });

  const uploaded = file as File;
  // Refused before reading more than the ceiling: a client streaming 200 MB should not make the
  // server hold it in memory to find out it is too big.
  if (uploaded.size > VEHICLE_PHOTO_LIMITS.maxBytes) {
    return json(413, {
      ok: false,
      message: `That photograph is too large. Keep it under ${Math.round(VEHICLE_PHOTO_LIMITS.maxBytes / (1024 * 1024))} MB.`,
      errors: { file: "A phone camera's smaller size is enough to recognise a bus." },
    });
  }

  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const saved = await saveVehiclePhoto({ bytes, maxBytes: VEHICLE_PHOTO_LIMITS.maxBytes, allowedMimeTypes: VEHICLE_PHOTO_LIMITS.mimeTypes });
  if (!saved.ok) return json(400, { ok: false, message: saved.message, errors: { file: saved.message } });

  const result = await runCommand(
    {
      type: "attach_vehicle_photo",
      vehicleId,
      upload: {
        originalName: (uploaded.name || "vehicle").trim().slice(0, VEHICLE_PHOTO_LIMITS.originalName),
        mimeType: saved.saved.mimeType,
        byteSize: saved.saved.byteSize,
        sha256: saved.saved.sha256,
        storedName: saved.saved.storedName,
      },
    },
    { userId },
  );

  if (!result.ok) {
    // The row was refused, so the file must not stay: an unindexed file is one nobody can find, open
    // or delete.
    await discardStoredVehiclePhoto(saved.saved.storedName);
    return json(result.status, { ok: false, message: result.message, errors: result.errors });
  }

  const { actor } = findActor(result.database, userId);
  const visible = visibleSnapshot(result.database, actor);
  return json(200, { ok: true, message: result.message, database: visible.database, auditTotal: visible.auditTotal });
}
