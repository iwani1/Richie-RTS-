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

- **Decision.** One `Rental` aggregate carries the lifecycle, with `declined`/`cancelled` branches. The shape at the time of this decision was `draft -> quoted -> confirmed -> in_progress -> completed`; **D-120 superseded the names and added the stages**, so read the pipeline from `src/tms/rentalWorkflow.ts`. Transitions are a table (`RENTAL_TRANSITIONS`) enforced in the service, each guarded by a permission. Resource assignment checks vehicle category match, vehicle/driver availability, driver licence expiry vs rental end date, and **rejects assigning a vehicle or driver already booked on a confirmed/in-progress rental with overlapping dates** — the in-code equivalent of the btree_gist exclusion constraints named in Phase 0 section 5.1 (which cannot run here without PostgreSQL, D-01).
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

> **Superseded.** The owner rejected this editorial build and chose the Daylight direction
> (`docs/DESIGN.md` §2a and §4). Kept because the reason the first attempt failed is still the reason
> the shipped one works: the people using this know what a timetable and an invoice look like, and
> they want the day's exceptions first.

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

## D-94 A ceiling is measured without the row being written

- **Context.** Two ceilings are enforced by a BEFORE INSERT trigger under a row lock: a credit note
  may not take an invoice below zero (`008_credit_notes.sql`, D-86), and a refund may not pay back more
  than is owed (`010_refunds.sql`, D-92). Both were right about the arithmetic and wrong about when they
  run. Every save goes through one `insert … on conflict (id) do update` statement, and PostgreSQL fires
  BEFORE INSERT row triggers for those rows even when the row is being updated. So:
  - **cancelling a refund** was refused, because the row being cancelled still counted as paid out;
  - **voiding a credit note** was accepted only while the note was small enough for the doubled figure
    to still fit under the invoice — a fixture-dependent bug, hidden by a 1,150 credit on a 3,450
    invoice.
- **Decision.** A ceiling check does two things it did not do before: it **ignores a row that is not
  live** (a void credit note took nothing off the bill; a cancelled refund gave nothing back), and it
  **excludes the row being written** by id from the sum it compares against. `013` and `014` replace the
  two functions rather than editing `008` and `010`, because migrations are applied once and recorded —
  a change made inside an applied file never reaches the databases that already have it.
- **Consequence.** Cancelling a refund and voiding a credit note both work against a real database, and
  give the headroom back. `commandFlow.integration.test.ts` voids a credit note for the invoice's whole
  total, which is the case the old trigger refused, so the bug cannot return quietly.

## D-95 An agreement is copied from the signed paper, and nothing rewrites it afterwards

- **Context.** Brief item CLI-02 asks for corporate contracts: reference, client, dates, a status that
  includes Draft, Pending Approval, Active, Suspended, Expired and Terminated, plus the commercial
  terms — service, routes, pricing, billing frequency, payment terms, service levels. Two temptations
  come with it. The first is to *calculate* things the office has not decided: a monthly rate times a
  number of buses, an invoice schedule derived from the billing frequency, an assumed 30-day term. The
  second is to keep one record and edit it as the agreement changes, so the office can answer "what
  did we agree?" only with what the agreement says today.
- **Decision.** A contract is a **transcription** of what was signed, and it is **not rewritten once
  approved**.
  - **Transcription, not calculation.** Pricing model, billing frequency, payment terms and service
    level targets are typed from the paper as free text in the office's own words — "monthly rate per
    bus", "monthly in arrears", "30 days from invoice". Each may be left blank, and blank stays blank:
    the screen shows "Not recorded" rather than a default nobody agreed to. The client's **name is
    copied in at creation** (`clientName`) so the contract still reads correctly if the client is later
    renamed, while `clientId` continues to resolve live — the routes on the contract must still belong
    to that client.
  - **Expiry is derived, not recorded.** `contractStateOf({status, endDate}, today)` reports
    `"expired"` when an active contract's end date has passed. No nightly job marks anything; a
    suspended contract past its end date still reads suspended, because pausing for an unpaid invoice
    is a fact about now that an end date does not undo.
  - **An approved contract is frozen; a change is a new one.** `isContractEditable` is true only for
    draft and pending approval. After that the terms cannot be corrected — a new `CT-` record is
    created with `replacesId` pointing at the old one, and the old one is suspended or terminated. The
    day-to-day moves that are *not* about money stay available: `draft → pending_approval`,
    `pending_approval → active | draft`, `active → suspended | terminated`, `suspended → active |
    terminated`, and `terminated` is final. Suspending, terminating or sending back to draft requires a
    reason; approving is refused once the end date has passed, naming the date, because an agreement
    that has already ended cannot be put in force.
  - **Two live contracts cannot cover the same day for one client.** A second live contract whose dates
    overlap an existing live one is refused, naming the first (`CT-0001 already covers 2026-06-01 for
    Acme Ltd`). Two drafts may coexist — that is how a renewal is prepared before the old one lapses —
    and the overlap rule is not waived by `replacesId`: a renewal must start after the old contract
    ends.
  - **The agreement gates bookings.** A booking request for a service date is refused when the covering
    contract is not active (`CT-0001 is draft, so bookings for 2026-06-01 cannot be taken under it`) or
    when no contract covers the date but one ended before it (`CT-0001 ended on … and has not been
    renewed`). It is allowed when the client has no contract on file at all — most of the work is not
    under contract, and a gate that blocked it would stop the office operating — or when the covering
    contract was terminated. The check runs again at `confirm_booking`: a contract can be suspended
    between the request and the confirmation.
  - **Who sees it.** `contracts:read` for the office by permission; a **client contact sees its own
    client's contracts** — it is their agreement — and a driver sees none, because a driver has no
    reason to know what a client pays. `ClientPortal` carries a "Your agreement" card: service, term
    (or "open-ended"), and state.
  - **Renewal watch.** `contractsDueForRenewal(db, today)` lists live contracts ending inside
    `settings.documentReminderLeadDays`. When that setting is blank the list is **empty** and the
    screen says the window is not set, rather than warning about nothing.
- **Consequence.** New `contracts` collection (`src/tms/contracts.ts`), the `CT-` reference series
  (width 4, not per year), `contracts:read`/`create`/`update`/`advance` permissions, the snapshot scope,
  the repository rows and the `Contracts` screen with its own route and nav entry; migration
  `015_contracts.sql` with `contract_frozen()` (terms only — status still moves) and
  `contract_no_delete()`; bookings gain a contract check on request and on confirmation; commands 55
  to 58. 31 new tests (22 domain, 9 screen) plus 3 snapshot-scope cases, 2 booking cases and one
  reference-series row.

## D-96 A planning aid answers with a reason, and still lets the dispatcher choose

- **Context.** Brief item RTE-04 asks for an "explainable planning aid that considers pickup
  locations, destinations, capacity, required arrival times, durations, availability, existing
  commitments". Dispatch in this build was manual: the assign panel offered two long dropdowns and
  the office worked out the pairing in their head. Two things were wrong with that. The knowledge was
  in one person's head (which bus is free at 06:00, whose licence is about to lapse, which run already
  has a bus under maintenance), and a wrong pairing only surfaced as an error after the choice was
  made. What was *not* wrong, and must not become wrong, is who decides: dispatch is a judgement about
  a yard, a driver and a client, and a tool that assigns by itself would be taking that judgement away
  from the person answerable for it.
- **Decision.** A read-only aid, `src/tms/planning.ts`, that answers "who can take this run?" with a
  ranked list and a sentence per pair.
  - **It reads the same rule the save enforces.** It calls `assessResources` — exported from
    `busing.ts` for exactly this — for every vehicle-and-driver pair, so a suggestion it offers cannot
    then be refused, and a pair it rules out is ruled out by the code that would have refused the
    save. Two tests hold the two directions: everything offered is accepted by `assign_trip`, and
    everything refused is refused by it too.
  - **Nothing is assigned.** In the assign panel a suggestion fills the two fields; the dispatcher
    still presses save. From the desk, an "Assign" button carries that person's name into the audit
    entry, because they pressed it.
  - **The ranking is explainable in one line each.** Workable before refused; no notes before notes;
    then the **smallest vehicle that still fits** (so the 45-seaters stay free for the runs that need
    them), then the least loaded driver and vehicle that day, then registration and name so the same
    records always produce the same order. Nothing is weighted by a hidden score.
  - **A refusal is a sentence, never an empty list.** "There is no bus" and "there is a bus but it is
    under maintenance" are different problems with different answers, so the screen says which, and
    names the run or the hire that is in the way.
  - **It says what it cannot see.** Stops carry a name and a scheduled time — no coordinates, no
    travel time, no separate required-arrival field, and no hours-on-duty record. Rather than invent a
    distance or a speed, `PLANNING_LIMITS` is printed behind a "What this aid cannot see" disclosure.
    This is why RTE-04 is **Met with a stated limit** rather than claimed whole: the arithmetic the
    brief asks for (capacity, availability, existing commitments, arrival time as the timetable
    states it) is there and explained; the geometry needs data the system does not hold (RTE-01).
  - **Notes are not refusals.** An overdue routine service (Q-43) and a licence inside the reminder
    window are printed against the pair and do not block it, because the setting that turns an overdue
    service into a block already exists and is the owner's choice, not the aid's.
  - **It is offered only where it can be acted on.** The desk suggestion renders for a role holding
    `trips:assign`; a role that may read the day but not crew it is not shown a button it cannot press.
- **Consequence.** New module `src/tms/planning.ts` (`planRun`, `planDay`, `PLANNING_LIMITS`), two
  exports from `busing.ts` (`assessResources`, `rosterCount`), the aid in the assign panel and the
  dispatch desk, a `.rts-plan` block in `src/index.css`, and 19 new tests (13 domain, 6 screen). No
  new command, no new permission, no new table: the aid adds no way to change anything.

## D-97 Passenger accounts: one rider, one page, and no map it cannot draw (PAX-01)

- **Context.** Six of the seven brief requirements in Phase 1C were built; the last one was the
  passenger portal, and the honest state was that the person who actually travels had no account.
  "Is my seat confirmed?" and "did the bus come?" were answered by ringing the office, and the office
  answered from a screen the rider could not see. The brief asks for profile, approved options,
  eligible journeys, references and status, pickup time and location, history, cancelling, feedback
  and the company's policy — and it asks for the statuses to be **clearly distinguished**: requested,
  confirmed, assigned to trip, driver en route, picked up, completed, cancelled, delayed.
- **Decision.** A third record-bound role, `passenger`, bound to exactly one rider record through
  `User.passengerId` — the same shape as `driver` and `client_contact`, because the alternative (a
  permission flag on the roster row) would have put a second notion of "who may sign in" beside the
  one that already exists.
  - **One account per rider** is a unique partial index (`app_user_passenger_uq`, migration 016), and
    the role check constraint on `app_user` was widened in the same migration. Adding the role to the
    application without widening the constraint would have failed at insert time on the one database
    the tests actually exercise.
  - **The payload is one person.** The server's bound branch is a whitelist, and a collection left out
    of it hands over the whole table (D-85, D-86). A passenger receives its own rider record, its own
    seats, the runs that carry it, the buses on them and the reports it raised — and nothing else. The
    test asserts over the serialised payload: no colleague's phone number appears anywhere in it.
  - **Settings are narrowed for this role, and only this role.** The settings table also holds rental
    prices, the deposit percentage, payment terms and the tax position. A driver and a client contact
    already trade with the company; an employee reading bus times does not need its employer's
    commercial terms. A passenger receives the company name and the two booking cut-offs, and the
    screen shows an unset cut-off as unset.
  - **Every status is derived from a record, and the ones the data cannot support say so.**
    `journeyStateOf` reads the booking status first (requested, waitlisted, offered, rejected,
    cancelled), then the run (seat held with no bus, bus assigned, ready to leave, under way, run
    cancelled with its reason), then the boarding outcome recorded at the door (picked up, travelled,
    recorded as not boarding). **Two of the brief's words are deliberately not used:**
    - *driver en route* — a dispatched run has not left, and a started run is on the road, but nothing
      here records position or traffic, so calling either "en route" would be a guess dressed as a
      fact. The page says "ready to leave" and "under way" instead.
    - *delayed* — a delay is not recorded anywhere in this system. The portal says a delay cannot be
      told from these records and to ring the office; it does not infer lateness from a timetable.
    Each state is a short label **and** a sentence, because one word cannot separate a held seat with
    no bus from a bus that has not left, and colour never carries state on its own (design rule).
  - **The refusals are shown, not hidden.** `eligibleRunsFor` runs the same `seatErrors`,
    `bookingContractProblem` and request cut-off the command runs, so a run offered on the page cannot
    then be refused by `create_booking`, and a run that is not offered comes with the office's reason:
    its own route needs no booking (the roster *is* the seat), the run is full, a seat is already held,
    requests have closed, or the agreement is not active. A list that silently omitted them would
    leave the rider ringing to ask why.
  - **A rider acts only on itself.** `create_booking` refuses a seat requested in a colleague's name
    (and the portal does not show a rider field at all); `cancel_booking` allows a passenger its own
    seat and refuses anybody else's, mirroring the existing own-client path. Both go through the
    command layer, so a hand-made request is refused for the same reason.
  - **Feedback is an incident, not a new table.** The brief asks for feedback; this build already has
    a record for "something went wrong" with a triage workflow, a responder, costs and an audit trail.
    A rider's report becomes an incident against **a run it is on**, with that run's vehicle
    substituted for anything the browser sends and `takeVehicleOutOfService` forced off — a rider does
    not take a bus off the road (D-17). The rider sees only the reports it raised.
  - **No live map and no ETA.** PAX-02 stays deferred, and the reason is a fact about the data, not a
    scheduling choice: no provider is configured and no position is stored. `PASSENGER_LIMITS` is
    printed on the screen in four sentences, so the silence reads as a stated limit rather than a
    broken page.
- **Rejected.** (a) *A read-only snapshot of the roster.* It would have shown a rider its colleagues'
  names and seats — personal data with no purpose on the page. (b) *Reusing the client-contact role
  with a narrower link.* A client contact sees a company; a rider is one person, and one role that
  means two different things fails closed in neither direction. (c) *A new feedback table.* A second
  place where "a problem was reported" lives would need its own triage, its own permissions and its
  own migration, to duplicate what the incident log already does. (d) *Deriving "delayed" from the
  timetable.* That would be inventing a fact the office never recorded, and it would put a red badge
  on a bus nobody had complained about.
- **Consequence.** New role (`ROLES`, `ROLE_LABELS`, `User.passengerId`), migration
  `016_passenger_accounts.sql`, `passenger_id` in the repository row projection,
  `SCHEMA_VERSION = 20`, the passenger branch of `scopedView` and of `mayReportOnVehicle` plus
  `mayReportOnRun`, `journeySettings` in the server whitelist, `confinedPassengerId` and
  `notMyOwnRider` in `bookings.ts`, `src/tms/passenger.ts`, `src/screens/PassengerPortal.tsx`, the
  "My journeys" destination, the linked-rider field on the Users screen, and 26 new tests (20 domain,
  4 payload, 2 screen).

## D-98 A report is a document the browser prints, and it withholds what it cannot state (RPT-05)

- **Context.** The management report could be read on screen and downloaded as a CSV. Neither is what a
  management meeting reads: a spreadsheet is checked, not read aloud, and the screen needs somebody
  signed in. RPT-05 asks for PDF reports, and had been recorded as Phase 3 work on the assumption that
  a PDF needs a library.
- **Decision.** Build the report as a **document model** (`src/tms/printableReport.ts`) and print it
  with the sheet the invoice, credit note and statement already use (D-87), through the browser's own
  print engine and its "Save as PDF".
  - **No PDF library, no headless browser.** A PDF library brings a dependency, a second layout engine,
    a font pipeline and a binary into an installation that runs on one workstation; HTML-to-PDF brings a
    Chromium that must be installed and patched. Both would put a second thing beside the engine on the
    machine that can disagree with what the reader checked.
  - **The document model formats; it does not calculate.** It is handed `RentalReport` and
    `FinancialReport` and turns them into titled sections and formatted cells. Every figure on the paper
    is a field of a report that was already tested on its own, so a printed total cannot drift from the
    screen: the test compares each printed figure with the report's own value.
  - **A figure that cannot be stated is withheld, on the page.** With no company currency set, every
    amount reads "Not stated" and a line at the top says why. Printing "1 240.00" on a page a manager
    keeps would be asserting a currency the company never chose. The counts still print, because "seven
    requests" is true without a currency.
  - **A gap is printed as a gap.** An empty table prints the sentence saying why it is empty. Cost per
    run and cost per passenger print "Not available" beside their denominators ("0 runs completed"), so
    nobody reads a missing ratio as a zero cost.
  - **The paper states its own limits**, in words a reader of the paper needs and cannot look up:
    outstanding is valued at the period end; only vehicle hire is invoiced in this build; refunds are
    cash out and not a cost of the work; an acceptance rate belongs beside its quotation count. The
    coverage counts travel with the report rather than staying on the screen.
  - **A backwards period is not a document.** The sheet says the period is the wrong way round and
    calls nothing on it a report of any period; the print button is not offered.
  - **It can be identified afterwards.** The reference carries the period and the minute of printing
    (`RPT-2026-06-01-to-2026-06-30-202606120830`), the footer repeats it with the print date, the file
    is named after the period, and the page title becomes the document name while the preview is open —
    which is what "Save as PDF" suggests as the file name.
- **Rejected.** (a) *A PDF dependency or a headless browser* — reasons above. (b) *A separate stylesheet
  for reports* — the document sheet is already measured for A4, print-tested in three places and
  contrast-checked; a second one would drift. (c) *Storing a numbered PDF per printing* — a second
  source of truth for figures that are already derivable, and nowhere agreed to keep a file (Q-51).
  (d) *Emails the report* — no mail provider exists, and pretending to send one is the failure D-63
  rejected for invitations.
- **Consequence.** New module `src/tms/printableReport.ts` (`printableReport`, `periodLabel`,
  `printableReportFileName`) and `src/screens/PrintableReport.tsx` (`ReportSheet`,
  `ReportPrintPreview`); a **Print or save as PDF** action and the preview on the Reports screen; report
  section, figure and coverage styles in `src/index.css` with print break rules; 13 new tests (10
  domain, 3 screen). No new command, table, permission or dependency.

## D-99 - The staff report is its own tab, and it names its own gaps (RPT-02)

