# Architecture (as built)

## Deployment reality

- Build: Next.js 15 (App Router) + React 19 + Tailwind 4. `npm run build` emits a server bundle
  and static assets into `.next/`; `npm start` serves them. There is no single-file artifact any
  more — the page needs a server, because that is where authority lives.
- Runtime: one Node.js process on the operator's workstation (Fedora), plus PostgreSQL. The
  database is the source of truth. See `docs/SETUP_AND_DEPLOYMENT.md` for the install and run commands.
- Persistence: PostgreSQL 18, schema in `db/migrations/*.sql` (16 tables, `btree_gist` +
  `pgcrypto`, exclusion constraint on resource reservations, append-only audit trigger, monotonic
  odometer trigger). Access is through `src/server/repository.ts` (Kysely, typed SQL — D-50).
- Session: `iron-session` sealed cookie; passwords Argon2id (`@node-rs/argon2`) — D-51.
- The browser receives a **redacted, role-scoped snapshot** and holds no credentials; it posts
  commands to `POST /api/commands` (D-52, D-56). A driver's payload contains their own record, their
  trips and the vehicles those trips used — not the fleet, the client book or the audit log.
- Quality gates: `npm run check` runs typecheck, lint, tests with coverage thresholds, and build,
  in that order. `npm run test:integration` runs the PostgreSQL suite (skipped without
  `TEST_DATABASE_URL`). `.github/workflows/ci.yml` runs both on a runner; the integration job has
  not been observed on GitHub from the development environment.
- Security posture: headers are set by the server (`next.config.ts`, D-49): `X-Frame-Options:
  DENY`, `nosniff`, `no-referrer`, a restrictive `Permissions-Policy`, and a CSP with
  `frame-ancestors 'none'`. HSTS and TLS belong at the reverse proxy (§5 of the run guide).
- Audit retention: the table keeps every entry; the *screen* reads the newest 5,000 because the
  snapshot is sent whole. No retention job exists yet (Q-18).

## Interface system

The interface is a purpose-built "operations ledger", not a component-kit default:

- **Type.** Fraunces (display headings, auth poster), Archivo (body/UI), IBM Plex Mono (eyebrows,
  labels, nav indices, table heads, badges). Loaded via Google Fonts with serif/sans/mono
  fallbacks so the app still renders offline.
- **Palette.** Ink `#14231d`, paper `#f2ecdf`, card `#fbf7ec`, hairline `#cfc5ae`, signal amber
  `#e0a43c`, brass `#b08b3e`, rust `#a24a30`. Tokens are `--rts-*` custom properties.
- **Form.** Square corners, 1px ink rules, hard offset shadows, numbered/grouped ledger rail,
  dotted-grid desk surface, dashed tape motif in the rail.
- **Implementation.** `src/ui/primitives.tsx` is the single component seam; layout classes live at
  the end of `src/index.css` under the RICHIE OPERATIONS LEDGER block. Shell and navigation are in
  `src/App.tsx`; authentication in `src/pages/Auth.tsx`. The source-document viewer keeps its own
  document styling.
- **Verification.** Headless Chromium at 1440px and 390px: fonts loaded, 0px radii, offset shadows,
  one active nav item, mobile rail off-canvas with visible menu trigger, no horizontal overflow, no
  page errors, and sampled small text at >=4.5:1 contrast. All 118 behavioural tests remain green;
  D-41 records the design decision.

## Modules

| Path | Responsibility |
|---|---|
| `src/tms/types.ts` | Domain types, `SCHEMA_VERSION = 15`, `emptyDatabase()`, `migrate()` (accepts schema 1–15) |
| `src/tms/permissions.ts` | `resource:action` permissions, the role matrix, and `isOwnScoped` / `isRecordBound` |
| `src/tms/scope.ts` | Own-record access: `actorLink`, `scopedView`, `mayReportOnVehicle`, `confinedClientId`. Confines `driver` and `client_contact` to their one linked record. Fails closed |
| `src/tms/service.ts` | Core commands: setup, users, settings, vehicles, drivers, clients, rentals, backup import |
| `src/tms/logistics.ts` | Staff logistics commands: incidents, work orders, cost entries, response and maintenance state machines |
| `src/tms/busing.ts` | Staff busing commands: routes, passengers, trip generation, assignment, dispatch, progressive start/stop/boarding, completion, cancellation, conflict checks and on-time judgement |
| `src/tms/bookings.ts` | Seat bookings: one named rider's seat on one run, capacity as roster + bookings, request/confirm/waitlist/reject/cancel, cut-offs, offers that are never auto-confirmed, and the run's manifest (`manifestFor`: roster plus every seat that still holds one) |
| `src/tms/compliance.ts` | Vehicle/driver compliance documents, expiry status and reminder lead time |
| `src/tms/maintenance.ts` | Odometer readings, last completed service anchor and fleet readiness evaluation per configured basis |
| `src/tms/creditNotes.ts` | The one invoice balance rule (D-86): `outstanding = total − paid − credited`, the refund due when credits pass what was paid, and the date-limited variant the closed-period reports use. Read by `finance.ts`, both money reports, `financeHome.ts` and the Invoices screen |
| `src/tms/financeHome.ts` | The finance home's figures: the period totals from `financialReport`, overdue invoices and unbilled hires as at today, payments to verify, and a margin that is withheld unless both sides of the period are complete |
| `src/tms/kpis.ts` | KPI calculations. Each result carries period, numerator, denominator, coverage and an explicit status |
| `src/tms/costs.ts` | Recorded-cost report with period, total, entries and data coverage |
| `src/tms/commands.ts` | `executeCommand()`: the single router for every write (`AnyCommand`) |
| `src/tms/crypto.ts` | PBKDF2-SHA256 password hashing via Web Crypto |
| `src/tms/useTms.ts` | React state, session, persistence, `dispatch()` |
| `src/screens/Documents.tsx` | The paper a customer keeps (D-87): `InvoiceSheet` and `CreditNoteSheet`, plus `PrintPreview`, which portals a sheet to `document.body`, sets the page title (the suggested file name) and hands printing to the browser |
| `src/ui/useDialogFocus.ts` | The keyboard contract every overlay shares: focus in, Tab trapped, Escape closes, focus restored. Used by `Panel` and the print preview |
| `src/pages/*` | Screens. `StaffBusing.tsx` holds Routes, Passengers, Trips, Bookings and Performance tabs |
| `src/ui/primitives.tsx` | Shared form, table, panel and notice components |
| `src/docs/BriefDesk.tsx` | Read-only viewer for the source brief (kept per Integrity rule 6) |

