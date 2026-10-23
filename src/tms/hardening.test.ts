// Regression tests for the credential-policy fix (audit finding H-01).
//
// Before this change the minimum-length rule lived only in useTms.createCredential(),
// so any caller of the service layer could mint a credential for a one-character
// password, and an empty credential was accepted by reset_user_password (which
// silently locked the account out). These tests pin the boundary.

import { describe, expect, it } from "vitest";
import { hashPassword } from "./crypto";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, type Database } from "./types";

const NOW = "2026-01-15T08:00:00.000Z";
const VALID: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

function adminDb(): { db: Database; admin: Actor } {
  const res = execute(emptyDatabase(), null, {
    type: "setup_administrator",
    input: { fullName: "Ada Admin", email: "ada@example.com" },
    credential: VALID,
  }, NOW);
  if (!res.ok) throw new Error(res.message);
  const user = res.db.users[0];
  return { db: res.db, admin: { id: user.id, fullName: user.fullName, role: user.role } };
}

describe("credential policy at the service boundary", () => {
  it("refuses an empty credential", () => {
    const { db, admin } = adminDb();
    const res = execute(db, admin, { type: "reset_user_password", id: admin.id, credential: { passwordHash: "", passwordSalt: "" } }, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.password).toBeTruthy();
  });

  it("refuses a credential for a user that was not produced by hashPassword", () => {
    const { db, admin } = adminDb();
    const res = execute(db, admin, {
      type: "create_user",
      input: { fullName: "Weak", email: "weak@example.com", role: "operations", active: true },
      credential: { passwordHash: "00", passwordSalt: "00" },
    }, NOW);
    expect(res.ok).toBe(false);
  });

  it("accepts a well-formed credential", () => {
    const { db, admin } = adminDb();
    const res = execute(db, admin, {
      type: "create_user",
      input: { fullName: "Fine", email: "fine@example.com", role: "operations", active: true },
      credential: VALID,
    }, NOW);
    expect(res.ok).toBe(true);
  });

  it("hashPassword refuses a password shorter than the policy", async () => {
    await expect(hashPassword("x")).rejects.toThrow(/at least 10 characters/);
  });
});