- **Context.** The brief asks for a staff transport report: bookings received, confirmed and
  cancelled, no-shows, the on-time pickup rate, average delay, passengers transported, and route and
  contract performance. Most of that was already recorded — a run has a stop log and a boarding
  outcome per rider, and a seat booking has a status and a reason — but none of it was readable as
  one answer. Two questions had to be settled before writing the screen: where the report lives, and
  what it does with the parts of the brief the records cannot support.
- **Decision 1: a second tab on Reports, not a section under the hire report.** The hire report is
  about money over a period a customer chooses; this one is about people on buses over a service
  period. Stacked, one reader would scroll past the whole of the other report to reach their own, and
  the two would share a date range that means different things in each (an invoice date is not a
  service date). The tab is offered only to a role that may read the employee roster, because the
  server has already withheld riders from finance — drawing the tab for them would be a dead end.
- **Decision 2: every count is by service date.** A seat booked on Friday for Monday's run belongs to
  Monday. Counting by the day a record was typed would put work in the week the office was busy
  rather than the week the bus ran, which is the opposite of what a client is checking.
- **Decision 3: carried is a boarding outcome, never the roster size.** The tempting short cut —
  "the manifest says twenty, so twenty travelled" — would make the report agree with the plan instead
  of the morning. Carried is `outcome = boarded`. The difference between the manifest and the recorded
  outcomes is counted as **not recorded** and printed as its own number, because the honest failure
  mode of a boarding register is a rider nobody recorded, not a rider who silently vanished.
- **Decision 4: the report names what it cannot say instead of leaving a zero.** Four facts the brief
  asks for are not in the records at all: fuel and mileage are not per route (an expense records no
  run, an odometer reading records no route), downtime is not measured because nothing records a
  vehicle being unavailable for a period, contract performance is not measured because a run records
  no agreement, and a delay is known only where a stop time was recorded. Each is written on the
  screen beside the coverage counts. A report that prints `0` for an unmeasured thing teaches a reader
  to trust the wrong column; one that says "we do not know, and here is why" does not.
- **Decision 5: delay averages only the late stops.** Averaging every stop's delta lets a bus that
  left ten minutes early at one stop cancel a ten-minute delay at the next, and reports "on time" for
  a morning everybody waited. The average is over stops recorded later than the timetable, the count
  of those stops travels with it, and no late stop means "Not available" rather than `0 min`.
- **Decision 6: occupancy is measured against the bus that ran.** Seats offered is the seat capacity
  of the vehicle on each completed run, not the roster size and not the category's usual bus. A run
  worked with no vehicle assigned offers no seats, contributes nothing to the ratio, and is counted in
  the coverage so the reader knows the denominator is short.
- **Decision 7: on time is not recomputed.** The report calls `onTimeReport()` from `kpis.ts`, the same
  function the busing screen uses, so the two screens cannot disagree and a threshold that moved since
  the run does not rewrite history.
- **Rejected.** (a) *One long Reports page with the staff section underneath* — different question,
  different period, and the reader is only ever after one. (b) *Counting carried from the manifest* —
  it would make the report flattering and useless. (c) *Printing `0` where nothing was measured* — the
  failure this codebase keeps rejecting (D-90, D-98). (d) *A fleet-wide utilisation figure on this
  screen* — the approved vehicle-days definition (Q-29) answers "was the fleet busy?", not "was my bus
  full?", and presenting one as the other would be a silent substitution. (e) *A chart* — the counts
  are small and exact; a bar would be decoration around numbers that fit in a table.
- **Consequence.** New modules `src/tms/staffReport.ts` (`staffReport`, `staffReportCsv`,
  `STAFF_REPORT_LIMITS`) and `src/screens/StaffTransportReport.tsx`; `src/screens/Reports.tsx` becomes
  a two-tab destination with the hire report as its own component; 15 new tests (12 domain, 3 screen).
  No new command, table, permission, migration or dependency. Definitions are written down in
  `docs/KPIS.md` under "Staff transport report".

## D-100 - A receipt scan lives in a folder beside the database, and the index lives in it (Q-51)

- **Context.** The expense register has held the number printed on a paper receipt and whether the
  paper is in the file since Phase 42. Both are claims. An auditor asking "show me the receipt" could
  be given a number and a tick. The owner was asked the four questions that decide whether a file can
  be stored at all — where, for how long, backed up by whom, open to whom — and answered: **a folder
  on the office machine beside the database; three years; a nightly copy the office runs itself;
  finance and administrators only.**
- **Decision 1: the bytes go on the disk, the index goes in the database.** A photograph in a
  `bytea` column makes every nightly dump carry every receipt ever scanned, so a backup that used to
  take seconds grows without bound and a restore drags the paper along with the figures. A folder is
  also what an office can actually copy to a USB stick in the way it already backs up its files. So:
  `data/receipts` (or `RECEIPT_DIR`), one file per scan, and a `receipt_file` row that says which
  expense it belongs to, what it is called, what kind it is, how big, its SHA-256 and who filed it.
- **Decision 2: the name on disk is generated, never the uploader's.** `rcpt_<36 hex>.<ext>`. The
  name the phone gave it is stored to be *shown* and never used in a path. This is what makes
  `../../.env` impossible rather than merely rejected, and the folder is read back through the same
  pattern check, so a row edited by hand cannot become a file read from anywhere on the machine.
- **Decision 3: the type is decided by the bytes.** A file declared `image/jpeg` whose first five
  bytes are `%PDF-` is a PDF; something that starts with none of the four signatures is refused. The
  browser's `Content-Type` is not consulted at all. Every byte that could ever be served back is
  therefore a format a browser renders as an image or a document, never as a page that can run script.
- **Decision 4: 2 MB, and it says so before the upload.** A phone photograph is routinely 4 MB, so
  the panel says the ceiling in words and refuses an oversized file in the browser as well as on the
  server. The database holds the same limit as a check constraint, because a rule that lives only in
  the screen is a rule until somebody uses curl.
- **Decision 5: one scan per expense, and nothing is deleted.** A partial unique index allows one
  `attached` row per expense. Filing a new scan marks the old one `removed` — reason "Replaced by a
  new scan" — and points it at its replacement; removing one records the reason and the person.
  The file stays in the folder until its retention date. Deletion would answer "why is there no scan
  on this expense?" with silence a year later.
- **Decision 6: the file and the row are written together, or neither is.** The row is written by a
  command the browser cannot send (`attach_receipt` is in neither `KNOWN_COMMAND_TYPES` nor the
  client command union). `POST /api/receipts` writes the file, then runs the command, and deletes the
  file again if the command is refused. A browser able to send that command itself could point a row
  at a file that does not exist, or at somebody else's.
- **Decision 7: reading is a server check, not a hidden button.** `GET /api/receipts/[id]` resolves
  the account from the session, checks `receipts:read` against the role in the database, and only
  then touches the disk. Responses carry `no-store`, `nosniff`, and a `content-disposition` filename
  stripped of quotes and separators — a header built from what somebody typed is an injection.
- **Decision 8: the register counts its own gaps.** The screen shows "No scan on file" for the period
  beside the receipt-number count, because an office that can see the gap files the paper; one that
  cannot, discovers it at the audit.
- **Rejected.** (a) *Storing images in the database* — backup size, restore time, and a schema that
  has to stream bytes through JSON on every command. (b) *A cloud bucket* — the owner chose the
  office machine: opening a receipt must not depend on the internet, and a monthly bill for a folder
  that already exists is not obviously worth it. (c) *Trusting the declared type* — the one thing an
  upload must never do. (d) *Giving operations read access to the paper because it can already read
  the expense* — a different fact with a different sensitivity. (e) *Deleting a scan* — see decision
  5. (f) *Storing the printed management report as a PDF too* — D-98 still stands: the report is
  produced on demand, and the owner's answer was about receipts, not about keeping a copy of every
  report ever printed.
- **Consequence.** New module `src/tms/receipts.ts` (`RECEIPT_LIMITS`, `receiptProblems`,
  `attach_receipt`, `remove_receipt`), `src/server/receiptStore.ts` (the only code that touches the
  folder), `POST /api/receipts`, `GET /api/receipts/[id]`, migration **017** (`receipt_file`),
  schema version **21**, two permissions (`receipts:read`, `receipts:write`), a **File scan** action
  and panel on the Expenses screen, and `RECEIPT_DIR` in `.env.example`. 40 new tests (13 domain, 14
  store, 9 route, 4 screen).

## D-101 - A customer record carries what a document needs, and the invoice keeps a copy (CUS-01)

The register held a name, one free-text contact and a status. An invoice printed the name and nothing
else. A customer entitled to claim the tax had no address or tax number on the paper they were given,
and the office was re-typing both whenever the question came up.

- **Decision 1: the office's own code, not one this program invents.** Customers are already known by
  a short code in the office's own paperwork. The field is optional and unique when filled: the
  uniqueness check compares the trimmed, lower-cased value, so "  NST-001 " and "NST-001" are the
  same customer and the second one is refused by name. Generation was rejected — an invented code is
  a second identifier to reconcile against the invoice, the file and the cash book.
- **Decision 2: organisation or individual, and "not recorded" is a real answer.** The column is
  nullable, with a migration default of blank. Every existing customer would otherwise be labelled
  "organisation" on the strength of nothing. The register prints *type not recorded*, the same way it
  prints *no code*, because the reader has to be able to tell a fact from a guess.
- **Decision 3: billing details are address and tax number, not a second contact block.** The brief
  said "billing details". These are the two facts a customer's bookkeeper asks for, and they are
  what the sheet prints. Payment terms and a purchase-order field were **rejected** as a different
  subject (they belong to the invoice, not the customer) — and the tax number is stored upper-case
  after trimming, so the same number typed twice compares equal.
- **Decision 4: the invoice copies the buyer's details at issue and never follows them afterwards.**
  `issue_rental_invoice` looks the client up and writes `buyerAddress` and `buyerTin` onto the
  invoice. A customer who moves in July does not alter the April document, which is the same rule
  already applied to the invoice's own name and address lines. A walk-in (no client record) gets
  blanks, and the sheet prints nothing at all rather than an empty label.
- **Decision 5: the history is read from the audit log, and is read-only.** Changes to a customer are
  already written to `audit` by the command layer. A **History** panel filters those entries to
  `entity = "client"` and shows the person and the time. A separate history table was **rejected**:
  a second record of the same change can disagree with the first, and this one is written by the same
  transaction as the change itself.
- **Decision 6: no new permission.** `clients:read`/`create`/`update` already gate the register, and a
  billing address is part of a customer record rather than a new class of secret. The invoice sheet
  prints what the person looking at the screen can already see.
- **Consequence.** `Client` gains `reference`, `type`, `billingAddress`, `tin`, `notes`; `Invoice`
  gains `buyerAddress`, `buyerTin`; migration **018** (`018_customer_details.sql`), schema version
  **22**; validation in `validateClient`; the register gains a Billing column, a History panel and the
  new form fields; the invoice sheet prints the buyer block; 16 new tests (9 domain, 2 import, 3
  register screen, 2 sheet).

## D-102 - A customer's branches are records, and its agreement is read rather than copied (CLI-01)

The corporate client record was a name, one contact and a status. CUS-01 added what a document
prints. What was still missing is the shape of the business: the certificate it was registered on,
the offices its staff are collected from, and whether there is an agreement at all.

- **Decision 1: the registration number and date are typed from the certificate and never
  reformatted.** Both are optional; a customer who never supplied one has blanks, and the register
  prints nothing rather than a placeholder. Only the length and the fact that the date is a real day
  are checked, plus one rule that matters: a company cannot be registered in the future. Whether a
  registration *date* is plausible against the customer's first job was **rejected** as a guess.
- **Decision 2: a branch is a record with an owner, not text on the customer.** The office already
  says "Tema depot" and "Head office", and a run or an invoice may name one of them. Held as free
  text, the same place gets typed three ways and no picker can offer it. `client_location` is its own
  table with a foreign key to the customer; a branch cannot outlive the customer it belongs to.
- **Decision 3: one name per customer, compared ignoring case and spaces, enforced twice.** The form
  refuses a duplicate and so does a unique index on `(client_id, lower(btrim(name)))`. The form gives
  a sentence a person can act on; the index is what holds when a backup restore or a second writer
  arrives. A database rule that only the application respects is not a rule.
- **Decision 4: a closed branch keeps its row.** Closing sets `status = 'closed'`. Trip records,
  invoices and the customer's own history already name that office, and deleting the branch would
  leave them naming nothing. There is no delete command, and the same reason applies as in D-100:
  what an auditor asks a year later is "where was this run collected from?", not "why is there a gap?".
- **Decision 5: the agreement line is computed, never stored.** The row shows "CT-0001 active to
  2026-12-31" or *no agreement on file*, from `db.contracts`. A stored flag would be a second copy of
  a fact the contract holds, and the copy is the one that goes stale — an agreement terminated in
  Contracts would still read active on the customer. The line prefers an agreement in force, then one
  waiting to start, then the most recent that has ended, and ties break on the start date so the
  answer never depends on array order.
- **Decision 6: no new permission.** Branches use `clients:create` / `clients:update`. A branch is
  part of a customer record, and a separate permission for it would be a second way to say the same
  thing — with the failure mode that somebody holds one and not the other.
- **Decision 7: the portal sees its own offices.** A client contact is given its own customer's
  branches — that is where its staff are collected from — and no other customer's, and a driver is
  given none. The snapshot rule is the same one that already narrows users, passengers and contracts.
- **Decision 8: branches are not on the invoice.** The document prints the customer's billing
  address (D-101). Which branch a run served belongs to the trip record, not to the bill, and putting
  it on the invoice would invite two addresses disagreeing on one piece of paper. **Rejected** for
  now: a per-branch billing address, which would be a different feature and would need a rule for
  which branch an invoice is billed to.
- **Consequence.** `Client` gains `registrationNumber` and `registeredOn`; new `ClientLocation` type
  and `clientLocations` collection; new module `src/tms/clients.ts` (validation and the agreement
  line); commands `create_client_location` and `update_client_location`; migration **019**
  (`client_location`), schema version **23**, 21 tables; the register gains the certificate fields,
  a branch count per row, the agreement line and a **Branches** panel; 26 new tests (12 domain, 8
  command, 5 screen, 1 payload) plus 2 against real PostgreSQL.

## D-103 - The licence has to cover the vehicle, and a blank class is not permission (FLT-04)

A driver's record was a number and an expiry date, and dispatch checked the date. Nothing checked
what the licence allowed: a driver licensed for a small car could be signed to a coach, and the
system reported the licence as in order. For a company carrying other people's staff, that is the
wrong thing to be silent about.

- **Decision 1: the vocabulary is the office's, not this program's.** Classes are stored as the
  office reads them off the licence — printed codes, upper-cased so "c" and "C" are one class — and
  which of them covers a minibus, a coach or a tipper is declared per **vehicle category** in
  Settings. Rejected: hard-coding a table of what each class means. Ghana's classes are printed on
  the paper; the mapping from class to *this company's* vehicles is the operator's rule, and writing
  my own version of it would be inventing a fact and grounding a fleet on it.
- **Decision 2: an undeclared category checks nothing.** A category with no classes recorded is a
  category nobody has classified, and dispatch behaves exactly as it did before this phase. The
  alternative — refusing every assignment until somebody classifies the fleet — would take a working
  bus company off the road to satisfy a rule it never made.
- **Decision 3: once a requirement exists, a blank driver class fails closed.** If the office has
  said a coach needs class D, a driver whose class is unrecorded cannot be shown to hold it, and the
  assignment is refused with the sentence: *Driver Kofi Mensah's licence class is not recorded, and
  Coach requires D. Record the class from their licence before assigning this vehicle.* That is the
  whole design in one line — "we did not write it down" and "we checked and it is fine" must not look
  the same to a dispatcher.
- **Decision 4: both paths, one function.** Trips and hires both call `licenceClassProblem`, and the
  planning aid (RTE-04, D-96) calls the same function the save uses, so a suggestion it offers can
  never be refused by the save that follows. A check written twice is a check that disagrees with
  itself the first time somebody edits one copy.
- **Decision 5: the vehicle decides, not the request.** The check uses the category of the vehicle
  actually being signed to the run, falling back to the requested category for a hire confirmed
  before a vehicle was chosen. A hire moved to a different vehicle is re-checked at that moment,
  which is the moment it matters.
- **Decision 6: qualifications are recorded, not enforced.** "PSV", "Defensive driving", "First
  aid" are typed as the office names them and shown on the driver's row. Nothing is refused for want
  of one, because the office has not said which job needs which certificate — and a rule invented
  here would refuse work the company does every day. This is asked as **Q-52**; answering it would
  add a per-category requirement beside the licence classes.
- **Decision 7: availability is derived, never stored.** A driver's row says *free today*, *on
  TR-0001 (Northstar morning) today* or *on hire RR-0007 today*, read from live trips and hires. A
  stored availability flag is the first thing that goes stale when a run is cancelled, and a
  dispatcher who cannot trust it stops reading it.
- **Decision 8: the public form learns nothing.** The enquiry endpoint still sends a category's id
  and name. Which licence class the company requires for its own coaches is an internal rule, and a
  test now asserts it does not leave the building.
- **Consequence.** `Driver` gains `licenceClasses` and `qualifications`; `VehicleCategory` gains
  `licenceClasses`; new module `src/tms/driving.ts` (`parseTags`, `validateTags`,
  `licenceClassProblem`, `driverAvailabilityLine`, `DRIVING_LIMITS`); enforcement in
  `assessResources` (busing) and `assign_rental` (service); Settings gains a licence-class field per
  category; the driver register gains class, qualifications, a today line and a count of drivers
  with no class recorded; the drivers CSV gains two optional columns; migration **020**, schema
  version **24**; 27 new tests (20 domain, 1 planning, 5 screen, 1 import).

## D-104 - A stop carries directions, and half a position is refused (RTE-01)

A stop was a name and a time. For the driver who works the same estate every morning, that is enough.
For a relief driver on their first morning it is not, and it is not something anybody can type into a
phone. The brief asked for a landmark, a Ghana digital address and coordinates.

- **Decision 1: every field is optional, and nothing is invented.** A stop with no landmark is a fact
  about the office's records, not a failure of the form. The screens say *no directions recorded* and
  the routes list counts the stops that have none, so the gap is visible rather than papered over.
