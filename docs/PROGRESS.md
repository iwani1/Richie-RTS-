# Progress

Status values: Not Started / In Progress / Done (verified) / Done (authored) / Blocked. "Done (verified)" means automated tests covering the item passed in the most recent session (`npm test`), and the production build succeeded (`npm run build`).

## Phase 0 - Inspect and plan (approved)

| Item | Status | Notes |
|---|---|---|
| Inspect project | Done | Vite 7 + React 19 + Tailwind 4, single-file static build; no backend, no database, no CI. |
| Verify hosting target | Blocked | Section 3 hosting fields are not in the uploaded material (Q-01). |
| ARCHITECTURE.md | Done | `docs/ARCHITECTURE.md`. |
| ERD.md | Done | `docs/ERD.md`, with Mermaid diagram, constraints and exclusion constraints. |
| PERMISSIONS.md | Done | `docs/PERMISSIONS.md`. |
| STATE_MACHINES.md | Done | Vehicle, rental and trip machines in `docs/STATE_MACHINES.md`. Invoice, contract and incident machines Not Started. |
| KPIS.md | Done | RPT-01 implemented as a proposal; RPT-02 and RPT-03 Blocked on definitions and inputs. |
| DATA_PROTECTION.md | Done (draft) | Requires legal review. Retention periods unset (Q-18). |
| DECISIONS.md | Done | D-01 to D-15. |
| OPEN_QUESTIONS.md | Done | Q-01 to Q-32. |
| Migrations, `/health` | Done (verified) | `db/migrations/*`, `/api/health`; the database is a container started by hand (see `docs/SETUP_AND_DEPLOYMENT.md` §5). |
| CI workflow file | Done (authored, **not executed**) | `.github/workflows/ci.yml` runs the four gates. No git remote or runner exists here, so its execution has not been observed (Phase 7). |
| Lint | Done (verified) | `eslint.config.js`; `npm run lint` clean across the whole codebase (Phase 7). Closes the Phase 0 "confirm lint runs" deliverable. |

## Phase 1A - Foundation and master data (approved)

| Feature | Status | Evidence |
|---|---|---|
| First-run administrator setup | Done (verified) | `App.test.tsx` |
| Sign in and sign out, PBKDF2 hashing | Done (verified) | `App.test.tsx` |
| Role x permission matrix enforced in the service | Done (verified) | `service.test.ts` |
| Settings with no defaults, validation, blocking | Done (verified) | `service.test.ts`, `App.test.tsx` |
| Vehicles: CRUD, unique registration, category required, state machine | Done (verified) | `service.test.ts`, `App.test.tsx` |
| Drivers: CRUD, licence validation, expired flag | Done (verified) | `service.test.ts` |
| Corporate clients: CRUD | Done (verified) | `service.test.ts` |
| Users: create, edit, reset password, last-admin guard | Done (verified) | `service.test.ts` |
| Audit log screen | Done (verified) | `App.test.tsx` |
| Backup export and import (browser-local) | Done (verified) | Import guard in `service.test.ts`; download only checked manually |
| Server-side persistence | Done (verified) | Phase 13 |

## Phase 1B - Bus rentals (approved)

| Feature | Status | Evidence |
|---|---|---|
| Rental settings with no defaults | Done (verified) | `service.test.ts`, `Rentals.test.tsx` |
| Rental request CRUD (draft) | Done (verified) | `service.test.ts`, `Rentals.test.tsx` |
| Quotation with manual line items; computed deposit and validity; blocked until settings are set | Done (verified) | `service.test.ts`, `Rentals.test.tsx` |
| Deposit and confirm | Done (verified) | `service.test.ts`, `Rentals.test.tsx` |
| Resource assignment: category, availability, licence expiry, overlap guard | Done (verified) | `service.test.ts` |
| Start trip and complete with final invoice | Done (verified) | `service.test.ts`, `Rentals.test.tsx` |
| Decline and cancel with reason | Done (verified) | `service.test.ts` |
| Schema 1 to 2 migration | Done (verified) | `service.test.ts` |

## Phase 2 - Staff busing (this phase)

| Feature | Status | Evidence |
|---|---|---|
| Routes: ordered stops, scheduled times, operating days, dates, status | Done (verified) | `busing.test.ts` (validation) |
| Route lock once trips exist (stops, client, category) | Done (verified) | `busing.test.ts` |
| Passengers: CRUD, client, route and stop integrity, unique employee reference | Done (verified) | `busing.test.ts` |
| Trip generation: operating days only, no duplicates, 62-day cap | Done (verified) | `busing.test.ts` |
| Assignment: category, vehicle Available, driver licence, same-day overlap, rental clash | Done (verified) | `busing.test.ts` |
| Dispatch with re-checked resources | Done (verified) | `busing.test.ts`, `Busing.test.tsx` |
| Completion: stop times, one outcome per active passenger, threshold snapshot | Done (verified) | `busing.test.ts`, `Busing.test.tsx` |
| Cancel planned or dispatched trips with a reason | Done (verified) | `busing.test.ts` |
| RPT-01 on-time rate with coverage and status | Done (verified); definition pending confirmation | `busing.test.ts`, `Busing.test.tsx` |
| RPT-02 fleet utilisation, RPT-03 cost per trip | Blocked | Definitions and inputs (Q-29) |
| Boarding codes | Blocked | Policy unknown (Q-19). Not implemented |
| Passenger personal-data controls | Partial | Minimal fields and role limits; retention, notice and rights workflow not done (see DATA_PROTECTION.md) |
| Server-side persistence and multi-tab safety | Done (verified) | Phase 13: writes are serialised server-side |

