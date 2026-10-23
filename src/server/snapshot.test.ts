import { describe, expect, it } from "vitest";
import { redact, redactUser } from "./snapshot";
import { emptyDatabase, type User } from "../tms/types";

const user: User = {
  id: "u1",
  fullName: "Ama Owusu",
  email: "ama@example.test",
  role: "administrator",
  active: true,
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
  passwordSalt: "abcd",
  driverId: null,
  clientId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("redaction", () => {
  it("removes every field a client could use to verify a password", () => {
    const redacted = redactUser(user);
    expect(redacted.passwordHash).toBe("");
    expect(redacted.passwordSalt).toBe("");
    expect(redacted.email).toBe(user.email);
    expect(Object.keys(redacted).sort()).toEqual(Object.keys(user).sort());
  });

  it("redacts every user in a snapshot without touching anything else", () => {
    const database = { ...emptyDatabase(), users: [user, { ...user, id: "u2", email: "kofi@example.test" }] };
    const result = redact(database);
    expect(result.users.every((u) => u.passwordHash === "" && u.passwordSalt === "")).toBe(true);
    expect(result.schemaVersion).toBe(database.schemaVersion);
    expect(result.settings).toBe(database.settings);
    expect(JSON.stringify(result)).not.toContain("argon2");
  });
});
