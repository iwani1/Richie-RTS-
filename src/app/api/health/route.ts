import { NextResponse } from "next/server";
import { databaseHealth } from "../../../server/db";

// Liveness/readiness for a workstation deployment: `curl localhost:3000/api/health` tells the
// operator whether the app is up and whether it can actually reach PostgreSQL. Deliberately
// unauthenticated (it exposes no data) and deliberately not cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const database = await databaseHealth();
  const body = {
    ok: database.ok,
    service: "richie-tms",
    database: database.detail,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