## Phase 3 - Staff logistics (built this session, awaiting review)

| Feature | Status | Evidence |
|---|---|---|
| Incidents: report breakdown/accident/damage/safety concern, severity, vehicle, optional trip | Done (verified) | `logistics.test.ts` (validation and scope) |
| Vehicle withdrawal is an explicit operator choice and takes effect immediately | Done (verified) | `logistics.test.ts`, `Logistics.test.tsx` |
| Incident response machine: reported -> acknowledged -> responding -> resolved -> closed | Done (verified) | `logistics.test.ts`, `Logistics.test.tsx` |
| Report freezes once responding; corrections go in an append-only response log | Done (verified) | `logistics.test.ts` |
| Work orders: raise, edit, open -> in progress -> on hold/completed -> closed | Done (verified) | `logistics.test.ts`, `Logistics.test.tsx` |
| Cost position must be confirmed (recorded, or explicitly none) before completion | Done (verified) | `logistics.test.ts` |
| Incident -> work order link; incident cannot close while the repair is open | Done (verified) | `logistics.test.ts` |
| Vehicle returns to service only when no other work order is active | Done (verified) | `logistics.test.ts` |
| Cost entries on incidents and work orders, gated on company currency | Done (verified) | `logistics.test.ts` |
| Cost report: period, total, entries, data coverage, explicit "not a zero" wording | Done (verified) | `logistics.test.ts`, `Logistics.test.tsx` |
| RPT-02 fleet utilisation, RPT-03 cost per trip | Blocked | Definitions and inputs (Q-29). Shown as "Not configured" |
| Cause/fault taxonomy for incidents and maintenance | Blocked | Not supplied (Q-34). Free text used instead |
| Driver-reported incidents | Blocked | No own-record scope for the driver role (Q-33) |
| Service intervals and due-date/odometer reminders | Superseded by Phase 8 | Now configured per category with no defaults; see Phase 8 |

## Phase 4 - Own-record access and the driver/client portals (built this session, awaiting review)

| Feature | Status | Evidence |
|---|---|---|
| Accounts link to one driver record or one corporate client (`User.driverId`, `User.clientId`) | Done (verified) | `scope.test.ts`, schema 4 -> 5 migration |
| Link validation: required per role, unique per record, internal roles stay unlinked | Done (verified) | `scope.test.ts` |
| Own-record scope classification (`isOwnScoped`, `isRecordBound`) | Done (verified) | `scope.test.ts` |
| `scopedView` confines driver to its own runs, vehicles and incidents | Done (verified) | `scope.test.ts` |
| `scopedView` confines a client contact to its own client's routes, roster, rentals | Done (verified) | `scope.test.ts` |
| Unlinked record-bound account sees nothing (fails closed) | Done (verified) | `scope.test.ts` |
| Write scoping: a driver may report only on a vehicle assigned to it | Done (verified) | `scope.test.ts`, `Portals.test.tsx` |
| Write scoping: a driver cannot withdraw a vehicle from service | Done (verified) | `scope.test.ts`, `Portals.test.tsx` |
| Write scoping: a client contact's rental request is forced onto its own client | Done (verified) | `scope.test.ts`, `Portals.test.tsx` |
| Driver portal: licence, own runs, report a problem | Done (verified) | `Portals.test.tsx` |
| Client portal: own routes with stops/times, roster (name + stop only), rental requests | Done (verified) | `Portals.test.tsx` |
| Users screen links accounts to driver/client records | Done (verified) | Covered by the link-validation tests |
| Record-bound roles are walled off from every internal screen | Done (verified) | `Portals.test.tsx` |
| Multiple contact accounts per client | Blocked | Not supported; one per client (Q-38) |
| Boarding codes and roster self-service for riders | Blocked | Policy not supplied (Q-19) |
| Driver trip updates (start/stop, boarding) | Not started | Portal is read + incident reporting only in this slice |

## Phase 5 - Driver trip execution (built this session, awaiting review)

