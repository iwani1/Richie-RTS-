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
 * The client address for throttling.
 *
 * `x-forwarded-for` is a header the client also controls, so trusting it on a directly-exposed
 * server let anyone reset their own bucket with every request and guess passwords without limit
 * (audit F-02). It is therefore read only when `TRUST_PROXY=1` says a proxy really is in front, and
 * then the right-most entry is used — the one that proxy appended, not the one the caller supplied.
 *
 * The throttle in `rateLimit.ts` keys on the account as well, so password guessing against one
 * account stays bounded even when every request shares one address (there is no proxy, or the
 * address is forged).
 */
export function clientKey(request: Request): string {
  if (process.env.TRUST_PROXY !== "1") return "local";
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}

/**
 * True when a state-changing request comes from this application.
 *
 * The session cookie is `SameSite=Lax`, which already stops a cross-site form post from carrying
 * it, but that is a browser default rather than a check this server makes — and it stops being
 * enough the moment the cookie is relaxed. Browsers send `Origin` on every POST; a request without
 * one is a non-browser client (curl, a script) which has no cookie to ride on. `PUBLIC_ORIGIN`
 * exists for a reverse proxy that rewrites the host.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const normalise = (value: string) => value.replace(/\/$/, "").toLowerCase();

  // More than one address is legitimate for the same deployment: `localhost` and `127.0.0.1` both
  // reach a workstation, a LAN address reaches it from a phone, and a proxy may present a public
  // name. So the test is "is this origin one of the addresses this request arrived on", not one
  // hard-coded string. An attacker's origin is none of them.
  const allowed = new Set<string>();
  if (process.env.PUBLIC_ORIGIN) allowed.add(normalise(process.env.PUBLIC_ORIGIN));
  try {
    allowed.add(normalise(new URL(request.url).origin));
  } catch {
    // A malformed request URL cannot be trusted, but the Host header below still can.
  }
  const host = request.headers.get("host");
  if (host) {
    allowed.add(normalise(`http://${host}`));
    allowed.add(normalise(`https://${host}`));
    const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
    if (forwardedProto) allowed.add(normalise(`${forwardedProto}://${host}`));
  }
  return allowed.has(normalise(origin));
}

export const CROSS_SITE = { ok: false, message: "Cross-site requests are not accepted." } as const;
