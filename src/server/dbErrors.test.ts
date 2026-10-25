// The messages an operator sees when the database is misconfigured. These are the first failures a
// self-hosted installation hits, and each one has to name the value at fault: "the change could not
// be saved" sends someone to the logs for something that is written in .env.
import { describe, expect, it } from "vitest";
import { describeDatabaseError } from "./commands";

const pgError = (code: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error("postgres detail"), { code, ...extra });

describe("database error messages", () => {
  it("explains a refused counter rewind as an older backup, not as a bad date", () => {
    const result = describeDatabaseError(pgError("23514", { constraint: "reference_counter_no_rewind" }));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.message).toMatch(/older than this installation's numbering/);
    expect(result.message).toMatch(/already been printed/);

    // Any other check constraint keeps the plain message.
    const other = describeDatabaseError(pgError("23514", { constraint: "invoice_paid_within_total" }));
    expect(other.status).toBe(400);
  });

  it("names the password as the problem, and says to restart", () => {
    const result = describeDatabaseError(pgError("28P01"));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toContain("rejected the password in DATABASE_URL");
    expect(result.message).toContain("restart");
  });

  it("says which credentials were rejected, and never repeats the password", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://richie:s3cret@db.local:5433/richie_tms";
    try {
      const result = describeDatabaseError(pgError("28P01"));
      expect(result.message).toContain('user "richie"');
      expect(result.message).toContain("db.local:5433");
      expect(result.message).toContain('database "richie_tms"');
      expect(result.message).not.toContain("s3cret");
      // The character class that has to be percent-encoded is the second real cause.
      expect(result.message).toContain("%40");
    } finally {
      if (previous === undefined) delete (process.env as Record<string, string | undefined>).DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("recognises the example password and stops there", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://richie:change-me@127.0.0.1:5432/richie_tms";
    try {
      const result = describeDatabaseError(pgError("28P01"));
      expect(result.message).toContain('still contains the example password "change-me"');
      expect(result.message).toContain("127.0.0.1:5432");
      expect(result.message).toContain("ALTER USER richie");
      // The encoding table is for a password that exists; this one was never set.
      expect(result.message).not.toContain("%40");
    } finally {
      if (previous === undefined) delete (process.env as Record<string, string | undefined>).DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("treats either documented example password as unfilled, and quotes it back", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://richie:your-password@127.0.0.1:5432/richie_tms";
    try {
      const result = describeDatabaseError(pgError("28P01"));
      expect(result.message).toContain('still contains the example password "your-password"');
    } finally {
      if (previous === undefined) delete (process.env as Record<string, string | undefined>).DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });

  it("still explains itself when DATABASE_URL cannot be parsed", () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "not a url";
    try {
      const result = describeDatabaseError(pgError("28P01"));
      expect(result.message).toContain("rejected the password");
      expect(result.status).toBe(503);
    } finally {
      if (previous === undefined) delete (process.env as Record<string, string | undefined>).DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
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
