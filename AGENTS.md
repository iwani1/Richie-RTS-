# Richie Transport Services — Transport Management System (TMS)
# STANDING BRIEF

Save this file as `AGENTS.md` (or `CLAUDE.md`) in the repository root. It is the stable brief: it says how to build, not what to do next. The phase prompts (separate file) say what to do next. Read this file at the start of every session.

---

## 1. Mission

Build a functional, secure, production-oriented Transport Management System for **Richie Transport Services**, a transport company in Ghana (https://www.richietransportservices.com/index.html#services).

The company's three services must work inside one integrated system:

1. **Staff busing**: recurring transport of employees between homes, pickup points and workplaces for corporate clients.
2. **Bus rentals**: one-off vehicle hire for individuals and organisations, with quotation, deposit and final billing.
3. **Staff logistics**: daily planning, dispatch, breakdown response, maintenance coordination and cost reporting.

This is an operational application, not a brochure site or a static dashboard. There must be a clear path from a request, to planning, to assigned resources, to a completed trip, to recorded financial and operational results.

Work as the lead engineer. Produce concrete artifacts (decision records, ERD, permission matrix, tests, migrations) rather than general advice.

---

## 2. Integrity rules (apply to everything, always)

1. **Real persistence.** Every operational screen reads and writes the database through server-side validation and server-side permission checks. No workflow may depend on frontend-only sample data.
2. **Evidence before claims.** Never state that a feature, integration or test works unless you ran it in this session and saw it pass. Label simulated, unconfigured or planned things as such, in the UI and in the docs ("Not configured").
3. **No invented business facts.** Never invent company policies, prices, tax rates, fleet facts, customer data or contract terms. An unknown business rule becomes a setting with **no default** (an administrator must set it before the dependent feature can be used), and is logged in `docs/OPEN_QUESTIONS.md`.
4. **No misleading numbers.** Do not show a profit, margin or KPI as verified when its inputs are missing. Show the reporting period and data coverage, or "insufficient data".
5. **No dead controls.** Every visible button or link works, or is explicitly labelled unavailable or planned.
6. **Preserve working code.** Inspect before changing. No wholesale rewrites without a decision record in `docs/DECISIONS.md`.
7. **Honest limits.** If the environment cannot support a requirement, say so and build the best supported alternative.
8. **Vertical slices.** Finish complete features (interface, server logic, validation, persistence, permissions, tests) before starting new ones. A dependable MVP beats many unfinished features.
9. **Seed data** is clearly labelled as demonstration data and must never load in production.
10. **Secrets** never appear in source control, client code or documentation.

---

## 3. Business context (authoritative; the owner fills this in before Phase 0)

Blank fields are unknowns. Do not guess them; list them in `docs/OPEN_QUESTIONS.md`.

```
- Company: Richie Transport Services, Ghana
- Fleet: [number of vehicles; categories; seat capacities]
- Drivers: [number]
- Current corporate clients: [names or count; approximate staff numbers]
- Shifts in use: [names and times]
- How operations run today: [Excel / WhatsApp / paper / other]
- Users by role: [e.g. 2 dispatchers, 1 finance officer, 1 fleet manager]
- Hosting target: [provider and plan; Node.js? PostgreSQL? Docker? background workers? WebSockets?]
- Budget for third-party services: [SMS, maps, payments]
- Brand assets: [logo file path; hex colours. If none, use navy/teal placeholders]
- Existing data to migrate: [sources and formats]
- Language: English
- Locale: GHS currency, +233 phone numbers, Africa/Accra time zone
- Payment methods used today: [cash / bank transfer / MoMo networks]
- Tax position: [VAT-registered? GRA e-VAT in use? levies applied?]
- Service descriptions from the website (paste if you cannot browse it): [...]
```

---

## 4. Stack and standards

These are the defaults. If §3 shows a hosting limit, adapt and record the change in `docs/DECISIONS.md`.

| Area | Standard |
|---|---|
| Framework | Next.js (App Router), React, TypeScript (`strict`), Tailwind CSS |
| Database | PostgreSQL 15+ with the `btree_gist` extension; Prisma ORM; hand-written SQL migrations for constraints Prisma cannot express |
| Validation | Zod at every server boundary |
| Authentication | One maintained library (for example Auth.js or Better Auth). Choose one, record why. Never hand-roll sessions or password hashing |
| Background jobs | `pg-boss` (runs on Postgres, no Redis), unless hosting forbids long-running workers. In that case use scheduled endpoints and document the limits |
| Tests | Vitest (integration tests run against a real Postgres test database), Playwright for end-to-end |
| Local development | Docker Compose for PostgreSQL; `.env.example`; one package manager only |
| Code layout | `src/modules/<domain>/{service,policy,schema,repo}`. Route handlers are thin; business rules live only in the service layer |
| Providers | Maps/geocoding, SMS, email and payments each sit behind a provider interface. No secrets in client code |
| Quality gates | `typecheck`, `lint`, `test` and `build` must all pass before any feature is called done |

**Hosting check (Phase 0):** verify that the target supports Node.js, PostgreSQL, background workers and WebSockets. Do not assume any of them. If something is missing, document it and adapt (for example, polling instead of WebSockets).

---

## 5. Engineering invariants

These are non-negotiable and each must have tests.

**5.1 Double-booking prevention.**
Enforce it in the database, not only in application code.
- Vehicle and driver assignments use an exclusion constraint, for example `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN (...active statuses...))`, added through a raw SQL migration. Confirm that Prisma migrations show no drift afterwards.
- Seat capacity: lock the trip row (`SELECT ... FOR UPDATE`) inside the booking transaction, then check capacity.
- Concurrency tests fire parallel requests at a real Postgres instance and assert that exactly one succeeds.

**5.2 Company (tenant) isolation.**
All company-scoped data access goes through one scoped data-access layer (or Postgres row-level security). No unscoped queries in route handlers. Generate a cross-tenant test for every company-scoped API route: user of company A requests a record of company B and must be denied.

**5.3 State machines.**
Each stateful entity (rental request, quotation, booking, trip, vehicle, work order, contract, invoice, incident) has one transition table in code. All status changes go through one function that checks the actor's permission and preconditions and writes a `status_history` row (who, when, from, to, reason). Tests iterate the full from-to matrix: every allowed transition succeeds, every other transition is rejected. Exceptions (for example completing a trip that never started) require an authorised actor and a recorded reason.

**5.4 Money.**
- `NUMERIC(14,2)`, never floating point. Default currency GHS.
- One server function computes totals and is used by both quotations and invoices.
- Issued invoices and recorded payments are immutable. Corrections are credit notes or adjustment records with an approver.
- A unique constraint on the billable event prevents a second invoice for the same service.
- Payment callbacks are idempotent through a unique external transaction reference.

**5.5 Time.** `timestamptz`, stored in UTC, displayed in `Africa/Accra`. Recurrence rules are defined in local time.

**5.6 References.** Human-readable references (for example `QTE-2026-0001`) come from database sequences with unique constraints.

**5.7 Audit log.** Append-only record of actor, action, entity, summary of change, IP and timestamp for: create, update, approve, cancel, permission change, financial adjustment, vehicle release, manual override. Do not copy more personal data into the log than needed.

**5.8 Idempotency and duplicates.** Use idempotency keys for payment callbacks, offline driver events and notification events. The UI prevents double submission.

**5.9 Deletion and retention.** Business records are archived or deactivated, not hard-deleted. A retention schedule is documented in Phase 0 (`docs/DATA_PROTECTION.md`).

**5.10 Errors and logs.** Typed errors, no internal details sent to clients, structured logs with a request ID.

---

## 6. Roles and permissions

Roles: **Super Administrator, Operations Manager, Dispatcher, Fleet Manager, Corporate HR Administrator, Driver, Employee/Passenger, Rental Customer, Finance Officer, Maintenance Technician.**

- Permissions are strings of the form `resource:action` and are **deny-by-default**.
- The full role-to-permission matrix lives in `docs/PERMISSIONS.md` and is approved by the owner in Phase 0, before feature code.
- Checks run in the service layer on the server, not only in middleware or the interface.
- Users cannot grant themselves roles or permissions.
- Corporate HR Administrators see only their own company's employees, shifts, locations, bookings and invoices.
- Rental Customers see only their own requests, quotations, bookings and payment status.
- Drivers see only trips assigned to them and cannot assign themselves or change prices, invoices or other drivers' work.
- Dispatchers cannot change finance settings. Finance Officers have no unrestricted access to operational or personal data.
- Maintenance Technicians cannot release a safety-blocked vehicle without the required approval.
- Privileged roles support two-factor authentication when the chosen auth library allows it.

---

## 7. Feature backlog (single source of truth)

Each feature has an ID and a phase tag. Progress, tests and acceptance are tracked per ID. Phase prompts select features by ID.

### Foundation and administration
- **AUTH-01** [1A] Login/logout, secure session with expiry, rate-limited authentication endpoints.
- **AUTH-02** [1A] Invitation-based account creation and activation; suspend and reactivate accounts.
- **AUTH-03** [1A] Password reset.
- **AUTH-04** [1A] Role assignment, company association, protection against privilege escalation.
- **AUTH-05** [1A] Profile management; login history.
- **AUTH-06** [2] Two-factor authentication for privileged roles.
- **AUD-01** [1A] Audit log and a viewer for Super Administrators.
- **SET-01** [1A] Settings registry for all configurable policy: pricing models, tax lines, deposit policy, quote validity, cancellation windows, shift definitions, reminder lead times, on-time threshold, whether bookings are allowed under expired or suspended contracts, boarding-code policy. Settings with no confirmed value are empty and block the dependent action.
- **MIG-01** [1A] Import existing vehicles, drivers and customers from CSV, with preview, row-level errors and no silent discards (same pattern as EMP-02).

### Customers and bus rentals
- **CUS-01** [1A] Customer register (individual or organisation): reference, contact person, telephone, email, billing details, type, status, notes, history. Staff can create customers from phone or email enquiries.
- **RNT-01** [1A] Rental request: customer, service date, departure time, return time or duration, pickup, destination, intermediate stops, passenger count, luggage or special needs, purpose, requested vehicle type, driver requirement, trip contact, notes, request source (app, phone, email, other). Staff can enter requests received outside the app. Do not force vehicle selection before availability is checked.
- **RNT-02** [1A] Rental status workflow: Draft, Submitted, Under Review, Awaiting Quotation, Quotation Sent, Awaiting Customer Confirmation, Confirmed, Dispatched, In Progress, Completed, Cancelled, Declined. Phase 0 defines the exact transition table; invalid transitions are rejected and tested.
- **RNT-03** [1A] Availability check by vehicle category, capacity, operating status and time range; driver availability when a driver is required.
- **RNT-04** [1A] Quotation builder: quotation number, versioned, line items (base charge, distance charge, driver charge, approved waiting/overtime, other charges), discount, tax lines from settings, total, deposit requirement, payment terms, valid-until date, terms and conditions, approval record. Pricing is configurable, never hard-coded. An expired quotation cannot be accepted without an authorised extension.
- **RNT-05** [1A] Confirmation: validate the request; check vehicle schedule, capacity, status and driver availability; detect conflicts; record customer acceptance and the deposit per configured policy; create the reservation; reserve resources through the database constraints in §5.1; notify. If a required payment has not been received, follow the configured policy and never treat the rental as paid.
- **RNT-06** [1A] Assign and reassign vehicle and driver, with history.
- **RNT-07** [1A] Completion: actual departure/return, actual distance when available, vehicle and driver, trip status, additional charges (approval required), damage or incident notes, customer feedback, outstanding balance. Staff review final charges before the final invoice.
- **RNT-08** [1A] Cancellation releases reserved resources; reasons recorded.
- **RNT-09** [1C] Rental customer portal: own requests, quotations, payment status; accept or cancel where permitted.
- **WEB-01** [1A] Public rental enquiry endpoint and embeddable form for the existing website, with rate limiting and spam protection. It creates a Submitted request and exposes no data.

### Fleet and drivers
- **FLT-01** [1A] Vehicle register: ID, registration number, make/model, category, seats, photo, fuel type, ownership/leasing, odometer, insurance, roadworthiness, registration documents, service dates, usual driver, notes.
- **FLT-02** [1A] Vehicle statuses: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of Service, Pending Inspection. Define the rule for each state in Phase 0. A vehicle under maintenance or out of service cannot receive an assignment.
- **FLT-03** [1A] Vehicle documents with expiry dates and configurable reminders.
- **FLT-04** [1A] Driver register: licence class and expiry, qualifications, availability, status.
- **FLT-05** [1A] Fleet dashboard calculated from persisted records only: totals, availability, assigned, on trip, under maintenance, pending inspection, expiring documents, upcoming maintenance, utilisation, downtime.

### Maintenance
- **MNT-01** [1A] Work orders: reference, vehicle, reported fault, work type, priority, date reported, odometer, assignee, required work, parts, labour cost, parts cost, other costs, inspection results, completion date, release information. Statuses: Reported, Awaiting Inspection, Approved, In Progress, Awaiting Parts, Awaiting Review, Completed, Closed.
- **MNT-02** [1A] Safety-related defects block the vehicle. It stays unavailable until an authorised person records the inspection and release; record who released it and when. A technician cannot self-release.
- **MNT-03** [2] Preventive maintenance reminders by calendar date, mileage and service interval. A passed date never marks maintenance complete.
- **MNT-04** [3] Maintenance cost analytics: spend by vehicle, repairs by type, downtime, recurring faults, parts vs labour.

### Corporate clients, contracts, employees
- **CLI-01** [1B] Corporate client records: name, registration details if supplied, contact person, telephone, email, billing address, branches and office locations, status, notes. Do not require data the business does not need.
- **CLI-02** [1B] Contracts: reference, client, dates, status (Draft, Pending Approval, Active, Suspended, Expired, Terminated), attachment where supported, service type, routes and stops, service days and shifts, vehicle requirements, pricing model, billing frequency, payment terms, service-level targets where agreed, renewal reminders, amendment and approval history. Expired or suspended contracts raise warnings; the configured rule decides whether bookings are allowed.
- **CLI-03** [1B] Corporate dashboard limited to the client's own records.
- **EMP-01** [1B] Employee register: reference, name, contact, company, department, work location, shift, approved pickup and drop-off locations, account status, transport eligibility, voluntarily supplied accessibility needs. Home addresses and contacts are restricted fields.
- **EMP-02** [1B] CSV import: documented template, required-field validation, duplicate detection by reference and likely duplicates, preview before saving, row-level errors, valid rows importable without silent discards, import summary, never auto-merge.
- **EMP-03** [1B] Employee management: shifts, locations, eligibility toggle, permitted exports. Deactivated employees cannot create bookings unless policy allows.

### Routes, bookings, trips and dispatch
- **RTE-01** [1B] Locations and stops: coordinates, landmark description, optional Ghana digital address.
- **RTE-02** [1B] Routes: reference, name, service type, client, origin/destination, ordered pickup and drop-off stops, operating days, shifts, planned start, expected duration, capacity requirement, active flag.
- **RTE-03** [1B] Recurring schedules by day and shift, one-time trips, copy a previous schedule, conflict detection.
- **RTE-04** [1B] Explainable planning aid that considers pickup locations, destinations, capacity, required arrival times, durations, availability, existing assignments and pickup windows. Use map-provider estimates only when configured; otherwise manual planning with estimates labelled approximate. Dispatcher overrides are kept and the approved stop order is stored. Never call a route "optimal" without a defined objective that was evaluated.
- **RTE-05** [3] Interface for a later vehicle-routing optimisation service.
- **BKG-01** [1B] Booking types: home-to-office, office-to-home, one-time, recurring, approved ad-hoc, emergency, return, additional approved destination.
- **BKG-02** [1B] Validation: eligibility, contract status, company policy, cut-off times, duplicates (unique constraint on employee and journey).
- **BKG-03** [1B] Booking workflow with unique reference; accepted, rejected or pending per configured rules.
- **BKG-04** [1B] Assign bookings to trips with a transactional capacity check (§5.1).
- **BKG-05** [1B] Cancellation deadlines and reasons; waiting list; offer freed seats per policy and never auto-confirm unless policy permits.
- **BKG-06** [1B] History of important booking changes.
- **TRP-01** [1B] Trip records: reference, service type, related booking or rental, client or customer, route, ordered stops, planned and actual times, manifest, driver, vehicle, status, notifications, incident references, completion details. Statuses: Planned, Ready for Dispatch, Dispatched, In Progress, Delayed, Completed, Cancelled, Interrupted, with an explicit transition table.
- **TRP-02** [1B] Passenger manifests.
- **DSP-01** [1B] Daily dispatch board (table or calendar): today's trips, upcoming departures, active, completed, delayed, cancelled, unassigned bookings, available drivers and vehicles, capacity warnings, maintenance blocks, alerts; filters for date, service, company, route, driver, vehicle, status. Works without any map service.
- **DSP-02** [1B] Assign and reassign vehicle and driver, validating availability, qualifications, vehicle condition, capacity and conflicts. Overrides need permission and a reason.
- **DSP-03** [1B] Emergency trip creation.
- **DSP-04** [1B] Record no-shows and delays; cancel or interrupt trips.

### Driver and passenger interfaces
- **DRV-01** [1B] Mobile-first driver home: profile, today's assignments, next trip, departure time, route and stops, passenger count, vehicle, alerts, history.
- **DRV-02** [1B] Driver actions: open trip, view manifest, open external navigation, mark ready, start, confirm boarding, record no-show, confirm drop-off, report delay, complete. Event APIs accept a client-generated event ID and are idempotent.
- **DRV-03** [2] Boarding verification: trip-specific code or OTP from a secure random source, expiry, single use where policy requires, results recorded, minimal passenger data shown; controlled manual verification with a reason.
- **DRV-04** [1B] Vehicle defect report and breakdown/incident report (basic record; full handling in INC).
- **DRV-05** [2] Offline operation (progressive web app): queue status and boarding events locally with event IDs, sync when connectivity returns, show "pending sync" until the server confirms, handle duplicates and conflicts on the server. Define exactly which actions work offline.
- **PAX-01** [1C] Passenger portal: profile, approved options, request eligible journeys, booking references and status, pickup time and location, history, cancel eligible bookings, feedback, company transport policy. Clearly distinguish: requested, confirmed, assigned to trip, driver en route, picked up, completed, cancelled or delayed.
- **PAX-02** [2] Trip updates. Do not show a live map or live ETA when only manually entered statuses exist.

### Incidents
- **INC-01** [2] Incident records: reference, trip, vehicle, driver, time, type (breakdown, accident, driver unavailable, traffic delay, missed pickup, complaint, vehicle defect, safety concern, other), description, severity, location, people affected (restricted), attachments, immediate action, responder, resolution notes, status.
- **INC-02** [2] Breakdown workflow: driver reports, incident created, dispatcher alerted, affected trips and passengers identified, eligible replacement vehicles and drivers listed, dispatcher confirms replacement, schedules update, passengers notified, original vehicle blocked if required, maintenance work order created where appropriate, incident stays open until resolved. Keep the original and replacement assignment history.

### Finance
- **FIN-01** [1A] Configurable pricing models: fixed monthly, per trip, per passenger, distance-based, time-based, fixed quotation, approved waiting/overtime, approved extra stops, discounts. Rental pricing in 1A; contract pricing in 1B.
- **FIN-02** [1A] Invoices: number, customer or client, related contract or rental, dates, itemised lines, taxes from settings, discounts/adjustments, totals, amount paid, outstanding balance, payment and invoice status. Rental invoices in 1A; corporate invoice generation from billable services in 1B. No duplicate billing.
- **FIN-03** [1A] Manual payments: reference, customer, invoice or rental, amount, currency, method (cash, bank transfer, mobile money), date, external reference, verification and reconciliation status. Immutable; corrections via adjustments.
- **FIN-04** [3] Payment provider integration (for example Paystack or Flutterwave): verify webhook signatures, idempotent handling, never trust a browser redirect, test transactions required before this is called live.
- **FIN-05** [3] Expenses: reference, date, category (fuel, maintenance, repairs, tyres, tolls, other), vehicle, trip, supplier, amount, method, receipt, recorded-by, approval status.
- **FIN-06** [3] Driver allowances, trip payments, overtime and payroll export, with configurable rules and approval.
- **FIN-07** [1C] Finance dashboard whose totals reconcile to transaction records. Margin is shown only when cost and revenue data are sufficient.
- **FIN-08** [3] Payment reconciliation records.

### Notifications
- **NTF-01** [2] Notification service: in-app channel first, provider interface for others, configurable templates, stored status, retry on failure, duplicate-event suppression, user preferences.
- **NTF-02** [2] SMS adapter through a Ghana-capable provider (candidates: Hubtel, Arkesel, mNotify; verify availability and pricing). SMS is the channel most staff passengers will actually see. Mark "delivered" only on provider confirmation.
- **NTF-03** [2] Email adapter.

### Reporting
- **RPT-01** [1A] Rental reports: enquiries, quotations issued, acceptance rate, confirmed and completed rentals, revenue, outstanding balances, vehicle utilisation, cancellation reasons.
- **RPT-02** [1C] Staff transport and fleet reports: bookings received/confirmed/completed/cancelled, no-shows, on-time pickup rate, average delay, passengers transported, route utilisation, contract performance; vehicles by status, downtime, maintenance and fuel cost, mileage, document expiry.
- **RPT-03** [1C] Financial reports: revenue by service and customer, payments received, outstanding invoices, expenses by category, cost per trip, cost per passenger and estimated margin only where data supports it.
- **RPT-04** [1C] Filters (date range, service, client, customer, route, driver, vehicle, status) and CSV export, always permission-scoped. Every KPI formula is documented in `docs/KPIS.md`; reports exclude records lacking required timestamps and display coverage.
- **RPT-05** [3] PDF reports.

### Location tracking
- **GPS-01** [2, only if hardware or phone permissions are available] Provider interface; last reported location with timestamp; clear distinction between live, stale and simulated locations; never fabricate coordinates; tracking only during authorised operational periods; restricted history, retention policy and consent notice. If not configured, label "Not configured".

---

## 8. Core workflows (end-to-end acceptance paths)

Each workflow must run end to end on real records. The chain shows which features it exercises.

- **A. Recurring corporate staff transport:** CLI-01, CLI-02, EMP-01/03, RTE-01..03, BKG-01..04, DSP-01/02, DRV-01/02, TRP-01/02, FIN-02, RPT-02.
- **B. Employee return journey:** BKG-01 (return), DSP-01/02, TRP-02, DRV-02, RPT-02.
- **C. Bus rental:** CUS-01, RNT-01..08, FIN-02/03, DRV-01/02, RPT-01.
- **D. Vehicle breakdown:** DRV-04, INC-01/02, DSP-02, MNT-01/02, NTF-01.
- **E. Maintenance and release:** MNT-01..03, FLT-02, audit record of the release.
- **F. Corporate invoicing:** CLI-02, FIN-01/02/03, duplicate-billing check, RPT-03.
- **G. Emergency transport:** DSP-03, DSP-02, DRV-02, FIN-02.

---

## 9. Ghana requirements

- **Currency and format:** GHS; `+233` phone numbers; `Africa/Accra` (no daylight saving).
- **Mobile money** (MTN MoMo, Telecel Cash, AT Money) is a first-class payment record type from Phase 1A.
- **Tax:** VAT and levies are configurable tax lines. Do not hard-code rates; the accountant confirms current rates. Record in `docs/OPEN_QUESTIONS.md` whether GRA e-VAT invoicing is required; if it is, plan it as a Phase 3 integration.
- **Locations:** street addresses are often unreliable. Store coordinates, a landmark description and an optional Ghana digital address.
- **Data protection:** follow the Data Protection Act, 2012 (Act 843). Document lawful purpose, retention, access, correction and deletion procedures, and note the company's registration obligation with the Data Protection Commission in `docs/DATA_PROTECTION.md`.
- **Connectivity:** drivers and passengers may have poor coverage and low-end Android phones. Keep driver and passenger pages light, tolerate flaky connections, and meet DRV-05.
- **Website link:** WEB-01 lets the existing website send rental enquiries into the system.

---

## 10. Security and privacy

- HTTPS in production; secure, expiring sessions; protection against abuse of authentication endpoints and rate limits where appropriate.
- Server-side validation of all input; parameterised access through the ORM; protection against XSS and CSRF.
- File uploads: restricted types and sizes, access-controlled, never publicly guessable.
- Protect home addresses, contact details, driver data, GPS history and incident records. Collect only data with a defined purpose.
- Do not expose internal errors, stack traces or credentials.
- Dependency audit in CI; secrets in environment variables only.
- Error logging, health-check endpoint, monitoring of failed background jobs, documented database backup and restore. Do not promise an uptime level the hosting cannot support.

---

## 11. Interface standards

- **Visual:** navy blue primary, white and neutral backgrounds, subtle teal accents, clear typography, consistent spacing, readable tables, visible status indicators. Use the real logo only if supplied; never invent official branding.
- **Navigation sections** (shown only if the user is authorised): Overview, Corporate Clients, Contracts, Employees, Customers, Rental Requests, Quotations, Bookings, Routes and Schedules, Trips and Dispatch, Drivers, Fleet, Maintenance, Incidents, Finance, Reports, Notifications, User Management, Settings.
- **Role-specific dashboards**, not one generic one: dispatcher (departures soon, incomplete assignments, unavailable vehicles), finance (outstanding invoices, recent payments, pending reconciliation), fleet manager (unavailable vehicles, upcoming service, open repairs).
- **Every table:** loading, empty and error states; pagination; search; useful filters.
- **Every form:** client and server validation with clear messages; input preserved after a recoverable failure; double-submit prevention; confirmation for destructive actions; clear success and failure messages.
- **Accessibility:** target WCAG 2.1 AA; keyboard navigation; labelled controls.
- **Responsive:** desktop, tablet and phone. Driver and passenger pages are mobile-first.

---

## 12. Testing requirements

Use the stack in §4. Tests that touch bookings, assignments or money run against a real PostgreSQL test database, not mocks.

- **Authentication and permissions:** unauthenticated access rejected; no self-granted roles; cross-company access denied on direct API calls (generated per route); drivers cannot touch other drivers' trips; finance permissions behave as defined.
- **State machines:** full from-to matrix for every entity in §5.3.
- **Bookings and scheduling:** valid booking succeeds; invalid and duplicate bookings rejected; capacity never exceeded; conflicting and unavailable-vehicle assignments rejected; **parallel requests cannot double-book a vehicle, driver or seat**.
- **Rentals:** enquiry submission; quotation arithmetic; expired quotation cannot be accepted; conflicting reservations rejected; deposit rule applied; additional charges need approval; cancellation frees resources.
- **Maintenance:** work-order lifecycle; vehicle blocking; unsafe vehicle cannot be dispatched; release follows the approval rule.
- **Finance:** invoice totals; repeated payment callbacks do not duplicate; balances update; same billable event cannot be invoiced twice; adjustments leave an audit trail.
- **Reporting:** KPIs match `docs/KPIS.md` formulas; filters work; company data stays isolated; exports contain only authorised records.
- **End-to-end (Playwright), at minimum:** (1) corporate client registers employees and books a journey; (2) dispatcher assigns driver and vehicle; (3) driver completes the trip; (4) journey appears in history and reports; (5) customer requests a rental; (6) staff issue a quotation and confirm the reservation; (7) rental completes and financial records update; (8) a breakdown triggers the replacement workflow.

---

## 13. Definition of done (every feature)

A feature is done only when all of these are true:

1. Interface, server logic, validation, persistence and permission checks all exist.
2. Automated tests for its rules exist and passed in this session.
3. `typecheck`, `lint`, `test` and `build` pass.
4. Cross-company and permission-denial tests exist where the feature touches company data or restricted actions.
5. No control in the feature is a dead placeholder.
6. `docs/PROGRESS.md` is updated with the feature ID and real status.

Do not mark a feature Tested because its page renders. Do not mark an integration live when it uses simulated data.

---

## 14. Session protocol and progress tracking

**Start of every session:** read `docs/PROGRESS.md`, `docs/DECISIONS.md` and `docs/OPEN_QUESTIONS.md`; run `typecheck`, `lint` and `test`; pick the next unfinished feature ID from the current phase prompt.

**End of every session:** update `docs/PROGRESS.md` with, per feature ID: status (Not Started, In Progress, Implemented, Tested, Blocked, Deferred), files and components created, database changes, APIs, tests run and their results, known defects, external dependencies, remaining work. Record every non-obvious choice in `docs/DECISIONS.md` and every unanswered business question in `docs/OPEN_QUESTIONS.md`.

If a phase is too large for one session, finish the current vertical slice, document the real state, and stop cleanly. Do not start the next phase while the current phase's exit criteria are unmet.

---

## 15. Deliverables (maintained as the project grows)

Source code; schema and migrations; seed scripts (clearly labelled demo data); auth and permission implementation; APIs and business logic; responsive interfaces; automated tests; `.env.example`; and these documents under `docs/`:
`ARCHITECTURE.md`, `ERD.md` (relationship diagram), `PERMISSIONS.md`, `STATE_MACHINES.md`, `KPIS.md`, `API.md`, `SETUP_AND_DEPLOYMENT.md` (exact commands for install, migrate, seed, build, run), `BACKUP_AND_RECOVERY.md`, `DATA_PROTECTION.md`, `USER_ROLES_GUIDE.md`, `PROGRESS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md`, and a list of outstanding integrations and known limitations.

Native mobile apps, single sign-on, external accounting integrations, multicurrency and advanced analytics are out of scope until the owner starts a later phase.
