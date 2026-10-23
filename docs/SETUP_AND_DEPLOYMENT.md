# Setup and deployment

Exact commands to install, migrate, seed, build and run. Nothing else.

## 1. What runs where

| Piece | What it is |
|---|---|
| The application | Next.js 15 (App Router), TypeScript, served by `next start` on port 3000 |
| The database | PostgreSQL 15 or newer, with `btree_gist` and `pgcrypto` |
| Session | `iron-session`, sealed cookie, 8 hours |
| Passwords | `@node-rs/argon2` (Argon2id) |

The browser holds no credential and no business rule. Every write goes through
`POST /api/commands`, which validates with Zod, checks the role, applies the change and appends an
audit entry in one transaction.

## 2. Prerequisites

- **Node.js 20.19 or newer** (22 LTS recommended) and npm
- **PostgreSQL 15+**. Any installation will do: a package, a hosted server, or a container.
- Nothing else. There is no build tool, bundler or service beyond the above.

```bash
node --version      # v20.19.0 or higher
psql --version      # psql (PostgreSQL) 15 or higher
```

## 3. Install

```bash
git clone https://github.com/iwani1/Richie-RTS-.git richie-tms
cd richie-tms
npm ci
```

`npm ci` installs exactly the lockfile and reports no vulnerabilities.

## 4. Configure

```bash
cp .env.example .env
```

Then set four values in `.env`:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@host:5432/richie_tms` |
| `SESSION_SECRET` | 32+ characters: `openssl rand -base64 32` |
| `NODE_ENV` | `development` while evaluating, `production` when serving staff |

`.env` is git-ignored. It contains the database password and the cookie-sealing key; never commit it.

## 5. Create the database

Any of these, whichever suits you. The database needs the `btree_gist` and `pgcrypto` extensions;
the migrations create them, so the user below only needs the right to create a database.

**A PostgreSQL already on the machine:**

```bash
sudo -u postgres createuser --createdb richie
sudo -u postgres createdb --owner=richie richie_tms
sudo -u postgres psql -c "alter user richie with password 'your-password';"
```

**A container (Podman or Docker), if you have no server:**

```bash
podman run -d --name richie-db \
  -e POSTGRES_USER=richie -e POSTGRES_PASSWORD='your-password' -e POSTGRES_DB=richie_tms \
  -p 127.0.0.1:5432:5432 -v richie_pgdata:/var/lib/postgresql \
  docker.io/library/postgres:18-alpine
```

Note the volume path: PostgreSQL 18 keeps its data in `/var/lib/postgresql/18/docker` and refuses
to start with a volume on the older `/var/lib/postgresql/data`.

**Hosted PostgreSQL:** create a database and paste its connection string into `DATABASE_URL`.

### Check which server you are actually talking to

`DATABASE_URL` names a host and a port, not a container. If the machine already runs another
PostgreSQL — a second project's container, or a package — that server answers for the port, and its
users and passwords are the ones that apply. The symptom is a login failure for a user you are sure
you created:

```bash
podman ps --format '{{.Names}}  {{.Ports}}'     # or: docker ps
ss -ltnp | grep 5432                            # who is listening
```

If something else owns 5432, either stop it, or publish this database somewhere private and say so
in `DATABASE_URL`:

```bash
podman run -d --name richie-db \
  -e POSTGRES_USER=richie -e POSTGRES_PASSWORD='your-password' -e POSTGRES_DB=richie_tms \
  -p 127.0.0.1:5433:5432 -v richie_pgdata:/var/lib/postgresql \
  docker.io/library/postgres:18-alpine
