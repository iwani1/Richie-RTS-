# Setup and deployment

Exact commands to install, migrate, build and run. Nothing else.

There is no seeding step: a new installation starts with no records, no users and no business
rules, and asks for them on screen.

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

### On Fedora, which is what this build was developed on

Two routes, both fine; the container is the one with fewer ways to go wrong.

**Container (recommended).** Install Podman and use the `podman run` command in §5. Nothing else is
needed beyond Node and npm:

```bash
sudo dnf install -y podman
```

**The packaged server.** `sudo dnf install -y postgresql-server postgresql-contrib`, then
`sudo postgresql-setup --initdb` once and `sudo systemctl enable --now postgresql`. Create the user and
database exactly as §5 says. One thing to know before you start: the packaged server normally
authenticates **local TCP** connections by `ident` (whoever owns the connection's user name), not by
password. If `npm run db:migrate` stops with `password authentication failed for user "richie"`, that is
why — change the `127.0.0.1/32` and `::1/128` lines in `/var/lib/pgsql/data/pg_hba.conf` to
`scram-sha-256`, run `sudo systemctl restart postgresql`, and try again. Also add `:Z` to a volume if you
ever mount a host folder into Podman here, because SELinux will otherwise refuse the mount.

Node: Fedora's own `nodejs` package is usually older than 20.19. Install Node 22 from
[nodejs.org](https://nodejs.org/en/download) (the tarball plus a symlink is enough) or from the
NodeSource repository, and check `node --version` before `npm ci`.

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

Two values are required and the rest are optional:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@host:5432/richie_tms` |
| `SESSION_SECRET` | 32+ characters: `openssl rand -base64 32` |
| `NODE_ENV` | leave it out — `npm run dev` and `npm start` set their own |
| `TRUST_PROXY` | `1` **only** when a reverse proxy is in front (see §11). Without it, `X-Forwarded-For` is ignored, because a client controls that header. |
| `PUBLIC_ORIGIN` | `https://tms.example.com` behind a proxy that rewrites the Host header, so the cross-site check compares against the address staff actually use |
| `HTTPS` | `1` when TLS is terminated in front, which is what enables `Strict-Transport-Security` |
| `DATABASE_POOL_MAX` | `1` on a single-connection database (the preview harness); default elsewhere |
| `RECEIPT_DIR` | Where scanned expense receipts are kept (D-100). Default `data/receipts` beside the application. Put it beside the database, and **copy it with the nightly backup** — see §9 |
| `VEHICLE_PHOTO_DIR` | Where vehicle photographs are kept (D-108). Default `data/vehicle-photos` beside the application. Its own folder, not the receipts': the retention stories differ. **Copy it with the nightly backup too** — see §9 |

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
| `password authentication failed for user "richie"` | the password in `DATABASE_URL` is not the one the database was created with. See below. |
| `relation "schema_migrations" does not exist` | migrations were never applied. Run `npm run db:migrate`. |
| `Incorrect email or password` and no other account exists | the administrator's password is forgotten. Set a new one from the terminal (below). |

A change to `.env` takes effect only after the server is restarted: a running process keeps the
values it started with.

#### The password is rejected

Two causes, and only two. Find out which one you have before changing anything:

```bash
grep '^DATABASE_URL' .env                                  # what the app is sending
podman inspect richie-db --format '{{json .Config.Env}}'   # what the container was created with
```

1. **The two do not match.** Either correct `.env`, or set the database to the password you want:

   ```bash
   podman exec -it richie-db psql -U richie -d postgres \
     -c "ALTER USER richie WITH PASSWORD 'the-same-password';"
   ```

   Editing `.env` never changes a password already stored in the container's volume.

2. **The password contains a character that is not safe in a URL** — `@ : / ? # %` and a few others
   must be percent-encoded, or the address is parsed at the wrong point and the wrong text becomes
   the password:

   | character | in `DATABASE_URL` |
   |---|---|
   | `@` | `%40` |
   | `:` | `%3A` |
   | `/` | `%2F` |
   | `?` | `%3F` |
   | `#` | `%23` |
   | `%` | `%25` |

   The simplest fix is a password made of letters and digits only.

#### A forgotten password

Passwords are salted and hashed with Argon2id, so no SQL statement can set one — and the only
in-app reset is performed by an administrator who can already sign in. For an installation whose
last administrator is locked out:

```bash
npm run user:password -- --email admin@example.com
```

That prints a generated password. To choose your own, add `--password 'at least ten characters'`
(it is then in your shell history). The command needs no restart and does not touch anything else;
it refuses an email that does not exist and lists the accounts that do. With an external PostgreSQL
it can run while the server is up.

To see who exists:

```bash
podman exec -it richie-db psql -U richie -d richie_tms \
  -c "select email, role, active from app_user order by email;"
```

## 6. Migrate

```bash
npm run db:migrate
```

Applies every file in `db/migrations/` in filename order, each in its own transaction, and records
it in `schema_migrations`. It creates the extensions, the tables, the exclusion constraint that
prevents double booking, the append-only and odometer triggers, and (from `003`) the invoice and
payment tables with their immutability triggers and the reference counter. Re-running is safe:
applied migrations are skipped.

Expected:

```
Applying migrations to postgresql://***@127.0.0.1:5432/richie_tms
  > 001_init.sql
  > 002_resource_reservations.sql
  > 003_invoices_and_payments.sql
Done. Applied 3 migration(s).
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

**Reaching the app from another machine over plain HTTP.** The session cookie is `Secure` in
production, so a browser will not store it over `http://` — sign-in appears to succeed and returns
you to the sign-in screen. Browsers exempt `localhost` only. Either put TLS in front (§11), or reach
the workstation on its own address with `NODE_ENV=development` on a network you trust, knowing the
cookie then travels unencrypted. There is no third option that is safe.

## 8. Importing existing records from CSV (MIG-01)

Vehicles, drivers, corporate clients and staff rosters can be imported instead of typed. Open the
register (Vehicles, Drivers or Clients), or the **Passengers** tab of Staff busing, press
**Import CSV**, load the file, press **Check file**, and read the preview: every row is listed as
*will import* or *rejected* with the line number and the reason. Only after that does **Import N
rows** save anything.

The header row names the columns. Headers are matched case-insensitively, may appear in any order,
and columns the importer does not use are reported, not silently ignored.

```
vehicles   registration,category,make,model,seats,notes
           GT 1234-26,Coaster,Toyota,Coaster,22,

drivers    name,phone,licence number,licence expiry,licence classes,qualifications,status
           Kofi Mensah,+233201234567,DL-001,2031-05-01,"C; D",PSV,active

clients    name,code,type,contact name,contact phone,contact email,billing address,tin,status
           Volta Foods Ltd,VFL-01,organisation,Efua Owusu,+233244000111,ops@example.test,Industrial Area Accra,C0012345678,active

passengers name,employee ref,phone,client,route,stop,status
           Ama Boateng,E-001,+233201234567,Volta Foods Ltd,Northstar morning,Estate gate,active
```

Rules that hold for every import:

- **Required columns** are named in the error if they are missing (`category` and `seats` for
  vehicles, `licence number` and `licence expiry` for drivers). `status` defaults to `active`. For
  clients only the name is required: a code, a type, a billing address and a tax number are optional,
  and a blank cell is stored as *not recorded* rather than guessed. A `type` cell that says anything
  other than `organisation` or `individual` is a row error naming the line, so a typo is fixed in the
  file rather than imported as a blank.
- **Category names must already exist** in Settings; an unknown name is a row error that lists the
  configured categories. A roster row works the same way: the client, route and stop are matched
  **by name** (the route may also be given by its reference), and a misspelt name is a row error
  that lists the names that do exist.
- **A roster row needs a client and a name.** Route and pickup stop are optional together, so a
  roster can be imported before the runs are planned; if a route is named, a stop on that route is
  required, because the run has to know where to expect the person.
- **A likely duplicate person is flagged, not refused.** If a row would create a rider whose name
  matches someone already on that client's roster under a *different* employee reference, the row
  still imports and is marked **Check** with both references named. Two people can share a name;
  the same person entered twice is what the flag is for.
- **Duplicates are rejected, never merged** — a registration or licence number that already exists,
  or that appears twice in the same file, fails on that row.
- **Rows are saved through the ordinary commands**, so validation, permissions and the audit entry
  are identical to typing the record by hand. Each created record gets its own audit entry, plus one
  summary entry (`import:vehicles`, `import:drivers`, `import:clients`, `import:passengers`).
- **No silent discards:** if any row is rejected, the message names it by line; if every row is
  rejected nothing is written at all.
- **Limits:** 200 kB and 500 rows per file. The tail beyond 500 rows is reported, not imported.

The roster import (EMP-02) uses the same code, the same preview and the same audit entries as the
other three; nothing about it is a separate tool. A row is added through `create_passenger`, so the
seat-capacity check, the duplicate-reference check and the "stop already recorded on a running trip"
rule apply exactly as they do to a passenger typed into the form.

## 9. Backups

```bash
npm run db:backup -- ./backups/2026-10-23.json     # full export, contains password hashes
npm run db:restore -- ./backups/2026-10-23.json    # replaces the current contents
```

The export is unencrypted and includes Argon2 hashes: store it encrypted and treat it as personal
data. A PostgreSQL-native alternative is `pg_dump --format=custom`.

### Two folders sit outside the database, and both are yours to back up (Q-51, D-100, D-108)

A scanned receipt and a vehicle photograph are **not** in that export. The database holds only the
index — which expense or vehicle, which file, its fingerprint, who filed it — while the bytes sit in
`RECEIPT_DIR` (`data/receipts` by default) and `VEHICLE_PHOTO_DIR` (`data/vehicle-photos` by default)
on the same machine. Restoring the database without the folders gives a register of receipts and
photographs whose files are missing; the screens say so plainly rather than pretending, but the paper
is still gone. So the backup is three things, every night:

```bash
npm run db:backup -- ./backups/$(date +%F).json                    # the figures and the two indexes
tar czf ./backups/$(date +%F)-receipts.tgz data/receipts           # the paper those figures came from
tar czf ./backups/$(date +%F)-vehicle-photos.tgz data/vehicle-photos   # the fleet, in pictures
```

They are two folders rather than one because the two kinds of file are kept for different reasons:
a receipt is financial evidence with a term of its own, a photograph of a bus is a fact about the
fleet. One folder holding both would, in practice, be tidied by whichever rule the last person
believed; the names keep them apart as well (`rcpt_…` and `vhcl_…`).

Schedule all three together, and test all three by restoring into a scratch copy once. The same
archives are what a machine replacement needs.

**How long the receipt folder is kept.** Three years from the date a scan was filed: that is the
owner's answer to the retention question, and it is what the filing panel says on screen. After that, a
scan may be deleted from the folder; its row stays in the database with its fingerprint, so the
register still shows that a receipt was filed and when. Deleting a scan before then is a decision for
the owner, not a housekeeping step.

**How long a photograph is kept.** Nothing deletes one yet, and that is deliberate: removing a
photograph from the register takes the index off and leaves the file where it is, so a picture of a bus
that has been sold is still there if the question is ever asked. How long an unindexed file stays is
open (Q-18) — until the owner answers it, emptying the folder is a decision, not housekeeping.

**Restoring.** Put both folders back before starting the application: the screens name a missing file
in words ("the register has a photograph whose file is not in the folder"), which is a diagnosis, not
a repair.

## 10. Checks

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # 1305 unit and component tests
npm run test:integration # against a real database; needs TEST_DATABASE_URL (14 tests, 4 files)
npm run build            # production build
```

`npm run check` runs typecheck, lint, tests with coverage thresholds and the build in one go.

## 10a. Putting the enquiry form on the company website (WEB-01)

The form lives at `/enquiry` on this server and is meant to be framed by the existing website.
`embed/enquiry-iframe.html` in this repository is a complete working page: open it in a browser to
see the result, or copy the marked block and script out of it into any page on the site. The whole
snippet, with nothing else needed:

```html
<section class="rt-enquiry">
  <iframe
    id="richie-enquiry"
    src="https://tms.example.com/enquiry?embed=1"
    title="Request a vehicle from Richie Transport Services"
    loading="lazy"
    referrerpolicy="no-referrer"
    scrolling="no"
    style="display:block;width:100%;height:980px;border:0"
  ></iframe>
  <p style="font-size:12.5px;color:#667085;margin:10px 0 0">
    Not loading?
    <a href="https://tms.example.com/enquiry" target="_blank" rel="noopener noreferrer">Open the form in a new tab</a>.
  </p>
</section>

<script>
  (function () {
    var frame = document.getElementById("richie-enquiry");
    if (!frame) return;
    window.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.type !== "richie-enquiry:height" || typeof data.height !== "number") return;
      if (event.origin !== "https://tms.example.com") return;   /* the TMS origin */
      if (data.height < 200 || data.height > 4000) return;
      frame.style.height = Math.ceil(data.height) + "px";
    });
  })();
