// Empties every table, keeping the schema. For a workstation this is the "start again" button.
//
// It refuses to run when NODE_ENV is production unless RESET_I_MEAN_IT=true, because a
// destructive command that is one typo away from production data is not a convenience.
import { loadEnvFile } from "./env-loader";
import { sql } from "kysely";
import { db, closeDb } from "../src/server/db";
import { truncateAll } from "../src/server/repository";

loadEnvFile();

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.RESET_I_MEAN_IT !== "true") {
    console.error("Refusing to reset: NODE_ENV=production. Set RESET_I_MEAN_IT=true to override.");
    process.exit(1);
  }
  const pool = db();
  await pool.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
    await truncateAll(trx);
  });
  console.log("All tables emptied. The schema is intact; the next request will offer first-run setup.");
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
