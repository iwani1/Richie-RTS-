# Decision records

One record per significant choice. Newest at the bottom.

## D-01 Persistence in this environment: browser-local service layer (interim)

- **Context.** The brief requires real persistence through server-side validation and permission checks (Integrity rule 1). The build environment available for Phase 1A serves a single static `dist/index.html` (Vite + `vite-plugin-singlefile`). There is no Node.js runtime for a server, no PostgreSQL, no background worker and no WebSocket host. Hosting target fields in AGENTS.md section 3 were not visible in the uploaded material, so the target is **unknown**.
- **Decision.** Build the domain as a pure, synchronous **command service** (`src/tms/service.ts`) that performs validation, authorisation (`resource:action` matrix in `src/tms/permissions.ts`), state transitions and audit logging, and persist its output to `localStorage`. The UI never mutates data directly; every write is a command. Passwords are hashed with PBKDF2-SHA256 (120k iterations, random salt) via Web Crypto.
- **Why.** It is the strongest supported alternative (Integrity rule 7): the rules are enforced in one place, are unit-tested, and the same `execute(db, actor, command)` contract can be lifted behind an HTTP API over PostgreSQL without rewriting screens. The UI labels the limitation ("Browser-local storage - server not configured").
- **Rejected.** (a) Mock REST server in the bundle: still browser-only, adds indirection without enforcement. (b) Third-party BaaS: needs secrets in client code and an account the owner has not provided. (c) Pretending a server exists: violates Integrity rule 2.
- **Consequence / exit criteria.** This is **not production persistence**. Phase 1A is complete only as a vertical slice of the domain and UI. A server runtime + PostgreSQL must be provisioned before any production use; when it is, `service.ts` moves server-side and `useTms.ts` is replaced by an API client.

## D-02 Authentication: local accounts with PBKDF2, administrator-created users

- **Decision.** First run creates the initial administrator (no default credentials). Further accounts are created by administrators; no self-registration, no self-service reset. Minimum password length 10 (a system security floor, not a business rule). Sign-in errors are generic.
- **Rejected.** Auth libraries (Auth.js, Lucia, Passport) all need a server. Magic links / OTP need email or SMS providers that are not configured.

## D-03 Package manager and tooling

- npm (lockfile already present). TypeScript strict. Vitest for unit tests and jsdom + Testing Library for the end-to-end UI flow. Tailwind CSS v4 for UI. No ESLint config exists in the repository yet (see PROGRESS.md gaps).

## D-04 Unknown business rules become nullable settings with no default

- `Settings` fields (`companyName`, `currencyCode`, `onTimeThresholdMinutes`, `vehicleCategories`, `shifts`) start empty. Features that need them are blocked with an explicit message (e.g. vehicle registration requires at least one category). The dashboard shows a setup checklist. Each unknown is listed in `OPEN_QUESTIONS.md`.

## D-05 Vehicle state machine for Phase 1A

- Manual statuses: `available`, `maintenance`, `out_of_service`, `retired` (final). `in_service` is deliberately excluded until trips exist; it will be set by trip assignment, not by hand. Every transition requires a reason and is audited.

## D-06 Preserve the Phase 0 brief viewer

- The earlier read-only brief viewer (`src/docs/BriefDesk.tsx`) is kept and reachable from the "Project brief" navigation item rather than deleted (Integrity rule 6).

## D-07 (Phase 1B) Bus rentals priced from a configured basis + manual line items; no invented rates

- **Context.** The brief requires quotation, deposit and final billing, but rental rates, the pricing basis, deposit percentage, quotation validity, payment methods and whether drivers are always included are all unknown (OPEN_QUESTIONS Q-07..Q-11, Q-15).
- **Decision.** Pricing basis, deposit %, quotation validity, driver-inclusion and the payment-method list are **settings with no default**. Quoting is blocked (`rentalQuotingReady`) until currency + basis + deposit % + validity + >=1 payment method are set. The actual money is entered as **manual quotation line items**; the system only computes the subtotal, the deposit (subtotal x deposit %) and the validity date. No tax/VAT lines are added because GRA e-VAT/levy treatment is unknown (Q-14) — the UI states this.
- **Rejected.** Hard-coding any GHS rate, deposit figure or tax rate (violates Integrity rule 3); auto-computing by day/km without a rate table that does not exist.

## D-08 (Phase 1B) Rental state machine + double-booking prevention

- **Decision.** One `Rental` aggregate carries the lifecycle `draft -> quoted -> confirmed -> in_progress -> completed`, with `declined`/`cancelled` branches. Transitions are a table (`RENTAL_TRANSITIONS`) enforced in the service, each guarded by a permission. Resource assignment checks vehicle category match, vehicle/driver availability, driver licence expiry vs rental end date, and **rejects assigning a vehicle or driver already booked on a confirmed/in-progress rental with overlapping dates** — the in-code equivalent of the btree_gist exclusion constraints named in Phase 0 section 5.1 (which cannot run here without PostgreSQL, D-01).
- **Note.** Editing is restricted to `draft`; re-quoting in place is not yet supported (cancel and re-raise). Logged for a later phase.

## D-09 (Phase 1B) Schema migration 1 -> 2

- Added `rentals[]` and `settings.rental`. `migrate()` upgrades stored/backup data from schema 1 (backfilling empty rentals and default-less rental settings) so existing Phase 1A data and backups keep working. Import accepts schema 1 or 2.

## D-10 (Phase 2) Staff busing as one module with a single command router

- **Decision.** Staff busing lives in `src/tms/busing.ts`. `src/tms/commands.ts` routes every write: busing command types go to `executeBusing`, all others to the core `execute`. UI code calls only `dispatch` from `useTms`, which calls `executeCommand`.
- **Why.** The core service file was already large, and the busing rules should be testable on their own. One router keeps the rule "every write goes through a permission check, validation and audit" true for every module.
- **Rejected.** Duplicating `authorise`/`audit` in the busing module (risk of drift); adding busing cases to the core `execute` switch (grows an already large function).

## D-11 (Phase 2) On-time rule and threshold snapshot

- **Decision.** A completed trip is on time when every stop's actual time is no later than its scheduled time plus the on-time threshold. Early arrivals count as on time. The threshold value is copied onto the trip at completion. If the threshold is unset then, the trip is not judged, and it is never re-judged later.
- **Why.** The threshold is an unknown business rule (Q-06), so it must not be guessed. A snapshot keeps history stable when the setting changes.
- **Open.** Per-stop or trip-level judgement, and whether early arrivals count (Q-25). The current rule is a proposal and is labelled as such in the UI and in KPIS.md.

## D-12 (Phase 2) Passengers: one route, no boarding codes

- **Decision.** A passenger has at most one route and one pickup stop. Boarding codes are not implemented.
- **Why.** Boarding-code policy is unknown (Q-19). Multi-route passengers need a rule for which route applies on each day (Q-30). Both are deferred so that no policy is invented.
- **Consequence.** Attendance is recorded per passenger per trip as boarded or no-show. No code is verified at boarding.

## D-13 (Phase 2) Trip conflicts: time windows, not whole days

- **Decision.** Two trips conflict for the same vehicle or driver only when their windows overlap on the same service date. A trip's window runs from its first stop's time to its last stop's time. Back-to-back and separate runs are allowed. Rentals block the whole day of a confirmed or in-progress booking.
- **Why.** One bus commonly runs a morning and an evening route on the same day. Whole-day blocking would be wrong for busing.
- **Consequence.** The matching database form is the exclusion constraint in `ERD.md`.

## D-14 (Phase 2) Routes lock once trips exist

- **Decision.** After any trip exists for a route, its client, vehicle category and stop list (names, times and IDs) cannot change. Operating days, dates and status can still change.
- **Why.** Completed trip records reference stop IDs and client identity. Changing them later would corrupt history (Integrity rule 1 and the audit trail). The fix is a new route, not an edit.

## D-15 (Phase 2) Driver required for dispatch; vehicle must be Available

- **Decision.** Dispatch requires both a vehicle and a driver. Assignment requires the vehicle's current status to be Available. Maintenance and out-of-service vehicles cannot be assigned.
- **Why.** A bus cannot run without a driver. Per-date maintenance scheduling is not modelled, so the current status is the only signal available. Stricter than the rental rule, which allows maintenance status.
- **Open.** Whether busing always needs a driver as a business rule (Q-26).

## D-16 (Phase 3) Scope: response and maintenance, not cost-per-trip

- **Decision.** Staff logistics covers incidents/breakdowns, maintenance work orders and recorded
  costs. It deliberately does **not** produce cost-per-trip or fleet-utilisation figures.
- **Why.** Both need definitions and inputs the business has not supplied (Q-29). Reporting them
  now would mean inventing an attribution rule, which breaks Integrity rule 3 and rule 4.
- **Consequence.** The cost report shows what was *recorded*, with its period and coverage, and
  states plainly that an empty list is not a zero cost.

## D-17 (Phase 3) Vehicle status is an explicit operator choice

- **Decision.** Reporting an incident offers "take the vehicle out of service"; resolving it
  offers "leave unchanged / available / maintenance / out of service". Starting work moves the
  vehicle to maintenance; closing a work order offers the same restore choice.
- **Why.** The brief says maintenance coordination must affect availability, but it does not say
  when a vehicle must be withdrawn. Making it a recorded choice avoids inventing policy while
  still producing the real effect (the vehicle leaves trip/rental assignment).
- **Rejected.** Auto-withdrawing every vehicle on every incident (a scratch would stop a bus);
  never touching vehicle status (then "coordination" is decorative).

## D-18 (Phase 3) Cost categories are free text; costs need a currency first

- **Decision.** A cost is description + category (free text) + amount + date. Recording a cost
  is refused until the company currency setting is set.
- **Why.** No category taxonomy or currency has been supplied. Adding 200 to an unknown currency
  is meaningless, so the total is withheld too (rule 4). Free text means no invented taxonomy.
- **Rejected.** A built-in category list (invented); showing totals without a currency.

## D-19 (Phase 3) Incident and work order are linked; an incident cannot close first

- **Decision.** A work order may be raised from an incident and stores `incidentId`. An incident
  cannot move to closed while a linked work order is not closed.
- **Why.** This is the actual coordination between breakdown response and maintenance: the
  response is not finished while the repair is open. It also makes the cost trail traceable
  from the event to the bill.

## D-21 (Phase 4) Own-record scope, and why now

- **Context.** `driver` and `client_contact` were in the brief's role list but had **zero**
  permissions, and every permission was company-scoped. Two of five actors could not use the
  system, and PERMISSIONS.md listed own-record scope as outstanding work.
- **Decision.** Link each record-bound account to exactly one record (`User.driverId`,
  `User.clientId`), grant those roles a minimal own-record permission set, and confine reads
  and writes to that record. Wall them off from every internal screen.
- **Rejected.** Granting those roles company-wide reads (a client could see another client's
  roster); leaving the roles with no permissions (dead roles); implementing portals without
  scope enforcement (the screens would leak).

## D-22 (Phase 4) Scope is fail-closed and derived from the role

- **Decision.** `actorLink` takes "is this role record-bound?" from the actor's role, not from
  the user row it looks up. A record-bound actor whose row (or linked record) is missing gets
  an empty view rather than a full one.
- **Why.** Deriving scope from a lookup that can fail returns `false`, which meant full access
  — a fail-open default. I found and fixed this while writing the scope tests.

## D-23 (Phase 4) A driver reports, operations withdraws

- **Decision.** A driver may report an incident only against a vehicle assigned to one of its
  trips, and the "take vehicle out of service" flag is ignored for record-bound roles.
- **Why.** D-17 made withdrawal an operator decision. Letting a driver change fleet
  availability would hand a record-bound role a company-wide side effect.

## D-24 (Phase 4) Portals are read-and-report only

- **Decision.** The driver portal shows licence, own runs and incident reporting. The client
  portal shows own routes, a minimised roster and rental requests. Neither can dispatch,
  complete trips, edit rosters or see money.
- **Why.** Those actions need rules that are still open (boarding codes Q-19, billing
  Q-CON-01). A narrow, dependable slice beats a half-working one (Integrity rule 8).
- **Open.** Driver trip updates and rider self-service are deliberately out (Q-39, Q-40).

## D-25 (Phase 5) Drivers execute their own run — amends D-24

- **Context.** D-24 made the driver portal read-and-report only. That left the flagship
  service's operational loop incomplete: the people who actually drive the run could not
  record what happened, so stop times and boarding depended entirely on operations
  re-entering it. Contract billing is blocked (Q-CON-01), so this is the part of the mission
  path — "a completed trip" — that could be closed without inventing a business fact.
- **Decision.** A driver gains `trips:complete`, scoped to its own run, and records the actual
  time at each stop plus boarded/did-not-board for each person on the run. Roster detail stays
  name and pickup stop only. Ownership is checked **before** status so probing another run
  reveals nothing about it. Completion remains final and auditable.
- **Rejected.** Giving drivers `trips:dispatch` or `trips:cancel` (operations keeps control of
  resourcing); letting a driver complete any run (scope violation); progressive stop logging
  (needs a new status model — left as Not started); a "correct my run" action (would need its
  own auditable flow, Q-42).
- **Open.** Whether drivers or operations should own boarding capture (Q-41), and how much
  roster a driver may see (Q-39) — currently name and pickup stop, consistent with the client
  portal.

## D-26 (Phase 6) Compliance documents are metadata, separate from licence eligibility