```

```ini
DATABASE_URL="postgresql://richie:your-password@127.0.0.1:5433/richie_tms"
```

The port in `DATABASE_URL` must be the port the database is published on; the password must be the
one that database was created with. Editing `.env` never changes a password already stored in a
volume — use `alter user` (above) or start a fresh volume.

### If it does not start

The application refuses to run on an invalid configuration rather than misbehaving later, and now
says which value is wrong on the page itself:

| Message | Meaning |
|---|---|
| `SESSION_SECRET must be at least 32 characters` | `.env` still holds the example value. Run `openssl rand -base64 32` and paste the result. |
| `connect ECONNREFUSED 127.0.0.1:5432` from `npm run db:migrate` | PostgreSQL is not running, or `DATABASE_URL` points at the wrong port. |
| `password authentication failed for user "richie"` | the password in `DATABASE_URL` is not the one the database was created with. |
| `relation "schema_migrations" does not exist` | migrations were never applied. Run `npm run db:migrate`. |

A change to `.env` takes effect only after the server is restarted: a running process keeps the
values it started with.

## 6. Migrate

```bash
npm run db:migrate
```

Applies every file in `db/migrations/` in filename order, each in its own transaction, and records
it in `schema_migrations`. It creates the extensions, the tables, the exclusion constraint that
prevents double booking, and the append-only and odometer triggers. Re-running is safe: applied
migrations are skipped.

Expected:

```
Applying migrations to postgresql://***@127.0.0.1:5432/richie_tms
  > 001_init.sql
  > 002_resource_reservations.sql
Done. Applied 2 migration(s).
```

## 7. Run

```bash
npm run build
npm start
```

Open <http://localhost:3000>. The first page asks you to create the administrator account; sign in
and open **Settings** to supply the business rules. Nothing is pre-filled, and dependent features
stay blocked until you do.

For development with hot reload: `npm run dev`.

## 8. Backups

```bash
npm run db:backup -- ./backups/2026-10-23.json     # full export, contains password hashes
npm run db:restore -- ./backups/2026-10-23.json    # replaces the current contents
```

The export is unencrypted and includes Argon2 hashes: store it encrypted and treat it as personal
data. A PostgreSQL-native alternative is `pg_dump --format=custom`.

## 9. Checks

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # 147 unit and component tests
npm run test:integration # against a real database; needs TEST_DATABASE_URL
npm run build            # production build
```

`npm run check` runs typecheck, lint, tests with coverage thresholds and the build in one go.

## 10. Deploying beyond one machine

- Run a single application process. Writes are serialised with a PostgreSQL advisory lock, but the
  sign-in throttle is per-process memory.
- Terminate TLS at a reverse proxy (nginx, Caddy). The application does not do TLS, and HSTS must be
  set by the proxy — a meta tag cannot do it.
- Set `NODE_ENV=production` and a fresh `SESSION_SECRET`. Changing it signs everybody out.
- Restrict `DATABASE_URL` to the application host; the database should not be reachable from the
  internet.
- Schedule `npm run db:backup` and test restoring from it.

## 12. Known limits, stated plainly

Deliberate cuts for this stage, recorded so nobody discovers them in production:

1. **One server process.** Writes are serialised with a PostgreSQL advisory lock, which is correct
   across processes, but the sign-in throttle is per-process memory. Two instances behind a load
   balancer would need that counter moved into the database or the proxy.
2. **The whole workload is sent to the browser** after each command (redacted). Correct and simple
   for a single operator's ledger; it will need pagination before the record count reaches the tens
   of thousands.
3. **No self-service password reset, no 2FA, no email.** An administrator resets passwords from
   **Users**. Recovering the last administrator needs database access.
4. **No TLS inside the application.** Terminate it at a reverse proxy (§11).
5. **Audit retention is unset** (Q-18): the log is append-only and grows forever until a retention
   policy is agreed.
6. **Business rules still to be supplied by management** appear as empty settings and blocking
   messages, not as defaults. `docs/OPEN_QUESTIONS.md` lists every one.
7. **Session lifetime is eight hours**, fixed in `src/server/session.ts`. Changing it is a one-line
   change, but it is a policy decision, so it is not configurable yet.

## 13. What was verified, and what was not

Verified by running:

- The full test suite (147 passed, 5 skipped) and the integration suite against PostgreSQL 18.
- `npm run build` and `npm start`, with `/api/health` reporting the database and both migrations.
- Sign-in, a write, the audit entry it produces, and the redaction of every `passwordHash`.
- Migration from an empty database, in order, twice.

Not verified here: installation on a specific operating system, a container runtime, a reverse proxy
with TLS, and a second application instance. The commands above are the ones used; the platform
steps around them depend on your machine.