| Feature | Status | Evidence |
|---|---|---|
| Driver can complete the run assigned to it: actual time at every stop | Done (verified) | `scope.test.ts`, `Portals.test.tsx` |
| Driver records boarded / did not board for every person on the run | Done (verified) | `scope.test.ts`, `Portals.test.tsx` |
| Own-record enforcement: a driver cannot complete another driver's run | Done (verified) | `scope.test.ts` |
| Ownership is checked before status, so probing reveals nothing about other runs | Done (verified) | `scope.test.ts` |
| Incomplete completion is refused: every stop needs a time, every person an outcome | Done (verified) | `scope.test.ts` |
| Drivers still cannot dispatch or cancel runs | Done (verified) | `scope.test.ts` |
| Driver roster minimised to name and pickup stop | Done (verified) | `Portals.test.tsx` |
| Driver-entered actuals feed the on-time record and boarding history | Done (verified) | `scope.test.ts` (recorded fields), `busing.test.ts` (KPI maths) |
| Driver records stop times mid-run (progressive logging) | Not started | Only at completion in this slice |
| Boarding codes | Blocked | Policy not supplied (Q-19); manual outcomes recorded instead |
| Rider-facing roster view | Not started | `passenger` is not a user role; needs modelling first |

## Phase 6 - Compliance documents (built this session, awaiting review)

Closes Q-16. Previously only already-expired driver licences were flagged; there were no
document types, no vehicle documents at all, and no advance-expiry warning.

| Feature | Status | Evidence |
|---|---|---|
| Admin-defined document types (name + applies to vehicle/driver/both) | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| Reminder lead time as a setting with **no default** (Q-16) | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| Document records against a vehicle or a driver (number, issued, expiry, notes) | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| `documentStatus`: expired / expiring soon / valid / unknown | Done (verified) | `compliance.test.ts` |
| "Expiring soon" is **never** reported before a lead time is set | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| Recording blocked until at least one document type exists | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| Owner and document type locked after creation; dates/notes/number editable | Done (verified) | `compliance.test.ts`, `Compliance.test.tsx` |
| Owner must exist and match the type's applies-to value | Done (verified) | `compliance.test.ts` |
| A document type with recorded documents cannot be removed | Done (verified) | `compliance.test.ts` |
| Permissions: operations/administrator write, finance read, driver own-read only | Done (verified) | `compliance.test.ts`, `service.test.ts` |
| Driver portal shows its own compliance documents, read-only | Done (verified) | `Portals.test.tsx`, `scope.ts` |
| Schema 5 -> 6 migration fills documents/documentTypes/lead time safely | Done (verified) | `compliance.test.ts` |
| Actual reminder notification (email/SMS) | Blocked | No notification provider configured |
| Attach a document file/image to a record | Not started | Metadata only in this slice |
| Blocking vehicle activation on a missing document | Not started | Needs a rule on which types are mandatory (Q-16 follow-up) |

Totals in this session: **89 tests passing** across 11 test files (unit tests for the core
service, busing, logistics, compliance and access scope, plus end-to-end UI flows for setup,
rentals, busing, logistics, compliance, the driver portal and the client portal). Typecheck
and production build clean.

## Phase 7 - Quality foundation: lint and CI (approved)

Closes the unmet Phase 0 deliverable "confirm that typecheck, lint, test and build all run".
No business facts were needed, so nothing is blocked on an open question.

| Feature | Status | Evidence |
|---|---|---|
| ESLint flat config (`eslint.config.js`): `@eslint/js` + `typescript-eslint` recommended, `react-hooks` | Done (verified) | `npm run lint` exits 0 |
| Correctness rules as errors: no-explicit-any, unused vars, eqeqeq, prefer-const, no-console, no-debugger | Done (verified) | `npm run lint` |
| Architectural rule enforced mechanically: UI may not import `execute*`/`executeCommand`, only `dispatch()` | Done (verified) | `no-restricted-imports` in `eslint.config.js` |
| Six baseline findings across six phases of code fixed (see D-28) | Done (verified) | All 89 tests still pass after the fixes |
| Route gating moved from effect-after-render to derived-during-render (no one-frame leak of an out-of-scope screen) | Done (verified) | `Portals.test.tsx` asserts forbidden nav is absent; D-29 |
| Actor ref synced in an effect, not during render (concurrent-render safety for `dispatch`) | Done (verified) | Every dispatch in the suite; D-29 |
| Persistence moved into `commit()` (synchronous, single write site) | Done (verified) | `App.test.tsx` asserts localStorage after writes; D-29 |
| `npm run lint` and `npm run check` (typecheck + lint + test + build) scripts | Done (verified) | `package.json` |
| CI workflow file running the same gates | Done (authored, **not executed**) | `.github/workflows/ci.yml`; no runner available here |
| Lint-on-commit hook | Not started | No git repository in this environment |

Totals in this session: **89 tests passing** across 11 test files; `npm run typecheck`,
`npm run lint`, `npm run build` and `npm audit --omit=dev` all clean.

## Phase 8 - Service intervals and fleet readiness (approved)

