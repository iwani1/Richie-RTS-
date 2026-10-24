# Spec conformance audit — Richie RTS

**Date:** 2026-10-24
**Commit audited:** `2a27fac` (branch `arena/368c3fd2-richie-rts`) plus the uncommitted invoice/payment work in this session, noted where it differs
**Specs:** `richie-tms-standing-brief.md` (the brief) and `richie-tms-phase-prompts.md` (the phase prompts)
**Method:** every requirement in the brief was traced to code, a command, or a live request. Nothing here is inferred from a screen rendering. Where a claim could be checked at runtime it was checked against a running build (`next start`) with a real PostgreSQL harness, and the exact message is quoted.

---

## 1. Verdict

**The build is not spec-conformant.** It is a well-engineered, coherent application that implements a substantial part of the brief, and in places (audit immutability, conflict prevention, permission enforcement on writes) it exceeds it. But measured against the brief as written:

- **11 of 78 feature IDs are met** (14%). **36 are partial**, **16 are not built**, **14 are deferred** to phases 2–3 and are correctly not attempted.
- In **Phase 1A specifically**, **7 of 30** IDs are met (AUTH-01, AUD-01, MIG-01, RNT-03, RNT-06, RNT-08, RPT-01). **Two Phase 1A IDs are not built at all**: AUTH-05, WEB-01. FIN-02/FIN-03 shipped during this pass and are partial.
- **None of the eight end-to-end workflows in §8 can be completed as specified, and none has ever been run in a browser.** Workflow C (bus rental) now runs from enquiry to a recorded payment in the application, but the Playwright requirement is unmet and RPT-01 is missing; workflows A, B, F and G depend on entities that do not exist (clients-as-companies, employees, contracts, bookings).
- Several structural decisions **contradict the brief rather than adapt it**: five roles instead of ten, single-tenant instead of multi-company, one rental status instead of two entity lifecycles (12 states), and reference numbers derived from array length instead of a database sequence (fixed only for invoices and payments, which use a counter).
- The **§13 definition of done is not being followed per feature**: `docs/PROGRESS.md` records work by *phase name*, not by feature ID, does not list the 78 IDs, and repeats "147/203 tests passing" claims that are internally inconsistent with the current suite.

The **Phase 1A gate is not met**, for concrete reasons listed in §3 below.

What is genuinely strong and should not be rebuilt: append-only audit with a trigger, session handling, permission enforcement at the command boundary *and* on read, conflict exclusion constraints, the "no invented defaults — block the action instead" pattern, and the migration discipline.

---

## 2. Scoreboard

| Bucket | Count | Note |
| --- | --- | --- |
| Met | **11** | AUTH-01, AUD-01, MIG-01, RNT-03, RNT-06, RNT-08, RTE-03, TRP-02, DRV-01, DRV-04, RPT-01 |
| Partial | **36** | exists and works, but a named part of the requirement is missing |
| Not built | **16** | no entity, command or screen |
| Deferred (Phase 2/3) | **14** | correctly out of Phase 1 scope; listed so the count reconciles to 78 |
| **Total** | **78** | matches the brief's backlog |

Phase 1A only (`[1A]` tags): **30 IDs — 7 met, 21 partial, 2 not built** (AUTH-05, WEB-01).

---

## 3. Phase 1A exit criteria (phase prompts, Phase 1A, "Exit criteria")

| Criterion | Result | Evidence |
| --- | --- | --- |
| Workflow C works end to end on real records, **via Playwright** | **Fail** | No Playwright dependency, no `e2e/` directory, no browser test anywhere. The flow itself now completes in the app (request → quotation → confirmation → assignment → start → completion → invoice → payment, Phase 16), but "via Playwright" is unmet. |
| Parallel requests cannot double-book a vehicle or driver | **Fail (unproven)** | Conflict prevention exists and is correct (`db/migrations/002_resource_reservations.sql`, exclusion constraint; verified live that overlapping dates are refused), but there is **no parallel/concurrent test**. A sequential test does not demonstrate what the criterion asks. |
| Cross-role and permission-denial tests pass | **Partial** | `src/tms/service.test.ts` and `src/server/*.test.ts` cover denial for several commands; there is no generated per-command matrix and no denial test for the newer modules (busing dispatch, compliance documents, maintenance). |
| Quotation and invoice arithmetic tests pass | **Partial** | Quotation totals, deposit percentage and rounding are covered in `service.test.ts`. Invoice totals, tax lines, discount, overpayment and idempotent replay are covered in `src/tms/finance.test.ts` (14 tests) — but the quotation itself still carries no tax lines, so "quotation arithmetic" is only partly the arithmetic the brief describes. |
| A safety-blocked vehicle cannot be assigned; release needs approval | **Partial** | Blocking is enforced (`vehicle.status !== "available"` on trip assignment; `maintenance`/`out_of_service` refused on rental assignment). "Release needs approval" is not modelled: there is no technician role and no approver recorded, so self-release cannot be prevented by role. |
| Records persist after logout, login and application restart | **Met by mechanism, unproven by test** | Repository writes to PostgreSQL per command inside a transaction; `trpc`-style snapshot endpoints read from the database. No automated restart test exists; the earlier manual probe confirmed persistence. |

