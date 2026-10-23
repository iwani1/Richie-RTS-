// Password hashing at the server boundary.
//
// Argon2id via @node-rs/argon2 (OWASP's first choice), replacing the browser build's in-page
// PBKDF2. The PBKDF2 verifier is kept so a database written by the prototype, or a backup
// exported from it, can still be signed into and then re-hashed on next reset (D-51).
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { verifyPassword as verifyPbkdf2 } from "../tms/crypto";
import { MIN_PASSWORD_LENGTH } from "../tms/crypto";
import type { Credential } from "../tms/service";

const ARGON2_HASH_RE = /^\$argon2(id|i|d)\$/;

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;

export class WeakPasswordError extends Error {
  constructor(message = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

export async function hashPassword(password: string): Promise<Credential> {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) throw new WeakPasswordError();
  if (password.length > 1024) throw new WeakPasswordError("Password is longer than 1024 characters.");
  // OWASP Password Storage Cheat Sheet: Argon2id m=19456 (19 MiB), t=2, p=1.
  const digest = await argonHash(password, {
    // 2 === Algorithm.Argon2id. The library exports it as an ambient const enum, which cannot be
    // imported under isolatedModules, so the value is used directly.
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  // Argon2 carries its salt in the PHC string, so the separate salt column is unused for these.
  return { passwordHash: digest, passwordSalt: "" };
}

export function isArgon2(credential: Credential): boolean {
  return ARGON2_HASH_RE.test(credential.passwordHash);
}

export async function verifyPassword(password: string, credential: Credential): Promise<boolean> {
  if (!credential?.passwordHash) return false;
  if (isArgon2(credential)) {
    try {
      return await argonVerify(credential.passwordHash, password);
    } catch {
      return false;
    }
  }
  // Legacy PBKDF2-SHA256 credential from the browser build.
  if (!credential.passwordSalt) return false;
  try {
    return await verifyPbkdf2(password, credential);
  } catch {
    return false;
  }
}

/**
 * Constant-work verification for an account that does not exist, so sign-in timing does not
 * reveal which email addresses are registered (audit finding M-05).
 */
let dummyHash: string | null = null;
export async function burnEquivalentWork(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await argonHash("timing-equaliser-not-a-real-password");
  await argonVerify(dummyHash, password).catch(() => false);
}