| Feature | Status | Evidence |
|---|---|---|
| Service schedules per vehicle category with no defaults (km, days, reminder leads) | Done (verified) | `maintenance.test.ts`, `FleetReadiness.test.tsx` |
| Schedule validation: at least one basis, known unique category, whole non-negative numbers | Done (verified) | `maintenance.test.ts` |
| Odometer readings: invalid values and retired vehicles refused; reading may not go backwards | Done (verified) | `maintenance.test.ts` |
| Void a reading with a reason; excluded from calculations, kept in the audit trail | Done (verified) | `maintenance.test.ts` |
| Work order marked as a service by an operator; odometer required for a km-tracked category | Done (verified) | `maintenance.test.ts` |
| Completion timestamp anchors the service; only completed work counts | Done (verified) | `maintenance.test.ts` |
| Readiness: not configured, insufficient data, due soon, overdue, coverage and specific reasons | Done (verified) | `maintenance.test.ts`, `FleetReadiness.test.tsx` |
| Day and km bases evaluated together, taking the most urgent | Done (verified) | `maintenance.test.ts` |
| Retired vehicles excluded from coverage; all-retired fleet reports no_vehicles | Done (verified) | `maintenance.test.ts` |
| Settings card, readiness screen, odometer log and dashboard notice | Done (verified) | `FleetReadiness.test.tsx` |
| Schema 6 to 7 migration never invents a legacy service | Done (verified) | `maintenance.test.ts` |
| Scheduled email/SMS reminders | Blocked | No worker or provider; on-screen only |
| Blocking dispatch on an overdue service | Blocked | Policy unanswered (Q-43) |
| Automatic odometer feeds (telematics) | Blocked | No provider configured (Q-45) |

Totals in this session: **104 tests passing** across 13 test files; `npm run typecheck`,
`npm run lint`, `npm run build` and `npm audit --omit=dev` (0 vulnerabilities) all pass.

## Phase 9 - Expired rental quotation renewal (approved)

| Feature | Status | Evidence |
|---|---|---|
| Admin-configured expired quotation policy, no default (`revise_in_place` / `new_request`) | Done (verified) | `service.test.ts`, `Requote.test.tsx` |
| Renewal blocked before expiry, when policy unset, and when policy requires a new request | Done (verified) | `service.test.ts` |
| In-place renewal revises line items, applies currently configured deposit/validity, preserves old immutable quote snapshots | Done (verified) | `service.test.ts`, `Requote.test.tsx` |
| Quote history visible in rental detail; current quote version can be confirmed | Done (verified) | `Requote.test.tsx` |
| Schema 7 to 8 migration preserves current quote and defaults missing history/policy empty | Done (verified) | `service.test.ts` |
| Management confirmation of which financial settings a renewed quote should use | Open | Q-46; currently configured values apply |

Totals in this session: **109 tests passing** across 14 test files; `npm run check` and
`npm audit --omit=dev` (0 vulnerabilities) pass.

## Phase 10 - Progressive driver run execution (approved)

| Feature | Status | Evidence |
|---|---|---|
| Dispatch -> in progress through assigned driver/operations start action | Done (verified) | `busing.test.ts`, `Portals.test.tsx` |
| Stop arrivals recorded one at a time, in route order, with monotonic actual times | Done (verified) | `busing.test.ts`, `Portals.test.tsx` |
| Every active passenger assigned to a stop receives boarded / did-not-board at that stop | Done (verified) | `busing.test.ts`, `Portals.test.tsx` |
| Driver can start/record/complete only its own assigned trip; ownership checked before state | Done (verified) | `busing.test.ts`, `scope.test.ts` |
| Completed progressive records feed the existing on-time report | Done (verified) | `busing.test.ts` |
| Full-form operations completion retained for dispatched, unstarted trips | Done (verified) | `busing.test.ts` regression tests |
| Progressive data cannot be overwritten by the bulk completion form; completed trip is immutable | Done (verified) | `busing.test.ts` |
| Passenger roster is frozen for a route while any trip on it is in progress | Done (verified) | `busing.test.ts` |
| Schema 9 -> 10 migration backfills `startedAt: null` | Done (verified) | `busing.test.ts` migration test |
| Correct a stop after recording or after run completion | Blocked | No correction policy supplied; stop logs are append-only (Q-42) |
| Cancel an in-progress run | Blocked | No mid-run abort/incident relationship policy supplied (Q-47) |
| Boarding codes | Blocked | Q-19; manual outcome only |

Totals in this session: **112 tests passing** across 14 test files (three new progressive-flow
unit tests; the existing driver E2E now exercises the full progressive path). Final check and
production audit pass.

## Phase 11 - Mid-trip passenger changes (approved)

| Feature | Status | Evidence |
|---|---|---|
| Add a passenger to a future stop while a trip is in progress (operations/admin only) | Done (verified) | `busing.test.ts`, `Busing.test.tsx` |
| Move a passenger between two future stops; deactivate a passenger with no boarding yet | Done (verified) | `busing.test.ts` |
| Refuse assignments to already-recorded stops, with the affected trip reference | Done (verified) | `busing.test.ts`, `Busing.test.tsx` (recorded stops disabled in the form) |
| Lock route/stop/status/client once boarded; personal-detail corrections still allowed | Done (verified) | `busing.test.ts` |
| Mid-trip changes noted in the audit summary with trip references, no personal data | Done (verified) | `busing.test.ts`, `Busing.test.tsx` |
| Driver next-stop form picks up roster changes live; no driver UI change needed | Done (verified) | `Busing.test.tsx` completion with mid-trip rider |
| No schema change; no migration | Done (verified) | Full `npm run check` green, no `migrate()` edit |
| Notify the driver when operations changes the roster mid-run | Blocked | No notification channel; driver sees it on the next stop form (Q-48) |