- **Context.** Q-16 was open: no document types were tracked, no vehicle documents existed at
  all, and only an already-expired driver licence was flagged. Company paperwork (insurance,
  roadworthy certificates, permits) had nowhere to live.
- **Decision.** A `ComplianceDocument` record holds owner (vehicle or driver), an
  admin-defined document type, number, issued and expiry dates and notes. Document types and
  the "expiring soon" lead time are Settings values with **no default** (Q-16). Until a lead
  time is set, status shows only already-expired documents - the same rule the dashboard
  already applied to licences.
- **Why separate.** `Driver.licenceExpiry` already drives trip-assignment eligibility and is
  covered by passing tests (Integrity rule 6: preserve working code). Merging a general
  document store into that field would have changed working eligibility logic and still not
  covered vehicles.
- **Rejected.** Inventing a document-type catalogue (insurance, roadworthy...): the company
  names its own types. Assuming a 30/60/90-day lead time: that is a business fact. Treating a
  missing lead time as "expiring soon" for everything: that would manufacture warnings.

## D-27 (Phase 6) Owner and document type are locked after creation

- **Decision.** A recorded document may have its number, dates and notes edited, but not its
  owner or document type.
- **Why.** A record whose owner changes stops being evidence of the original filing
  (Integrity rule 1). If the wrong owner was chosen, the correct fix is to record it against
  the right owner; the audit log keeps the original.

## D-28 (Phase 7) Lint added late, and what it found

- **Context.** Phase 0 required confirming that "typecheck, lint, test and build all run".
  Lint was never set up; `docs/PROGRESS.md` tracked it honestly as Not Started through six
  phases. Phase 7 closes that gap.