</script>
```

Two values change when you paste this in: every `https://tms.example.com` (the `src` and the origin
check) becomes wherever this application is served.

The small script matters. A frame cannot be measured from outside, so the form posts its own height
(`richie-enquiry:height`, a number of pixels and nothing else — no field value crosses into the host
page) and the host sets the iframe height from it. Without the script the form still works, using the
`980px` in the style; on a phone that will clip the button, and the thank-you panel leaves a band of
white.

- `/enquiry` is the only path served with `frame-ancestors *` and without `X-Frame-Options`; every
  other path refuses to be framed (`next.config.ts`). `/enquiry?embed=1` drops the card's border and
  padding so it does not look like a second page inside a box.
- The page must be served over **https** if the host page is https, or the browser will block the
  frame as mixed content.
- Submissions arrive as draft rental requests, marked as coming from the public form, with
  `rentals:enquiry` in the audit log. Nothing is booked, quoted or charged by the form.
- Eight enquiries per ten minutes are accepted per address. If the server sits behind a reverse proxy,
  set `TRUST_PROXY=1` so the limit applies per visitor rather than to everyone at once — the same
  setting sign-in uses (audit F-02).
- The vehicle types offered come from Settings → vehicle categories. With none configured the form
  says enquiries are not open rather than accepting a request nobody can fulfil.