Totals in this session: **118 tests passing** across 14 test files (5 new unit tests, 1 new
operations E2E). `npm run check` and `npm audit --omit=dev` (0 vulnerabilities) pass.

## Phase 12 - Repository rebuild and security remediation (this session)

The application previously shipped only inside two ZIP archives, so GitHub reported zero
workflows, nothing was scanned, and the code could not be reviewed as a diff. This session
unpacked demo 2 at the repository root and closed the defects an independent audit
(`audit/AUDIT-REPORT.md`) could fix without a server.

| Item | Status | Evidence |
|---|---|---|
| Demo 2 source materialised at the root; archives removed from the tree (recoverable at `030197e`) | Done (verified) | `git log`, 69 files imported |
| Credential policy enforced in the service layer (was UI-only; empty credential accepted) | Done (verified) | `hardening.test.ts` (4 tests), H-01 |
| Backup import validates every trusted record; `can()` fails closed on unknown role | Done (verified) | `hardening.test.ts` (5 tests), H-02 |
| Audit log capped at 5,000 entries; backup export permissioned and audited | Done (verified) | `hardening.test.ts` (3 tests), H-03/M-03 |
| CSP on the single-file build; `referrerpolicy` on the font link | Done (verified) | `dist/index.html` contains the policy, L-03 |
| CI at the root: coverage ratchet, full-tree audit, CodeQL, dependency review, Dependabot | Done (authored) | `.github/workflows/*`; **execution not yet observed** on a runner |
| Toolchain upgraded: vite 7.3.7, singlefile 2.3.4, vitest 5.0.5 | Done (verified) | `npm audit` 2 critical + 4 high → 0; suite green |
| Authoritative standing brief installed as `AGENTS.md`; condensed variant archived | Done | D-42, `docs/archive/AGENTS-condensed.md` |
| README, SECURITY.md, .gitignore, .nvmrc | Done | repository root |
| Licence, repository visibility | Blocked | Owner decision, Q-49 |
| Built artifact executes and mounts | Done (verified) | `dist/index.html` served over HTTP (200, 573,566 B); the inlined bundle evaluated in jsdom mounts the auth screen |
| Browser visual verification of the rebuilt bundle | Not verified | jsdom parses no modern CSS and cannot run module scripts; no browser is available here |

Gates run in this session, in the brief's order:

- `npm ci` — 293 packages, lockfile honoured.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test:coverage` — **130 tests in 15 files pass**; 72.16 % statements, 64.90 %
  branches, 68.33 % functions, 76.77 % lines (Vitest 5 all-files basis; thresholds 70/62/66/74).
- `npm run build` — single file, 573.57 kB (154.78 kB gzip).
- `npm audit` — 1 low, 0 critical/high (was 2 critical, 4 high, 1 moderate, 1 low).

Not verified, and not claimed: that the CI workflow passes on GitHub's runner (it has never
run there), and anything about a real browser or a real server.

## Phase 13 - The intended stack: server, database, real enforcement (this session)

The rebuild the brief and the audit both required. The browser no longer holds a database: it holds
a redacted snapshot and a session cookie. Every write is a command sent to the server, authorised
there, validated there, applied in a transaction there, and checked again by PostgreSQL.

| Item | Status | Evidence |
|---|---|---|
| Next.js App Router replaces the Vite single-page build | Done (verified) | `npm run build`, `next start`, `/` returns 200 |
| PostgreSQL 18 schema: 16 tables, `btree_gist`, `pgcrypto`, typed columns + JSONB value objects (D-50) | Done (verified) | `npm run db:migrate`, `\dt` equivalent over `information_schema` |
| Double booking prevented by the database: exclusion constraint on `(resource_type, resource_id, period)` | Done (verified) | `repository.integration.test.ts` — overlapping booking rejected with `23P01`, back-to-back accepted |
| Audit log is append-only by trigger, not by convention | Done (verified) | `repository.integration.test.ts` — UPDATE and DELETE both refused |
| Odometer cannot go backwards | Done (verified) | `repository.integration.test.ts` — lower reading refused |
| Password hashing: Argon2id (`@node-rs/argon2`, m=19456, t=2, p=1) replacing in-page PBKDF2 (D-51) | Done (verified) | `password.test.ts`; stored hash inspected in `app_user` |
| Sessions: `iron-session` sealed cookie, 8-hour lifetime, `httpOnly`/`sameSite=lax`/`secure` in production (D-51) | Done (verified) | sign-in over HTTP set the cookie; signed-out `/api/session` returns no data |
| First-run administrator creation, then refused forever | Done (verified) | `/api/setup` 201 then 409; service layer refuses too |
| Sign-in throttle (8 failures / 15 min per address+account) | Done (verified) | `rateLimit.test.ts`; known single-process limit documented |
| Authorisation enforced at the boundary *and* in the domain layer | Done (verified) | operations user → `update_settings` 403; no session → 401 |
| Every response redacted: no `passwordHash`, no `passwordSalt` | Done (verified) | `snapshot.test.ts`; live `/api/session` inspected |
| Browser cannot send a credential, cannot restore a backup, cannot run setup | Done (verified) | `clientCommand.ts` types; `/api/commands` rejects unknown types; server hashes supplied passwords |
| Zod validation at every route boundary; database errors mapped to operator language | Done | `src/app/api/**`, `describeDatabaseError` |
| Concurrency: serialised writes via `pg_advisory_xact_lock` in one transaction | Done (verified) | 10 parallel `create_client` requests → 10 `ok:true`, 10 rows stored (no lost update) |
| Scripts: `db:migrate`, `db:reset`, `db:backup`, `db:restore` | Done (verified) | all four executed against a real database; backup/restore round-tripped 1 user, 2 vehicles, 8 audit rows |
| Setup guide (install, migrate, build, run), `.env.example` | Done | `docs/SETUP_AND_DEPLOYMENT.md` |
| UI tests drive the app through a request/response boundary instead of `localStorage` | Done (verified) | `src/test/fakeServer.ts`, 130 UI/domain tests still green |
| Integration suite against a real PostgreSQL, skipped without `TEST_DATABASE_URL` | Done (verified) | 5 tests pass against PostgreSQL 18.4 |
| CI updated for the new gates | Done (authored, not executed) | `.github/workflows/ci.yml`: quality-gates job + an integration job against a `postgres:18-alpine` service. Never run on a GitHub runner from here. |
| HTTPS / reverse proxy, TLS, multi-instance operation | Described, **not verified** | `docs/SETUP_AND_DEPLOYMENT.md` §11 |
| Row-level pagination of reads | Not started | The whole redacted workload is returned per request; documented as limit §13.2 |
| Request-level scoping in SQL (own-record rows filtered in the database) | Not started | Scope is applied in the domain layer today; the snapshot is redacted but not per-row filtered for portal users beyond `scopedView` |

Gates run at the end of this phase:

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — **147 passed, 5 skipped** (the integration suite, which needs a database).
- `TEST_DATABASE_URL=… npm run test:integration` — **5 passed** against PostgreSQL 18.4.
- `npm run test:coverage` — 72.4 % statements, 65.0 % branches, 68.3 % functions, 76.9 % lines
  (thresholds 70/62/66/74), after excluding the database/request-context modules covered by the
  integration suite (see `vitest.config.ts` for the list and the reason).
- `npm run build` — production build, 8 routes; `next start` served it and `/api/health` returned
  `200` with the live PostgreSQL version.

## Not started (later phases)

- Contracts. **Blocked:** contract activation requires billing frequency and payment terms
  (Q-CON-01). Rental invoices and manual payments are built (Phase 16); corporate invoice
  generation from billable trips waits for contracts and bookings.
- Boarding codes (Q-19) and rider self-service.
- Document-expiry **notifications**: expiry status is now computed (Phase 6) but no reminder is
  sent, because no notification provider is configured. Notifications generally remain blocked.
- Data retention jobs and the Act 843 subject-request workflow.

## Phase 14 - Interface redesign and empty start (unreleased)

> **Superseded.** The "bright editorial" direction described below was replaced by the Direction E
> "Daylight" interface that ships today (`docs/DESIGN.md`). The rows are kept as history; do not read
> them as a description of the current screens.

| Item | Status | Notes |
|---|---|---|
| Fourth design direction, "bright editorial" | Done (verified) | Three earlier templates were rejected by the owner; the replacement is described in `docs/DESIGN.md` §3-§8 and built in `src/index.css`. |
| Navigation as a numbered contents strip | Done (verified) | 14 destinations in five groups, drawer under 980px; `aria-current` on the active one. |
| Dashboard rebuilt as a front page | Done (verified) | Lead story from the first real exception, numbered brief, then departures / fleet / setup spread. `Dashboard.test.tsx` unchanged and green. |
| Section colour per route | Done (verified) | `data-route` sets `--rubric`; ochre is block-only because it measures 2.19:1 on paper. |
| Demo seeding removed | Done (verified) | `scripts/seed.ts`, `db:seed`, `ALLOW_DEMO_SEED`, `DEMO_ADMIN_*` and setup-guide §8 are gone; a fresh database reports `setupRequired` and asks for real rules. |
| Screens restructured one by one | Partial | The stylesheet, masthead, contents strip, rubric, dashboard and sign-in are new; the register, rentals, busing, logistics, compliance and portal bodies keep their existing markup restyled by the new system. |

Gates run at the end of this phase:

- `npm run typecheck` - clean.
- `npm run lint` - clean.
- `npm test` - **169 passed, 5 skipped** (one test fewer: the `ALLOW_DEMO_SEED` case went with the flag).
- `npm run build` - production build compiles.

## Phase 15 - Spec conformance fixes (24 October 2026)

Cross-checking the brief against the running build (`audit/SPEC-CONFORMANCE-2026-10-24.md`) found
four defects in behaviour, not in documentation. These are the fixes, with the evidence that ran.

| Item | Status | Evidence |
|---|---|---|
| Service-date guard on `start_rental` | Done (verified) | Live: `RR-0004 is booked from 2026-11-02. It cannot be started before that date.` Tests: `service.test.ts` "refuses to start a hire before its booked date or after its return date" |
| Service-date guard on `start_trip` | Done (verified) | Live: `TR-0013 is scheduled for 2026-10-27. It cannot be started before that day.` Tests: `busing.test.ts` "refuses to start a run before its service day, or long after it" |
| Seat capacity at assignment and dispatch | Done (verified) | Live: `This vehicle seats 22; RT-001 has 25 active passengers.` Tests: rental guard in `service.test.ts`, roster guard and the dispatch re-check in `busing.test.ts` |
| Finance read scope (no roster, documents, accounts or audit) | Done (verified) | Live finance session: `users:0 passengers:0 documents:0 audit:0`, rentals and trips intact. Tests: `visibility.test.ts`, permission matrix test in `service.test.ts` |
| Client contact no longer receives staff phone numbers | Done (verified) | Tests: `visibility.test.ts` "withholds staff phone numbers from a client contact but keeps the manifest" |
| Read permissions enforced on the payload, not only on screens | Done (verified) | `src/server/visibility.ts`; D-60 |
| **MIG-01** CSV import for vehicles, drivers and clients | Done (verified) | Live: `Imported 2 of 4 vehicles. 2 rejected: line 4 (Category "Spaceship" is not configured...); line 5 (A vehicle with this registration already exists.)`, with `import:vehicles` in the audit log and `Not permitted` for finance. Tests: `src/tms/import.test.ts` (12) and `src/Import.test.tsx` (2). Template documented in `SETUP_AND_DEPLOYMENT.md` §8 |

Gates after these changes: `typecheck` clean, `lint` clean, `test` **226 passed, 5 skipped**,
`build` succeeds, and the rebuilt server was re-checked live against the same database.

Still outstanding from the conformance report (Phase 1A, in the brief's order): RPT-01 rental
reports, WEB-01 public enquiry, EMP-02 passenger import, a Playwright flow for workflow C, and a
parallel-request double-booking test. Phase 1B onwards is unchanged and still not met.

## Phase 16 - Invoices and manual payments (FIN-02, FIN-03)

An invoice is now a record of its own, not a field on the rental: numbered, immutable after issue, and
unable to be raised twice for the same service. A payment is written once, can only move forwards
through verification, and is the only thing that changes an invoice's amount paid.

| Item | Status | Evidence |
|---|---|---|
| `invoice` and `payment` tables, reference counter, immutability triggers | Done (verified) | `db/migrations/003_invoices_and_payments.sql`; applied against PostgreSQL in the live harness |
| Issue a rental invoice from the completion record, with tax lines snapshot and optional discount | Done (verified) | `src/tms/finance.ts`; tests: `finance.test.ts` "issues a numbered invoice from the completed rental, with configured tax lines", "applies a discount as its own line and keeps the arithmetic exact". Live: `INV-2026-0001 issued: GHS 4700.00 due 2026-06-15.` |
| One live invoice per billable event; void keeps the number | Done (verified) | Partial unique index `invoice_billable_event_uq`; tests "refuses a second live invoice for the same service and allows one after a void" |
| Settings that gate issuing (tax position, tax lines, payment terms, currency) | Done (verified) | `validateSettings` + `issue_rental_invoice`; tests "blocks issue until the settings that have no default are set" |
| Record a manual payment; amount paid and status derived; overpayment refused with the balance | Done (verified) | `finance.test.ts` "records a part payment, then settles the invoice…", "refuses an overpayment and names the outstanding balance" |
| External reference as the idempotency key (brief 5.8) | Done (verified) | Partial unique index + replay test "treats the external reference as an idempotency key" (one payment, same message) |
| Verification and reconciliation only move forwards | Done (verified) | Service rank check + `payment_frozen_trg`; test "advances verification forwards only" |
| Void refused once money is recorded | Done (verified) | Service check + `invoice_frozen_trg`; test "refuses to void an invoice that has money against it" |
| Invoices screen (list, totals, detail, issue, payment, void) | Done (verified) | `src/screens/Invoices.tsx`, nav entry "Invoices"; `src/screens/Invoices.test.tsx` (4) |
| Finance-only: operations cannot bill or record money | Done (verified) | Tests "is finance-only…", "is closed to operations…" |
| **Not built** | — | Credit notes / adjustment records, so a paid invoice is corrected by issuing a new invoice; PDF rendering; corporate invoice generation (needs contracts) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **245 passed, 5 skipped**,
`build` succeeds (8 routes).

Also in this phase: a run already on the road can no longer take a roster addition that would put
more passengers in the vehicle than it seats (`busing.test.ts`, D-61 follow-up).

## Phase 17 - Rental report (RPT-01)

| Item | Status | Evidence |
|---|---|---|
| Enquiries, quotations issued, acceptance rate, confirmed and completed | Done (verified) | `src/tms/rentalReport.ts`; tests: `rentalReport.test.ts` "separates enquiries, quotations and acceptance, and states its coverage" |
| Revenue (invoiced) and received, outstanding as at the period end | Done (verified) | Same module; test "excludes voids from invoiced totals and reports outstanding as at the period end" |
| Vehicle utilisation with a stated denominator | Done (verified) | Test "computes utilisation from committed rental vehicle-days and the acting fleet" |
| Cancellation and decline reasons | Done (verified) | Test "groups cancellation and decline reasons, most frequent first" |
| Coverage statement and currency guard | Done (verified) | Tests "withholds money figures when the currency is not configured…" and the Coverage panel on screen |
| CSV export of the same figures | Done (verified) | `rentalReportCsv`, quoting-safe; test "exports the same figures as CSV" |
| Reports screen and destination | Done (verified) | `src/screens/Reports.tsx`, nav "Reports" gated by `kpis:read`; `src/screens/Reports.test.tsx` (3) |
| **Not built** | — | Date-range presets, filters by client/customer, PDF (RPT-05, Phase 3) |

Formulas are in `docs/KPIS.md` under "Rental report (RPT-01, implemented)".

Gates after this phase: `typecheck` clean, `lint` clean, `test` **255 passed, 5 skipped**,
`build` succeeds.

## Phase 18 - The three missing documents (§15)

| Document | Status | Contents |
|---|---|---|
| `docs/API.md` | Done (verified against the routes) | The six endpoints with request/response shapes, the command catalogue, permission pre-checks, and the error table |
| `docs/BACKUP_AND_RECOVERY.md` | Done (verified against `scripts/backup.ts` and `scripts/restore.ts`) | Full backup vs redacted export, `pg_dump`, restore procedure and verification, what a restore refuses, a quarterly drill |
| `docs/USER_ROLES_GUIDE.md` | Done (verified against `permissions.ts` and the screens) | The five roles in operator language, separation of duties, driver and client-contact scope, and what each blocked message means |

Still open from the conformance report: `PROGRESS.md` as a per-feature-ID table (§13.6), WEB-01,
AUTH-05, the Playwright proof for workflow C and a real parallel double-booking test. Phase 1B
(contracts, employees, bookings) and Phases 2–3 are unchanged and still not met.

## Phase 19 - The approved hardening list (in progress)

| Item | Status | Evidence |
|---|---|---|
| Integration tests run against PostgreSQL in CI, not skipped | Done (verified locally against Postgres 18 semantics via PGlite) | `.github/workflows/ci.yml` job `integration` (postgres:18-alpine, `db:migrate`, `npm run test:integration`); `src/server/repository.integration.test.ts` (5) + `src/server/commandFlow.integration.test.ts` (3), all 8 green |
| Workflow C proved end to end, with a reload in the middle | Done (verified) | `commandFlow.integration.test.ts` "runs a rental from request to a paid invoice, and the records survive a reload": `INV-2026-0001` GHS 3,450 due 2026-06-17, two payments to `paid`, `referenceCounters` persisted, audit rows re-read from the table (D-68 notes this is HTTP/command-level, not Playwright) |
| Parallel double-booking: six operators, one vehicle | Done (verified) | Same file: six concurrent `assign_rental` calls → 1 success, 5 × 409 with "already assigned to RR-…", exactly one `resource_reservation` row |
| A refusal caused by a clash returns 409, not 400 | Done (verified) | `Failure.kind = "conflict"` (`service.ts`), mapped in `runCommand`; only the assignment clash sets it today |
| **Defect fixed:** number series were written but never read back | Done (verified) | `loadDatabase` now reads `reference_counter`; without it the second payment of the day reused `PAY-…-0001` and was refused by `payment_reference_key` (the integration test caught it) |
| Vehicle release is a separate permission, and the releaser is recorded | Done (verified) | `maintenance:release` in `permissions.ts`; `advance_work_order` gate + `releasedBy`/`releasedAt`; audit action `maintenance:release`; tests "records who released the vehicle…" and "refuses to release a vehicle for an account that may advance work but not release it"; schema 12 (D-64) |
| **Still open** | — | AUTH-05 (profile + login history), WEB-01 (public enquiry form), `PROGRESS.md` as a per-feature-ID table (§13.6), and the Playwright substitute being labelled in the report |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **257 passed, 8 skipped** (the 8 are
the two integration suites, which only run with `TEST_DATABASE_URL`), integration **8 passed**,
`build` succeeds.