- **Decision.** ESLint flat config: `@eslint/js` and `typescript-eslint` *recommended* sets,
  plus `eslint-plugin-react-hooks`. Correctness rules are errors; style is not linted. One
  architectural rule is enforced mechanically because the brief depends on it: UI code may not
  import any `execute*` function, only `dispatch()` from `useTms` (ARCHITECTURE.md "Request
  flow for a write"). That rule had been a convention held only by review; it is now a build
  failure.
- **What the baseline run found.** Six errors in files that all had passing tests. Two were
  mechanical (`prefer-const`, `eqeqeq`). Four were genuine React correctness findings that
  typecheck cannot see (D-29). This is the argument for having added lint, and the argument
  for having done it as its own phase rather than inside a feature: the fixes touched the
  persistence core and had to be verified in isolation.
- **Rejected.** `--fix` for the `eqeqeq` finding: it would have narrowed an intentional
  `!= null` (null *or* undefined) to `!== null` and silently changed behaviour. Written out
  explicitly instead. Also rejected: a style-heavy ruleset, which would have produced hundreds
  of findings with no correctness value and buried the four that mattered.

## D-29 (Phase 7) Three React correctness fixes in the core, one of them security-relevant

Lint surfaced these in `useTms.ts` and `App.tsx`. Each is a behavioural change, so each is
recorded.

1. **Actor ref written during render** (`actorRef.current = actor` in the component body).
   Under React 18+ concurrent rendering a render can start and be discarded; writing the ref
   during render could leave `dispatch()` acting as a stale or never-committed actor - the
   wrong user. Now synced in an effect. *Covered by every dispatch in the suite.*
2. **Route fallback in an effect after render.** The out-of-scope screen rendered for one
   frame before the effect corrected it. The effective route is now derived during render, so
   a record-bound role never gets a single render of a screen outside its scope. This is a
   defence-in-depth improvement to own-record scope (PERMISSIONS.md), not the security
   boundary itself. *Covered by `Portals.test.tsx` (forbidden nav absent).*
3. **Persistence in an effect, with setState on every write.** Every successful write
   scheduled a cascading render, and there was a window after commit where React state and
   `localStorage` disagreed. Persistence now happens synchronously inside `commit()`, the one
   place state changes. A mount-only effect still surfaces a storage error that pre-exists the
   session. *Covered by `App.test.tsx` (localStorage asserted after writes).*

None of these would have been caught by typecheck or by the existing tests on their own; the
tests prove the fixes did not regress behaviour, lint is what found the defects.

## D-20 (Phase 3) Response machines are strict and the report freezes

- **Decision.** `reported → acknowledged → responding → resolved → closed`, and
  `open → in_progress → (on_hold) → completed → closed`. No skipping. Once an incident is
  responding, its original report cannot be edited; corrections go in the log.
- **Why.** Integrity rule 2: the record has to be evidence. A frozen report plus an append-only
  log is auditable; a mutable report is not. Reopening and back-dating are not implemented
  because no policy for them was supplied.

## D-30 (Phase 8) Service intervals are per-category settings with no default

- **Decision.** A schedule belongs to a vehicle category and may set an interval in km, in days,
  or both, plus an optional reminder lead for each basis. Every field starts null; adding no
  schedule at all is a valid state that the report calls "not configured".
- **Why.** Q-17 and Q-37 supplied no intervals or leads. Guessing 6 months or 20,000 km would
  invent a maintenance policy. A blank lead deliberately means no "due soon" warning for that
  basis, not zero days of warning.
- **Rejected.** Fleet-wide defaults; deriving an interval from a category name; showing a
  readiness percentage when nothing is configured.

## D-31 (Phase 8) A service is an operator decision on a work order, not an inference

- **Decision.** The system does not decide that a repair was a service. An operator ticks "this
  work resets the service interval" when raising or editing a work order; only a work order later
  completed with that flag anchors the schedule. `completedAt` records when it completed.
- **Why.** Which jobs restart an interval is a rule management has not supplied. Inference would
  fabricate policy, and the work type is free text with no catalogue.
- **Consequence.** A service recorded while a category was date-only has no odometer, so a later
  km basis reports that explicitly instead of guessing a starting mileage.

## D-32 (Phase 8) Odometer readings are hand-recorded and cannot go backwards

- **Decision.** Readings are entered by operators with a date and optional note. A reading lower
  than the newest current reading is refused; correcting one means voiding it with a reason, which
  keeps it in the audit trail and out of calculations.
- **Why.** No telematics feed is configured, so the value is a hand-entered fact that must be
  internally consistent for km arithmetic to be meaningful.

## D-33 (Phase 8) Readiness takes the worst basis, explains gaps, and never blocks dispatch

- **Decision.** When both bases are configured and usable, the vehicle takes the more urgent
  status. When inputs are missing the status is "insufficient data" with the specific reason.
  Coverage counts only vehicles this build can actually evaluate, over all non-retired vehicles.
  An overdue service warns on screen and on the dashboard; it never blocks trip or rental
  assignment because that policy is unanswered (Q-43).
- **Schema.** Bumped to v7; `migrate()` upgrades older backups with empty `odometerReadings`,
  empty `settings.maintenance.schedules`, and `resetsServiceInterval: false` / `completedAt: null`
  on legacy work orders so no service is invented.

## D-34 (Phase 9) Expired quotation policy is an explicit no-default setting

- **Decision.** `settings.rental.requotePolicy` is null until an administrator chooses
  `revise_in_place` or `new_request`. An expired quote cannot be confirmed. Renewal is blocked
  when policy is null; `new_request` uses the existing cancel-and-raise flow.
- **Why.** This is Q-24. Implement both supported paths without deciding company policy for the
  owner. The policy value in force at renewal time applies to outstanding expired quotations.
- **Rejected.** Assume that an expired quote can be revised, or silently force every customer to
  start over.

## D-35 (Phase 9) Quote revisions are immutable snapshots

- **Decision.** The current quote remains on `Rental.quote`; each replaced quote is appended to
  `Rental.quoteHistory`. Renewal is allowed only while status is `quoted`, only after the current
  quote expires, and only under `revise_in_place`. The old amount, deposit requirement, validity
  date, pricing basis and actor/time stay in the snapshot.
- **Why.** Renewal is not editing history. It is a new quotation with a new validity date. The
  existing rental lifecycle remains `quoted`; this is a quote revision, not a status transition.
- **Open.** A renewal uses the pricing basis, deposit percentage and validity currently in
  Settings; management should confirm this (Q-46).

## D-36 (Phase 9) Schema 7 to 8

- Added `settings.rental.requotePolicy` (null for existing installations) and `quoteHistory[]`
  (empty for rentals already carrying a current quote). Existing current quotes are preserved
  verbatim; no quote is treated as revised during migration.

## D-37 (Phase 10) A trip is recorded progressively, stop by stop

- **Decision.** After dispatch, the assigned driver or operations explicitly starts the run.
  The next route stop is then recorded once, in route order, with its actual arrival time and
  boarded/did-not-board outcomes for that stop's active roster. The stop record is appended to
  `Trip.stopLogs` and `Trip.boardings`; the general audit log records the stop and counts, not
  passenger names. The trip remains in progress until all stops/outcomes are complete.
- **Why.** The prior completion form required the driver to reconstruct the whole run at the
  end. Progressive recording captures the evidence when it occurs and prevents skipped stops.
- **Compatibility.** The operations full-completion form remains available on a dispatched,
  unstarted trip. It cannot overwrite a trip that already has progressive records.
- **Roster stability.** Passenger additions/edits on the route are refused while a trip on that
  route is in progress, so the expected stop rosters cannot change between recording stops.

## D-38 (Phase 10) Stop records and completed runs are immutable

- **Decision.** A stop time and its boarding outcomes cannot be overwritten after submission.
  A completed trip is terminal. A mid-run abort is not supported; operations reports an
  incident instead. See OPEN_QUESTIONS Q-42 and Q-47.
- **Why.** No correction, back-date or abort policy was supplied. An append-only record is
  auditable; silent edits would change the evidence.

## D-39 (Phase 10) Schema 9 to 10

- Added the `in_progress` trip status and `Trip.startedAt`; `migrate()` backfills old trips with
  `startedAt: null`. Old planned/dispatched/completed/cancelled statuses are unchanged.

## D-40 (Phase 11) Mid-trip roster changes are allowed for future stops only — amends D-37

- **Context.** D-37 froze the whole route roster while any trip was in progress. Real operations
  need late additions (a new hire joins at an upcoming stop) and removals (someone calls in
  sick) without waiting for the run to finish. A blanket freeze also created deadlocks: an
  inactive passenger could never be reactivated mid-run even when their stop was still ahead.
- **Decision.** Replace the freeze with per-stop rules, enforced in the service layer:
  - A new or moved active passenger must land on a stop still in the future on *every*
    in-progress trip on the route; recorded stops refuse with the trip reference.
  - Once a passenger has a boarding outcome on an in-progress trip, route/stop/status/client
    lock; only name, phone and employee reference stay editable.
  - Deactivation and route removal are allowed only while the passenger has no boarding
    outcome on any in-progress trip.
  - Every mid-trip change appends the affected trip references to the audit summary, without
    personal data. No new permissions: operations and admin only, as before.
- **Why.** Recorded stops and boarding outcomes are evidence (D-38) and stay immutable, while
  future expectations remain plannable. The completion check (`boardings.length` vs active
  roster) stays consistent because every allowed change preserves it.
- **Rejected.** Keeping the blanket freeze (blocks legitimate operations); allowing edits to
  recorded stops (would corrupt completed evidence or deadlock completion); letting drivers
  edit the roster (roster ownership stays with operations; drivers see the updated next stop).


## D-41 Interface: the operations-ledger visual system

- **Decision.** Replace the generic light-dashboard skin with a purpose-built visual language:
  newsprint paper, ink green, signal amber and brass; Fraunces display headings, Archivo body
  text and IBM Plex Mono for labels, table headers, nav indices and badges; square corners,
  hard offset shadows, hairline rules and a numbered, grouped ledger rail.
- **Why.** The brief demands an operational application with a clear identity, not a template
  admin panel. The waybill/timetable motif reflects the domain (routes, trips, plates, fares)
  and makes dense operational data easier to scan: mono uppercase labels separate metadata from
  content; tabular figures align money and times; square panels read as printed records.
- **Scope and preservation.** Only presentation and shell structure changed. Routes, page
  contents, form labels, roles, accessible names, dialogs and all business rules are untouched;
  the 118-test suite is the guardrail. Source-document viewer (`BriefDesk`) keeps its own
  document styling.
- **Evidence.** Verified in headless Chromium at 1440px and 390px: display/body/mono fonts
  loaded; rail 276px; 0px corner radii; offset shadows present; exactly one active nav item;
  mobile menu visible with the rail off-canvas; no horizontal overflow; zero page errors.
  Small-text tokens were darkened during review to reach contrast on paper.
- **Limits.** External Google Fonts need network access; system serif/sans/mono fallbacks are
  defined. Print/PDF export of the ledger is not implemented.

## D-42 (Phase 12) The supplied standing brief is the authoritative `AGENTS.md`

- **Context.** The build had been running from a condensed `AGENTS.md` that stated "section 5.1
  (exclusion constraints) and section 7 (feature IDs) were not supplied". Both sections are in
  the text supplied with this repository (`richie-tms-standing-brief.md`): §5.1 defines the
  database-enforced double-booking constraint, §7 is the 78-ID feature backlog. The condensed
  file therefore mis-stated the brief, and feature tracking drifted into invented phase names.
- **Decision.** Install the supplied standing brief verbatim as `AGENTS.md`, because the brief
  itself says to do that. Preserve the condensed file at `docs/archive/AGENTS-condensed.md`
  rather than deleting it (integrity rule 6), and keep the phase prompts at the root.
- **Why.** The project should be measured against what the owner actually asked for, including
  the parts the build could not meet.
- **Consequence, recorded honestly.** Measured against the real §4 and §5.1/§7, this build is a
  browser prototype, not the specified system: no Next.js, PostgreSQL, Prisma, Zod, job runner,
  Playwright, Docker; no database-enforced exclusion constraint; 5 of 78 feature IDs done and
  44 partial (`audit/DEMO-COMPARISON.md`). Nothing in this session can change that without a
  server; it changes what the project claims.

## D-43 (Phase 12) Credentials are validated where they are created, not where they are typed

- **Context.** `PASSWORD_MIN_LENGTH` was checked only in `useTms.createCredential()`, a React
  hook. `execute()` stored whatever `command.credential` contained: a one-character password
  was accepted and signed in, and an empty hash/salt permanently locked an account out.
- **Decision.** `validateCredential()` rejects anything `hashPassword()` could not have produced
  (64 hex digest, 32 hex salt) at `setup_administrator`, `create_user` and
  `reset_user_password`; the length rule moves into `hashPassword()` itself; PBKDF2 rises from
  120,000 to 600,000 iterations.
- **Why.** The service layer is the boundary that will move to the server unchanged. A rule that
  only exists in the UI is not a rule (integrity rules 1 and 5).
- **Rejected.** Passing the plaintext password into the service layer so it can check length and
  breach lists: that would widen what the command layer handles and leak into the audit surface.
  Strength checks belong at the future API edge, where the password arrives once.
- **Limits.** A caller inside the app can still hash a weak password; only shape is enforced here.

## D-44 (Phase 12) An imported backup is untrusted input

- **Context.** `migrate()` checked a schema version, five arrays and that `settings` was an
  object, then cast the rest. `import_backup` replaces the entire database, so a crafted file
  could inject an unknown role — which made `can()` throw and white-screen the app — plus wrong
  types, duplicate ids and empty credentials.
- **Decision.** New `src/tms/backupGuard.ts` validates the records the application later trusts
  (ids, roles against `ROLES`, credential shape, driver/client link invariants, duplicates,
  collection ceilings) and returns a problem list that is shown to the operator. `can()` fails
  closed on an unknown role.
- **Why.** Import is the only path where untrusted data enters a system whose whole premise is
  that its data is trustworthy.
- **Rejected.** Trusting `migrate()` because backups "come from us": the brief treats import as
  a feature for existing data (MIG-01), which means files from elsewhere.

## D-45 (Phase 12) The audit log has a ceiling, and data egress is audited

- **Context.** Every command prepended an audit entry, and `commit()` rewrote the entire database
  to `localStorage` on each write. Measured: 20,000 entries = 4.65 MB and 15 ms per write, on a
  typical 5 MB origin quota; after that, writes fail, state advances, and the change is lost on
  reload. Backup export bypassed the service layer entirely: no permission check, no audit entry.
- **Decision.** Cap the in-browser log at 5,000 entries (`AUDIT_LIMIT`); route older entries out
  through the export. Add `record_backup_export`, which checks `backup:export` and writes the
  audit entry before the file is produced; `exportBackup()` returns `null` when refused.
- **Why.** A log that silently stops recording is worse than a bounded one that says so. The
  export is the one action that moves all personal data off the device; it must be visible.
- **Rejected.** Pruning silently (dishonest), keeping the log unbounded (data loss), moving to
  IndexedDB in this session (half of the server work, and the server is the real fix).

## D-46 (Phase 12) Pin the build toolchain forward to clear advisories

- **Decision.** `vite` 7.3.7, `vite-plugin-singlefile` 2.3.4, `vitest` 5.0.5,
  `@vitest/coverage-v8` 5.0.5, all exact. `npm audit` goes from 2 critical + 4 high to 1 low
  (an esbuild dev-server advisory, Windows only).
- **Why.** The advisories (tinypool prototype-pollution → RCE, `@vitest/mocker` path traversal,
  vite `server.fs.deny` bypass) execute in CI and on every developer machine, and the old CI
  gate ran `npm audit --omit=dev`, so it could never see them.
- **Trade-off.** Vitest 5 reports coverage on an all-files basis, so the ratchet is set at
  70/62/66/74 rather than the 80/72/70/80 it would be on the old basis. Raise it as the
  untested screens (`Users`, `Registers`) gain tests.
- **Rejected.** Staying on vitest 3 (keeps two critical advisories), or jumping to vite 8 in the
  same change (extra migration risk for no security gain).

## D-47 (Phase 12) A Content Security Policy for a single-file bundle

- **Decision.** Ship a `Content-Security-Policy` meta tag: `default-src 'none'`, inline script
  and style allowed (the bundle is one HTML file), fonts limited to the two Google hosts,
  `connect-src 'none'`, `base-uri`/`form-action` `'none'`. Add `referrerpolicy="no-referrer"`
  to the stylesheet link.
- **Why.** The page handles personal data and previously had no policy at all, so any injected
  markup could load anything.
- **Limits, stated plainly.** `'unsafe-inline'` is weaker than a hash; `frame-ancestors` is
  ignored in a meta tag and must be sent as a header by the host, together with HSTS. The
  Google Fonts request remains a third-party call from an application that otherwise makes none;
  self-hosting the three families is the follow-up.

## D-48 (Phase 12) The audit harness is not part of the product suite

- **Context.** `audit/probes/audit-probe.test.ts` was written to reproduce audit findings and
  contains a deliberate latency benchmark that takes about 28 seconds. Committed at the root, it
  would run under `npm test` and fail on the default 5-second timeout.
- **Decision.** Exclude `audit/**` in `vitest.config.ts`; keep the prose and the file for
  reproduction (`artifacts/` evidence stays in `audit/`).
- **Why.** A product gate must be fast and deterministic; evidence code must remain runnable on
  demand. Mixing them makes both worse.

## D-49 (Phase 13) Security headers are sent by the server, not by a meta tag

- **Decision.** `next.config.ts` sets `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy:
  no-referrer`, a narrow `Permissions-Policy` and a CSP with `frame-ancestors 'none'`, on every
  route. The single-file build's meta tag is gone with the build itself.
- **Why.** A meta tag cannot set `frame-ancestors` or HSTS at all, and the previous build relied
  on a static host to supply the rest. Now the application owns its own headers.
- **Limits, stated plainly.** `script-src` still needs `'unsafe-inline'` because Next injects its
  bootstrap inline; moving to a nonce requires middleware and is the recorded follow-up. HSTS
  belongs at the TLS terminator (§5 of the run guide) and is not set by the app.

## D-50 (Phase 13) Kysely and hand-written SQL instead of Prisma

- **Context.** The brief names Prisma. Prisma downloads a platform query engine at install time
  (`binaries.prisma.sh`); in the environment where this application was built that download is
  blocked, so `prisma generate` cannot run, which means nothing Prisma-based could be *verified*
  here — only written and hoped for.
- **Decision.** Use `kysely` + `pg`: typed SQL with no engine binary, no code generation, and a
  schema written by hand in `db/migrations/*.sql`. Constraints the brief specifically wants
  (exclusion constraint, partial unique indexes, triggers) are SQL anyway, so the migrations were
  always going to be plain SQL (the brief says so too).
- **Storage shape.** Each entity is stored whole in `data jsonb` **and** projected into typed
  columns (`status`, foreign keys, dates, `numeric(14,2)` money, unique keys) written from the same
  object in the same statement. Constraints, indexes and reports therefore see real columns, while
  the domain layer keeps its immutable-snapshot model. Child tables for quote lines, trip stops and
  boardings are deferred: they are read through their parent, never queried alone.
- **Trade-off.** No Prisma Studio/migrate niceties and no generated types from the schema; types
  are declared by hand in `src/server/db.ts` and checked against the SQL by the integration suite.
- **Revisit when.** The entity graph needs independent child queries (reporting across quote
  lines, per-stop analytics) or the team grows enough to want generated client types. Migrating to
  Prisma then is a change of the repository layer only: the domain layer and every test stay put.

## D-51 (Phase 13) `iron-session` + Argon2id instead of Auth.js/Better Auth

- **Decision.** Sessions are sealed cookies managed by `iron-session` (maintained, encrypted and
  integrity-checked with the `SESSION_SECRET`, `httpOnly`, `sameSite=lax`, `secure` in production,
  8-hour lifetime). Passwords are hashed with `@node-rs/argon2` (Argon2id, m=19456, t=2, p=1 —
  OWASP's current recommendation).
- **Why not Auth.js or Better Auth.** Both are good, and both are the right answer once there are
  providers, email verification, 2FA or invitations. For a single-tenant application with one
  local password per user, they add a framework, a database schema of their own and a
  configuration surface larger than the feature needs. The brief forbids *hand-rolled* auth, not
  small maintained libraries: no cryptography, cookie format or token is written here.
- **Upgrade path kept open.** `User` has an email and an active flag; the sign-in route is one
  file. Moving to Better Auth later means replacing `src/server/session.ts` and the sign-in route,
  not the domain layer. Legacy PBKDF2 credentials from the browser build still verify and are
  re-hashed on the next password reset (there is a test for it).
- **Rejected.** A hand-written JWT: no revocation, and it is exactly the class of code the brief
  says not to write.

## D-52 (Phase 13) Server-authoritative commands; the browser is a renderer

- **Context.** The prototype ran every command in the page, so the permission matrix, own-record
  scope and audit trail were advice, not enforcement (audit C-01, H-01).
- **Decision.** The browser holds a **redacted** snapshot of the database and posts commands to
  `POST /api/commands`. The server resolves the actor from the cookie (never from the body), calls
  the same pure command layer the tests exercise, writes the difference in one transaction under
  an advisory lock, and replies with the new redacted snapshot. The API's allowed command list
  excludes `setup_administrator` (only `/api/setup`, once) and `import_backup` (server-side only).
- **Why keep the pure command layer.** 117 domain tests run in milliseconds with no database, and
  the same code now runs inside the server. The alternative — reimplementing every rule as SQL —
  would duplicate the rules and break them apart.
- **Traffic shape.** One full (redacted) snapshot per command. Acceptable for a single operator's
  ledger; pagination is the next scalability step and is recorded as a limit, not hidden.
- **Redaction is not optional.** Credentials are stripped server-side (`src/server/snapshot.ts`) so
  no client can verify, reproduce or replay a password, and an export cannot leak one.

## D-53 (Phase 13) `server-only` is not used; the boundary is enforced by lint and by layout

- **Context.** `server-only` throws when the module is loaded outside the Next bundler — including
  from CLI scripts (`db:migrate`) and from the integration tests, both of which must
  import the database layer.
- **Decision.** No `server-only` marker. Instead: server modules live under `src/server/` and
  `src/app/api/`, and ESLint forbids browser code (`src/tms/**`, `src/screens/**`, `src/ui/**`,
  `src/App.tsx`) from importing them, `kysely`, `pg` or `next/headers`. Only the route handlers and
  scripts import the server layer.
- **Trade-off.** A build-time guarantee became a lint-time one. `npm run lint` is a hard gate in CI
  and in `npm run check`, so the rule is still mechanical.

## D-56 (audit 2026-10-24) Read scope is applied on the server, in one place

- **Decision.** `src/server/visibility.ts` narrows the database to the signed-in account before it
  leaves the process, using the same `scopedView()` the portals already used. Record-bound roles
  (driver, client contact) receive their own record and what hangs off it; internal roles receive
  the working set. Credentials are removed last, so no branch can reintroduce one. The audit log is
  sent only to roles that can read it, and only the newest 500 rows, with the true count in
  `auditTotal`.
- **Why.** Authorisation stopped at the write path: the snapshots returned every row to any cookie
  (audit F-01). Client-side filtering is a display choice, not a control, because the caller already
  holds the payload.
- **Rejected.** Per-screen endpoints. Correct, and the next structural change, but it is a rewrite
  of every screen's data access; one scoping function at the boundary fixes the disclosure now.

## D-57 (audit 2026-10-24) The throttle keys on the account, and trusts a proxy only when told to

- **Decision.** Sign-in has two buckets: one per account (unforgeable) and one per address, the
  latter only when `TRUST_PROXY=1` declares a proxy. Failures are counted, successes clear the
  buckets, and only failures increment — so a mistyped first run cannot lock the installation.
- **Why.** The bucket key was `X-Forwarded-For`, a header the caller controls on a directly exposed
  server, so rotating it defeated the throttle entirely (audit F-02). Account lockout is a denial of
  service against someone who knows the address; that is the accepted trade against unlimited
  guessing, and the window is fifteen minutes.

## D-58 (audit 2026-10-24) A password reset ends existing sessions

- **Decision.** The sealed cookie carries a truncated SHA-256 of the account's Argon2 hash. Every
  request that resolves an actor compares it with the stored hash; a reset changes the hash and the
  old cookies stop matching. Cookies minted before the field existed are treated as ended.
- **Why.** A reset left up to eight hours of access in place (audit F-09), which is exactly the
  window in which a reset is usually happening.
- **Rejected.** A `sessions` table. This needs no schema change and no cleanup job; if individual
  session listing is ever wanted, that is when a table earns its keep.

## D-59 (audit 2026-10-24) Origin check, HSTS by opt-in

- **Decision.** `POST` handlers that change state refuse an `Origin` that is not one of the
  addresses the request arrived on (`PUBLIC_ORIGIN` covers a rewriting proxy). `Strict-Transport-
  Security` is sent only when `HTTPS=1`.
- **Why.** CSRF rested on a browser default rather than a server check (audit F-08); a blanket
  `includeSubDomains` on a workstation that also answers on a LAN address would lock its operator
  out of their own address (audit F-10).

## D-60 (spec check 2026-10-24) A read permission decides what leaves the server

- **Context.** Screen gates were treated as the read boundary. The snapshot endpoint sent every
  collection to every internal role, so a Finance Officer session contained the full employee
  roster with phone numbers, licence and insurance documents, every account's e-mail address and
  the audit trail — while §6 of the brief says finance "has no unrestricted access to operational
  or personal data". A client contact's payload also carried its staff's phone numbers although
  the portal says contact details are held by the account manager.
- **Decision.** `src/server/visibility.ts` maps each collection to the read permission that
  governs it (`passengers:read`, `documents:read`, `audit:read`, `users:read`, …). A collection
  whose permission the actor lacks is sent as an empty array — for internal roles too, not just
  record-bound ones. Bound roles keep the collections their portal needs and additionally have
  passenger phone numbers blanked for `client_contact`.
- **Role change.** `finance` loses `passengers:read`, `documents:read` and `audit:read`. It keeps
  rentals, clients, trips, vehicles, costs, maintenance and KPIs.
- **Trade-off.** A screen that assumed a collection was present must handle an empty one. All
  screens already render empty states, so the visible effect is a narrower app for finance, not a
  broken one.
- **Why not row-level security now.** Single-company deployment with five roles; the collection is
  the unit of access. RLS becomes worth its complexity when tenants exist (see PROGRESS).

## D-61 (spec check 2026-10-24) Dates and seats are preconditions, not warnings

- **Context.** Driving the running app showed a rental dated 2 November started on 24 October, a
  run dated 26 October started on 24 October, and 25 passengers assigned to a 22-seat Coaster.
  None of these were warnings the operator could dismiss; they were simply unchecked.
- **Decision.**
  - `start_rental` refuses before the booked date and after the scheduled return date.
  - `start_trip` refuses before the service date and more than one day after it (an overnight
    shift may finish after midnight; the following day is tolerated so a late run can still be
    recorded, and a stale one must be cancelled instead).
  - Seat capacity is checked wherever a vehicle is bound to people: `assign_rental` against the
    requested passenger count, and `assessResources` (assign, dispatch and start) against the
    route's active roster. Dispatch and start re-check, so a roster that grew after assignment is
    caught before the vehicle leaves.
- **Why the calendar day and not a timestamp.** Ghana has no daylight saving, so the UTC calendar
  day is the business day; this keeps the rule independent of the server's locale (brief 5.5).
- **Not done.** Capacity is not reserved transactionally at booking, because bookings do not exist
  yet (BKG-01..06); the check is at resource assignment, which is the only point a vehicle is
  committed today.
- **Follow-up (same day).** Those checks all run *before* a run starts, so a roster that grew after
  the vehicle left was still unchecked. `create_passenger` and `update_passenger` now refuse an
  addition that would put more active passengers on a route than the vehicle on that route's
  running trip can seat; the message names the run and the vehicle. Test:
  `busing.test.ts` "refuses a roster addition that would overflow the seats of a run already on
  the road".

## D-62 (FIN-02) An invoice is its own numbered, frozen record — not a field on the rental

- **Context.** Phase 1A had a "final invoice" as a JSON snapshot on the rental: no number, no
  status, no amount paid, no outstanding balance, and nothing preventing the same service being
  billed twice. Brief FIN-02 requires a numbered document with taxes from settings, totals, amount
  paid and outstanding balance; brief 5.4 makes an issued invoice immutable.
- **Decision.** A separate `invoice` record and table.
  - The number comes from `reference_counter`, keyed by scope and year, allocated inside the writing
    transaction (`INV-2026-0001`). The counter is stored with the data so a restored backup never
    reissues a printed number.
  - Lines are copied from the rental's completion record. The operator does not retype amounts, so
    the invoice always traces back to a priced quotation and a completion.
  - Tax lines are *snapshotted* at issue (`Invoice.taxLines`), so a later rate change cannot rewrite
    an issued document. Tax treatment is a setting with no default: until somebody states the
    company's tax position, no invoice can be issued at all.
  - A partial unique index on `billable_event` (`rental:<id>:final`) allows exactly one live invoice
    per service. A voided invoice stops blocking, so a correction is possible — with its own number,
    never by editing the old one.
  - A trigger freezes identity, dates, lines and totals, and refuses to void an invoice that has been
    paid. A second trigger refuses deletes entirely (brief 5.9).
- **Alternatives rejected.** A `status` field on the rental (no number, no duplicates rule, and the
  document would mutate); a computed view over the rental (no stable number, no independent audit).
- **Known gap.** Credit notes and adjustment records do not exist yet, so a *paid* invoice can be
  corrected only by recording the difference as a new invoice for the corrected service. Documented
  in PROGRESS rather than implied.

## D-63 (FIN-03) A payment is written once; the external reference is its idempotency key

- **Context.** The deposit taken at confirmation recorded an amount, a method and a free-text
  reference, but there was no payment record to reconcile, verify, or hold to account. Brief 5.4
  makes recorded payments immutable and 5.8 asks for idempotency keys.
- **Decision.**
  - A `payment` record points at one invoice and carries currency, method, date, external reference,
    the recording user and a log of status changes.
  - `amountPaid` and the invoice status (`issued` → `part_paid` → `paid`) are **derived** from the
    payments, never typed.
  - The same `(invoice_id, external_reference)` cannot be recorded twice: a partial unique index
    enforces it, and the command returns the existing payment's reference instead of adding a
    second row. Recording a bank slip twice (a double click, a retried sync) is therefore harmless.
  - Status only advances, recorded → verified → reconciled, in the service and by trigger. A
    backwards move is refused with the reason.
  - Overpayment is refused with the outstanding balance in the message; a payment cannot pre-date its
    invoice.
- **Alternatives rejected.** Mutable payments with an "edited" flag (destroys the audit trail);
  integer cents in the browser (the domain layer still computes in `number`, so this would only move
  the rounding problem — see the open item in PROGRESS).
- **Known gap.** There is no adjustment/credit entry yet, so a payment recorded in error stays on
  record. That is deliberate — deleting money is worse — but it means correction is currently
  "record a compensating entry as a new invoice", not a first-class adjustment.

## D-64 Releasing a vehicle is its own permission, and the releaser is recorded

- **Context.** Closing a maintenance work order is the step that puts a vehicle back into service, and
  it also flips the vehicle's status. Brief MNT-02 asks for the release decision to be attributable;
  the audit log showed who closed the order but the order itself did not say who released the vehicle.
  Anyone who could advance a work order could also sign it off.
- **Decision.**
  - `maintenance:release` is a separate permission from `maintenance:advance`. Administrator and
    operations hold both today; the split exists so a workshop account can be given advance without
    the power to declare a vehicle roadworthy.
  - Closing a work order requires `maintenance:release`, writes `releasedBy`/`releasedAt` on the
    order, and audits the change as `maintenance:release` with the releaser named in the summary.
  - The UI removes "closed" from the status list for an account without the permission and explains
    why, rather than showing a button that fails.
- **Rejected.** A sixth "technician" role for one permission: the five-role model is the owner's
  choice, and the permission split gives the same control without a role that has nothing else to do.
- **Migration.** Schema 12. Orders closed before this change keep `releasedBy: null`; the release is
  not invented for them.

## D-65 Single company, one database: multi-tenancy is a recorded gap

- **Context.** Brief 5.2 asks for tenant isolation at every layer. The product serves one transport
  operator; there is no second company, no owner decision to onboard one, and no hosted multi-tenant
  deployment.
- **Decision.** One company per installation. The read path still funnels every payload through
  `src/server/visibility.ts`, so the seam where a tenant predicate would go exists in one place.
  Building `company_id` columns, row-level security, tenant-aware indexes and a cross-tenant test
  matrix now would add cost to every query and every test for a requirement nobody has.
- **Trigger to revisit.** A second operator on the same installation, or a hosted offering.
- **Consequence.** The brief's isolation requirement is **not met**; it is met *by construction*
  (one installation, one company) rather than by enforcement, and this is recorded as an accepted gap
  rather than a finished item.

## D-66 Five roles, not ten

- **Decision.** `administrator`, `operations`, `finance`, `driver`, `client_contact`. The brief's ten
  job titles map onto these as scopes: a Dispatcher or Fleet Manager works as `operations`; a
  Corporate HR Administrator works as `operations` with `clients:*`; an Employee or Rental Customer
  is not a user account at all (they are passengers and customers, not sign-ins).
- **Exception.** Where the brief describes a real control rather than a job title, the control is
  kept: releasing a vehicle is a permission (D-64), and driver/client scope is own-record
  (`scope.ts`, `visibility.ts`).
- **Rejected.** Ten roles with near-identical permission sets, which reads as a design document
  rather than a control.

## D-67 No background worker yet; documents and services surface in-app

- **Context.** Brief 4 lists pg-boss for scheduled work: document-expiry reminders, service-due
  reminders, report emails.
- **Decision.** No queue and no scheduler. There is no SMS or email provider, account or budget, so a
  worker would have nothing to send. Expiring documents and due services are computed and surfaced
  in the application (Compliance screen, fleet readiness, dashboard).
- **Consequence.** NTF-01…03 stay unbuilt. The trigger to revisit is a provider account; the worker
  then reads the same computed lists rather than inventing a second source of truth.

## D-68 The end-to-end proof is HTTP-level, not a browser

- **Context.** Brief 12 asks for Playwright workflows. Browser binaries cannot be installed in this
  build environment and a headless browser would not exercise anything the HTTP path does not.
- **Decision.** Two proofs, both in CI:
  - `src/server/commandFlow.integration.test.ts` runs commands through the same server module the
    API route uses (`runCommand`) against real PostgreSQL: workflow C from rental request to a paid
    invoice with a reload in the middle.
  - `src/server/concurrency.integration.test.ts` proves the booking rule twice: six parallel
    `assign_rental` commands (one winner, five 409s) and two overlapping `saveDatabase` transactions
    with **no advisory lock in front of them**, where the exclusion constraint alone rejects the
    second with `23P01`. If that second case ever passes with two winners, the constraint is gone.
  - `scripts/e2e-workflow-c.ts` (`npm run e2e`, CI job `e2e`) starts the built application, signs in
    over HTTP with a real cookie, and repeats the workflow through the public endpoints, including
    the 401, 403 and validation paths and the AUTH-05 profile endpoints (39 checks, the first thirteen of them the public form and its page).
- **Consequence.** This is a **substitute**, not the brief's requirement: it proves the command,
  persistence and concurrency path, not the browser rendering or the click path. Screens are covered
  separately by jsdom tests.

## D-69 A person manages their own account; nobody else's

- **Context.** AUTH-05 asks for profile management and a login history. The obvious shortcut — one
  "Profile" panel inside Users — would have meant every role needed `users:update` to change their own
  name, which is the permission that can also change roles and deactivate people.
- **Decision.**
  - Two commands, `update_profile` and `change_own_password`, act only on the actor's own row. There
    is no id in the command or in `POST /api/profile`, so there is nothing to point at another user.
  - Login history is read from `audit_entry` (`auth:sign_in`, the account's own rows, last ten). A
    second event log would have been a second source of truth for the same fact.
  - Changing a password re-seals the current session. The cookie carries a digest of the password
    hash, so every other session for that account is invalidated by the change itself; re-signing the
    device that made the change is a convenience, not a way around it.
- **Rejected.** Letting administrators edit their own profile through `update_user` (they can, but
  that is the administrative path and is audited as such); showing sign-in history from the audit
  snapshot, which would have required the account to hold `audit:read` and so to see other people's
  entries.
- **Known gap.** No address, browser or device is recorded, and no "sign out everywhere" button exists
  yet. The screen says the first plainly; the second is unnecessary while the credential digest ends
  the other sessions.

## D-70 The public form is its own route, and it may be framed

- **Context.** WEB-01 asks for an enquiry endpoint and an embeddable form for the company's existing
  website, "creating a Submitted request and exposing no data". Every other path in this application
  is same-origin, cookie-bearing and `frame-ancestors 'none'` (D-49). A form on someone else's page
  is, by construction, the opposite of both.
- **Decision.**
  - The form is a separate route (`/enquiry`) with no session, no snapshot and no navigation into the
    application, and one endpoint (`/api/enquiry`) that returns a reference and a sentence.
  - It is not same-origin restricted. It carries no cookie, so a cross-site post has nothing to ride;
    refusing the origin would only stop the form working where it is meant to live.
  - It is the one path allowed to be framed: `next.config.ts` gives `/enquiry` `frame-ancestors *`
    and drops `X-Frame-Options` for it, while `/:path*` keeps `frame-ancestors 'none'`.
  - "Submitted" is a **draft** in the status vocabulary this application already has. A new status
    would have meant a new branch in every transition, for a record the office has not yet accepted.
  - Spam protection is three cheap layers, none of which is a third-party captcha (this deployment has
    no outbound network and no desire to send visitors' addresses to one): a honeypot field, a signed
    timestamp token that a person cannot beat but a script can, and a per-address throttle.
  - The vehicle types are the only thing published. They are what the form needs to ask a useful
    question; vehicles, prices, customers and counts are not sent.
- **Rejected.** Making the public form part of the signed-in shell (it would have exposed the app's
  client code and a session check to a stranger). Reusing `/api/commands` (it requires a cookie by
  design). A captcha service (external dependency, visitor data leaving the server, and unusable on a
  workstation with no route to the internet).
- **Consequence.** The endpoint accepts anonymous writes, so it is throttled and every submission is a
  draft that a person still has to act on. `TRUST_PROXY=1` matters here for the same reason it matters
  at sign-in: without it every visitor shares one bucket.

## D-71 Every reference comes from a counter, and a series cannot walk backwards

- **Context.** Audit defect D-03: rentals, routes, trips, incidents and work orders were numbered
  `prefix + (records.length + 1)`. Two commands at the same instant computed the same length and so
  the same number; and because length is not history, deleting or archiving a record handed its
  number to the next one. An invoice had been moved to `reference_counter` in Phase 16 (D-62); the
  rest had not.
- **Decision.** One allocator, `src/tms/references.ts`, for all seven series, plus `reference_counter`
  widened by migration `004_reference_series.sql`:
  - Number and counter are produced by the same pure function, so the counter is written in the same
    transaction as the record. `runCommand` already holds the advisory lock, so two commands cannot
    both read the same "last".
  - Continuous series (rental `RR-`, route `RT-`, trip `TR-`, incident `IN-`, work order `WO-`) are
    filed under the period `all`; money restarts each year (`INV-2026-…`, `PAY-2026-…`).
  - A missing counter is recovered from the **highest reference already present**, never from a
    count — so a database written before this migration continues its series on its next write
    rather than restarting at 1.
  - A trigger refuses any update that lowers a series. `saveDatabase` only ever raises it; an import
    of an older backup is refused with a readable message ("that backup is older than this
    installation's numbering") instead of quietly reissuing numbers.
- **Rejected.** PostgreSQL `nextval()` sequences: they are outside the transaction and cannot be part
  of the snapshot, so a restore, a test fixture or a backup import would each have to reason about
  sequence state separately — and the number series would then be the one thing the test database
  could not reproduce. A `select max(...)` on every write: correct but racy without the lock, and it
  cannot see a record that was archived out of the table.
- **Known limit.** `npm run db:restore` truncates and reloads, so it deliberately bypasses the
  no-rewind trigger: restoring an older backup *does* make numbers issued after it available again.
  That is the meaning of a restore, and it is stated in `docs/BACKUP_AND_RECOVERY.md` §4.

## D-72 Money is whole pesewas, and rounding happens once

- **Context.** Audit defect D-04. Amounts were JavaScript `number`s. `round2` corrected them in the
  domain, then PostgreSQL `numeric(14,2)` rounded the stored value again, and the two disagreed at
  half-pesewa ties: measured against exact integer half-up, GHS 15.90 at 15% produced 2.38 where a
  person writes 2.39, and 3,707 of the first million 2-decimal subtotals were a pesewa wrong at 15%
  (16,390 at a 25% deposit). The payment guard hid the error by allowing `paid + 0.001 >= total`, so
  an invoice could read *paid* while one pesewa was still owed.
- **Decision.** One module, `src/tms/money.ts`, and one rule: **work in integer minor units, round
  half-up with ties away from zero, and round once per line or percentage - never inside a sum.**
  - Amounts cross the boundary through `toMinor`/`fromMinor`; sums go through `sumAmounts`, so 100
    additions cannot drift a cent.
  - Percentages are converted to integer basis points first (`percentOfMinor`), lines are computed as
    integer thousandths of a quantity times an integer amount (`lineAmount`, `linesTotal`).
  - Text input is parsed, not coerced: `parseAmount` accepts digits and at most two decimals and
    refuses `1,000`, `1e3`, `100.005`, `-5` and non-ASCII digits. A third decimal is a field error, so
    the operator sees the refusal instead of a silent round.
  - Display and preview use the same functions, so the figure on screen cannot differ from the figure
    stored, and a KPI cannot disagree with the invoices beneath it.
- **Rejected.** A decimal library (a dependency for two operations, and `number` is exact for the
  integers this module works in up to GHS 10^9). Keeping `number` and rounding at the edges with a
  documented epsilon: that is what the code did, and it is the defect. Letting PostgreSQL's `numeric`
  be the only rounding: the comparisons that matter (`paid >= total`, deposit sufficiency) happen in
  the domain before any write, so the database never gets the chance.
- **Known limit.** Amounts above GHS 1,000,000,000 are refused rather than represented. The rounding
  rule is a business statement, not a universal one: an accounting package that rounds line tax
  *after* summing lines would disagree with this one at a tie, by one pesewa, and that difference is
  the point of stating the rule in one place.

## D-73 The fourteen open questions, answered by recommendation

- **Context.** Fourteen questions in `docs/OPEN_QUESTIONS.md` were blocking real behaviour, and each
  one was written as "nothing is assumed" — so the build stops and asks rather than inventing a rule.
  The owner has delegated the answers, with the standing right to change any of them.
- **Decision.** The answers are recorded in `docs/OPEN_QUESTIONS.md` under "Recommended answers",
  one row each, with the reason and the cost of undoing it. The shape of them:
  - **Answer by doing nothing, where the build is already right.** Boarding codes (Q-19), the odometer
    source (Q-45), renewed-quote terms (Q-46) and driver breakdown reports (Q-33) are settled by
    confirming today's behaviour, because the alternative adds a step or a provider without removing
    a loss.
  - **Answer by naming a definition, not a rate.** Fleet utilisation and cost per trip (Q-29) are
    defined from records the system already keeps, so a report can be built without a business fact
    being invented.
  - **Answer by adding a small, reversible rule.** Several client contacts (Q-38), a warning rather
    than a block for an overdue routine service (Q-43), mandatory insurance and roadworthiness before
    a vehicle may be assigned (Q-16), and a roster-change marker for the driver (Q-48).
  - **Answer by protecting the record.** Corrections to trip data are appended, never edited (D-74),
    and an in-progress run can be cancelled with a reason and, where relevant, an incident (D-75).
  - **Answer by statement outside the code.** The repository is proprietary and private (Q-49), and
    the deployment target is one office machine on the LAN (Q-01/Q-50).
- **Rejected.** Assuming an answer and building on it, which is what the question table exists to
  prevent. Also rejected: a permissive licence (it invites reuse of the owner's rules and prices),
  and blocking dispatch on a routine service before the intervals have been used for a season (it
  stops work over a mistyped odometer).
- **Consequence.** Each recommendation is a line in a document, not a fact baked into code. Behaviour
  that changes is marked **code queued** in that table and waits for acceptance; the questions closed
  by confirmation change nothing today.

## D-74 A wrong trip entry is corrected, never edited

- **Context.** Q-42. Stop times and boarding outcomes are recorded during a run, and the brief
  requires trip records to be trustworthy. Today the entries are immutable and there is no correction
  route at all, so a fat-fingered time on a completed run stays wrong, and the office's only remedy
  is a narrative note somewhere else.
- **Decision.** A correction is a new record: who, when, why, the field, the previous value and the
  new one. The original stays. Reports show the corrected value with a marker and a count, so a
  reader can see that the record was corrected and how often. Recording a correction needs
  `trips:correct`, held by operations and the administrator.
- **Rejected.** Editing in place (it destroys the answer to "who said this, and when" — the whole
  value of an operational log). Deleting and re-entering the stop (the same problem, with less
  evidence). Making corrections administrator-only from the start (the dispatcher is the person who
  notices).
- **Known limit.** Corrections are additive, so a run corrected ten times carries ten records. That
  is the intended cost: the count is shown precisely so that a repeatedly corrected run is visible
  rather than silently clean.

## D-75 Safety defects block; an overdue routine service warns

- **Context.** Q-43. Readiness reports an overdue service per vehicle, and dispatch ignores it. The
  question was whether that should be a block. Both answers are wrong alone: blocking every overdue
  service stops a bus over a mistyped odometer, and blocking nothing lets a vehicle with a known
  safety defect go out.
- **Decision.** The two cases are separated. A **safety-related defect** — an open incident of type
  `safety_concern`, or a work order carrying that flag — blocks assignment and dispatch, as it
  already does. An **overdue routine service** is shown on readiness and on the dispatch screen with
  the interval it exceeded, and does not block. A single setting, off by default, turns the second
  into a block once the intervals have been in use for a season.
- **Rejected.** Blocking on both (work stops for a data-entry slip during the period the intervals
  are being calibrated). Blocking on neither (a vehicle with a failing brake is dispatched because
  its service is merely "due"). A blanket "vehicle not ready" refusal without naming the reason: the
  dispatcher has to know which rule stopped him to fix it.
- **Consequence.** Dispatch can refuse a vehicle for two different reasons, and the message says
  which. The stricter rule is one switch, so the owner can tighten it without a code change.

### Applied in Phase 30: the switch exists

The decision above was written as a recommendation and is now the behaviour.

- **Setting.** `settings.maintenance.blockOnOverdueService`, off by default, edited in Settings under
  Service schedules. Only a stored `true` blocks: an older backup that never had the field loads as
  "warn", so restoring data cannot silently stop the fleet.
- **Warned.** Assignment, dispatch, start and rental assignment all re-run the same check. While the
  switch is off, the command still succeeds and its message carries the sentence — "Vehicle GT
  900-26 is overdue for routine service (5,000 km past the 10,000 km interval). Last service:
  2026-06-01. Settings allows this because an overdue service only warns." The vehicle list in both
  assignment forms also marks the vehicle "service overdue" before anything is chosen.
- **Blocked.** With the switch on, the same sentence is a field error, so assignment, dispatch, start
  and hire are refused. A hire is re-checked on the day it starts, like a lapsed certificate.
- **Judged as at today**, not the service date: "overdue" is a fact about the vehicle now. A run
  arranged for next week is re-checked when it is dispatched and again when it starts.
- **Safety is not a setting.** A vehicle reported with a breakdown, accident or safety concern is
  taken out of service by the incident itself, so it is not "available" and cannot be assigned at
  all. That path never consults this switch.
- **Not done.** No new permission and no override: a dispatcher cannot wave an overdue service
  through while the switch is on. Turning the switch off is an administrator's act, recorded in the
  audit log.

### Applied in Phase 25: a run stopped mid-way

Q-47 put the same question in the middle of a journey: what does operations do when a run has started
and cannot finish? The board used to refuse, leaving a run that could never be closed.

`cancel_trip` now accepts an in-progress run, and the two records are tied rather than described
twice: where an unresolved breakdown, accident or safety incident is recorded against the run or its
vehicle, the cancellation must name it, and the command refuses with that reference until it does. A
run with no such incident cancels with a reason alone.

**Rejected.** Letting the two records stand independently (the trip says "breakdown" in free text and
the incident says something else, and nobody can tell whether they are the same event). Forcing an
incident to be raised *before* cancelling (the dispatcher's priority is to close the run and release
the crew; making him file the incident first means the run stays open while he does paperwork).
Reassigning the remaining stops to another vehicle automatically: that needs spare capacity and a
decision the office makes, not one the system invents.

### D-76: a mandatory paper blocks the work, not the paperwork (Q-16)

- **Question.** Q-16 asked which documents are mandatory and when they bite. The company had been
  able to name its own document types since Phase 6 and to see them expire, but nothing stopped a
  bus going out on a certificate that had lapsed the week before.
- **Decision.** Each document type carries a company-declared flag, off by default. While a required
  paper is missing, or its latest expiry date falls before the day of the work, the vehicle or driver
  **cannot be assigned**: a rental is judged against its start date, a run against its service date,
  and starting re-checks against today. Registration, import and maintenance are untouched — a
  vehicle may be entered while its papers are still being collected.
- **Rejected.** Blocking at registration (it produces invented dates, and a vehicle bought on Friday
  could not be entered until the certificate arrived). Judging against "today" only (it passes a
  three-week hire whose insurance runs out on day four). A blanket "documents invalid" refusal
  without naming the paper (the person fixing it has to know which paper to chase). Sending a
  reminder (no mail provider; the answer kept reminders in-app).
- **Consequence.** Nothing changes for a company that ticks no switches. Ticking one turns a silent
  gap into a refusal that quotes the paper and the date, and the same sentence appears on the
  dispatch board and on the rental form.

### D-77: a client may have several contact accounts, one marked primary (Q-38)

- **Question.** Q-38 asked whether one corporate client may have more than one contact account.
  The build allowed exactly one, refused the second, and told the administrator that several were
  not supported yet.
- **Decision.** A client may have as many contact accounts as it has people who need to see that
  client's bookings, and each is its own login confined to that client. One of them is marked
  **primary** — the person the office rings first — and marking another moves the mark rather than
  creating a second. A client with no primary shows as "none marked primary" rather than implying
  that nobody is reachable.
- **Rejected.** One shared login per client (two people writing under one name defeats the audit
  log, and changing a password to remove one person locks out the other). Leaving the primary mark
  off entirely (the office then guesses, and guesses differently). A primary flag that can be set
  on a driver or internal account (it means nothing there, and the register would show a client
  contact that is not one). Deleting the mark silently when the primary account is deactivated: the
  register shows "Primary (inactive - ring someone else)" instead, so the gap is visible.
- **Consequence.** The unique index on `app_user.client_id` had to go (migration 005); the driver
  rule stays in the database as well as in the service. Nothing about scope changes for the people
  involved: each account sees exactly the one client it is linked to.

### D-78: what work is, what a cost is for, and how the money is counted (Q-34, Q-29)

- **Question.** Q-34 asked what causes of breakdown and maintenance exist; Q-29 asked for the
  definitions behind fleet utilisation and cost per trip, and for the cost categories to record.
  Both had been left as free text, which made "how much did tyres cost" unanswerable.
- **Decision.** The five incident types stay as the brief wrote them. A work order instead carries a
  **type from a company list** (agreed as Service, Repair, Tyres, Bodywork, Inspection, Other) and a
  recorded cost carries a **category from a company list** (no values assumed; empty until the
  company names them). The definitions: utilisation = committed vehicle-days ÷ available
  vehicle-days; cost per trip = recorded expenses ÷ scheduled runs completed in the period;
  cost per passenger = the same expenses ÷ riders actually boarded on those runs.
- **Rejected.** Keeping work type as free text and cleaning it up later in a spreadsheet (the report
  would be guessing which "brake pads" is "Parts"). A fixed taxonomy in code (the company names its
  own work, exactly as with document types). Seeding cost categories with invented names (fuel and
  driver pay are not recorded here, so a list would imply coverage the system does not have).
  Dividing recorded expenses by "all trips including rentals" (a rental is not a scheduled run; the
  denominator would mix two kinds of work). Printing 0 for cost per trip when nothing ran.
- **Consequence.** Renaming a work type in Settings does not rewrite historical orders; they keep the
  wording they were given, and the form shows it as a record from before the list. A company that
  never configures cost categories keeps recording costs, and the report shows one "Uncategorised"
  line instead of hiding them.

### D-79: telling the driver the roster changed, without a notification channel (Q-48)

- **Question.** Q-48 asked whether the driver should be told when operations adds, removes or moves a
  rider while the run is already under way. The build had no way to say so: the roster changed in the
  office and the driver found out at the stop, if at all.
- **Decision.** The run carries its own **roster-change marker**, written when the roster of an
  **in-progress** run changes. It records what changed, when, and who changed it, and the driver sees
  it at the top of the next stop form — the screen he is on when the roster matters — plus a line on
  the run in both the staff run list and his own portal. Nothing is pushed: no SMS, no email, no
  alert. Wording: "joined this roster at <stop>", "was taken off this roster", "moved to another
  route", "moved from <stop> to <stop>", "name corrected".
- **Rejected.** Adding an SMS provider (a monthly bill and a second system to keep alive, for a
  message the driver reads seconds later in the app he must open to record the stop anyway). Marking
  **planned** runs (their roster is the roster they start with — a marker would warn about a change
  that never happened to anyone). Marking **completed** runs (nobody is left to warn; the record of
  the change is still there, so history still explains itself). A marker that names the rider's phone
  number or employee reference (the driver needs the name at the door, not personal data on a screen
  the vehicle's passengers can see).
- **Consequence.** A rider moved from one route to another leaves a marker on each route's running
  trip, because two drivers are affected. The markers are append-only, so a shift supervisor reading a
  finished run can still see why the door count differs from the roster that was published the night
  before. `Trip.rosterChanges` is embedded on the trip (ERD), and no table was added.

## D-81 A roster is imported by name, and a possible duplicate person is shown, not blocked

- **Context.** EMP-02, the last import the brief asks for. Vehicles, drivers and clients already had a
  CSV importer; a roster had none, and typing sixty employees one at a time is the slowest, most
  error-prone job in the office. A roster row is different from a master-data row: it refers to three
  other records (client, route, pickup stop) that no human should be typing as identifiers.
- **Decision.** The roster importer reuses the existing preview-then-save machinery, and resolves the
  **client, route and stop by name** (the route also by its reference, because route names repeat
  across clients less than they repeat across a spreadsheet). Each row is then written through the
  ordinary `create_passenger` command, so capacity, duplicate-reference and mid-run rules are the
  same as the form. A row whose client, route or stop cannot be found is rejected with the names that
  do exist listed, in the same way an unknown vehicle category behaves.
- **Rejected.** Requiring ids or references in the file (an office manager would be transcribing
  uuid-shaped strings from a screen — the error rate goes up, not down). Matching on employee
  reference alone (many companies do not issue one to cleaners or contractors). Silently merging a
  row that looks like an existing person (a name is not an identity: two Ama Boatengs are two
  people). Refusing such a row outright (same reason, opposite error: the real namesake cannot be
  hired).
- **Consequence.** A likely duplicate — same name, different employee reference — imports and is
  marked **Check**, with both references named in the preview and a count in the import message. The
  operator decides. Route and stop must be given together: a rider may be imported with no route (a
  roster is often typed before the runs exist) but not onto a route with nowhere to be picked up.

## D-82 A run can exist outside the schedule, and it has to say why

- **Context.** DSP-03. Until now a trip existed only because a route generated one, and the database
  enforced "one trip per route per service date" with a unique index. That is right for generation and
  wrong in two real cases: a bus that will not start at 05:30 leaves a cancelled run and sixty people
  with no way to work, and a one-off movement (a Saturday shift, an extra run for a meeting) has no
  day in the schedule to live on. The office's only workaround was to fake a route, which corrupts the
  register.
- **Decision.** A dispatcher with `trips:dispatch` can create a run **outside the schedule**: any date
  from today onward, a route, and a **written reason**. It gets its own TR number, sits on the run
  sheet like any other run, and is marked "ad hoc" with its reason beside it. The database rule is
  **narrowed, not deleted** (migration 006): a partial unique index keeps *scheduled* runs to one per
  route per date, so an emergency run can stand next to the day's scheduled run — which is exactly the
  replacement case.
- **Rejected.** Dropping the unique index outright (two runs generated for the same route and day is
  the bug it was written for, and generation would stop being idempotent). Allowing a replacement only
  by editing the cancelled run's date or route (it rewrites history: the cancelled run never happened
  on another day). Requiring a vehicle and driver up front (in a breakdown the only free bus is often
  still out; a run that exists unassigned can be filled in ten minutes). Allowing yesterday (a run for
  a date that has passed is a retrospective claim; the honest record for work already done is a
  correction to the run that happened). Two ad hoc runs for the same route and date (a second press
  of the button, or two dispatchers on the same problem, would produce two sets of driver
  instructions).
- **Consequence.** The same checks run whether a run was generated or created by hand: vehicle
  category, seats against the roster, mandatory papers, licence expiry, time overlaps and rental
  clashes. A route's normal generation is unaffected by an ad hoc run on the same date — the schedule
  is the schedule. The reason is in the run, in the audit entry (`trips:adhoc`) and on the run sheet.

## D-83 A booking is one named seat on one run — not a second roster

- **Context.** BKG-01…06. The standing roster was the only way onto a bus: a passenger record on a
  route travels every day the route operates. That is right for staff who commute, and wrong for
  everybody else the office actually carries — an interview candidate, a new hire whose roster entry
  has not been typed yet, somebody visiting from another site for a week. The only workarounds were to
  add the visitor to the roster (where they stayed, and kept taking a seat after the visit ended) or to
  write the name on the driver's paper manifest, where nothing counted it. The brief asks for a
  booking entity with a reference, a status workflow, a capacity check and a history.
- **Decision.** A **booking** is one named rider's seat on one named run. The roster stays exactly as
  it is; a booking sits beside it, and the two are counted **together** against the vehicle's seats
  (roster + confirmed/offered bookings), so a booking can never push a run over capacity. A rider who
  is already on that route's roster is **refused** — the roster is already their seat, and booking one
  would count them twice. A booking carries its own continuous reference (`BK-0001`, `BK-0002`…), a
  status (`requested → confirmed | rejected | waitlisted`, and `waitlisted → offered → confirmed |
  cancelled`), and its own history of who changed it, when and why.
- **Nothing is confirmed by the system.** A request is a request. Confirming it on a full run does not
  fail hard — the seat goes to the **waiting list** instead. Cancelling a held seat **offers** it to
  the oldest waiter and stops there: an automatic confirmation would promise a seat to somebody who
  may have long stopped waiting, and nobody would find out until the bus left without them. There is
  no expiry timer either; an offer stays an offer until a person confirms, refuses or cancels it, and
  the screen says "nobody is confirmed yet".
- **Cut-offs are settings with no default.** Both cut-offs are whole minutes before the run's first
  stop departs (`settings.booking.requestCutoffMinutes`, `cancellationCutoffMinutes`), **blank by
  default**. A deadline nobody chose would refuse real bookings for a reason the office could not
  explain; once management sets one, the refusal names the number of minutes.
- **Recurring is one booking per run, not one booking with a repeat rule.** A recurring request books
  the same rider on each operating day, at most 62 days, and reports the dates it could not take
  (nothing scheduled, already booked, full, inside the cut-off) in the message and the `skipped` list
  rather than failing the whole request. A dead-simple `seriesId` marks the group so the office can see
  they belong together.
- **Rejected.** Making a booking a roster row with a date range (it outlives the visit, and every
  roster query would need to know about dates). Auto-confirming a freed seat (see above). Expiring an
  offer on a timer (an offer that quietly disappears is worse than one that waits for an answer).
  Counting capacity from seats alone (the roster already holds seats, and ignoring it would overbook
  every run). Refusing a booking on a full run instead of waitlisting it (the request is information;
  losing it loses the passenger). Inventing a default cut-off. Refusing a rider from another client
  for the office (a visitor from a sister company is a real case) — but a client's own contact may
  only book its own company's riders.
- **Consequence.** Permissions: operations holds `bookings:read|create|manage`; a client contact holds
  `bookings:read|create` for its own company's people and may cancel its own bookings, but may not
  confirm (capacity is the office's judgement); finance and drivers hold none. Every change writes an
  audit entry (`bookings:create`, `confirm`, `waitlist`, `reject`, `cancel`) and a line in the
  booking's own history. Migration `007_bookings.sql` stores the booking with a **partial unique index**
  on `(trip_id, passenger_id)` for live statuses only, so a rider who was refused or cancelled can ask
  again while a duplicate live seat is impossible.

## D-84 Finance gets a money home of its own, and margin is withheld until it can be trusted

- **Context.** FIN-07. Until now a finance officer signed in and landed on the operations dashboard:
  today's runs, the fleet's readiness, rosters. The money was two clicks away inside Reports, mixed
  in with rentals and utilisation. The brief asks for a finance dashboard whose totals reconcile to
  the transaction records, and says margin may be shown "only when cost and revenue data are
  sufficient" — a condition nobody had written down, so nobody could satisfy it.
- **Decision.** A **Finance** destination, and it is where a finance account lands. It shows, for a
  chosen period: invoiced, received, costs recorded, margin, the per-customer revenue table and the
  per-category spend table; and, measured **as at today rather than inside the period**: what is
  overdue, which completed hires have no invoice, and which recorded payments still need verifying or
  reconciling.
  - **One set of books.** The period figures are `financialReport(db, from, to)` — the exact function
    behind the Reports screen and its CSV (Q-29, D-78). The finance home adds no figure of its own, so
    the two screens cannot disagree.
  - **Open work is not a period figure.** A late invoice, an unbilled hire and a payment still to
    verify are things to do now. Filtering the period back to last month must not make them vanish, so
    they are dated as at today and say so on the screen.
  - **Margin has a written rule.** It is shown only when the currency is set, at least one invoice was
    issued in the period, at least one cost line was recorded, and **no hire completed in the period
    is still unbilled** (an unbilled hire is revenue not yet written down, which would overstate the
    margin). Otherwise the screen names the missing ingredient instead of the number. Margin is
    `invoiced − expenses` with its percentage of revenue, and is labelled as not being profit: tax
    owed, deposits held and fuel are not in it. Cash movement (payments in minus spend) is shown
    beside it, because cash and margin are different questions and blending them is how a business
    talks itself into a bad month.
- **Rejected.** A second calculation of the money figures just for this screen (two implementations of
  one definition is how a dashboard and its report end up disagreeing). Showing margin always, with a
  footnote (a number on a screen is read as a fact; a footnote under it is not). Calling cash movement
  "profit" (it is not: an unpaid invoice earns nothing yet, and a deposit is not income). Gating the
  screen on `kpis:read` (operations holds it and may read no invoices at all — the gate is
  `invoices:read`, and the server sends no invoice rows to a role without it). Making the overdue list
  part of the period (see above).
- **Consequence.** New route `finance` (nav "Finance", under Service desk, icon a coin) and
  `src/screens/FinanceHome.tsx` reading `src/tms/financeHome.ts`, which is tested on its own (15
  domain tests, 5 screen tests). A finance account opens there instead of the operations board; every
  other role keeps the operations board and can reach the finance home only if it may read invoices
  (administrator). Amounts are withheld, in words, when the company currency is not set.

## D-85 A booked seat is a person on the manifest, and a run's list of people is fixed once it leaves

- **Context.** D-83 gave the office seat-level bookings, but nothing downstream knew about them. The
  run's manifest was built from the route roster alone, so a visitor holding a confirmed seat was not
  on the list the office records boardings against, was not on the driver's list, and never appeared
  in a completion. The consequence was quiet and bad: an office could sell a seat, the driver could
  leave without the person, and the system would report a complete run with nobody missing.
- **Decision.** The **manifest** of a run is the route's active roster **plus** every booking on that
  run that still holds a seat (confirmed or offered). Each entry is marked as a roster rider or a
  booked seat, with the booking's reference and the stop where they get on — the booking's stop when it
  names one on this route, and the first stop otherwise, because a name with nowhere to be collected is
  not a manifest. Everything downstream now reads that one list:
  - **Progressive stop records** expect an outcome for everyone due at that stop, roster and bookings
    alike; the screen says "Boarded / Did not board" for a booked visitor with the seat reference beside
    the name.
  - **Full completion** requires an outcome for every rider expected on the run.
  - **Corrections** can already address any recorded outcome, so a booked rider's outcome is correctable
    on the same audited path.
  - **Capacity** at assign, dispatch and start counts roster + sold seats, and a rider added to a roster
    while a run is under way is measured against the same total. Reassigning to a smaller bus can no
    longer strand somebody whose seat was already promised.
  - **The driver's snapshot** carries the seats sold on their own runs, plus the name and pickup stop of
    each rider holding one — and nothing else about them.
- **A run under way takes no new seats.** A booking (or a confirmation) is refused once the run is
  `in_progress`, because a rider added after the bus left is a name nobody was told to collect. The
  list of people is therefore fixed for the life of the run, which is what makes "every rider has an
  outcome" a rule the office can actually satisfy.
- **Rejected.** Keeping the roster-only manifest and recording booked visitors nowhere (the seat is
  sold; not recording whether they travelled is the failure this fixes). Building the manifest from
  *requested* bookings as well (a request holds no seat and may be refused; the driver would hunt for
  people who were never promised a place). Adding a second "booked riders" list beside the roster
  (two lists to reconcile, and the driver's screen is the one place they must agree). Requiring an
  outcome count exactly equal to the manifest (a rider cancelled or removed after a stop was recorded
  would then block completion forever; the rule is that every *expected* rider is accounted for, and a
  record already made stays). Hiding booked riders from the driver to protect personal data (the driver
  is carrying them; the payload carries the same fields the roster already does and no more).
- **Consequence.** `manifestFor` / `manifestAtStop` in `src/tms/bookings.ts`; `record_trip_stop`,
  `complete_trip`, `assessResources` and a mid-run roster change all read it; the stop and completion
  panels list booked riders with their seat reference; a driver holds `bookings:read` (own runs).
  A leak found while doing this is fixed: the narrowed snapshot for a record-bound account listed every
  collection it *was* allowed to see, and `bookings` — added after that whitelist was written — fell
  through to the whole table. A client contact or driver was being sent every booking in the company.
  The snapshot now narrows bookings with the rest, and three tests pin it.

## D-86 A credit note is how money comes off an invoice, and a refund is said out loud

- **Context.** An issued invoice is immutable and a payment is immutable; together those two rules left
  the office with no lawful way to handle the most ordinary financial correction there is. An invoice
  could be voided only while nothing had been paid for it. Once any money was on it — which is the
  normal case by the time anyone notices a wrong amount — the only answers the system had were "do
  nothing" and "record a payment that never happened". The gap was worst for the case that actually
  happens: a hire was partly not delivered, the customer was overcharged, or a goodwill discount was
  agreed after the document went out.
- **Decision.** A **credit note** is a numbered document of its own (`CN-2026-0001`), raised against
  exactly one invoice, taking money off what that invoice asks for.
  - It carries its own date, its own line (what the credit is for, printed on the document), its own
    reason (why the office decided to give the money back, kept for the record) and its own tax lines,
    **taken from the invoice's snapshot** rather than today's settings: a credit must reverse the tax
    that was actually charged, or the two documents do not cancel.
  - It is **immutable once issued** and never deleted: a wrong credit note is voided with a reason and
    the next number is issued. The database enforces both, by trigger, exactly as it does for invoices.
  - An invoice that has been credited **can no longer be voided** (service and trigger): voiding it
    would leave a live credit note against a document the reports treat as never having counted. Void
    the credit note first if the credit itself was the mistake.
  - It **never moves money**. Payments already recorded stay exactly as they were, because they are
    facts about money that arrived. What changes is what the invoice asks for.
  - The balance rule is written once, in `src/tms/creditNotes.ts`:
    `outstanding = total − paid − credited`, floored at zero. Every reader — the invoice screen, the
    finance report, the rentals report, the finance home — calls that one function, so a screen, a
    statement and a tile cannot disagree about the same invoice.
  - A credit may be issued up to the **invoice's own total** (less what has already been credited). It
    is *not* capped at what is still unpaid, because a service cancelled after payment is a normal
    thing and the honest answer there is a refund: when `paid + credited > total` the difference is
    stated as **a refund due** on the invoice, in the list and in the invoice's own notice. It is never
    netted quietly into a zero balance.
  - An invoice's **status** continues to describe money received (`issued`, `part_paid`, `paid`,
    `void`). Whether the bill is closed is the balance's answer: a fully credited invoice shows
    **Settled by credit** beside a status that honestly still says how much cash arrived.
- **Rejected.** Editing an invoice in place (destroys the document a customer holds and defeats every
  immutability trigger built so far). Deleting a payment and re-entering a smaller one (the money
  arrived; deleting the receipt is the one thing an audit trail must never allow). Allowing a void once
  money is on the invoice (a void says "this document never counted"; a part credit says "everything
  except this counted", and the two are different facts). Netting a refund into a zero balance
  (the office would owe money it has no record of owing). Capping credits at the unpaid balance
  (it would forbid correcting an invoice that was already paid, which is the case that needs it most).
  Recording a refund as a negative payment (payments are money in, with a method and a bank slip; a
  refund is money out and would corrupt every "received" total in sight). A free-text adjustment field
  on the invoice (an adjustment with no number, no date and no document is exactly what an accountant
  cannot reconcile).
- **Consequence.** Migration `008_credit_notes.sql` (`credit_note` table, the ceiling trigger
  `credit_note_within_invoice` under a row lock on the invoice, the frozen/no-delete triggers, and the
  widened `reference_counter` scope); `CreditNote`/`CreditNoteLine` in `src/tms/types.ts` (schema 15);
  the `creditNote` reference series (`CN`, per year, `src/tms/references.ts`);
  `src/tms/creditNotes.ts` for the arithmetic; `issue_credit_note` / `void_credit_note` in
  `src/tms/finance.ts` behind `credits:issue` / `credits:void` (finance and administrator); the
  Invoices screen gains a **Credit the invoice** action, a credit-note table on the invoice, a
  "Credited" figure beside Received, the refund notice, and a **Credited** column and tile;
  `financialReport` and `rentalReport` report `creditedTotal` / `creditNoteCount` and net every
  balance of them; the finance home's margin is measured on revenue after credits. Full refunds are
  not a separate record: the refund is stated, and paying it out is an ordinary expense until a cash
  book exists.

## D-87 A document is printed by the browser, not generated by a PDF service

- **Context.** Invoices and credit notes existed only on screen. An office that cannot hand a customer
  a copy has not finished the job: a customer wants the paper (or the file) for their own records, and
  "take a screenshot" is not a document. Generating PDFs had been recorded as Phase 3 work with the
  payment integrations, which left the most ordinary request in the money story — "can I have a copy?"
  — with no answer at all.
- **Decision.** An invoice and a credit note are **printable sheets**, previewed inside the application
  and printed by the browser's own print engine, with "Save as PDF" offered by that same dialog.
  - No new dependency and no server-side rendering step: the browser knows the page size, the margins
    and how to write a file, and it is the only engine already on the machine.
  - The sheet is built from the same snapshot the screen uses, and its **amount due comes from the
    shared balance helper** (`creditNotes.ts`, D-86). A printed total is never its own arithmetic.
  - The preview sits in a portal attached to `document.body`, and the print stylesheet removes the
    body's other children. That is what keeps the navigation, the buttons and the rest of the
    application off the paper — and prevents the trailing blank pages a hidden shell produces.
  - The document states: the supplier name (or that it is missing), the document type and number, its
    status in words, the customer, the dates, the hire reference, each line with quantity and unit
    price, the subtotal, each tax line at the rate that was charged, the total, money received, money
    credited, and either **the amount due** or **the refund due to the customer**. A credit note names
    the invoice it corrects and the reason it was given.
  - A void document says so in words at the top, before any figure, and asks for nothing.
  - Nothing is invented. A company name that is not set prints as "Company name not set in Settings",
    and the preview (which is not printed) says where to set it.
  - While the preview is open the document's name is the page title, because that is the file name the
    browser offers when saving as a PDF.
- **Rejected.** A PDF library (a dependency, a second layout engine, a font pipeline and a binary that
  goes stale, all to draw a table the browser draws for free on paper). A server route that renders
  HTML to PDF (needs a headless browser installed and kept patched on the host, for the same result).
  Printing the application screen as it stands (navigation, buttons, toolbars and sometimes the next
  screen underneath, on a document a customer keeps). A "download .html" copy (opens differently in
  every mail client, and a customer cannot tell whether they have the real thing). Emailing the
  document (no mail provider, and an email that claims to attach a legal document had better be one).
  A stored, numbered PDF copy per document (a second source of truth for the same figures; the sheet
  is generated from the record every time and can never be stale).
- **Consequence.** `src/screens/Documents.tsx` (`PrintPreview`, `InvoiceSheet`, `CreditNoteSheet`); the
  sheet and print styles at the end of `src/index.css`; `src/ui/useDialogFocus.ts`, extracted from
  `Panel` so the preview keeps the same keyboard behaviour (focus in, Tab trapped, Escape, focus
  restored) instead of a second implementation of it; **Print invoice** on the invoice page and
  **Print** on each credit note; 10 component tests (`Documents.test.tsx`) and 2 screen tests. What is
  still absent is delivery: nothing is emailed and no copy is stored.

## D-88 A payment recorded in error is cancelled, not deleted and not edited

- **Context.** Money is recorded once. A payment's amount, date, method and external reference are
  frozen by trigger (migration 003), and the invoice's `amount_paid` is derived from its payments.
  That is right for a payment that happened. It left no lawful way out of the ordinary mistake: the
  operator keyed the amount against the wrong invoice, or recorded a transfer that was later reversed.
  The invoice then asked for money the office never received, the fee reports counted it as income, and
  the only fix was a hand-written row in the database — invisible to the audit trail, and impossible
  for the office to do at all.
- **Decision.** A payment can be **cancelled** once, with a reason and a timestamp.
  - Cancelling is **not a fourth value of the verification status**. The status answers "how far has
    this been checked?"; a cancelled payment has not stopped being verified, it has stopped being true.
    Keeping them apart means a verification step can never be mistaken for a cancellation, and a
    cancelled payment cannot be un-cancelled by advancing it.
  - It is a **one-way door**, enforced by the database trigger as well as the service: a cancelled
    payment that could be un-cancelled would quietly restore money the office had decided it never
    received, and the next report would show it with no trace of the reversal.
  - The **reason is required and kept on the record**. A year later it is the only thing that explains
    why a payment still on the page is not in the total.
  - The invoice's `amount_paid` and status are **recomputed from the payments that still count**, by one
    helper (`withPaymentsToDate` in `src/tms/finance.ts`) that the record path also uses — so recording
    and cancelling cannot disagree about the same two fields.
  - One exclusion rule, in one place (`isLivePayment` / `livePayments` in `src/tms/creditNotes.ts`),
    feeds every reader: the invoice screen, the printed sheet, both money reports and the finance home.
  - A **reconciled** payment may still be cancelled — otherwise one mis-click on "Reconcile" would lock
    the figure for good — but the panel and the confirmation say what it does to the reconciliation
    before it happens, rather than refusing and leaving the operator stuck.
  - Cancelling is not a refund. A payment that was real and is being given back is a credit note
    (D-86) with a refund stated; cancelling says the money was never received.
- **Rejected.** Deleting the payment (the audit trail would lose the fact that money was ever recorded,
  and the number would be reused). Editing the amount in place (there is then no record of what was
  originally entered, which is exactly what a reconciliation needs). A `void` status value (it makes
  "verify" and "cancel" the same axis, and lets a cancellation be produced without a reason by any code
  path that advances a status). A negative "reversal" payment (it would corrupt every "received" total
  and imply cash left the business, which is a refund, not a correction). Refusing cancellation of a
  reconciled payment outright (no escape hatch after a mis-click).
- **Consequence.** Migration `009_payment_cancellations.sql` (`void_reason`, `voided_at`, the paired
  check constraint, and `payment_frozen()` rewritten so the two columns move once and the financial
  fields stay frozen); `Payment.voidReason` / `voidedAt` (schema 16); `void_payment` in
  `src/tms/finance.ts` behind a new `payments:void` permission (finance and administrator);
  `isLivePayment` / `livePayments` in `src/tms/creditNotes.ts`; `void_invoice` now blocked only by
  payments that still count; `financialReport`, `rentalReport` and `financeHome` ignore cancelled
  payments; the invoice screen gains a **Cancel** action per payment, a "Cancelled" badge, a
  struck-through amount, the reason listed under the table and a "1 payment counting of 2 recorded"
  caption. The payment keeps its number and its place in the list.

## D-89 The list of accepted commands is a module a test can compare against

- **Context.** The API route decided which command names it would accept from a hand-maintained list
  beside its permission table. Three commands were missing from it: `issue_credit_note` and
  `void_credit_note` (Phase 36) and `create_adhoc_trip` (Phase 18). The service understood all three,
  the screens offered buttons for all three, and the server answered **"Unknown command"** — so issuing
  a credit note and adding an extra run could not be done in the deployed application at all, and no
  test noticed, because the tests call the service directly rather than through the route.
- **Decision.** The list moves to `src/tms/commandTypes.ts`, where it can be imported by a test, and is
  held to the modules in two ways:
  - the **compiler** checks it against the core `Command` union (`CoreCommandsAreAllListed`), with the
    five commands that have their own routes named explicitly (`setup_administrator`, `import_backup`,
    `update_profile`, `change_own_password`, `submit_enquiry`);
  - a **test** compares it against every module's exported command array (bookings, busing, compliance,
    finance, logistics, maintenance), refuses duplicates, and names the three commands that had been
    lost so they cannot be lost again quietly.
- **Rejected.** Testing the route handler end to end (it needs a session, a database and a running
  Next server — the guard should fail in a second, in the ordinary unit run). Trusting a review
  checklist (this is precisely what a checklist already missed three times). Accepting any command name
  and letting the service refuse it (the route's list is what keeps `setup_administrator` and
  `import_backup` off the browser-reachable endpoint).
- **Consequence.** `src/tms/commandTypes.ts`; `src/tms/commandTypes.test.ts` (10 tests); the route
  imports the list instead of declaring it; `void_payment` added to both the list and the permission
  table. Also found on the way: bumping the schema to 16 for D-88 made the application refuse **its own
  backup**, because the readable-versions list inside `migrate()` is maintained by hand and still ended
  at 15. The round-trip test caught it within the same run. That list is now exported as
  `READABLE_SCHEMA_VERSIONS`, the rejection message is generated from it rather than written out, and a
  test pins it to `SCHEMA_VERSION`, so the next bump cannot pass unnoticed.

## D-90 A statement of account is a document, and its arithmetic is the balance rule

- **Context.** Every money screen answered "what is this document?" — one invoice, its payments, its
  credit notes. Nothing answered the question the office asks whenever it chases a debt: *what does
  this customer owe us, what has moved on their account, and how old is the money?* The finance report
  totals a **period across all customers**, which is a different question: it cannot tell an operator
  that one customer is 90 days late on an invoice the report has already summed into a healthy month.
  The consequence was practical — statements were being written out by hand from the invoice screen.
- **Decision.** A **statement of account** per customer: one screen, one printable sheet, for a period
  the operator chooses.
  - **One customer, all their documents.** The statement is keyed by the name that appears on the
    invoice (`customerName`), because that is the only key invoices, payments and credit notes share.
    The invoice's customer name, not the client register, is what the customer recognises.
  - **The opening balance is real.** It is the account as at the day before the period starts, so a
    statement for one month still carries the arrears it inherited. Payments and credit notes are
    filed by **their own dates**, never by the invoice they belong to.
  - **The arithmetic is the shared balance rule.** `customerStatement()` calls `invoiceBalance` (D-86)
    and `livePayments` (D-88); the screen and the sheet only format what it returns. The test that
    guards this computes the closing balance a second way — invoice by invoice — and requires the two
    to agree.
  - **Age is stated in days and in bands** (not yet due, 1–30, 31–60, over 60), each with a sentence
    saying what it is worth doing. Colour is never the only carrier: the band is written out.
  - **An account in credit says so** rather than showing a minus sign or netting to zero.
  - **Retracted documents are absent.** A void invoice never asked for money, a void credit note took
    nothing off, and a cancelled payment never arrived (D-88) — none of them appear, and none of them
    move a balance. Stating a cancelled payment would put money on the customer's page they never sent.
  - **Refusals are explicit.** Mixed currencies are not added together; a customer with no invoice on
    or before the date is told so in a sentence; a period that runs backwards is refused.
- **Rejected.** Adding a report filter instead (a filter answers "show me June", not "tell this customer
  what they owe and since when" — and it would print across customers, which is a data-protection
  problem as well as a useless document). Sending a copy of every invoice in the period (the customer
  already has them; a statement summarises). Allocating payments across invoices first-in-first-out
  (this build records each payment **against an invoice**, so allocation is already known — inventing a
  second, positional rule would make the statement disagree with the invoice it describes). Making the
  statement a fourth money balance helper (that is the mistake D-86 exists to prevent). Sending it by
  email (no mail provider).
- **Consequence.** `src/tms/customerStatement.ts` (`customerStatement`, `statementCustomers`, the
  ageing bands); `src/screens/Statements.tsx` behind a new **Statements** destination gated by
  `invoices:read`; `StatementSheet` in `src/screens/Documents.tsx`, so the statement prints through the
  same preview, portal and print stylesheet as the invoice (D-87); the ageing block in
  `src/index.css`. 12 domain tests, 9 screen tests and 3 sheet tests. Delivery is still manual: the
  statement prints or saves as a PDF, and nothing is emailed.

## D-91 The debt is aged across the company, with one banding function and no cross-currency totals

- **Context.** The finance home listed every late invoice one by one, which answers "what do I chase
  today?". It could not answer "how bad is the debt overall?" without the reader adding a column up in
  their head — and the ageing bands already existed for a single customer's statement (D-90), so the
  figures the office would have to add by hand were figures the system already knew. Two ways of
  banding the same invoice is exactly the class of drift D-86 exists to prevent.
- **Decision.** The finance home states **debt by age**, across all customers, as at today:
  - the same four bands a statement prints, from **one exported function** (`ageBucketFor`) and one
    `invoiceBalance` call, so an invoice cannot be 60 days late here and 61 days late on a statement;
  - each invoice contributes its **outstanding** amount on the day being read, so a part-paid invoice is
    aged at what is left; a void invoice and a cancelled payment contribute nothing (D-88);
  - the bands are shown with the same explanatory sentences as on the statement ("worth a reminder",
    "worth a call"), and the customers behind them are listed with their own band totals and the age of
    their oldest debt;
  - **no total across currencies.** When the outstanding invoices are in more than one currency the
    figure is withheld and the currencies are named, because a sum of cedis and dollars is true of
    nothing;
  - the card sits above the overdue list and links straight to **Statements**, so the reader can go from
    "how bad is it" to "show this one customer" in one click.
- **Rejected.** Adding the bands to `financialReport` (that report is about a period's activity; ageing is
  about a balance at a moment, and mixing them would make "the June report" change every day as debts
  age). A separate ageing screen (a second destination for four numbers, and the finance home is where
  the money questions are asked). Colouring the oldest band red without saying its name (colour must
  never be the only carrier: the band is written out and the amount is in words beside it).
- **Consequence.** `debtAgeing()` and the exported band helpers in `src/tms/customerStatement.ts`;
  `ageing` on `FinanceHome`; the *Debt by age* card and the per-customer band table on
  `src/screens/FinanceHome.tsx`; the total row style in `src/index.css`. 5 domain tests, 1 finance-home
  test, 1 navigation test, and a boundary test on the bands themselves. The stale line "PDF statements
  are not built yet" under the coverage note is replaced: statements print from the Statements screen.

## D-92 A refund is its own numbered record, not an expense and not a negative payment

- **Context.** D-86 made the system state what it owes back: when credit notes take an invoice below
  what the customer paid, `refundDue` says so plainly on the invoice. What the system could not record
  was the day the office actually sent the money. The workaround was to book it as a recorded cost,
  which:
  - lost the customer, the invoice and the reason — a refund looked like any other expense line;
  - inflated the month's cost of running the work, which is the figure the margin is computed from;
  - left `refundDue` standing for ever, so the invoice kept saying money was owed back that had
    already been paid, and nothing stopped the same over-credit being paid out twice.
- **Decision.** A **refund** is a record of its own, the mirror of a payment:
  - numbered from its own series (`REF-YYYY-NNNN`, restarting each year like the other financial
    documents), against one invoice, with its own date, method, optional bank reference, and a
    **required reason** — the credit note says why the bill was reduced, the refund says why cash left
    the bank, and the two can legitimately differ;
  - its ceiling is what is **still** owed back: `paid + credited − total − refunded` on that invoice,
    compared in whole pesewas, with the same arithmetic the button's default amount comes from;
  - it does **not** change what the customer paid. `invoiceBalance` gains a `refunded` figure and
    `refundDue` subtracts it; `paid`, `outstanding` and the invoice's own `amountPaid` are untouched;
  - it can be cancelled once, with a reason. The number stays, the reason stays, and the amount
    becomes owed back again — a transfer that never left is a fact worth keeping.
  - it is stated where money is stated: the invoice (with a **Pay a refund** action), the customer
    statement (as a debit, because the balance is what the customer holds with the office), the
    money report (its own "Refunded" line, kept out of costs), and the finance home (its own figure
    and card, subtracted from cash movement because both leave the bank).
  - the database holds the ceiling itself: `refund_within_due()` locks the invoice, adds the live
    payments and credit notes, subtracts the live refunds, and refuses a row that exceeds what is
    left; `refund_frozen()` and `refund_no_delete()` make a recorded refund a one-way door.
- **Rejected.**
  - *A negative payment.* Every sum over `payments` — received, cash movement, the invoice's paid
    figure, the bank reconciliation — would have had to filter by sign, and one forgotten filter
    reports refunds as money received. Two facts, two tables.
  - *A recorded cost with a "refund" category.* It works today only because expenses are a dumb list;
    it puts the refund into cost per trip and into the margin's cost base, which is untrue, and it
    still leaves the customer off the record.
  - *Cancelling the credit note instead.* That reverses the decision to give the money back, and
    loses the reason the refund was paid.
  - *A fourth status on `refundDue` ("refunded").* That is a field on an invoice, not a document: it
    carries no date, no method, no reason and no number, which is precisely what the office needs a
    year later.
- **Consequence.** `Refund` (schema 17, `READABLE_SCHEMA_VERSIONS` extended), `refunds` collection,
  migration `010_refunds.sql`, `record_refund` / `void_refund` commands and `refunds:record` /
  `refunds:void` permissions, `liveRefunds` / `isLiveRefund` / `refundedTotal` in `creditNotes.ts`,
  refund rows on the statement and in the printed sheet, a "Refunded" line in the financial report and
  CSV, a "Paid back" figure and a *Money paid back* card on the finance home, the refund panel on the
  invoice screen, and 26 new tests (7 domain command, 3 balance/statement, 3 report, 3 finance home,
  3 visibility, 3 statement sheet, 3 invoice screen, plus the reference-series and boundary cases).

## D-93 An expense keeps the number on the receipt, and is voided rather than edited

- **Context.** Every cost the system held had to hang off an incident or a work order, so "costs
  recorded" quietly meant "maintenance recorded". Fuel, tolls, permits, rent, driver allowances and
  office spending — usually most of a transport month — were on paper in a drawer. A report built on
  the cost register answered "what did repairs cost?" while being read as "what did the month cost?".
- **Decision.** An **expense** is a record of money spent that is not a repair:
  - numbered from its own series (`EXP-YYYY-NNNN`, restarting each year), filed by the **day the money
    left** (`incurredOn`), with a description, who was paid, an amount and a currency;
  - a **category** comes from the list in Settings or is left blank, and blank is reported as
    "Uncategorised" rather than folded into another line. A method comes from the same payment-method
    list the rest of the money screens use, or is left blank — the register must not invent options;
  - **never edited**: a wrong entry is **voided once, with a reason**. The number, the figure and the
    reason stay on the record, so a report that used the old figure can still be explained. A voided
    expense counts in nothing;
  - the **receipt is two facts**: the number printed on the paper (`receiptReference`), and whether the
    paper is actually held (`receiptHeld`). Saying the paper is held without a number is refused, in
    the service and by a table check, and the report states how many expenses have no number at all.
  - **no currency set means no expense**: the company currency is required, exactly as it is for an
    invoice, because an amount with no currency cannot be added to anything.
- **Stored files are out of scope.** Only the receipt number and whether the paper is held are kept.
  Where a scanned copy would live — on disk, in an object store, whose backups, how long — is an owner
  decision, and pretending otherwise would put a file-path column in the schema that nothing honours.
- **Where it is counted.** `costReport` pushes live expenses into its `lines` with `source: "expense"`
  and reports `expenseCount`, `expenseTotal`, `expensesWithoutReceipt` and `expensesWithReceiptHeld`.
  One cost figure, used by the cost tab, the money report and the finance home, so no two screens can
  disagree about what the month cost. Refunds stay out of it (D-92): money paid back to a customer is
  not a cost of running the work.
- **Who may do it.** `expenses:read` for administrator, finance and operations (fuel and tolls are part
  of what operations' own runs cost); `expenses:record` and `expenses:void` for administrator and
  finance only. A driver and a client contact receive no expense at all — an expense names who was paid.
- **Consequence.** A new `expenses` collection (`src/tms/expenses.ts`, `expenses` in the permission
  list, the reference series, the snapshot scope and the repository), migration `011_expenses.sql` with
  `expense_frozen()` and `expense_no_delete()`, the Expenses screen, expense figures on the cost tab,
  and 24 new tests (7 domain command, 2 snapshot scope, 10 screen, 1 reference series, plus the
  cost-report cases inside the command tests).
- **One thing it exposed.** A series lives in two places: `REFERENCE_SERIES` and a check constraint on
  `reference_counter`. Adding `expense` to the first and not the second is invisible to every unit test,
  because numbering runs against the JSON snapshot — so it fails only against PostgreSQL. Writing the
  expense flow's first PostgreSQL test found that **refunds had the same fault since D-92**: every
  `record_refund` on a real database returned a 400. `012_reference_counter_scopes.sql` widens the
  constraint, and `references.integration.test.ts` now inserts a counter for **every** series, so the
  next forgotten name fails in CI instead of in front of a finance officer.
