# Richie Transport Services — Transport Management System

Staff busing, bus rentals and staff logistics in one operational application.

> **This build has a server.** Next.js (App Router) serves the application, PostgreSQL stores the
> records, and every rule that matters is enforced on the server: sign-in, role permissions,
> audit logging, and the constraint that stops a vehicle being booked twice. The browser receives
> a redacted copy of the data your role may see and never holds a credential.
>
> It is still an evaluation-stage system: there is no 2FA, no email, no HTTPS inside the app, and
> no self-service password reset. `docs/SETUP_AND_DEPLOYMENT.md` §12 lists every limit before you
> put real people's data in it.

## Run it

Requirements: **Node 20.19+** and **PostgreSQL 15+**. No other tooling.

```bash
git clone https://github.com/iwani1/Richie-RTS-.git richie-tms
cd richie-tms
git checkout arena/368c3fd2-richie-rts

cp .env.example .env     # then set DATABASE_URL and SESSION_SECRET
npm ci
npm run db:migrate       # creates the schema
npm run build && npm start
```

`DATABASE_URL` holds a password, and it is the **one the database was created with**. If you start
the container below with `POSTGRES_PASSWORD='your-password'`, leave `.env` as it is; if you chose
your own, change the password in `DATABASE_URL` to match it. The two are independent — writing a
password in `.env` does not set it on the database, and the server says so on screen when they
disagree.

There is no seed step. The database starts empty on purpose: the first screen asks for the
administrator account, and Settings asks for the company's own rules.

Open <http://localhost:3000>. The first page asks you to create the administrator account. Then open
**Settings** and supply the business rules — nothing is pre-filled, and dependent features stay
blocked until you do.

If you have no PostgreSQL yet, one container is enough:

```bash
podman run -d --name richie-db \
  -e POSTGRES_USER=richie -e POSTGRES_PASSWORD='your-password' -e POSTGRES_DB=richie_tms \
  -p 127.0.0.1:5432:5432 -v richie_pgdata:/var/lib/postgresql \
  docker.io/library/postgres:18-alpine
```

Already cloned? Move the checkout to this build and restart:

```bash
cd richie-tms
git fetch origin && git checkout arena/368c3fd2-richie-rts && git pull --ff-only
npm ci && npm run build && npm start     # migrations are idempotent: npm run db:migrate again if the branch added one
```

Exact commands for every step, including backups and deployment notes:
**`docs/SETUP_AND_DEPLOYMENT.md`**.

Other commands:

```bash
npm run dev              # development server with hot reload
npm run check            # typecheck, lint, tests with coverage thresholds, production build
npm test                 # unit and component tests
npm run test:integration # against a real database (TEST_DATABASE_URL)
npm run db:backup -- ./backups/today.json    # full export, contains password hashes
npm run user:password -- --email you@example.com   # set a password from the terminal; prints a generated one if --password is omitted
```

## What is here

| Area | State |
|---|---|
| Authentication (Argon2id), sealed sessions, roles, permissions, audit log | Works, enforced **on the server** |
| Settings registry (no invented defaults) | Works; unset settings block their dependent actions |
| Vehicles, drivers, clients, compliance documents | Works |
| Bus rentals: request → quotation (versions) → deposit → assignment → trip → final invoice | Works; double booking refused **by the database** |
| Staff busing: routes, rosters, trip generation, dispatch, progressive stop/boarding capture, on-time report | Works |
| Staff logistics: incidents, work orders, cost report | Works |
| Fleet readiness: service intervals, odometer, readiness | Works |
| Driver and client portals (own-record scope) | Works |
| Invoices and manual payments: numbered, voided, part-paid, settled | Works; numbers are per year and per kind |
| Public enquiry form, embeddable on the company website | Works; throttled, spam-trapped, creates a draft only |
| CSV import for vehicles, drivers and clients | Works; rejects a row with its line number, never merges |
| Contracts, bookings, notifications, driver app, GPS | **Not built** — see `docs/PROGRESS.md` |

328 unit and UI tests plus 14 integration tests against a real PostgreSQL; coverage thresholds are
enforced by `npm run check`, and all three CI jobs (typecheck/lint/test/build, integration, HTTP
end-to-end) run on every push. `npm test` reports the integration tests as *skipped* unless `TEST_DATABASE_URL`
is set — they never silently pass.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind 4 · PostgreSQL 18 ·
Kysely + `pg` (typed SQL, no ORM engine binary) · Zod at the HTTP boundary, role scope applied to
every response ·
`iron-session` for sealed cookies · `@node-rs/argon2` (Argon2id) for passwords ·
Vitest + Testing Library. The database runs in a container or on the host; there is no Compose
file, because one command per service was easier to read than a YAML file.

`docs/DECISIONS.md` records why each of these was chosen, including the ORM decision (D-50) and
the session/password decision (D-51).

## Read these first

| Document | Contents |
|---|---|
| `docs/STATUS.md` | one page: what is built, what is not, and what is left — start here if you want the short answer |
| `docs/SETUP_AND_DEPLOYMENT.md` | install, migrate, seed, build, run, limits |
| `richie-tms-standing-brief.md` | the standing brief: how this project is built (authoritative) |
| `docs/ARCHITECTURE.md` | modules, request flow, known limits |
| `docs/PROGRESS.md` | what is done, what is blocked, and the evidence for each claim |
| `docs/REAL_DATA_TRIAL.md` | the two-hour checklist to run before the first real working day |
| `docs/PERMISSIONS.md` | role × permission matrix and own-record scope |
| `docs/DATA_PROTECTION.md` | personal data held, and what is not yet safe |
| `docs/OPEN_QUESTIONS.md` | business rules the owner still needs to answer |
| `docs/DECISIONS.md` | every non-obvious choice, with the alternatives rejected |
| `audit/AUDIT-REPORT.md` | independent security and code-quality review that motivated the rebuild |

## Data protection

Ghana's Data Protection Act 2012 (Act 843) applies to the data this system is designed to hold.
Personal data now sits in PostgreSQL on a machine you control rather than in browser storage, but
retention periods, access review, a DPIA and encryption at rest are still open
(`docs/DATA_PROTECTION.md`, `docs/OPEN_QUESTIONS.md` Q-18). Nothing here is legal advice.

## Licence

No licence has been chosen yet — that is an owner decision, tracked as Q-49 in
`docs/OPEN_QUESTIONS.md`. Until then, treat the code as all rights reserved.
