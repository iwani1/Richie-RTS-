// `npm run env:init` — writes a working .env from .env.example, with real secrets.
//
// Why this exists: a first run failed because the example password was still in place and the
// value in DATABASE_URL did not match POSTGRES_PASSWORD. Both are generated here, from the same
// random value, so they cannot disagree. Nothing needs to be edited by hand before the first
// `npm run db:migrate`.
//
//   node scripts/init-env.mjs            # writes .env (refuses to overwrite)
//   node scripts/init-env.mjs --force    # overwrites .env
//   node scripts/init-env.mjs out.env    # writes somewhere else
//
// Deliberately dependency-free JavaScript: it runs on a fresh clone before `npm ci`, which is
// exactly when it is needed.
//
// The generated database password is base64url (A–Z a–z 0–9 - _), which is safe inside a URL and
// inside a double-quoted shell value, so it never needs escaping in DATABASE_URL or .env.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((arg) => !arg.startsWith("--")) ?? ".env";

const examplePath = path.join(process.cwd(), ".env.example");
if (!existsSync(examplePath)) {
  console.error("Cannot find .env.example in the current directory. Run this from the repository root.");
  process.exit(1);
}
if (existsSync(target) && !force) {
  console.error(`${target} already exists. Use --force to replace it, or edit it directly.`);
  process.exit(1);
}

/** 32 bytes → 43 url-safe characters. Long enough that guessing is not a concern. */
const databasePassword = randomBytes(32).toString("base64url");
/** iron-session needs at least 32 characters; 32 bytes of entropy is comfortably past that. */
const sessionSecret = randomBytes(32).toString("base64");

let text = readFileSync(examplePath, "utf8");

const replaceOnce = (pattern, replacement) => {
  if (!pattern.test(text)) {
    console.error(`.env.example no longer contains ${pattern}; this script needs updating.`);
    process.exit(1);
  }
  text = text.replace(pattern, replacement);
};

// Port first: DATABASE_URL is rewritten with whatever POSTGRES_PORT ends up being.
const portMatch = /^POSTGRES_PORT="?(\d+)"?$/m.exec(text);
const port = portMatch?.[1] ?? "5433";

replaceOnce(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD="${databasePassword}"`);
replaceOnce(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${sessionSecret}"`);
replaceOnce(
  /^DATABASE_URL=.*$/m,
  `DATABASE_URL="postgresql://richie:${databasePassword}@127.0.0.1:${port}/richie_tms"`,
);

writeFileSync(target, text, { mode: 0o600 });

const absolute = path.resolve(target);
const inside = !path.relative(process.cwd(), absolute).startsWith("..");
console.log(`Wrote ${inside ? path.relative(process.cwd(), absolute) || target : absolute} (mode 600).`);
console.log(`  database password: generated, 43 characters, stored in POSTGRES_PASSWORD and DATABASE_URL`);
console.log(`  session secret:    generated, 44 characters`);
console.log(`  database port:     ${port} (change POSTGRES_PORT and DATABASE_URL together if you need another)`);
console.log("");
console.log("Nothing else needs editing. Next:");
console.log("  podman-compose up -d db     # or: docker compose up -d db");
console.log("  npm run db:migrate");
console.log("  npm run build && npm start");
console.log("");
console.log("Or do all of it at once:  ./run.sh setup");
