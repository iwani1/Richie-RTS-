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
| RNT-03 | 1A | Availability check by vehicle category, capacity, operating status and time range; driver availability when a driver is required. | Met | Live: wrong-category vehicle refused; overlapping assignment refused; driver licence expiry checked; a required document that is missing or lapsed on the hire date refuses the vehicle or the driver (Phase 26, D-76). Capacity checked at assignment against `passengers` (see D-01 for the mid-run gap). |
| RNT-04 | 1A | Quotation builder: quotation number, versioned, line items (base charge, distance charge, driver charge, approved waiting/overtime, other charges),… | Partial | Line items, deposit, validity, currency, requote history (`quoteHistory`). **No quotation number, no tax lines, no discount line, no terms and conditions, no approval record.** Expiry is enforced on confirmation (live). |
| RNT-05 | 1A | Confirmation: validate the request; check vehicle schedule, capacity, status and driver availability; detect conflicts; record customer acceptance… | Partial | Validation, conflict check, deposit-per-policy recorded, reservation created via constraint. **No customer acceptance record; no notification.** |
| RNT-06 | 1A | Assign and reassign vehicle and driver, with history. | Met | Reassignment allowed while confirmed/in progress; each assignment writes an audit entry. History lives in the audit log, not a dedicated table. |
| RNT-07 | 1A | Completion: actual departure/return, actual distance when available, vehicle and driver, trip status, additional charges (approval required), damage… | Partial | Completion captures final line items (including extra charges). **No actual departure/return times, distance, damage notes, feedback, or balance** (no payments). |
| RNT-08 | 1A | Cancellation releases reserved resources; reasons recorded. | Met | Verified live: a cancelled rental's dates were reusable immediately; reason required. |
| RNT-09 | 1C | Rental customer portal: own requests, quotations, payment status; accept or cancel where permitted. | Partial | Client portal lists own requests and quotations. **No accept/cancel action and no payment status** (no payments). |
| WEB-01 | 1A | Public rental enquiry endpoint and embeddable form for the existing website, with rate limiting and spam protection. It creates a Submitted request… | Met | `GET/POST /api/enquiry` (unauthenticated, `src/app/api/enquiry/route.ts`) creates a draft request through the `submit_enquiry` command and returns the reference and a sentence — no records, no counts. Throttled 8 per 10 minutes per address (`rateLimit.take`), plus a signed time-trap (`src/server/enquiryToken.ts`) and a honeypot. The form is `src/screens/PublicEnquiry.tsx` at `/enquiry` (`?embed=1` for the website iframe), the only path allowed to be framed (`next.config.ts`). *Submitted* is a `draft` in the existing status vocabulary — the office still quotes and confirms. Adding to PROGRESS 2026-10-24: no acknowledgement email (no mail provider). |
| FLT-01 | 1A | Vehicle register: ID, registration number, make/model, category, seats, photo, fuel type, ownership/leasing, odometer, insurance, roadworthiness,… | Partial | Registration, make, model, category, seats, status, notes, odometer readings. **No photo, fuel type, ownership/leasing, usual driver.** Insurance/roadworthiness exist as compliance documents. |
| FLT-02 | 1A | Vehicle statuses: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of Service, Pending Inspection. Define the rule for each state in… | Partial | 4 statuses (`available`, `maintenance`, `out_of_service`, `retired`); blocking enforced and observed. Reserved/Assigned/On Trip/Pending Inspection do not exist. |
| FLT-03 | 1A | Vehicle documents with expiry dates and configurable reminders. | Partial | Document register with expiry and configurable lead time; status computed per day. A type may be marked required, which blocks assignment while it is missing or lapsed (Phase 26). **Reminders are not sent** (no job runner, no notifications). |
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
| EMP-02 | 1B | CSV import: documented template, required-field validation, duplicate detection by reference and likely duplicates, preview before saving, row-level… | Met | `src/tms/import.ts` with `kind="passengers"` from the Passengers tab (Phase 31, D-81): template documented in `docs/SETUP_AND_DEPLOYMENT.md` §8, names resolved to records, duplicates by employee reference rejected, likely duplicates flagged **Check**, preview before saving, every row either created or named by line. |
| EMP-03 | 1B | Employee management: shifts, locations, eligibility toggle, permitted exports. Deactivated employees cannot create bookings unless policy allows. | Partial | Route/stop assignment and status changes; no shifts, locations, eligibility or export. |
| RTE-01 | 1B | Locations and stops: coordinates, landmark description, optional Ghana digital address. | Partial | Stops have a name and a scheduled time only. |
| RTE-02 | 1B | Routes: reference, name, service type, client, origin/destination, ordered pickup and drop-off stops, operating days, shifts, planned start, expected… | Partial | Reference, name, client, direction, shift, category, weekdays, date range, ordered stops, status. **No expected duration or capacity requirement.** |
| RTE-03 | 1B | Recurring schedules by day and shift, one-time trips, copy a previous schedule, conflict detection. | Met | Live: 10 trips generated across weekdays for a date range; duplicate guard in the trip unique constraint. "Copy previous schedule" is absent. |
| RTE-04 | 1B | Explainable planning aid that considers pickup locations, destinations, capacity, required arrival times, durations, availability, existing… | Not built | No planning aid; dispatchers choose manually. |
| RTE-05 | 3 | Interface for a later vehicle-routing optimisation service. | Deferred | Phase 3. |
| BKG-01 | 1B | Booking types: home-to-office, office-to-home, one-time, recurring, approved ad-hoc, emergency, return, additional approved destination. | Partial | One **one-time** booking or a **recurring** series (one booking per operating day, at most 62 days); the direction of travel — to work, from work, other — comes from the route, and a booking may be made on a scheduled or an ad hoc (emergency) run. **No separate return or additional-destination booking type, and no distinct approved-ad hoc type** beyond the ad hoc run (DSP-03). |
| BKG-02 | 1B | Validation: eligibility, contract status, company policy, cut-off times, duplicates (unique constraint on employee and journey). | Partial | Eligibility: the rider must be active, must belong to the same client as the route, and must **not** already be on that route's roster (booking would count the seat twice). Duplicates: a partial unique index on `(trip_id, passenger_id)` for live statuses. Cut-offs: `settings.booking.requestCutoffMinutes` / `cancellationCutoffMinutes`, whole minutes, blank = no deadline. The run must exist and not be cancelled, completed or already departed. **No contract status and no company-policy rules** (no contract entity, CLI-02). |
| BKG-03 | 1B | Booking workflow with unique reference; accepted, rejected or pending per configured rules. | Met | `create_booking` in `src/tms/bookings.ts`: continuous references `BK-0001`, `BK-0002`…; `requested → confirmed \| rejected \| waitlisted` and `waitlisted → offered → confirmed \| cancelled`; a reason is required to refuse or cancel; each decision writes an audit entry (`bookings:create\|confirm\|waitlist\|reject\|cancel`). Tested in `bookings.test.ts` ("books a named seat for a visitor…", "rejects a request with a reason…"). |
| BKG-04 | 1B | Assign bookings to trips with a transactional capacity check (§5.1). | Met | Capacity = vehicle seats − active roster on the route − confirmed/offered bookings (`capacityOf`), checked inside the single write transaction every command runs in under the global advisory lock, so two requests cannot both take the last seat; confirming on a full run moves the booking to the waiting list instead of overbooking. A run with **no vehicle assigned cannot be booked at all** — the seats cannot be counted. Caveat: the check lives in the command, not in a database constraint (unlike the rental exclusion constraint), so a direct SQL insert would bypass it. |
| BKG-05 | 1B | Cancellation deadlines and reasons; waiting list; offer freed seats per policy and never auto-confirm unless policy permits. | Met | Cancellation requires a reason and is refused inside the configured cut-off; cancelling a held seat **offers** it to the oldest waiter (`offeredAt`) and stops — **nothing is auto-confirmed**, and there is no expiry timer (D-83). Tests: "offers the freed seat to the oldest waiter and confirms nobody", "applies a cancellation cut-off only when one is configured". |
| BKG-06 | 1B | History of important booking changes. | Met | `Booking.history` keeps one entry per change (who, when, action, note) beside the audit log; shown as **Last change** on the Bookings tab. Test "keeps the whole history of what happened to the booking". |
| TRP-01 | 1B | Trip records: reference, service type, related booking or rental, client or customer, route, ordered stops, planned and actual times, manifest,… | Partial | Reference, route, date, planned/actual stop times, manifest, driver, vehicle, status (5), completion. **No service type, rental link, delayed/interrupted states, notification or incident reference.** |
| TRP-02 | 1B | Passenger manifests. | Met | Per-trip manifest with boarding outcomes: the route roster **plus** the seats booked on that run (`manifestFor`, Phase 35, D-85), each rider marked roster or booked with the seat reference and pickup stop, on the office screen and the driver portal alike. |
| DSP-01 | 1B | Daily dispatch board (table or calendar): today's trips, upcoming departures, active, completed, delayed, cancelled, unassigned bookings, available… | Partial | Today's departures on the dashboard plus a filterable trip table. **No calendar, no unassigned list, no capacity-warning panel, no maintenance-block view.** |
| DSP-02 | 1B | Assign and reassign vehicle and driver, validating availability, qualifications, vehicle condition, capacity and conflicts. Overrides need permission… | Partial | Validation of category, status, roster capacity, licence expiry, time overlaps, rental clashes, vehicle/driver double-booking. **No permission-and-reason override.** |
| DSP-03 | 1B | Emergency trip creation. | Met | `create_adhoc_trip` (Phase 32, D-82): a run outside the schedule for any date from today, with a written reason and its own TR number; migration 006 narrows the one-per-day index to scheduled runs so a replacement can stand beside the cancelled one. Created from **Add an ad hoc run** on the Trips tab, marked "ad hoc" with its reason on the run sheet, and checked exactly as a planned run is. |
| DSP-04 | 1B | Record no-shows and delays; cancel or interrupt trips. | Partial | No-show recorded per passenger; trips can be cancelled with a reason. **No delay recording, no interruption, no repair transition.** |
| DRV-01 | 1B | Mobile-first driver home: profile, today's assignments, next trip, departure time, route and stops, passenger count, vehicle, alerts, history. | Met | Driver portal: today's assignments, next departure, route and stops, passenger count, vehicle, history. |
| DRV-02 | 1B | Driver actions: open trip, view manifest, open external navigation, mark ready, start, confirm boarding, record no-show, confirm drop-off, report… | Partial | Open trip, manifest (roster and booked seats, D-85), start, board, no-show, complete. **No external navigation, no mark-ready, no delay report, and no idempotency key (5.8).** |
| DRV-03 | 2 | Boarding verification: trip-specific code or OTP from a secure random source, expiry, single use where policy requires, results recorded, minimal… | Deferred | Phase 2. |
| DRV-04 | 1B | Vehicle defect report and breakdown/incident report (basic record; full handling in INC). | Met | Driver can raise an incident which blocks the vehicle and creates a work order. |
| DRV-05 | 2 | Offline operation (progressive web app): queue status and boarding events locally with event IDs, sync when connectivity returns, show "pending sync"… | Deferred | Phase 2. |
| PAX-01 | 1C | Passenger portal: profile, approved options, request eligible journeys, booking references and status, pickup time and location, history, cancel… | Not built | No passenger role or screen. |
| PAX-02 | 2 | Trip updates. Do not show a live map or live ETA when only manually entered statuses exist. | Deferred | Phase 2. |
| INC-01 | 2 | Incident records: reference, trip, vehicle, driver, time, type (breakdown, accident, driver unavailable, traffic delay, missed pickup, complaint,… | Partial | Reference, vehicle, trip, type, severity, description, assignee, status, costs, log. **No driver, time, location, people affected, attachments.** |
| INC-02 | 2 | Breakdown workflow: driver reports, incident created, dispatcher alerted, affected trips and passengers identified, eligible replacement vehicles and… | Partial | Vehicle blocked, work order created, incident stays open. **No affected-passenger identification, no replacement listing, no notification.** |
| FIN-01 | 1A | Configurable pricing models: fixed monthly, per trip, per passenger, distance-based, time-based, fixed quotation, approved waiting/overtime, approved… | Partial | Rental pricing basis (`per_day`, `per_km`, `per_trip`) with line items and a deposit rule; quotations are gated on the basis, currency, deposit %, validity and payment methods. **Quotations carry no tax lines and no discount line** (invoices do); **no waiting/overtime, extra-stop or discount policy; no contract pricing.** |
| FIN-02 | 1A | Invoices: number, customer or client, related contract or rental, dates, itemised lines, taxes from settings, discounts/adjustments, totals, amount… | Partial | Built in Phase 16: `invoice` table and `src/tms/finance.ts`, `InvoicesPage`. Number from `reference_counter`, lines copied from the completion record, tax lines snapshotted from settings, discount as its own line, amount paid and outstanding derived from payments, status `issued → part_paid → paid → void`, partial unique index on `billable_event` so a service is billed once, immutability triggers. Totals, tax lines and the balance are computed in whole pesewas with one rounding rule (Phase 22, D-72). **Credit notes** (Phase 36, D-86): a numbered `CN-2026-0001` document against one invoice, with its own date, line, reason and the invoice's own tax snapshot, immutable once issued, voidable, capped at the invoice total, and the basis of every balance the system states (`outstanding = total − paid − credited`, one helper in `src/tms/creditNotes.ts`). A credit that takes the bill below what was paid is reported as a refund due rather than netted away. **Printable copies** (Phase 37, D-87): the invoice and each credit note print as a formatted A4 sheet, or save as a PDF from the browser's own print dialog, with the amount due taken from the same balance helper. **Still missing: no stored or emailed copy, no corporate invoice generation** (needs contracts). |
| FIN-03 | 1A | Manual payments: reference, customer, invoice or rental, amount, currency, method (cash, bank transfer, mobile money), date, external reference,… | Partial | Built in Phase 16: `payment` table; reference from the counter; method must be a configured one; external reference is the idempotency key (partial unique index + replay returns the existing payment); status only advances recorded → verified → reconciled; financial fields immutable by trigger; overpayment refused with the balance, compared in whole pesewas so an exact balance is accepted and one pesewa more is not (Phase 22, D-72). A wrong amount on an invoice is now corrected with a credit note (Phase 36, D-86), which leaves the payment row untouched. **A payment recorded in error is cancelled** (Phase 38, D-88): one-way, reason required, the record keeps its number and its place in the list, the amount stops counting as received and the invoice goes back to what it actually owed; a cancelled payment is excluded from both money reports, the finance home and the printed sheet by one shared rule. The deposit at confirmation remains a rental field, separate from the payment ledger. **Money going back out has its own record** (Phase 41, D-92): a numbered `REF-` refund against an invoice, capped at what is still owed back, with a required reason, cancellable once, stated on the invoice, the customer statement, the money report and the finance home. **Still missing:** no cash book (an operator cannot reconcile a day's takings), and a payment that was real and later returned is corrected by a refund, not by a reversal of the payment. |
| FIN-04 | 3 | Payment provider integration (for example Paystack or Flutterwave): verify webhook signatures, idempotent handling, never trust a browser redirect,… | Deferred | Phase 3. |
| FIN-05 | 3 | Expenses: reference, date, category (fuel, maintenance, repairs, tyres, tolls, other), vehicle, trip, supplier, amount, method, receipt, recorded-by,… | Partial | Cost entries on incidents/work orders (category, amount, date, description). **No supplier, method, receipt or approval.** |
| FIN-06 | 3 | Driver allowances, trip payments, overtime and payroll export, with configurable rules and approval. | Deferred | Phase 3. |
| FIN-07 | 1C | Finance dashboard whose totals reconcile to transaction records. Margin is shown only when cost and revenue data are sufficient. | Met | `src/tms/financeHome.ts` + `src/screens/FinanceHome.tsx` (Phase 34, D-84): a finance account lands on **Finance**; the period figures are `financialReport` itself, so they cannot disagree with the report and CSV behind them; overdue invoices, unbilled completed hires and payments still to verify are measured **as at today**, not inside the period. **Margin** is shown only under a written sufficiency rule (currency set, an invoice and a cost line in the period, and no hire completed in the period left unbilled) and otherwise names what is missing; it is labelled as not profit, with cash movement beside it. Tests: 15 domain (`financeHome.test.ts`), 5 screen (`FinanceHome.test.tsx`). |
| FIN-08 | 3 | Payment reconciliation records. | Deferred | Phase 3. |
| NTF-01 | 2 | Notification service: in-app channel first, provider interface for others, configurable templates, stored status, retry on failure, duplicate-event… | Deferred | Phase 2. No notification code exists at all. |
| NTF-02 | 2 | SMS adapter through a Ghana-capable provider (candidates: Hubtel, Arkesel, mNotify; verify availability and pricing). SMS is the channel most staff… | Deferred | Phase 2. |
| NTF-03 | 2 | Email adapter. | Deferred | Phase 2. |
| RPT-01 | 1A | Rental reports: enquiries, quotations issued, acceptance rate, confirmed and completed rentals, revenue, outstanding balances, vehicle utilisation,… | Met | `src/tms/rentalReport.ts` + `src/screens/Reports.tsx` (Phase 17). All eight figures are computed from records, with coverage stated, a currency guard and a CSV of the same numbers; 7 domain tests and 3 screen tests. Formulas in `docs/KPIS.md`. |
| RPT-02 | 1C | Staff transport and fleet reports: bookings received/confirmed/completed/cancelled, no-shows, on-time pickup rate, average delay, passengers… | Partial | On-time pickup rate with data coverage (`src/tms/kpis.ts`). Utilisation **definition** agreed in Q-29 and written down in `KPIS.md`; the fleet-wide screen is still to build. **No bookings, no-shows, passengers transported, route utilisation, contract performance, downtime, fuel, mileage.** |
| RPT-03 | 1C | Financial reports: revenue by service and customer, payments received, outstanding invoices, expenses by category, cost per trip, cost per passenger… | Partial | `src/tms/financialReport.ts` + a section on the Reports screen (Phase 28): all six figures computed from records, with the period, coverage, cost-per-trip and cost-per-passenger definitions from Q-29, and a CSV. **Revenue by service has one line** because only vehicle hire is invoiced in this build; contract billing is FIN-02. No profit or margin (costs captured are maintenance only). |
| RPT-04 | 1C | Filters (date range, service, client, customer, route, driver, vehicle, status) and CSV export, always permission-scoped. Every KPI formula is… | Partial | The rental report has a date range, a coverage panel and a CSV of the same figures (Phase 17); other screens have search and status filters. Formulas documented in `docs/KPIS.md`. The **customer statement** (Phase 39, D-90) is the per-customer view: one account for a chosen period, with the balance carried in, the ageing bands and a printable sheet; the **finance home** states the same bands for the whole company (Phase 40, D-91), from one banding function. **The other reports have no date range or CSV, and there is no cross-report filter bar** (service, client, route, driver, vehicle); the statement has no CSV because it is a document, not a data export. |
| RPT-05 | 3 | PDF reports. | Deferred | Phase 3. |
| GPS-01 | 2 | Provider interface; last reported location with timestamp; clear distinction between live, stale and simulated locations; never fabricate… | Deferred | Phase 2, hardware-gated. No provider interface and no "Not configured" label exists, because there is no tracking screen. |

**78 IDs: 20 met, 41 partial, 3 not built, 14 deferred.** Phase 1A: 29 IDs - 9 met, 20 partial, 0 not built.

## Phase 0 - Inspect and plan (approved)

| Item | Status | Notes |
|---|---|---|
| Inspect project | Done | Vite 7 + React 19 + Tailwind 4, single-file static build; no backend, no database, no CI. |
| Verify hosting target | Blocked | Section 3 hosting fields are not in the uploaded material (Q-01). |
| ARCHITECTURE.md | Done | `docs/ARCHITECTURE.md`. |
| ERD.md | Done | `docs/ERD.md`, with Mermaid diagram, constraints and exclusion constraints. |
| PERMISSIONS.md | Done | `docs/PERMISSIONS.md`. |
| STATE_MACHINES.md | Done | Vehicle, rental and trip machines in `docs/STATE_MACHINES.md`. Invoice, contract and incident machines Not Started. |
| KPIS.md | Done | RPT-01 and RPT-03 implemented; utilisation, cost per trip and the cost-category list defined and approved (Q-29, D-78); RPT-02 screen outstanding. |
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
| RPT-02 fleet utilisation, RPT-03 cost per trip | Defined | Q-29 definitions approved (Phase 28, D-78); RPT-03 built, RPT-02 screen outstanding |
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
| Multiple contact accounts per client | Done (verified) | Several accounts per client, one marked primary (Phase 27, D-77). 5 domain and 7 screen tests |
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
| Blocking dispatch on an overdue service | Done in Phase 30 | Policy answered in Q-43; a setting (`blockOnOverdueService`) turns the warning into a block (D-75) |
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
| **Code queued, in this order** | In progress | 1. Q-42 correction entries + `trips:correct` (Phase 24); 2. Q-47 cancel an in-progress run with a reason and optional incident (Phase 25); 3. Q-16 mandatory insurance and roadworthiness before assignment (Phase 26); 4. Q-38 several client contacts (Phase 27); 5. Q-34 work-type list and Q-29 report definitions, with RPT-03 (Phase 28); 6. Q-48 roster-change marker (Phase 29); 7. Q-43 the stricter dispatch switch (Phase 30) |

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

| **Defect found by CI:** one concurrency test asserted a single error code | Fixed | Run `40161502901`: the "no application lock" case expected `23P01` (exclusion constraint) and received `40P01` (deadlock), because which refusal arrives depends on how the two transactions interleave. The test now accepts either and keeps every invariant that matters (one winner, one loser, one reservation, one rental). `40P01` is also mapped to a readable 409 for operators — "someone else was saving the same record… try again" — instead of a 500, with a unit test in `dbErrors.test.ts` |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **350 passed, 14 skipped**, `build`
succeeds.

Next on the queued list: Q-16, insurance and roadworthiness required before a vehicle is assigned.

## Phase 26 - Papers that must be current before a vehicle works (item 3, Q-16)

D-76 answers the half of Q-16 that was still open. A company may say that a document type is not
merely tracked but **required**: while it is missing, or has an expiry date earlier than the day of
the work, the vehicle or driver cannot be assigned. Nothing is required by default, so an existing
install behaves exactly as it did.

| Item | Status | Evidence |
|---|---|---|
| A per-type switch | Done (verified) | `DocumentType.required` (default false), set on the Settings screen under "Before assignment - must be current to assign"; records saved before this phase load as not required |
| The check reads the day of the work, not today | Done (verified) | `requiredDocumentGaps(db, ownerType, ownerId, onDate)` in `src/tms/compliance.ts`. A rental is judged against its `startDate`, a run against its `serviceDate` |
| The newest copy counts | Done (verified) | Where several copies of the same paper exist, the latest expiry is used; the expiry date itself is still a valid day |
| It names the paper, not a code | Done (verified) | One sentence per gap, e.g. `Vehicle GT 500-26 cannot be assigned: its Insurance expired on 2026-08-01. Record the document in Compliance first.` Missing and expired are worded differently |
| Both owners | Done (verified) | Vehicles and drivers; a "both" type is checked against each. A driver's paper never satisfies the vehicle's requirement, or the reverse |
| Where it applies | Done (verified) | Rental assignment (`assign_rental`) against the hire's start date; busing assignment (`assessResources`, used by assign, dispatch and start) against the service date |
| It cannot be worked around after the fact | Done (verified) | `start_rental` and `start_trip` re-check, because a certificate can lapse between assignment and the morning of the hire |
| Dispatch and start say why | Done (verified) | Those two moves have no field to point at, so the message carries the reason instead of a bare "resources are no longer valid" |
| Registration is untouched | Done (verified) | A vehicle can still be registered, imported and maintained while a paper is pending; the block is at assignment (the rule the answer chose) |
| Tests | Done (verified) | 4 domain (`compliance.test.ts` "documents a company has made mandatory"), 4 domain (`service.test.ts` "mandatory documents gate assignment"), 4 domain (`busing.test.ts` "mandatory documents gate a run"), 3 screen (`Settings.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **365 passed, 14 skipped**, `build`
succeeds.

Next on the queued list: Q-38, several contacts per client.

## Phase 27 - Several contacts at one client (item 4, Q-38)

D-77 answers Q-38. Until this phase a client could have exactly one contact account, enforced in
the service layer *and* by a unique index on `app_user.client_id`; the second person was refused,
which pushes a company to share one password and lose the trail of who asked for what. Now a client
may have several contact accounts, each its own login and each confined to that client, with one
marked primary.

| Item | Status | Evidence |
|---|---|---|
| A second contact account is accepted | Done (verified) | `validateUser` no longer refuses a client that already has a contact; migration `005_client_contact_accounts.sql` drops the unique index (driver records keep theirs) |
| Each contact is its own login | Done (verified) | Each account has its own email, password and audit rows; both answer the same client's records through `scopedView` |
| One primary, and only one | Done (verified) | `User.primaryContact`; saving an account as primary takes the mark off whichever account of that client held it, and the audit entry names whose mark moved |
| Primary means a contact account | Done (verified) | A driver or internal account cannot carry the mark - refused with a field error, and choosing another role clears it |
| Reassignments behave | Done (verified) | Moving a primary account to another client carries the mark and leaves the first client with none; promoting a contact to internal staff clears both the link and the mark |
| The office can see who to ring | Done (verified) | Users register gained an "Acts for" column (client or driver, with a "Primary" badge, and a warning when the primary account is inactive); the client register says "2 contact accounts · Yaw Mensah is primary" or "none marked primary" |
| Picking a client is honest | Done (verified) | The link picker lists every client and says how many contact accounts it already has, instead of hiding clients that have one |
| A database that predates this | Done (verified) | Migration 005 drops the index; if an unmigrated database refuses the row, the message says to run `npm run db:migrate` instead of a 500 |
| Tests | Done (verified) | 5 domain (`scope.test.ts` "several contacts per client, one marked primary"), 4 screen (`Users.test.tsx`), 3 screen (`Registers.test.tsx`), 2 integration (`repository.integration.test.ts`) |

| **Defect found by CI:** the new driver-account integration test would not run | Fixed | Run `40163522757`: `could not determine data type of parameter $2`, because the driver's name was interpolated inside a quoted SQL literal (`'Driver ${id}'`), leaving the parameter unused and untyped. The name is now built in JavaScript and passed as a normal parameter; the Q-38 test that this phase is about passed on that run. Run `40163880719` is green in all three jobs |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **377 passed, 16 skipped** (the two new
integration tests are among the skipped ones and run against PostgreSQL in CI), `build` succeeds.

Next on the queued list: Q-34 work-type list with Q-29 report definitions (RPT-03).

## Phase 28 - Work types, cost categories and the financial report (item 5, Q-34 and Q-29 / RPT-03)

Two answers, one phase. Q-34 settles what a work order is for; Q-29 settles what a recorded cost is
for and how the money figures are defined. Without both, "how much did tyres cost" and "cost per
trip" cannot be answered, and the reports had to say "not configured".

| Item | Status | Evidence |
|---|---|---|
| A work order carries a type from a company list | Done (verified) | `settings.workTypes`, seeded with the six the owner approved (Service, Repair, Tyres, Bodywork, Inspection, Other) and editable in Settings. `validateWorkOrder` refuses anything else and names the list; the form is a select, not a text box |
| History is not rewritten | Done (verified) | An order raised while the type was free text keeps its own wording: updating it is allowed, retyping it into a *different* free-text value is not, and the form shows it as "recorded before the list" |
| Costs carry a category from a company list | Done (verified) | `settings.costCategories`, empty by default because nothing is assumed. Blank means "Uncategorised", which the report shows as its own line. Entered in any case, stored under the configured spelling |
| Nothing is blocked silently | Done (verified) | With no work types configured, raising one is refused with "No work types are configured…". With no cost categories, costs are still recordable and counted as uncategorised — the note says so |
| RPT-03: revenue by customer and service | Done (verified) | `financialReport`; invoices issued in the period, voids excluded, a missing customer name kept as its own line. One service line only, because only vehicle hire is invoiced — printed on screen |
| RPT-03: received and outstanding at the period end | Done (verified) | Payments by `paidOn`; outstanding values each unpaid invoice at the period end, so a later payment does not settle it retroactively |
| RPT-03: expenses by category | Done (verified) | Reuses `costReport` lines, so the logistics screen and the report cannot disagree about the same entries |
| RPT-03: cost per trip and cost per passenger | Done (verified) | Q-29 definitions: recorded expenses ÷ completed scheduled runs; recorded expenses ÷ riders boarded on them. Null, not zero, when the denominator is missing |
| No profit and no margin | Done (verified) | Deliberate: only maintenance and incident costs are captured. The screen says what is missing rather than printing a flattering number |
| CSV | Done (verified) | "Download financial CSV" writes the same figures, with the revenue and expense tables in full |
| Tests | Done (verified) | 9 domain (`financialReport.test.ts`), 4 domain (`logistics.test.ts` "configured work types and cost categories"), 2 screen (`Reports.test.tsx`), 2 screen (`Settings.test.tsx`), plus the work-order select assertion in `Logistics.test.tsx` |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **394 passed, 16 skipped**, `build`
succeeds.

Next on the queued list: Q-48, the in-app roster-change marker.

## Phase 29 - Telling the driver the roster changed (item 6, Q-48 / D-79)

The office can change a roster at any moment; the driver only found out at the stop. There is no
notification channel, so the answer lives where the driver already is: on the run he is recording.

| Item | Status | Evidence |
|---|---|---|
| The run carries a roster-change marker | Done (verified) | `RosterChange` and `Trip.rosterChanges` (`src/tms/types.ts`); append-only, each entry with its own id, `at`, `by` and `summary`. Older stored trips load with an empty list |
| A marker is written when a running roster changes | Done (verified) | `markRosterChange` in `src/tms/busing.ts`, called from `create_passenger` and `update_passenger`; covers a rider added, removed, moved between routes, moved between stops, and a corrected name |
| Only runs under way are marked | Done (verified) | `markRosterChange` marks trips on that route whose status is `in_progress` and does nothing otherwise; tests "marks nothing on a run that has not started" and "keeps the marker after the run is finished" |
| A cross-route move warns both drivers | Done (verified) | The move leaves one marker on each route's running trip (test "leaves a marker on each route when a rider moves between routes") |
| The driver sees it before recording a stop | Done (verified) | Banner and change log at the top of `TripStopForm`; the form is rendered by both `StaffBusing` and `DriverPortal`, so both see the same markers |
| Operations can see the run was affected | Done (verified) | "roster changed Nx" beside the correction count on the staff run card; "Roster changed while you were running" in the driver's run list |
| No personal data in the marker | Done (verified) | `rosterChangeEntry` writes only the rider's name and the stop name — never the phone number or employee reference. The audit summary counts markers without repeating names |
| Nothing is pushed | Done (verified) | No SMS, email or alert code exists; `OPEN_QUESTIONS.md` Q-48 records that replacing this with a provider is the undo |
| Tests | Done (verified) | 5 domain (`busing.test.ts` "the driver is marked when the roster changes mid-run"), 3 screen (`TripStopForm.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **402 passed, 16 skipped**, `build`
succeeds.

Next on the queued list: Q-43, the stricter dispatch switch (safety blocks, overdue routine service
warns).

## Phase 30 - Safety blocks, an overdue service warns (item 7, Q-43 / D-75)

The last of the queued answers. Readiness already reported an overdue service, and dispatch already
ignored it — the decision was written down in D-75 but never built.

| Item | Status | Evidence |
|---|---|---|
| The decision is a setting, off by default | Done (verified) | `MaintenanceSettings.blockOnOverdueService`, validated in `validateSettings` (only a stored `true` counts, so an older backup cannot start blocking), edited in Settings under Service schedules |
| Safety still blocks, and is not a setting | Done (verified) | A breakdown, accident or safety concern puts the vehicle out of service; `assessResources` and `assign_rental` refuse anything not Available. The switch is never consulted on that path |
| A warned vehicle still goes out, and is named | Done (verified) | `overdueServiceFor` (`src/tms/maintenance.ts`) writes one sentence: the vehicle, how far past which interval, and the last service date. Assignment, dispatch and start append it to their message (`busing.test.ts` "still lets the run go out while the strict rule is off"); a hire does the same (`service.test.ts` "treats an overdue routine service as a warning…") |
| The dispatcher sees it before choosing | Done (verified) | Both assignment forms mark the vehicle "service overdue" in the list (jsdom test "says so in the vehicle list and in the message after dispatch") |
| Turned on, it refuses the work | Done (verified) | Field error naming the vehicle at assignment, dispatch, start and hire assignment; "refuses assignment and dispatch once the strict rule is on" and the hire test's blocked case |
| Re-checked on the day | Done (verified) | Dispatch and start re-run the same check, and a hire is re-checked when it starts, exactly like a lapsed certificate (hire test, "re-checked on the day") |
| A vehicle that is merely due soon is left alone | Done (verified) | Only `overdue` is spoken about; "says nothing, and blocks nothing, for a vehicle that is merely due soon" |
| No schedule is not an overdue service | Done (verified) | `overdueServiceFor` returns nothing when the category has no interval, so an unconfigured company is never blocked by a guess |
| Tests | Done (verified) | 3 domain (`maintenance.test.ts`), 3 domain (`busing.test.ts`), 1 domain (`service.test.ts`), 1 screen (`Settings.test.tsx`), 1 jsdom (`Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **411 passed, 16 skipped**, `build`
succeeds.

That closes the seven queued items from the recommended answers. What is left in the register is what
needs the owner or a provider: the live-database repeat of the trial, bookings and contracts, SMS and
GPS (no channel, no hardware), and VAT/GRA e-VAT (no rates supplied).

## Phase 31 - Importing a roster, the last import the brief asks for (EMP-02, D-81)

The office could import vehicles, drivers and clients, but every employee was typed by hand, one
route and one pickup stop at a time. This closes that gap with the machinery that already exists,
rather than with a second importer.

| Item | Status | Evidence |
|---|---|---|
| A roster file is imported from the Passengers tab | Done (verified) | **Import CSV** beside **Add passenger** (`StaffBusing.tsx`); the same `ImportPanel` the registers use, with `kind="passengers"` (jsdom test "offers the roster template and checks the file before saving anything") |
| Client, route and stop are matched by name | Done (verified) | `rowCommand` in `src/tms/import.ts`; case-insensitive, the route also by its reference. Tests "creates the roster, resolving the client, route and stop by name" |
| An unknown name is a row error that lists what exists | Done (verified) | "names the clients that do exist when a row misspells one", "refuses a stop that is not on the route, listing the stops in order" |
| A route needs a pickup stop; no route is allowed | Done (verified) | "requires a pickup stop once a route is named, rather than guessing one", "accepts a rider with no route, because a roster is often typed before the runs exist" |
| Duplicates by employee reference are rejected | Done (verified) | Written through `create_passenger`, so the existing rule applies: "rejects a repeated employee reference, exactly as a typed row would" |
| A likely duplicate person is flagged, not refused | Done (verified) | `likelyDuplicate` marks the row **Check** and names both references; the row still imports ("flags a likely duplicate person without refusing the row") |
| Row-level preview, no silent discards, one audit entry per record | Done (verified) | Shared `previewImport`/`executeImport`; `passengers:create` and `import:passengers` entries |
| Permission is checked before a file is even parsed | Done (verified) | "refuses a role that could not add a rider by hand" (finance) |
| Template documented | Done (verified) | `docs/SETUP_AND_DEPLOYMENT.md` §8 now carries the passengers template, the name-matching rule and the duplicate-person flag |
| Tests | Done (verified) | 8 domain (`import.test.ts` "importing a staff roster"), 1 jsdom (`Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **420 passed, 16 skipped**, `build`
succeeds.

## Phase 32 - A run outside the schedule (DSP-03, D-82)

The register's last self-contained dispatch gap: a trip existed only if a route generated one, so a
bus that would not start at 05:30 left a cancelled run and nowhere to put the replacement, and a
one-off movement had no day to live on.

| Item | Status | Evidence |
|---|---|---|
| A run can be created for a date the schedule does not cover | Done (verified) | `create_adhoc_trip` (`src/tms/busing.ts`); a Saturday on a Monday–Friday route is accepted while generation refuses it ("creates a run on a day the route does not operate") |
| The reason is part of the record | Done (verified) | `Trip.originReason`; empty reason refused; the reason is in the run sheet, the audit entry `trips:adhoc` and the success message |
| A replacement can stand beside the cancelled scheduled run | Done (verified) | Migration `006_adhoc_trips.sql`: the unique index on `(route_id, service_date)` became partial (`where origin = 'schedule'`), plus `Trip.origin` and a check constraint. Test "lets a replacement run exist beside the scheduled one that was cancelled" |
| Generation is still one per route per day | Done (verified) | The partial index, and `generate_trips` now ignores an ad hoc run when deciding what already exists ("does not stop the normal schedule being generated for the same day") |
| No second ad hoc run for the same route and date | Done (verified) | "refuses a second ad hoc run for the same route and date", naming the existing reference |
| The same dispatch checks apply | Done (verified) | Vehicle category, seats, papers, licence, overlaps, rental clashes via `assessResources`; "checks the vehicle and driver the same way assignment would" |
| Only from today, and not far ahead | Done (verified) | A past date is refused with "recorded as it happened, not invented"; the 62-day generation window is reused |
| Dispatch work, not planning work | Done (verified) | `trips:dispatch`; finance and drivers refused ("is dispatch work, so a driver and finance cannot create one") |
| Old backups load as scheduled runs | Done (verified) | Legacy default in the loader; "loads an older trip as a scheduled run, and keeps an ad hoc run's reason" |
| From the dispatch screen | Done (verified) | **Add an ad hoc run** on the Trips tab opens a panel (route, date, reason, optional vehicle and driver); the run sheet marks it "ad hoc" with the reason (jsdom tests "creates a run for a day the route does not operate…", "refuses a run with no reason…") |
| Tests | Done (verified) | 8 domain (`busing.test.ts` "a run outside the schedule"), 2 jsdom (`Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **430 passed, 16 skipped**, `build`
succeeds.

## Phase 33 - Seat-level bookings (BKG-01..06, D-83)

The last self-contained busing gap in the brief. Until now the only way onto a bus was a roster row,
so a visitor had to be added to a route and stayed there after the visit ended. A booking names one
rider's seat on one run, and counts against the same seats as the roster.

| Item | Status | Evidence |
|---|---|---|
| A booking is a record of its own, with a continuous reference | Done (verified) | `Booking` in `src/tms/types.ts`, `booking` reference series (BK-0001…), migration `007_bookings.sql`; "books a named seat for a visitor, with its own reference and a first history entry" |
| One named rider on one named run, for a visitor rather than a second roster | Done (verified) | `create_booking` (`src/tms/bookings.ts`); a rider already on the route's roster is refused, so the seat is never counted twice |
| Capacity counts roster + live bookings | Done (verified) | `capacityOf` (`seats − roster − confirmed/offered`); the Bookings tab states "3 of 14 seats held · 2 on the roster · 9 free" (jsdom "shows the seats held against the vehicle…") |
| No vehicle means no promise | Done (verified) | `seatErrors` refuses with "No vehicle is assigned… so its seats cannot be counted"; "refuses to promise a seat on a run with no vehicle…" |
| Status workflow with a reason for every refusal | Done (verified) | `requested → confirmed \| rejected \| waitlisted` and `waitlisted → offered → confirmed \| cancelled`; reasons required; audit actions `bookings:create\|confirm\|waitlist\|reject\|cancel` |
| A full run waitlists instead of failing | Done (verified) | "puts a request on the waiting list when the run is full, and confirms nobody" |
| A freed seat is offered, never auto-confirmed | Done (verified) | `cancel_booking` offers to the oldest waiter and says "nobody is confirmed yet"; "offers the freed seat to the oldest waiter and confirms nobody" |
| Cut-offs are settings, blank by default | Done (verified) | `settings.booking` in the Settings screen; `update_settings` validates whole minutes 0…10080; "applies a booking cut-off to a request inside it, while leaving later dates alone" |
| A recurring request books every operating day and reports what it could not take | Done (verified) | One booking per run, ≤62 days, `skipped` dates named in the message; "books one seat per run for a recurring request and names the dates it could not take" |
| History of every change | Done (verified) | `Booking.history` + audit entries; shown as **Last change** on the Bookings tab |
| Client contacts are confined to their own company | Done (verified) | `bookings:read\|create` for `client_contact`, own client only, may cancel its own bookings, may not confirm; "lets a client's own contact book and cancel its own staff, and nothing else" |
| From the dispatch screen | Done (verified) | **Bookings** tab in `StaffBusing.tsx`: runs for a date with their seat line, the bookings on each run and the next action; **Request a seat** panel; refuse and cancel panels that require a reason (4 jsdom tests) |
| Boarding a booked rider | Done (verified) | Phase 35, D-85: the run's manifest is the roster **plus** the seats that still hold one, so a booked visitor is expected at their stop, has to be given an outcome before the run can be completed, appears on the driver's stop form with their booking reference, and shows in the completion. Tests: 7 domain (`bookings.test.ts` "a booked seat is on the run's list of people"), 3 screen (`Bookings.test.tsx`) |
| Tests | Done (verified) | 16 domain (`bookings.test.ts`), 4 jsdom (`Bookings.test.tsx`), 1 settings (`Settings.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **451 passed, 16 skipped**, `build`
succeeds.

## Phase 34 - A money home for finance (FIN-07, D-84)

Finance signed in and landed on the operations board: today's runs and the fleet, with the money two
clicks away inside Reports. This gives the money side its own screen, built entirely out of the
figures that already exist.

| Item | Status | Evidence |
|---|---|---|
| Finance lands on a money home, not the operations board | Done (verified) | `finance` route in `src/routes.ts`; `homeRoute` in `src/App.tsx` sends a finance account there; the nav entry is gated on `invoices:read`, so operations (which may read no invoices) does not see it |
| The totals reconcile to the transaction records | Done (verified) | Every period figure is `financialReport(db, from, to)` — the same function behind the Reports screen and its CSV; the screen test asserts the two agree field by field |
| Margin only when cost and revenue data are sufficient | Done (verified) | `margin` in `src/tms/financeHome.ts` with a written rule: currency set, ≥1 invoice issued, ≥1 cost line recorded, and **no hire completed in the period left unbilled**; otherwise the reason is shown. Five domain tests, one screen test |
| What is late, what is unbilled, what still needs checking | Done (verified) | Overdue invoices (valued at what is still owed, longest overdue first), completed hires with no invoice, and payments recorded but not verified or reconciled, each measured **as at today** and saying so |
| Money is withheld when there is no currency | Done (verified) | `status: "currency_not_set"`; the screen prints "Not configured" per cell and says why in the notice |
| Coverage stated, nothing invented | Done (verified) | Invoice, customer-name, cost-category and completed-run coverage printed under the tables; "not profit" said in words beside margin and cash movement |
| Tests | Done (verified) | 15 domain (`financeHome.test.ts`), 5 screen (`FinanceHome.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **471 passed, 16 skipped**, `build`
succeeds.

## Phase 35 - A booked seat is a person on the run (D-85)

Phase 33 sold seats; this makes the rest of the system know who is sitting in them. Until now a
booked visitor held a seat the office had promised, and appeared on no manifest: not on the list the
dispatcher records boardings against, not on the driver's screen, and not in the completion. A run
could leave without them and still be reported complete.

| Item | Status | Evidence |
|---|---|---|
| The run's list of people is the roster plus every seat that still holds one | Done (verified) | `manifestFor` / `manifestAtStop` (`src/tms/bookings.ts`); a requested or waitlisted seat is not expected aboard, a cancelled one is gone; a rider who is on both lists is counted once, as a roster rider |
| A booked rider with no stop of their own gets on at the first stop | Done (verified) | `pickupStopId` falls back to the first stop of the route when the booking names none, or names one that is not on this route |
| A stop cannot be recorded with the booked visitor unaccounted for | Done (verified) | `record_trip_stop` expects an outcome for everyone due at that stop; "every rider expected at Estate gate (3)" |
| A run cannot be completed with a booked rider unaccounted for | Done (verified) | `complete_trip`; "1 still to record". A record made earlier still counts, so a later cancellation cannot block a completion |
| Capacity at assign, dispatch and start counts sold seats | Done (verified) | `assessResources` uses roster + `seatsHeld`; a smaller bus is refused with "… and 1 booked seat(s)"; a roster addition during a run is measured the same way |
| No new seat once the run is under way | Done (verified) | `seatErrors` refuses with "already under way; its list of riders is fixed" |
| The office records it without leaving the screen | Done (verified) | `TripStopForm` and `CompleteForm` take the manifest; a booked rider is labelled "Booked seat BK-0001 — not on the regular roster" (3 jsdom tests in `Bookings.test.tsx`) |
| The driver sees who is travelling | Done (verified) | Driver holds `bookings:read` (own runs); the driver portal's stop form is built from the manifest |
| A bound account's snapshot carries only its own seats | Done (verified) | **Leak fixed:** the narrowed snapshot omitted `bookings`, so the whole table was being sent to a client contact or driver. `src/server/visibility.ts` now narrows it; 4 tests |
| Tests | Done (verified) | 7 domain (`bookings.test.ts`), 3 screen (`Bookings.test.tsx`), 4 snapshot (`visibility.test.ts`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **485 passed, 16 skipped**, `build`
succeeds.

## Phase 36 - Taking money off an invoice that has already gone out (FIN-02, D-86)

An issued invoice could not be edited, and could not be voided once a payment stood against it. That
left the office with no way to correct the ordinary case — a hire partly not delivered, an
overcharge, a discount agreed after the document went out — and the only honest advice the system
could give was "do nothing". A credit note is that correction: its own numbered document, taking
money off one invoice, leaving the payments exactly where they are.

| Item | Status | Evidence |
|---|---|---|
| A credit note is its own numbered document against one invoice | Done (verified) | `CN-2026-0001` from the `creditNote` series (`src/tms/references.ts`); migration `008_credit_notes.sql`; `CreditNote` in `src/tms/types.ts` (schema 15); "issues a numbered credit note with the invoice's own tax, and reduces what is owed" |
| Tax comes from the invoice it corrects, not from today's settings | Done (verified) | `creditTaxLinesFor` in `src/tms/finance.ts`; the credit of 1,000 on a 4,000 / 15% + 2.5% invoice carries VAT 150 and NHIL 25 and totals 1,175 |
| The amount is stated before tax, and the tax is never typed by hand | Done (verified) | `CreditNoteInput.amount` is pre-tax; the form previews the total with the same arithmetic the service uses ("Credit note total: GHS 115.00" in the jsdom test) |
| Immutable once issued, voidable with a reason, never deleted | Done (verified) | Triggers `credit_note_frozen`, `credit_note_no_delete` (and the ceiling trigger); `void_credit_note` restores the bill and never reuses the number; an integration test asserts the database refuses a delete and an edit |
| One balance rule, in one place | Done (verified) | `invoiceBalance` in `src/tms/creditNotes.ts`: `outstanding = total − paid − credited`, floored at zero, in whole pesewas. `outstanding()` (finance), `financialReport`, `rentalReport` and the Invoices screen all read it; `creditNotes.test.ts` asserts the four agree on the same invoice |
| A credit cannot exceed the invoice, and two simultaneous credits cannot overshoot it | Done (verified) | `issue_credit_note` refuses with the room left, including tax; the database holds the same rule in trigger `credit_note_within_invoice`, under a row lock on the invoice |
| A refund is stated, never netted away | Done (verified) | `paid + credited > total` produces `refundDue`; the invoice notice says "A refund is due", the list row says "GHS x back", and a tile totals refunds. Nothing is silently turned into a zero balance |
| A fully credited invoice is closed without pretending it was paid | Done (verified) | The invoice status keeps describing cash received; the balance says `settled`, and the list adds a **Settled by credit** badge |
| Every money total accounts for credits | Done (verified) | "Credited" tile and column, `creditedTotal` / `creditNoteCount` in both reports and their CSV, credited column per customer, and the finance home's margin measured on revenue after credits — withheld entirely when everything billed was credited back |
| A credited invoice can no longer be voided, in the service and in the database | Done (verified) | `void_invoice` refuses with "credit note CN-2026-0001 against it"; trigger `invoice_frozen` replaced in migration 008 to hold the same rule for a restore or a hand-written row; "refuses to void an invoice while a credit note stands…" |
| The office does it from the invoice | Done (verified) | **Credit the invoice** action, the crediting panel, a credit-note table showing what each note is for *and* why it was given, void with a reason: 5 jsdom tests in `Invoices.test.tsx` |
| Who may do it | Done (verified) | `credits:issue` / `credits:void` for finance and administrator; operations is refused, as with every other money command |
| Tests | Done (verified) | 9 domain (`finance.test.ts` "FIN-02 credit notes"), 8 arithmetic and report-agreement (`creditNotes.test.ts`), 2 finance home, 5 screen (`Invoices.test.tsx`), 3 snapshot (`visibility.test.ts`), 1 integration against PostgreSQL |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **512 passed, 17 skipped**, `build`
succeeds.

## Phase 37 - The document a customer keeps (FIN-02, D-87)

The invoice existed only on screen. That is fine for the office and useless for the customer, who needs
a copy for their own records — and "take a screenshot" is not a document. This turns the two money
records into sheets that print properly, using the browser's own print engine rather than adding a PDF
service, so there is nothing new to install on the office machine.

| Item | Status | Evidence |
|---|---|---|
| The invoice prints as a document, not a screenshot of the app | Done (verified) | `InvoiceSheet` in `src/screens/Documents.tsx`; the preview is portalled to `document.body` and `@media print` removes every other child of the body, so no navigation, no buttons and no trailing blank pages; "opens as a dialog over the page, with the sheet attached to the document body" |
| The sheet carries what a customer checks | Done (verified) | Supplier name, document type, reference, status in words, customer, issue and due dates, the hire reference, every line with quantity and unit price, subtotal, each tax line at its own rate, total, received, credited, amount due, invoice note, and a footer with the reference and the print date |
| The amount due is the figure the screen states | Done (verified) | `invoiceBalance` (D-86) is called by the sheet itself; "carries the supplier, the customer, the lines and the amount still owed" and "shows what was credited as well as what was paid" |
| A refund is asked for on the paper, and a void document asks for nothing | Done (verified) | "Refund due to the customer" replaces "Amount due"; a void invoice prints "This invoice is void and does not stand" with the recorded reason, and no amount due |
| A credit note prints as its own document against the invoice | Done (verified) | `CreditNoteSheet`: number, "Against invoice INV-2026-0001", the credited line, tax at the invoice's rates, total credited, the reason, and a sentence saying it is not a payment; a void note says the money is back on the bill |
| Nothing is invented on paper | Done (verified) | An unset company name prints as "Company name not set in Settings"; the preview — which is not printed — says where to set it. Two tests pin both halves |
| Print or save as PDF, from the screen the office already has | Done (verified) | **Print invoice** on the invoice page, **Print** on each credit note row; the preview's button calls the browser's print dialog, whose own "Save as PDF" names the file after the document because the page title is set while it is open |
| Keyboard and screen-reader behaviour matches every other overlay | Done (verified) | `useDialogFocus` extracted from `Panel` and shared: focus moves in, Tab stays in, Escape closes, focus returns to the trigger; the preview is `role="dialog" aria-modal="true"`; "prints what is on screen, and closes with its button or Escape" |
| Tests | Done (verified) | 10 component (`Documents.test.tsx`), 2 screen (`Invoices.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **524 passed, 17 skipped**, `build`
succeeds.

## Phase 38 - A payment recorded by mistake can be taken back (FIN-03, D-88, D-89)

The money story could record a payment and could not undo one. A figure keyed against the wrong invoice
stayed on that invoice for good, was counted as income by both money reports, and could only be removed
by editing the database by hand. This phase adds the cancellation — one-way, with a reason, leaving the
record and its number in place — and, on the way, closes two gaps that had been hiding behind the tests:
three commands the server refused to accept at all, and a backup-version list that would have refused
the application's own backup after the schema bump.

| Item | Status | Evidence |
|---|---|---|
| A payment recorded in error can be cancelled, with a reason | Done (verified) | `void_payment` in `src/tms/finance.ts` behind `payments:void`; blank reason refused with a message on the field, 300-character limit; "puts the invoice back to what it actually owed and keeps the record", "requires a reason, and refuses an unknown payment" |
| The invoice goes back to what it actually owed | Done (verified) | `withPaymentsToDate` recomputes `amountPaid` and the status from the payments that still count — the same helper the record path uses; "recomputes the invoice from the payments that still count, not from the cancelled one" (1,000 + 1,500 recorded, 1,000 cancelled → 1,500 received, 3,200 outstanding) |
| Cancelling is a one-way door, and the database says so | Done (verified) | Migration `009_payment_cancellations.sql`: `void_reason`/`voided_at` as a pair (check constraint), `payment_frozen()` refuses un-cancelling and any edit to the financial fields; "is a one-way door: a cancelled payment cannot be cancelled twice"; integration test asserts `update payment set voided_at = null` is refused by PostgreSQL itself, and that a cancellation with no reason cannot be inserted |
| Nothing else in the system counts a cancelled payment as money | Done (verified) | `isLivePayment`/`livePayments` in `src/tms/creditNotes.ts`; used by the invoice balance, the printed sheet, `financialReport`, `rentalReport` and the finance home; "leaves a cancelled payment out of what was received", "does not report a cancelled payment as money received", "does not ask anybody to verify a payment that was cancelled" |
| The screen says what happened, in words | Done (verified) | **Cancel** beside each live payment, a "Cancelled" badge, the amount struck through, the reason listed under the table, and a caption reading "1 payment counting of 2 recorded · 1 cancelled"; a cancelled payment offers no further action |
| A reconciled payment can still be corrected, and is warned about | Done (verified) | The panel says the bank statement is short by the amount before the operator agrees; "cancels a reconciled payment, and says what that does to the reconciliation"; the verification status is left as it was |
| A wrongly paid invoice can be voided once its payment is cancelled | Done (verified) | `void_invoice` counts only live payments; "lets a wrongly paid invoice be voided once its only payment is cancelled" |
| Credit notes and cancellations stay independent | Done (verified) | "leaves a credit note and a cancellation independent of one another": 4,700 − 2,000 − 1,175 leaves 1,525, and after cancelling the payment 4,700 − 1,175 leaves 3,525, with no refund invented |
| Every command the screens offer is a command the server accepts | Done (verified) | `src/tms/commandTypes.ts` + `commandTypes.test.ts` (10 tests); the compiler checks the core union, the test checks each module's list. Fixes `issue_credit_note`, `void_credit_note` and `create_adhoc_trip`, which the route had been refusing with "Unknown command" |
| A backup this build writes is a backup it can read | Done (verified) | `READABLE_SCHEMA_VERSIONS` (1–16), the rejection message generated from it, and a test pinning it to `SCHEMA_VERSION`; the failure was found by the existing round-trip test when the schema moved to 16 |
| Tests | Done (verified) | 26 new unit and UI tests plus 1 database integration test (541 → 568): 10 domain (`finance.test.ts`), 4 screen (`Invoices.test.tsx`), 10 command-list (`commandTypes.test.ts`), 1 backup guard (`hardening.test.ts`), 1 each in the two money reports and the finance home |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **550 passed, 18 skipped**, `build`
succeeds.

## Phase 39 - What one customer owes, and how old it is (FIN-02, RPT-04, D-90)

The money screens each answered "what is this document?". Nothing answered the question the office asks
every time it chases a debt — what does this customer owe, what has moved on their account, and since
when — so statements were being written out by hand from the invoice screen. This phase adds the
statement of account: one customer, one period, the balance carried in and out, the debt aged in bands,
and the sheet to send.

| Item | Status | Evidence |
|---|---|---|
| One customer's whole account, for a period the operator chooses | Done (verified) | `src/tms/customerStatement.ts`; the **Statements** destination (gated by `invoices:read`), a customer list ordered by what is owed, and a search box |
| The opening balance is real, and the period is bounded on both ends | Done (verified) | Opening is the account as at the day before the period; payments and credit notes are filed by their own dates. "carries arrears in and out of a month that contains none of the activity" (2,450 in and out), "dates a credit note by its own date, not by the invoice it corrects" |
| The arithmetic is the one balance rule, checked a second way | Done (verified) | `customerStatement()` calls `invoiceBalance` (D-86) and `livePayments` (D-88); the screen and the sheet only format. "agrees with the invoices one by one, which is the check that catches a misfiled row" computes the closing balance a second route and requires equality |
| The debt is aged, in days and in named bands | Done (verified) | Bands: not yet due, 1–30, 31–60, over 60, each with a sentence ("worth a reminder", "worth a call"). "puts each open invoice in the bucket its due date earns" (1,000 / 2,000 / 3,000 / 4,000 across the four bands as at 30 June); printed on the sheet as its own table |
| A partly paid invoice is aged at what is left | Done (verified) | "counts a partly paid invoice at what is left, not at its total" (1,000 invoice, 250 paid, aged at 750) |
| Nothing retracted is stated | Done (verified) | Void invoices and void credit notes are absent; a **cancelled payment** is absent and moves no balance (D-88): "leaves a cancelled payment off, because that money never arrived", and the screen test of the same name |
| An account in credit says so, in words | Done (verified) | "says a customer is in credit rather than netting the difference to zero" (−400); the sheet prints **In credit — owed to the customer** and never "Balance due" |
| It refuses to state what cannot be stated | Done (verified) | Mixed currencies are not added ("GHS, USD"); a customer with no invoice on or before the date is told in a sentence; a period that runs backwards is refused; an impossible date such as 2026-02-30 is refused |
| The statement prints as a document | Done (verified) | `StatementSheet` uses the same preview, portal, print stylesheet and page title as the invoice (D-87); 3 sheet tests, including that the opening balance is stated **once** rather than twice in two different blocks |
| Tests | Done (verified) | 12 domain (`customerStatement.test.ts`), 9 screen (`Statements.test.tsx`), 3 sheet (`Documents.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **574 passed, 18 skipped**, `build`
succeeds.

## Phase 40 - How bad the debt is, in one place (RPT-04, FIN-07, D-91)

The finance home could list every late invoice, which answers "what do I chase today?". It could not
answer "how bad is the debt overall?" without somebody adding a column up by hand — and the bands that
would answer it already existed for a single customer's statement. This phase totals them across the
company, from the same function, so a customer's statement and the finance home cannot disagree about
how late the same invoice is.

| Item | Status | Evidence |
|---|---|---|
| The debt is stated in the four bands, across all customers | Done (verified) | *Debt by age* card on the finance home: not yet due, 1–30, 31–60, over 60, each with the sentence saying what it is worth doing, then a total with the count of open invoices and customers; `debtAgeing()` in `src/tms/customerStatement.ts` |
| One banding function, so the statement and the finance home agree | Done (verified) | `ageBucketFor` exported and used by both; "uses one definition of a band, so a statement and the company total agree" checks the boundaries (0, 1, 30, 31, 60, 61) and then compares the two totals on the same invoices |
| A part-paid invoice is aged at what is left; retracted money counts for nothing | Done (verified) | `invoiceBalance` per invoice as at the date; "counts a part-paid invoice at what is left, and leaves void and cancelled money out" (650 of a 1,000 invoice after a 250 payment and a 100 credit) |
| The customers behind the debt are named, largest first | Done (verified) | The per-customer band table with each customer's oldest debt in days: "2 customers owe GHS 3500.00 … GHS 2000.00 is over 60 days old" |
| No total across two currencies | Done (verified) | "withholds the total when the invoices are in two currencies" — the figure is zero and the message names GHS and USD |
| Nothing owed is said in words, not four zero rows | Done (verified) | "Nothing is owed as at 2026-06-30.", asserted exactly |
| The card leads to the per-customer document | Done (verified) | **Open statements** on the card; "takes the officer from the debt straight to the statements" |
| The finance home's own stale note is fixed | Done (verified) | The coverage line no longer says "PDF statements are not built yet"; it says where statements print |
| Tests | Done (verified) | 5 domain (`customerStatement.test.ts`), 1 finance-home domain (`financeHome.test.ts`), 2 screen (`FinanceHome.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **582 passed, 18 skipped**, `build`
succeeds.

## Phase 41 - Money paid back (FIN-03, D-92)

A credit note stated that money was owed back and nothing recorded the day it was paid. The workaround
was to book the refund as a recorded cost, which lost the customer and the reason, and made the month
look as though it cost more to run than it did. This phase gives money going out its own numbered
record, with the ceiling enforced by the shared balance rule and by the database.

| Item | Status | Evidence |
|---|---|---|
| A refund is a numbered document of its own | Done (verified) | `REF-2026-0001` series: "numbers the refund, settles what was owed back, and leaves what the customer paid alone"; reference-series test pins the shape; migration `010_refunds.sql` checks `^REF-[0-9]{4}-[0-9]{4,}$` |
| The ceiling is what is still owed back | Done (verified) | "refuses more than is owed back, in the amount that is actually left" — 400 then 800 refused ("GHS 750.00 left to refund"), 750 accepted, a further 1 refused; `refund_within_due()` locks the invoice and sums live payments, live credits and live refunds |
| A refund never rewrites what the customer paid | Done (verified) | `invoiceBalance` gained `refunded`; `paid`, `outstanding` and the invoice's `amountPaid` are unchanged after a refund ("…leaves what the customer paid alone", and on screen "GHS 3450.00 received") |
| Cancelling is a one-way door, with a reason | Done (verified) | "cancels a refund once, with a reason, and makes the money owed back again"; `refund_frozen()` / `refund_no_delete()` in migration 010; integration-style assertions live in the command test |
| It appears on the customer's statement | Done (verified) | A refund is a **debit** row (the balance is what the customer holds with the office), and the opening balance of a later month is no longer in credit by money already given back: 3 statement tests and 1 printed-sheet test |
| It appears in the money report, apart from costs | Done (verified) | `Refunded` figure and CSV line; "states refunds separately from costs, and files them by the day they were paid" |
| It comes off cash movement on the finance home | Done (verified) | `movement = { received, expenses, refunds, difference }`; "comes off cash movement but not off the costs of the work" (500 in, 200 back, difference 300) |
| Only finance can record or cancel one | Done (verified) | `refunds:record` / `refunds:void`; "is a finance job: operations may not pay money back or cancel a refund" |
| A driver or client contact never receives the collection | Done (verified) | `visibility.ts` sends `refunds` with `invoices:read` and empties it for bound roles; 2 snapshot tests |
| Tests | Done (verified) | 7 command/balance (`refunds.test.ts`), 3 statement, 1 statement sheet, 3 report, 3 finance home, 3 visibility, 3 invoice screen, 2 finance home screen |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **606 passed, 18 skipped**, `build`
succeeds.
