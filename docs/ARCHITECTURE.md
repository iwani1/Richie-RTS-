# Architecture (as built)

## Deployment reality

- Build: Next.js 15 (App Router) + React 19 + Tailwind 4. `npm run build` emits a server bundle
  and static assets into `.next/`; `npm start` serves them. There is no single-file artifact any
  more — the page needs a server, because that is where authority lives.
- Runtime: one Node.js process on the operator's workstation (Fedora), plus PostgreSQL. The
  database is the source of truth. See `docs/SETUP_AND_DEPLOYMENT.md` for the install and run commands.
- Persistence: PostgreSQL 18, schema in `db/migrations/*.sql` (20 tables: `refund` arrived in
  `010_refunds.sql`, D-92, `expense` in `011_expenses.sql`, D-93, and `contract` in
  `015_contracts.sql`, D-95; `013` and `014` replace the two ceiling functions so a cancellation is
  not counted against itself (D-94); `012_reference_counter_scopes.sql`
  widens the numbering-series constraint to match `REFERENCE_SERIES`; `016_passenger_accounts.sql`
  adds `app_user.passenger_id`, widens the role check to accept `passenger` and creates
  `app_user_passenger_uq` (D-97); `017_receipt_scans.sql` adds `receipt_file`, the index to a scanned
  receipt kept in a folder outside the database (Q-51, D-100); `018_customer_details.sql` adds the
  customer code, the organisation/individual classification, the billing address, the tax number and a
  note to `client`, plus the buyer's address and tax number **copied onto** `invoice` at issue
  (CUS-01, D-101); `btree_gist` +
  `pgcrypto`, exclusion constraint on resource reservations, append-only audit trigger, monotonic
  odometer trigger). Access is through `src/server/repository.ts` (Kysely, typed SQL — D-50).
- Session: `iron-session` sealed cookie; passwords Argon2id (`@node-rs/argon2`) — D-51.
- The browser receives a **redacted, role-scoped snapshot** and holds no credentials; it posts
  commands to `POST /api/commands` (D-52, D-56). A driver's payload contains their own record, their
  trips and the vehicles those trips used — not the fleet, the client book or the audit log. A
  passenger's payload is narrower again: its own rider record, its own seats, the runs that carry it,
  the buses on them and its own reports. It receives neither the employee roster nor the settings
  table beyond the company name and the two booking cut-offs.
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

The interface is the **Daylight** direction (`docs/DESIGN.md` §4, which superseded D-41): a light operations workspace, not a component-kit
default. `docs/DESIGN.md` is the record; this is the summary a developer needs.

- **Type.** Inter Variable for every word and figure; IBM Plex Mono only for machine data —
  references, plates, times, money in tables. Figures are tabular.
- **Palette.** Canvas `#f5f6f9`, card `#ffffff`, hairline `#e7e9ef`, ink `#0f172a`, muted `#4a5468`,
  and **one** accent, indigo `#4453f0`. State colours (green, amber, red) appear only as a pill with
  its word, never as the sole carrier of meaning.
- **Form.** One elevation level: anything on the canvas casts the same soft shadow, anything inside a
  card casts none. Cards have one head, one line of qualifying text and one action. Corners are 8–14px.
  There is no per-destination colour: the accent marks the active destination and the primary action.
- **Implementation.** `src/ui/primitives.tsx` is the single component seam; `src/index.css` holds the
  tokens and the layout classes. Shell and navigation are in `src/App.tsx`; authentication in
  `src/screens/Auth.tsx`. The source-document viewer keeps its own document styling.
- **Verification.** Accessible names on every control, a skip link, a 2px focus ring with 2px offset,
  state never carried by colour alone, and no decorative motion, glass or gradient. Contrast is held
  at 4.5:1 for text; the accent measures 5.61 on white.

## Modules

