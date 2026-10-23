import { NextResponse } from "next/server";
import { readSnapshot } from "../../../server/commands";
import { findActor } from "../../../server/commands";
import { redact, redactUser } from "../../../server/snapshot";

// The one read the browser makes at start-up: who am I, does the installation still need its
// first administrator, and (if signed in) the redacted data I am allowed to see.
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readSnapshot().catch((error: unknown) => ({
    ok: false as const,
    status: 503,
    message: error instanceof Error ? error.message : "The server could not read the ledger.",
  }));
  if (!snapshot.ok) {
    return NextResponse.json(
      { ok: false, database: null, setupRequired: false, user: null, message: snapshot.message },
      { status: snapshot.status, headers: { "cache-control": "no-store" } },
    );
  }
  const { database, actor } = snapshot;
  const { user } = findActor(database, actor?.id ?? null);
  return NextResponse.json(
    {
      ok: true,
      setupRequired: database.users.length === 0,
      user: user ? redactUser(user) : null,
      database: actor ? redact(database) : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
