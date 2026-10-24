// The time-trap on the public enquiry form (WEB-01).
//
// A public write endpoint will be found by bots. A honeypot field catches the naive ones; this
// catches the ones that fill every field and post immediately. The form asks for a token when it
// opens, and a submission is accepted only when that token is at least a couple of seconds old and
// less than two hours old. A script that posts straight to the endpoint has no token at all, and one
// that fetches a token and posts in the same breath is too fast to be a person typing a phone number.
//
// It is signed with the session secret so the timestamp cannot be forged or backdated, and it is
// compared in constant time. It is not an anti-spam guarantee — nothing client-side is — which is
// why the endpoint also throttles per address and why a submission only ever creates a draft.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** A person cannot read a form and fill it in this fast; a bot posting a fetched token can. */
export const MIN_FORM_SECONDS = 3;
/** After this long the page is stale: reload it rather than accepting a submission from a tab left open. */
export const MAX_FORM_HOURS = 2;

const secret = () => env().SESSION_SECRET;

function sign(issuedAt: number): string {
  return createHmac("sha256", secret()).update(`enquiry:${issuedAt}`).digest("base64url");
}

/** A token for a form that has just been opened. */
export function issueEnquiryToken(now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  return `${issuedAt}.${sign(issuedAt)}`;
}

export type TokenVerdict = { ok: true } | { ok: false; reason: "malformed" | "forged" | "too-fast" | "stale" };

export function verifyEnquiryToken(token: string, now = Date.now()): TokenVerdict {
  const [issued, signature, ...rest] = token.split(".");
  if (!issued || !signature || rest.length) return { ok: false, reason: "malformed" };
  const issuedAt = Number(issued);
  if (!Number.isSafeInteger(issuedAt) || String(issuedAt) !== issued) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(sign(issuedAt));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "forged" };

  const ageSeconds = Math.floor(now / 1000) - issuedAt;
  if (ageSeconds < MIN_FORM_SECONDS) return { ok: false, reason: "too-fast" };
  if (ageSeconds > MAX_FORM_HOURS * 3600) return { ok: false, reason: "stale" };
  return { ok: true };
}

/** What the person in front of the form is told when a token is refused. Never names the reason. */
export const TOKEN_REFUSED =
  "This form has been open too long, or it was submitted before it finished loading. Reload the page and send it again.";
