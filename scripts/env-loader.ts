// Loads `.env` for scripts run outside Next, which loads the same file itself.
// `.env.local` is accepted as a fallback so a checkout that follows Next's convention still works.
// Kept tiny on purpose: the app has no other dotenv dependency, and secrets stay in files that
// .gitignore already excludes. docker-compose.yml also reads `.env`, so the database password and
// DATABASE_URL stay in one place.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvFile(file = ".env"): void {
  for (const candidate of [file, ".env.local"]) {
    const full = path.join(process.cwd(), candidate);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