- **Decision 2: an address, once typed, must be real-shaped.** `GA-123-4567`, region letters then
  three or four district digits then four more. Only the shape is checked — whether the point exists
  is not something a form can know — but a mistyped code is refused, because a driver follows it
  somewhere else and the mistake looks like a fact.
- **Decision 3: coordinates come in pairs or not at all.** Half a position is a pin in the Gulf of
  Guinea that a driver would believe. Six decimal places is about eleven centimetres, which is closer
  than a bus stops; anything finer is noise that invites false precision.
- **Decision 4: the map link is a plain search, not an embedded map.** `stopMapLink` builds an
  ordinary maps search URL from the coordinates. **Rejected:** an embedded map, a tile provider, or
  any stored location data of our own — it would add an API key, a bill and an internet dependency to
  a program that runs on one office machine (Q-01, D-100).
- **Decision 5: the directions are not the stop's identity.** Trips lock the stop list so a recorded
  run keeps pointing at a stop that exists, and that lock stays on the name, the time, the order and
  the id. The directions are deliberately outside it: a wrong landmark is a typo to correct, and
  refusing the correction would leave a driver following the wrong wall for the life of the route.
- **Decision 6: what a customer and a rider see is the landmark, not the coordinates.** A customer
  is entitled to see that its staff are collected from "the blue wall after the bridge"; the
  decimal position exists to build a map link for the driver, and never travels to the portals.
- **Decision 7: no new permission and no new screen.** Stops belong to the route, which operations
  already maintains through `routes:update`. The directions sit on the route form beside the name and
  the time, because a second screen for the same record is a second place for it to be out of date.
- **Decision 8: no new table.** A stop lives inside its route's record, and has since the route was
  built. Splitting stops into their own table now would be a migration and a join for fields that are
  read only with the route. Schema version **25**, no new SQL migration — the second phase to ship
  without one, for the same reason as the first.
- **Consequence.** `RouteStop` gains `landmark`, `digitalAddress`, `latitude` and `longitude`; new
  module `src/tms/stops.ts` (`readStopDetail`, `stopDetailLine`, `stopMapLink`, `migrateStop`,
  `stopsWithoutDirections`, `STOP_DETAIL_LIMITS`, `GHANA_POST_GPS_RE`); the route form gains four
  fields per stop; the driver's run row and stop form show the directions and a map link; the client
  and rider portals show the landmark; the routes list counts undescribed stops; `migrate()` fills the
  new fields for older routes; 19 new tests (15 domain, 3 stop form, 1 screen).

## D-105 - A delay is a statement made while the run is out (DSP-04)

The brief asks for no-shows and delays to be recorded, and trips to be cancelled or interrupted.
No-shows and cancellation were built long ago. What was missing is the fact a dispatcher needs at
07:20, when a client rings to ask where the bus has got to: *this* run, *this* far behind, *for this*
reason. The transport report already measures lateness from the recorded stop times — but only after
the run finishes, which is the one moment nobody is ringing.

- **Decision 1: one new record on the run, not a new table and not a new screen.** `Trip.delays` is a
  list of `{ id, at, minutes, reason, reportedBy }` inside the run's own record. `delayLine` reads it
  for the desk and the driver; `delayNote` writes the full sentence for the client and the rider.
- **Decision 2: append-only, and the newest statement is the current one.** A second report is the
  delay getting worse (`40` after `20`) or the run catching up (`0`). Nothing is edited, because the
  question asked afterwards is what was known at the time — the same rule as corrections (D-74) and
  ad hoc reasons (D-82).
- **Decision 3: `0` is allowed only once something has been reported late.** "Back on time" answers an
  earlier statement; it is not a way to record a run that was never late, which would fill the history
  with noise and make the desk's count meaningless.
- **Decision 4: a reason is compulsory, minutes are whole numbers and 600 is the ceiling.** A number
  without a reason is a rumour the office will repeat to a client. One hundredths of a minute is
  false precision on a road. Beyond ten hours it is not a delay, it is a run that did not happen, and
  the screen says so.
- **Decision 5: only while the run is out — `dispatched` or `in_progress`.** A planned run is not late
  yet. A finished run is not late *now*: its lateness lives in its stop times, which is what
  `staffReport.ts` measures, and a live "running late" count must not include yesterday.
- **Decision 6: no new permission.** It is `trips:record`, the permission that already means "record
  what is happening on this run", and a driver is confined to their own run by `mayActOnTrip` like
  every other action on a trip. **Rejected:** a separate `trips:delay` permission, which would have
  meant a role that can record a stop but not that the stop is late.
- **Decision 7: it travels to the people who would otherwise ring.** The client portal gained a
  "Today's runs" card, and the rider's journey state carries the sentence after its own news (a
  cancelled booking is still not a cancelled bus). Neither shows the reporter's name or anything the
  office has not checked.
- **Decision 8: an interruption that resumes is a delay; one that ends the run is a cancellation.**
  The brief's "cancel or interrupt" is already covered: `cancel_trip` stops a running trip, keeps the
  stops and outcomes already recorded, and must name the incident that caused it when there is one
  (D-75). A run held up and then continuing is what a delay report and its stop times describe.
- **Decision 9: schema 26, no SQL migration.** The new list lives inside the run's record; `migrate()`
  fills an empty list for runs written before it. The third phase in a row to need no migration, for
  the same reason: the database stores records, not their shape.
- **Consequence.** `TripDelay` and `Trip.delays` in `types.ts`; new module `src/tms/delays.ts`
  (`readDelayInput`, `liveDelay`, `latestDelay`, `delayLine`, `delayNote`, `delaySummary`,
  `runningLate`, `minutesLabel`, `DELAY_LIMITS`); `record_trip_delay` in `busing.ts` and the command
  catalogue; a shared `TripDelayForm` used by the dispatch sheet and the driver's portal; the run row
  and the dispatch desk show what is behind schedule; 33 new tests.

## D-107 - Four facts about the vehicle itself (FLT-01)

The register knew a registration, a category, a seat count and a status. The brief also asks for the
vehicle's photo, fuel type, ownership or leasing, and its usual driver. Insurance, roadworthiness and
service dates were already there as compliance documents and maintenance records, and the odometer as
readings; these four were the gap. This entry covers the three that are facts about the vehicle; the
photograph is a file and is dealt with next (D-108).

- **Decision 1: fuel type is free text, not a fixed list.** "Diesel" and "Petrol" are the common
  answers, but a converted bus reads "Petrol and LPG" and a workshop may have its own word. A closed
  list would refuse the truth. It is trimmed, capped at 30 characters, and stored exactly as the office
  wrote it — no silent title-casing, because "PETROL" is how somebody chose to type it.
- **Decision 2: an unrecorded ownership is null, never `owned`.** This is the whole point of the
  field. A default of "owned" would put a bus the company leases on its own asset list, which is the
  one error a fleet register must not make. The screen says "not recorded" and the register counts the
  vehicles in that state.
- **Decision 3: a vehicle that is not ours names its owner.** Leased or hire purchase without a
  lessor is half a record, and the missing half is the name of the person to ring when the bus is
  taken back. The reverse is refused too: a name on a vehicle recorded as ours is usually one left
  behind by a change of mind, and storing it where no screen will show it again is worse than saying so.
- **Decision 4: the usual driver must be a driver on the register, and not an inactive one.** A name
  typed into a box is not a driver. An inactive driver cannot be a bus's usual driver, because the
  record would then point at somebody who may not take a run out.
- **Decision 5: the usual driver is a habit, not an assignment.** It never stands in for the run's own
  driver, and nothing in `assessResources` reads it. Making it an assignment would be a second,
  invisible way to crew a run — and the run sheet would disagree with the fleet register about who is
  driving.
- **Decision 6: everything is optional, and the gaps are counted.** A register that refused to record
  a bus because nobody knew its fuel is worse than one that records the bus and says what is missing.
  The vehicles table prints "3 with no fuel type · 2 with no ownership of 12" beside the status line,
  retired vehicles excluded — the same rule as the stop directions (D-104).
- **Decision 7: the importer carries the three facts, with the usual spellings accepted.** A
  spreadsheet cell says "Lease" and the form says "Leased"; `normaliseOwnership` maps the words people
  actually use and refuses anything else rather than guessing. The usual driver is deliberately not a
  CSV column: a spreadsheet has a name, and this field needs one of the drivers already on file.
- **Decision 8: schema 27, no SQL migration.** The four facts live inside the vehicle's own record;
  `migrate()` fills blanks and a null ownership for older records. `VehicleInput`'s new fields are
  optional, so every existing caller — the importer, the tests, any command already in the log —
  keeps working without a change.
- **Consequence.** `VehicleOwnership` and the four fields on `Vehicle`; new module `src/tms/vehicles.ts`
  (`readVehicleDetail`, `normaliseOwnership`, `ownershipLine`, `vehicleDetailLine`, `usualDriverOf`,
  `fleetDetailGaps`, `isThirdParty`, `VEHICLE_DETAIL_LIMITS`); the vehicle form gained a "The vehicle
  itself" section; the register prints the facts, the usual driver and the gap count; the CSV importer
  gained `fuel`, `ownership` and `owner`; 28 new tests.

## D-108 - The vehicle's photograph, and the folder it lives in (FLT-01)

The last of the four facts D-107 left open. A photograph answers a question no other field in the
register answers — "is this the bus in front of me?" — and it is the one fact about a vehicle that is a
*file*, so it brings the questions a file brings: where it is kept, what it is really called, who may
open it, and what happens when it is removed.

- **Decision 1: one photograph per vehicle, and a new one replaces it.** Four pictures of the same bus
  leave a reader choosing which one is the bus. A replacement is a change to the same field, recorded
  in the audit log with both the old and the new name, so "who changed the picture, and when" is
  answerable from the log rather than from the folder.
- **Decision 2: removing the photograph needs a reason.** A photograph of a damaged bus, or of a bus
  that has just been sold, is evidence. Evidence does not disappear without a sentence saying why,
  and that sentence is printed in the audit log beside the name of whoever removed it.
- **Decision 3: removal takes the index off; the file stays in the folder.** Deleting from the register
  is a decision about what the fleet *is*; emptying the folder is a decision about what the company
  *keeps*, and those are not the same decision. Q-18 (retention) is still open, so nothing here
  destroys a file on the strength of a screen action. The message says so plainly, so nobody believes
  the bytes are gone.
- **Decision 4: the picture has its own folder, not the receipts' folder.** `VEHICLE_PHOTO_DIR`, or
  `data/vehicle-photos` beside the application. Receipts (D-100) are financial evidence with a
  retention term of their own; a photograph of a bus is fleet evidence. One folder with two rules
  inside it becomes, in practice, one rule — whichever the last person to tidy it up believed. The
  names carry the difference too: `vhcl_…` here, `rcpt_…` there, and each reader refuses the other's
  prefix.
- **Decision 5: the server names the file; the uploader never does.** Stored as
  `vhcl_<36 hex>.<ext>`, eight random bytes of separation and no path separator possible. The name the
  phone gave it ("IMG_20260914.jpg") is kept as the record's `originalName` for the reader's benefit
  and never touches the disk. Every read re-validates the name against the pattern, so a hand-edited
  record cannot walk out of the folder.
- **Decision 6: the type comes from the bytes, and only a picture is accepted.** The sniffing and
  fingerprinting are the receipt store's (`sniffType`, `fingerprint`), reused rather than re-invented;
  JPEG, PNG and WebP are allowed and PDF is not. A PDF is a document, and documents have a register of
  their own; letting one in here would mean two places that hold the same kind of file under different
  rules. Ceiling 2 MB, because this is a picture for recognising a bus, not a print-quality image.
- **Decision 7: the file is written first, the row second, and a refused row deletes the file.** The
  route saves the bytes, then asks the domain to index them, and if the domain refuses — a vehicle that
  is not on the register, a value that grew while the upload was in flight — the route deletes what it
  just wrote. An unindexed file in the folder is one nobody can find, open, or ever remove.
- **Decision 8: filing a photograph is browser-forbidden; removing one is not.** `attach_vehicle_photo`
  is in `COMMANDS_WITH_THEIR_OWN_ROUTE` and `BrowserForbidden`, because a row may only be written after
  the bytes are on the disk and only the server can promise that (the same reasoning as D-100).
  `remove_vehicle_photo` touches no file, so it travels through `/api/commands` like any other command.
  Both need `vehicles:update`.
- **Decision 9: opening a photograph needs `vehicles:read` and own-record scope.** Today only
  administrator, operations and finance hold that permission, and all three read the whole fleet — so
  the scope check is a second gate that changes nothing yet. It stays because the alternative is a route
  that trusts a role to be company-scoped, and that is one permission change away from handing out any
  bus in the company by id. Responses carry `nosniff` and `no-store`, and the download name is stripped
  of quotes, control characters and separators.
- **Decision 10: schema 28, no SQL migration.** The photograph is a nested object on the vehicle's own
  record; `migrate()` fills `null` for vehicles written before it existed, and the screen says "none"
  rather than showing a broken image. The bytes live in the folder, not in the database.
- **Consequence.** `VehiclePhoto` and `Vehicle.photo`; new module `src/tms/vehiclePhoto.ts`
  (`VEHICLE_PHOTO_LIMITS`, `vehiclePhotoProblems`, `executeVehiclePhoto`, `vehiclePhotoOf`,
  `vehiclePhotoLine`, `vehiclesWithoutPhoto`); new `src/server/vehiclePhotoStore.ts`; new routes
  `POST /api/vehicle-photo` and `GET /api/vehicle-photo/[id]`; `attachVehiclePhoto` through
  `useTms`; a thumbnail column, an "Add photograph" row action and a photograph panel on the vehicle
  register; the gap notice now also counts "N with no photograph"; the backup note names two folders;
  41 new tests.
- **Corrected during the build.** The panel block that renders the add/edit form keyed off
  "not transition and not import", so opening the photograph panel also opened an "Add vehicle" form
  behind it. Caught by the screen test, not by eye; the block now names the two modes it serves.

## D-109 - Seven states for a vehicle, and four of them are read rather than typed (FLT-02)

The brief names seven vehicle states: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of
Service, Pending Inspection. The register held four statuses — available, maintenance, out_of_service,
retired — and they answered a different question from the one the brief is asking. "Is anything wrong
with this bus?" and "can I put it on a run this afternoon?" are not the same question, and a register
that can only answer the first one sends a dispatcher to a bus that left an hour ago.

- **Decision 1: the stored status is the vehicle's condition; three of the brief's states are read.**
  Available, Under maintenance, Out of service and Retired stay as they are: words the office types,
  each change audited with a reason. Reserved, Assigned and On Trip are facts about what the day's runs
  and hires are doing with the bus, and storing them would create a second copy of a fact the trips
  already hold. The two copies would disagree the first time a run was cancelled in a hurry — the fault
  this codebase has refused before (D-103, where a driver's availability is read from the runs rather
  than kept as a flag). So the working states are derived in `src/tms/fleetState.ts`.
- **Decision 2: Pending Inspection is the state the register never had, and it is the useful one.** A
  work order that has reached `completed` is a repair that is finished and a vehicle that nobody has
  signed back into service: the bus is not being worked on, and it may not carry people. Folding that
  into "Under maintenance" hides the difference between "the mechanic is still working" and "the
  mechanic has finished and is waiting for the person who may release it" — and it is the second one
  that gets dispatched by mistake, because the work looks done. It is derived from the work order, not
  added as a fifth stored word, for the same reason as Decision 1: a stored `pending_inspection` would
  need its own transition and could sit on a vehicle whose order had already been released.
- **Decision 3: precedence is by what physically stops the bus.** Retired first (it is not in the
  fleet), then out of service (the office has taken it off the road), then maintenance, then pending
  inspection, then on trip, assigned and reserved. Work in the workshop outranks work on the road
  because a bus with its wheels off cannot be driving; a finished repair waiting for a signature
  outranks a commitment because nobody may carry passengers until somebody signs the bus back.
- **Decision 4: a blocking state still names the commitment it is overriding.** A bus in the workshop
  that is still on today's run sheet reads "Under maintenance. It is still committed to TR-0001
  (Northstar morning), dispatched with Kofi Mensah." The two facts are both true and the second one is
  a plan that has already gone wrong; printing only the state would leave the dispatcher to discover it
  at the gate. The same applies to a retired bus with a hire still attached to it.
- **Decision 5: Reserved means "held today", not "booked eventually".** A hire that starts on Friday
  does not make a bus unavailable on Tuesday, and counting it would make almost every vehicle
  permanently Reserved, which is the same as having no word at all. The register therefore answers
  "what is it doing today", and the *next* question — "when do I lose it?" — is answered separately by
  `nextCommitmentOf`, printed in the status panel for a vehicle that is free.
- **Decision 6: the filter speaks the seven states, and the row still shows the office's word when it
  disagrees.** "Show me everything in the workshop" must include the bus waiting for a release, so the
  filter reads the derived states. Where the derived state differs from what the register says — the
  common case being Pending inspection on a vehicle still marked Under maintenance — the row prints
  "register: under maintenance" beneath the badge, so nobody has to guess which to believe, and the
  change-status panel says which of the two vocabularies it is changing.
- **Decision 7: the rule for each state is printed on the screen, not only in this file.** The brief
  asks for the rule behind each state. `FLEET_STATE_RULES` holds them and the register shows them in a
  disclosure under the table: a rule that lives only in a markdown file is a rule nobody at the desk
  has read.
- **Decision 8: the states decide nothing.** What stops a vehicle being assigned is still
  `assessResources`, reading the stored condition, the mandatory papers and the service interval. The
  derived state is a reading of the records, not a gate, and it cannot block work by itself. That
  separation is what keeps the derived states honest: if they were enforced, a disagreement between
  them and the runs would stop the office working.
- **Decision 9: schema 28 unchanged, no migration and no new field.** Every input to the states already
  exists in the database. There is nothing to migrate, and a stored copy is exactly what this entry
  argues against.
- **Consequence.** New module `src/tms/fleetState.ts` (`FLEET_STATES`, `FLEET_STATE_LABELS`,
  `FLEET_STATE_ORDER`, `FLEET_STATE_RULES`, `fleetStateOf`, `fleetStateLine`, `fleetStateCounts`,
  `vehiclesInState`, `nextCommitmentOf`); the vehicles register shows a **Today** column with the state,
  the record behind it and any overridden commitment, counts the fleet by state beside the search box,
  filters by state, and prints the rules; the change-status panel shows the state and the next
  commitment; `STATE_MACHINES.md` carries the table. 35 new tests (25 domain, 10 screen).

