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
