// `npm run doctor` / `./run.sh doctor`
//
// First-run failures on a workstation are almost never in the application: they are an occupied
// port, a stale container or a password that does not match between .env and the database. This
// checks each of those in the order they bite, and says what to do about the one that is wrong.
//
// It only reads: it never starts, stops, creates or deletes anything.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "./env-loader";

loadEnvFile();

type Level = "ok" | "warn" | "fail" | "info";
const results: { level: Level; title: string; detail?: string[] }[] = [];
const add = (level: Level, title: string, detail?: string[]) => results.push({ level, title, detail });

function run(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

// ------------------------------------------------------------------ 1. Node
const nodeVersion = process.versions.node;
const [major, minor] = nodeVersion.split(".").map(Number);
if (major > 20 || (major === 20 && minor >= 19)) add("ok", `Node ${nodeVersion}`);
else add("fail", `Node ${nodeVersion} is too old`, ["This application needs 20.19 or newer. Install Node 22 LTS."]);

// ------------------------------------------------------------------ 2. configuration
const placeholder = /change-me|replace-me|example\.com/i;

if (!existsSync(".env")) {
  add("fail", ".env is missing", ["Run: cp .env.example .env", "Then fill in DATABASE_URL, SESSION_SECRET and POSTGRES_PASSWORD."]);
} else {
  add("ok", ".env found");

  const secret = envValue("SESSION_SECRET");
  if (!secret) add("fail", "SESSION_SECRET is not set", ["Generate one: openssl rand -base64 32"]);
  else if (secret.length < 32) add("fail", `SESSION_SECRET is only ${secret.length} characters`, ["It must be at least 32. Generate one: openssl rand -base64 32"]);
  else if (placeholder.test(secret)) add("warn", "SESSION_SECRET still looks like the example value", ["Generate a real one: openssl rand -base64 32"]);
  else add("ok", "SESSION_SECRET is set (32+ characters)");

  const databaseUrl = envValue("DATABASE_URL");
  if (!databaseUrl) {
    add("fail", "DATABASE_URL is not set", ["Example: postgresql://richie:password@127.0.0.1:5432/richie_tms"]);
  } else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    add("fail", "DATABASE_URL is not a postgres:// connection string");
  } else {
    const parsed = new URL(databaseUrl);
    add("ok", `DATABASE_URL points at ${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`);

    const postgresPassword = envValue("POSTGRES_PASSWORD");
    if (postgresPassword && decodeURIComponent(parsed.password) !== postgresPassword) {
      add("fail", "The password in DATABASE_URL does not match POSTGRES_PASSWORD", [
        "The container is created with POSTGRES_PASSWORD; the application connects with DATABASE_URL.",
        "Make them the same, then recreate the database: ./run.sh db-reset-container",
      ]);
    } else if (postgresPassword) {
      add("ok", "DATABASE_URL password matches POSTGRES_PASSWORD");
    }
    if (placeholder.test(decodeURIComponent(parsed.password))) {
      add("warn", "The database password is still the example value", [
        "Change it in .env (both places), then: ./run.sh db-reset-container",
      ]);
    }
  }
}

// ------------------------------------------------------------------ 3. container runtime
const compose =
  run("docker", ["compose", "version"]) !== null
    ? "docker compose"
    : run("podman-compose", ["--version"]) !== null
      ? "podman-compose"
      : run("podman", ["compose", "version"]) !== null
        ? "podman compose"
        : null;

if (compose) add("ok", `Compose runtime: ${compose}`);
else add("info", "No compose runtime found", ["That is fine if PostgreSQL is installed on the host instead of in a container."]);

const container = run("podman", ["ps", "-a", "--format", "{{.Names}}|{{.Status}}|{{.Ports}}"]) ??
  run("docker", ["ps", "-a", "--format", "{{.Names}}|{{.Status}}|{{.Ports}}"]);
if (container !== null) {
  const line = container.split("\n").find((row) => row.startsWith("richie-tms-db"));
  if (!line) add("info", "No richie-tms-db container yet", ["Start it: podman-compose up -d db"]);
  else {
    const [, status] = line.split("|");
    if (/^Up .*healthy/i.test(status)) add("ok", `Container: ${status}`);
    else if (/^Up/i.test(status)) add("warn", `Container is starting: ${status}`, ["Wait a few seconds; healthcheck retries for about a minute."]);
    else add("fail", `Container is not running: ${status}`, [
      "Recreate it: ./run.sh db-reset-container",
      "If it says 'bind: address already in use', something else holds the port — see the next check.",
    ]);
  }
}