## D-110 - A reminder is a record, not a message (FLT-03)

The compliance register already knew an expiry date, already had a lead time the office sets, and
already blocked a vehicle or a driver whose mandatory paper had lapsed (Q-16, D-76). What it could not
do was tell anybody *before* that happened — and it could not, because sending an email or a text
message needs a provider this program does not have (Phase 2, deferred). The brief asks for
"configurable reminders", and answering "we cannot, there is no mail server" is not an answer.

- **Decision 1: a reminder is a record of somebody taking the renewal on, not a message.** What a
  reminder is actually for is that *somebody has noticed and somebody is dealing with it*. That is a
  fact this program can hold: who said it, when, what they are doing, and the date they expect the new
  paper. It is printed beside the paper and written into the audit log. When a provider arrives in
  Phase 2 it can send the message; it cannot invent the record, which is why the record came first.
- **Decision 2: due-ness is never typed.** A paper is due when its expiry is inside the configured lead
  time or already past — the same `documentStatus` the register has used since Q-16. Nothing is marked
  due by hand, so nothing can be marked due that is not, and moving the lead time in Settings moves the
  whole list at once.
- **Decision 3: an acknowledgement belongs to an expiry date, not to a document.** The record stores
  the date the person was looking at. When the paper is renewed the expiry date moves, the old
  acknowledgement lapses, and the reminder returns if the new date is still inside the lead time. The
  alternative — an acknowledgement attached to the document — would let a mistyped renewal silence the
  reminder it was meant to answer, which is the one failure this feature must not have.
- **Decision 4: a paper nobody has to think about yet cannot be taken on.** Acknowledging something
  three months away is a click, not a decision, and it would leave the really urgent paper looking
  handled. The refusal says which date and which lead time it checked.
- **Decision 5: "expected by" is optional but must be a real date, and not in the past.** "Somebody is
  dealing with it" with no date is a sentence that can sit on a screen for a year. A date already gone
  is not a date somebody expects something by.
- **Decision 6: append-only, and the newest acknowledgement is the live one.** A second person taking
  the paper on supersedes the first without erasing them; the audit summary names the acknowledgement
  it replaced. Same rule as the delay reports (D-105) and the receipt scans (D-100): the question
  afterwards is who said what, and a list that can only hold one answer cannot answer it.
- **Decision 7: the reminder reaches the screen everybody opens.** The Dashboard's "needs attention"
  list gains a row for the papers nobody has taken on, naming up to three with how long is left, and it
  disappears when they are all taken on. A reminder that lives only on the compliance screen is one
  nobody reads, which is the problem the feature exists to solve.
- **Decision 8: nothing is deleted, and this is not a job runner.** No scheduled process exists, so
  there is no nightly digest and nothing here fires at a time of day; the list is read when somebody
  opens the program. That is an honest limit, printed on the screen, not a hidden one.
- **Decision 9: schema 29, no SQL migration.** `documentReminders` is a collection in the snapshot;
  `migrate()` fills it with an empty list, which reads as "nobody has taken any renewal on" — exactly
  right for a backup written before this existed.
- **Consequence.** `DocumentReminder` and `Database.documentReminders`; new module
  `src/tms/documentReminders.ts` (`REMINDER_LIMITS`, `reminderFor`, `dueReminders`, `reminderCounts`,
  `reminderTiming`, `reminderLine`); the `acknowledge_document_reminder` command under
  `documents:update`; a **Renewals** card on the compliance screen with a two-field panel; a row on the
  dashboard's attention list. 32 new tests (11 domain, 8 command, 13 screen).

## D-111 - A reference can be copied, and copying says so in words (Phase 61)

The office quotes numbers on the phone all day — an invoice number to a customer, a receipt number to
a supplier, a rental or run reference to a driver. Until now the only way to get one out of the program
was to read it off the screen and type it into a message, which is where wrong digits come from. A
review of the `uselayouts` component library offered a "middle truncation" and a tactile press effect;
the library itself was rejected (D-109 note: animation, 3D, gradients and three extra dependencies
against a Daylight interface that has none of them). One idea survived, rebuilt here in about eighty
lines with no dependency: a quiet **Copy** button beside a reference.

- **Decision 1: the confirmation is a word plus a sentence in a live region, not a colour or a
  flourish.** The button's own label changes to "Copied" for four seconds, and a `role="status"` line
  beside it says which reference was copied ("Invoice number INV-2026-0001 copied."). A button that
  tints green, or a tick that slides in, tells a screen-reader user nothing and is easy to miss; the
  design direction also has no decorative motion. The accessible name of the button never changes —
  it stays "Copy invoice number INV-2026-0001" — so focus does not appear to land on a different
  control after a click.
- **Decision 2: the Clipboard API first, a selected textarea second, and an honest sentence when both
  fail.** An office machine reached over plain `http` on the local network is not a secure context and
  has no `navigator.clipboard`; some embedded views refuse it too. The fallback selects a temporary
  textarea and copies that, then removes it. If both routes fail the button reads "Not copied" and the
  live region says "Select the number and copy it by hand." A button that looks like it worked when it
  did not is worse than no button.
- **Decision 3: only references get one, and only where a number actually exists.** Invoice numbers on
  the invoice, rental references on the request, run references on the run cards, receipt numbers on
  the expense row. A **statement has no number of its own** — it is a customer's account between two
  dates — so it gets no button rather than an invented identifier. That is the same rule as the rest of
  the program: no business fact is made up to fill a gap in the interface.
- **Decision 4: the receipt button appears only where a number was recorded.** An expense with no
  number keeps its "no number" mark and nothing to copy, so the missing evidence stays visible.
- **Decision 5: nothing new on the server, nothing on the wire, no dependency.** The value copied is
  the string already on screen. No command, no permission, no schema change, no library.
- **Consequence.** `src/ui/CopyButton.tsx` (`CopyButton`, `writeToClipboard`); two rules in
  `src/index.css` (`.rts-copy`, `.rts-copy-note`); wired into the invoice detail header, the rental
  detail header, the run cards on the busing bookings tab, and the receipt column of the expenses
  table. 10 new tests (5 on the button itself, including both failure routes; 5 proving each of the
  four places is wired to the value on screen).

## D-112 - The fleet dashboard counts days, and prices only what the company has priced (FLT-05)

The owner asked a fleet dashboard for "totals, availability, assigned, on trip, under maintenance,
pending inspection, expiring, utilisation and idle cost". The first six already existed on the
register and the compliance screen. What did not exist was the period: how much of the fleet worked
over a stretch of days, how many days were downtime, and what standing still cost. This note records
how those three are measured, because a number an owner will make decisions with has to be defensible
line by line.

**The unit is the vehicle-day** — one vehicle on one calendar day. Not hours. Nothing in this program
records an hour of a vehicle's time: a run has stop times, not a duration, and a hire has dates. A
dashboard in hours would need a figure nobody has supplied, which is exactly what Q-29 left open.

- **Decision 1: the headline utilisation is the figure management already approved, unchanged.**
  After Phase 28 the owner approved `utilisation = committed vehicle-days ÷ available vehicle-days`,
  with available = the fleet in service × the days in the period (D-78, `docs/KPIS.md`). A second,
  prettier definition on a new screen would mean two answers to one question. So the dashboard prints
  the approved figure, and says in its caption what the two numbers are.
- **Decision 2: the stricter measure is printed beside it, under its own name.** Committed is not
  worked: a run that was planned or a hire that was confirmed holds the vehicle and counts in the
  approved utilisation, but it may never have moved. So the screen also prints **days worked** — runs
  that started or finished, hires that were under way — over the days a vehicle was ours and not in
  the workshop. Two labelled figures that answer two questions are better than one figure that quietly
  blurs them.
- **Decision 3: every vehicle-day lands in exactly one of four buckets, in this order** — worked,
  in the workshop, booked and never ran, idle. Work comes first, deliberately: a bus that carried
  passengers and went into the workshop the same afternoon worked that day, and a report that called
  it downtime would hide the work. The workshop comes before "booked", so a hire confirmed for a day
  the bus was in pieces shows as downtime; the double booking itself is already named on the vehicle
  register (D-109), which is where somebody can act on it.
- **Decision 4: downtime is dated from the work order, not from the office's word.** A vehicle is out
  of service from the day its work order was raised to the day somebody released it. An order that is
  finished but unreleased still holds the bus — that is the brief's "pending inspection" — so an
  unreleased order runs to the end of the period rather than ending at `completedAt`. A vehicle the
  register calls "in the workshop" with no work order has nothing to date the days by: it is counted
  as idle and the screen says why, instead of guessing.
- **Decision 5: idle cost is a company figure, in a setting, with no default.** "What does a standing
  bus cost us a day?" is finance, insurance, licensing and a retainer — facts only the company holds.
  It is stored as `settings.fleetStandingCostPerDay` (schema 30, no SQL migration: settings live in
  the snapshot) and entered under Settings → Fleet. Until it is set, the dashboard counts the idle
  days and states plainly that they carry no money. Multiplying by an assumed figure would put a
  confident number on the screen that nobody could trace.
- **Decision 6: a retired vehicle is out of every day of the period, and the screen says so.** The
  program knows a vehicle is retired, not the date it left, so there is no honest way to count its
  earlier days. The count of excluded vehicles is printed rather than buried.
- **Decision 7: the approved denominator is not prorated, and the difference is explained.** A vehicle
  registered halfway through the month still contributes its full days to the approved denominator,
  which understates utilisation slightly; the buckets, by contrast, count a vehicle only from the day
  it was registered. Rather than silently choosing one, the screen says both things in the card that
  lists what the records cannot say.
- **Decision 8: today's states come from the register's own function.** The dashboard's "where is the
  fleet today" band reads `fleetStateCounts`, the same call the vehicles register makes, so the two
  screens cannot disagree about a bus.
- **Decision 9: a period longer than two years is cut short and flagged, never silently measured.**
  `fleetReport` walks at most 732 days and sets `truncated`, which the screen prints. Reporting a
  different period from the one somebody typed is the quiet kind of lie this codebase refuses.
- **Decision 10: the screen spends its space on what cannot be known.** Below the per-vehicle table it
  names the gaps: retired vehicles, workshop days with no work order, undated out-of-service records,
  booked days that never ran, and the fact that hours are not measured at all. A dashboard that only
  prints what it knows teaches its reader to trust the silence.
- **Consequence.** New module `src/tms/fleetReport.ts` (`fleetReport`, `fleetDayBucket`,
  `FLEET_BUCKETS`, `currentMonthToDate`, `previousPeriod`); new screen `src/screens/Fleet.tsx` on a
  `fleet:read` route; `settings.fleetStandingCostPerDay` with validation in `update_settings` and a
  field under Settings → Fleet; schema 30. 31 new tests (21 in `fleetReport.test.ts`, two of them
  migration cases; 1 settings command; 8 screen; 1 settings screen).

## D-113 - Every screen that totals something can hand it to a spreadsheet (RPT-04)

The brief asks for filters and CSV export on the reports. The rental, financial and staff transport
reports had both; three screens that total money or days had neither — the **finance home**, a
customer's **statement** and the new **fleet dashboard** — and three separate copies of the same CSV
writer had grown in the reports, each a little different. This note records what was done and what was
deliberately not done.

- **Decision 1: one writer, in `src/tms/csv.ts`.** Quoting, line breaks and the trailing-newline
  question are answered once. The three reports were moved onto it and their own copies deleted; the
  tests that pinned their output still pass, which is how the refactor was proved rather than claimed.
- **Decision 2: a spreadsheet formula is defused, because half the text is typed by people.** A cell
  beginning `=`, `+`, `-` or `@` is executed by Excel, LibreOffice and Google Sheets. A description
  entered as `=HYPERLINK("http://…")` is a real attack on whoever opens the file, and the person
  recording an expense should not have to think about it. Such **text** is prefixed with an
  apostrophe; **numbers are never touched**, because a negative amount is a number and must stay one.
- **Decision 3: the export is the screen's own numbers, written out.** No figure is recomputed for the
  file: `fleetReportCsv` formats the report object, `statementCsv` formats the statement,
  `financeHomeCsv` formats the finance home, and the expenses export is handed the screen's own total,
  counts and categories — which is why its rows are the whole period rather than the search box's
  subset, since a filtered file would not add up to the total printed on the same page. A file that added up on its own would be a fourth place
  for the figures to disagree.
- **Decision 4: a block with nothing in it says "none", rather than ending silently.** In the finance
  export, a reader cannot tell an omission from a zero. Every block keeps its heading.
- **Decision 5: the statement gets a CSV as well as its sheet.** D-90 called the statement a document
  rather than a data export, and it still is — the printed sheet is what a customer receives. The CSV
  is the same rows for whoever reconciles the account, and it does not change the document.
- **Decision 6: nothing is uploaded and nothing is stored.** `src/ui/download.ts` builds the file in
  the browser from the payload the server has already narrowed to the signed-in role, so an export
  cannot contain a row the person could not see. There is no server route for exports, no file kept
  on the machine and no email.
- **Decision 7: the filters half of RPT-04 is not finished, and is not pretended to be.** The brief
  also names filters by service, client, customer, route, driver, vehicle and status. Those screens
  have their own filters (period, category, search, status) and the reports have a date range, but
  there is still no bar that narrows a report by client, route, driver or vehicle. That is a separate
  piece of work with its own problem — a filtered KPI is not the KPI any more, and needs its own
  stated definition — so the item stays **partial** and says so.
- **Consequence.** `src/tms/csv.ts` (`csvCell`, `toCsv`), `src/ui/download.ts` (`downloadTextFile`,
  `csvFileName`), `fleetReportCsv`, `statementCsv`, `financeHomeCsv` and `expensesCsv`; Download CSV on the finance
  home, the statement, the fleet dashboard and the expenses screen; the Reports screen's two blob blocks replaced by the
  shared helper. No schema change, no server change, no dependency. 25 new tests (7 on the writer,
  3 on the download, 9 on the four builders, 6 on the buttons).

## D-114 - A client sees the billing on its own invoices, and nothing else (CLI-03)

The corporate dashboard was built to be "limited to the client's own records" and it was — routes,
roster, rental requests, agreements — with one conspicuous gap recorded honestly in the register: **no
invoices or payment status**. The reason was a decision, not an oversight: D-86 and D-92 said a credit
note and a refund are billing, so they travel with the invoice and never to a bound account. That rule
was right for a *driver*, and for a client contact it produced a dashboard that could not answer the
only question a customer opens it to ask.

- **Decision 1: a client contact reads its own client's billing.** `invoices:read` is held by
  `client_contact` and own-record scoped. The narrow form is the same shape the portal already uses for
  routes and rentals: the invoices naming this client, or billing a rental that belongs to it, and
  nothing else. It is a **read** permission: a client contact still cannot issue, void, credit, record a
  payment or pay money back.
- **Decision 2: the four collections move together.** The invoice, the payments against it, the credit
  notes off it and any refund paid back are narrowed by one function (`clientBilling` in
  `src/tms/scope.ts`) and sent together. An invoice with its total but not its payments reads as a debt
  the customer has already paid; a balance without its credit notes reads as money still owed on a bill
  the office already reduced. Sending one of the four would have been worse than sending none.
- **Decision 3: the balance is the shared rule, not a second one.** The portal states every figure
  through `invoiceBalance` (D-86), the same function behind the printed statement and the finance home,
  so a cancelled payment never arrives and a credit note reduces what is owed wherever it is read. A
  portal that subtracted on its own would be a fifth place for the same number to disagree.
- **Decision 4: the client is matched on the client *or* the rental.** Invoices written before buyer
  details were copied onto the document (CUS-01) carry only the rental. Matching on the client alone
  would hide a customer's own older bill from them — a silent understatement of what they owe, which is
  the worst direction for that mistake to run.
- **Decision 5: narrowed twice, as everything else in the portal is.** The server removes what the
  account may not read; the portal applies the same scope again to whatever it holds. The screen test
  that proves it hands the browser the *whole* database and asserts the other customer's invoice is not
  on the page — the second narrowing is the control being tested, not a formality.
- **Decision 6: no figure is invented where none can be stated.** An account never billed says so. Two
  currencies are never added together: the invoices are listed one by one and the page says why there is
  no total. A void invoice is not stated at all — it never asked for money.
- **Decision 7: nothing is downloadable from the portal yet.** A client contact can now read the
  account, and there is no statement to save: the printable statement (D-90) is the office's document,
  and sending a customer their own PDF raises the same unanswered question as sending an invoice (Q-51)
  — nothing is emailed in this build. It stays on the open list rather than being half-built.
- **Rejected:** keying the portal on the customer **name**, which is how the office statement groups
  invoices. Two customers may share a name, and a browser-side grouping by name would then show one
  company the other's bills. The portal keys on the client record.
- **Consequence.** `clientBilling` in `src/tms/scope.ts`; the four collections in the bound-role branch
  of `src/server/visibility.ts` (they were hard-coded empty); `invoices:read` for `client_contact`;
  `src/tms/clientAccount.ts` (`clientAccount`); the account, payments and adjustments panels in
  `src/screens/ClientPortal.tsx`. No schema change, no server route, no dependency. 19 new tests, and two payload
  tests rewritten to assert the narrower rule that replaced them.

## D-115 - The dispatch board reads the day; the run sheet works it (DSP-01)

The brief asks for a daily dispatch board and the build already had most of the material: a run sheet in
departure order, unassigned runs, a planning aid, delays. What it did not have was a screen organised
around the question a supervisor asks before anything else in the morning — *what is wrong with today?*
Answering that from the run sheet meant reading every row and holding the day in your head.

- **Decision 1: a separate board, which reads and changes nothing.** The run sheet is organised around
  what to do next to one run; the board is organised around the state of the whole day. Putting the
  board's panels onto the busing screen would have made one very long page with two competing purposes.
  Putting the *actions* on the board would have made two places to press the same button, and two ways to
  get the same thing wrong. Every command stays on Staff busing, and the board links to it.
- **Decision 2: a table, not a calendar.** The brief allows either. A calendar's value is seeing a week;
  a dispatch board's value is seeing **one day in order**, with the state of each run beside it. The
  existing date control gives the week when it is wanted, one day at a time, without a component that
  has to be maintained for the other four days of the week it is not showing.