| Path | Responsibility |
|---|---|
| `src/tms/types.ts` | Domain types, `SCHEMA_VERSION = 22` (the migration number and the snapshot version are counted separately: one phase shipped without a new migration), `emptyDatabase()`, `migrate()` (accepts `READABLE_SCHEMA_VERSIONS`, 1–22) |
| `src/tms/commandTypes.ts` | Every command name `/api/commands` accepts. The compiler and a test hold it to the modules that define commands (D-89) |
| `src/tms/permissions.ts` | `resource:action` permissions, the role matrix, and `isOwnScoped` / `isRecordBound` |
| `src/tms/scope.ts` | Own-record access: `actorLink`, `scopedView`, `mayReportOnVehicle`, `mayReportOnRun`, `confinedClientId`, `confinedPassengerId`. Confines `driver`, `client_contact` and `passenger` to their one linked record. Fails closed |
| `src/tms/service.ts` | Core commands: setup, users, settings, vehicles, drivers, clients, rentals, backup import |
| `src/tms/logistics.ts` | Staff logistics commands: incidents, work orders, cost entries, response and maintenance state machines |
| `src/tms/busing.ts` | Staff busing commands: routes, passengers, trip generation, assignment, dispatch, progressive start/stop/boarding, completion, cancellation, conflict checks and on-time judgement |
| `src/tms/bookings.ts` | Seat bookings: one named rider's seat on one run, capacity as roster + bookings, request/confirm/waitlist/reject/cancel, cut-offs, offers that are never auto-confirmed, and the run's manifest (`manifestFor`: roster plus every seat that still holds one) |
| `src/tms/compliance.ts` | Vehicle/driver compliance documents, expiry status and reminder lead time |
| `src/tms/maintenance.ts` | Odometer readings, last completed service anchor and fleet readiness evaluation per configured basis |
| `src/tms/creditNotes.ts` | The one invoice balance rule (D-86): `outstanding = total − paid − credited`, what is still owed back when credits pass what was paid (`paid + credited − total − refunded`, D-92), and the date-limited variant the closed-period reports use. Read by `finance.ts`, the statement, both money reports, `financeHome.ts` and the Invoices screen |
| `src/tms/financeHome.ts` | The finance home's figures: the period totals from `financialReport`, overdue invoices and unbilled hires as at today, payments to verify, and a margin that is withheld unless both sides of the period are complete |
| `src/tms/kpis.ts` | KPI calculations. Each result carries period, numerator, denominator, coverage and an explicit status |
| `src/tms/costs.ts` | Recorded-cost report with period, total, entries and data coverage. Counts incident and work-order costs and standalone expenses in one figure (D-93) |
| `src/tms/contracts.ts` | Corporate agreements (D-95): the transcribed term and commercial terms, `contractStateOf` (expiry derived from the end date, never stored), `isContractEditable`, the status moves, the overlap rule, `bookingContractProblem` (the booking gate) and `contractsDueForRenewal` |
| `src/screens/Contracts.tsx` | The contract register: term, client, service and derived state; draft and correct while unapproved; approve, suspend and terminate with a reason; the renewal watch |
| `src/tms/passenger.ts` | The passenger portal's reading of the records (PAX-01, D-97): `journeyStateOf` (the brief's statuses derived from a booking, a run or a boarding outcome), `journeysOf`, `eligibleRunsFor` (the runs a rider may ask for **and why not**, from the same rules the command runs), `cancellationProblem`, `travelPolicy` and `PASSENGER_LIMITS` |
| `src/screens/PassengerPortal.tsx` | A rider's one page: next journey, upcoming and past runs with their state, request a seat, cancel a seat, report a problem with a journey |
| `src/tms/printableReport.ts` | The management report as a document model (RPT-05, D-98): period, figures, sections, coverage and notes, every value already formatted from `RentalReport` and `FinancialReport`. It adds nothing up — it formats what the report calculated, and withholds money when no currency is set |
| `src/screens/PrintableReport.tsx` | The report sheet and its preview. Reuses the invoice sheet (`Documents.tsx`, D-87); the browser's print dialog produces the PDF |
| `src/tms/staffReport.ts` | The staff transport report (RPT-02, D-99): runs scheduled/worked/cancelled/off-schedule, riders carried, expected, no-shows and **not recorded**, boarding rate, occupancy from the seat capacity of the bus that ran, delay over the late stops only, the seats people asked for by status, why seats were lost, per-route and per-client tables, and `STAFF_REPORT_LIMITS` — the facts the records do not hold. On-time is taken from `kpis.ts`, not recomputed |
| `src/screens/StaffTransportReport.tsx` | The **Staff transport** tab on Reports: a service-date range, eight figures each with the sentence that qualifies it, the seats-requested and lost-seat tables, by route and by client, and a card naming what the report cannot say beside the coverage counts |
| `src/tms/planning.ts` | The planning aid (RTE-04, D-96): every vehicle-and-driver pair for a run, judged by the same rule the save enforces, ranked with a sentence each, plus `PLANNING_LIMITS` — the facts the records do not hold. Reads only; assigns nothing |
| `src/tms/receipts.ts` | The scanned copy of an expense receipt (Q-51, D-100): `RECEIPT_LIMITS` (2 MB, four types, three years), `receiptProblems`, `receiptFor`, and the `attach_receipt` / `remove_receipt` commands. It indexes files; it never touches one — that is `receiptStore.ts`. One scan on file per expense; a removed scan keeps its reason, its person and its file |
| `src/server/receiptStore.ts` | The only code that touches the receipt folder: sniffs the type from the bytes, generates the name on disk, enforces the ceiling, reads back only names it wrote, and computes the retention date |
| `src/app/api/receipts/route.ts` | `POST`, the one route that accepts a file: origin, session, `receipts:write`, sniff, save, then the server-only `attach_receipt` command — deleting the file again if the row is refused |
| `src/app/api/receipts/[id]/route.ts` | `GET`: session, `receipts:read`, then the disk. Serves the image under a sanitised name, `no-store` and `nosniff`, and says so plainly when the index has a scan the folder does not |
| `src/tms/expenses.ts` | Spending that is not a repair: `record_expense` / `void_expense`, numbered `EXP-YYYY-NNNN`, with the receipt number and whether the paper is held (D-93) |
| `src/tms/commands.ts` | `executeCommand()`: the single router for every write (`AnyCommand`) |
| `src/tms/crypto.ts` | PBKDF2-SHA256 password hashing via Web Crypto |
| `src/tms/useTms.ts` | React state, session, persistence, `dispatch()` |
| `src/tms/customerStatement.ts` | A customer's account for a period (D-90): the entries, the balance carried in and out, and the ageing bands. Also `debtAgeing()` (D-91), which totals those same bands across the company. Calls the shared balance rule rather than subtracting again |
| `src/screens/Statements.tsx` | The statement screen: choose a customer and a period, read the account, print it |
| `src/screens/Expenses.tsx` | The expense register: enter spending from a receipt, see the period total, the category split and how much has no receipt number, and void a wrong entry with a reason (D-93) |
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
