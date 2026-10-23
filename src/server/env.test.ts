import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "./env";

const ORIGINAL = { ...process.env };

describe("server configuration", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL };
    resetEnvCache();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
    resetEnvCache();
  });

  it("fails with a readable message when DATABASE_URL is missing", () => {
    delete (process.env as Record<string, string | undefined>).DATABASE_URL;
    expect(() => env()).toThrow(/DATABASE_URL is required/);
  });

  it("refuses a session secret shorter than iron-session's minimum", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SESSION_SECRET = "too-short";
    expect(() => env()).toThrow(/SESSION_SECRET/);
  });

  it("accepts a complete configuration and defaults NODE_ENV", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SESSION_SECRET = "x".repeat(32);
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    const parsed = env();
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.ALLOW_DEMO_SEED).toBe(false);
  });

  it("only treats the literal string 'true' as enabling the demo seed", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SESSION_SECRET = "x".repeat(32);
    process.env.ALLOW_DEMO_SEED = "1";
    expect(env().ALLOW_DEMO_SEED).toBe(false);
    resetEnvCache();
    process.env.ALLOW_DEMO_SEED = "true";
    expect(env().ALLOW_DEMO_SEED).toBe(true);
  });
});
