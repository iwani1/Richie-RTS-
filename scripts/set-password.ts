// Sets an existing account's password from the terminal.
//
//   npm run user:password -- --email admin@example.com
//   npm run user:password -- --email admin@example.com --password 'a new one'
//
// Why this exists: passwords are salted and hashed with Argon2id, so there is no SQL statement that
// can reset one, and the only in-app reset is performed by an administrator who can already sign in.
// Without this, an installation whose single administrator forgets their password has to be thrown
// away. It reuses the same hashPassword() the server uses, so the rules never diverge.
//
// With no --password it generates one and prints it: a password typed on a command line is kept in
// shell history, and the generated one is stronger than most of them anyway.
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { loadEnvFile } from "./env-loader";
import { db, closeDb } from "../src/server/db";
import { hashPassword, WeakPasswordError } from "../src/server/password";

loadEnvFile();

const WRITE_LOCK = 728411;

/** Reads `--flag value` from argv so the command reads the way it is documented. */
function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function generated(): string {
  // 18 bytes of base64url: 24 characters, no character that needs quoting in a shell or a URL.
  return randomBytes(18).toString("base64url");
}

async function main(): Promise<void> {
  const email = arg("email")?.trim();
  if (!email) {
    console.error("Which account? Run:\n  npm run user:password -- --email someone@example.com");
    process.exit(1);
  }

  const password = arg("password") ?? generated();
  const generatedHere = arg("password") === undefined;
  let credential;
  try {
    credential = await hashPassword(password);
  } catch (error) {
    if (error instanceof WeakPasswordError) {
      console.error(error.message);
      console.error("Omit --password and one will be generated.");
      process.exit(1);
    }
    throw error;
  }

  const pool = db();
  const account = await pool.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${WRITE_LOCK})`.execute(trx);
    const row = await trx
      .selectFrom("app_user")
      .select(["id", "email", "full_name", "role", "active", "data"])
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .executeTakeFirst();

    if (!row) return null;

    // The columns are a projection of the jsonb document, so both are written: the sign-in path reads
    // the columns, the rest of the application reads the document.
    const document = { ...(row.data as Record<string, unknown>) };
    const now = new Date().toISOString();
    document.passwordHash = credential.passwordHash;
    document.passwordSalt = credential.passwordSalt;
    document.updatedAt = now;

    await trx
      .updateTable("app_user")
      .set({
        password_hash: credential.passwordHash,
        password_salt: credential.passwordSalt,
        updated_at: now,
        data: JSON.stringify(document),
      })
      .where("id", "=", row.id)
      .execute();

    return row;
  });

  if (!account) {
    const known = await pool.selectFrom("app_user").select(["email", "role"]).orderBy("email").execute();
    if (known.length === 0) {
      console.error("No accounts exist yet. Start the server and open it; the first page creates the administrator.");
    } else {
      console.error(`No account with the email "${email}". Existing accounts:`);
      for (const each of known) console.error(`  ${each.email}  (${each.role})`);
    }
    await closeDb();
    process.exit(1);
  }

  console.log(`Password set for ${account.email} (${account.role}).`);
  if (generatedHere) console.log(`\n  ${password}\n\nWrite it down now; it is not stored anywhere in readable form.`);
  if (!account.active) console.log("\nNote: this account is deactivated. An administrator has to reactivate it before it can sign in.");
  console.log("No restart needed. Sign in at http://localhost:3000");
  await closeDb();
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (/ECONNREFUSED|ENOTFOUND/.test(message)) {
    console.error("Is the database running? Check DATABASE_URL in .env and `podman ps`.");
  }
  await closeDb();
  process.exit(1);
});
