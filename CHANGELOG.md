# Changelog

## Phase 13 — the intended stack, running (unreleased)

The application now runs as the brief specifies: Next.js + PostgreSQL, with authority on the server.

**Added**

- PostgreSQL schema (`db/migrations/001_init.sql`, `002_resource_reservations.sql`): 16 tables,
  `btree_gist` + `pgcrypto`, an exclusion constraint that makes double booking impossible at the
  database, an append-only audit trigger and a monotonic odometer trigger.
- Server layer (`src/server/`): validated environment, typed SQL via Kysely, repository that maps
  the domain snapshot to tables, one transactional command path under an advisory lock.
- HTTP API (`src/app/api/`): `/api/health`, `/api/session`, `/api/auth/login`, `/api/auth/logout`,
  `/api/setup`, `/api/commands`. Zod-validated, redacted responses, mapped database errors.
- Authentication on maintained libraries: Argon2id (`@node-rs/argon2`) and sealed cookies
  (`iron-session`). Legacy browser-build PBKDF2 credentials still verify (D-51).
- Scripts: `db:migrate`, `db:seed` (three locks; no default password), `db:reset`, `db:backup`,
  `db:restore`.
- `docs/SETUP_AND_DEPLOYMENT.md` (Fedora run book), `run.sh`, `docker-compose.yml`, `.env.example`.
- `./run.sh nuke`: one confirmed command to start over — compose down -v, the container, its
  volume, the postgres image, a stale rootlessport, `.env`, `node_modules` and `.next`. The git
  checkout and source files are untouched. Run book §9 documents it, with the by-hand equivalent.
- `npm run doctor` reports a missing schema once, with the two commands that fix it, instead of
  also flagging the application's health check as a second, unrelated problem.
- `npm run doctor` / `./run.sh doctor`: reads the configuration, the container state, who holds
  the database port, the live connection and the applied migrations, and names the fix for the
  first thing that is wrong. `./run.sh db-reset-container` clears an orphaned Podman
  `rootlessport` and a stale volume in one confirmed step.
- Integration suite against a real PostgreSQL (`npm run test:integration`, 5 tests), and a fake
  API for the UI tests so 130 existing tests keep driving real components.
- CI: a second job that runs the integration suite against `postgres:18-alpine`.

**Changed**

- The browser no longer owns the database. `useTms` fetches a redacted snapshot and posts
  commands; `dispatch` is asynchronous and every call site awaits it.
- Enforcement of permissions moved to the server: the actor comes from the cookie, the command type
  is allow-listed, and `setup_administrator` / `import_backup` cannot be called from a browser.
- Backup export in the Users screen is now a redacted export; restoring is a server-side command.

**Removed**

- `localStorage`/`sessionStorage` persistence, in-page PBKDF2 hashing for new credentials, the
  single-file Vite build, and the `server-only` marker (D-53 explains what replaced it).


All notable changes to this repository. The project follows the phase structure in `AGENTS.md`
and the phase prompts; entries below name the phase and the evidence.

## 2026-10-23 — Phase 12: repository rebuild and security remediation

The application previously existed only inside `Richie TMS demo 1.zip` and `Richie TMS demo 2.zip`.
Nothing could be built, reviewed, scanned or tested from the repository itself.

### Repository

- Demo 2 materialised at the repository root (69 files). The two archives were removed from the
  working tree; both remain recoverable from commit `030197e`.
- CI moved from inside the archive to `.github/workflows/`, and extended: coverage ratchet,
  full-tree `npm audit`, CodeQL (`security-and-quality`), dependency review with a licence
  denylist, Dependabot (npm + Actions), concurrency cancellation, `persist-credentials: false`,
  build-artifact upload.
- Added `README.md`, `SECURITY.md`, `.gitignore`, `.nvmrc`, `vitest.config.ts`.
- `AGENTS.md` replaced by the supplied standing brief, verbatim. The previous condensed version
  (which stated that brief §5.1 and §7 "were not supplied") is preserved at
  `docs/archive/AGENTS-condensed.md`. Decision: D-42.
- `package.json`: real name (`richie-tms`), description, `engines.node >= 20.19`,
  `test:coverage` and `audit:dev` scripts; `check` now enforces coverage.

### Security

- **Credential policy** is enforced in the service layer, not the React hook: `validateCredential()`
  at setup, create and reset, plus the length rule inside `hashPassword()`. PBKDF2-SHA256 raised
  from 120,000 to 600,000 iterations. (D-43, audit H-01/M-04.)
- **Backup import validates untrusted input**: new `src/tms/backupGuard.ts` checks ids, roles,
  credential shape, driver/client links, duplicates and collection ceilings; `can()` fails closed
  on an unknown role. (D-44, audit H-02.)
- **Audit log capped at 5,000 entries** and **backup export is permissioned and audited** through
  the new `record_backup_export` command. (D-45, audit H-03/M-03.)
- **Content-Security-Policy** added to the single-file build, with `referrerpolicy="no-referrer"`
  on the Google Fonts link. (D-47, audit L-03.)

### Dependencies

- `vite` 7.3.2 → 7.3.7, `vite-plugin-singlefile` 2.3.0 → 2.3.4, `vitest` 3.2.7 → 5.0.5,
  `@vitest/coverage-v8` 5.0.5 added and pinned.
- `npm audit`: 2 critical, 4 high, 1 moderate, 1 low → **1 low** (esbuild dev server, Windows).

### Verification (run in this session)

| Gate | Command | Result |
|---|---|---|
| Install | `npm ci` | 293 packages, lockfile honoured |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Tests | `npm run test:coverage` | **130 passed / 15 files**; 72.16 % statements, 64.90 % branches |
| Build | `npm run build` | `dist/index.html`, 573.57 kB (154.78 kB gzip) |
| Audit | `npm audit` | 1 low |

### Not done, and not claimed

- No server, database or API: the prototype remains browser-local (audit C-01). Contracts,
  bookings, CSV import, notifications, payments and offline mode are still absent.
- CI has not been observed running on GitHub's runner.
- No browser was available here, so the rebuilt bundle was verified by build and jsdom tests
  only, not visually.
- Licence and repository visibility remain an owner decision (Q-49).
