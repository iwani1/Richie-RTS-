# Richie TMS — Phase Prompts

Paste **one** prompt at a time into your AI builder, after the standing brief (`AGENTS.md`) is in the repository root and §3 (Business context) is filled in. Do not start a phase until you have reviewed the previous one with its checklist.

Every prompt starts the same way:

> Read `AGENTS.md`. Follow the session protocol in §14: read `docs/PROGRESS.md`, `docs/DECISIONS.md` and `docs/OPEN_QUESTIONS.md` if they exist, and run the quality gates before changing anything.

---

## PHASE 0 — Inspect and plan (no feature code)

```
Read AGENTS.md and follow its session protocol.

Execute Phase 0 only. Do not write feature code.

1. Inspect the project: framework, dependencies, database configuration,
   existing code, deployment constraints. If it is empty, say so.
2. Verify the hosting target from section 3 of AGENTS.md: does it support
   Node.js, PostgreSQL with btree_gist, background workers and WebSockets?
   Report what is confirmed, what is unknown, and what you adapted.
3. Produce, in docs/:
   - ARCHITECTURE.md: modules, request flow, provider interfaces, job runner.
   - ERD.md: full relational schema as a Mermaid diagram, plus a table of
     key relationships, unique constraints, indexes and the exclusion
     constraints required by section 5.1.
   - PERMISSIONS.md: role x permission matrix using resource:action strings,
     including which permissions are company-scoped or own-record-scoped.
   - STATE_MACHINES.md: transition tables for rental request, quotation,
     booking, trip, vehicle, work order, contract, invoice and incident,
     with the actor allowed to perform each transition and its preconditions.
   - KPIS.md: formula, inclusion/exclusion rules and data-coverage rule for
     every KPI named in RPT-01..RPT-03.
   - DATA_PROTECTION.md: what personal data is stored, why, who can see it,
     retention schedule proposal, and Act 843 considerations.
   - DECISIONS.md: one record per choice (auth library, job runner, package
     manager, etc.) with reasons and alternatives rejected.
   - OPEN_QUESTIONS.md: every business rule you need from management.
     At minimum cover: rental pricing basis; deposit amount/percentage;
     quotation validity; cancellation windows and refund rules; whether
     drivers are always included; who approves quotations and additional
     charges; shift names and times; contract billing frequency and payment
     terms; VAT/levies and GRA e-VAT; payment methods in use; vehicle
     categories; document types and reminder lead times; service intervals;
     retention periods; on-time threshold; boarding-code policy; whether
     bookings are allowed under expired or suspended contracts.
   - PROGRESS.md: every feature ID from section 7, all "Not Started".
4. Set up the foundation only: repository structure, Docker Compose for
   PostgreSQL, .env.example, linting, typecheck, test runner, CI workflow,
   an empty migration baseline, and a /health endpoint. Confirm that
   typecheck, lint, test and build all run.

STOP when done. Report what was created, what you verified by running it,
what you could not verify, and the open questions that block Phase 1A.
Wait for approval.
```

**Your review checklist before approving Phase 0**
- Permission matrix: does each role see only what it should? Can any role grant itself more?
- State tables: do the transitions match how the company really works (especially rentals and trips)?
- ERD: are company isolation and the no-double-booking constraints visible in the schema?
- Open questions: answer what you can; for the rest, accept that those settings stay empty until set.
- Hosting: is the stated limitation real? If something is unsupported, decide now.

---

## PHASE 1A — Rentals, fleet and finance core

