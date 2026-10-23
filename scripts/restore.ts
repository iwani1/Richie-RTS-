// Restores a full backup produced by `npm run db:backup`.
//
// It refuses, by name, the redacted export the Users screen downloads: those files deliberately
// carry no credentials, so restoring one would leave every account unable to sign in. Refusing is
// the honest outcome; importing it quietly would look successful and lock the business out.
//
// The audit log is restored too. The append-only trigger forbids UPDATE and DELETE, not INSERT, so
// replaying historical rows into an empty table is allowed and keeps the record intact.
import { loadEnvFile } from "./env-loader";
import { readFileSync } from "node:fs";
import { sql } from "kysely";
import { closeDb, db } from "../src/server/db";
import { emptyDatabase, migrate, type Database } from "../src/tms/types";
import { saveDatabase, truncateAll } from "../src/server/repository";

loadEnvFile();

async function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: npm run db:restore -- <full-backup.json>");
    process.exit(1);
  }
  const parsed: unknown = JSON.parse(readFileSync(source, "utf8"));
  const candidate = (parsed as { database?: unknown }).database ?? parsed;
  const database: Database | null = migrate(candidate);
  if (!database) {
    console.error("That file is not a Richie TMS database snapshot (it failed the schema migration check).");
    process.exit(1);
  }
  if (database.users.length > 0 && database.users.every((user) => !user.passwordHash)) {
    console.error("Refusing to restore a redacted export: it has no credentials, so nobody could sign in.");
    console.error("Use a file from `npm run db:backup`, or reset and run first-run setup again.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.RESTORE_I_MEAN_IT !== "true") {
    console.error("Refusing to restore into NODE_ENV=production. Set RESTORE_I_MEAN_IT=true to override.");
    process.exit(1);
  }

  const pool = db();
  await pool.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
    await truncateAll(trx);
    // `before` is empty because everything was just removed: every row, and every audit entry from
    // the backup, is therefore "new" and gets inserted.
    await saveDatabase(trx, emptyDatabase(), database);
  });
  console.log(`Restored ${database.users.length} users, ${database.rentals.length} rentals and ${database.audit.length} audit rows from ${source}.`);
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
