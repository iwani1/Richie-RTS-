import type { Credential } from "./service";

// OWASP's Password Storage Cheat Sheet (2023) recommends at least 600,000 iterations for
// PBKDF2-HMAC-SHA256. The cost is paid once per sign-in, not per request.
const ITERATIONS = 600_000;

// The single definition of the password-length policy. Imported by the service layer and by
// the auth screens so that the rule cannot drift between the form, the hasher and the command.
export const MIN_PASSWORD_LENGTH = 10;

export function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<Credential> {
  // The policy is enforced here, in the only function that can turn a password into a
  // credential, so no caller can mint a credential for a password the form would reject.
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { passwordSalt: toHex(salt), passwordHash: await derive(password, salt) };
}

export async function verifyPassword(password: string, credential: Credential): Promise<boolean> {
  const hash = await derive(password, fromHex(credential.passwordSalt));
  if (hash.length !== credential.passwordHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ credential.passwordHash.charCodeAt(i);
  return diff === 0;
}
