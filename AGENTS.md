# Richie Transport Services — Transport Management System (TMS)

**Standing brief.** Read this file at the start of every session. It says HOW to build, not
WHAT to do next. Phase prompts say what to do next. Do not start a phase until the previous
phase has been reviewed.

## 1. Mission

Build a functional, secure, production-oriented Transport Management System for
**Richie Transport Services**, a transport company in Ghana
(<https://www.richietransportservices.com/index.html#services>).

The company's three services must work inside one integrated system:

1. **Staff busing** — recurring transport of employees between homes, pickup points and
   workplaces for corporate clients.
2. **Bus rentals** — one-off vehicle hire for individuals and organisations, with quotation,
   deposit and final billing.
3. **Staff logistics** — daily planning, dispatch, breakdown response, maintenance
   coordination and cost reporting.

This is an operational application, not a brochure site or a static dashboard. There must be a
clear path from a request, to planning, to assigned resources, to a completed trip, to recorded
financial and operational results.

Work as the lead engineer. Produce concrete artifacts (decision records, ERD, permission
matrix, tests, migrations) rather than general advice.

## 2. Integrity rules (apply to everything, always)

1. **Real persistence.** Every operational screen reads and writes the database through
   server-side validation and server-side permission checks. No workflow may depend on
   frontend-only sample data.
2. **Evidence before claims.** Never state that a feature, integration or test works unless you
   ran it in this session and saw it pass. Label simulated, unconfigured or planned things as
   such, in the UI and in the docs ("Not configured").
3. **No invented business facts.** Never invent company policies, prices, tax rates, fleet
   facts, customer data or contract terms. An unknown business rule becomes a setting with
   **no default** (an administrator must set it before the dependent feature can be used), and
   is logged in `docs/OPEN_QUESTIONS.md`.
4. **No misleading numbers.** Do not show a profit, margin or KPI as verified when its inputs
   are missing. Show the reporting period and data coverage, or "insufficient data".
5. **No dead controls.** Every visible button or link works, or is explicitly labelled
   unavailable or planned.
6. **Preserve working code.** Inspect before changing. No wholesale rewrites without a decision
   record in `docs/DECISIONS.md`.
7. **Honest limits.** If the environment cannot support a requirement, say so and build the best
   supported alternative.
8. **Vertical slices.** Finish complete features (interface, server logic, validation,
   persistence, permissions, tests) before starting new ones. A dependable MVP beats many
   unfinished features.
9. **Seed data** is clearly labelled as demonstration data and must never load in production.
10. **Secrets** never appear in source control, client code or documentation.

## 3. Business context (authoritative; the owner fills this in)

Blank fields are unknown. Do not guess them; list them in `docs/OPEN_QUESTIONS.md`.

- **Company:** Richie Transport Services, Ghana
- **Services:** staff busing, bus rentals, staff logistics
- **Hosting target:** *unknown* — see OPEN_QUESTIONS Q-01
- Everything else (pricing, deposit, tax, shifts, fleet, contracts, payment methods, document
  types, service intervals, retention periods): **unknown** and deliberately unset.

## 4. Session protocol (§14)

At the start of every session:

1. Read `AGENTS.md`.
2. Read `docs/PROGRESS.md`, `docs/DECISIONS.md` and `docs/OPEN_QUESTIONS.md` if they exist.
3. Run the quality gates (`npm run check` = typecheck, lint, test, build) before changing
   anything, so a pre-existing failure is not mistaken for one you caused.
4. Report what was created, what you verified by running, what you could not verify, and the
   open questions blocking the next phase.
5. STOP at the phase gate. Wait for approval.

## 5. Reference sections that were not supplied

The brief refers to **section 5.1** (exclusion constraints) and **section 7** (feature IDs).
Neither section was in the text supplied to this project. They are therefore treated as open:

- The exclusion constraints this build actually needs are written out in `docs/ERD.md`.
- Feature IDs are proposed in `docs/PROGRESS.md` and must be reconciled with the official list.

Do not invent either.

## 6. Phase state

| Phase | Scope | Status |
|---|---|---|
| 0 | Inspect and plan: ERD, permissions, state machines, KPIs, data protection, decisions, open questions | Approved |
| 1A | Foundation and master data: access, settings, vehicles, drivers, clients, users, audit | Approved |
| 1B | Bus rentals: request → quotation → deposit → assignment → trip → invoice | Approved |
| 2 | Staff busing: routes, rosters, trips, dispatch, boarding, on-time performance | Approved |
| 3 | Staff logistics: breakdown response, maintenance work orders, cost reporting | Approved |
| 4 | Own-record access: driver and client portals, account-to-record links, scope enforcement | Approved |
| 5 | Driver trip execution: actual stop times and boarding capture on the driver's own run | Approved |
| 6 | Compliance documents: vehicle/driver document types, tracking, expiry status, reminder lead time (Q-16) | Approved |
| 7 | Quality foundation: ESLint (unmet Phase 0 deliverable), lint-clean codebase, CI workflow file | Approved |
| 8 | Service intervals, odometer readings and fleet readiness (preventive maintenance) | Approved |
| 9 | Expired rental quotations: explicit no-default renewal policy and revision history | Approved |
| 10 | Progressive driver run execution: start, record each stop and boarding, complete from saved records | Approved |
| 11 | Mid-trip passenger changes: audited roster adjustments on in-progress trips, future stops only | Approved |