```
Read AGENTS.md and follow its session protocol. Phase 0 is approved.

Execute Phase 1A only. Features: AUTH-01..05, AUD-01, SET-01, MIG-01,
CUS-01, RNT-01..08, WEB-01, FLT-01..05, MNT-01, MNT-02, FIN-01 (rental
pricing), FIN-02 (rental invoices), FIN-03, RPT-01.

Build one vertical slice at a time in this order:
  1. Auth, roles, permission enforcement, audit log, settings registry.
  2. Fleet and drivers (FLT, MIG-01).
  3. Customers and rental requests with the status workflow (CUS, RNT-01/02).
  4. Availability check and database-level conflict prevention (RNT-03).
  5. Quotations with versions and approval (RNT-04, FIN-01).
  6. Confirmation, assignment, completion, cancellation (RNT-05..08).
  7. Invoices and manual payments (FIN-02/03).
  8. Maintenance work orders and vehicle blocking (MNT-01/02).
  9. Rental reports (RPT-01) and the public enquiry endpoint (WEB-01).

After each slice: run typecheck, lint, tests and build; fix failures before
continuing; update docs/PROGRESS.md. Any setting without a confirmed value
stays empty and blocks its dependent action (for example, quotations cannot
be issued until tax and deposit settings are set); do not invent defaults.

Exit criteria (all must hold, demonstrated by running the tests):
  - Workflow C works end to end on real records, via Playwright.
  - Parallel requests cannot double-book a vehicle or driver.
  - Cross-role and permission-denial tests pass.
  - Quotation and invoice arithmetic tests pass.
  - A safety-blocked vehicle cannot be assigned, and release needs approval.
  - Records persist after logout, login and application restart.

STOP and report real status per feature ID. Wait for approval.
```

**Your review checklist**
- Walk a real past rental through the system: enquiry, quotation, confirmation, completion, invoice, payment.
- Try to double-book a vehicle from two browser windows.
- Log in as each role and confirm what each can and cannot do.
- Check that anything the system could not know (prices, deposit rules) is a blank setting, not an invented number.

---

## PHASE 1B — Corporate contracts, staff transport and dispatch

```
Read AGENTS.md and follow its session protocol. Phase 1A is approved.

Execute Phase 1B only. Features: CLI-01..03, EMP-01..03, RTE-01..04,
BKG-01..06, TRP-01, TRP-02, DSP-01..04, DRV-01, DRV-02, DRV-04,
FIN-01 (contract pricing), FIN-02 (corporate invoice generation).

Order:
  1. Corporate clients, contracts and statuses (CLI).
  2. Employees and CSV import with preview and row-level errors (EMP).
  3. Locations, routes, recurring schedules (RTE).
  4. Bookings with validation, eligibility, duplicate prevention (BKG-01..03).
  5. Trips, manifests, transactional capacity check (TRP, BKG-04).
  6. Dispatch board and assignments with override-and-reason (DSP).
  7. Driver mobile interface; every driver event API accepts a client event
     ID and is idempotent (DRV-01/02/04), so offline sync in Phase 2 needs
     no redesign.
  8. Cancellations, waiting list and booking history (BKG-05/06).
  9. Corporate invoice generation from billable trips, with duplicate-billing
     protection (FIN-02).

Exit criteria (demonstrated by running tests):
  - Workflows A, B, F and G work end to end.
  - Cross-company isolation tests pass for every company-scoped route.
  - Capacity cannot be exceeded under parallel booking requests.
  - Full from-to state matrix tests pass for trips, bookings and contracts.
  - The dispatch board works with no map provider configured.
  - A driver can see only their own trips.

STOP and report real status per feature ID. Wait for approval.
```

**Your review checklist**
- Import a real (anonymised) employee list: are the preview and error messages clear enough for an HR administrator?
- Log in as a corporate administrator and try to open another company's data through a pasted URL.
- Run a day of dispatching on a phone-sized screen.
- Check an invoice against a hand calculation.

---

## PHASE 1C — Portals, reports and finance dashboard

