# Progress

Status values: Not Started / In Progress / Done (verified) / Done (authored) / Blocked. "Done (verified)" means automated tests covering the item passed in the most recent session (`npm test`), and the production build succeeded (`npm run build`).

## Feature register - all 78 IDs (§13.6)

The brief numbers its requirements; this is the table that tracks them, one row per ID, in brief
order. The detailed evidence and the criteria behind each status are in
`audit/SPEC-CONFORMANCE-2026-10-24.md` §8; the Phase sections below record the work itself. A row
moves when a test or a delivered document backs the move, never when the code merely exists.

Legend - **Met** (does what the brief asks, tested) · **Partial** (present but narrower than the
brief) · **Not built** · **Deferred** (belongs to Phase 2/3 and has not been started).

| ID | Phase | Requirement (short) | Status | Where it stands |
| --- | --- | --- | --- | --- |
| AUTH-01 | 1A | Login/logout, secure session with expiry, rate-limited authentication endpoints. | Met | `src/app/api/auth/login`, `src/server/session.ts` (signed, httpOnly, `sameSite=lax`, 8 h TTL), `rateLimit.ts` (8 attempts / 15 min observed). Logout clears the cookie. |
| AUTH-02 | 1A | Invitation-based account creation and activation; suspend and reactivate accounts. | Partial | Admin creates an account with a password and `active` flag; suspend/reactivate works. **No invitation or activation flow** (no email provider installed). |
| AUTH-03 | 1A | Password reset. | Partial | Administrator-initiated reset only (`reset_user_password`, Argon2id rehash). No self-service "forgot password" — needs mail. |
| AUTH-04 | 1A | Role assignment, company association, protection against privilege escalation. | Partial | Role assignment and escalation protection present; **no company association** (single-tenant). |
| AUTH-05 | 1A | Profile management; login history. | Met | `src/screens/Profile.tsx` (nav "My account", every role), `GET/POST /api/profile`, commands `update_profile` / `change_own_password`. Sign-in history is the account's own `auth:sign_in` rows. Tests: `service.test.ts` "profile (AUTH-05)", `Profile.test.tsx` (3). |
| AUTH-06 | 2 | Two-factor authentication for privileged roles. | Deferred | Phase 2. |
| AUD-01 | 1A | Audit log and a viewer for Super Administrators. | Met | Insert-only table + trigger, viewer screen with filters. Caveats: no IP address; `audit:read` is also held by operations (dispatch needs to see who changed what), which is wider than "Super Administrators". Finance does not hold it. |
| SET-01 | 1A | Settings registry for all configurable policy: pricing models, tax lines, deposit policy, quote validity, cancellation windows, shift definitions,… | Partial | Present: pricing basis, deposit %, quote validity, payment methods, shifts, vehicle categories, document types, reminder lead days, maintenance intervals, on-time threshold. Tax position and tax lines are set here (used by invoices, rates limited to two decimals since Phase 22). **Missing: cancellation windows/refund rules, boarding-code policy, the expired/suspended-contract booking rule, contract billing.** |
| MIG-01 | 1A | Import existing vehicles, drivers and customers from CSV, with preview, row-level errors and no silent discards (same pattern as EMP-02). | Met | `src/tms/import.ts` + `src/ui/ImportPanel.tsx`; 12 domain tests and 2 screen tests; template documented in `SETUP_AND_DEPLOYMENT.md` §8. Live: `Imported 2 of 4 vehicles. 2 rejected: line 4 (Category "Spaceship" is not configured…); line 5 (A vehicle with this registration already exists.)`; the preview is read-only and each row runs the same command as a typed one. |
| CUS-01 | 1A | Customer register (individual or organisation): reference, contact person, telephone, email, billing details, type, status, notes, history. Staff can… | Partial | `Client` has name, contact name/phone/email, status. **No reference number, no billing details, no type (individual/organisation), no notes, no history view.** |
| RNT-01 | 1A | Rental request: customer, service date, departure time, return time or duration, pickup, destination, intermediate stops, passenger count, luggage or… | Partial | Has customer, start/end date, pickup, drop-off, passengers, purpose, category, driver requirement, notes. **Missing departure/return times, intermediate stops, luggage/special needs, trip contact, request source.** |
| RNT-02 | 1A | Rental status workflow: Draft, Submitted, Under Review, Awaiting Quotation, Quotation Sent, Awaiting Customer Confirmation, Confirmed, Dispatched, In… | Partial | 7 states (`draft → quoted → confirmed → in_progress → completed`, plus `declined`, `cancelled`) with an explicit transition table and rejection of invalid moves. **No separate quotation/booking entities and no Submitted/Under Review/Awaiting Quotation/Dispatched states.** |
| RNT-03 | 1A | Availability check by vehicle category, capacity, operating status and time range; driver availability when a driver is required. | Met | Live: wrong-category vehicle refused; overlapping assignment refused; driver licence expiry checked. Capacity checked at assignment against `passengers` (see D-01 for the mid-run gap). |
| RNT-04 | 1A | Quotation builder: quotation number, versioned, line items (base charge, distance charge, driver charge, approved waiting/overtime, other charges),… | Partial | Line items, deposit, validity, currency, requote history (`quoteHistory`). **No quotation number, no tax lines, no discount line, no terms and conditions, no approval record.** Expiry is enforced on confirmation (live). |
| RNT-05 | 1A | Confirmation: validate the request; check vehicle schedule, capacity, status and driver availability; detect conflicts; record customer acceptance… | Partial | Validation, conflict check, deposit-per-policy recorded, reservation created via constraint. **No customer acceptance record; no notification.** |
| RNT-06 | 1A | Assign and reassign vehicle and driver, with history. | Met | Reassignment allowed while confirmed/in progress; each assignment writes an audit entry. History lives in the audit log, not a dedicated table. |
| RNT-07 | 1A | Completion: actual departure/return, actual distance when available, vehicle and driver, trip status, additional charges (approval required), damage… | Partial | Completion captures final line items (including extra charges). **No actual departure/return times, distance, damage notes, feedback, or balance** (no payments). |
| RNT-08 | 1A | Cancellation releases reserved resources; reasons recorded. | Met | Verified live: a cancelled rental's dates were reusable immediately; reason required. |
| RNT-09 | 1C | Rental customer portal: own requests, quotations, payment status; accept or cancel where permitted. | Partial | Client portal lists own requests and quotations. **No accept/cancel action and no payment status** (no payments). |
| WEB-01 | 1A | Public rental enquiry endpoint and embeddable form for the existing website, with rate limiting and spam protection. It creates a Submitted request… | Met | `GET/POST /api/enquiry` (unauthenticated, `src/app/api/enquiry/route.ts`) creates a draft request through the `submit_enquiry` command and returns the reference and a sentence — no records, no counts. Throttled 8 per 10 minutes per address (`rateLimit.take`), plus a signed time-trap (`src/server/enquiryToken.ts`) and a honeypot. The form is `src/screens/PublicEnquiry.tsx` at `/enquiry` (`?embed=1` for the website iframe), the only path allowed to be framed (`next.config.ts`). *Submitted* is a `draft` in the existing status vocabulary — the office still quotes and confirms. Adding to PROGRESS 2026-10-24: no acknowledgement email (no mail provider). |
| FLT-01 | 1A | Vehicle register: ID, registration number, make/model, category, seats, photo, fuel type, ownership/leasing, odometer, insurance, roadworthiness,… | Partial | Registration, make, model, category, seats, status, notes, odometer readings. **No photo, fuel type, ownership/leasing, usual driver.** Insurance/roadworthiness exist as compliance documents. |
| FLT-02 | 1A | Vehicle statuses: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of Service, Pending Inspection. Define the rule for each state in… | Partial | 4 statuses (`available`, `maintenance`, `out_of_service`, `retired`); blocking enforced and observed. Reserved/Assigned/On Trip/Pending Inspection do not exist. |
| FLT-03 | 1A | Vehicle documents with expiry dates and configurable reminders. | Partial | Document register with expiry and configurable lead time; status computed per day. **Reminders are not sent** (no job runner, no notifications). |
| FLT-04 | 1A | Driver register: licence class and expiry, qualifications, availability, status. | Partial | Name, phone, licence number, expiry, status. **No licence class, qualifications or availability.** |
| FLT-05 | 1A | Fleet dashboard calculated from persisted records only: totals, availability, assigned, on trip, under maintenance, pending inspection, expiring… | Partial | Readiness and compliance screens give counts by status, overdue service and expiring documents. **No utilisation or downtime.** |
| MNT-01 | 1A | Work orders: reference, vehicle, reported fault, work type, priority, date reported, odometer, assignee, required work, parts, labour cost, parts… | Partial | Reference, vehicle, fault, type, priority, date, odometer, workshop, assignee, costs, log, and a release recorded with `releasedBy`/`releasedAt`. **Statuses are 5, not 8; no parts list and no inspection record.** |
| MNT-02 | 1A | Safety-related defects block the vehicle. It stays unavailable until an authorised person records the inspection and release; record who released it… | Partial | Blocking works and is tested. Release is now its own permission (`maintenance:release`, Phase 19): an account that may advance a work order still cannot close one, and `releasedBy`/`releasedAt` name who released the vehicle and when — exercised in the trial, §6. **No inspection record** (results, pass/fail, technician), and roles remain the five fixed ones rather than a separate technician role. |
| MNT-03 | 2 | Preventive maintenance reminders by calendar date, mileage and service interval. A passed date never marks maintenance complete. | Partial | Interval rules per category, due/overdue computed from odometer and last service; a passed date never completes anything. **No reminders** (no scheduler). Phase 2. |
| MNT-04 | 3 | Maintenance cost analytics: spend by vehicle, repairs by type, downtime, recurring faults, parts vs labour. | Deferred | Phase 3. |
| CLI-01 | 1B | Corporate client records: name, registration details if supplied, contact person, telephone, email, billing address, branches and office locations,… | Partial | Name, contact name/phone/email, status only. |
| CLI-02 | 1B | Contracts: reference, client, dates, status (Draft, Pending Approval, Active, Suspended, Expired, Terminated), attachment where supported, service… | Not built | No contract entity. |
| CLI-03 | 1B | Corporate dashboard limited to the client's own records. | Partial | Client portal shows own routes, roster and rentals. **No contracts, invoices or payment status.** |
| EMP-01 | 1B | Employee register: reference, name, contact, company, department, work location, shift, approved pickup and drop-off locations, account status,… | Partial | Passenger record: name, phone, employee reference, client, route, stop, status. **No department, work location, shift, eligibility, accessibility or drop-off.** |
| EMP-02 | 1B | CSV import: documented template, required-field validation, duplicate detection by reference and likely duplicates, preview before saving, row-level… | Not built | Not present. |
| EMP-03 | 1B | Employee management: shifts, locations, eligibility toggle, permitted exports. Deactivated employees cannot create bookings unless policy allows. | Partial | Route/stop assignment and status changes; no shifts, locations, eligibility or export. |
| RTE-01 | 1B | Locations and stops: coordinates, landmark description, optional Ghana digital address. | Partial | Stops have a name and a scheduled time only. |
| RTE-02 | 1B | Routes: reference, name, service type, client, origin/destination, ordered pickup and drop-off stops, operating days, shifts, planned start, expected… | Partial | Reference, name, client, direction, shift, category, weekdays, date range, ordered stops, status. **No expected duration or capacity requirement.** |
| RTE-03 | 1B | Recurring schedules by day and shift, one-time trips, copy a previous schedule, conflict detection. | Met | Live: 10 trips generated across weekdays for a date range; duplicate guard in the trip unique constraint. "Copy previous schedule" is absent. |
| RTE-04 | 1B | Explainable planning aid that considers pickup locations, destinations, capacity, required arrival times, durations, availability, existing… | Not built | No planning aid; dispatchers choose manually. |
| RTE-05 | 3 | Interface for a later vehicle-routing optimisation service. | Deferred | Phase 3. |
| BKG-01 | 1B | Booking types: home-to-office, office-to-home, one-time, recurring, approved ad-hoc, emergency, return, additional approved destination. | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| BKG-02 | 1B | Validation: eligibility, contract status, company policy, cut-off times, duplicates (unique constraint on employee and journey). | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| BKG-03 | 1B | Booking workflow with unique reference; accepted, rejected or pending per configured rules. | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| BKG-04 | 1B | Assign bookings to trips with a transactional capacity check (§5.1). | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| BKG-05 | 1B | Cancellation deadlines and reasons; waiting list; offer freed seats per policy and never auto-confirm unless policy permits. | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| BKG-06 | 1B | History of important booking changes. | Not built | **No booking entity exists.** Journeys are modelled only as trips with a route roster. Detail: `audit/SPEC-CONFORMANCE-2026-10-24.md` §8. |
| TRP-01 | 1B | Trip records: reference, service type, related booking or rental, client or customer, route, ordered stops, planned and actual times, manifest,… | Partial | Reference, route, date, planned/actual stop times, manifest, driver, vehicle, status (5), completion. **No service type, rental link, delayed/interrupted states, notification or incident reference.** |
| TRP-02 | 1B | Passenger manifests. | Met | Per-trip manifest from the route roster with boarding outcomes. |
| DSP-01 | 1B | Daily dispatch board (table or calendar): today's trips, upcoming departures, active, completed, delayed, cancelled, unassigned bookings, available… | Partial | Today's departures on the dashboard plus a filterable trip table. **No calendar, no unassigned list, no capacity-warning panel, no maintenance-block view.** |
| DSP-02 | 1B | Assign and reassign vehicle and driver, validating availability, qualifications, vehicle condition, capacity and conflicts. Overrides need permission… | Partial | Validation of category, status, roster capacity, licence expiry, time overlaps, rental clashes, vehicle/driver double-booking. **No permission-and-reason override.** |
| DSP-03 | 1B | Emergency trip creation. | Not built | A trip exists only if a route generates it. |
| DSP-04 | 1B | Record no-shows and delays; cancel or interrupt trips. | Partial | No-show recorded per passenger; trips can be cancelled with a reason. **No delay recording, no interruption, no repair transition.** |
| DRV-01 | 1B | Mobile-first driver home: profile, today's assignments, next trip, departure time, route and stops, passenger count, vehicle, alerts, history. | Met | Driver portal: today's assignments, next departure, route and stops, passenger count, vehicle, history. |
| DRV-02 | 1B | Driver actions: open trip, view manifest, open external navigation, mark ready, start, confirm boarding, record no-show, confirm drop-off, report… | Partial | Open trip, manifest, start, board, no-show, complete. **No external navigation, no mark-ready, no delay report, and no idempotency key (5.8).** |
| DRV-03 | 2 | Boarding verification: trip-specific code or OTP from a secure random source, expiry, single use where policy requires, results recorded, minimal… | Deferred | Phase 2. |
| DRV-04 | 1B | Vehicle defect report and breakdown/incident report (basic record; full handling in INC). | Met | Driver can raise an incident which blocks the vehicle and creates a work order. |
| DRV-05 | 2 | Offline operation (progressive web app): queue status and boarding events locally with event IDs, sync when connectivity returns, show "pending sync"… | Deferred | Phase 2. |
| PAX-01 | 1C | Passenger portal: profile, approved options, request eligible journeys, booking references and status, pickup time and location, history, cancel… | Not built | No passenger role or screen. |
| PAX-02 | 2 | Trip updates. Do not show a live map or live ETA when only manually entered statuses exist. | Deferred | Phase 2. |
| INC-01 | 2 | Incident records: reference, trip, vehicle, driver, time, type (breakdown, accident, driver unavailable, traffic delay, missed pickup, complaint,… | Partial | Reference, vehicle, trip, type, severity, description, assignee, status, costs, log. **No driver, time, location, people affected, attachments.** |
| INC-02 | 2 | Breakdown workflow: driver reports, incident created, dispatcher alerted, affected trips and passengers identified, eligible replacement vehicles and… | Partial | Vehicle blocked, work order created, incident stays open. **No affected-passenger identification, no replacement listing, no notification.** |
| FIN-01 | 1A | Configurable pricing models: fixed monthly, per trip, per passenger, distance-based, time-based, fixed quotation, approved waiting/overtime, approved… | Partial | Rental pricing basis (`per_day`, `per_km`, `per_trip`) with line items and a deposit rule; quotations are gated on the basis, currency, deposit %, validity and payment methods. **Quotations carry no tax lines and no discount line** (invoices do); **no waiting/overtime, extra-stop or discount policy; no contract pricing.** |
| FIN-02 | 1A | Invoices: number, customer or client, related contract or rental, dates, itemised lines, taxes from settings, discounts/adjustments, totals, amount… | Partial | Built in Phase 16: `invoice` table and `src/tms/finance.ts`, `InvoicesPage`. Number from `reference_counter`, lines copied from the completion record, tax lines snapshotted from settings, discount as its own line, amount paid and outstanding derived from payments, status `issued → part_paid → paid → void`, partial unique index on `billable_event` so a service is billed once, immutability triggers. Totals, tax lines and the balance are computed in whole pesewas with one rounding rule (Phase 22, D-72). **No credit notes/adjustment records, no PDF, no corporate invoice generation** (needs contracts). |
| FIN-03 | 1A | Manual payments: reference, customer, invoice or rental, amount, currency, method (cash, bank transfer, mobile money), date, external reference,… | Partial | Built in Phase 16: `payment` table; reference from the counter; method must be a configured one; external reference is the idempotency key (partial unique index + replay returns the existing payment); status only advances recorded → verified → reconciled; financial fields immutable by trigger; overpayment refused with the balance, compared in whole pesewas so an exact balance is accepted and one pesewa more is not (Phase 22, D-72). **No adjustment records**, so a wrong payment cannot yet be corrected in-app. The deposit at confirmation remains a rental field, separate from the payment ledger. |
| FIN-04 | 3 | Payment provider integration (for example Paystack or Flutterwave): verify webhook signatures, idempotent handling, never trust a browser redirect,… | Deferred | Phase 3. |
| FIN-05 | 3 | Expenses: reference, date, category (fuel, maintenance, repairs, tyres, tolls, other), vehicle, trip, supplier, amount, method, receipt, recorded-by,… | Partial | Cost entries on incidents/work orders (category, amount, date, description). **No supplier, method, receipt or approval.** |
| FIN-06 | 3 | Driver allowances, trip payments, overtime and payroll export, with configurable rules and approval. | Deferred | Phase 3. |
| FIN-07 | 1C | Finance dashboard whose totals reconcile to transaction records. Margin is shown only when cost and revenue data are sufficient. | Not built | Finance sees the operations dashboard; there is no money view. |
| FIN-08 | 3 | Payment reconciliation records. | Deferred | Phase 3. |
| NTF-01 | 2 | Notification service: in-app channel first, provider interface for others, configurable templates, stored status, retry on failure, duplicate-event… | Deferred | Phase 2. No notification code exists at all. |
| NTF-02 | 2 | SMS adapter through a Ghana-capable provider (candidates: Hubtel, Arkesel, mNotify; verify availability and pricing). SMS is the channel most staff… | Deferred | Phase 2. |
| NTF-03 | 2 | Email adapter. | Deferred | Phase 2. |
| RPT-01 | 1A | Rental reports: enquiries, quotations issued, acceptance rate, confirmed and completed rentals, revenue, outstanding balances, vehicle utilisation,… | Met | `src/tms/rentalReport.ts` + `src/screens/Reports.tsx` (Phase 17). All eight figures are computed from records, with coverage stated, a currency guard and a CSV of the same numbers; 7 domain tests and 3 screen tests. Formulas in `docs/KPIS.md`. |
| RPT-02 | 1C | Staff transport and fleet reports: bookings received/confirmed/completed/cancelled, no-shows, on-time pickup rate, average delay, passengers… | Partial | On-time pickup rate with data coverage (`src/tms/kpis.ts`). **No bookings, no-shows, passengers transported, route utilisation, contract performance, downtime, fuel, mileage.** |
| RPT-03 | 1C | Financial reports: revenue by service and customer, payments received, outstanding invoices, expenses by category, cost per trip, cost per passenger… | Not built | No revenue, payments or outstanding-invoice reporting. |
| RPT-04 | 1C | Filters (date range, service, client, customer, route, driver, vehicle, status) and CSV export, always permission-scoped. Every KPI formula is… | Partial | The rental report has a date range, a coverage panel and a CSV of the same figures (Phase 17); other screens have search and status filters. Formulas documented in `docs/KPIS.md`. **The other reports have no date range or CSV, and there is no cross-report filter bar** (service, client, route, driver, vehicle). |
| RPT-05 | 3 | PDF reports. | Deferred | Phase 3. |
| GPS-01 | 2 | Provider interface; last reported location with timestamp; clear distinction between live, stale and simulated locations; never fabricate… | Deferred | Phase 2, hardware-gated. No provider interface and no "Not configured" label exists, because there is no tracking screen. |

**78 IDs: 13 met, 38 partial, 13 not built, 14 deferred.** Phase 1A: 29 IDs - 9 met, 20 partial, 0 not built.

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
> them as a description of the current screens. The Daylight screens were built and verified in the
> same working period; their own record is `docs/DESIGN.md` §3-§8 rather than a row below.

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

*Written at the time.* Since then: RPT-01 shipped in Phase 17, WEB-01 and the parallel-request
double-booking test in Phase 19. **EMP-02 passenger import and the Playwright flow (D-68) remain
open**, and Phase 1B onward is where it was.

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
| Parallel double-booking: six operators, one vehicle | Done (verified in CI) | `src/server/concurrency.integration.test.ts`: six concurrent `assign_rental` calls → 1 success, 5 × 409 with "already assigned to RR-…", exactly one `resource_reservation` row; and a second case with **no advisory lock in the way** (two overlapping `saveDatabase` transactions) where the exclusion constraint rejects the loser with SQLSTATE `23P01` |
| A refusal caused by a clash returns 409, not 400 | Done (verified) | `Failure.kind = "conflict"` (`service.ts`), mapped in `runCommand`; only the assignment clash sets it today |
| **Defect fixed:** number series were written but never read back | Done (verified) | `loadDatabase` now reads `reference_counter`; without it the second payment of the day reused `PAY-…-0001` and was refused by `payment_reference_key` (the integration test caught it) |
| Vehicle release is a separate permission, and the releaser is recorded | Done (verified) | `maintenance:release` in `permissions.ts`; `advance_work_order` gate + `releasedBy`/`releasedAt`; audit action `maintenance:release`; tests "records who released the vehicle…" and "refuses to release a vehicle for an account that may advance work but not release it"; schema 12 (D-64), 13 from Phase 21 |
| AUTH-05: own profile, own password, own sign-in history | Done (verified) | `src/screens/Profile.tsx` (nav "My account", every role), `GET/POST /api/profile`; commands `update_profile` and `change_own_password` need no administrative permission; sign-ins are read from `audit_entry`, and the screen says no address or device is kept; tests: 3 domain (`service.test.ts` "profile (AUTH-05)"), 3 screen (`Profile.test.tsx`). Changing a password re-seals the session, so the device that changed it stays signed in and every other one stops (D-69) |
| Workflow C over HTTP: the built application, started for real, driven from setup to a paid invoice | Done (verified locally; CI job added) | `scripts/e2e-workflow-c.ts` (`npm run e2e`), 39 checks: health, 401 before sign-in, first-run setup, session, settings, the public enquiry form (WEB-01), vehicle, rental, quotation, deposit, assignment, start, completion, invoice (GHS 3,450 due in 14 days), two payments, reload, AUTH-05 profile + sign-in history, and 403 for cross-origin writes. New `e2e` job in `ci.yml` migrates, builds, starts `next start` and runs it (D-68: a substitute for Playwright, labelled as one) |
| 78-ID register in `PROGRESS.md` | Done (verified) | The table at the top of this file: one row per brief ID with phase, status and evidence; closes D-02 |
| **WEB-01** public enquiry endpoint and embeddable form | Done (verified against the built server) | `GET/POST /api/enquiry` + `src/screens/PublicEnquiry.tsx` at `/enquiry`; 7 domain tests (`src/tms/enquiry.test.ts`), 8 boundary tests (`src/app/api/enquiry/route.test.ts`), 7 screen tests (two of them the framed-height message), 5 token tests, and 13 checks in `npm run e2e` against `next start` — including a token refused at zero seconds and accepted at five (D-70). The paste-ready host page is `embed/enquiry-iframe.html` |
| **Still open** | — | The Playwright requirement itself (the HTTP proof is the recorded substitute, D-68) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **290 passed, 10 skipped** (the 10 are
the integration suites, which only run with `TEST_DATABASE_URL`), coverage 76.9% statements / 81.5%
lines against thresholds of 70/74, integration **10 passed**, `build` succeeds, and all three CI jobs
are green (`quality-gates`, `integration`, `e2e` — run 40067337023 on `02e5976`).

## Phase 20 - The trial on real data

The Phase 1A feature register is now at **zero unbuilt IDs**, so the next gate is not another feature:
it is the same features proved on the owner's records, prices and customers, with a backup that has
been restored at least once.

| Item | Status | Evidence |
|---|---|---|
| Trial checklist | Done (authored; the run itself is the owner's) | `docs/REAL_DATA_TRIAL.md`: copy the database first, restore a backup and compare counts, settings, CSV import, one real rental from request to a paid invoice (including the double-booking refusal and an over-payment refusal), the maintenance release control, reports reconciled by hand, the public enquiry form from a signed-out browser, and a restart. §10 is the sign-off table |
| The trial itself | **Copy clean on 2026-10-25** (build `c7d6454`); the live-database repeat of §5–§8 is still to run | §1–§10 passed on `richie_tms_trial` at port 3001 with no step failing, including the §5 arithmetic probe to the pesewa (3.98 deposit, 2.39 VAT, 18.29 total, one pesewa over refused). Recorded in `docs/REAL_DATA_TRIAL.md` §10 "Runs recorded" |

After the trial, the remaining open work is what the brief puts in Phase 1B/1C and what this build
has recorded as deliberately absent: contracts, bookings, employee/passenger import (EMP-02), the
financial reports (RPT-03), the browser automation the brief asks for (D-68), and the notification
and GPS work that Phase 2 owns.

## Phase 21 - Reference numbers: one allocator, and no way back (D-03)

The last open data-integrity defect from the conformance report. Rentals, routes, trips, incidents
and work orders were numbered `prefix + (records.length + 1)`: two commands at the same instant got
the same number, and any archive-then-create handed a printed number to a new record.

| Item | Status | Evidence |
|---|---|---|
| One allocator for all seven series | Done (verified) | `src/tms/references.ts` (`allocateReference`, `highestIssued`, `referencePattern`); used by `create_rental`, `submit_enquiry`, `create_route`, `generate_trips`, `create_incident`, `create_work_order`, `issue_rental_invoice`, `record_payment`. Formats unchanged: `RR-0001`, `RT-001`, `TR-0001`, `IN-0001`, `WO-0001`, `INV-2026-0001`, `PAY-2026-0001` |
| Counter written with the record, in one transaction | Done (verified) | `referenceCounters` travels on the snapshot; `saveDatabase` mirrors it into `reference_counter`; `runCommand` holds the advisory lock. Integration test reads the row back straight from the table and reloads it (`references.integration.test.ts`) |
| A deleted record's number is not reissued | Done (verified) | Integration test deletes `RR-0002` from the table, creates another rental through `runCommand`, and gets `RR-0003` |
| A series cannot be rewound | Done (verified) | Trigger `reference_counter_no_rewind` (migration `004_reference_series.sql`) raises on any lower `last`; the failure is mapped to a readable 409 ("that backup is older than this installation's numbering"). `describeDatabaseError` test included |
| A database written before this migration continues its series | Done (verified) | `highestIssued` derives the floor from the highest reference present, never from a count; unit tests cover the missing-counter and the stale-counter cases |
| Schema | Done | `SCHEMA_VERSION` 13; migration `004_reference_series.sql` widens `reference_counter` scope and period (`all` for continuous series) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **302 passed, 14 skipped** (the 14
are the four integration suites, which only run with `TEST_DATABASE_URL`), `build` succeeds,
`npm run e2e` **39/39** against the built server, and the integration suite green against
PostgreSQL (12 of 14 locally — the two concurrency cases need more than one live connection, which
the local PGlite stand-in cannot give; they run in CI against `postgres:18-alpine`).

## Phase 22 - Money: whole pesewas, rounded once (D-04)

The last open correctness defect from the conformance report. Every amount was a JavaScript `number`,
so percentages were rounded twice - once by `round2`, once by PostgreSQL `numeric(14,2)` - and the two
did not always agree. Measured before the change, against exact integer half-up over every 2-decimal
subtotal below GHS 10,000:

| Percentage | Amounts computed a pesewa wrong |
|---|---|
| VAT 15% | 3,707 per million |
| NHIL 2.5% | 1,132 |
| GETFund 3% | 611 |
| 12.5% | 8,189 |
| 25% deposit | 16,390 |

GHS 15.90 at 15% showed 2.38 where a person writes 2.39; GHS 8.54 at a 25% deposit showed 2.13 where
the quotation asks 2.14. Nothing crashed: the invoice was simply a pesewa off, and the payment guard
that compared `paid + 0.001 >= total` hid the difference.

| Item | Status | Evidence |
|---|---|---|
| One arithmetic module | Done (verified) | `src/tms/money.ts`: `toMinor`/`fromMinor`, `sumAmounts`, `divideHalfUp`, `percentOfMinor`, `lineAmount`/`linesTotal`, `formatAmount`, `parseAmount`/`parsePositiveAmount`/`parseQuantity`, `linesTotalFromText`, `isPercentWithTwoDecimals` |
| One rounding rule, stated once | Done | Half-up, ties away from zero, applied once per line or percentage - never inside a sum. Rates become integer basis points, quantities integer thousandths, so a percentage of a percentage cannot drift |
| Invoices | Done (verified) | `finance.ts` computes discount, subtotal, each tax line, total, paid and outstanding in minor units; `statusFor` takes minor units. `taxLinesFor` uses `percentOfMinor` |
| Quotations, deposits, completions | Done (verified) | `service.ts`: `validateQuoteLines` parses each line, `linesTotal` sums them, `buildQuote` takes the deposit with `percentOf`, `confirm_rental` compares the deposit in minor units |
| Payments | Done (verified) | Over-payment is now a comparison of whole pesewas, with no `+0.001` tolerance; the balance message uses `formatAmount` |
| Input is read, not coerced | Done (verified) | `parseAmount` accepts decimal text only and refuses `1,000`, `1e3`, `100.005`, `-5`, non-ASCII digits and anything above GHS 1,000,000,000. A third decimal is a field error, not a silent round. Settings refuse a tax or deposit rate with more than two decimals |
| Aggregates | Done (verified) | `costs.ts`, `rentalReport.ts`, `repository.ts` (`cost_total`), and the invoice, dashboard and reports screens add with `sumAmounts`/`linesTotal`, so a KPI cannot disagree with the invoices under it |
| Screens | Done (verified) | Quote and completion editors and the invoice preview total with the same function the command uses (`linesTotalFromText`, `linesTotal`, `lineAmount`, `percentOf`), so the figure on screen is the figure stored |
| Tests | Done (verified) | `src/tms/money.test.ts` (17): pinned regressions 15% of 15.90 → 2.39 and 25% of 8.54 → 2.14, a sweep of every 25th pesewa below GHS 10,000 at five rates against longhand integer half-up, float-drift cases, and the parser refusals; `service.test.ts` adds three gate cases (deposit rate, tax rate and a quoted third decimal refused, a half-pesewa quantity tie rounded up with its deposit); `finance.test.ts` adds six document-level cases: the tie rounded up on an issued invoice, the deposit tie in a quotation, three part payments settling to zero outstanding, one pesewa over the balance refused, a third decimal refused without writing anything, and a discount with a third decimal refused |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **328 passed, 14 skipped**,
`build` succeeds, `npm run e2e` **39/39** against the built server.

Still open: the Playwright requirement (D-68), credit-note and adjustment records, EMP-02 passenger
import, RPT-03 financial reports, and the trial on real data (`docs/REAL_DATA_TRIAL.md`).

## Phase 23 - The open questions, answered; the code they unblock queued (D-73)

Fourteen questions were stopping real behaviour. The owner delegated the answers, keeping the right to
change any of them, so each one is now a recommendation with a reason and a stated cost of undoing it
(`docs/OPEN_QUESTIONS.md` -> "Recommended answers"). Nothing that changes behaviour was implemented
in this phase: the answers are accepted-or-not first, and the code follows in the order below.

| Item | Status | Evidence |
|---|---|---|
| Fourteen answers recorded | Done | `docs/OPEN_QUESTIONS.md` "Recommended answers": Q-01/Q-50, Q-16, Q-19, Q-29, Q-33, Q-34, Q-38, Q-42, Q-43, Q-45, Q-46, Q-47, Q-48, Q-49, plus Q-35, Q-10 and Q-12 as three further answers offered at the same time |
| Answered by confirming today's behaviour (no code) | Done | Q-19 no boarding codes, Q-33 drivers already report breakdowns, Q-45 hand-recorded odometer, Q-46 renewal uses current settings |
| Answered by statement (no code) | Done | Q-01/Q-50 one office machine on the LAN, Caddy or nginx in front; Q-49 proprietary and private, `LICENSE` added and `README.md` updated |
| Decisions recorded | Done | D-73 (the set), D-74 (a wrong trip entry is corrected, never edited), D-75 (safety defects block; an overdue routine service warns) |
| **Code queued, in this order** | Not started | 1. Q-42 correction entries + `trips:correct`; 2. Q-47 cancel an in-progress run with a reason and optional incident; 3. Q-16 mandatory insurance and roadworthiness before assignment; 4. Q-38 several client contacts; 5. Q-34 work-type list and Q-29 report definitions (with RPT-03); 6. Q-48 roster-change marker; 7. Q-43 the stricter dispatch switch |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **328 passed, 14 skipped**, `build`
succeeds. Documentation and one licence file only; no behaviour changed.

Still open: the live-database repeat of the trial (§5-§8), which needs the owner's machine, and the
brief's later stages (bookings, contracts, notifications, GPS).

## Phase 24 - Correcting a recorded run (item 1 of the queued list)

Q-42 answered by D-74: a wrong stop time or boarding outcome is **corrected, never edited**. The run
keeps its record, the correction keeps the value it replaced, and the change is attributed.

| Item | Status | Evidence |
|---|---|---|
| A correction is its own record | Done (verified) | `TripCorrection` (`src/tms/types.ts`): field, stop, rider, previous value, new value, reason, `correctedAt`, `correctedBy`; stored append-only on the trip |
| New command `correct_trip_record` | Done (verified) | `src/tms/busing.ts`; whitelisted in `src/app/api/commands/route.ts` |
| Its own permission | Done (verified) | `trips:correct` held by operations and the administrator, **not** by a driver: recording a fact and correcting it are different acts (test "is closed to the driver who recorded the run, and to finance") |
| The run's order survives a correction | Done (verified) | A time cannot move before the previous stop or after the next; refused with the neighbouring stop named, and a second check walks the whole log after the change |
| Only something recorded can be corrected | Done (verified) | A stop with no recorded time, or a rider with no outcome at that stop, is refused; the form lists only the recorded ones |
| A reason is required | Done (verified) | Empty reason refused; the reason is in the audit entry with the actor's name |
| The on-time judgement follows the correction | Done (verified) | Recomputed from the stop log at read time against the threshold snapshotted at completion, so a corrected time flows into RPT-02 without re-judging old runs against today's setting |
| A repeatedly corrected run is visible | Done (verified) | Every correction is kept; the run sheet shows "N corrections" and the panel lists each one with who, when and why |
| Audit entry names no rider | Done (verified) | Summary carries reference, stop, field and values — never a passenger name (data minimisation, as for boarding records themselves) |
| Schema | **No migration** | Corrections live in the trip's JSON `data`, which `loadDatabase` already reads; older records are normalised to `corrections: []` by `migrate()` |
| Tests | Done (verified) | 7 domain (`busing.test.ts` "corrections to a recorded run") and 4 screen (`src/screens/Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **339 passed, 14 skipped**, `build`
succeeds.

Next on the queued list: Q-47, cancelling a run that has started.

## Phase 25 - Stopping a run that has started (item 2 of the queued list)

Q-47 answered by D-75: a run that cannot be completed gets a recorded way out. Until this phase the
dispatch board offered no legal move once a trip was in progress, so a breakdown left the dispatcher
with a run that could never be closed.

| Item | Status | Evidence |
|---|---|---|
| `cancel_trip` accepts an in-progress run | Done (verified) | `src/tms/busing.ts`; still refused for a completed or already-cancelled run |
| What happened is kept | Done (verified) | Stop logs and boarding outcomes already recorded are untouched; the message and the audit entry state how many stops and how many rider outcomes were kept, and how many riders had no outcome |
| Who and when | Done (verified) | `cancelledAt`, `cancelledBy` on the trip (null for runs cancelled before this phase, normalised on load) |
| The cause is linked, not described | Done (verified) | Optional `incidentId` on the command. If an unresolved breakdown, accident or safety incident exists against the run or its vehicle, the cancellation **must** name it — refused with the reference until it does, so the two records cannot describe the same morning differently. An incident about another vehicle, or one already resolved, is refused |
| The simple case stays simple | Done (verified) | A planned or dispatched run still cancels with a reason alone |
| Screen | Done (verified) | "Stop run" on an in-progress trip opens a panel that says what will be kept and offers the relevant incidents; the submit button reads "Stop this run" so it cannot be confused with the row action |
| Audit | Done (verified) | `trips:cancel` entry carries the trip reference, the incident reference in brackets, the stop count, the rider counts and the reason |
| Tests | Done (verified) | 7 domain (`busing.test.ts` "stopping a run that has already started") and 3 screen (`Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **349 passed, 14 skipped**, `build`
succeeds.

Next on the queued list: Q-16, insurance and roadworthiness required before a vehicle is assigned.
