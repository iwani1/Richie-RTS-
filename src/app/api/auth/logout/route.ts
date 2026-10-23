import { json } from "../../../../server/api";
import { signOut } from "../../../../server/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await signOut();
  return json(200, { ok: true, message: "Signed out." });
}
