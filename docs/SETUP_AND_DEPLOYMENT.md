# Setup and deployment — Fedora workstation

This is the operator's guide for running Richie TMS on a Fedora machine: what to install, how to
start it, how to sign in the first time, how to back it up, and what to do when something is wrong.

It is written for the deployment the brief describes: **one Next.js server on the office machine,
one PostgreSQL database beside it**, reached by staff over the office network or by the machine's
own browser.

> Every command below was executed in the development environment that built this application,
> except the Fedora-specific package installation and the container start (no Fedora host and no
> container runtime were available there). Those two are marked **[unverified here]** in
> [What was verified](#what-was-verified-and-what-was-not).

---

## 1. What runs where

```
  your browser ──HTTP(S)──>  Next.js server (this repo, port 3000)
                                   │
                                   └──TCP 5432──> PostgreSQL 18 (container or host service)
```

- **The browser holds no database.** It receives a redacted copy of the records your role may see,
  and sends *intents* ("confirm this rental"). The server decides whether the intent is allowed,
  validates it, writes it in a transaction and returns the new state.
- **PostgreSQL is the source of truth**, and it enforces the rules that must not be bypassed:
  a vehicle cannot be double-booked (exclusion constraint), the audit log cannot be rewritten
  (trigger), an odometer cannot go backwards (trigger), money is `NUMERIC(14,2)`.
- **Only the server has credentials.** Password hashes never reach the browser; they are Argon2id
  and they stay in `app_user`.

Ports: `3000` application, `5432` database. The database is published on `127.0.0.1` only.

---

## 2. Install the prerequisites on Fedora **[unverified here]**

```bash
sudo dnf install -y nodejs npm git openssl podman podman-compose
node -v      # must be >= 20.19
```

Fedora's repository usually carries a new enough Node. If `node -v` shows something older than
20.19, install Node 22 from NodeSource or use `dnf module`:

```bash
# Option A: NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# Option B: Fedora modular stream (if your release provides it)
sudo dnf module reset nodejs -y && sudo dnf module enable nodejs:22 -y
```

Podman can stand in for Docker; `podman-compose` reads the same `docker-compose.yml`. The file
names the PostgreSQL image fully (`docker.io/library/postgres:18-alpine`) so Podman does not stop
to ask which registry to use. If you see that prompt anyway, it means an older checkout of this
file: choose `docker.io/library/postgres:18-alpine`, or run `git pull` and try again. If you
prefer Docker CE, install it from Docker's repository and use `docker compose` instead — the file
does not change.

> **SELinux.** The database volume is a *named volume*, not a bind mount, so no `:Z` relabel is
> needed and both rootless Podman and Docker work unchanged. If you later bind-mount a directory
> into a container, add `:Z` to the volume or you will get "permission denied" inside the
> container.

---

## 3. First start, in order

### 3.1 Get the code

```bash
git clone <your-remote-url> richie-tms
cd richie-tms
```

### 3.2 Create the environment file (one command)

```bash
npm run env:init        # or: node scripts/init-env.mjs
```

This writes `.env` with a **generated database password and session secret**. The password goes
into both `DATABASE_URL` and `POSTGRES_PASSWORD` from the same random value, so they cannot
disagree; the port defaults to **5433**, not 5432, because Fedora workstations frequently have
something on 5432 already. There is nothing to edit by hand.

```ini
DATABASE_URL="postgresql://richie:<generated>@127.0.0.1:5433/richie_tms"
SESSION_SECRET="<generated, 44 characters>"
POSTGRES_PASSWORD="<same as in DATABASE_URL>"
POSTGRES_PORT="5433"
NODE_ENV="development"
```

If you would rather set the password yourself, copy the example and edit both places:

```bash
cp .env.example .env
```

| Variable | What it must be |
|---|---|
| `DATABASE_URL` | `postgresql://richie:<password>@127.0.0.1:<port>/richie_tms` |
| `SESSION_SECRET` | 32+ characters. `openssl rand -base64 32`. Changing it signs everyone out. |
| `POSTGRES_PASSWORD` | the **same** password as in `DATABASE_URL` |
| `POSTGRES_PORT` | the host port, default `5433`; must match the port in `DATABASE_URL` |
| `NODE_ENV` | `development` while trying it, `production` once you serve staff |
| `ALLOW_DEMO_SEED` | leave `false` unless you want the demo records |

`.env` is git-ignored. Never commit it: it contains the database password and the cookie key.

### 3.3 Start PostgreSQL

```bash
podman-compose up -d db          # or: docker compose up -d db
podman-compose ps                # wait until STATUS says "healthy"
```

The data volume is mounted at **`/var/lib/postgresql`**, not the older
`/var/lib/postgresql/data`. PostgreSQL 18 changed its data directory
(`PGDATA=/var/lib/postgresql/18/docker`), and the image refuses to start if it finds a volume at
the old path — it prints *"there appears to be PostgreSQL data in: /var/lib/postgresql/data
(unused mount/volume)"* and exits. If you copy this compose file into another project, keep that
path as it is.

The container publishes the database on `127.0.0.1:${POSTGRES_PORT:-5433}`. 5433 rather than the
default 5432 is deliberate: Fedora workstations often already have a PostgreSQL, or a stale Podman
port forwarder, on 5432. If you need a different port, change `POSTGRES_PORT` **and**
`DATABASE_URL` together.

The first start creates the `richie_pgdata` volume.

### 3.4 Install dependencies and create the schema

```bash
npm ci
npm run db:migrate
```

Or do 3.2–3.5 in one step: `./run.sh setup` (it generates `.env`, installs, starts the database,
migrates and builds), then `./run.sh start`.

`db:migrate` applies every file in `db/migrations/` in filename order, each in its own
transaction, and records it in `schema_migrations`. It creates the extensions (`btree_gist`,
`pgcrypto`), the tables, the exclusion constraint that prevents double booking, and the
append-only and odometer triggers. Running it twice is safe: applied migrations are skipped.

Expected output:

```
  > 001_init.sql
  > 002_resource_reservations.sql
Applied 2 migration(s).
```

### 3.5 Build and start

For everyday use:

```bash
npm run build
npm start                        # http://localhost:3000
```

For development (hot reload, slower first page):

```bash
npm run dev                      # http://localhost:3000
```

Both load `.env` automatically. `npm start` must be preceded by `npm run build`.

> Do not run `npm run build` while `npm run dev` is running. They share the `.next` directory and
> the dev server will start throwing `Cannot find module './chunks/vendor-chunks/next.js'` until
> you stop it, delete `.next` and start again.

### 3.6 Create the first administrator

Open <http://localhost:3000>. With no accounts in the database the application shows
**"Create the first administrator"**:

- full name, email, password (10 characters minimum, hashed with Argon2id on the server),
- confirm the password, then **Create administrator**.

That endpoint works exactly once: as soon as one account exists it returns *"Setup has already
been completed"*, and the command behind it refuses too. You are signed in immediately.

Then open **Settings** and fill in what the business must decide. Nothing is pre-filled on
purpose (brief integrity rule 4): until you set a company name, currency, vehicle categories,
service intervals and document types, the features that depend on them stay blocked with an
explanation rather than guessing. **Vehicles cannot be registered until at least one vehicle
category exists.**

### 3.7 Optional: demo records

```bash
# in .env
ALLOW_DEMO_SEED=true
DEMO_ADMIN_EMAIL=admin@richie.test
DEMO_ADMIN_PASSWORD=<choose one, 10+ characters>

npm run db:seed
```

The seed refuses to run if any account already exists, if `ALLOW_DEMO_SEED` is not `true`, if
`NODE_ENV=production`, or if no demo password is supplied (there is deliberately no default
password in this repository). It loads two categories, two vehicles, two drivers, one client and
one staff route — all clearly labelled demo records. Rates, currency and thresholds stay empty.

To start over: `npm run db:reset` (empties every table, keeps the schema, refuses in production
unless `RESET_I_MEAN_IT=true`).

---

## 4. Run it as a service (so it survives logout)

Create `~/.config/systemd/user/richie-tms.service`:

```ini
[Unit]
Description=Richie TMS
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/richie-tms
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now richie-tms
systemctl --user status richie-tms
journalctl --user -u richie-tms -f          # logs
loginctl enable-linger "$USER"              # keep it running when you are not logged in
```

The database container is managed separately (`docker compose up -d`, plus
`sudo systemctl enable --now docker`).

---

## 5. Let other staff reach it

By default the server listens on all interfaces, so other machines on the office network can open
`http://<this-machine-ip>:3000`. Two things must be true:

1. **The firewall allows the port**: `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload`
   (or open it only for the office subnet with `--add-rich-rule`).
2. **Cookies.** In `NODE_ENV=production` the session cookie is marked `Secure`, so browsers will
   only send it over HTTPS. Over plain `http://` on a LAN address, sign-in will appear to succeed
   and then bounce back to the sign-in screen. Either:

   - put a TLS reverse proxy in front (recommended):

     ```nginx
     server {
       listen 443 ssl;
       server_name tms.example.internal;
       ssl_certificate     /etc/pki/tls/certs/tms.crt;
       ssl_certificate_key /etc/pki/tls/private/tms.key;

       location / {
         proxy_pass http://127.0.0.1:3000;
         proxy_set_header Host $host;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto $scheme;
       }
     }
     ```

     then bind the app to localhost only (`npm start -- -H 127.0.0.1`) and open 3000 in the firewall
     never. With SELinux enforcing, allow nginx to make the outbound connection:
     `sudo setsebool -P httpd_can_network_connect 1`.

   - or serve over HTTP while you are still evaluating, by leaving `NODE_ENV=development`. This is
     a workstation setting, not an office deployment: development mode is slower and exposes
     detailed errors.

Never expose port 5432 beyond `127.0.0.1`. The compose file already does this.

---

## 6. Check that it is healthy

```bash
curl -s localhost:3000/api/health
```

```json
{"ok":true,"service":"richie-tms","database":"PostgreSQL 18.4; extensions: btree_gist, pgcrypto; migrations applied: 2","time":"..."}
```

If `ok` is `false` the HTTP status is `503` and the `database` field says what is wrong (usually
that PostgreSQL is not running). The application shows the same failure in the browser instead of
pretending to have no data.

Two more quick checks:

```bash
curl -s localhost:3000/api/session        # {"ok":true,"setupRequired":false,"user":null,"database":null}
ss -ltnp | grep -E ':(3000|5432)'         # 5432 only on 127.0.0.1
```

---

## 7. Backups

Two different things, deliberately:

| | Command | Contains | Use |
|---|---|---|---|
| Full backup | `npm run db:backup -- /path/backup.json` | everything, **including password hashes** | restore point; store encrypted and off-machine |
| Data export | Users screen → *Download export (JSON)* | everything except credentials | review, migration of data, audit-visible export |

Restore a **full** backup:

```bash
npm run db:restore -- /path/backup.json
```

The restore refuses a redacted export by name (`Refusing to restore a redacted export: it has no
credentials`), because importing one would leave every account unable to sign in. Both backup and
restore print what they did.

A plain `pg_dump` also works and is the better choice once the database is large:

```bash
docker compose exec db pg_dump -U richie -d richie_tms -Fc > richie-$(date +%F).dump
docker compose exec -T db pg_restore -U richie -d richie_tms --clean < richie-2026-10-23.dump
```

Take a backup **before** every `npm run db:migrate` on a database that matters.

---

## 8. Updating the application

```bash
npm run db:backup -- ~/richie-backup-$(date +%F).json
git pull
npm ci
npm run db:migrate          # applies any new migration
npm run build
sudo systemctl --user restart richie-tms     # or Ctrl-C and `npm start`
```

---

## 9. If the first run goes wrong: run the diagnostics

```bash
./run.sh doctor          # or: npm run doctor
```

It checks, in the order problems actually occur, and stops being vague:

```
Richie TMS — first-run diagnostics

✓ Node 22.23.1
✓ .env found
✓ SESSION_SECRET is set (32+ characters)
✓ DATABASE_URL points at 127.0.0.1:5432/richie_tms
✓ DATABASE_URL password matches POSTGRES_PASSWORD
✓ Compose runtime: podman-compose
✗ Container is not running: Created
✗ Port 5432 is held by a leftover Podman port forwarder (rootlessport)
    This is an orphan from an earlier container that failed to start; it is not PostgreSQL.
    Fix: podman rm -f richie-tms-db && pkill -f rootlessport
    Then: podman-compose up -d db — or just ./run.sh db-reset-container, which does both.
```

It only reads; it never starts, stops or deletes anything. Exit code is non-zero when something
blocks the application. When a container exists but is not running, it reads that container's own
log and names the cause — the volume-path error below is recognised by name.

### The `rootlessport` trap (Fedora, Podman)

When a rootless Podman container fails to start, its **port forwarder can stay behind**, still
holding `127.0.0.1:5432`. `podman-compose down` does not remove that orphan, so every later
`up` fails with `bind: address already in use`, and — because *something* is listening on 5432 —
`npm run db:migrate` connects to that dead endpoint (or to a host PostgreSQL) and reports
`password authentication failed for user "richie"`, which looks like a password problem and is not.

One command clears all of it:

```bash
./run.sh db-reset-container      # asks for confirmation; deletes the container AND its volume
npm run db:migrate
./run.sh start
```

It removes the container, kills a stale `rootlessport`, checks the port is free before starting,
waits for the healthcheck, and verifies the database answers — instead of leaving you to guess.

Doing it by hand is the same three steps:

```bash
podman-compose down -v
pkill -f rootlessport            # the orphan that holds the port
sudo ss -ltnp | grep 5432        # must now print nothing
podman-compose up -d db
```

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid server configuration: DATABASE_URL is required` | `.env` missing or not loaded | `cp .env.example .env`, fill it in, restart the process (env is read at start-up) |
| `SESSION_SECRET must be at least 32 characters` | placeholder still in `.env` | `openssl rand -base64 32`, paste, restart |
| Browser: *"Cannot reach the ledger"* | server not running, or wrong port | `curl localhost:3000/api/health`; check `journalctl --user -u richie-tms` |
| `/api/health` returns 503 | PostgreSQL down or unreachable | `docker compose ps`; `docker compose logs db` |
| `password authentication failed for user "richie"` | password in `DATABASE_URL` and `POSTGRES_PASSWORD` disagree, or the volume was created with the old password | make them match; if the volume was created with a different password, either change it in SQL (`ALTER USER richie PASSWORD '...'`) or remove the volume (destroys data) |
| Podman asks *"Please select an image"* | the compose file used a short image name, or a local `~/.config/containers/registries.conf` has no default | pick `docker.io/library/postgres:18-alpine`; or `git pull` (the file now names the registry) |
| `rootlessport listen tcp 127.0.0.1:5432: bind: address already in use` (or `port is already allocated`) | Fedora ships a PostgreSQL service that is already listening on 5432, so the container never started | `sudo systemctl disable --now postgresql` then `podman-compose up -d db`. Or keep it and set `POSTGRES_PORT="5433"` in `.env` **and** the same port in `DATABASE_URL`, then `podman-compose up -d db` |
| `password authentication failed for user "richie"` while 5432 is taken | the migration connected to something that is not your container — the **host** PostgreSQL, or a dead `rootlessport` endpoint left by a failed container | that is the symptom of the row above, not a password problem: `./run.sh doctor`, then `./run.sh db-reset-container` |
| Port 5432 held by `rootlessport` (`ss -ltnp` shows it, `postgresql.service` does not exist) | orphaned Podman port forwarder from a container that failed to start; survives `compose down` | `pkill -f rootlessport`, or just `./run.sh db-reset-container` |
| `Waiting for PostgreSQL to accept connections...` then `setup` fails | the container was created and then exited; `podman logs richie-tms-db` says why | `./run.sh doctor` reads that log and names the cause. The most common one is the volume path above; `git pull` if your compose file mounts `/var/lib/postgresql/data` |
| `there appears to be PostgreSQL data in: /var/lib/postgresql/data (unused mount/volume)` | compose mounts the volume at the pre-18 path | `git pull` (the path is now `/var/lib/postgresql`), then `podman-compose down -v && podman-compose up -d db` |
| Container is `Up` but login fails and the volume is old | the volume was created with an earlier `POSTGRES_PASSWORD`; changing `.env` afterwards does not change it | `ALTER USER richie PASSWORD '...'` inside the container, or `./run.sh db-reset-container` to start fresh (destroys data) |
| `Cannot find module './chunks/vendor-chunks/next.js'` | `npm run build` ran while `npm run dev` was running | stop dev, `rm -rf .next`, start again |
| `EADDRINUSE :3000` | another process on 3000 | `ss -ltnp \| grep 3000`, stop it, or `npm start -- -p 3100` |
| Sign-in succeeds then bounces back | `NODE_ENV=production` over plain HTTP: the cookie is `Secure` | use HTTPS (§5) or `NODE_ENV=development` while evaluating |
| `permission denied` for a file inside a container | SELinux context on a bind mount | add `:Z` to the volume, or use a named volume |
| `Refusing to seed` | one of the three seed locks | read the message: it names the missing variable or the existing accounts |
| Forgot the administrator password | no self-service reset exists | with database access: `npm run db:reset` on an evaluation install, or ask another administrator to reset it from **Users**. Resetting the only admin account requires database access by design. |

Logs: application output goes to the terminal, or `journalctl --user -u richie-tms`; database logs
to `docker compose logs db`.

---

## 11. Running the checks yourself

```bash
npm run typecheck         # TypeScript, no emit
npm run lint              # ESLint
npm test                  # 147 domain + UI tests (jsdom), ~20 s
npm run build             # production build

# Integration tests need a real PostgreSQL and a scratch database. They truncate it.
createdb -h 127.0.0.1 -U richie richie_tms_test      # once
TEST_DATABASE_URL="postgresql://richie:<password>@127.0.0.1:5432/richie_tms_test" \
  npm run test:integration
```

Without `TEST_DATABASE_URL` the integration tests are **skipped, not passed** — `npm test` prints
`5 skipped` and says so.

`npm run check` runs typecheck, lint, coverage and build in sequence, and is what CI runs.

---

## 12. Known limits, stated plainly

These are deliberate cuts for this stage, recorded so nobody discovers them in production:

1. **One server process.** Writes are serialised with a PostgreSQL advisory lock, which is correct
   across processes, but the sign-in throttle is per-process memory. Running two instances behind a
   load balancer would need the counter moved into the database or the proxy.
2. **The whole workload is sent to the browser** after each command (redacted). Correct and simple
   for a single operator's ledger; it will need pagination before the record count reaches the tens
   of thousands.
3. **No self-service password reset, no 2FA, no email.** An administrator resets passwords from
   **Users**. Recovery of the last administrator needs database access.
4. **No TLS inside the application.** Terminate it at a reverse proxy (§5). HSTS must be set there
   too; a meta tag cannot do it.
5. **Audit retention is unset** (Q-18): the log is append-only and grows forever until a retention
   policy is agreed.
6. **Business rules still to be supplied by management** are visible as empty settings and blocking
   messages, not as defaults. `docs/OPEN_QUESTIONS.md` lists every one.
7. **Session lifetime is eight hours**, fixed in `src/server/session.ts`. Changing it is a
   one-line change, but it is a policy decision, so it is not configurable yet.

---

## 13. What was verified, and what was not

Verified by running, in the development environment (Node 22.22.3, PostgreSQL 18.4, npm 10.9.8):

- `npm run db:migrate` against a real database: 2 migrations, 16 tables, `btree_gist` and
  `pgcrypto` present, exclusion constraint and both triggers created.
- A second booking of the same vehicle on overlapping dates is rejected **by PostgreSQL**
  (`SQLSTATE 23P01`), and back-to-back bookings are accepted. Proven through the repository itself
  in `src/server/repository.integration.test.ts`.
- Audit rows cannot be updated or deleted (trigger raises); an odometer reading cannot go backwards.
- First-run setup over HTTP, sign-in (wrong password → 401, correct → session cookie), sign-out,
  and a signed-out request returning `{ok:true, setupRequired:false, user:null, database:null}`.
- Credentials are absent from every API response: `passwordHash` and `passwordSalt` come back as
  empty strings, and the stored hash in `app_user` is `$argon2id$v=19$m=19456,t=2,p=1$…`.
- Permission and authorisation at the boundary: an operations user calling `update_settings` gets
  **403**; a request with no session gets **401**; a second `/api/setup` gets **409**; the
  browser-only `import_backup` command is rejected.
- `npm run db:seed` (8 records), `npm run db:reset`, `npm run db:backup` and `npm run db:restore`
  round-tripped a real database (1 user, 2 vehicles, 8 audit rows restored intact).
- `npm run typecheck`, `npm run lint`, `npm test` (147 passed, 5 skipped) and `npm run build`
  all clean; `next start` served the production build and `/api/health` returned 200.

Not verified here:

- **Fedora itself.** No Fedora host and no `dnf`; §2 is written from the documented behaviour of
  those packages.
- **The container start.** No Docker or Podman runtime was available, so `docker-compose.yml` was
  reviewed but not executed. The PostgreSQL version it pins (18-alpine) is the one the schema was
  tested against.
- **HTTPS and the reverse-proxy snippet**, and the systemd unit — both are standard configurations
  but were not executed in this environment.
- **Email, backups to remote storage, and multi-instance operation**, none of which are
  implemented (see §12).
