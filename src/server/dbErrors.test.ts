// The messages an operator sees when the database is misconfigured. These are the first failures a
// self-hosted installation hits, and each one has to name the value at fault: "the change could not
// be saved" sends someone to the logs for something that is written in .env.
import { describe, expect, it } from "vitest";
import { describeDatabaseError } from "./commands";

const pgError = (code: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error("postgres detail"), { code, ...extra });

describe("database error messages", () => {
  it("names the password as the problem, and says to restart", () => {
    const result = describeDatabaseError(pgError("28P01"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toContain("rejected the password in DATABASE_URL");
    expect(result.message).toContain("restart");
  });

  it("says the database is missing rather than blaming the password", () => {
    const result = describeDatabaseError(pgError("3D000"));
    expect(result.status).toBe(503);
    expect(result.message).toContain("does not exist");
    expect(result.message).toContain("npm run db:migrate");
  });

  it("turns an unmigrated schema into the command that fixes it", () => {
    const result = describeDatabaseError(pgError("42P01", { message: 'relation "schema_migrations" does not exist' }));
    expect(result.status).toBe(503);
    expect(result.message).toBe("The schema has not been created. Run: npm run db:migrate");
  });

  it("keeps the double-booking message for the exclusion constraint", () => {
    const result = describeDatabaseError(pgError("23P01"));
    expect(result.status).toBe(409);
    expect(result.message).toContain("overlapping");
  });

  it("never leaks the raw postgres message for an unexpected failure", () => {
    const result = describeDatabaseError(pgError("XX000", { message: "internal: relation pg_foo" }));
    expect(result.message).not.toContain("pg_foo");
    expect(result.status).toBe(500);
  });
});