## 11. Deploying beyond one machine

- Run a single application process. Writes are serialised with a PostgreSQL advisory lock, but the
  sign-in throttle is per-process memory.
- Terminate TLS at a reverse proxy (nginx, Caddy). The application does not do TLS, and HSTS must be
  set by the proxy — a meta tag cannot do it.
- Set `NODE_ENV=production` and a fresh `SESSION_SECRET`. Changing it signs everybody out.
- Restrict `DATABASE_URL` to the application host; the database should not be reachable from the
  internet.
- Schedule `npm run db:backup` and test restoring from it.
- Set `HTTPS=1` so the application sends `Strict-Transport-Security` (it is not sent otherwise: a
  workstation that also answers on a LAN address would lock itself out of it). If the proxy already
  sets the header, leave `HTTPS` unset and let the proxy own it.
- Set `TRUST_PROXY=1` so the sign-in throttle can see the real address. Without it every request
  looks like it came from `local`, and the per-account bucket is the only thing limiting guesses —
  which still bounds an attack on one account, but not spraying across many.
- **Separate the schema owner from the application role** if more than one person administers the
  database. Migrations run as whoever `DATABASE_URL` names, so that role can drop tables and
  disable the append-only trigger on `audit_entry`. For a single workstation this costs more than
  it protects; for a shared server:

  ```sql
  create role richie_owner login password '…';
  create role richie_app   login password '…';
  grant usage on schema public to richie_app;
  grant select, insert, update, delete on all tables in schema public to richie_app;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to richie_app;
  ```

  Then run `npm run db:migrate` with the owner's URL and serve with the app's.