- **Decision 3: a capacity warning blocks, it does not shade a cell.** Roster plus booked seats against
  the seats on the bus is a safety limit, not a fullness indicator. The brief calls it a warning; treating
  it as a background colour would have made the most serious fact on the page the quietest.
- **Decision 4: one definition of a blocked vehicle.** The board asks `fleetStateOf`, the same function
  the vehicles register and the fleet dashboard use. A second rule written for this screen ("status is
  maintenance") would have missed the work order that put the bus in the workshop without changing the
  register — the exact case the board exists to catch.
- **Decision 5: blockers are structured, sentences are derived.** Each run carries `blockers`
  (`no_vehicle`, `no_driver`, `vehicle_unusable`, `driver_unusable`, `over_capacity`) **and** the
  sentences for the screen. The counts read the structured facts, so a count can never disagree with the
  words beside it because somebody reworded a sentence.
- **Decision 6: filters narrow the list, never the day.** A supervisor filtering to one route still
  wants to know that two runs elsewhere have no driver. The figures and the warning stay the whole day's,
  `dayRuns` travels with them, and the screen says so in the card description.
- **Decision 7: free means nothing on it that day.** Free takes account of hires that cover the date,
  not only runs; a vehicle with nobody on it but a work order open is listed *last* with the reason, and
  a driver whose licence has lapsed is a name to ring rather than a driver to send. Nothing records hours
  on duty, so "free" never claims a driver has rested — the limit is printed.
- **Decision 8: the missing filter is stated, not faked.** The brief lists a service filter; a run carries
  no service type in this build (TRP-01). Rather than a control that filters on the route's client and
  calls it service, the board prints the limit as its first line.
- **Decision 9: the nav badge is the day's outstanding problem.** Runs still to leave with no vehicle or
  no driver — not a count of all runs, which would be a badge that is never zero and therefore never read.
- **Consequence.** `src/tms/dispatchBoard.ts` (`dispatchBoard`, `BOARD_LIMITS`, `licenceDaysLeft`),
  `src/screens/DispatchBoard.tsx`, the `dispatch` route and nav entry (gated on `trips:read`), and its
  badge in `App.tsx`. No schema change, no server route, no new permission, no dependency. 15 new tests.

## D-116 - The customer's yes is its own record, and not a payment (RNT-05)

A quotation has been going out to customers since Phase 11, and the only place their answer could be
kept was in somebody's head or in the free-text notes on the request. The office confirmed a hire on the
strength of a phone call, and nothing in the system said whether the customer had ever agreed to the
figure on the sheet — nor to *which* figure, after a requote.

- **Decision 1: a separate acceptance record, not a status and not a badge.** `Rental.acceptance`
  (`RentalAcceptance` in `src/tms/types.ts`) carries who answered, when, through which channel, the
  quotation's `quotedAt`, its total and deposit as they stood, and an optional note. A status alone
  would say *that* somebody agreed, never *to what*.
- **Decision 2: the figures are copied, not looked up.** The record holds the total, the deposit and the
  quotation's own timestamp rather than pointing at `rental.quote`. A requote after an acceptance
  therefore does not silently inherit an agreement given to a different figure: `acceptanceStateOf`
  reads the pair and reports the older yes as **superseded** in words — *"the quotation has been
  replaced since. The figure on record now is different."* A reference would have made the agreement
  follow the price, which is the one thing it must not do.
- **Decision 3: a lapsed quotation cannot be accepted.** The validity date is a promise about a price,
  and honouring it after it has run out is a decision for the office, not a side effect of a button.
  The refusal says the date and tells them to issue a new one.
- **Decision 4: one yes per quotation.** A second attempt is refused and names the first
  (*"already accepted on 2026-06-09 by Ama Boateng"*), rather than quietly overwriting the record.
- **Decision 5: accepting is not paying.** The command changes no money and no status: the status still
  moves to `confirmed` when the deposit is recorded, and the deposit is recorded by finance. Agreeing to
  a price and sending money are different acts, and collapsing them would have broken D-90's rule that
  one place records money.
- **Decision 6: the channel is recorded, in plain words.** `client_portal` when the customer pressed the
  button themselves, `office` when a member of staff recorded a yes given on the phone. The difference
  matters when a figure is disputed: one is the customer's own act in the system, the other is the
  office's word about it, and the sentence on screen says which.
- **Decision 7: the customer can only answer its own quotation.** `rentals:accept` is held by the
  administrator, operations, finance and the client contact; the client contact is confined to its own
  client's requests exactly as `rentals:create` is, and a refusal for another customer's hire says
  *"This request is not on your account."* — it does not reveal that the reference exists.
- **Decision 8: nothing is claimed that did not happen.** No notification is sent, because there is no
  mail or SMS provider; the register row keeps that as its remaining gap rather than calling RNT-05 met
  on the strength of a record nobody was told about.
- **Consequence.** `src/tms/acceptance.ts` (`acceptanceStateOf`, `acceptanceLine`, `canAcceptQuotation`,
  `buildAcceptance`), `acceptance` on `Rental`, schema **31** with a migration that fills `null` (no SQL
  migration: the rental row is a JSON document), the `accept_quotation` command, the `rentals:accept`
  permission, the portal's quotation column and **Accept quotation** panel, the office's **Record
  customer acceptance** action, and 19 new tests (11 domain, 6 service, 1 scoping, 1 portal screen) —
  the suite moves from 1,135 to 1,154.

## D-117 - A quotation is a document with a number, a clock and its own words (RNT-04)

The quotation builder has carried line items, a deposit and a validity date since Phase 11, and it has
been the least finished document in the system. It had **no number**: the customer was told "RR-0001"
— the request — and, after a revision, nobody could say which version of the price they had agreed to.
It held a price for a number of **whole days**, so a quotation issued at 16:50 on a Friday and one
issued at 09:10 the same morning both ran out at the same moment. And it carried **no terms at all**.

- **Decision 1: the quotation gets its own series.** `QUO-0001`, drawn from the same allocator every
  other record uses (a counter, not the length of a list, so simultaneous issues cannot collide and a
  deleted record cannot reissue a printed number). `references.integration.test.ts` walks every series
  and inserts a counter for it, so migration `021` widening the constraint is tested rather than
  trusted — that check exists because refunds were once refused by a database that had never learned
  their name.
- **Decision 2: a revision keeps the number.** The document is the quotation; revisions are versions
  of it. `number` stays `QUO-0001` and `revision` goes 1, 2, 3. A customer holding the sheet says
  "QUO-0001, revision 2", and the office can put that exact version on screen. Two numbers for two
  versions of one price would make that sentence impossible.
- **Decision 3: validity is counted in hours, and compared to the minute.** Nine-to-five businesses do
  not agree to prices that lapse at midnight, and a customer ringing at 09:05 for a price that ran out
  at 09:00 deserves a straight answer. The setting moved from `quotationValidityDays` to
  `quotationValidityHours` (schema 32, with old days converted at 24 hours a day — the same promise of
  time, not a rewritten one), `validUntil` became a timestamp instead of a date, and every check — the
  customer's acceptance, the deposit, the renewal — compares instants.
- **Decision 4: the terms are the company's, and there are no default terms.** A default indemnity,
  default cancellation window or default "50% deposit" clause would be a contract term nobody in the
  business agreed to. `settings.rental.quotationTerms` starts empty, and while it is empty a quotation
  cannot be issued; the screen says why and sends the reader to Settings. The terms are **copied** onto
  each quotation as they stood when it was issued, for the same reason the acceptance copies its
  figures: changing the terms tomorrow must not rewrite what a customer was sent today.
- **Decision 5: old quotations are marked, not backfilled.** A quotation written before schema 32 has
  no number, no revision and no terms. Rather than invent `QUO-0000` or stamp today's terms onto a
  document that was never sent with them, the migration gives them an empty number, revision 1 and
  blank terms, and the screen prints a warning that the quotation has no number and cannot be handed to
  a customer as a document. Nothing is invented; the office reissues it.
- **Decision 6: the customer sees the same document.** The portal's quotation column carries the
  number and revision, and the acceptance panel prints the figure, the deposit, the terms and the exact
  moment the price stops holding before the customer presses accept — the same facts the office sees,
  because agreeing to a price you cannot read is not agreeing to it.
- **Consequence.** `src/tms/quotations.ts` (`validityEndsAt`, `quotationIsLive`, `validityLine`,
  `quotationHeading`, `quotationIsNumbered`, `termsProblem`, `validityProblem`), the `quotation` series
  in `references.ts`, `Quote.{number, revision, terms, driverIncluded}`,
  `RentalSettings.{quotationValidityHours, quotationTerms}`, schema **32** with the days → hours
  migration, SQL migration `021`, the terms field in Settings, the quotation card on Rentals and the
  number in the customer portal. 15 new tests (10 domain in `quotations.test.ts`, 5 service); the
  suite moves from 1,154 to 1,169. No new permission and no new dependency.

## D-118 - A completed hire records the journey, not only the money (RNT-07)

Completion has always produced the final invoice and nothing else. The record could say the hire was
billed at GHS 3,000 and could not say when the bus left, when it came back, how far it went, whether it
returned damaged, or what the customer said afterwards. Those are the facts the next price is built on
and the ones a damage claim is argued from, and they were living in the office's memory.

- **Decision 1: the run is its own record on the hire.** `Rental.run` (`RentalRun`) holds departure,
  return, two odometer readings, the distance and where it came from, the damage note, the customer's
  feedback and who recorded it. Not free text on the request, and not fields on the invoice: a hire
  that is cancelled before it runs has no run, and an invoice is a money document that is frozen once
  issued.
- **Decision 2: the departure is recorded when it happens.** `start_rental` writes `departedAt` as it
  records the hire going on the road, because the office will not remember the minute next week. The
  completion form shows it and can correct it — a correction is a fact somebody typed, not a silent
  overwrite.
- **Decision 3: a distance is measured or typed, and says which.** Two odometer readings give a
  distance the vehicle itself supports (`distanceSource: "odometer"`); a figure typed because nobody
  read the dial is `"entered"` and prints as *"entered by the office, not from an odometer reading"*.
  Both are useful; treating the second as the first would make a guess look like a measurement.
- **Decision 4: two answers to one question is a refusal, not a choice.** A typed distance beside two
  readings that give a different one is refused, and the refusal states what the odometer says. Picking
  one behind the office's back is how a dispute starts.
- **Decision 5: nothing is filled in that nobody stated.** No odometer is invented, no distance is
  guessed, and a completion with no journey details records the times (which the system does know) and
  leaves the rest blank. A hire recorded before this existed has `run: null` and the screen says so.
- **Decision 6: an odometer reading is a reading of the vehicle.** When one is entered at the start or
  the end of a hire it also joins the odometer register the service intervals are computed from, so the
  same fact is not typed twice and the maintenance screens get the benefit. Reading it into the hire
  alone would have made the two disagree.
- **Decision 7: the balance is stated where the hire is, from the invoice.** The hire card shows what
  was billed and what is still owed, taken from the invoice raised for this rental and the payments
  against it through the one balance rule (D-86) — so it cannot disagree with the invoice the customer
  is holding. A hire with no invoice says "no invoice has been raised yet" rather than showing zero:
  nought owed and nothing billed are different sentences.
- **Decision 8: damage is a record, not a work order.** The note states what came back wrong and does
  not take the vehicle off the road or open a repair. `fleetStateOf` and the work orders remain the
  things that stop a bus, and inventing a work order from a sentence would put a mechanic's job on the
  strength of a remark.
- **Consequence.** `src/tms/run.ts` (`readRun`, `readInstant`, `runDuration`, `distanceLine`, `runLine`,
  `damageLine`, `rentalBalance`, `balanceLine`), `Rental.run`, schema **33** with a migration filling
  `null` (no SQL migration: the rental row is a JSON document), `complete_rental` taking a
  `CompleteRentalInput`, `start_rental` reading an optional odometer, the completion form and the
  **What happened** card on the rentails detail, and 25 new tests (20 domain in `run.test.ts`, 4
  service, 1 screen) — the suite moves from 1,169 to 1,195. **Still open:** an approval record for
  additional charges (Q-12), which is a decision about who signs off an extra, not a field.

## D-119 - A rental request records the journey, not just the dates (RNT-01)

The request form asked for the customer, the two dates, the two places and the passenger count.
Everything else the desk was told on the phone had to go into a free-text notes box, if it went
anywhere: that the vehicle leaves at half seven, calls at Achimota on the way, is carrying twelve
suitcases and one wheelchair, and that the office should ring Ama on the morning rather than the man
who booked. A quotation priced from half the facts, and a driver ringing the office at six in the
morning, are what that gap costs.

- **Decision 1: the plan is its own record, and it is the pair to the run.** `Rental.plan` holds the
  two clock times, the stops, the luggage, the special needs, the contact for the day and how the
  request arrived. D-118 gave the hire a `run` for what happened; this is what was asked for, so a
  screen can say *asked for 08:00, left 08:40* without either overwriting the other.
- **Decision 2: a time is one form.** "7:30" is accepted and stored as "07:30"; "7", "8.0", "24:00"
  and "noon" are refused with a plain sentence. One form to type, one form to sort and compare, and
  no guessed clock time for a schedule nobody can argue with.
- **Decision 3: a one-day hire cannot come back before it leaves.** On a same-day request the return
  time must be after the departure time; the refusal names both possible corrections. The two times
  are not swapped behind the office's back, because only they know which of the two is the typo.
- **Decision 4: the duration is worked out, never stored.** `plannedMinutes` derives it from the two
  times and the two dates. A stored duration would eventually disagree with the dates it was made
  from, and the quotation's own day count already exists elsewhere.
- **Decision 5: the stops are a list, in the order given.** One per line, up to eight, each a short
  name; anything longer belongs in the notes. A stop is not a price and not a route — nothing here
  computes mileage, adds a charge or touches a driver's list, because a stop that costs money is a
  decision somebody makes on the quotation.
- **Decision 6: nobody signs off a stop.** There is no approval step, and none is implied: the plan
  records what the customer asked for, and the quotation is still the document that prices it.
- **Decision 7: the source is recorded when somebody says, and left blank when nobody does.** The
  channel is a fact the office chooses from a short list, not something this program infers — a
  request from the public web form records `website` and a portal request records `portal`, because
  those two really are known. An older request has `plan: null` and the screen says its times, stops
  and origin are unknown. Filling blanks in would read as "the customer asked for no stops and no
  luggage", which is a fact nobody stated.
- **Decision 8: a correction keeps what the form leaves out.** `update_rental` merges the plan against
  what the record already holds, so editing the purpose does not wipe the stops. Sending a field
  explicitly — even as empty — still changes it; that is the difference between "nobody mentioned it"
  and "it is cancelled".
- **Consequence.** `src/tms/request.ts` (`readRequestDetails`, `planLine`, `stopsLine`,
  `tripContactLine`, `sourceLabel`, `plannedMinutes`, `planHasDetails`), `src/tms/time.ts`
  (`readClock`, `humanDuration`), `Rental.plan`, schema **34** with a migration that leaves older
  requests with no plan (no SQL migration: the request is a JSON document), the journey block on the
  request form and the matching rows on the request card, and 30 new tests — the suite moves from
  1,195 to 1,225. **Still open:** the customer's own portal form asks only for the basics, so a
  portal-raised request records `source: portal` and nothing else about its journey (RNT-09).

## D-120 - A request has stages, and each stage is a fact somebody can act on (RNT-02)

The request had one state before a price (`draft`) and one after it (`quoted`), so a desk with ten
enquiries could not tell "nobody has looked at this" from "we are waiting on a vehicle check" from
"this is priced and the customer has gone quiet". The brief asked for a longer pipeline: submitted,
under review, awaiting quotation, quotation sent, awaiting the customer's confirmation, confirmed,
dispatched, in progress.

Adding nine words to a screen is easy. Adding nine *states* is only worth doing where each one changes
what the office does next, and where the program can tell it is true rather than hoping somebody
remembers to press a button. That is the test each stage had to pass.

- **Decision 1: three triage stages, and skipping them is allowed.** `submitted` (we have taken the
  request on), `under_review` (somebody is checking the vehicles, the driver's papers and the route)
  and `awaiting_quotation` (checked, waiting for a price). One command, `advance_rental`, moves one
  step forward; nothing can skip a stage or step back. **A quotation can still be issued from any of
  them**, which is the honesty guard: a two-line request must never be held up by paperwork, and a
  stage nobody needs is a stage nobody presses.
- **Decision 2: "quotation sent" and "awaiting the customer's confirmation" are one state here.**
  This program has no mail or SMS channel (RNT-05's standing limit), so a quotation cannot be "sent" at
  one moment and "awaiting" at another: it is issued, and from then on the ball is with the customer.
  The card shows whether they have answered, and D-116's acceptance record says who, when and to which
  figure. Two states for one fact would have been a dashboard that lies.
- **Decision 3: the customer's yes is a stage of its own.** `accepted` — agreed, deposit still to come
  — is the state the business most wants to see at four in the afternoon, and until now it was
  invisible: the hire sat in `quoted` with an acceptance buried in a card. Accepting a quotation moves
  the request to `accepted`; the deposit still confirms it, and the deposit remains the only thing that
  holds a vehicle.
- **Decision 4: one fact, one name — `dispatched` replaces "in progress".** A hire that has left the
  yard is dispatched, which is the word the trip board already uses for the same moment, and it is the
  same instant the hire's run records as its departure (D-118). Keeping "in progress" beside it would
  have meant two names for one fact, and two names is how records start disagreeing. Stored values were
  rewritten rather than translated on the fly (migration `022`, schema **35**), so a query on the status
  column cannot silently miss a hire that is out.
- **Decision 5: a cancelled request is final.** `declined` (the customer said no) and `cancelled` (the
  hire stopped after somebody took it on) have no moves out of them, and a cancellation still needs its
  reason. A request that comes back to life is a new request with a new number.
- **Decision 6: the table lives in one place.** `src/tms/rentalWorkflow.ts` holds the transitions, the
  stages, and the two questions the screens ask — "does this hold a vehicle?" and "whose move is it?".
  The service, the rentals screen, the dashboard and the client portal all read it, so the button a
  screen offers is a move the service accepts.
- **Decision 7: a correction is allowed until a price exists.** Editing was limited to `draft`, which
  became wrong as soon as a request could sit in review for a day: corrections are most likely exactly
  then. All four pre-quote states can be corrected; once a quotation is out, the price is a document.
- **Decision 8: a renewed price puts the request back in the customer's hands.** If an agreed hire's
  quotation is renewed, the hire returns to `quoted`: the acceptance on record refers to the old figure
  and the screen says so (D-116). Carrying `accepted` across a price change would be an agreement
  nobody gave to the new number.
- **Consequence.** `src/tms/rentalWorkflow.ts`, eleven statuses in `RENTAL_STATUSES` with labels the
  office reads (`quoted` prints as "Quotation sent", `accepted` as "Accepted, deposit due"),
  `advance_rental` (permission `rentals:update`), `accept_quotation` writing `accepted`, `start_rental`
  writing `dispatched`, schema **35** with `migrate()` and SQL migration `022` renaming the stored word,
  the six-step progress strip and its one-button triage, the dashboard's "whose move is it" counts, and
  19 new tests (`rentalWorkflow.test.ts`, the pipeline block in `service.test.ts`, the rentals flow in
  `Rentals.test.tsx`) — the suite moves from 1,225 to 1,244. **Not built:** a "dispatched, not yet
  started" state distinct from the hire itself, because the departure time already records that
  moment; and nothing messages the customer at any stage — there is no channel to message them on.

## D-121 - A quotation states what the customer pays, and above a figure somebody else signs it (RNT-04)

**The problem.** A quotation carried lines, a deposit and its terms, and then stopped: no tax and no
discount, so the number the customer agreed to was not the number the invoice asked for — VAT appeared
for the first time a week later, on a different document, worked out by whoever raised the invoice. And
a price of any size left the building on one person's word, with nothing in the record to say anybody
else had looked at it.

**Decision 1: the tax is on the quotation, frozen when it is issued.** A quotation now carries its own
tax lines, copied from the company's settings at the moment it is issued, exactly as invoices already
did. One shape does both jobs (`TaxLine`), because a quotation and the invoice that follows it must
agree field for field or the two documents will drift. Tax appears only when the company has said it is
registered; an unregistered company's quotations are tax-free, not zero-rated by accident.

**Decision 2: the reduction is an amount with a reason, not a percentage.** The office records what it
took off and why, and the reason is required whenever the figure is above zero, because a discount
nobody can explain is the first thing an audit asks about. A percentage would have to be re-applied
whenever the lines changed and can land a pesewa away from what the customer was told; the amount
agreed is the amount on the paper. A reduction larger than the lines is refused.

**Decision 3: the total is the figure, and the deposit is a share of it.** `total = lines − discount +
tax`, computed in whole pesewas with the same single rounding rule invoices use. The deposit percentage
now applies to that total rather than to the untaxed lines: a customer paying a quarter up front pays a
quarter of what they owe, not a quarter of a smaller number the office then has to correct.

**Decision 4: above a figure the company sets, a second person signs it off.** `quotationApprovalAbove`
in settings; `null` means the company has not asked for a second signature, and every screen says so in
those words rather than implying that everything is approved. Three rules make the signature mean
something:

- **not the author's own.** The person who wrote the quotation cannot approve it, whatever their role —
  otherwise the check is a keystroke;
- **tied to the figure.** The approval records who signed, when, the total they signed and an optional
  note. A renewal clears it, and an approval whose total no longer matches the quotation is not current;
- **only while it is out.** An expired quotation cannot be signed (renew it first), and one that has not
  been issued has nothing to sign.

While a signature is outstanding the customer's yes cannot be recorded and the deposit cannot be taken,
from the office or from the portal. Both refuse with the customer's sentence — "the office is still
checking this price" — because a customer does not need to know who signs what inside.

**Decision 5: the audit trail leads with the total.** The entry names the figure the customer was given
and, when there is any working, the lines, the reduction and each tax line behind it. A price is only
traceable if the record shows how it was reached.

**Decision 6: schema 36, and no migration.** Everything new lives inside the quotation already stored on
the rental, so older records read as what they were: a quotation with no discount, no tax and no
signature. Bumping the readable versions is enough.

**Consequence.** `src/tms/types.ts` (`TaxLine`, `InvoiceTaxLine` as its alias, `QuoteApproval`, five new
`Quote` fields, `quotationApprovalAbove`, schema **36**), `src/tms/quotations.ts` (`readQuoteFigures`,
`approvalRequiredAt`, `approvalIsCurrent`, `approvalProblem`, `approvalLine`), `src/tms/service.ts`
(`quote_rental` taking a discount, the `approve_quotation` command, the two gates, a validated settings
field), `src/tms/acceptance.ts` (the unsigned-price refusal the portal and the service share),
permission `rentals:approve` for administrator, operations and finance, the rentals screen's discount
fields, live total and approval panel, the portal's total, discount and tax rows, and 22 new tests — the
suite moves from 1,244 to 1,266. **Not built:** nothing sends a quotation to the customer, because there
is no mail or SMS channel; no waiting or overtime rate is priced (still FIN-01), so a waiting charge is
a handwritten line; and the tax lines are a record of what was charged, not a tax return.

## D-122 - A register can be sorted, and the order belongs to the screen (interface)

**The problem.** Every register here shows rows in the order its own logic chose: invoices newest
reference first, the audit log newest entry first, rental requests the same. That is the right order to
open on and the wrong order for the question people actually ask of a register — "who owes the most",
"what did we spend on fuel", "who touched this record". The only way to answer it was to read the whole
list, or to export it and sort in a spreadsheet, which is an odd thing to ask of a program that already
knows the numbers.

**Decision 1: the sort lives in the screen, not in the table.** The table draws the control and reports
the click; the screen holds the state and hands the table the rows in order. It is more wiring than an
array sorted inside the table, and it buys one thing that matters: anything the screen exports or prints
is built from the same ordered rows, so a file cannot come out in a different order from the screen it
came from. Where a screen deliberately exports something other than what is displayed — expenses export
the whole period rather than the filtered rows, D-113 — the code says so where the export is written.

**Decision 2: three states, not two.** Clicking a header sorts ascending; a second click reverses it; a
third puts the screen back the way its own logic ordered it. Two states would have left no way back
except reloading, and a descending "newest first" is not the same list as the screen's own newest-first
(because it is sorted on the clicked column, not on the reference). Clicking a different column starts
at ascending rather than inheriting the last direction: a click on "Total" should not arrive backwards
because "Customer" happened to be.

**Decision 3: the header says which way, in words a screen reader can hear.** `aria-sort` on the header
cell, `none` only on columns that can actually be sorted — the attribute on a plain column invites a
reader to try. The arrow is drawn with borders and hidden from assistive technology, because the state
is already spoken; colour is not the only carrier, since one triangle rather than two also says it.

**Decision 4: no remembered sort, no animation.** The sort is a way of looking at a list, not a
preference: reopening a register should show the list everyone expects, not the last person's click. And
nothing moves — no arrow transition, no row animation — because a table that shuffles itself is harder
to read, and because the direction never asked for motion (D-121's sibling rule in the interface work).

**Decision 5: three registers, not twenty.** Invoices, rental requests and the audit log carry a sort
today. They are the ones where the question "in what order" is asked out loud. Any other register adopts
it by giving its columns a value to sort by and calling the same hook; nothing else has to change.

**Consequence.** `src/ui/tableSort.ts` (the rules, the ordering and the hook), `Column.sortValue` and the
optional `sort` / `onSortChange` on `DataTable`, the header button and the arrow in `src/index.css`,
three screens wired to it, and 15 new tests (`tableSort.test.ts`, the header block in
`primitives.test.tsx`, and two in `Invoices.test.tsx` that sort the real register and then check the
filter still holds). **Rejected from the reference:** animated and iridescent loaders, upload rings,
activity widgets, gradient charts, hover motion, and importing the library itself — the same three
things the owner ruled out (motion, gradients, 3D) dressed as a component registry. **Not built:**
sorting inside a printed sheet, since a print is a document in its own order; and a saved view, which
would need somewhere to keep it per user.

## D-123 - A charge added after the price was agreed needs a reason, and above a figure a second name (RNT-07)

**The problem.** The quotation is agreed before the vehicle leaves; the extras are decided after it
comes back. Fuel, a torn seat cover, an hour of waiting somebody agreed on the phone — the office types
them into the completion screen, they join the final invoice, and nobody else ever looks at them. That
is the one place in the money trail where the person who benefits from a figure is also the person who
writes it: everything before it — the price, the discount, the deposit — has a document behind it, and
everything after it is checked by whoever raises the invoice. Q-12 had been open on exactly this point.

**Decision 1: a charge is a record, not a line item.** Each charge now carries a description, a
quantity, an amount, **the reason the customer was given**, who added it and when. The reason is
required, and it is printed on the invoice line, because a customer charged for something nobody
explained is the first line of a dispute. The charges are kept on the hire as their own collection
rather than as anonymous invoice lines, so the screen can say what was added after the event and the
audit trail can name each one.

**Decision 2: the charge is on the hire; the bill is what waits.** Completion records the charge and
adds it to the final invoice's lines, so the hire's own total says what was supplied. What the signature
gates is `issue_rental_invoice`, not completion: refusing to record that the vehicle came back with a
broken seat would be refusing to record a fact because the money around it is unfinished.

**Decision 3: above a figure the company sets, somebody else signs it.** `extraChargeApprovalAbove` in
settings, and `null` means the company has not asked for a signature on charges — which the screens say
in those words rather than implying the money was checked. The rule is the same four eyes as a quotation
(D-121): the person who added the charge is never the person who approves it, an approval is given once,
and it belongs to the amount it was given for, so a charge edited afterwards is not the charge that was
signed. One new command, `approve_extra_charge`, under the existing `rentals:approve` permission.

**Decision 4: an approval after the bill is refused, not ignored.** Once the invoice exists the charge
is on a document the customer holds, and an approval recorded afterwards would change nothing while
looking like it had. The refusal names the invoice and points at the credit note, which is the only
honest way to take money off a bill that has gone out (D-86).

**Decision 5: schema 37, and older hires carry no charges.** Everything new lives on the rental record.
A hire completed before this phase gained nothing: it was billed for what it was billed for, and a blank
charge invented to fill the shape would be a fact nobody stated.

**Consequence.** `src/tms/types.ts` (`Approval`, with `QuoteApproval` as its alias, `ExtraCharge`,
`Rental.extraCharges`, `RentalSettings.extraChargeApprovalAbove`, schema **37**), `src/tms/extraCharges.ts`
(the reading, the arithmetic, the four-eyes rule and the sentences), `src/tms/service.ts`
(`complete_rental` taking charges, `approve_extra_charge`), `src/tms/finance.ts` (the bill waits while a
charge is unsigned), the completion screen's charge rows, the hire's charge card with its approval line,
the settings field, and 23 new tests — the suite moves from 1,281 to 1,305. **Not built:** no waiting or
overtime *rate* is priced (still FIN-01) — a waiting charge is a figure somebody types, now with a reason
and a signature; and nothing tells the customer about the charge, because there is no mail or SMS channel.

## D-124 - One token file, one accent, and components that take their data (interface)

**The problem.** The screens were built one at a time, each with its own idea of a card: 1,674
`className` literals, 485 leftover `stone-*` utilities, five hand-rolled tables and a second stylesheet
(`src/styles/tokens.css`, indigo) that only some screens read. Nothing was wrong with any single
screen; the collection was. Two screens could show the same state in two colours, and a new screen had
to copy whichever one it was near. This phase builds the pieces the screens will be made of, and one
page that uses nothing else.

**Decision 1: the tokens live in one file.** `src/app/globals.css` is the only place a colour, radius,
easing, type size or status tint is written down, declared through Tailwind 4's `@theme` (there is no
`tailwind.config` in this build, and adding one would be a second source of truth). Components ask for
`bg-card`, `text-dim`, `rounded-card`, `animate-fade-up`; no component writes a literal value. The old
`tokens.css` is deleted; `src/styles/legacy.css` remains **temporarily** for the screens that have not
been converted, is imported only by `globals.css`, and may not gain another rule.

**Decision 2: one accent, and state that is never only a colour.** Amber `#FF8A00` is the only accent,
with `#0E0E10` as its ink; everything else is a neutral grey or one of four status colours. A badge is a
13% tint of its status colour with the same colour as text, a 6px dot and — the part that matters — a
word. `dim` `#8A8882` is the floor for text: nothing is set lighter than 5.4:1 on the card surface, and
4.58:1 on a hovered row. Contrast was measured rather than eyeballed.

**Decision 3: a component takes its data.** Every component in `src/components/tms` receives props and
imports nothing from `src/lib/mock`. The dashboard asks `overviewSample(range)` for a payload shaped
like the one a query will return; replacing that call with a fetch changes nothing in the components.
The payload says in words that it is sample data, and the page prints it.

**Decision 4: the map is a component, not a claim.** There is no telematics provider in this system and
none was added: MapLibre is outside the sanctioned library list and needs a style endpoint this
deployment does not have. `<FleetMap />` draws route lines and markers from props on a static SVG
canvas, its props are the shape a real map would need, and both the card and the payload's caption say
the positions are illustrative. Nothing on the page implies live tracking exists.

**Decision 5: a control that cannot act says so.** "New booking" is the primary action of the board, and
booking intake is a later phase. It opens a dialog that states where a booking is recorded today and
links to it, rather than accepting a booking the review build cannot keep. The section menu lists only
screens that exist; an unbuilt one renders disabled with the word *planned* beside it, which is why the
menu already knows about trips, vehicles and invoices without linking to them.

**Decision 6: TanStack Table's feature set is declared once.** Version 9 registers features explicitly
rather than switching them on with row-model options, so `DataTable` declares core rows plus sorting
with two string comparators at the top of its own file, and exports `TmsColumn<T>` so a screen never
names the feature set. A column opts out with `enableSorting: false`.

**Decision 7: motion is CSS, on two named curves.** `--ease-spring` and `--ease-glide`; cards rise 14px
into place 80ms apart, bars grow from the bottom, the ring draws once, live dots pulse, and a primary
button moves 3px down under the finger. There is no animation library. `prefers-reduced-motion` stops
all of it and hides nothing.

**Consequence.** `src/app/globals.css` (tokens, semantic map, utilities, keyframes, reduced motion),
`src/lib/mock/{types,overview.sample}.ts` (the payload and its shapes), thirteen components in
`src/components/tms` (shell, rail, top bar, palette, page header, stat card and grid, panel, status
badge, table, ring, activity feed, live dot, map, states, and the booking dialog), two routes —
`/dashboard` and `/design` — and 31 new tests: the suite moves from 1,305 to 1,336. **Not built:** no
screen outside these two has been converted (27 still read `legacy.css`), booking intake has no form, and
nothing here reads the database — the board is a review of an interface, not a second source of records.

## D-125 - One palette for the whole application, and the motion that belongs to it

**The problem.** Phase 74 built a dark design system and proved it on two new pages. The twenty-seven
working screens were still painted from `legacy.css` — a white canvas (`#f5f6f9`), white cards, dark
ink and an indigo accent — so the product had two design languages and a visible seam between them:
a dark rail around a light page, and a sign-in screen that flashed white before the app appeared.

**Decision 1: re-point the old palette, do not rewrite the old screens.** `legacy.css` keeps every
selector it had; only the values inside `:root` changed — canvas, card, ink, muted, line, the accent and
the five status families now read the same colours as `globals.css`, and the status "soft" backgrounds
became 13% tints of the dark status colours. One edit, twenty-seven screens on the dark surface, no
screen's markup touched, nothing left half-painted. The file remains temporary and still shrinks screen
by screen as each is rebuilt structurally.

**Decision 2: the leftover utilities were remapped, not left to chance.** 494 `stone-*` (and one
`bg-white`) class tokens across 25 files became semantic ones — `text-stone-900` → `text-foreground`,
`text-stone-500/600` → `text-muted-foreground`, `text-stone-400` → `text-dim`, `border-stone-200` →
`border-border`, `bg-stone-50/100` → `bg-muted`. Text set in white was white-on-accent in the light
theme; on the dark palette that rule becomes dark ink on amber, which is the same intent and 8.16:1
rather than 2.6:1.

**Decision 3: one frame for the working application.** `AppFrame` replaces the hand-built rail and
header inside `App.tsx`: the current section is a filled accent tile instead of a pale one, each section
carries the day's count, the rail collapses into a sheet on a phone, and the content arrives on the
glide curve when the route changes. The frame is given groups, a current key and a callback, so it knows
nothing about the screens it wraps — which is why one component can hold twenty-odd destinations while
they are converted one at a time.

**Decision 4: four moves, borrowed and cut down.** Two libraries were read for this — the spring
vocabulary at kinetics.colorion.co and the pure-CSS button catalogue at animatedbuttons.colorion.co.
What survived is what a dense work surface can carry: **sheen** (one diagonal highlight across a primary
action, once, on hover), **a gliding pill** in the segmented control (it measures the chosen option and
travels to it, while the buttons underneath stay a real radio group), **a spotlight** (a card warms
towards the pointer, position written straight to a CSS variable so nothing re-renders), and **an
arriving page** (content rises 6px on the glide curve when the screen changes). A figure that changes
value bumps once, and only when it changes — nothing bounces merely because a page opened. Everything is
CSS or a few lines of pointer handling; no animation library was added, and `prefers-reduced-motion`
stops all of it without hiding anything.

**Decision 5: what was rejected, and why.** Magnetic buttons that pull towards the cursor, tilt-on-hover,
animated gradients, neon edges and cursor trails were all available and are all wrong here: a dispatcher
works in a table for hours, and a control that moves away from the pointer costs accuracy. The credit
line is the honest one — the motion vocabulary is inspired by those libraries, not copied from them.

**Consequence.** `src/styles/legacy.css` (palette re-pointed), 25 screen files (utilities remapped),
`src/components/tms/AppFrame.tsx` (new), `GlidingTabs.tsx` (new), `useSpotlight.ts` (new), `StatCard`
(spotlight and bump), `PageHeader` (gliding pill and sheen), `src/screens/Auth.tsx` (first-run and sign-in
rebuilt on the dark surface, with the brand half as a statement), `globals.css` (interaction layer:
`--ease-overshoot`, `page-in`, `bump`, `toast-in`, `.tms-page`, `.tms-sheen`, `.tms-spotlight`,
`.tms-aurora`), and four new tests — the suite moves from 1,336 to 1,340. **Not built:** the working
screens' own layouts, tables and forms are still the pre-migration ones; they read the new palette but
have not been rebuilt on the new components, which continues screen by screen. No screen gained a
feature, a fact or a figure in this pass.

## D-126 - The register table is the count, and an audit reads it against itself

**The problem.** The whole-system audit of 28 October 2026 found that `docs/PROGRESS.md` claimed the
feature register held "72 IDs: 34 met, 26 partial, 12 deferred" while the table beneath the sentence
held 78 rows, 39 of them Met and 13 Deferred. `docs/STATUS.md` said 14 deferred, and the setup guide
advertised the database suite as 14 tests in 4 files when it was 28 in 5. Every number was written by
hand at the time it was true and never re-derived, so the documents disagreed with the product and with
each other. The owner reads those documents to decide what is left to buy and build; a tally that is
five rows wrong is a business error, not a typo.

**Decision 1: derived numbers are computed from the table, never maintained beside it.** The count of
Met, Partial and Deferred rows — in total and per phase — is read from the register table itself. When a
row changes status, the prose line is recomputed at the same time. A number that cannot be re-derived
from the table does not go in the document.

**Decision 2: the audit is a first-class artefact, and it is written down.** `docs/AUDIT.md` records the
commit audited, what could not be reached from this workspace (a real browser, the office machine, any
provider that is not installed), the findings with evidence, and the commands that reproduce them. Each
further audit appends to that file rather than living in a chat message.

**Decision 3: findings are not silently fixed when the fix is the owner's to choose.** Unused
components (`alert`, `avatar`, `command`, `dropdown-menu`, `popover`, `select`, `skeleton`, `tabs`,
`textarea`, `tooltip`) and the unused `recharts` and `cmdk` packages are reported and left in place,
because keeping the library's shelf is a legitimate preference and deleting it is the owner's call.

**Consequence.** `docs/AUDIT.md` (new), the tally line and heading in `docs/PROGRESS.md`, the deferred
section of `docs/STATUS.md`, the database-suite line in `docs/SETUP_AND_DEPLOYMENT.md`, and this
decision. No product code changed in the audit: the tree at `5aed55e` passed every gate, and the audit's
own contribution is a corrected record. Counts: register 78 (39 Met / 26 Partial / 0 not built / 13
Deferred); suite 1,340 tests; database suite 28 tests in 5 files.

## D-127 - The shelf holds only what a screen imports, and prose is not a source of classes

**The problem.** The audit of 28 October 2026 found ten components in `src/components/ui` that no file
imports (`alert`, `avatar`, `command`, `dropdown-menu`, `popover`, `select`, `skeleton`, `tabs`,
`textarea`, `tooltip`), a `recharts` dependency imported nowhere, and a `cmdk` dependency reachable only
through `command.tsx` — which was itself one of the unused ten. It also found that `globals.css` pinned
`tailwindcss` exactly while taking `@tailwindcss/postcss` on a caret range, so the compiler and its
plugin could drift a minor version apart on a future install.

**Decision 1: delete, do not shelve.** A component that no screen imports is code no test covers and no
type-check exercises through use; it is the part of the tree that rots quietly. These are shadcn
components — the source lives in this repository and can be re-added from the registry in a minute when
a screen actually needs one — so keeping them "for later" buys nothing and costs a maintenance surface.
Ten files went, `recharts` and `cmdk` went with them, and the nine components in use (`badge`, `button`,
`card`, `dialog`, `input`, `label`, `separator`, `sheet`, `table`) stayed.

**Decision 2: paired build tools are pinned to the same exact version.** `tailwindcss` and
`@tailwindcss/postcss` are both `4.3.3`, exact. A caret on one side of a pair that must agree is how a
project ends up compiling with one minor and post-processing with another.

**Decision 3: only `src/` may declare a class.** Tailwind's automatic detection walks the project, and
`docs/DECISIONS.md` quotes old utilities in prose — D-125 lists the `stone` classes it replaced. The
build was therefore emitting a `.text-stone-500\/600` utility from a sentence: a dark text colour, at
4.1:1 on the dark card, one keystroke away from appearing on a screen. `globals.css` now says where
classes may be found (`@source not` for `docs/`, `README.md` and `audit/`), and the compiled stylesheet
contains no literal text colour at all — every colour comes through a token.

**Consequence.** `src/components/ui/*` (ten deleted), `package.json` and `package-lock.json`
(`recharts`, `cmdk` removed; Tailwind pinned), `src/app/globals.css` (source declarations),
`docs/DESIGN.md` (no chart library), `docs/AUDIT.md` (P2-2 and P3-1 marked closed, with the prose-source
fault added to P2-2). Gates after: `tsc` clean, `eslint` clean, 1,340 tests passed (28 skipped — the
count is unchanged because nothing under test was deleted), build 62 s, coverage 89.24 / 76.79, and the
compiled CSS scanned clean. **No screen, table or form changed.**

## D-128 - The first working screen rebuilt on the component layer, and the three things it needed

**The problem.** Phase 74 built a component layer and proved it on two review pages; Phase 75 put every
screen on the dark palette. But the twenty-seven screens that record and read the company's work were
still built from the older primitives and `legacy.css`. The audit log was chosen first because it is
small, read-only, and the screen an owner is shown when they ask "who changed this?" — a fair test of
the method with nothing at stake if the method is wrong.

**What it took.** Three small pieces were missing from the layer, and none of them was invented for one
screen:

1. **A header without a period.** `PageHeader` demanded a reporting period, because the board it was
   built for has one. An append-only log has no "this week" — every entry is the record — so the range
   became optional and the header gained a `kicker` (the mono line the older screens all carry) and an
   `actions` slot for the screen's own controls. A screen with no period draws no control to explain
   away.
2. **A row window that is honest.** The log draws at most 500 matches. That cap belongs to the table,
   not to the screen, because it must be applied **after** sorting: sorting the newest 500 and calling
   the result "oldest first" would hide exactly the entries the sort was asked to bring forward.
   `DataTable` gained `limit`, applied to the sorted row model, and the screen prints "showing N of M".
3. **A filter pair.** `SearchField` and `FilterSelect` name themselves for a screen reader, take their
   caret from a Lucide icon rather than a colour baked into a data-URI, and are native controls — a
   native select is keyboard- and phone-drivable without a library, which matters more now that the
   unused shadcn `select` has been deleted (D-127).

**Where the formatters live.** `formatDateTime`, `formatDate` and `todayYmd` moved out of
`src/ui/primitives.tsx` into `@/lib/format`. A formatter is not a component, and a rebuilt screen should
not have to reach into the layer it is being rebuilt away from. The old file re-exports them, so the
twenty-six screens still on it compile unchanged and there is one implementation of each.

**Consequence.** `src/components/tms/FilterBar.tsx` (new), `PageHeader` (kicker, actions, optional
range), `DataTable` (`limit`), `src/lib/format.ts` (new), `src/screens/Audit.tsx` (rebuilt — no `rts-*`
class remains in it), `src/screens/Audit.test.tsx` (new, 7 tests; the screen had none), `tms.test.tsx`
(+4), and the deletion of `.rts-code` from `legacy.css`, the first rule to leave that file because a
screen stopped needing it. The suite moves from 1,340 to 1,351. **No behaviour changed:** the same
search, the same record filter, the same 500-row window, the same words, and the same rule that nothing
on this screen writes.

## D-129 - The temporary stylesheet now says only what the screens still ask for

**The problem.** `legacy.css` was written for the light "Daylight" build. Three phases later most of the
markup it described is gone: the application shell, the first-run and sign-in screens, the stat cards,
the palette and the bands were all rebuilt on `components/tms`. Their rules stayed behind. A count
against `src/` found **284 of its 553 rule blocks naming classes no file mentions** — 44 % of a
temporary file that every page ships, describing a product that no longer exists.

**Decision 1: the stylesheet is measured against the source, not edited by taste.** Every block whose
selectors name only classes that appear nowhere in `src/**` was removed, block by block, keeping
`@media`, `:root` and any rule with one live selector. Two class *families* are built in templates rather
than written out — `rts-flag--${tripStatus}` and `rts-interval-fill--${status}` — so every member of
those two families was treated as used even though no file names one. This is the difference between a
sweep and a guess: the script that did it also proves, afterwards, that every class still used in a
screen still has a rule.

**Decision 2: classes that are used get a token before their rule goes.** Five screens carried a handful
of legacy classes each (the audit log in the previous phase, then Profile, Users, the trip-stop form and
the dispatch board). Each was replaced with the token utility it stood for — `rts-mono` → `tms-mono`,
`rts-hint` → a muted 11px line, `rts-toolbar` → the same card-and-border it drew — and Profile's header
and cards moved to the `components/tms` versions. Only then was the rule deleted.

**Decision 3: a bug found by the sweep is fixed, not preserved.** `StaffBusing.tsx` styled two chips with
`var(--rts-line-strong)` and `var(--rts-paper-2)`. Neither variable is defined anywhere in the file, in
`:root` or in the build — they never were. The borders were falling back to `currentColor` and the
backgrounds to transparent, which is why those chips looked unlike every other chip. They are tokens now.

**A note on what "ready for production" means here.** The screens are on the dark token palette and the
same frame; what remains is the deeper per-screen rebuild on `components/tms` (twenty-one screens still
name an `rts-` class, Documents and StaffBusing most of all). That work changes how a screen is built,
not whether it works — which is why it can proceed a screen at a time with the product live.

**Consequence.** `src/styles/legacy.css` (553 → 269 rule blocks; 85.7 KB → 48.6 KB; 372 → 88 distinct
class names), the compiled stylesheet (137 KB → 98 KB), `src/screens/{Profile,Users,TripStopForm,
DispatchBoard}.tsx` (no `rts-` class remains), `src/screens/StaffBusing.tsx` (two undefined variables
replaced with tokens). No behaviour changed: 1,351 tests still pass, and the suite was written against
what the screens do, not what they are painted with.

## D-130 - The palette becomes "Studio": near-black canvas, one indigo family

**The problem.** The dark build (D-124) was warm: a `#0E0E10` canvas with `#FF8A00` amber as the single
accent. Three directions had been drawn up side by side — Daylight, Graphite and Studio — and Studio was
described then as "striking in a screenshot and the heaviest to live in for eight hours". The owner has
now read that proposal and chosen Studio for the whole product, not for one screen: *"rebuild the whole
system"*. Amber is therefore retired, and this decision supersedes the palette half of D-124 and the
`stone-*` remap in D-125. Nothing about the component layer, the motion or the rules changes.

**Decision 1: one palette, written once.** Canvas `#0A0C11`, rail `#070910`, card `#12151D`, raised and
row-hover `#161A24`, card edge `#1F2534`, row rule `#191D27`. Text `#F2F3F8`, body `#9AA2B6`, floor
`#7E879E`. Every screen reads these through the same semantic tokens, so the twenty-one screens still
built on `legacy.css` re-tint with the rest: their `--rts-*` block was re-pointed to the same values
rather than left warm. The stylesheet contains no `#FF8A00` after this decision, and a test fails if one
comes back.

**Decision 2: the accent is two steps, because reading and pressing are different jobs.** `#7C88FF` is
the reading accent — active section, live dot, ring arcs, sparkline, badge text, links (5.93:1 on a
card). `#4453F0` is the action fill, with white ink (5.61:1). Using one value for both was the trap:
`#7C88FF` behind white text is 3.1:1 and fails, and `#4453F0` as text on the card is 3.25:1 and fails.
The tokens `--primary` and `--action` therefore hold the two roles, and the `Button` default variant
reads the second.

**Decision 3: Studio's faint ink is lightened, and its destructive fill is deepened.** The proposal's
`--faint: #667085` measures 3.67:1 on a card, under the 4.5 floor this product holds itself to, so the
floor here is `#7E879E` (5.08:1) — same hue family, one step up. Its danger ink `#FF9F96` is right for
text and wrong for a button: white on it is 1.6:1, so `--destructive` (the fill shadcn puts white text on)
is `#D13B38`. A test computes both ratios from the stylesheet, so the departure is checked rather than
remembered.

**Decision 4: the rail's active item is a raised chip, not a filled button.** Studio's own rail uses a
`#161A24` chip with white ink and an indigo edge; a solid indigo bar in the rail made the navigation look
like the primary action of every screen. The chip is `bg-sidebar-accent` with a 2px inset indigo rule, the
glyph in `--primary`, the count in `--primary-tint`. The segmented control keeps a filled pill, because
there the pill *is* the selection.

**Decision 5: the board is one twelve-column field.** The overview's cards were arranged as two rows of
two-thirds and one-third. They are now placed on a 12-column grid — the map and the trip table take 8, the
ring and the activity feed take 4 — so a card that holds a table earns its width and a card that holds one
figure does not. The utilisation card gained a segmented mix bar beside the ring: a ring answers "how
much" and is poor at "how many of each", and the bar answers that from the same numbers already on screen.

**Consequence.** `src/app/globals.css` (`:root` palette, `--action`/`--action-foreground`, the card
shadow), `src/styles/legacy.css` (the `--rts-*` block re-pointed), `src/components/ui/button.tsx`,
`GlidingTabs`, `SidebarNav`, `AppFrame`, `RingGauge` (new `FleetMixBar`), `OverviewScreen` (12-column
layout), `DesignGallery` (swatches now name the Studio values, including the action fill). Nine new tests:
the bar's shares and its spoken label, and three that read the stylesheet and fail if the palette drifts,
if amber returns, or if a text/ink pair drops under 4.5:1.

## D-131 - The interface answers back: pressable figures, rows that open, density, and paper

**The problem.** The board was a good-looking picture of an operations desk and not quite a desk. A
figure saying "3 late" could not be pressed to show the three; a row naming a run opened nothing; every
table was set at one height; the printed invoice left the building with the screen's near-black palette
on it; nothing said when the numbers were taken. Each is small. Together they are the difference between
reading a dashboard and working in one.

**Decision 1: a row is a way in, or it is not a row.** `DataTable` takes `onRowActivate` and
`rowLabel`. With a handler the row becomes focusable, presses with Enter or Space as well as the pointer,
carries a chevron that appears under the pointer, and the arrow keys walk the register without leaving
it. Without one, nothing changes — a table with no destination does not pretend to have one. `rowLabel`
is required by the caller because a screen reader should hear "Open TRP-2418, East Legon to Airport",
not "row".

**Decision 2: a figure with somewhere honest to go is pressable; otherwise it stays a card.** `StatCard`
now takes `href` (a real destination) or `onPress` (act in place) plus `pressLabel`, and renders as a
link or a button accordingly. On the board, "Active trips" and "On time" set the run filter below them —
the request a dispatcher makes after reading either number. "Monthly revenue" has no screen behind it in
this review build, so it stays inert rather than linking to nothing. The rule is the point: no dead doors.

**Decision 3: row density is one preference for the product.** Comfortable or compact, kept in
`localStorage` behind a small external store, so a screen does not thread a prop and a table does not
need a provider. `DataTable` reads it; `DensityToggle` sets it; the choice survives the hour someone
spends reconciling. Compact is 6px of row padding, comfortable 12px — no other dimension changes.

**Decision 4: print is the same design read in daylight.** `@page` is A4 with 16mm margins, and one
`@media print` block re-points the tokens to a light set. Every component keeps its classes and its
meaning; only the values change. Chrome is removed by `.tms-print-hide` (rail, top bar, toolbars, the
density switch) and by hiding shadcn buttons; cards become bordered blocks with no shadow; table headers
repeat on every sheet; rows do not break across pages; scroll windows become pages. A dark screen printed
as-is is a page of nothing, and an invoice is the document most likely to leave the building.

**Decision 5: say when the numbers were taken.** `PageHeader` takes `asOf` and prints "Figures as at
14:05 UTC" in mono under the title. UTC, formatted by hand rather than by locale, because the same line
is rendered on the server and again in the browser and a freshness stamp that corrects itself in front
of the reader is worse than none. A screen that cannot vouch for a time passes nothing.

**Decision 6: the driver's screen is cards, at every size.** A driver has a handful of runs a day, not a
register. The portal now lists runs as cards with a full-width 44px action, the next stop and its
directions, the delay sentence and the roster warning in place; the licence, incidents and documents
follow the same treatment. One layout, because two would drift. The desktop table was removed rather
than hidden behind a breakpoint: two sets of the same controls in one document is one set of duplicate
buttons for a screen reader and two chances for them to disagree.

**Decision 7: clear the old classes where the swap is exact, and only there.** `DriverPortal`,
`ClientPortal` and `StaffTransportReport` are now free of `rts-*`; the first by rebuilding it, the other
two by replacing `.rts-mono` with the identical utilities (`font-mono text-[11.5px] tabular-nums`) rather
than with `tms-mono`, which is 11px, tracked and **uppercase** — a different thing wearing the same name.
`.rts-run-late` was deleted with its last use. Twelve of thirty screens are class-clean; eighteen remain,
and the largest are `StaffBusing` (51 classes), `Documents` (32) and `PrintableReport` (29).

**Consequence.** `DataTable` (activation, density, keyboard), `density.tsx` (new), `StatCard` (href,
onPress, aria-live on the figure), `PageHeader` (asOf), `globals.css` (`@page`, the print block),
`AppShell`/`AppFrame`/`PageHeader`/`DataTable` (print-hide), `TripDetailDialog.tsx` (new),
`OverviewScreen` (filter from a figure, rows that open, freshness line), `DriverPortal` (cards),
`ClientPortal`/`StaffTransportReport` (class swap), `DesignGallery` (density switch and openable rows),
`legacy.css` (one dead rule). Eleven new tests.

## D-132 - One sheet, four documents: the paper vocabulary moves to the component layer

**The problem.** The invoice, the credit note, the statement and the management report were four
hand-built copies of one idea, written in `legacy.css` as forty-seven `.rts-sheet-*` rules. They agreed
with each other because they had been copied carefully, not because anything held them together; the
management report was already beginning to drift from the invoice it claims to match.

**Decision 1: paper is a component, and paper is white.** `components/tms/Sheet` owns the vocabulary —
`Sheet`, `SheetHeader`, `SheetMeta`, `SheetTable`, `SheetTotals`, `SheetRow`, `SheetWords`, `SheetNote`,
`SheetSection`, `SheetFoot`, `SheetNotice` — and four documents now say only what they say, not how they
look. The sheet carries its own tokens (`--paper`, `--paper-ink`, `--paper-muted`, `--paper-line`,
`--paper-accent`, `--paper-warn`, `--paper-void`) rather than borrowing the screen's: a document is white
with dark ink whatever the theme is, because the page in the preview and the page in the printer are the
same object and a customer's invoice is not a dark-mode surface. Those values are chosen for print first
and then checked on screen; on the screen the sheet sits as a lit page on the dark canvas.

**Decision 2: number formatting is not a house style to be localised per document.** Money, counts and
dates in a column are tabular and right-aligned by one exported class. A statement read by a customer's
bookkeeper is a column of figures that must line up, not four documents that each decided.

**Decision 3: the arithmetic still comes from the helpers.** The sheets format; they never add up.
`invoiceBalance` produces the amount due, `customerStatement` produces every row and total, and the
report's figures come from `printableReport`. This decision is the reason the paper, the screen and the
reports cannot diverge — a printed total that is its own subtraction is how paper starts disagreeing
with the register.

**Decision 4: the preview is part of the component layer too.** `PrintPreview` moved to
`components/tms/PrintPreview`: it portals to `document.body` so the printed page is the sheet and nothing
else, sets the document title so "Save as PDF" names the file after the paper, keeps the keyboard
behaviour every overlay shares (`useDialogFocus`), and prints the sentence about a missing company name
when there is one. The preview marks its overlay and stage with `data-print-overlay` and
`data-print-stage`; the print block hides every other child of `body`, so what prints is the sheet.

**Decision 5: the dead half of the temporary stylesheet goes with it.** Retiring the sheets left 94 rule
blocks and 141 selectors in `legacy.css` that named classes no file contains — leftovers from the light
build, kept earlier because a block like `.rts-table .rts-num` had one live selector and was preserved
whole. Every selector whose classes are all unused was removed, per selector rather than per block, and a
check proves afterwards that every class still used in `src/` still has a rule. The file is 48.3 KB →
36.9 KB.

**Consequence.** `src/components/tms/Sheet.tsx` and `PrintPreview.tsx` (new), `src/screens/Documents.tsx`
(569 → 330 lines, four documents, no legacy classes), `src/screens/PrintableReport.tsx` (no legacy
classes), `src/app/globals.css` (paper tokens, print-overlay rules), `src/styles/legacy.css` (94 blocks
and 141 selectors removed), `src/screens/Documents.test.tsx` (two class selectors replaced with the
`data-` hooks). Fourteen of thirty screens are now clear of the old stylesheet; the compiled stylesheet
is 92.5 KB, down from 101.8.

## D-133 - Demonstration data is written through the command layer, and refuses a database with records

**The problem.** The product has no dossier of records to show. Every screen is honest about an empty
database, which is right for an installation and useless at a presentation: a board with no runs, a
register with no buses and a statement with no money demonstrate nothing at all. What was needed was a
company that could be walked through — but the earlier rule (D-36, "no demo data, no invented facts")
existed for a reason, and it does not stop being a reason because a meeting is on Thursday.

**Decision 1: the rule is narrowed, not deleted.** Invented business records are permitted **only** in a
database that was empty, **only** through `scripts/seed.ts`, and **only** under names, companies, phone
numbers and TINs that are plainly invented and labelled as such wherever they are described. Nothing
about a real customer's data changes; the product's own defaults are still blank, and an installation
that never runs the script is exactly as it was.

**Decision 2: it seeds the way the application writes.** A seed that INSERTs rows can produce a
database the application would refuse — a rental with no quotation behind its deposit, an invoice for
a hire that never ran, a reference counter that does not know about the numbers it just gained, an
audit log that does not mention any of it. So the script drives `runCommand` → `loadDatabase` →
`executeCommand` → `saveDatabase`, the same path a screen takes: the advisory lock, the permission
checks, the cross-record validation, the reference series and the audit entries all apply. The point of
the demonstration is that the figures on the screens are figures the system itself stands behind.

**Decision 3: it refuses to run over records.** If any vehicle, driver, client, rental, trip or invoice
already exists, the script stops and prints what it found. Demonstration rows therefore cannot be mixed
into real work by accident, and the guard's message names the two ways forward — restore a backup, or
reset and start again. `npm run db:reset` is the undo, and the script says so in its header.

**Decision 4: the dates are relative, and the gaps are deliberate.** Completed runs and hires sit behind
the day the script runs; planned runs and accepted hires sit ahead of it; one compliance paper expires
inside the reminder lead time and one has already expired. That keeps the demonstration current
whenever it is given rather than freezing it to the day it was written, and it means the screens that
exist to warn about something — readiness, reminders, overdue service, aged debt — have something real
to warn about.

**Decision 5: what it cannot honestly show, it does not invent.** No GPS trace (the product has no
integration), no two-factor challenge (not built), no email or SMS marked "sent" (there is no provider),
and no invoice claimed as paid that has no payment behind it. The one place the demonstration shows a
degraded condition — the expired roadworthy on the bus that is in the workshop — is real data about a
state the product is supposed to surface.

**Decision 6: the money has live debt, not only settled history.** The first draft ended with every
invoice settled, which made the finance home's ageing bands, its overdue list and a customer statement
all say nothing. A sixth hire was added — billed six weeks ago, half paid, now ten days late — and a
seventh completed and deliberately not yet billed, so the two lists a finance person acts on both carry
a record. This cost the script nothing but realism: the two figures are the same records the office
would have.

**Consequence.** `scripts/seed.ts` (new, ~1,150 lines, 200-odd commands), `package.json` (`db:seed`),
`README.md` ("Try it with demonstration data"), `docs/SETUP_AND_DEPLOYMENT.md` §12b. The database it
produces: 6 users, 6 clients, 5 branches, 4 contracts, 8 vehicles, 8 drivers, 23 documents, 5 routes,
18 riders, 80 trips, 5 bookings, 9 rental requests, 3 invoices, 4 payments, 1 credit note, 1 refund, 9
expenses, 2 incidents, 2 work orders, 17 odometer readings and an audit trail of the whole thing. It
runs in about four seconds against an empty database, and it is verified end to end on a fresh schema
(22 migrations) — `tsc`, `eslint`, 1,368 tests and the production build unchanged by it.

## D-134 - The money desk and the registers leave the old stylesheet; four screens still hold to it

**The problem.** The component layer had twelve screens on it and eighteen on `legacy.css`, and the
eighteen were not eighteen equal jobs. Most of them used the temporary stylesheet for four or five
ideas — a numeric font for a figure, a muted word for what a record does not say, a bar for an
interval, a hairline list for the bands of debt — while their layout, tables, buttons and empty states
already came from the component layer. They were paying a stylesheet's whole cost for a handful of
utilities.

**Decision 1: the residue becomes utilities, not a component per screen.** `tms-num` (mono figures,
sentence case, tabular), `tms-unset` (what the record does not say, in the muted floor colour, never
italic) and `tms-summary` (a stated block inside a screen) now live in `globals.css` beside the other
utilities. They replace `rts-mono`, `rts-unset` and `rts-summary` one for one, at the same sizes, so a
sweep changes where a class is defined and nothing about what a person sees.

**Decision 2: two repeating shapes become components.** `KeylineList` is the hairline list with one
total row — the age of the debt on the finance home and on every customer statement, which had drifted
into two hand-kept copies. `IntervalBar` is the service-interval bar, decorative by contract because
every caller prints the same numbers beside it; the tone comes from the state the words already state.

**Decision 3: the sweeps are per class, not per file.** A screen is clear of the old stylesheet when
no class in it is defined there — not when it merely looks right. Twelve screens met that test this
phase: `FinanceHome`, `Statements`, `Invoices`, `Contracts`, `Compliance`, `Reports`, `Vehicles`,
`Registers`, `Expenses`, `Rentals`, `Fleet` and `FleetReadiness`. Where a class had no faithful
equivalent (the tab strips, the receipt file input, the vehicle thumbnail) it was replaced with token
utilities at the same meaning, not deleted in the hope that a default would do.

**Decision 4: four screens are left, and they are the four that are genuinely different.**
`StaffBusing` (62 classes) and `StaffLogistics` (40) are built around their own run cards, planning
list and report table; `PublicEnquiry` (22) is a page outside the frame, because it is embedded on the
company's website; `Settings` (14) is a band of rules with a setup meter. Each needs a shape the layer
does not have yet, and inventing one per screen is how the layer stops being a layer. They come next,
one at a time, with `legacy.css` deleted when the last is clear.

**Consequence.** `src/components/tms/KeylineList.tsx` and `IntervalBar.tsx` (new), `src/app/globals.css`
(three utilities), twelve screens edited, no behaviour changed — 1,368 tests pass untouched apart from
the three `.rts-copy` selectors they already used. Twenty-six of thirty screens are now clear of the
temporary stylesheet; the compiled CSS is 93,594 bytes, +1.1 KB on the last build because the utilities
are new rules, and 36.9 KB of legacy rules are carrying four screens instead of eighteen.

## D-135 - The run sheet becomes a table, the desk becomes a landmark, and the strip becomes one component

**The problem.** `StaffBusing` carried 62 class names from the temporary stylesheet — more than any
other screen — and nearly all of them were on one tab. The run sheet drew each trip as an `<article>`
in a four-column CSS grid: a time, a block of prose about the route, a crew line and a status flag,
with every action the run allowed stacked beside it. It read well on a wide screen and badly on a
narrow one, the columns were not sortable, the header did not stay while the list scrolled, and the
screen ignored the row density every other register obeys. The dispatch desk beside it was an `<aside>`
styled from the same file.

**Decision 1: a run sheet is a table.** The day's runs are rows: departs, route (with reference,
progress and any delay sentence), crew, state, and the next action. Sorting, the sticky header, the
density preference, horizontal scroll on a narrow screen and the empty state come from the layer's
`DataTable`, which is what a dispatcher's list should have had all along. Progress reads as a fraction
of the route's own stops — `2/4 stops recorded` — because that is what the stop logs are.

**Decision 2: a crew that cannot be found is a fault, not an absence.** The old cell printed `-` when
a run named a vehicle id the register no longer held, which is indistinguishable from a blank. It now
says *not on the vehicle register*, in the same muted styling the words `no vehicle` use. Three states,
three sentences: nobody assigned, assigned and found, assigned and missing.

**Decision 3: the desk stays a complementary landmark.** It is the aside to the run sheet, so it keeps
`<aside aria-label="Dispatch desk">` — a reader can jump to it and a screen reader announces it by name.
Its figures are the day's counts, its late list is the same `runningLate` the sheet uses, and its
suggestion is still offered only to a role that can act on it, with the sentence in one run of text so
it is read — and checked — as one sentence.

**Decision 4: four hand-written copies of the same strip become one component.** `Reports`,
`FleetReadiness`, `StaffBusing` and `StaffLogistics` each had their own tab markup; the first three are
now `components/tms/SectionTabs`, a real tab list with one tab stop, arrow keys, Home and End, and
`aria-selected` doing the work rather than a colour. `StaffLogistics` follows when it is rebuilt.

**Decision 5: the stylesheet is pruned per block, and conservatively.** 79 rule blocks whose every
class no longer appears in `src/` were removed — a block at a time, never splitting a selector list,
and never touching a block that carries a comment in its head, because re-attaching comments around a
half-removed rule is how a stylesheet ends up lying about itself. A script check proves afterwards that
every `rts-*` class still used in `src/` still has a rule: 55 classes, none missing. `legacy.css` is
36.9 KB → 28.2 KB, and the compiled stylesheet 93.6 KB → 86.9 KB.

**Consequence.** `src/components/tms/SectionTabs.tsx` (new, with three tests), `src/screens/StaffBusing.tsx`
(the strip, the run sheet and the planning aid rebuilt; every form and every other tab unchanged),
`src/screens/Reports.tsx` and `src/screens/FleetReadiness.tsx` (the strip), `src/styles/legacy.css`
(79 blocks), `src/screens/Busing.test.tsx` (+2 tests: the run sheet is a table with three crew states,
and the strip is a real tab list). Three screens remain on the old stylesheet: `StaffLogistics` (42),
`PublicEnquiry` (23) and `Settings` (16).

## D-136 - StaffLogistics joins the layer; the tab strip is finished, not just shared (Phase 86)

`StaffLogistics` was the last screen of its size on the old stylesheet: 42 `rts-*` classes across the
incident register, the work order list and the cost report. Reading it beside the rebuilt screens showed
three things to fix beyond the classes.

**Decision 1: a section strip must say which panel it opens, and keep the keyboard with it.** Sharing
`SectionTabs` between four screens made the gap obvious: the strip announced tabs but the panel below it
had no relationship to them, and pressing Home or End moved the selection while focus stayed behind on
the previous tab, so a keyboard user was reading one panel and typing at another. `SectionTabs` now
requires an `idPrefix`, emits stable ids from one `sectionIds` helper, gives every tab `aria-controls`,
and moves focus with the selection on arrow keys, Home and End. `SectionPanel` is the other half:
`role="tabpanel"`, `aria-labelledby` pointing at its tab, and one tab stop so the panel is reachable
without a Tab through every control inside it. The panel is named by the tab and by nothing else — an
`sr-only` copy of the tab's words inside the panel read as the same sentence twice and made
`Reports.test.tsx` fail with "Found multiple elements with the text: Hire report".

**Decision 2: every table gets a name.** The incident register, the work order list, the cost entries and
the new "By category" table each carry a `DataTable` label or a `<caption className="sr-only">`, so a
screen reader announces which of the three it has landed in rather than "table" four times.

**Decision 3: coverage is a figure strip, not a second paragraph.** The cost report's six counts
(records with a cost, work orders with no cost, incidents with no cost, incidents with an entry,
expenses, expenses with no receipt number) were six lines of prose. They are now one
`components/tms/FigureStrip` — a `dl` of label and value that formats nothing, so the screen keeps
control of "100%" versus "0". The same strip carries the desk's four counts and the work order aside's
three.

**Decision 4: the aside is a real aside.** Both side panels were `<div>`s wearing a card class. They are
now `<aside aria-label="...">` around the layer's `SurfacePanel`, `self-start` so a short aside does not
stretch to the height of the register beside it. Same rule as the dispatch desk: if it is complementary
content, the markup says so.

**Decision 5: an unregistered vehicle is three sentences, never a dash.** `vehicleReg` printed `-` for a
vehicle id the register no longer holds. It now yields `none named`, the registration, or `not on the
register` — the same three-state wording the run sheet adopted in D-135. The work order dialog's
description was still doing the old thing and was corrected with it.

**Decision 6: the test was wrong twice, and both times about the product.** The new `StaffLogistics`
screen test first reported no costs at all: the fixtures built incidents and work orders with
`createdAt: at` (a time, no date part at the front), and `costReport` scopes work orders by the calendar
day of `createdAt`, so a work order from "09:00:00.000Z" fell outside the range. The screen was right;
the fixture was not. The second round of failures were all duplicate matches — a state that appears on
the register row and again in the desk list, a total that appears as a headline and again as the ruled
total of the category table — and were fixed by scoping with `within(...)` and asserting the count, not
by loosening the matcher. One assertion was dropped rather than repaired: the old test asserted that
`getByLabelText("From")` returns `null`, which documented a `Field` quirk instead of a behaviour.

**Consequence.** `src/components/tms/SectionTabs.tsx` (+`SectionPanel`, `sectionIds`; focus follows the
selection; two more tests), `src/components/tms/FigureStrip.tsx` (new), `src/screens/StaffLogistics.tsx`
(no `rts-*` class left), `src/screens/{Reports,FleetReadiness,StaffBusing}.tsx` (the `idPrefix` prop),
`src/screens/StaffLogistics.test.tsx` (new, 8 tests). `legacy.css` is unchanged at 28.2 KB because two
screens still need it; it is deleted when they are clear.

## D-137 - Q-29 closed: the cost report prints the two figures it used to decline (Phase 87)

The cost report in Staff logistics ended with a warning box: "Cost per trip needs a definition for which
costs belong to a trip, and fleet utilisation needs available hours per vehicle ... so no figure is
shown here." The first half of that sentence had been untrue since Phase 28, when the owner approved
both definitions (Q-29, D-78) and `financialReport` began computing cost per trip from them. The box
was written when it was accurate and then left standing while the definitions were answered underneath
it. A screen that says a decision is missing, after the decision was made, is worse than a screen with
no figure: it tells the reader the product is waiting on them.

**Decision 1: print both figures where the question is asked.** The report now ends with two named
bands. **RPT-03 Cost per completed run** is the recorded total *above it on the same screen* divided by
the runs the records say were completed in the period, with the runs, riders boarded and cost per rider
beneath it, and the sentence that a run never worked carries no cost of its own. **RPT-02 Fleet
utilisation** is committed vehicle-days over available vehicle-days, with committed, available, worked,
workshop and idle days beside it.

**Decision 2: no second arithmetic.** Neither figure is computed on the screen. Cost per run comes from
`financialReport`, the function whose total is the same total the band above prints, and which already
feeds the money report, the CSV and the printable sheet — so the screen cannot disagree with the
document. Utilisation comes from `fleetReport`, the function the fleet dashboard prints. The point of
D-78 was one definition in one place; writing a second division on a screen would have undone it.

**Decision 3: the hours residue is answered no, in words.** Q-29's last open thread was "available hours
per vehicle". Nothing in the program records an hour of a vehicle's time — there is no clock-in per bus,
no telematics — so an hours-based utilisation would be a guess dressed as a measurement. The figures
stay in days, and the screen says so, with the two consequences a reader would otherwise discover
later: a bus sold for a day and never run counts as committed and not worked, and a retired vehicle is
left out of every day because the date it left the fleet is not recorded.

**Decision 4: utilisation is shown only to a role the server gives the fleet to.** Finance reads costs
but not the runs the vehicle-days are counted from, so the utilisation band is gated on `fleet:read` and
the cost band is not. The screen never draws a figure whose inputs were withheld from the reader.

**Decision 5: absence stays explicit.** With no completed run the figure reads *Not available* with the
reason underneath, never `GHS 0.00`; a rider who did not board is not counted in cost per rider, so a
no-show does not make the riders who did travel look cheaper.

**Consequence.** `src/screens/StaffLogistics.tsx` (two bands replacing the notice, both computed from
existing functions), `src/screens/StaffLogistics.test.tsx` (+2 tests: no completed run says so; one
completed run divides the total and prints utilisation), `src/Logistics.test.tsx` (the end-to-end
assertion that both figures stay unconfigured became an assertion that both print),
`docs/OPEN_QUESTIONS.md` (Q-29 closed), `docs/KPIS.md` (where each figure prints). No migration and no
schema change: this was a screen declining to show what it already had.

