import { NextResponse } from "next/server";
import { findActor, readSnapshot } from "../../../server/commands";
import { redactUser } from "../../../server/snapshot";
import { visibleSnapshot } from "../../../server/visibility";

// The one read the browser makes at start-up: who am I, does the installation still need its
// first administrator, and (if signed in) the data I am allowed to see — scoped per role by
// `visibleSnapshot`, never the whole database (audit F-01).
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readSnapshot().catch((error: unknown) => ({
    ok: false as const,
    status: 503,
    message: error instanceof Error ? error.message : "The server could not read the data.",
  }));
  if (!snapshot.ok) {
    return NextResponse.json(
      { ok: false, database: null, setupRequired: false, user: null, message: snapshot.message },
      { status: snapshot.status, headers: { "cache-control": "no-store" } },
    );
  }
  const { database, actor } = snapshot;
  const { user } = findActor(database, actor?.id ?? null);
  const visible = visibleSnapshot(database, actor);
  return NextResponse.json(
    {
      ok: true,
      setupRequired: database.users.length === 0,
      user: user ? redactUser(user) : null,
      database: visible.database,
      auditTotal: visible.auditTotal,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
