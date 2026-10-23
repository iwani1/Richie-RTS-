// Regression tests for the credential-policy fix (audit finding H-01).
//
// Before this change the minimum-length rule lived only in useTms.createCredential(),
// so any caller of the service layer could mint a credential for a one-character
// password, and an empty credential was accepted by reset_user_password (which
// silently locked the account out). These tests pin the boundary.

import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { hashPassword } from "./crypto";
import { AUDIT_LIMIT, audit, execute, type Actor, type Credential } from "./service";
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

// Regression tests for the backup-import fix (audit finding H-02).
describe("backup import validation", () => {
  it("rejects a backup containing an unknown role instead of crashing later", () => {
    const { db, admin } = adminDb();
    const poisoned = JSON.parse(JSON.stringify(db)) as Database;
    poisoned.users.push({ ...poisoned.users[0], id: "evil", email: "evil@example.com", role: "superuser" as never });
    const res = execute(db, admin, { type: "import_backup", database: poisoned }, NOW);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Unknown role/);
  });

  it("rejects records whose fields have the wrong type", () => {
    const { db, admin } = adminDb();
    const bad = JSON.parse(JSON.stringify(db)) as Database;
    (bad.vehicles as unknown as Record<string, unknown>[]).push({ id: null, registration: 42 });
    const res = execute(db, admin, { type: "import_backup", database: bad }, NOW);
    expect(res.ok).toBe(false);
  });

  it("rejects an empty credential in a restored user", () => {
    const { db, admin } = adminDb();
    const bad = JSON.parse(JSON.stringify(db)) as Database;
    bad.users[0].passwordHash = "";
    bad.users[0].passwordSalt = "";
    const res = execute(db, admin, { type: "import_backup", database: bad }, NOW);
    expect(res.ok).toBe(false);
  });

  it("still accepts a clean round-trip of its own backup", () => {
    const { db, admin } = adminDb();
    const res = execute(db, admin, { type: "import_backup", database: JSON.parse(JSON.stringify(db)) as Database }, NOW);
    expect(res.ok).toBe(true);
  });

  it("does not throw on a role the matrix does not know", () => {
    expect(can("superuser" as never, "users:read")).toBe(false);
  });
});

// Regression tests for the audit-log fixes (audit finding H-03 / M-03).
describe("audit log ceiling and audited exports", () => {
  it("caps the audit log instead of growing until storage fails", () => {
    let db = emptyDatabase();
    const actor: Actor = { id: "u1", fullName: "Ada", role: "administrator" };
    for (let i = 0; i < AUDIT_LIMIT + 25; i += 1) db = audit(db, actor, { action: "test", entity: "test", entityId: "test", summary: "tick" }, NOW);
    expect(db.audit.length).toBe(AUDIT_LIMIT);
  });

  it("records an audit entry when a backup leaves the system", () => {
    const { db, admin } = adminDb();
    const res = execute(db, admin, { type: "record_backup_export" }, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.db.audit[0].action).toBe("backup:export");
      expect(res.db.audit[0].actorId).toBe(admin.id);
    }
  });

  it("refuses the export record for a role without backup:export", () => {
    const { db } = adminDb();
    const ops: Actor = { id: "u2", fullName: "Ops", role: "operations" };
    const res = execute(db, ops, { type: "record_backup_export" }, NOW);
    expect(res.ok).toBe(false);
  });
});
