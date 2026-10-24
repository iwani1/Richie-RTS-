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
    // The version and extension list are useful to the operator at the terminal and mildly useful
    // to a stranger with a browser, so they are reported only outside production (audit F-17).
    database: process.env.NODE_ENV === "production" ? (database.ok ? "reachable" : "not reachable") : database.detail,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
