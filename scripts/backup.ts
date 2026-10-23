// A complete, server-side backup: every table, credentials included.
//
// This is the file you would need to rebuild the installation exactly. Because it contains password
// hashes and personal data it goes to a destination you control, and the operator-facing export in
// the Users screen is a different thing: a redacted copy for review, not a restore point.
import { loadEnvFile } from "./env-loader";
import { writeFileSync } from "node:fs";
import { closeDb } from "../src/server/db";
import { loadDatabase } from "../src/server/repository";

loadEnvFile();

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: npm run db:backup -- <file.json>");
    process.exit(1);
  }
  const database = await loadDatabase();
  const payload = { format: "richie-tms-full-backup", version: 1, exportedAt: new Date().toISOString(), database };
  writeFileSync(target, JSON.stringify(payload, null, 2), { mode: 0o600 });
  console.log(`Wrote ${target} (${database.users.length} users, ${database.audit.length} audit rows in the snapshot).`);
  console.log("This file contains password hashes and personal data. Keep it on encrypted storage.");
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
