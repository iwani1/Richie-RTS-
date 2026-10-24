// Server-side configuration. Validated once, at import, so a misconfigured deployment fails at
// start-up with a readable message instead of at the first sign-in.
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (see .env.example)"),
  // iron-session seals cookies with this. 32 characters is its minimum; generate with
  // `openssl rand -base64 32`. Never commit a real value: .env is git-ignored.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters (openssl rand -base64 32)"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

const REQUIRED = {
  DATABASE_URL: "DATABASE_URL is required (postgresql://user:password@host:5432/database).",
  SESSION_SECRET: "SESSION_SECRET is required (at least 32 characters; openssl rand -base64 32).",
} as const;

export function env(): Env {
  if (cached) return cached;
  const missing = Object.entries(REQUIRED).filter(([key]) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Invalid server configuration:\n${missing.map(([, message]) => `  - ${message}`).join("\n")}\nCopy .env.example to .env and fill it in.`);
  }

  // A secret that is present but too short is the commonest first-run mistake: .env.example ships a
  // placeholder, people copy the file and never replace that one line. Say which line, how long it
  // is and how to make a real one, instead of reporting a rule the reader has to go and look up.
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    const placeholder = /^change[-_ ]?me/i.test(secret);
    throw new Error(
      [
        "Invalid server configuration:",
        `  - SESSION_SECRET is ${secret.length} character${secret.length === 1 ? "" : "s"} long; at least 32 are required.`,
        placeholder ? "    That value is the placeholder from .env.example; it has never been replaced." : "",
        "    In the .env file at the root of this checkout, replace the whole SESSION_SECRET line with:",
        "      SESSION_SECRET=\"<paste the output of: openssl rand -base64 32>\"",
        "    Then stop the server (Ctrl+C) and start it again. Existing sessions are signed out.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    NODE_ENV: process.env.NODE_ENV ?? "development",
  });
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server configuration:\n${detail}\nCopy .env.example to .env and fill it in.`);
  }
  if (parsed.data.NODE_ENV === "production" && !process.env.DATABASE_URL?.startsWith("postgres")) {
    throw new Error("DATABASE_URL must be a postgres:// connection string.");
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: forget the cached configuration (used by integration tests that set env vars). */
export function resetEnvCache() {
  cached = null;
}
