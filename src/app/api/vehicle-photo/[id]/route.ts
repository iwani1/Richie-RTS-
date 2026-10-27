// Opening a vehicle's photograph (FLT-01, D-108).
//
// Two checks before a byte leaves the disk: the role may read vehicles at all, and this vehicle is one
// that account may see. Today the first gate already settles it — only administrator, operations and
// finance hold `vehicles:read`, and all three read the whole fleet — but the second gate stays because
// the fleet is not a driver's or a client's register: if a bound role is ever given `vehicles:read`,
// this route must still confine it to its own records rather than hand out any bus in the company by
// id. A route that trusts a role to be company-scoped is one permission change away from a leak.
//
// The same two details as the receipt route: the download name is stripped of quotes, separators and
// control characters before it reaches a header, and the type is the one recorded from the bytes,
// served with `nosniff` so a browser never guesses.
import { json } from "../../../../server/api";
import { loadDatabase } from "../../../../server/repository";
import { db } from "../../../../server/db";
import { findActor } from "../../../../server/commands";
import { currentUserId } from "../../../../server/session";
import { readStoredVehiclePhoto } from "../../../../server/vehiclePhotoStore";
import { can } from "../../../../tms/permissions";
import { scopedView } from "../../../../tms/scope";

export const dynamic = "force-dynamic";

function safeFileName(name: string, mimeType: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "vehicle";
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  return cleaned.toLowerCase().endsWith(`.${extension}`) ? cleaned : `${cleaned}.${extension}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
  if (!user) return json(401, { ok: false, message: "Sign in is required." });
  if (!can(user.role, "vehicles:read")) return json(403, { ok: false, message: "Not permitted." });

  const { id } = await context.params;
  // Own-record scope, applied to the same view the screens use: a driver may see the bus it drives,
  // and no other.
  const { actor } = findActor(database, userId);
  const allowed = scopedView(database, actor).vehicles.some((vehicle) => vehicle.id === id);
  if (!allowed) return json(404, { ok: false, message: "That vehicle is not on the register, or not one you may see." });

  const photo = database.vehicles.find((vehicle) => vehicle.id === id)?.photo ?? null;
  if (!photo) return json(404, { ok: false, message: "No photograph has been filed for this vehicle." });

  let bytes: Buffer;
  try {
    bytes = await readStoredVehiclePhoto(photo.storedName);
  } catch {
    return json(404, {
      ok: false,
      message:
        "The register has a photograph whose file is not in the vehicle photograph folder. Restore that folder from the last backup before relying on this picture.",
    });
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": photo.mimeType,
      "content-length": String(bytes.length),
      "content-disposition": `inline; filename="${safeFileName(photo.originalName, photo.mimeType)}"`,
      // The picture is evidence about a vehicle, not an asset: never cached by a shared proxy.
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