```
Read AGENTS.md and follow its session protocol. Phase 1B is approved.

Execute Phase 1C only. Features: PAX-01, RNT-09, RPT-02, RPT-03, RPT-04,
FIN-07, plus role-specific dashboards and a hardening pass.

Hardening pass: review data isolation, financial calculations, booking
conflicts, mobile usability, error handling and accessibility against
sections 5, 10, 11 and 12 of AGENTS.md; list defects found and fix them.

Exit criteria (demonstrated by running tests):
  - Workflows A, B, C and F show correctly in reports.
  - Every KPI matches its formula in docs/KPIS.md and shows data coverage.
  - Financial totals reconcile to underlying transaction records.
  - Exports contain only records the exporting user may see.
  - All eight end-to-end scenarios in section 12 that apply to Phase 1
    pass. Production build succeeds.
  - docs/SETUP_AND_DEPLOYMENT.md and BACKUP_AND_RECOVERY.md have been
    followed from a clean checkout and work.

STOP and report. List outstanding integrations and known limitations
honestly. Wait for approval.
```

**Your review checklist**
- Compare three report numbers against your own records.
- Follow the setup and backup documents yourself, or have someone else do it.
- This is your MVP gate. Do not start Phase 2 until staff can run one real staff transport workflow and one real rental workflow.

---

## PHASE 2 — Notifications, driver offline mode, incidents

```
Read AGENTS.md and follow its session protocol. Phase 1C is approved.

Execute Phase 2 only. Features: NTF-01..03, DRV-03, DRV-05, PAX-02,
INC-01, INC-02, MNT-03, AUTH-06, and GPS-01 only if credentials and
hardware exist (otherwise build the provider interface and label the
feature "Not configured").

Order: notifications (in-app, then SMS adapter, then email), incidents and
breakdown workflow, boarding verification, driver offline queue, preventive
maintenance reminders, two-factor authentication.

Rules specific to this phase:
  - Notification status is "delivered" only on provider confirmation.
  - Duplicate events must not send duplicate notifications.
  - Never claim a live integration works without a configured provider and a
    real test message; otherwise label it "Not configured".
  - Offline actions are shown as "pending sync" until the server confirms.
  - Never fabricate vehicle positions; show last-updated time.

Exit criteria: Workflow D works end to end; duplicate offline events are
handled idempotently in tests; boarding codes are single-use and expire; all
earlier tests still pass.

STOP and report. Wait for approval.
```

**Your review checklist**
- Send a real test SMS to a real phone and confirm the status shown matches reality.
- Put a phone in airplane mode, complete steps as a driver, reconnect, and check for duplicates or lost events.
- Simulate a breakdown and time how long replacement takes.

---

## PHASE 3 — Finance automation and optimisation

```
Read AGENTS.md and follow its session protocol. Phase 2 is approved.

Execute Phase 3 only. Features: FIN-04, FIN-05, FIN-06, FIN-08, MNT-04,
RTE-05 (interface only unless an optimisation objective is agreed),
RPT-05, and GRA e-VAT integration only if OPEN_QUESTIONS.md confirms it is
required.

Rules specific to this phase:
  - Payment webhooks verify signatures and are idempotent; never trust a
    browser redirect as proof of payment.
  - No payment integration is described as live until a test transaction
    succeeded with real sandbox credentials.
  - Driver pay rules are configurable and approved by an authorised user;
    do not assume a compensation formula.
  - Do not call any route "optimal" unless an objective function was defined
    and evaluated.

Exit criteria: repeated webhook delivery cannot double-record a payment;
reconciliation matches bank/provider records in tests; expense approvals
leave an audit trail; all earlier tests still pass.

STOP and report. Wait for approval.
```

---

## Utility prompts

**Resume after a break or a new session**
```
Read AGENTS.md. Follow the session protocol. Run typecheck, lint and tests,
then tell me: current phase, status of each feature ID in that phase, any
failing tests, and what you propose to do next. Do not change code until I
confirm.
```

**A phase gate failed**
```
The exit criterion "[paste it]" does not hold. Reproduce the failure with a
test first, show me the failing output, then fix it. Do not change the
criterion. Report what caused it and whether any earlier feature IDs need
their status downgraded in docs/PROGRESS.md.
```

**Ask the builder to challenge itself**
```
Review everything built so far against sections 2, 5 and 13 of AGENTS.md.
List every place where a claim of "done" is not backed by a test you ran
this session, every setting with an invented default, and every control
with no working action. Do not fix anything yet; just report.
```