Dependency direction: pages depend on `useTms`, which depends on `commands`, which depends on `busing` and `service`. `busing` and `service` never import pages or React. `busing` and `bookings` import helpers from `service` (`authorise`, `audit`, `fail`, validators). `service` imports neither, so there is no cycle.

## Request flow for a write

1. A UI handler calls `dispatch(command)` from `useTms`. The browser's command union
   (`src/tms/clientCommand.ts`) contains no credential-bearing and no restore command, so those
   cannot even be expressed.
2. `POST /api/commands` runs `src/server/commands.ts`:
   1. the actor is resolved **from the session cookie**, never from the request body;
   2. the command type is checked against an allow-list, and a coarse permission pre-check runs;
   3. a credential, if the command sets one, is hashed here with Argon2id — the browser cannot
      supply a hash;
   4. one transaction opens and takes `pg_advisory_xact_lock`, so two operators cannot interleave
      a read-modify-write;
   5. the snapshot is loaded from PostgreSQL;
   6. the pure command layer (`executeCommand`) runs: permission, validation, state machine,
      resource conflicts, audit entry;
   7. the difference is written back (reservations first, then children-first deletes,
      parents-first upserts, settings, insert-only audit);
   8. the new state is **redacted, scoped to the actor and returned**. A database error is mapped to
      an operator message (conflict, constraint, unknown) rather than leaking SQL; a body whose
      shape the command cannot read is refused as a 400, not reported as a server fault.
3. The browser replaces its snapshot with the response. `useTms` serialises commands, so an older
   response can never overwrite a newer one on screen.

Two layers, on purpose: the pure layer gives fast, testable, precise rules and good error messages;
PostgreSQL gives the guarantee. If the service layer is wrong, the exclusion constraint, the
triggers and the foreign keys still refuse the write.

This flow is enforced, not just described: ESLint forbids screens and UI files from importing an
`execute*` function, `executeCommand`, or anything from `src/server/` (D-53). The only path to a
write is `dispatch()`.

Guarantees in this build: no mutation without a permission; illegal transitions refused; every
successful write produces an audit entry; failed writes leave data untouched (transaction
rollback); a vehicle cannot be double-booked even if the service layer is bypassed; audit rows
cannot be changed or deleted.

Known limits:

1. **The snapshot is coarse.** Each command returns the whole redacted workload for the role, and
   scope filtering for portal users happens in the domain layer (`src/tms/scope.ts`) rather than in
   SQL. Correct for a single operator's ledger; pagination and row-level filtering are the next
   step (§13 of the run guide).
2. **The sign-in throttle is in-process memory**, so it does not coordinate across instances.
   Writes themselves are safe (advisory lock in the database), so this is a rate-limiting limit,
   not a correctness one.
3. **Own-record scope is applied in the domain layer on every read and write** and is covered by
   tests, but it is not yet a row-level database policy. A query written outside the repository
   would not inherit it.

## Provider interfaces (seams for later)

| Seam | Current implementation | Target |
|---|---|---|
| Persistence | PostgreSQL behind `/api/commands`, with the constraints in `ERD.md` (done, Phase 13) | Pagination / row-level filtering for larger datasets |
| Authentication | Argon2id accounts, `iron-session` cookies, server-side permission checks (D-51) | A provider (Auth.js / Better Auth) once email verification or 2FA is required |
| Clock | `now` is passed into every command; the server passes its own clock (done) | A scheduled job runner for daily generation and reminders |
| Notifications | None | Email/SMS providers (not configured) |

## Job runner

Not present. Trip generation runs only when an operator asks for it. A scheduler now has somewhere to run (the server exists), but daily generation, document-expiry reminders and retention jobs are still **not implemented** and are not claimed as working.