// ------------------------------------------------------------------ 4. can we actually connect
// This runs before the port check on purpose: if the connection works, whoever holds the port is
// the database, and an occupied port is not a problem at all.
const databaseUrl = envValue("DATABASE_URL");
let connected = false;
if (!databaseUrl) {
  add("fail", "Skipped the connection test: DATABASE_URL is not set");
} else {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 4000 });
  try {
    await client.connect();
    connected = true;
    const version = (await client.query("select version()")).rows[0].version as string;
    add("ok", `Connected: ${version.split(",")[0]}`);
    const hasMigrations = (await client.query("select count(*)::int as n from information_schema.tables where table_name = 'schema_migrations'")).rows[0].n as number;
    if (hasMigrations === 0) {
      add("fail", "The schema has not been created in this database", ["Run: npm run db:migrate"]);
    } else {
      const applied = (await client.query("select version from schema_migrations order by version")).rows.map((r) => r.version as string);
      const users = (await client.query("select count(*)::int as n from app_user")).rows[0].n as number;
      add("ok", `Migrations applied: ${applied.join(", ") || "none"}`);
      add("info", users === 0 ? "No accounts yet: the first page will offer first-run setup." : `Accounts: ${users}`);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "28P01") {
      add("fail", 'password authentication failed for user "richie"', [
        "The server is reachable, but this password is not the one the database was created with.",
        "Most often the container never started and you are talking to a different PostgreSQL on that port.",
        "Check the two rows below, then: ./run.sh db-reset-container",
      ]);
    } else if (code === "3D000") {
      add("fail", "The database does not exist", ["Create it, or set DATABASE_URL to an existing database."]);
    } else if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /ECONNREFUSED|timeout/i.test(String((error as Error).message))) {
      add("fail", `Cannot connect to ${new URL(databaseUrl).hostname}:${new URL(databaseUrl).port || "5432"}`, [
        "Nothing is accepting connections there. Start the database: podman-compose up -d db",
      ]);
    } else {
      add("fail", `Connection failed: ${(error as Error).message}`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ------------------------------------------------------------------ 5. who owns the port
const port = databaseUrl ? new URL(databaseUrl).port || "5432" : "5432";
const listening = run("ss", ["-ltnp"]) ?? run("ss", ["-ltn"]) ?? "";
const holder = listening.split("\n").find((row) => new RegExp(`[:.]${port}\\s`).test(row));

if (connected) {
  add("ok", `Port ${port} is serving this database${holder?.includes("rootlessport") ? " (via Podman's port forwarder)" : ""}`);
} else if (!holder) {
  add("info", `Nothing is listening on port ${port}`, ["Start the database: podman-compose up -d db"]);
} else if (holder.includes("rootlessport")) {
  add("fail", `Port ${port} is held by a leftover Podman port forwarder (rootlessport)`, [
    "This is an orphan from an earlier container that failed to start; it is not PostgreSQL.",
    "Fix: podman rm -f richie-tms-db && pkill -f rootlessport",
    "Then: podman-compose up -d db — or just ./run.sh db-reset-container, which does both.",
  ]);
} else if (/postgres/i.test(holder)) {
  add("warn", `Port ${port} is held by a different PostgreSQL process`, [
    "If that is the host's own PostgreSQL, either stop it or move the container:",
    '  POSTGRES_PORT="5433" in .env, the same port in DATABASE_URL, then ./run.sh db-reset-container',
  ]);
} else {
  add("fail", `Port ${port} is in use by another process`, [holder.trim()]);
}

// ------------------------------------------------------------------ 6. is the app up
const health = run("curl", ["-sS", "--max-time", "3", "http://localhost:3000/api/health"]);
if (health === null) add("info", "The application is not running on port 3000", ["Start it: ./run.sh start"]);
else if (health.includes('"ok":true')) add("ok", "The application answers /api/health with ok:true");
else add("fail", `The application is running but unhealthy: ${health.slice(0, 200)}`);

// ------------------------------------------------------------------ report
const icon: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗", info: "·" };
const colour: Record<Level, string> = { ok: "\u001b[32m", warn: "\u001b[33m", fail: "\u001b[31m", info: "\u001b[90m" };
process.stdout.write("\nRichie TMS — first-run diagnostics\n\n");
for (const result of results) {
  process.stdout.write(`${colour[result.level]}${icon[result.level]}\u001b[0m ${result.title}\n`);
  for (const line of result.detail ?? []) process.stdout.write(`    ${line}\n`);
}
const failures = results.filter((result) => result.level === "fail").length;
process.stdout.write(
  failures === 0
    ? "\nNo blocking problems found. If the browser still shows an error, restart the app and reload.\n"
    : `\n${failures} blocking problem(s). Fix the first one above, then run this again.\n`,
);

// Keep the reference so lint sees it used on every path (readFileSync is used only for .env checks).
void readFileSync;
process.exit(failures === 0 ? 0 : 1);