---

## 4. §2 Integrity rules

| Rule | Status | Evidence |
| --- | --- | --- |
| No invented business facts; unknown policy stays empty and blocks the action | **Met** | `rentalQuotingReady()` blocks quoting until currency, pricing basis, deposit %, validity and payment methods exist; the block message was observed live: "Blocked: quotation settings are incomplete. An administrator must set: rental pricing basis." |
| No silent fallbacks | **Met** | Guards return named messages; missing reference data produces a refusal, not a default. |
| Money never in binary floats | **Fail** | All amounts are JavaScript `number` (`unitAmount`, `depositRequired`, `total`, cost entries). The storage column type is `numeric`-compatible but the domain layer rounds with `Math.round(x*100)/100`. Not a float *storage* problem in PostgreSQL, but arithmetic is floating point and not decimal-safe. |
| Archived, not deleted | **Met** | Statuses (`retired`, `declined`, `cancelled`, `closed`) instead of delete; commands never remove business records. |
| Audit records who/what/when with immutable append-only semantics | **Met** | `audit_entry` is insert-only by trigger; `audit()` prepends to the log; viewer at `src/screens/Audit.tsx`. |
| No demo data in production paths | **Met** | `emptyDatabase()` seeds nothing; no seed script ships example records. |
| Personal data minimised | **Met** | Passenger phone and employee reference are held; no home address field. The finance role does **not** receive the roster, documents, accounts or audit trail: `scopeDatabase` drops them and `src/server/visibility.test.ts:190` pins that behaviour. A client contact sees only its own client, and passenger phones are blanked in that payload (`visibility.test.ts:176`). |
| No dead controls | **Partial** | The settings screen hides nothing it cannot save; but several screens contain actions that lead to missing features (see §12). No control was found that does nothing at all. |

---

## 5. §4 Technology stack

