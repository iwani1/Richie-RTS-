// Applies db/migrations/*.sql in filename order, once each, inside a transaction.
//
// The brief requires hand-written SQL migrations for the constraints an ORM cannot express
// (exclusion constraints, triggers, partial unique indexes). Because the whole schema is SQL,
// this runner is the only migration machinery the project needs.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { loadEnvFile } from "./env-loader";

export async function migrate(connectionString: string, log = console.log): Promise<string[]> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const done = new Set((await client.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version));

    for (const file of files) {
      if (done.has(file)) {
        log(`  = ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(path.join(dir, file), "utf8");
      log(`  > ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js")) {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env (or export it) first.");
    process.exit(1);
  }
  console.log("Applying migrations to", url.replace(/:\/\/[^@]+@/, "://***@"));
  migrate(url)
    .then((applied) => console.log(applied.length ? `Done. Applied ${applied.length} migration(s).` : "Done. Nothing to apply."))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
