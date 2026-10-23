// Shared plumbing for the route handlers: JSON parsing with a size limit, uniform error shapes,
// and a best-effort client key for throttling.
import { NextResponse } from "next/server";

export function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const UNAUTHENTICATED = { ok: false, message: "Sign in is required." } as const;

/** Parses a JSON body, rejecting anything that is not a small object. */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > 1_000_000) return null; // 1 MB is far more than any command needs
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The client address for throttling. Behind a reverse proxy this is the proxy unless the header
 * is trusted, which is why the throttle also keys on the submitted email: guessing one account's
 * password is limited even if every request shares one address.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return address;
}
