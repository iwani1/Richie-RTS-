import type { Credential } from "./service";

const ITERATIONS = 120_000;

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