| Item | Required | Actual | Verdict |
| --- | --- | --- | --- |
| Framework | Next.js with TypeScript | Next.js App Router + TS | Met |
| Styling | Tailwind CSS and shadcn/ui | Tailwind **v4**; **no shadcn/ui**; hand-built primitives in `src/ui/primitives.tsx` | Deviated (documented as D-xx — acceptable: no pre-built component library was available to install) |
| Validation | Zod at every server boundary | Zod on the command envelope (`src/app/api/commands/route.ts`), session and setup routes | Met |
| Database | PostgreSQL 16 **with `btree_gist`** | PostgreSQL (PGlite-compatible migrations); `btree_gist` **is** created and used by the exclusion constraint | Met |
| Data access | Kysely (type-safe query builder) | Kysely | Met |
| Migrations | Versioned SQL files | `db/migrations/001…003` | Met |
| Auth | Auth.js (NextAuth) v5, institutional credentials | **Auth.js not installed**; iron-session cookie + Argon2id + server-side credential rows (`src/server/session.ts`, `src/server/password.ts`) | Deviated — **documented** (D-51) and defensible: the brief says never hand-roll auth, and this is hand-rolled session auth. Flagged, not silently changed. |
| Jobs | pg-boss | **Not installed**; no background job runner at all | **Missing** — nothing schedules reminders, retries or notifications. |
| Testing | Vitest + Playwright + React Testing Library, real PostgreSQL for bookings/money | Vitest + jsdom/RTL; **no Playwright**; booking/money tests run against an **in-memory domain model**, not a real database | Partial — the brief explicitly says tests that touch bookings or money run against real PostgreSQL, not mocks |
| Observability | structured logs with request IDs; errors with codes; `/health` | `/api/health` present; errors are typed results; no request-id correlation | Partial |
| Module layout | vertical feature modules | Flat `src/tms/*` (domain) + `src/screens/*` (UI) + `src/server/*` (transport/persistence) | Deviated — undocumented |
| Local dev | Docker Compose for PostgreSQL | **No compose file** (owner's instruction); README gives a `podman` one-liner and `npm run db:*` scripts | Deviated — documented and explicitly requested |
| Deploy target | Vercel + managed Postgres | Next.js on Node; no Vercel-specific work (no cron, no serverless queues) | Partial — nothing depends on Vercel, but nothing is prepared for it either |

---

## 6. §5 Engineering invariants

| Invariant | Status | Evidence and gap |
| --- | --- | --- |
| **5.1** Transactions for multi-table changes; capacity and conflict checks inside them | Partial | Every command runs inside one transaction (`saveDatabase`). Overlap prevention is a real exclusion constraint. **Capacity is checked at assignment/dispatch/start but not when a roster grows mid-run** — see defect D-01. |
| **5.2** Multi-tenant isolation by `company_id`, auto-injected, cross-tenant tests generated per route | **Contradicted** | The product is single-tenant: no `company_id`, no tenant context. Documented as a deliberate simplification (D-xx), but it is a departure from the brief, not an implementation of it. No cross-tenant tests can exist. |
| **5.3** `status_history` table with `changed_by`, `changed_at`, reason; no state reachable without an explicit transition | Partial | No `status_history` table; history is reconstructed from audit entries and per-entity `log` arrays. Transitions are centralised in `RENTAL_TRANSITIONS` etc. and invalid ones are rejected. |
| **5.4** Ledger/totals derived from records — not counters; issued invoices and payments immutable; corrections via credit notes with an approver | Partial | Totals are derived from line items (good). Invoices and payments do not exist yet, so their immutability cannot be assessed. No credit-note or adjustment record exists. |
| **5.5** Africa/Accra; no "today" computed in a component; dates validated | Met | `todayYmd()` and UTC calendar-day comparisons; guards use `now.slice(0,10)`; date validation via `isValidDate`. Verified live: "RR-0004 is booked from 2026-11-02. It cannot be started before that date." |
| **5.6** Database sequences / counters, not array length | **Fail** | `RR-${db.rentals.length + 1}`, `IN-${db.incidents.length + 1}`, `WO-${db.workOrders.length + 1}`. Reference numbers collide after a restore or any archive-then-create sequence, and are not allocated under a lock. |
| **5.7** Redis-backed rate limiting on auth and public endpoints with lockout and audit | Partial | Rate limiting exists for login (`src/server/rateLimit.ts`) — in-process memory, not Redis; no audit entry on lockout; **no public endpoints exist** to rate-limit. |
| **5.8** Idempotency keys for driver events and payments | Fail | No `eventId`/`clientEventId` anywhere in the codebase. |
| **5.9** Soft delete/archive; no destructive delete | Met | No delete commands; statuses used throughout; `audit_entry` and (new) invoice/payment rows reject deletes by trigger. |
| **5.10** Permission enforced in the data layer or query, not only in the UI | Partial | Enforced in the service (write path) and in `src/server/visibility.ts` (read path, per-collection). Not enforced in SQL/RLS — a direct database client bypasses it. |

---

## 7. §6 Roles and permissions

The brief names ten roles. The build implements **five**:

| Brief role | Build role | Note |
| --- | --- | --- |
| Super Administrator | `administrator` | |
| Transport Manager / Dispatcher | `operations` | combined |
| Finance Officer | `finance` | narrowed read scope: no roster, documents, accounts or audit (D-60) |
| Driver | `driver` | own-record scope |
| Employee / Passenger | — | absent (PAX-01/02 not built) |
| Corporate HR Administrator | — | absent (CLI contracts not built) |
| Rental Customer | `client_contact` | own-client scope; also used for corporate contacts |
| Maintenance Technician | — | absent; consequences: MNT-02 release cannot be restricted by role |
| Fleet Manager | — | absent; fleet duties sit with `operations` |
| Read-only Auditor | — | absent; `audit:read` is held by administrator, operations and finance |

Verified behaviours:

- Unauthenticated `/api/commands` → **401** ("Sign in is required.").
- Write denials are enforced server-side: `finance` creating a work order → "Not permitted: your role lacks maintenance:create."
- Read denials are enforced on the payload, not just the screen: a driver receives only their own trips (live probe `trips:3, users:1, vehicles:1`), and a client contact receives only their client and its routes (`users:1 clients:1 routes:1 rentals:2 passengers:25 trips:3`).
- **Privilege escalation:** no non-administrator holds `users:create`/`users:update`, and the API mints credentials server-side (`hashPassword` in the route, never a client-supplied hash). No self-elevation path was found.
- **Read narrowing is on the payload, not the tab:** finance receives rentals, trips, clients and vehicles but no passengers, documents, users or audit (`src/server/visibility.test.ts:190`).

---

## 8. §7 Feature matrix (78 IDs)

Legend — **M** met · **P** partial · **N** not built · **D** deferred to its labelled phase.

### Foundation and administration

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| AUTH-01 | Login/logout, secure session with expiry, rate-limited auth endpoints | **M** | `src/app/api/auth/login`, `src/server/session.ts` (signed, httpOnly, `sameSite=lax`, 8 h TTL), `rateLimit.ts` (8 attempts / 15 min observed). Logout clears the cookie. |
| AUTH-02 | Invitation-based creation/activation; suspend and reactivate | **P** | Admin creates an account with a password and `active` flag; suspend/reactivate works. **No invitation or activation flow** (no email provider installed). |
| AUTH-03 | Password reset | **P** | Administrator-initiated reset only (`reset_user_password`, Argon2id rehash). No self-service "forgot password" — needs mail. |
| AUTH-04 | Role assignment, company association, escalation protection | **P** | Role assignment and escalation protection present; **no company association** (single-tenant). |
| AUTH-05 | Profile management; login history | **N** | No profile screen (name/email are read-only in the shell). Login events exist only in the administrator-visible audit log. |
| AUTH-06 | Two-factor authentication for privileged roles | **D** | Phase 2. |
| AUD-01 | Audit log and viewer for Super Administrators | **M** | Insert-only table + trigger, viewer screen with filters. Caveats: no IP address; `audit:read` is also held by operations (dispatch needs to see who changed what), which is wider than "Super Administrators". Finance does not hold it. |
| SET-01 | Settings registry for all configurable policy | **P** | Present: pricing basis, deposit %, quote validity, payment methods, shifts, vehicle categories, document types, reminder lead days, maintenance intervals, on-time threshold. **Missing: tax lines, cancellation windows/refund rules, boarding-code policy, the expired/suspended-contract booking rule, contract billing.** |
| MIG-01 | CSV import of vehicles, drivers, customers with preview and row-level errors | **M** | `src/tms/import.ts` + `src/ui/ImportPanel.tsx`; 12 domain tests and 2 screen tests; template documented in `SETUP_AND_DEPLOYMENT.md` §8. Live: `Imported 2 of 4 vehicles. 2 rejected: line 4 (Category "Spaceship" is not configured…); line 5 (A vehicle with this registration already exists.)`; the preview is read-only and each row runs the same command as a typed one. |

### Customers and bus rentals

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| CUS-01 | Customer register: reference, contact, phone, email, billing details, type, status, notes, history | **P** | `Client` has name, contact name/phone/email, status. **No reference number, no billing details, no type (individual/organisation), no notes, no history view.** |
| RNT-01 | Rental request with dates, times, stops, passengers, luggage, source, etc. | **P** | Has customer, start/end date, pickup, drop-off, passengers, purpose, category, driver requirement, notes. **Missing departure/return times, intermediate stops, luggage/special needs, trip contact, request source.** |
| RNT-02 | 12-state workflow with tested transition table | **P** | 7 states (`draft → quoted → confirmed → in_progress → completed`, plus `declined`, `cancelled`) with an explicit transition table and rejection of invalid moves. **No separate quotation/booking entities and no Submitted/Under Review/Awaiting Quotation/Dispatched states.** |
| RNT-03 | Availability by category, capacity, status, time range; driver availability | **M** | Live: wrong-category vehicle refused; overlapping assignment refused; driver licence expiry checked. Capacity checked at assignment against `passengers` (see D-01 for the mid-run gap). |
| RNT-04 | Quotation builder: numbered, versioned, line items, discount, tax lines, terms, approval, expiry rule | **P** | Line items, deposit, validity, currency, requote history (`quoteHistory`). **No quotation number, no tax lines, no discount line, no terms and conditions, no approval record.** Expiry is enforced on confirmation (live). |
| RNT-05 | Confirmation: validate, conflict-check, acceptance, deposit, reservation, notify | **P** | Validation, conflict check, deposit-per-policy recorded, reservation created via constraint. **No customer acceptance record; no notification.** |
| RNT-06 | Assign and reassign vehicle and driver, with history | **M** | Reassignment allowed while confirmed/in progress; each assignment writes an audit entry. History lives in the audit log, not a dedicated table. |
| RNT-07 | Completion with actual times, distance, additional charges approval, damage notes, feedback, balance | **P** | Completion captures final line items (including extra charges). **No actual departure/return times, distance, damage notes, feedback, or balance** (no payments). |
| RNT-08 | Cancellation releases resources; reasons recorded | **M** | Verified live: a cancelled rental's dates were reusable immediately; reason required. |
| RNT-09 | Rental customer portal: own requests, quotations, payment status; accept/cancel | **P** | Client portal lists own requests and quotations. **No accept/cancel action and no payment status** (no payments). |
| WEB-01 | Public enquiry endpoint + embeddable form, rate-limited, spam-protected | **N** | No public route. |

### Fleet and drivers

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| FLT-01 | Vehicle register incl. photo, fuel, ownership, documents, service dates, usual driver | **P** | Registration, make, model, category, seats, status, notes, odometer readings. **No photo, fuel type, ownership/leasing, usual driver.** Insurance/roadworthiness exist as compliance documents. |
| FLT-02 | 7 statuses; maintenance/out-of-service cannot be assigned | **P** | 4 statuses (`available`, `maintenance`, `out_of_service`, `retired`); blocking enforced and observed. Reserved/Assigned/On Trip/Pending Inspection do not exist. |
| FLT-03 | Vehicle documents with expiry and configurable reminders | **P** | Document register with expiry and configurable lead time; status computed per day. **Reminders are not sent** (no job runner, no notifications). |
| FLT-04 | Driver register: licence class, qualifications, availability, status | **P** | Name, phone, licence number, expiry, status. **No licence class, qualifications or availability.** |
| FLT-05 | Fleet dashboard: totals, availability, assigned/on trip, maintenance, expiring docs, utilisation, downtime | **P** | Readiness and compliance screens give counts by status, overdue service and expiring documents. **No utilisation or downtime.** |

### Maintenance

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| MNT-01 | Work orders with parts, labour, inspection results, release info; 8 statuses | **P** | Reference, vehicle, fault, type, priority, date, odometer, workshop, assignee, costs, log. **Statuses are 5, not 8; no parts list, inspection results or release record.** |
| MNT-02 | Safety defects block; release by an authorised person; technician cannot self-release | **P** | Blocking works and is tested. **No technician role and no release approval**, so "cannot self-release" is unenforceable. |
| MNT-03 | Preventive maintenance by date, mileage, interval; passed date never marks complete | **P** | Interval rules per category, due/overdue computed from odometer and last service; a passed date never completes anything. **No reminders** (no scheduler). Phase 2. |
| MNT-04 | Maintenance cost analytics | **D** | Phase 3. |

### Corporate clients, contracts, employees

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| CLI-01 | Corporate records: registration details, billing address, branches, type, notes | **P** | Name, contact name/phone/email, status only. |
| CLI-02 | Contracts with lifecycle, pricing model, billing frequency, renewals, amendments | **N** | No contract entity. |
| CLI-03 | Corporate dashboard limited to own records | **P** | Client portal shows own routes, roster and rentals. **No contracts, invoices or payment status.** |
| EMP-01 | Employee register: reference, department, work location, shift, approved stops, eligibility, accessibility | **P** | Passenger record: name, phone, employee reference, client, route, stop, status. **No department, work location, shift, eligibility, accessibility or drop-off.** |
| EMP-02 | CSV import with template, validation, duplicates, preview, row errors | **N** | Not present. |
| EMP-03 | Employee management: shifts, locations, eligibility toggle, permitted exports | **P** | Route/stop assignment and status changes; no shifts, locations, eligibility or export. |

### Routes, bookings, trips and dispatch

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| RTE-01 | Locations and stops with coordinates, landmark, Ghana digital address | **P** | Stops have a name and a scheduled time only. |
| RTE-02 | Routes with origin/destination, ordered stops, operating days, shifts, duration, capacity requirement, active flag | **P** | Reference, name, client, direction, shift, category, weekdays, date range, ordered stops, status. **No expected duration or capacity requirement.** |
| RTE-03 | Recurring schedules, one-time trips, conflict detection | **M** | Live: 10 trips generated across weekdays for a date range; duplicate guard in the trip unique constraint. "Copy previous schedule" is absent. |
| RTE-04 | Explainable planning aid with overrides stored | **N** | No planning aid; dispatchers choose manually. |
| RTE-05 | VRO interface | **D** | Phase 3. |
| BKG-01 … BKG-06 | Booking types, validation, workflow, assignment, cancellation/waiting list, history | **N** | **No booking entity exists.** Journeys are modelled only as trips with a route roster. |
| TRP-01 | Trip records with service type, booking/rental link, ordered stops, times, manifest, statuses (9), incidents | **P** | Reference, route, date, planned/actual stop times, manifest, driver, vehicle, status (5), completion. **No service type, rental link, delayed/interrupted states, notification or incident reference.** |
| TRP-02 | Passenger manifests | **M** | Per-trip manifest from the route roster with boarding outcomes. |
| DSP-01 | Daily dispatch board with calendar, capacity warnings, maintenance blocks, filters | **P** | Today's departures on the dashboard plus a filterable trip table. **No calendar, no unassigned list, no capacity-warning panel, no maintenance-block view.** |
| DSP-02 | Assign/reassign with availability, qualification, condition, capacity, conflict; overrides need permission and reason | **P** | Validation of category, status, roster capacity, licence expiry, time overlaps, rental clashes, vehicle/driver double-booking. **No permission-and-reason override.** |
| DSP-03 | Emergency trip creation | **N** | A trip exists only if a route generates it. |
| DSP-04 | Record no-shows and delays; cancel or interrupt trips | **P** | No-show recorded per passenger; trips can be cancelled with a reason. **No delay recording, no interruption, no repair transition.** |
| DRV-01 | Mobile-first driver home | **M** | Driver portal: today's assignments, next departure, route and stops, passenger count, vehicle, history. |
| DRV-02 | Driver actions incl. navigation, ready, delay report; idempotent event IDs | **P** | Open trip, manifest, start, board, no-show, complete. **No external navigation, no mark-ready, no delay report, and no idempotency key (5.8).** |
| DRV-03 | Boarding verification codes/OTP | **D** | Phase 2. |
| DRV-04 | Defect and breakdown report | **M** | Driver can raise an incident which blocks the vehicle and creates a work order. |
| DRV-05 | Offline PWA with queued events | **D** | Phase 2. |
| PAX-01 | Passenger portal | **N** | No passenger role or screen. |
| PAX-02 | Trip updates | **D** | Phase 2. |
| INC-01 | Incident record with type, severity, location, people affected, attachments, responder, status | **P** | Reference, vehicle, trip, type, severity, description, assignee, status, costs, log. **No driver, time, location, people affected, attachments.** |
| INC-02 | Breakdown workflow with replacement vehicle, passenger notification, history | **P** | Vehicle blocked, work order created, incident stays open. **No affected-passenger identification, no replacement listing, no notification.** |

### Finance

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| FIN-01 | Configurable pricing models (monthly, per trip, per passenger, distance, time, fixed quotation, waiting, extra stops, discounts) | **P** | Rental pricing basis (`per_day`, `per_km`, `per_trip`) with line items and a deposit rule; quotations are gated on the basis, currency, deposit %, validity and payment methods. **Quotations carry no tax lines and no discount line** (invoices do); **no waiting/overtime, extra-stop or discount policy; no contract pricing.** |
| FIN-02 | Invoices: number, customer, rental, dates, lines, taxes from settings, discounts, totals, paid, outstanding, status; no duplicate billing | **P** | Built in Phase 16: `invoice` table and `src/tms/finance.ts`, `InvoicesPage`. Number from `reference_counter`, lines copied from the completion record, tax lines snapshotted from settings, discount as its own line, amount paid and outstanding derived from payments, status `issued → part_paid → paid → void`, partial unique index on `billable_event` so a service is billed once, immutability triggers. **No credit notes/adjustment records, no PDF, no corporate invoice generation** (needs contracts). |
| FIN-03 | Manual payments: reference, invoice, amount, currency, method, date, external reference, verification/reconciliation status; immutable | **P** | Built in Phase 16: `payment` table; reference from the counter; method must be a configured one; external reference is the idempotency key (partial unique index + replay returns the existing payment); status only advances recorded → verified → reconciled; financial fields immutable by trigger; overpayment refused with the balance. **No adjustment records**, so a wrong payment cannot yet be corrected in-app. The deposit at confirmation remains a rental field, separate from the payment ledger. |
| FIN-04 | Payment provider integration | **D** | Phase 3. |
| FIN-05 | Expenses with supplier, receipt, approval status | **P** | Cost entries on incidents/work orders (category, amount, date, description). **No supplier, method, receipt or approval.** |
| FIN-06 | Driver allowances, payroll export | **D** | Phase 3. |
| FIN-07 | Finance dashboard reconciling to transaction records | **N** | Finance sees the operations dashboard; there is no money view. |
| FIN-08 | Payment reconciliation records | **D** | Phase 3. |

### Notifications, reporting, location

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| NTF-01 | Notification service with stored status and retries | **D** | Phase 2. No notification code exists at all. |
| NTF-02 | SMS adapter (Ghana provider) | **D** | Phase 2. |
| NTF-03 | Email adapter | **D** | Phase 2. |
| RPT-01 | Rental reports: enquiries, quotations, acceptance, confirmed/completed, revenue, outstanding, utilisation, cancellation reasons | **M** | `src/tms/rentalReport.ts` + `src/screens/Reports.tsx` (Phase 17). All eight figures are computed from records, with coverage stated, a currency guard and a CSV of the same numbers; 7 domain tests and 3 screen tests. Formulas in `docs/KPIS.md`. |
| RPT-02 | Staff transport and fleet reports | **P** | On-time pickup rate with data coverage (`src/tms/kpis.ts`). **No bookings, no-shows, passengers transported, route utilisation, contract performance, downtime, fuel, mileage.** |
| RPT-03 | Financial reports | **N** | No revenue, payments or outstanding-invoice reporting. |
| RPT-04 | Filters + CSV export, permission-scoped; formulas documented | **P** | Per-screen search and status filters; formulas documented in `docs/KPIS.md`. **No date-range filter bar, no CSV export, no coverage column on the screens.** |
| RPT-05 | PDF reports | **D** | Phase 3. |
| GPS-01 | Provider interface, labelled "Not configured" | **D** | Phase 2, hardware-gated. No provider interface and no "Not configured" label exists, because there is no tracking screen. |

---

## 9. §8 Core workflows

| Workflow | Status | Where it breaks |
| --- | --- | --- |
| **A** Recurring corporate staff transport | **Fail** | No corporate client entity, no employees with department/eligibility, no contracts, no bookings. Routes, rosters, trips, dispatch and manifests work. |
| **B** Employee return journey | **Fail** | Depends on BKG; directions exist on routes but there is no return-journey booking. |
| **C** Bus rental | **Partial** | Enquiry → quotation → confirmation → assignment → start → completion → invoice → payment → **rental report** now all work on real records and are covered by tests (`service.test.ts`, `finance.test.ts`, `Invoices.test.tsx`, `rentalReport.test.ts`, `Reports.test.tsx`). **Missing: WEB-01 (no public enquiry form) and the Playwright proof.** |
| **D** Vehicle breakdown | **Fail** | Incident creation and vehicle blocking work. **No replacement workflow, no notifications** (INC-02, NTF-01). |
| **E** Maintenance and release | **Partial** | Work order lifecycle works with blocking; **release approval and the technician role do not exist**. |
| **F** Corporate invoicing | **Fail** | Depends on contracts and bookings; no corporate invoice generation, no duplicate-billing protection yet. |
| **G** Emergency transport | **Fail** | No emergency trip creation (DSP-03). |

---

## 10. §9 Ghana requirements, §10 design constraints, §11 UI

| Area | Status | Evidence |
| --- | --- | --- |
| GHS currency, `+233`, `Africa/Accra` | Partial | Currency comes from settings and is displayed with amounts; timezone is handled as UTC calendar days. **No phone-format validation for `+233`; no Ghana digital address or landmark on stops** (§9 asks for both). |
| Palette, typography, accessibility (WCAG AA) | Met in kind | Indigo accent, stone neutrals, focus rings, skip link, labelled controls found in the shell and screens. A contrast audit has not been run in this pass. |
| Responsive tables, mobile-first operation | Partial | Data tables and panels are responsive; several wide tables require horizontal scroll on a phone. The driver portal is mobile-first. |
| Nav sections: Dashboard, Contracts, Employees, Customers, Bookings, Bus Rentals, Dispatch, Finance, Reports, Settings, Audit, Notifications | **Contradicted** | 14 destinations exist, but they are: Dashboard, Bus rentals, Staff busing, Staff logistics, Fleet readiness, Compliance, Vehicles, Drivers, Clients, Users, Settings, Audit, plus two portals. **No Contracts, Employees, Customers, Bookings, Dispatch, Finance, Reports or Notifications destinations.** |
| Table conventions (pagination, search, filters, bulk actions) | Partial | Search and status filters exist; **no pagination anywhere**; no bulk actions. |
| Empty, loading and error states | Met | Every screen checked shows an explicit empty state and error notice. |

---

## 11. §12 Testing requirements

| Requirement | Status |
| --- | --- |
| Authn/authz tests: unauth rejected, no self-granted roles, cross-company denied per route, drivers confined | Partial — authn, role denial and driver containment are tested; cross-company is not applicable (single-tenant) and is therefore **not satisfied** |
| Full from-to state matrix for every entity | Partial — rental transitions are tested; trips, work orders and incidents are tested less exhaustively; no `status_history` |
| Bookings/scheduling: valid, invalid, duplicate, capacity, conflicts, **parallel double-booking** | Partial — all except "parallel"; capacity covered by two tests, conflicts by several |
| Rentals: enquiry, arithmetic, expired quotation, conflicts, deposit, **additional charges need approval**, cancellation frees resources | Partial — everything except "additional charges need approval" and enquiry submission; invoice arithmetic impossible (no invoices) |
| Maintenance: lifecycle, blocking, unsafe vehicle, release approval | Partial — release approval not modelled |
| Finance: invoice totals, repeated callbacks, balances, same billable event twice, adjustment audit trail | **Partial** — invoice totals, tax lines, discount, part payment, overpayment refusal, duplicate billable event, idempotent replay and forward-only verification are tested (`finance.test.ts`). **No adjustment trail**, because adjustments do not exist. |
| Reporting: KPI formulas match `KPIS.md`, filters, isolation, exports | Partial — on-time and the rental report are documented and implemented, with a CSV export of the rental report; there is no filter bar across reports and no other export |
| End-to-end Playwright (8 scenarios) | **Fail** — no Playwright, no `e2e/` |
| Bookings/money tests against **real PostgreSQL** | **Fail** — the domain suite runs against an in-memory `Database` object |

Suite at audit time: **255 passed, 5 skipped** (260) across 34 files; typecheck and lint clean; `next build` succeeded (8 routes).

---

## 12. §13 Definition of done and §15 deliverables

| Item | Status |
| --- | --- |
| 1. Interface, server logic, validation, persistence, permissions all exist per feature | Partial — true for the features that exist; five Phase 1A features have none |
| 2. Automated tests for its rules, run in this session | Partial — most modules have them; invoices do not exist to be tested |
| 3. Typecheck, lint, test, build pass | **Met** — verified in this session |
| 4. Cross-company/permission-denial tests | Partial — cross-company impossible (single-tenant) |
| 5. No dead controls | Partial |
| 6. `PROGRESS.md` updated **per feature ID** with real status | **Fail** — PROGRESS is written by *phase*, names features in prose, does not list the 78 IDs, and contains at least one stale count ("147 tests") alongside the real 226 |
| `docs/API.md` | **Missing** |
| `docs/BACKUP_AND_RECOVERY.md` | **Missing** (backup and restore scripts exist: `scripts/backup.ts`, `scripts/restore.ts`, `npm run db:backup`) |
| `docs/USER_ROLES_GUIDE.md` | **Missing** |
| Seed scripts, clearly labelled demo data | Absent by design (owner's instruction: no demo data) — acceptable, but the "clearly labelled demo data" deliverable is therefore not met |
| Outstanding integrations / known limitations list | **Missing** as a document; scattered remarks only |

---

## 13. Defects found in this run

| # | Defect | Severity | Where | Status |
| --- | --- | --- | --- | --- |
| D-01 | **Seat capacity can be exceeded on a run already on the road.** Assignment, dispatch and start all re-check the roster against the vehicle, but adding an active passenger to a route mid-run had no check. Verified: a 22-seat vehicle carried 25 active passengers. | Safety / §5.1, §12 | `src/tms/busing.ts` `create_passenger`, `update_passenger` | **Fixed in this session** + regression test (`src/tms/busing.test.ts`, "refuses a roster addition that would overflow…") |
| D-02 | **`PROGRESS.md` still tracks work by phase, not by feature ID**, and its Phase 14 section describes the superseded "editorial" interface as if it were shipped. §13.6 requires per-ID status. | Documentation / §13.6 | `docs/PROGRESS.md` | Partly addressed in this pass (Phase 16 added, stale "not started" wording corrected); the per-ID rewrite is remediation item 4 |
| D-03 | **Reference numbers are derived from array length**, so they are not unique under concurrency and can be reissued after a restore. | Data integrity / §5.6 | `service.ts:799`, `logistics.ts:320,512` | Open |
| D-04 | **Money is handled as floating point** in the domain layer. | Financial correctness | `src/tms/service.ts`, all totals | Open — the invoice work moves new amounts to `numeric(14,2)` in the database, but the domain layer still computes in `number` |

---

## 14. Remediation plan — in the order the brief sets

The brief's Phase 1A order is: auth/permissions/audit/settings → fleet and drivers (incl. MIG-01) → customers and requests → availability and conflicts → quotations → confirmation/assignment/completion → **invoices and manual payments** → maintenance → **reports and public enquiry**. Steps 1–6 and 8 exist in some form; the work that remains, in that order:

1. ~~**MIG-01** — CSV import~~ **Done** (`2a27fac`).
2. ~~**FIN-02 / FIN-03** — invoice and payment entities~~ **Done, less adjustments** (Phase 16). The remaining gap is credit notes/adjustment records.
3. ~~**RPT-01** — rental report~~ **Done** (Phase 17).
4. **Docs of record** — rewrite `docs/PROGRESS.md` as a 78-ID table with real status; add `docs/API.md`, `docs/BACKUP_AND_RECOVERY.md`, `docs/USER_ROLES_GUIDE.md` and a known-limitations section. *(§13.6, §15; fixes D-02.)*
5. **WEB-01** — public enquiry endpoint with rate limiting and spam protection, creating a Submitted request and exposing no data. *(Brief step 9; last unbuilt Phase 1A feature with AUTH-05.)*
6. **Concurrency proof** — a test that fires parallel double-booking requests at the real database and asserts exactly one wins; and **Playwright for workflow C**. *(Phase 1A exit criteria.)*
7. **Structural fixes** — database sequences for all references (D-03); decimal money (D-04).
8. **Deferred by design, to be stated as such in the docs** — multi-tenancy, the ten-role model, contracts, bookings, notifications, offline driver mode, GPS. These are Phase 1B/2/3 or owner-approved simplifications, not Phase 1A defects, but they must be labelled in `PROGRESS.md` rather than left implicit.

---

## 15. How this audit was performed

- Read `richie-tms-standing-brief.md` §2–§15 and `richie-tms-phase-prompts.md` in full, and turned each line into a check.
- Traced every check to code in `src/tms`, `src/server`, `src/screens`, `src/app/api` and `db/migrations`.
- Ran the full quality gates: `npm run typecheck`, `npm run lint`, `npx vitest run` (**226 passed / 5 skipped**), `npm run build` (successful).
- Exercised a running build against a real PostgreSQL instance with the same commands the UI issues, capturing exact user-facing messages, and inspected the response payloads per role to check read scoping.
- Counted the backlog IDs against the brief to make the totals in §2 reconcilable: 78 IDs, 9 met, 37 partial, 18 not built, 14 deferred.