## 12. Known limits, stated plainly

- **The API is snapshot-shaped.** Every read and every write returns the rows the account may see,
  not a page of them. Role scope keeps that small for a driver or a client contact; an administrator
  receives the fleet's working set (about 400 kB at 1 500 trips) with the newest 500 audit entries
  and the true count in `auditTotal`. At several years of daily busing this becomes the slowest part
  of the application. Paging per screen is the next structural change, and `docs/PROGRESS.md` says
  so.

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

## 12a. Before the first real working day

`docs/REAL_DATA_TRIAL.md` is the checklist: a restorable backup, settings, CSV import, one real
rental to a paid invoice, the release control, the reports reconciled by hand, the public form, and a
restart. Run it against a copy of the database first (`pg_dump` + `pg_restore` into
`richie_tms_trial`), then once against the real one.

## 13. What was verified, and what was not

Verified by running:

- The full test suite (see `docs/PROGRESS.md` for the count in the current phase) and the
  integration suite against PostgreSQL 18.
- `npm run build` and `npm start`, with `/api/health` reporting the database and every migration.
- Sign-in, a write, the audit entry it produces, and the redaction of every `passwordHash`.
- Migration from an empty database, in order, twice.

Not verified here: installation on a specific operating system, a container runtime, a reverse proxy
with TLS, and a second application instance. The commands above are the ones used; the platform
steps around them depend on your machine.

## Hosting a read-only preview

The production headers refuse framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), which
breaks any hosted preview that shows the app inside someone else's frame. `PREVIEW_EMBED=1`
relaxes exactly those two directives and nothing else. It is read when the config is loaded, so it
must be set for the **build**, not only for `next start`:

```bash
PREVIEW_EMBED=1 npm run build
PREVIEW_EMBED=1 npm start
```

Never set it on an installation that holds real data: it permits the app to be framed by any site.
