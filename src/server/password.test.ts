import { describe, expect, it } from "vitest";
import { hashPassword, isArgon2, verifyPassword, WeakPasswordError } from "./password";
import { hashPassword as legacyHash } from "../tms/crypto";
import { validateCredential } from "../tms/service";

// node:crypto's webcrypto is global on Node 20+, which the legacy PBKDF2 path needs.
describe("password hashing", () => {
  it("stores Argon2id credentials in PHC form, with the salt inside the string", async () => {
    const credential = await hashPassword("correct-horse-battery");
    expect(credential.passwordHash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(credential.passwordSalt).toBe("");
    expect(isArgon2(credential)).toBe(true);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const credential = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("correct-horse-battery", credential)).resolves.toBe(true);
    await expect(verifyPassword("correct-horse-batterY", credential)).resolves.toBe(false);
    await expect(verifyPassword("", credential)).resolves.toBe(false);
  });

  it("salts every credential, so the same password hashes differently", async () => {
    const [a, b] = await Promise.all([hashPassword("correct-horse-battery"), hashPassword("correct-horse-battery")]);
    expect(a.passwordHash).not.toBe(b.passwordHash);
  });

  it("refuses a password shorter than the policy", async () => {
    await expect(hashPassword("short")).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it("still verifies a credential written by the browser build", async () => {
    // Upgrade path: a database exported from the prototype can be signed into, and the account is
    // re-hashed the next time its password is reset (D-51).
    const legacy = await legacyHash("correct-horse-battery");
    expect(isArgon2(legacy)).toBe(false);
    await expect(verifyPassword("correct-horse-battery", legacy)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password-here", legacy)).resolves.toBe(false);
  });

  it("rejects a malformed credential instead of throwing", async () => {
    await expect(verifyPassword("anything", { passwordHash: "$argon2id$broken", passwordSalt: "" })).resolves.toBe(false);
    await expect(verifyPassword("anything", { passwordHash: "", passwordSalt: "" })).resolves.toBe(false);
  });

  it("accepts the Argon2id shape in the service layer's credential validator", async () => {
    // The domain layer must accept what the server writes, or every user creation would fail.
    expect(validateCredential(await hashPassword("correct-horse-battery"))).toEqual({});
  });
});
