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
| CUS-01 | 1A | Customer register (individual or organisation): reference, contact person, telephone, email, billing details, type, status, notes, history. Staff can… | Met | `src/screens/Registers.tsx` + `validateClient` (Phase 52, D-101): a customer now carries **the code the office already uses for them** (optional, unique when given, compared ignoring case and spacing), **organisation or individual** (nullable, and a blank is shown as "type not recorded" rather than guessed), **billing address** and **tax identification number**, and free-text notes, beside the contact person, phone, email, status and the linked contact accounts (Q-38, D-77). A **History** panel on the row lists every recorded change from the audit log with its person and time. The billing details are **copied onto each invoice when it is issued**, so a customer who moves does not rewrite a document already sent; the printed sheet carries the address and TIN under "Billed to". Tests: 9 domain (`clientDetails.test.ts`), 5 screen (`Registers.test.tsx`, `Documents.test.tsx`). **Nothing invented:** an older record with no code, type or billing details reads as unrecorded and keeps working. |

| RNT-01 | 1A | Rental request: customer, service date, departure time, return time or duration, pickup, destination, intermediate stops, passenger count, luggage or… | Met | Since Phase 69 (D-119) the request carries **everything the desk is told**: departure and return clock times (stored 24-hour, typed either way), the intermediate stops in the order the vehicle calls, luggage, special needs, who to ring on the day, and **how the request arrived** (phone, walk-in, email, WhatsApp, website form, client portal, referral, other). The duration is worked out from the two times and printed, never stored as a second figure that could disagree. A one-day hire that comes back before it leaves is refused with the reason. A request written before these fields has `plan: null` and the screen says its times and stops are unknown rather than showing blanks. The stop list does not price anything: a stop that costs money is a quotation decision. |
| RNT-02 | 1A | Rental status workflow: Draft, Submitted, Under Review, Awaiting Quotation, Quotation Sent, Awaiting Customer Confirmation, Confirmed, Dispatched, In… | Met | Since Phase 70 (D-120) the pipeline is **eleven stages**: draft → submitted → under review → awaiting quotation → quotation sent → accepted, deposit due → confirmed → dispatched → completed, with declined and cancelled as endings. `advance_rental` moves a request one triage step at a time and refuses a skip or a step back; a quotation can still be issued from any pre-quote stage, so a small request is never held up. **"Quotation sent" and "awaiting the customer's confirmation" are one state here** — with no mail channel there is no second moment to mark, and the card shows whether the customer has answered (D-116). "In progress" became **dispatched**, the word the trip board already uses and the instant the run records as departure (D-118), rewritten in stored data by migration 022. Corrections are allowed until a price exists; a renewed price returns an agreed hire to `quoted`. **Still missing: a notification to the customer at any stage** — there is no channel to send one on, and nothing claims otherwise. |
| RNT-03 | 1A | Availability check by vehicle category, capacity, operating status and time range; driver availability when a driver is required. | Met | Live: wrong-category vehicle refused; overlapping assignment refused; driver licence expiry checked; a required document that is missing or lapsed on the hire date refuses the vehicle or the driver (Phase 26, D-76). Capacity checked at assignment against `passengers` (see D-01 for the mid-run gap). |
| RNT-04 | 1A | Quotation builder: quotation number, versioned, line items (base charge, distance charge, driver charge, approved waiting/overtime, other charges),… | Partial | Line items, deposit, currency and requote history (`quoteHistory`) — and since Phase 67 (D-117) **a number and a version on every quotation** (`QUO-0001`, revision 1, 2, …; a renewal keeps the number and raises the revision), **terms** in the company's own words, copied onto each quotation as they stood when it was issued, whether a driver is included, and a **validity counted in hours** rather than whole days. Since Phase 71 (D-121) a quotation is also **a document a second person signs off**: a declared **discount** with its reason, **tax lines** frozen at issue, a **total**, the deposit taken as a share of that total, and an **approval record** (who, when, which figure) required above a company-set figure, refused for the quotation's own author, and gating both the customer's yes and the deposit. **Still missing: the line *types* the brief lists** — a line is a description, a quantity and an amount, not a charge the program knows to be a distance, a driver or waiting charge, so nothing can price waiting or overtime from a rate (that remainder is FIN-01's).
| RNT-05 | 1A | Confirmation: validate the request; check vehicle schedule, capacity, status and driver availability; detect conflicts; record customer acceptance… | Partial | Validation, conflict check, deposit-per-policy recorded, reservation created via constraint, and since Phase 66 (D-116) **the customer's own answer to the quotation**: who agreed, when, to which quotation and through which channel, recorded once, refused on a lapsed quotation, and refused on a second yes. Agreeing is not paying — finance still records the deposit and the deposit is still what confirms the hire. **No notification**: there is no mail or SMS provider, so nothing is sent; the record says what happened and never that a message went out. |
| RNT-06 | 1A | Assign and reassign vehicle and driver, with history. | Met | Reassignment allowed while confirmed/in progress; each assignment writes an audit entry. History lives in the audit log, not a dedicated table. |
| RNT-07 | 1A | Completion: actual departure/return, actual distance when available, vehicle and driver, trip status, additional charges (approval required), damage… | Met | Completion captures the final line items, the vehicle and the driver, and since Phase 68 (D-118) **the run itself**: when the vehicle left (recorded when the hire starts) and came back, the odometer readings that give the distance — or a distance the office typed, marked as typed rather than measured — the damage reported and the customer's own words. **The balance is stated** from the invoice raised for the hire and the payments against it, through the one balance rule, and no invoice yet says exactly that rather than showing nought owed. **Additional charges are approved** (Phase 73, D-123): a charge added after the quotation went out — fuel, damage, waiting — is recorded with its reason and who added it, appears on the final invoice with that reason printed, and above a figure the company sets it needs a second signature from somebody other than its author before the bill can be issued. |
| RNT-08 | 1A | Cancellation releases reserved resources; reasons recorded. | Met | Verified live: a cancelled rental's dates were reusable immediately; reason required. |
| RNT-09 | 1C | Rental customer portal: own requests, quotations, payment status; accept or cancel where permitted. | Partial | Client portal lists its own rental requests and their quotation status, and since Phase 64 (D-114) **the payment side**: the invoices raised for its hires, what has been paid, credited and paid back, and what is still owed. Since Phase 66 (D-116) it can **accept its own quotation** — the figure, the deposit and the validity date in front of the button, and the answer recorded against that quotation and no other. **Still no cancel action** from the portal: cancelling a hire remains a phone call to the office. |
| WEB-01 | 1A | Public rental enquiry endpoint and embeddable form for the existing website, with rate limiting and spam protection. It creates a Submitted request… | Met | `GET/POST /api/enquiry` (unauthenticated, `src/app/api/enquiry/route.ts`) creates a draft request through the `submit_enquiry` command and returns the reference and a sentence — no records, no counts. Throttled 8 per 10 minutes per address (`rateLimit.take`), plus a signed time-trap (`src/server/enquiryToken.ts`) and a honeypot. The form is `src/screens/PublicEnquiry.tsx` at `/enquiry` (`?embed=1` for the website iframe), the only path allowed to be framed (`next.config.ts`). *Submitted* is a `draft` in the existing status vocabulary — the office still quotes and confirms. Adding to PROGRESS 2026-10-24: no acknowledgement email (no mail provider). |
| FLT-01 | 1A | Vehicle register: ID, registration number, make/model, category, seats, photo, fuel type, ownership/leasing, odometer, insurance, roadworthiness,… | Met | Registration, make, model, category, seats, status, notes; **fuel type, ownership and the lessor, and the usual driver** (Phase 57, D-107) — on the row, counted when missing, carried by the CSV importer; and **the vehicle's photograph** (Phase 58, D-108) — one picture per vehicle in its own folder, sniffed, server-named, replaced rather than duplicated, removed with a reason, served through a role-checked route, and counted when absent. Odometer readings, insurance/roadworthiness and service dates exist as their own records (FLT-03, MNT-01). Q-18 (how long a photograph is kept once it is off the register) is open, and nothing here deletes a file on the strength of a screen action |
| FLT-02 | 1A | Vehicle statuses: Available, Reserved, Assigned, On Trip, Under Maintenance, Out of Service, Pending Inspection. Define the rule for each state in… | Met | All seven (Phase 59, D-109). Four are the office's own stored words (`available`, `maintenance`, `out_of_service`, `retired`) with audited transitions; Reserved, Assigned, On Trip and **Pending inspection** are derived in `src/tms/fleetState.ts` from the runs, the hires and the work orders, because a stored copy would disagree with the records. Precedence is by what physically stops the bus, a broken plan is named in the same cell, the rule for every state is printed on the register, and the fleet is counted by state. The states decide nothing: blocking stays in `assessResources`, which reads the stored condition |
| FLT-03 | 1A | Vehicle documents with expiry dates and configurable reminders. | Met | Document register with expiry dates and a configurable lead time, status computed per day; a type may be marked **required**, which blocks assignment while missing or lapsed (Phase 26, D-76). Since Phase 60 (D-110) the papers that are running out are listed on their own **Renewals** card and on the dashboard's attention list, and somebody can **take a renewal on** — who, when, what they are doing and the date they expect the new paper — recorded in the audit log and lapsing when the expiry date changes. **Sending the message itself is Phase 2**: there is no mail or SMS provider, so the reminder is a record rather than a message, and the screen says so |
| FLT-04 | 1A | Driver register: licence class and expiry, qualifications, availability, status. | Met | `src/screens/Registers.tsx` + `src/tms/driving.ts` (Phase 54, D-103): each driver records **the classes printed on their licence** (upper-cased, compared ignoring case, up to 8) and **the certificates they hold**, beside the number, expiry and status that were already there. A **vehicle category may declare the classes that may drive it**, and dispatch then refuses a driver whose licence does not cover that vehicle — on both the trip and the hire path, and in the planning aid, which agrees with the save by construction. A blank class **fails closed once a requirement is declared** and says so in those words; an undeclared category checks nothing. **Availability** is shown as *free today* / *on TR-0001 (Northstar morning) today* / *on hire RR-0007 today*, derived from the runs and never stored. Tests: 20 domain (`driving.test.ts`), 1 planning-aid (`planning.test.ts`), 5 screen (`Registers.test.tsx`), 1 import (`import.test.ts`) |

| FLT-05 | 1A | Fleet dashboard calculated from persisted records only: totals, availability, assigned, on trip, under maintenance, pending inspection, expiring… | Met | A **Fleet dashboard** screen on the `fleet:read` route (Phase 62, D-112), every figure counted from records: the fleet and its state today from the same function the register uses, the period measured in **vehicle-days** (one vehicle, one day) split into worked / in the workshop / booked and never ran / idle, the approved Q-29 utilisation (committed ÷ available vehicle-days) beside the stricter days actually worked, and a per-vehicle table with idle days first. **Idle cost** is idle days × the company's own standing cost per vehicle-day, a setting with no default: until management supplies it the screen counts the days and says they carry no money. It names what the records cannot hold — retired vehicles (no leaving date), workshop days with no work order, undated out-of-service records, booked days that never ran, and that hours are not measured at all. The papers running out, the last part of the item, are on the compliance screen and the dashboard attention list (FLT-03, D-110) |
| MNT-01 | 1A | Work orders: reference, vehicle, reported fault, work type, priority, date reported, odometer, assignee, required work, parts, labour cost, parts… | Partial | Reference, vehicle, fault, type, priority, date, odometer, workshop, assignee, costs, log, and a release recorded with `releasedBy`/`releasedAt`. **Statuses are 5, not 8; no parts list and no inspection record.** |
| MNT-02 | 1A | Safety-related defects block the vehicle. It stays unavailable until an authorised person records the inspection and release; record who released it… | Partial | Blocking works and is tested. Release is now its own permission (`maintenance:release`, Phase 19): an account that may advance a work order still cannot close one, and `releasedBy`/`releasedAt` name who released the vehicle and when — exercised in the trial, §6. **No inspection record** (results, pass/fail, technician), and roles remain the five fixed ones rather than a separate technician role. |
| MNT-03 | 2 | Preventive maintenance reminders by calendar date, mileage and service interval. A passed date never marks maintenance complete. | Partial | Interval rules per category, due/overdue computed from odometer and last service; a passed date never completes anything. **No reminders** (no scheduler). Phase 2. |
| MNT-04 | 3 | Maintenance cost analytics: spend by vehicle, repairs by type, downtime, recurring faults, parts vs labour. | Deferred | Phase 3. |
| CLI-01 | 1B | Corporate client records: name, registration details if supplied, contact person, telephone, email, billing address, branches and office locations, contract status, notes, history.… | Met | `src/screens/Registers.tsx` + `src/tms/clients.ts` (Phase 53, D-102): the record now holds **the registration number and the date on the certificate** when the office has one (blank when it does not, and a registration cannot be dated in the future), **branches** — each a named place with an address, a person and a phone, one name per customer, closed rather than deleted — and the row states **which agreement is in force** ("CT-0001 active to 2026-12-31", or *no agreement on file*), read from the contracts rather than stored on the customer. Contact person, telephone, email, billing address, tax number, notes, status and the per-customer **History** panel came with CUS-01. Tests: 12 domain (`clients.test.ts`), 8 command (`clientDetails.test.ts`), 5 screen (`Registers.test.tsx`), 1 payload (`visibility.test.ts`), 2 against PostgreSQL (`repository.integration.test.ts`, CI only). |

| CLI-02 | 1B | Contracts: reference, client, dates, status (Draft, Pending Approval, Active, Suspended, Expired, Terminated), attachment where supported, service… | Met | `src/tms/contracts.ts` and the Contracts screen (Phase 46, D-95). `CT-0001` numbering; client, dates, service type, routes; the six states with the allowed moves and a reason required to suspend, terminate or send back to draft; expired **derived** from the end date rather than stored; pricing model, billing frequency, payment terms and service-level targets typed from the signed paper, blank left blank; approved terms frozen, a change being a new contract that names the one it replaces; overlapping live contracts refused; renewal watch inside `settings.documentReminderLeadDays`; bookings gated on contract status at request **and** confirmation. Tested in `contracts.test.ts` (22), `Contracts.test.tsx` (9), `visibility.test.ts` (3) and `bookings.test.ts` (2). **The signed paper is not attached to the record** — the brief asks for it "where supported", and file storage is not supported here; the reference is typed on the contract instead. |
| CLI-03 | 1B | Corporate dashboard limited to the client's own records. | Met | Client portal shows own routes, roster, rentals, **its own agreements** (Phase 46) — service, term, state — and, since Phase 64 (D-114), **its own account**: what was billed, what came in, what was credited, what is still owed and what is overdue, with every invoice, payment, credit note and refund behind those figures. `invoices:read` is own-record scoped, and the billing is narrowed twice — `clientBilling` in `src/tms/scope.ts` on the server, and the portal's own scope — so another customer's invoice cannot be assembled from the payload. A driver and a rider still receive no billing. Tests: 10 domain (`clientAccount.test.ts`), 3 portal (`ClientPortal.test.tsx`), 3 scope, 3 net new payload (`visibility.test.ts`). |
| EMP-01 | 1B | Employee register: reference, name, contact, company, department, work location, shift, approved pickup and drop-off locations, account status,… | Partial | Passenger record: name, phone, employee reference, client, route, stop, status. **No department, work location, shift, eligibility, accessibility or drop-off.** |
| EMP-02 | 1B | CSV import: documented template, required-field validation, duplicate detection by reference and likely duplicates, preview before saving, row-level… | Met | `src/tms/import.ts` with `kind="passengers"` from the Passengers tab (Phase 31, D-81): template documented in `docs/SETUP_AND_DEPLOYMENT.md` §8, names resolved to records, duplicates by employee reference rejected, likely duplicates flagged **Check**, preview before saving, every row either created or named by line. |
| EMP-03 | 1B | Employee management: shifts, locations, eligibility toggle, permitted exports. Deactivated employees cannot create bookings unless policy allows. | Partial | Route/stop assignment and status changes; no shifts, locations, eligibility or export. |
| RTE-01 | 1B | Locations and stops: coordinates, landmark description, optional Ghana digital address. | Met | `src/tms/stops.ts` + the route form (Phase 55, D-104): every pickup and drop-off stop carries a **landmark** ("behind the Total filling station"), an optional **Ghana Post GPS address** (`GA-123-4567`, shape-checked because a mistyped code is worse than none) and optional **decimal coordinates**, refused one without the other. The driver's next stop shows the directions and a map link, the stop form repeats them where the driver records the stop, and the customer and rider portals show the landmark rather than the office's coordinates. The routes screen counts the stops **nobody has described** instead of implying the route is complete. Tests: 15 domain (`stops.test.ts`), 3 stop form (`TripStopForm.test.tsx`), 1 screen (`Busing.test.tsx`) |

| RTE-02 | 1B | Routes: reference, name, service type, client, origin/destination, ordered pickup and drop-off stops, operating days, shifts, planned start, expected… | Partial | Reference, name, client, direction, shift, category, weekdays, date range, ordered stops, status. **No expected duration or capacity requirement.** |
| RTE-03 | 1B | Recurring schedules by day and shift, one-time trips, copy a previous schedule, conflict detection. | Met | Live: 10 trips generated across weekdays for a date range; duplicate guard in the trip unique constraint. "Copy previous schedule" is absent. |
| RTE-04 | 1B | Explainable planning aid that considers pickup locations, destinations, capacity, required arrival times, durations, availability, existing… | Met | `src/tms/planning.ts` (Phase 47, D-96). Every vehicle-and-driver pair is judged by the **same rule the save enforces** (`assessResources`), ranked with a sentence per pair, and offered in the assign panel and on the dispatch desk. It considers capacity (roster **and** booked seats), availability and existing commitments (other runs and hires that day), vehicle state, papers, licence and service intervals, and the timetable window — and it **assigns nothing**: the dispatcher still presses save. **Stated limit:** stops have no coordinates and no travel time is recorded, so distance and duration cannot be weighed — the aid says so on screen rather than guessing (RTE-01). |
| RTE-05 | 3 | Interface for a later vehicle-routing optimisation service. | Deferred | Phase 3. |
| BKG-01 | 1B | Booking types: home-to-office, office-to-home, one-time, recurring, approved ad-hoc, emergency, return, additional approved destination. | Partial | One **one-time** booking or a **recurring** series (one booking per operating day, at most 62 days); the direction of travel — to work, from work, other — comes from the route, and a booking may be made on a scheduled or an ad hoc (emergency) run. **No separate return or additional-destination booking type, and no distinct approved-ad hoc type** beyond the ad hoc run (DSP-03). |
| BKG-02 | 1B | Validation: eligibility, contract status, company policy, cut-off times, duplicates (unique constraint on employee and journey). | Partial | Eligibility: the rider must be active, must belong to the same client as the route, and must **not** already be on that route's roster (booking would count the seat twice). Duplicates: a partial unique index on `(trip_id, passenger_id)` for live statuses. Cut-offs: `settings.booking.requestCutoffMinutes` / `cancellationCutoffMinutes`, whole minutes, blank = no deadline. The run must exist and not be cancelled, completed or already departed. Contract status: a request is refused when the covering agreement is not active, or when the last one ended before the date and nothing replaced it (Phase 46, D-95), checked again at confirmation. **No company-policy rules.** |
| BKG-03 | 1B | Booking workflow with unique reference; accepted, rejected or pending per configured rules. | Met | `create_booking` in `src/tms/bookings.ts`: continuous references `BK-0001`, `BK-0002`…; `requested → confirmed \| rejected \| waitlisted` and `waitlisted → offered → confirmed \| cancelled`; a reason is required to refuse or cancel; each decision writes an audit entry (`bookings:create\|confirm\|waitlist\|reject\|cancel`). Tested in `bookings.test.ts` ("books a named seat for a visitor…", "rejects a request with a reason…"). |
| BKG-04 | 1B | Assign bookings to trips with a transactional capacity check (§5.1). | Met | Capacity = vehicle seats − active roster on the route − confirmed/offered bookings (`capacityOf`), checked inside the single write transaction every command runs in under the global advisory lock, so two requests cannot both take the last seat; confirming on a full run moves the booking to the waiting list instead of overbooking. A run with **no vehicle assigned cannot be booked at all** — the seats cannot be counted. Caveat: the check lives in the command, not in a database constraint (unlike the rental exclusion constraint), so a direct SQL insert would bypass it. |
| BKG-05 | 1B | Cancellation deadlines and reasons; waiting list; offer freed seats per policy and never auto-confirm unless policy permits. | Met | Cancellation requires a reason and is refused inside the configured cut-off; cancelling a held seat **offers** it to the oldest waiter (`offeredAt`) and stops — **nothing is auto-confirmed**, and there is no expiry timer (D-83). Tests: "offers the freed seat to the oldest waiter and confirms nobody", "applies a cancellation cut-off only when one is configured". |
| BKG-06 | 1B | History of important booking changes. | Met | `Booking.history` keeps one entry per change (who, when, action, note) beside the audit log; shown as **Last change** on the Bookings tab. Test "keeps the whole history of what happened to the booking". |
| TRP-01 | 1B | Trip records: reference, service type, related booking or rental, client or customer, route, ordered stops, planned and actual times, manifest,… | Partial | Reference, route, date, planned/actual stop times, manifest, driver, vehicle, status (5), completion. **No service type, rental link, delayed/interrupted states, notification or incident reference.** |
| TRP-02 | 1B | Passenger manifests. | Met | Per-trip manifest with boarding outcomes: the route roster **plus** the seats booked on that run (`manifestFor`, Phase 35, D-85), each rider marked roster or booked with the seat reference and pickup stop, on the office screen and the driver portal alike. |
| DSP-01 | 1B | Daily dispatch board (table or calendar): today's trips, upcoming departures, active, completed, delayed, cancelled, unassigned bookings, available… | Partial | A **Dispatch board** screen (Phase 65, D-115): one date, every run in departure order with its company, vehicle (and the vehicle's state today), driver, seats and any delay; the day's counts by status; the runs waiting on a crew, over the seats on the bus, or blocked by a bus in the workshop or a lapsed licence; the vehicles and drivers free that day, each with a sentence; filters for date, status, company, route, driver and vehicle; and the limits printed on the page. It is a table rather than a calendar, which the brief permits, and it changes nothing — crewing and releasing stay on Staff busing. **One filter is missing because the record is: a run carries no service type (TRP-01)**, so the board cannot filter by service and says so. |
| DSP-02 | 1B | Assign and reassign vehicle and driver, validating availability, qualifications, vehicle condition, capacity and conflicts. Overrides need permission… | Partial | Validation of category, status, roster capacity, licence expiry, time overlaps, rental clashes, vehicle/driver double-booking. **No permission-and-reason override.** |
| DSP-03 | 1B | Emergency trip creation. | Met | `create_adhoc_trip` (Phase 32, D-82): a run outside the schedule for any date from today, with a written reason and its own TR number; migration 006 narrows the one-per-day index to scheduled runs so a replacement can stand beside the cancelled one. Created from **Add an ad hoc run** on the Trips tab, marked "ad hoc" with its reason on the run sheet, and checked exactly as a planned run is. |
| DSP-04 | 1B | Record no-shows and delays; cancel or interrupt trips. | Met | No-show per rider at each stop and on completion; **a delay is reported while the run is out** — minutes behind the timetable, why, by whom, append-only, and `0` to say it caught up (D-105, Phase 56) — shown on the dispatch sheet, the driver's own run, the client's portal and the rider's page. A run that stops mid-way is cancelled with its reason, keeping the stops and outcomes already recorded, and where the cause is a breakdown or safety incident the two records are linked (D-75). Tests: 8 service (`busing.test.ts`), 16 domain (`delays.test.ts`), 4 form, 2 portals, 1 dispatch screen, 3 rider states |

| DRV-01 | 1B | Mobile-first driver home: profile, today's assignments, next trip, departure time, route and stops, passenger count, vehicle, alerts, history. | Met | Driver portal: today's assignments, next departure, route and stops, passenger count, vehicle, history. |
| DRV-02 | 1B | Driver actions: open trip, view manifest, open external navigation, mark ready, start, confirm boarding, record no-show, confirm drop-off, report… | Partial | Open trip, manifest (roster and booked seats, D-85), start, board, no-show, complete. **No external navigation, no mark-ready, and no idempotency key (5.8).** A delay can be reported from the driver's own run (Phase 56, D-105). |
| DRV-03 | 2 | Boarding verification: trip-specific code or OTP from a secure random source, expiry, single use where policy requires, results recorded, minimal… | Deferred | Phase 2. |
| DRV-04 | 1B | Vehicle defect report and breakdown/incident report (basic record; full handling in INC). | Met | Driver can raise an incident which blocks the vehicle and creates a work order. |
| DRV-05 | 2 | Offline operation (progressive web app): queue status and boarding events locally with event IDs, sync when connectivity returns, show "pending sync"… | Deferred | Phase 2. |
| PAX-01 | 1C | Passenger portal: profile, approved options, request eligible journeys, booking references and status, pickup time and location, history, cancel… | Met | `src/tms/passenger.ts` + `src/screens/PassengerPortal.tsx` (Phase 48, D-97): a third record-bound role (`passenger`, one account per rider, migration 016) whose payload is **one person** — its own record, its own seats, the runs that carry it and the bus on them. The page states each journey in the brief's own terms: **seat requested, waiting list, seat offered, seat held (no bus assigned), bus assigned, ready to leave, under way, picked up, travelled, not recorded aboard, run cancelled, cancelled, not accepted** — every one derived from a booking status, a run status or a boarding outcome recorded at the door, never invented. Pickup time and stop come from the route's timetable and the rider's own stop; the booking reference is on the row. It lists **the runs a rider may ask for and the office's reason for the ones it may not** (own route = the roster is the seat; full; already held; inside the request cut-off; contract not active) using the same rules the command enforces, and lets the rider cancel a seat it holds, inside the cancellation cut-off. **Feedback**: a report about a journey the rider is on becomes an incident on the ordinary operations log, with the run's own vehicle and no power to withdraw it. **Deliberately absent:** no map, no arrival countdown, no live position — nothing records one, so the page says the run has started and prints its stated limits instead (PAX-02). A **reported delay** is shown after the run's own news (Phase 56, D-105). Tests: 20 domain (`passenger.test.ts`), 4 payload (`visibility.test.ts`), 2 screen (`PassengerPortal.test.tsx`). |
| PAX-02 | 2 | Trip updates. Do not show a live map or live ETA when only manually entered statuses exist. | Deferred | Phase 2. |
| INC-01 | 2 | Incident records: reference, trip, vehicle, driver, time, type (breakdown, accident, driver unavailable, traffic delay, missed pickup, complaint,… | Partial | Reference, vehicle, trip, type, severity, description, assignee, status, costs, log. **No driver, time, location, people affected, attachments.** |
| INC-02 | 2 | Breakdown workflow: driver reports, incident created, dispatcher alerted, affected trips and passengers identified, eligible replacement vehicles and… | Partial | Vehicle blocked, work order created, incident stays open. **No affected-passenger identification, no replacement listing, no notification.** |
| FIN-01 | 1A | Configurable pricing models: fixed monthly, per trip, per passenger, distance-based, time-based, fixed quotation, approved waiting/overtime, approved… | Partial | Rental pricing basis (`per_day`, `per_km`, `per_trip`) with line items and a deposit rule; quotations are gated on the basis, currency, deposit %, validity and payment methods. Quotations carry tax lines and a declared discount since Phase 71 (D-121), as invoices already did; **no waiting/overtime, extra-stop or discount *policy*** — a reduction is a figure somebody types with a reason, not a rule the program applies — **and no contract pricing.** |
| FIN-02 | 1A | Invoices: number, customer or client, related contract or rental, dates, itemised lines, taxes from settings, discounts/adjustments, totals, amount… | Partial | Built in Phase 16: `invoice` table and `src/tms/finance.ts`, `InvoicesPage`. Number from `reference_counter`, lines copied from the completion record, tax lines snapshotted from settings, discount as its own line, amount paid and outstanding derived from payments, status `issued → part_paid → paid → void`, partial unique index on `billable_event` so a service is billed once, immutability triggers. Totals, tax lines and the balance are computed in whole pesewas with one rounding rule (Phase 22, D-72). **Credit notes** (Phase 36, D-86): a numbered `CN-2026-0001` document against one invoice, with its own date, line, reason and the invoice's own tax snapshot, immutable once issued, voidable, capped at the invoice total, and the basis of every balance the system states (`outstanding = total − paid − credited`, one helper in `src/tms/creditNotes.ts`). A credit that takes the bill below what was paid is reported as a refund due rather than netted away. **Printable copies** (Phase 37, D-87): the invoice and each credit note print as a formatted A4 sheet, or save as a PDF from the browser's own print dialog, with the amount due taken from the same balance helper. **Still missing: no stored or emailed copy, no corporate invoice generation** (needs contracts). |
| FIN-03 | 1A | Manual payments: reference, customer, invoice or rental, amount, currency, method (cash, bank transfer, mobile money), date, external reference,… | Partial | Built in Phase 16: `payment` table; reference from the counter; method must be a configured one; external reference is the idempotency key (partial unique index + replay returns the existing payment); status only advances recorded → verified → reconciled; financial fields immutable by trigger; overpayment refused with the balance, compared in whole pesewas so an exact balance is accepted and one pesewa more is not (Phase 22, D-72). A wrong amount on an invoice is now corrected with a credit note (Phase 36, D-86), which leaves the payment row untouched. **A payment recorded in error is cancelled** (Phase 38, D-88): one-way, reason required, the record keeps its number and its place in the list, the amount stops counting as received and the invoice goes back to what it actually owed; a cancelled payment is excluded from both money reports, the finance home and the printed sheet by one shared rule. The deposit at confirmation remains a rental field, separate from the payment ledger. **Money going back out has its own record** (Phase 41, D-92): a numbered `REF-` refund against an invoice, capped at what is still owed back, with a required reason, cancellable once, stated on the invoice, the customer statement, the money report and the finance home. **Still missing:** no cash book (an operator cannot reconcile a day's takings), and a payment that was real and later returned is corrected by a refund, not by a reversal of the payment. |
| FIN-04 | 3 | Payment provider integration (for example Paystack or Flutterwave): verify webhook signatures, idempotent handling, never trust a browser redirect,… | Deferred | Phase 3. |
| FIN-05 | 3 | Expenses: reference, date, category (fuel, maintenance, repairs, tyres, tolls, other), vehicle, trip, supplier, amount, method, receipt, recorded-by,… | Met | Phase 42 (D-93): a standalone **expense** — numbered `EXP-2026-0001` from its own yearly series, filed by the day the money left, with a category from Settings or blank (reported as "Uncategorised"), a description, who was paid, an amount and currency, an optional method from the configured list, the number on the paper receipt, whether the paper is held, and notes. Never edited: voided once with a reason, and a voided entry counts in nothing while keeping its number and explanation. Recording requires the company currency, exactly as an invoice does. Counted by `costReport` beside incident and work-order costs — one cost figure used by the cost tab, the money report and the finance home — with `expensesWithoutReceipt` stated rather than hidden. `expenses:read` for administrator, finance and operations; `expenses:record`/`void` for administrator and finance. Migration `011_expenses.sql` (`expense_frozen()`, `expense_no_delete()`, receipt-number shape, positive amount, void-has-reason, held-has-number). A receipt is a number, a tick **and, since Phase 51, a scanned copy** (Q-51, D-100): the image is filed in a folder on the office machine, kept three years, open to finance and administrators only. **No vehicle, trip or supplier record link, and no approval step.** |
| FIN-06 | 3 | Driver allowances, trip payments, overtime and payroll export, with configurable rules and approval. | Deferred | Phase 3. |
| FIN-07 | 1C | Finance dashboard whose totals reconcile to transaction records. Margin is shown only when cost and revenue data are sufficient. | Met | `src/tms/financeHome.ts` + `src/screens/FinanceHome.tsx` (Phase 34, D-84): a finance account lands on **Finance**; the period figures are `financialReport` itself, so they cannot disagree with the report and CSV behind them; overdue invoices, unbilled completed hires and payments still to verify are measured **as at today**, not inside the period. **Margin** is shown only under a written sufficiency rule (currency set, an invoice and a cost line in the period, and no hire completed in the period left unbilled) and otherwise names what is missing; it is labelled as not profit, with cash movement beside it. Tests: 15 domain (`financeHome.test.ts`), 5 screen (`FinanceHome.test.tsx`). |
| FIN-08 | 3 | Payment reconciliation records. | Deferred | Phase 3. |
| NTF-01 | 2 | Notification service: in-app channel first, provider interface for others, configurable templates, stored status, retry on failure, duplicate-event… | Deferred | Phase 2. No notification code exists at all. |
| NTF-02 | 2 | SMS adapter through a Ghana-capable provider (candidates: Hubtel, Arkesel, mNotify; verify availability and pricing). SMS is the channel most staff… | Deferred | Phase 2. |
| NTF-03 | 2 | Email adapter. | Deferred | Phase 2. |
| RPT-01 | 1A | Rental reports: enquiries, quotations issued, acceptance rate, confirmed and completed rentals, revenue, outstanding balances, vehicle utilisation,… | Met | `src/tms/rentalReport.ts` + `src/screens/Reports.tsx` (Phase 17). All eight figures are computed from records, with coverage stated, a currency guard and a CSV of the same numbers; 7 domain tests and 3 screen tests. Formulas in `docs/KPIS.md`. |
| RPT-02 | 1C | Staff transport and fleet reports: bookings received/confirmed/completed/cancelled, no-shows, on-time pickup rate, average delay, passengers… | Met | `src/tms/staffReport.ts` + `src/screens/StaffTransportReport.tsx` (Phase 50, D-99): **Staff transport**, its own tab on Reports (offered only to a role that may read the employee roster). Runs scheduled, worked, cancelled and outside the schedule; riders carried, expected, no-shows and **not recorded** (an expected rider with no boarding row is a named gap, never a silent zero); boarding rate; occupancy from the seat capacity of the bus that ran, not the roster size; average delay over the stops that were recorded late; on-time taken unchanged from `kpis.ts`. Then seats asked for by status (requested, confirmed, waiting list, offered, refused, cancelled), **why seats were lost** grouped by the reason the office typed, a **per-route** table (runs, carried, no-shows, not recorded, seats offered, occupancy) and a **per-client** table. A **"What this report cannot say"** card lists the four facts the records do not hold — fuel and mileage are not per route, downtime is not measured, a run records no agreement so contract performance is not measured, a delay is known only where a stop time was recorded — beside the coverage counts. Definitions in `docs/KPIS.md`; CSV of the same figures. Tests: 12 domain (`staffReport.test.ts`), 3 screen (`Reports.test.tsx`). |
| RPT-03 | 1C | Financial reports: revenue by service and customer, payments received, outstanding invoices, expenses by category, cost per trip, cost per passenger… | Partial | `src/tms/financialReport.ts` + a section on the Reports screen (Phase 28): all six figures computed from records, with the period, coverage, cost-per-trip and cost-per-passenger definitions from Q-29, and a CSV. **Revenue by service has one line** because only vehicle hire is invoiced in this build; contract billing is FIN-02. No profit or margin (costs captured are maintenance only). |
| RPT-04 | 1C | Filters (date range, service, client, customer, route, driver, vehicle, status) and CSV export, always permission-scoped. Every KPI formula is… | Partial | Date ranges and CSV on the rental, financial and staff transport reports; since Phase 63 (D-113) also on the **finance home**, a customer's **statement** and the **fleet dashboard**, all through one writer that defuses spreadsheet formulas and one download helper (nothing uploaded, nothing stored — the payload arrives already narrowed to the role). Every screen with a period has its own filters (period, category, search, status) and every KPI formula is in `docs/KPIS.md`. **Still missing: a bar that narrows a report by service, client, customer, route, driver or vehicle** — and that is a separate problem, because a filtered KPI is not the KPI and would need its own stated definition. The compliance register still has no export. |
| RPT-05 | 3 | PDF reports. | Met | `src/tms/printableReport.ts` + `src/screens/PrintableReport.tsx` (Phase 49, D-98): the management report as an A4 document — company and period in the head, eight figures each with the sentence that qualifies it, then revenue by customer, revenue by service, costs by category, money in and back out, why rentals were lost, fleet utilisation and the per-unit costs, followed by the coverage counts and the definitions a reader would otherwise assume. Every value is **the report's own number formatted, never a second addition**, and it prints through the browser's own engine to paper or to PDF (the sheet the invoice and statement already use, D-87). **Withheld, not zero:** with no company currency set every amount is "Not stated" and the page says why; an empty table says so; a backwards period prints no report at all. **A PDF file is produced by the print dialog, not stored or emailed** — there is no PDF library and no second rendering engine in the build. Tests: 10 domain (`printableReport.test.ts`), 3 screen (`Reports.test.tsx`). |
| GPS-01 | 2 | Provider interface; last reported location with timestamp; clear distinction between live, stale and simulated locations; never fabricate… | Deferred | Phase 2, hardware-gated. No provider interface and no "Not configured" label exists, because there is no tracking screen. |

**78 IDs: 39 met, 26 partial, 0 not built, 13 deferred** (by phase: 1A 29 - 18 met / 11 partial; 1B 25 - 16 met / 9 partial; 1C 6 - 3 met / 3 partial; 2 11 - 3 partial / 8 deferred; 3 7 - 2 met / 5 deferred; the register above is the count). The brief carried more requirement IDs than the register rows: where two IDs described one piece of work they share a single row, so this tally follows the rows that exist and is kept correct against them by the audit in `docs/AUDIT.md`.

## Phase 0 - Inspect and plan (approved)

| Item | Status | Notes |
|---|---|---|
| Inspect project | Done | Vite 7 + React 19 + Tailwind 4, single-file static build; no backend, no database, no CI. |
| Verify hosting target | Blocked | Section 3 hosting fields are not in the uploaded material (Q-01). |
| ARCHITECTURE.md | Done | `docs/ARCHITECTURE.md`. |
| ERD.md | Done | `docs/ERD.md`, with Mermaid diagram, constraints and exclusion constraints. |
| PERMISSIONS.md | Done | `docs/PERMISSIONS.md`. |
| STATE_MACHINES.md | Done | Vehicle, rental and trip machines in `docs/STATE_MACHINES.md`. Invoice, contract and incident machines Not Started. |
| KPIS.md | Done | RPT-01, RPT-02 and RPT-03 implemented; utilisation, cost per trip and the cost-category list defined and approved (Q-29, D-78). |
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
| RPT-02 staff transport report, RPT-03 cost per trip | Done (verified) | Q-29 definitions approved (Phase 28, D-78); RPT-03 built in Phase 28, RPT-02 in Phase 50 (`staffReport.test.ts`) |
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
| RPT-02 staff transport report, RPT-03 cost per trip | Done | Q-29 definitions answered; RPT-02 built in Phase 50, RPT-03 in Phase 28 |
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
| **Not built** | — | Date-range presets and filters by client/customer. The printed report arrived in Phase 49 (RPT-05) |

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
| Tests | Done (verified) | 7 command/balance (`refunds.test.ts`), 3 statement, 1 statement sheet, 3 report, 3 finance home, 3 visibility, 3 invoice screen, 2 finance home screen, and 1 PostgreSQL flow (`commandFlow.integration.test.ts` — CI only) that proves the ceiling, the one-way cancellation and the refusal to rewrite a cancellation |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **606 passed, 18 skipped**, `build`
succeeds.

## Phase 42 - Money spent that is not a repair (FIN-05, D-93)

The cost register could only hold what hung off an incident or a work order. Fuel, tolls, permits, rent
and allowances went onto paper, so "costs recorded" meant "maintenance recorded" while being read as
"what the month cost". This phase gives that spending one place, entered from the receipt, counted in
the same cost figure every other screen uses, and impossible to quietly rewrite.

| Item | Status | Evidence |
|---|---|---|
| Spending that is not a repair is a numbered record | Done (verified) | `EXP-2026-0001` series: "numbers it, keeps the receipt facts, and files it by the day the money was spent"; the reference-series test pins the shape; migration `011_expenses.sql` checks `^EXP-[0-9]{4}-[0-9]{4,}$` |
| It is in the one money report, not a side ledger | Done (verified) | `costReport` lines carry `source: "expense"`; "counts in the one cost report, as its own kind of line" (320.50 + 17 in June, 99 in July left out) and the report names the standalone expenses and how many carry the paper |
| A blank category stays blank | Done (verified) | "lets an expense be uncategorised, and refuses to say the paper is held without a receipt number"; the screen and the report print "Uncategorised" rather than folding it into another line |
| Nothing is invented | Done (verified) | "refuses an unknown category, method or empty description rather than inventing one" — four field messages, no record written; an impossible date is refused by the same round-trip check the rest of the system uses |
| A wrong entry is voided, never edited | Done (verified) | "voids once, with a reason, and the voided entry stops counting everywhere" — status `void`, reason and date kept, the number kept, a second void refused, the report back to zero |
| The figure needs a currency | Done (verified) | "refuses to record spending before the company currency is set"; the screen says so and disables the button |
| Recording is a finance job | Done (verified) | `expenses:record`/`expenses:void` for administrator and finance; operations reads spending but may not enter or void it; a driver is refused outright |
| A driver or client contact never receives the register | Done (verified) | `visibleSnapshot` sends `expenses` on `expenses:read` and empties it for bound roles; 2 snapshot tests |
| The receipt is honest | Done (verified) | `receiptHeld` without a number is refused in the service and by a table check; the screen counts the spending with no number on it, and the cost tab repeats the count |
| A scanned copy is deliberately not stored | Done (verified) | Nothing writes a file; recorded as the open owner decision in D-93 |
| A cancellation gives its headroom back | Done (verified) | `013_refund_ceiling_on_update.sql` and `014_credit_note_ceiling_on_update.sql`: records are saved with one `insert … on conflict do update`, so the INSERT-time ceiling checks also ran when an existing row changed and counted that row against itself. Cancelling a full refund (or a credit note for the whole invoice) was refused with "exceeds the 0.00 owed back". Both checks now skip a cancelled row and exclude the row being written; the credit-note test voids a 3,450 credit note to prove it |
| Every series the application can allocate is one the database accepts | Done (verified) | `012_reference_counter_scopes.sql` widens `reference_counter_scope_check` to match `REFERENCE_SERIES`; `references.integration.test.ts` inserts a counter for every series, so the next forgotten name fails in CI. **This found a shipped bug:** refunds (D-92) could not be recorded against a real database, because `010_refunds.sql` never added `refund` to that list — no unit test could see it, and the refund flow had no PostgreSQL test |
| Tests | Done (verified) | 7 command/cost (`expenses.test.ts`), 2 snapshot scope, 10 screen (`Expenses.test.tsx`), 1 reference series, and 1 PostgreSQL flow against the real table (`commandFlow.integration.test.ts` — CI only, no local server) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **625 passed, 21 skipped**, `build`
succeeds.

## Phase 46 - The agreement behind a corporate account (CLI-02, D-95)

A client record said that a company existed. Nothing said what had been agreed with it, for which
days, over which routes, until when, or on what terms — so "is this account still ours?" could only be
answered by finding the file. This phase gives the office that file, transcribed rather than
calculated, and makes the booking desk read it. `docs/DECISIONS.md` D-95 records the reasoning;
`docs/STATE_MACHINES.md` the lifecycle; `docs/ERD.md` the shape.

| Item | Status | Evidence |
|---|---|---|
| An agreement is a numbered record | Done (verified) | `CT-0001`, continuous and not per year (a term is not a tax year); `contracts.test.ts` "numbers contracts in one continuous series"; `015_contracts.sql` gives the table its own reference shape and the counter its own scope, proved against PostgreSQL in `contracts.integration.test.ts` |
| The term, the service and the terms are typed from the paper | Done (verified) | Client, dates, service type, routes, weekdays, shifts, vehicle category, pricing model, billing frequency, payment terms and service levels, each free text and allowed to stay blank; "keeps the pricing and payment terms exactly as typed, and leaves a blank blank" |
| Expiry is read, not recorded | Done (verified) | `contractStateOf` derives `expired` from the end date; "reads expired from the end date without anybody recording it" and "does not call a suspended contract expired when its date passes"; no scheduler exists and none is needed |
| The six states, with the moves that make sense | Done (verified) | Draft, Pending Approval, Active, Suspended, Terminated stored; Expired derived. `advance_contract` with a required reason for suspending, terminating or going back to draft; "refuses to approve a contract whose term has already ended"; "refuses every move out of terminated" |
| An approved agreement is not rewritten | Done (verified) | `isContractEditable` for draft and pending approval only; a change is a new `CT-` record with `replacesId`. The database refuses term edits on an approved row and refuses every delete (`contract_frozen`, `contract_no_delete`), proved in `contracts.integration.test.ts` |
| Two live agreements cannot overlap | Done (verified) | "refuses a second live contract over the same days, naming the first" and "lets two drafts overlap while a renewal is prepared"; a renewal must start after the one it replaces, because `replacesId` is not an exemption |
| Routes on an agreement belong to that client | Done (verified) | "refuses a route that belongs to another client" — the same rule the roster uses, so a contract cannot promise work the client does not have |
| The booking desk reads the agreement | Done (verified) | `bookingContractProblem`: refused under a draft, pending, suspended or lapsed agreement, naming it and its state; allowed when the client has no agreement at all or the agreement was terminated. Checked on the request **and** again on confirmation ("a suspended contract blocks confirmation the request was made under") |
| The client sees its own agreement | Done (verified) | Client portal "Your agreement" card: service, term (or "open-ended") and state, with no pricing. `contracts:read` is own-record scope; 3 snapshot tests prove a client contact sees only its own and a driver sees none |
| A renewal does not pass unnoticed | Done (verified) | `contractsDueForRenewal` uses `settings.documentReminderLeadDays`; a blank setting produces an empty list and the screen says the window is not set rather than warning about nothing |
| Who may do what | Done (verified) | `contracts:read` for the office, `contracts:create`/`update` to draft and correct, `contracts:advance` to approve, suspend or terminate. Finance reads the terms it invoices against and approves nothing |
| Tests | Done (verified) | 22 domain (`contracts.test.ts`), 9 screen (`Contracts.test.tsx`), 3 snapshot scope, 2 booking gate, 1 reference series, and 5 against real PostgreSQL (`contracts.integration.test.ts`, CI only) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **661 passed, 26 skipped**, `build`
succeeds.

## Phase 47 - An aid that says who can take the run, and why (RTE-04, D-96)

Dispatch could be done, but it was done in somebody's head: two long dropdowns, and the knowledge of
which bus was free at six, whose licence was about to lapse and which run already had a bus in the
workshop. This phase puts that reading of the records on the screen — ranked, reasoned, and read-only.
`docs/DECISIONS.md` D-96 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| It answers "who can take this run?" | Done (verified) | `planRun` / `planDay` in `src/tms/planning.ts`, shown in the assign panel and on the dispatch desk; "sends the smallest bus that fits, and says the numbers it fitted" |
| It reads the rule the save enforces, so it cannot suggest what would be refused | Done (verified) | `assessResources` and `rosterCount` are exported from `busing.ts` and called per pair; two tests hold both directions — "everything it offers, the save accepts" and "nothing it refuses, the save would accept" |
| It counts the seats actually needed | Done (verified) | Roster **and** sold seats, as the save does: "counts a sold seat against the vehicle, the same way the save does" (13 seats, 12 riders, 1 booked — exactly full, no spare) |
| It weighs what is already in the day | Done (verified) | Other runs and confirmed hires on that date are named: "refuses a bus already out on an overlapping run, naming that run"; between equals it picks the driver with less on ("spreads the day") |
| It explains, in sentences | Done (verified) | Every pair carries its seats, its window and its load; a refusal is the rule's own words, e.g. "must be Available to be assigned (currently under maintenance)" |
| It is honest about its blind spots | Done (verified) | `PLANNING_LIMITS`, printed behind "What this aid cannot see": no coordinates, no travel time, no separate arrival field, no hours on duty. Tested |
| It does not assign anything | Done (verified) | A suggestion fills the two fields and the dispatcher's own button saves ("fills both fields from a suggestion, and saves only when the dispatcher presses save"); the desk button carries that person's name into the audit entry |
| It says why there is nobody, not just that there is nobody | Done (verified) | With only a bus under maintenance: "No pair can take this run", the reason, and "Nobody free to send" at the desk rather than an empty list |
| Notes are not refusals | Done (verified) | An overdue service and a licence inside the reminder window are printed against the pair and do not block it — the block itself stays the owner's setting (Q-43) |
| Offered only to a role that can act | Done (verified) | The desk suggestion renders for `trips:assign`; a read-only role is not shown a button it cannot press |
| No new command, permission or table | Done (verified) | `commandTypes.ts` unchanged; the aid only reads. Nothing it does can change a record without a person pressing a button |
| Tests | Done (verified) | 13 domain (`planning.test.ts`), 6 screen (`Planning.test.tsx`), and the existing busing and dispatch suites unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **680 passed, 26 skipped**, `build`
succeeds.

## Phase 48 - The bus in the morning, on the rider's own page (PAX-01, D-97)

Every other portal in this build belonged to somebody who already deals with the office. The person who
actually stands at the stop had nothing: "is my seat confirmed?" and "did the bus come?" were answered
by ringing in. This phase gives that person an account, a page and a short list of things it may do —
and the same page is careful about the one thing it cannot say, which is where the bus is.
`docs/DECISIONS.md` D-97 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| A rider can sign in to its own record, and one rider has one account | Done (verified) | `passenger` role, `User.passengerId`, migration `016_passenger_accounts.sql` (the role's check constraint widened, `app_user_passenger_uq`); validateUser refuses a missing rider, an unknown rider, a second account on the same rider, and a rider link on any other role ("refuses a passenger account with no rider, and a second account on the same rider") |
| The payload is one person | Done (verified) | `scopedView`'s passenger branch and the server whitelist: own record, own seats, the runs that carry it, the buses on them, its own feedback. A colleague's name, another client, the register, the money and the audit log are absent — asserted over the serialised payload, not just the arrays ("never sends a colleague, another company, the office's money or the audit log") |
| It fails closed | Done (verified) | An account whose rider record is gone sees nothing, never the company ("fails closed when the linked rider record is gone"; "sends an unlinked passenger nothing") |
| The brief's statuses, each from a record | Done (verified) | `journeyStateOf`: requested, waitlisted, offered, rejected, cancelled (from the booking); seat held, bus assigned, ready to leave, under way, picked up, travelled, not recorded aboard, run cancelled (from the run and its boardings). One test per family, including a cancelled run that keeps its recorded reason |
| Pickup time and location, history, references | Done (verified) | The rider's own stop and the timetable's time on the next-journey card and every row; past runs kept newest first; the booking reference shown where there is one, "on roster" where there is not |
| Asking for a seat, with the reasons for refusal | Done (verified) | `eligibleRunsFor` reads `seatErrors`, `bookingContractProblem` and the request cut-off — the same functions the command runs — and prints each refusal; "tells the rider why a run cannot be asked for, rather than hiding it" |
| A rider may act only on itself | Done (verified) | `create_booking` refuses a seat in a colleague's name; `cancel_booking` refuses somebody else's seat and allows its own, with the rider named in the history ("lets the rider cancel its own seat and refuses a colleague's") |
| Cancelling, inside the office's rules | Done (verified) | `cancellationProblem` refuses a finished or already-running run and honours `cancellationCutoffMinutes`; the button is not offered where the rule would refuse it |
| Feedback goes somewhere a person acts on it | Done (verified) | A report about a journey becomes an incident (`incidents:create`, own runs only), with the run's vehicle substituted for anything the browser sends and `takeVehicleOutOfService` forced off; the rider sees only the reports it raised |
| It does not pretend to track the bus | Done (verified) | `PASSENGER_LIMITS` printed on the screen: no position, a delay only when somebody reported one (Phase 56), times are the timetable's, seats are confirmed by a person. PAX-02 stays deferred |
| Tests | Done (verified) | 20 domain (`passenger.test.ts`), 4 payload (`visibility.test.ts`), 2 screen (`PassengerPortal.test.tsx`); the 680 earlier tests unchanged, and 26 added |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **706 passed, 26 skipped**, `build`
succeeds.

## Phase 49 - The report as a document, printed by the machine that reads it (RPT-05, D-98)

The management report could be read on screen and downloaded as a CSV, which is the right form for
checking arithmetic and the wrong form for a management meeting: nobody reads a spreadsheet aloud.
This phase prints the report as a document, and does it without adding a rendering engine to a
program that has to run on one workstation with no network. `docs/DECISIONS.md` D-98 records the
reasoning.

| Item | Status | Evidence |
|---|---|---|
| The report prints as a document | Done (verified) | `printableReport()` builds the sheet from the two reports already on the screen; the preview reuses the invoice sheet (`rts-sheet`, D-87), and its button calls the browser's print dialog, whose own "Save as PDF" writes the file |
| The paper cannot disagree with the screen | Done (verified) | The document model is fed `RentalReport` and `FinancialReport` and only formats them: "prints the money the reports calculated, and nothing it worked out itself" compares every figure on the sheet with the report's own field |
| Nothing is invented and nothing is silently zero | Done (verified) | With no currency set every amount reads "Not stated" and the page states why ("withholds every amount when no currency is set, and says why on the page"); the counts still print because they are true without a currency |
| A gap is printed as a gap | Done (verified) | Cost per run and cost per passenger print "Not available" with the denominator beside them ("states the count behind every 'not available', so a gap is never read as zero"); an empty table prints the sentence explaining why it is empty |
| The page states its own limits | Done (verified) | Coverage counts and the notes a reader would otherwise have to know: only vehicle hire is invoiced, outstanding is valued at the period end, the currency in use ("carries the coverage counts and the definitions a reader would otherwise assume") |
| The period is written the way a person reads it | Done (verified) | `periodLabel`: "1 – 30 June 2026", "28 May – 4 June 2026", "20 December 2025 – 5 January 2026"; a nonsense date falls back to plain words rather than throwing |
| Identifying the printing | Done (verified) | Reference `RPT-<from>-to-<to>-<YYYYMMDDHHMM>`, the file name is the period, and the page title becomes the document name while the preview is open — that is what "Save as PDF" suggests as a file name |
| A backwards period is not a document | Done (verified) | The sheet says the period is the wrong way round and calls nothing on it a report; the print button is not offered |
| Offered where a reader needs it | Done (verified) | **Print or save as PDF** beside the CSV on Reports; the preview traps focus and closes on Escape like every other overlay |
| Paper rules kept (D-87) | Done (verified) | White with dark ink whatever the theme, money in the monospaced face lined up on the right, the accent used once, sections that fit kept whole and a heading never left alone at the foot of a page (`@media print`) |
| No new command, table, permission or dependency | Done (verified) | It reads the reports the screen already computed; `commandTypes.test.ts` unchanged; `package.json` unchanged |
| Tests | Done (verified) | 10 domain (`printableReport.test.ts`), 3 screen (`Reports.test.tsx`); the existing report, invoice and statement suites unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **719 passed, 26 skipped**, `build`
succeeds.

## Phase 50 - What the buses did, in numbers a client can check (RPT-02, D-99)

The on-time rate has been on the busing screen since Phase 12, but a client review asks more than
that: how many runs were promised and how many were worked, how many riders were actually carried,
who did not appear, where the empty seats are, and what happened to the seats people asked for. None
of those answers existed as one reading. This phase builds the staff-transport report and gives it
its own tab on Reports, because it answers a different question from the hire report over a
different date range. `docs/DECISIONS.md` D-99 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| Runs promised, worked, cancelled and off-schedule | Done (verified) | `staffReport()` counts by **service date**: scheduled (not cancelled), completed, cancelled and ad-hoc, and a route whose only run was cancelled stays on the list with zero worked ("keeps a route whose only run was cancelled, with zero worked") |
| Riders carried, expected and the gap between them | Done (verified) | Carried is a **boarding outcome recorded at the door**, never the roster size; expected is `manifestFor()` (roster plus seats still held); the difference is counted as **not recorded** and named on the card, so a shortfall is never unexplained ("counts runs worked, riders carried, no-shows and the gap nobody recorded") |
| Occupancy is a measurement, not a share of the roster | Done (verified) | Seats offered are the seat capacity of the bus on each worked run; a run with no vehicle contributes no seats and is counted in the coverage ("counts seats offered from the bus that was on the run, so occupancy is a measurement") |
| Delay where it was measured, and nowhere else | Done (verified) | Mean of the positive stop deltas only; an early arrival never cancels a late one out, and no recorded late stop means "Not available" rather than `0 min` ("measures a delay where it was recorded, and never lets an early stop cancel a late one", "says 'not available' for a delay when nothing was recorded late") |
| On-time cannot disagree with the busing screen | Done (verified) | It calls `onTimeReport()` from `kpis.ts` rather than judging again; the threshold is the one snapshotted at completion |
| Seats asked for, by where they stand | Done (verified) | Requested, confirmed, waiting list, offered after a cancellation, refused, cancelled — counted by the **service date of the run**, not the day the request was typed ("counts requests by the day of the run, not the day they were typed") |
| Why seats were lost, in the office's own words | Done (verified) | Grouped by the reason typed on refusal or cancellation, most frequent first, comma-safe in the CSV ("groups the reasons the office recorded for refusing or cancelling a seat") |
| Per route and per client | Done (verified) | Runs worked of scheduled, carried, no-shows, not recorded, seats offered, occupancy by route; routes, carried, no-shows and booked seats by client ("counts a held seat as held, and says which client it belongs to") |
| The report states what it cannot say | Done (verified) | `STAFF_REPORT_LIMITS` and the coverage counts travel with the figures: runs with no vehicle, completed runs with no boarding recorded, stops recorded of stops expected, roster riders with no pickup stop ("names what it cannot say rather than leaving a reader to assume a zero") |
| Three different empty periods | Done (verified) | A backwards range reports nothing and names the mistake; a period with no run says so and still prints the scheduled and cancelled counts; a period whose runs carried nobody is a third, ordinary case ("separates 'nothing ran' from 'nobody travelled'", "refuses a backwards period instead of reporting a slice of time") |
| The same numbers leave the screen | Done (verified) | **Download CSV** writes the report's own fields, quotes a reason containing a comma, and writes "not available" where a rate is null ("exports the same figures, quoting a reason that contains a comma") |
| Two reports, two tabs | Done (verified) | Reports now offers **Hire and money** to every role that may read reports, and **Staff transport** only to a role that may read the employee roster; the server has already withheld the roster from finance, so the tab is not drawn for them (screen tests "is not offered to a role that cannot read the employee roster") |
| No new command, table, permission, dependency or migration | Done (verified) | It reads records the system already keeps; `commandTypes.test.ts` unchanged, `package.json` unchanged, schema still version 20 |
| Tests | Done (verified) | 12 domain (`staffReport.test.ts`), 3 screen (`Reports.test.tsx`); the rental report, financial report and printed sheet suites unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **734 passed, 26 skipped** (66 files
passed, 5 skipped), coverage 82.58 % statements / 86.47 % lines, `build` succeeds.

## Phase 51 - The paper behind the figure, filed where it can be found (Q-51, D-100)

The expense register has held the number printed on a receipt since Phase 42. That is a claim, not
evidence: an auditor asking "show me the receipt" could be given a number and a tick. This phase
files the image itself, with the owner's four answers taken as given — a folder on the office
machine, three years, a nightly copy the office runs, and finance and administrators only.
`docs/DECISIONS.md` D-100 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| A scan can be filed against an expense | Done (verified) | **File scan** on the row, a panel that takes the file, and the row written by the domain: "files a scan against the expense and keeps who filed it", "saves the bytes, then asks the domain to index them, and hands back the new snapshot" |
| The image lives outside the database | Done (verified) | `RECEIPT_DIR` or `data/receipts`; one file per scan, named by the server. The row is the index: expense, file name, type, size, SHA-256, who filed it (`receiptStore.test.ts` writes real files to a temporary folder) |
| A name a person typed never becomes a path | Done (verified) | Stored as `rcpt_<36 hex>.<ext>`; the original name is kept to be shown. Reads are checked against the same shape ("refuses to read anything outside the folder, whatever the row says", "refuses a stored name the server would not have written") |
| The type comes from the bytes, not the browser | Done (verified) | PDF/JPEG/PNG/WebP signatures; a web page wearing a `.jpg` name is refused, and nothing is written ("refuses anything else, including a web page wearing an image name", "refuses a web page wearing an image name, and writes nothing") |
| Two megabytes, said in words | Done (verified) | The panel names the ceiling and refuses an oversized file before it is sent ("refuses a file that is too large before it is sent"); the route refuses at the boundary; the database holds the same limit as a check constraint |
| Finance and administrators only | Done (verified) | `receipts:read` / `receipts:write`, separate from `expenses:read`; the route checks the role in the database before reading the disk ("refuses operations, whose role may read costs but not the supplier's paper", "refuses operations the image, even with its id"). Operations receives not even the file names (`src/server/visibility.ts`) |
| The file and the row are written together | Done (verified) | `attach_receipt` is in neither the browser's command union nor the route's allow-list; the route deletes the file again when the domain refuses the row ("deletes the file again when the domain refuses the row", `commandTypes.test.ts`) |
| One scan on file, and nothing deleted | Done (verified) | Partial unique index on `(expense_id) where status = 'attached'`; a replacement marks the old row removed and points at its successor; removal needs a reason and records the person ("replaces an earlier scan rather than sitting beside it…", "keeps the row, its file name and the reason it went", "will not remove the same scan twice") |
| A voided expense takes no paper | Done (verified) | Evidence would attach to a figure no report counts ("refuses paper against a voided expense") |
| The register counts its own gaps | Done (verified) | **No scan on file** for the period beside the receipt-number count; the gap is visible before an audit finds it ("offers to file a scan, and opens the one already on file") |
| Opening a scan is a server check, not a hidden button | Done (verified) | `GET /api/receipts/[id]`: session, then `receipts:read`, then the folder. `no-store`, `nosniff`, and a filename stripped of quotes ("is served to finance under the name it arrived with, and never cached") |
| A folder and an index that disagree is said plainly | Done (verified) | A missing file is a 404 that says to restore the folder from the backup, not a 500 or an empty document ("tells the operator when the index and the folder disagree") |
| The rules are on the screen, not in a guide only | Done (verified) | The panel says where the file goes, that it is kept three years, that the office copies it nightly, and who may open it ("files the scan through the upload method, and says where the file goes first") |
| Migration and schema | Done (verified) | `017_receipt_scans.sql`: the table, the partial unique index, a deferred self-reference so a replacement can be written in one transaction, a frozen-row trigger and a no-delete trigger; `SCHEMA_VERSION` 21, `READABLE_SCHEMA_VERSIONS` extended |
| Tests | Done (verified) | 13 domain (`receipts.test.ts`), 14 store (`receiptStore.test.ts`), 9 route (`src/app/api/receipts/route.test.ts`), 4 screen (`Expenses.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **775 passed, 26 skipped** (69 files
passed, 5 skipped), coverage 82.57 % statements / 86.41 % lines, `build` succeeds.

## Phase 52 - The customer record a document needs (CUS-01, D-101)

The client register was a name, a third-party contact and a status. That is enough to ring someone
and not enough to bill them: an invoice printed a company's name and nothing else, no address and no
tax number, so a customer who needed the tax could not claim it off the document they were given.
This phase fills the record out — and copies what it fills onto each invoice at the moment it is
issued, so the document cannot be rewritten afterwards. `docs/DECISIONS.md` D-101 records the
reasoning.

| Item | Status | Evidence |
|---|---|---|
| The office's own customer code | Done (verified) | Optional, up to 40 characters, unique when given, compared ignoring case and spacing ("refuses a second customer with the same code, whatever the case or spacing"). Not generated: a code the office already uses is more useful than one this program invents |
| Organisation or individual | Done (verified) | `CLIENT_TYPES`, nullable. A blank is stored as blank and shown as "type not recorded", because inventing "organisation" for every existing customer would be a fact nobody stated ("lets a customer be added with no code and no classification…", "reads an older backup without inventing a classification for every customer") |
| Billing details that a document can print | Done (verified) | Billing address (300 characters) and tax identification number (4–30 letters, digits, spaces, hyphens; stored upper-case so the same number typed twice compares equal) ("refuses a classification it does not have, and a tax number that is not one") |
| Notes and a history | Done (verified) | A note of up to 500 characters, and a **History** panel per customer read from the audit log with the person and the day of each change — read-only, because history is written by the change itself ("shows the changes recorded against a customer, newest first") |
| The invoice keeps what it was issued with | Done (verified) | `buyerAddress` and `buyerTin` are **copied** onto the invoice at issue, and the sheet prints them under "Billed to". Editing the customer afterwards changes the register, never the document ("copies the address and tax number onto the invoice when it is issued", "does not rewrite an issued invoice when the customer later moves") |
| A walk-in customer is not broken by any of it | Done (verified) | No client record means no buyer details, and the sheet prints exactly what it printed before — no empty label, no placeholder ("prints nothing for a walk-in customer who has no register record", "prints no buyer details at all when the invoice was issued to a walk-in customer") |
| Migration and schema | Done (verified) | `018_customer_details.sql`: five `client` columns with a nullable type check and a partial unique index on the trimmed, lower-cased code; two `invoice` columns; every added column defaults to empty, so an existing row is valid without being touched. `SCHEMA_VERSION` 22, `READABLE_SCHEMA_VERSIONS` extended |
| CSV import carries the new columns | Done (verified) | The clients file accepts code, type, billing address and tax number as optional columns; a blank cell stays blank rather than becoming a guess, and a type that is neither word is refused by line ("names the line whose type column is neither organisation nor individual"). The import still runs the same command a person would |
| No new permission | Done (verified) | `clients:read`, `clients:create` and `clients:update` already covered it; a billing address is part of the customer record, not a new kind of secret |
| Tests | Done (verified) | 9 domain (`clientDetails.test.ts`), 2 import, 3 screen on the register, 2 on the invoice sheet; the existing register, invoice, statement and finance suites unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **819 passed, 28 skipped** (71 files
passed, 5 skipped), coverage 83.03 % statements / 86.85 % lines, `build` succeeds.

## Phase 53 - The customer as a company, with places and an agreement (CLI-01, D-102)

CUS-01 gave a customer the details a document prints. This phase makes the record describe the
business itself: the certificate it was registered on, the offices it works from, and whether there
is an agreement in force. `docs/DECISIONS.md` D-102 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| Registration details, when supplied | Done (verified) | `registrationNumber` and `registeredOn` on `Client`, both optional and blank on a customer who never gave them. The number is kept exactly as typed (offices punctuate their own certificates); the date must be a real day and cannot be in the future ("refuses a day that is not a day, and a registration dated in the future") |
| Branches and office locations | Done (verified) | New collection `clientLocations` and its own table (`019_client_locations.sql`): a named place under one customer, with an address, a person and a phone. One name per customer, compared ignoring case and spacing, enforced by the database as well as the form ("refuses a second branch with the same name under the same customer, whatever the spacing") |
| A closed branch is kept, not deleted | Done (verified) | `status` open/closed. The address survives, because the runs and documents that named that office are still on file and outlive it ("keeps a closed branch, with its address, rather than deleting it") |
| Contract status on the record | Done (verified) | The row states the agreement in force, or *no agreement on file*, read from `db.contracts` through `clientAgreementLine` — never stored on the customer, so it cannot go stale. An agreement that has run out reads *expired*, and an open-ended one says so ("says whether there is an agreement, and names the one in force") |
| Notes, history, contact and billing | Done (verified) | Carried from CUS-01: the note, the per-customer **History** panel, and the billing details printed on the invoice as issued |
| Who may do it | Done (verified) | No new permission: branches use `clients:create`/`clients:update`, so operations can read the client book and neither add a branch nor change one ("is closed to a role that may read the client book but not change it") |
| The portal sees its own offices only | Done (verified) | The snapshot gives a client contact its own branches and no other customer's, and a driver none ("gives a client contact its own branches and no other customer's") |
| Old data | Done (verified) | Schema 23: an older backup gains an empty branch list and blank certificate fields — nothing invented ("leaves both blank on a customer who never supplied one, and on an older record") |
| Tests | Done (verified) | 12 domain (`clients.test.ts`), 8 command (`clientDetails.test.ts`), 5 screen (`Registers.test.tsx`), 1 payload (`visibility.test.ts`), 2 PostgreSQL (`repository.integration.test.ts`, CI only) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **818 passed, 26 skipped** (71 files
passed, 5 skipped), `build` succeeds.

## Phase 54 - What the licence actually allows (FLT-04, D-103)

Dispatch checked one thing about a driver's licence: that it had not expired. Nothing checked what
the licence allowed, so a driver licensed for a small car could be signed to a 45-seat coach and the
system reported the licence as in order. `docs/DECISIONS.md` D-103 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| The classes printed on the licence | Done (verified) | `licenceClasses` on the driver, upper-cased so "c" and "C" are one class, up to 8 entries; a blank is "class not recorded" ("splits what a person typed and upper-cases it, because that is how it is printed", "does not turn one class into two by case, a stray space or a repeated entry") |
| A category can say what may drive it | Done (verified) | `licenceClasses` on each vehicle category in Settings, beside its name: "licence classes that may drive it". Left blank, the category checks nothing |
| Dispatch refuses a licence that does not cover the vehicle | Done (verified) | Checked on both paths that put a driver with a vehicle: the trip assignment (`assessResources`) and the hire (`assign_rental`). Refused with both classes named ("refuses a driver licensed for another class, and names both", "refuses a hire to a driver whose licence does not cover the vehicle") |
| A blank class fails closed, and says why | Done (verified) | Once a category names a class, a driver whose class is unrecorded is refused with the fix in the sentence — "the class was never written down" is not "we checked and it is fine" ("refuses a blank class rather than treating it as permission, and says what to do") |
| The planning aid agrees with the save | Done (verified) | The aid asks the same function the save does, so it never offers a pair the save would refuse ("agrees with the save about a driver whose licence does not cover the bus") |
| Qualifications | Done (verified) | Recorded and shown ("PSV", "Defensive driving"), from the office's own wording. **Not enforced**: which job needs which certificate is Q-52, and inventing an answer would refuse work the office never said was refused |
| Availability | Done (verified) | Shown on the row as *free today*, *on TR-0001 (Northstar morning) today* or *on hire RR-0007 today*, derived from live trips and hires; a completed run or another day's does not count ("does not keep a driver busy with a run that already finished or is another day's") |
| Import and old data | Done (verified) | The drivers CSV gains optional `licence classes` and `qualifications` columns, a blank staying blank ("carries a driver's licence classes and qualifications from the file"). Schema 24: every existing driver has an empty list and every existing category checks nothing |
| The public form learns nothing new | Done (verified) | The enquiry endpoint still sends only each category's id and name; a test now asserts the licence classes do not travel to it |
| Tests | Done (verified) | 20 domain (`driving.test.ts`), 1 planning-aid (`planning.test.ts`), 5 screen (`Registers.test.tsx`), 1 import (`import.test.ts`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **846 passed, 28 skipped** (72 files
passed, 5 skipped), coverage 83.83 % statements / 87.66 % lines, `build` succeeds.

## Phase 55 - Where the stop actually is (RTE-01, D-104)

A stop was a name and a time. "Estate gate, 06:15" tells a driver who already knows the estate where
to go; it does not help the relief driver on their first morning, and it cannot be typed into a
phone. `docs/DECISIONS.md` D-104 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| A landmark | Done (verified) | `landmark` on every stop, up to 200 characters — "behind the Total filling station", "the blue wall after the bridge" ("keeps a landmark, a digital address and a position, and tidies what was typed") |
| The Ghana Post GPS address | Done (verified) | Optional, stored upper-case, checked for shape (`GA-123-4567`, `AK-039-5028`). A mistyped code is refused by stop number rather than saved, because a driver follows it somewhere else ("refuses an address that is not a Ghana Post GPS address", "refuses a bad address by stop number rather than saving it") |
| Coordinates | Done (verified) | Optional decimal degrees, six places at most, inside the world, and **refused one without the other** — half a position puts a pin in the sea and a driver believes it ("refuses half a position, because a driver would believe it") |
| The driver sees them | Done (verified) | The run row on the driver's screen says the next stop, its time, its directions or *no directions recorded*, and offers **Open in maps** when there is a position. The stop form repeats the directions above the boarding fields, so the driver can check the place before marking anybody as a no-show ("offers a map link when the stop has a position", "says the directions are missing rather than leaving the panel empty") |
| The customer and the rider see the landmark, not the coordinates | Done (verified) | The client portal lists each route's stops with their landmark and address; the rider's portal shows the directions for their own pickup. Coordinates stay in the office: they are how the map link is built, not a fact for the portal |
| A wrong landmark stays correctable | Done (verified) | Once trips exist the stop name, time and order are locked so recorded runs keep pointing at stops that exist — but the directions are **not** part of that identity, or a typo would follow the driver for the life of the route ("still lets a wrong landmark be corrected once trips exist", "still refuses to change a stop's name or time once trips exist") |
| The gap is counted, not hidden | Done (verified) | The routes screen shows "2 of 3 without directions" beside the stop count ("counts the stops nobody has described rather than calling the route complete") |
| Old routes | Done (verified) | Schema 25. A route written before this phase gains blank directions and keeps working; nothing is invented ("reads an older backup with blank directions rather than a broken route") |
| Tests | Done (verified) | 15 domain (`stops.test.ts`), 3 stop form (`TripStopForm.test.tsx`), 1 screen (`Busing.test.tsx`) |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **865 passed, 28 skipped** (73 files
passed, 5 skipped), coverage 83.86 % statements / 87.68 % lines, `build` succeeds.

## Phase 56 - A run that is late, said out loud (DSP-04, D-105)

The stop times already measured lateness after the fact. What was missing was the fact the office
needs *during* the run: the 07:20 phone call from a client whose staff are still standing at the
gate. `docs/DECISIONS.md` D-105 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| Report a delay on a run that is out | Done (verified) | `record_trip_delay`: minutes behind the timetable, why, when and by whom, appended to the run. Refused on a planned or finished run ("refuses a run that has not left, and one that has finished") |
| The newest statement is the current one, and nothing is rewritten | Done (verified) | "is append-only: a second report is kept beside the first, and the newest is what counts"; `liveDelay` reads the last entry only |
| A run can catch up | Done (verified) | `0` minutes records "back on time", and only once a delay exists, so the history cannot be padded ("refuses '0' until something has been reported late"; "is nothing once a later report says the run caught up") |
| Whole minutes, a real ceiling, a compulsory reason | Done (verified) | `readDelayInput`: empty is not zero, `12.5` and `twenty` are refused, 600 is the ceiling and says to cancel instead, and the reason is required ("takes whole minutes and the reason, trimmed", "refuses a delay longer than the ceiling") |
| The dispatch desk sees it | Done (verified) | The run row carries the sentence ("18 minutes late — Traffic at the Spintex junction") and the desk counts what is behind schedule ("1 run behind schedule") |
| The driver can report it from their own screen | Done (verified) | A "Running late" control beside the sentence it produces, own-run only; a driver cannot report on another driver's run ("lets the driver report the delay on their own run, and nobody else's") |
| The client reads it instead of ringing | Done (verified) | A "Today's runs" card in the client portal, with the delay as a full sentence ("tells the client which of its runs is late, and why") |
| The rider reads it in the same breath as the run's state | Done (verified) | `journeyStateOf` appends the sentence after the seat's own news, and the portal's list of its limits now says a delay shows only when somebody reported one ("adds the delay to what the run says, keeping the run's own story first") |
| An interruption is already covered | Done (verified) | A run stopped mid-way is cancelled with its reason, keeping the stops and outcomes already recorded and linking the incident that caused it (Q-47, D-75); a run held up and then continuing is a delay plus its stop times |
| Old runs | Done (verified) | Schema 26. A run written before this phase gains an empty history ("a run written before delays existed") |
| Tests | Done (verified) | 16 domain (`delays.test.ts`), 8 service (`busing.test.ts`), 4 form (`TripDelayForm.test.tsx`), 2 portals (`Portals.test.tsx`), 1 dispatch screen (`Busing.test.tsx`), 3 rider states (`passenger.test.ts`) — 33 in all |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **899 passed, 28 skipped** (75 files passed, 5 skipped), coverage 84.00 % statements / 87.79 % lines, `build` succeeds.

## Phase 57 - What the fleet register was not saying about the vehicle (FLT-01)

The register knew a registration, a category, a seat count and a status. It did not know what the bus
runs on, whether it is ours, whose it is if it is not, or which driver habitually takes it out. Those
are the questions a dispatcher asks when fuel is bought, when a leased bus is withdrawn, or when the
same driver keeps reporting the same fault. `docs/DECISIONS.md` D-107 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| Fuel type | Done (verified) | Free text in the office's own words, trimmed, capped at 30 characters ("takes fuel in the office's own words, trimmed, and keeps it short") |
| Ownership, and the lessor when it is not ours | Done (verified) | `owned`, `leased` or `hire purchase`, **null when nobody has recorded it — never assumed to be ours**, and a leased or hire-purchase vehicle must name its owner ("keeps an unrecorded ownership unrecorded, rather than calling it ours", "makes a leased or hire-purchase vehicle name its owner") |
| An owner on a vehicle that is ours is refused, not stored invisibly | Done (verified) | "refuses an owner on a vehicle that is ours, instead of storing a name nobody will see" |
| The usual driver | Done (verified) | A driver already on the register and not inactive; a habit, not an assignment, and nothing in dispatch reads it ("requires the usual driver to be a driver on the register, and one who still works here") |
| The register shows them | Done (verified) | The row prints "Diesel · Leased from Ama Transport" under the make and model, names the usual driver (and marks one who is no longer active), and says "fuel and ownership not recorded" rather than leaving a blank ("prints the fuel and the ownership under the make and model", "names the usual driver, and marks one who is no longer active") |
| The gaps are counted | Done (verified) | "1 with no fuel type · 1 with no ownership of 2", retired vehicles excluded ("counts the live vehicles with no fuel type and no ownership") |
| The form asks for them | Done (verified) | A "The vehicle itself" section; the owner box appears only once the vehicle is not ours, and the whole section may be left blank ("offers fuel, ownership and the usual driver when adding a vehicle, and sends them") |
| A spreadsheet carries them | Done (verified) | CSV columns `fuel`, `ownership`, `owner`; "Lease" is read as leased; an unreadable ownership and a lease with no owner are row errors naming the line ("carries fuel, ownership and the owner from the file", "names the line whose ownership nobody can read") |
| Old records | Done (verified) | Schema 27. A vehicle written before this phase gains blanks and a null ownership ("gains blanks and a null ownership rather than claiming the fleet is ours") |
| Tests | Done (verified) | 17 domain (`vehicles.test.ts`), 7 register screen (`Registers.test.tsx`), 4 importer (`import.test.ts`) — 28 new, and every existing suite unchanged and green |

*The vehicle's photograph, the fourth fact the brief lists, is a file and was built immediately after
this phase — Phase 58.*

Gates after this phase: `typecheck` clean, `lint` clean, `test` **927 passed, 28 skipped** (76 files
passed, 5 skipped), coverage 84.24 % statements / 88.02 % lines, `build` succeeds.

## Phase 58 - The photograph of the vehicle (FLT-01, D-108)

The last of the four facts the brief lists. It is the one that answers "is this the bus in front of
me?", and it is also the only fact about a vehicle that is a *file*: where it lives, what it is really
called, who may open it, and what is left behind when it is taken off. `docs/DECISIONS.md` D-108
records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| One photograph per vehicle, and a new one replaces it | Done (verified) | `attach_vehicle_photo` writes the same field; the audit entry names both files ("replaces the one on file rather than keeping two pictures of the same bus") |
| The file is kept in a folder the server names | Done (verified) | `VEHICLE_PHOTO_DIR`, or `data/vehicle-photos`; stored as `vhcl_<36 hex>.<ext>`, written `0600` into a `0700` folder, and the name the phone gave it is only ever a label ("writes a name of its own, never the one the phone gave it") |
| Only a picture, and only from the bytes | Done (verified) | Sniffed with the receipt store's `sniffType`; JPEG, PNG and WebP accepted, a PDF or a web page wearing `.jpg` refused and nothing written ("decides the type from the bytes, so a PDF wearing .jpg is a PDF — and is refused here") |
| A 2 MB ceiling, and a file that is not empty | Done (verified) | "refuses a web page, an empty file and anything over the ceiling, writing nothing" |
| A refused row leaves no file behind | Done (verified) | The route saves, then indexes, and deletes what it wrote when the domain refuses ("deletes the file again when the domain refuses the row") |
| Taking it off needs a reason, and the file stays | Done (verified) | `remove_vehicle_photo`: the sentence is in the audit log, the index is cleared, the bytes remain ("takes it off with a reason, and leaves the audit trail behind") |
| Filing goes through its own route; removing does not | Done (verified) | `attach_vehicle_photo` is browser-forbidden and has its own route, because the row may only be written once the bytes are on the disk; `remove_vehicle_photo` touches no file ("keeps the file-filing command off the browser's list") |
| Only an office role may file one | Done (verified) | `vehicles:update`; a driver and finance are refused at the domain and at the route, and nothing is written ("is vehicles:update — a driver cannot file one, and neither can finance", "refuses finance, whose role reads the fleet but does not maintain it") |
| Opening one is a checked request, not a file path | Done (verified) | `GET /api/vehicle-photo/[id]`: session, `vehicles:read`, a second own-record gate, `nosniff`, `no-store`, and a sanitised inline name ("serves the bytes to a role that may read the fleet", "strips quotes, newlines and separators out of the download name") |
| A missing file is said plainly | Done (verified) | "says the folder and the register disagree when the file has gone, rather than serving an empty image" |
| The register shows the picture, and counts the buses nobody photographed | Done (verified) | A thumbnail column with "none" where there is nothing (never a broken image), and "N with no photograph" beside the other gaps ("says 'none' where there is no photograph", "counts the buses nobody has photographed beside the other gaps") |
| The panel files, replaces and removes | Done (verified) | "files the chosen picture through the photograph route", "shows the picture on file with its name, size and who filed it, and will not take it off without a reason" |
| Old records | Done (verified) | Schema 28. A vehicle written before this phase reads as having no photograph ("reads a vehicle with no photograph as having none"), and one that already has a photograph keeps it |
| Tests | Done (verified) | 14 domain (`vehiclePhoto.test.ts`), 7 store (`vehiclePhotoStore.test.ts`), 13 route (7 filing, 6 opening), 7 register screen (`Registers.test.tsx`) — 41 new, and every existing suite unchanged and green |

**A bug the tests caught.** The panel that renders the add/edit form keyed off "not the transition
panel and not the import panel", so opening the photograph panel opened an "Add vehicle" form behind it
— two dialogs, two places to type, and nothing on screen to say which one a keystroke would reach. The
block now names the two modes it serves.

Gates after this phase: `typecheck` clean, `lint` clean, `test` **968 passed, 28 skipped** (80 files
passed, 5 skipped), coverage 84.18 % statements / 87.93 % lines, `build` succeeds.

## Phase 59 - Seven states for a vehicle, four of them read from the records (FLT-02, D-109)

The register held four statuses: available, in the workshop, off the road, retired. They answer "is
anything wrong with this bus?". The brief's seven states also have to answer "can I put it on a run this
afternoon?". Three of the seven were never stored and should not be: Reserved, Assigned and On Trip are
facts the runs and hires already hold. `docs/DECISIONS.md` D-109 records the reasoning.

| Item | Status | Evidence |
|---|---|---|
| Available | Done (verified) | Nothing wrong and nothing on the day holding it ("is Available, and says why in plain words") |
| Reserved | Done (verified) | A run planned with the vehicle, or a confirmed hire covering the day that has not started ("is Reserved while a run on the day is only planned", "is Reserved while a hire covering the day has not started") |
| Assigned | Done (verified) | A run dispatched with a crew, naming the driver ("is Assigned once the run is dispatched, and names the crew") |
| On trip | Done (verified) | A run or hire in progress; a completed run frees the bus ("is On Trip once the run has started…") |
| Under maintenance | Done (verified) | Any work order open, in progress or on hold, or the office's word with no work order ("is Under maintenance while a work order is open, in progress or on hold") |
| Pending inspection | Done (verified) | A repair finished and nobody has released it — the state the register never had ("is Pending inspection once the repair is finished and not released", "is free again once the work order is released") |
| Out of service | Done (verified) | The office's decision, which outranks every commitment ("is Out of service whatever the run sheet says, and says which run is stranded") |
| Retired | Done (verified) | Final, and evicts every other state ("is Retired for good, even with a hire still attached to it") |
| The rule for each state | Done (verified) | Printed under the register in a disclosure, from `FLEET_STATE_RULES` ("prints the rule behind each state, so the desk can read why"), and tabulated in `STATE_MACHINES.md` |
| A broken plan is named, not hidden | Done (verified) | A bus in the workshop that still holds today's run says so in the same cell ("names the run a broken bus is still holding, rather than hiding it", "warns when a bus in the workshop is still on today's run sheet") |
| The fleet counted by state | Done (verified) | "1 available · 1 on trip · 1 pending inspection of 3" beside the search box, retired vehicles counted separately ("counts the fleet by state rather than only by the office's word") |
| The filter spans both vocabularies | Done (verified) | Filtering by Pending inspection finds a bus the register still calls Under maintenance ("filters by the state the records give, not only by the stored word") |
| A free bus says when it is next taken | Done (verified) | `nextCommitmentOf` in the status panel ("is not held today by a hire that starts tomorrow — but says when it is next spoken for", "explains the difference between the two vocabularies when changing the office's word") |
| Nothing to migrate | Done (verified) | Schema 28 unchanged: every input already exists in the database, and a stored copy is what this phase argues against |
| Tests | Done (verified) | 25 domain (`fleetState.test.ts`), 10 register screen (`Registers.test.tsx`) — 35 new, and every existing suite unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1003 passed, 28 skipped** (81 files
passed, 5 skipped), coverage 84.30 % statements / 88.07 % lines, `build` succeeds.

## Phase 60 - The papers that run out, and who is dealing with them (FLT-03, D-110)

The compliance register knew every expiry date and blocked a vehicle or driver whose mandatory paper had
lapsed. What it could not do was say so *before* it happened — and it could not send anything, because
there is no mail or SMS provider. `docs/DECISIONS.md` D-110 records what was built instead: a reminder
that is a record of somebody taking the renewal on, not a message.

| Item | Status | Evidence |
|---|---|---|
| Expiry dates and a configurable lead time | Done (verified, already in place) | `documentStatus` against `settings.documentReminderLeadDays`; the register has flagged expired and expiring-since Phase 6, and a paper may be marked required so a lapse blocks assignment (Phase 26, D-76) |
| A list of what needs renewing | Done (verified) | A **Renewals** card on the compliance screen, lapsed papers first, each with the owner, the date and how long is left ("lists a paper that lapses soon and says nobody has taken it on", "puts a lapsed paper first and calls it so") |
| Somebody takes the renewal on | Done (verified) | `acknowledge_document_reminder`: who, when, what they are doing, and the date they expect the new paper, all in the audit log ("records who took it on, what they are doing, and when they expect the paper") |
| A reminder cannot be silenced by a renewal that was typed wrongly | Done (verified) | The acknowledgement stores the expiry date it was given against; a corrected date re-raises it ("comes back when the paper is renewed to a new date that is still too close") |
| A paper nobody has to think about yet cannot be taken on | Done (verified) | "refuses a paper nobody has to think about yet, and names the date", "with no lead time set, refuses anything that has not expired — and says why" |
| A note is required, and the expected date must be real | Done (verified) | "needs a note, and a date that has not already passed" |
| Nothing is erased when a second person takes it on | Done (verified) | Append-only; the audit summary names the acknowledgement it replaced ("keeps the earlier acknowledgement when somebody else takes it on") |
| `documents:update` | Done (verified) | "is documents:update — a driver cannot take a renewal on, and neither can a stranger's id" |
| The reminder reaches the board | Done (verified) | The dashboard's "needs attention" list names the papers nobody has taken on, with how long is left, and links to the register ("names the papers nobody has taken on, with how long is left", "takes a paper off the list once somebody has taken it on") |
| The screen is honest about what it is | Done (verified) | The panel says this program cannot send an email or a text message; the card says when no lead time is set ("explains that a reminder here is a record, because this program cannot send one", "with no lead time set, shows only what has lapsed and says why") |
| Old records | Done (verified) | Schema 29. A snapshot written before it has nobody having taken any renewal on, which is what the reminders should say |
| Sending the message itself | **Deferred, and named** | Needs a mail or SMS provider (Phase 2). When one arrives it can send what this records; it cannot invent the record |
| Tests | Done (verified) | 11 domain (`documentReminders.test.ts`), 8 command (`compliance.test.ts`), 9 screen (`ComplianceRenewals.test.tsx`), 4 board (`Dashboard.test.tsx`) — 32 new, and every existing suite unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1035 passed, 28 skipped** (83 files
passed, 5 skipped), coverage 84.44 % statements / 88.16 % lines, `build` succeeds.

## Phase 61 - A number can be copied instead of typed (D-111)

A small piece taken from a review of the `uselayouts` component library, and the only piece: the
library's animated, gradient and 3D components were rejected as contrary to the Daylight interface.
What was worth having was the idea that a reference on a screen should be easy to move somewhere else.

| Item | Status | Evidence |
|---|---|---|
| A reference can be copied | Done (verified) | A **Copy** button beside the invoice number on the open invoice, the rental reference on the request, the run reference on each run card, and the receipt number on an expense row ("offers the reference from the open request and puts it on the clipboard", "offers the number from the open invoice and says when it has copied it", "offers the run's reference so the office can paste it rather than read it out", "offers the receipt number from the row, and copies the number as typed") |
| Copying is confirmed in words | Done (verified) | The button reads "Copied" for four seconds and a `role="status"` line names the reference; the accessible name never changes ("puts the reference on the clipboard and says so", "goes back to 'Copy' after a few seconds") |
| Works where the browser has no Clipboard API | Done (verified) | A selected textarea fallback, removed afterwards ("falls back to selecting the text when the Clipboard API is missing") |
| Says so when it cannot copy | Done (verified) | "Not copied", with a sentence a person can act on ("says the browser would not copy it, rather than pretending it did") |
| Nothing invented | Done (verified) | A statement has no reference of its own and gets no button; an expense with no receipt number has nothing to copy ("offers nothing to copy where the expense has no receipt number") |
| No new dependency, no server or schema change | Done (verified) | `src/ui/CopyButton.tsx` and two CSS rules; `package.json` unchanged at 13 runtime dependencies; schema stays 29 |
| Tests | Done (verified) | 5 on the button (`CopyButton.test.tsx`), 1 on the invoice, 1 on the rental, 1 on the run card, 2 on the receipt — 10 new, every existing suite unchanged and green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1045 passed, 28 skipped** (85 files
passed, 5 skipped), coverage 84.47 % statements / 88.2 % lines, `build` succeeds.

## Phase 62 - What the fleet had, did, and cost by standing still (FLT-05, D-112)

The register could say what each bus is doing today, and the compliance screen could say which papers
are lapsing. Neither could answer the owner's question over a period: how much of the fleet worked,
how many days were downtime, and what did standing still cost. `docs/DECISIONS.md` D-112 records how
each figure is measured; the short version is that everything is counted in **vehicle-days** from
records that already exist, the headline utilisation is the definition management approved in Phase 28
rather than a new one, and the money only appears once somebody states what a standing vehicle costs.

| Item | Status | Evidence |
|---|---|---|
| Totals, and the fleet's state today | Done (verified) | `fleetStateCounts` — the same call the vehicles register makes — printed as eight states with counts, plus vehicles in service and retired ("reads today from the same function the register uses") |
| Availability, assigned, on trip, maintenance, pending inspection | Done (verified) | The eight-state band on the dashboard, and the per-vehicle table beneath it; the states themselves were built in Phase 59 (D-109) |
| Utilisation over a period | Done (verified) | The approved figure — committed vehicle-days ÷ available vehicle-days — printed with both numbers in the caption ("states the approved utilisation: committed vehicle-days over the fleet in service") |
| Days actually worked | Done (verified) | A second, stricter figure beside it, over the days a vehicle was ours and not in the workshop ("states the stricter measure beside it: days actually worked, not merely committed") |
| Downtime | Done (verified) | Work-order days counted from the day the order was raised to the day it was released, including repairs finished and not released ("treats a repair that is finished but not released as downtime") |
| Idle days and idle cost | Done (verified) | Idle days counted per vehicle and in total; cost = idle days × `settings.fleetStandingCostPerDay`, which has no default ("puts no money on an idle day until the company supplies a daily cost", "prices the idle days when the standing cost is set") |
| Nothing invented | Done (verified) | No assumed hourly figure, no assumed daily cost, no prorated denominator passed off as the approved one; a retired vehicle is excluded and counted as excluded ("leaves a retired vehicle out of every day, and says how many", "states what the records cannot say, rather than leaving a silent gap") |
| The period is one somebody can read | Done (verified) | This month to date by default, a from/to pair, the previous period of the same length quoted beneath, and a backwards range refused rather than shown as zeros ("refuses a period that runs backwards instead of rendering zeros") |
| Settings validate the cost | Done (verified) | Negative, three-decimal and absurd figures refused with a sentence; blank stays blank ("keeps a standing cost per vehicle-day as a money figure, or keeps it blank", "is blank until management supplies it, then saves as the amount typed") |
| Old records | Done (verified) | Schema 30, no SQL migration: a backup written before this has no standing cost, so no idle day is priced until somebody sets one ("has no standing cost, so no idle day is priced until somebody sets one") |
| Tests | Done (verified) | 21 in `fleetReport.test.ts` (19 domain, 2 migration), 1 settings command (`service.test.ts`), 8 screen (`Fleet.test.tsx`), 1 settings screen (`Settings.test.tsx`) — 31 new, every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1076 passed, 28 skipped** (87 files
passed, 5 skipped), coverage 84.76 % statements / 88.44 % lines, `build` succeeds.

## Phase 63 - Every screen that totals something can hand it to a spreadsheet (RPT-04, D-113)

The brief's reporting item asks for filters and CSV. Three forms of export already existed; three
screens that total money or days had none, and the three existing writers had drifted apart. This
phase put one writer and one download in place, moved the existing exports onto them, and gave the
finance home, a customer's statement and the fleet dashboard a Download CSV that is the screen's own
numbers written out.

| Item | Status | Evidence |
|---|---|---|
| One CSV writer, with quoting | Done (verified) | `src/tms/csv.ts`; a comma, a quote and a line break are handled, and the three report exports now use it with their output unchanged ("quotes a comma, a quote or a line break, and doubles the quote", "joins cells with commas and rows with newlines") |
| A cell a spreadsheet would run is defused | Done (verified) | Text beginning `=`, `+`, `-` or `@` is prefixed with an apostrophe; numbers are left alone ("defuses text a spreadsheet would run as a formula", "does not defuse a number, because a negative amount is a number") |
| One download helper | Done (verified) | `src/ui/download.ts`: object URL, anchor named for the file, URL released, the anchor removed ("names the file, clicks an anchor for it, and releases the URL") |
| The finance home exports its figures, debt bands and open work | Done (verified) | `financeHomeCsv`, with a heading for every block, "none" where a block is empty and the reason a withheld margin was withheld ("writes each block with its heading, and says none rather than leaving an empty block", "says why the margin is withheld instead of leaving the row blank") |
| A customer's statement exports the same rows the sheet prints | Done (verified) | `statementCsv`, opening and closing balances, every row with its running balance, the open invoices and the ageing ("writes the same rows the sheet prints, in the same order, with the balance after each") |
| The fleet dashboard exports the figures and the per-vehicle rows | Done (verified) | `fleetReportCsv` ("writes the figures and then one row per vehicle", "writes the money once somebody has supplied the standing cost") |
| Nothing leaves the machine | Done (verified) | Built in the browser from the narrowed payload; no export route, no stored file, no email |
| A statement still prints as a sheet | Done (verified) | The CSV is offered beside Print statement; the document is unchanged |
| The filters half of the item | **Still partial, and said so** | The register names a bar for service, client, customer, route, driver and vehicle. It does not exist, because a filtered report needs its own definition of every KPI rather than quietly narrowing the company figure |
| The buttons | Done (verified) | Download CSV on the finance home, the statement and the fleet dashboard, disabled where there is nothing to export ("downloads the same rows the sheet prints, named for the customer and the period", "offers nothing to download when there is no fleet", "downloads the figures, the debt bands and the open work, named for the period") |
| The expenses screen exports its period, its categories and every entry | Done (verified) | `expensesCsv`, handed the screen's own figures so the file cannot disagree with the page; a voided entry is listed and counted in nothing, and an entry with no receipt number or no scan says so ("writes the period's figures, the categories and every entry", "says none rather than ending a block silently, and keeps the weak receipt facts visible", "offers nothing to download for a period with no entries") |
| Tests | Done (verified) | 25 new: 7 on the writer, 3 on the download helper, 9 on the four export builders and 6 on the four screens' buttons — every existing suite green, unchanged |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1101 passed, 28 skipped** (89 files
passed, 5 skipped), coverage 84.9 % statements / 88.6 % lines, `build` succeeds.

## Phase 64 - What the customer owes, stated to the customer (CLI-03, D-114)

The client portal could say what had been agreed — the routes, the roster, the term of the agreement —
and not what it had cost. The register said so plainly: **no invoices or payment status**. That is the
question a client contact is actually rung up to answer, and the one a corporate dashboard exists to
answer without a phone call.

The work was one scope change and one screen. The billing collections were hard-coded empty in the
narrowed snapshot handed to any record-bound account, so a client contact received nothing about money;
they now carry the client's own invoices and the payments, credit notes and refunds against them, and
nothing else. The portal states the figures and lists the documents behind them.

| Item | Status | Evidence |
|---|---|---|
| The client's own invoices, read-only | Done (verified) | `invoices:read` held by `client_contact`, own-record scoped; `clientBilling` matches on the client named **or** the rental billed, so a document written before the buyer was copied onto it still belongs to the right account ("shows a client contact the billing on its own invoices and no other customer's", "matches an invoice on the rental it bills when the document names no client") |
| The payments, credit notes and refunds travel with the invoice | Done (verified) | A total without its payments reads as a debt; a balance without its credit notes reads as money still owed. All four narrowed together in `scope.ts`, sent by `visibility.ts`, listed by the portal ("sends a client contact the credit notes on its own invoices, and no other customer's", "sends a client contact the refunds paid back on its own invoices, and no other customer's", "sends a client contact the payments on its own invoices, and no other customer's") |
| Another customer's bill cannot be assembled | Done (verified) | Narrowed twice — on the server, and again in the portal from the same scope; the visible test drives the real snapshot through the app ("never shows another customer's invoice, payment or credit note") |
| The balance is the shared rule | Done (verified) | `invoiceBalance` (D-86), the rule behind the printed statement and the finance home, so a cancelled payment counts for nothing and a credit note reduces what is owed ("counts a cancelled payment for nothing, because the money never arrived", "states what was billed, what came in, what was credited and what is still owed") |
| Nothing is netted quietly | Done (verified) | An invoice credited below what was paid says **Refund due**; a refund is stated as money given back and not netted off (`"calls a bill credited below what was paid a refund due, rather than settled"`) |
| Money is added in whole pesewas | Done (verified) | "adds in whole pesewas, so a hundred bills cannot land a pesewa out" |
| Two currencies are never added together | Done (verified) | `mixed_currency`: the invoices are listed one by one and no total is printed ("never adds two currencies together, and still lists the bills one by one") |
| A bill not yet issued, or one that was voided, is not stated | Done (verified) | "leaves out a void invoice and a bill dated after the date asked for" |
| The page says what it cannot state | Done (verified) | An account never billed reads "Nothing billed yet", not a row of zeros ("says there is nothing to state when the account has never been billed") |
| A driver and a rider receive no billing | Done (verified) | "gives a driver and a rider no billing at all"; the payload tests keep both at zero |
| Tests | Done (verified) | 10 domain (`clientAccount.test.ts`), 3 portal (`ClientPortal.test.tsx` — the portal had no screen test before this phase), 3 scope, 3 net new payload tests, 1 permission matrix updated — 19 new, plus the two payload tests that used to assert billing never reaches a client contact, rewritten to assert it reaches only its own |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1120 passed, 28 skipped** (91 files
passed, 5 skipped), coverage 85.08 % statements / 88.77 % lines, `build` succeeds.

## Phase 65 - The day on one screen, and what is wrong with it (DSP-01, D-115)

The busing screen has carried a run sheet for a long time: the next action on each run, in departure
order. It does not answer the other question a supervisor asks at half past six — *what is wrong with
today?* — because it is organised around what to do next to one run, not around the state of the whole
day. Runs with nobody on them, a bus that went into the workshop overnight, a roster that no longer fits
the bus, and which drivers are still free were all discoverable, but only by reading every row.

This phase adds a board for that, and deliberately adds nothing else: it reads, it changes nothing, and
every action stays where the commands are.

| Item | Status | Evidence |
|---|---|---|
| One date, every run, in departure order | Done (verified) | `dispatchBoard` in `src/tms/dispatchBoard.ts`; the timetable window, company, vehicle and its state, driver, seats and delay ("counts the day's runs by status, in departure order") |
| Upcoming departures, active, completed, delayed, cancelled | Done (verified) | The next run still to leave with the minutes to it, the status counts, and every delay in the dispatcher's own words ("reports a run that is behind, in the dispatcher's words", "points at the next run still to leave, and skips one already gone") |
| Runs waiting on a crew | Done (verified) | `no_vehicle` and `no_driver` are kept as blockers rather than strings, so the count and the sentence can never disagree ("names a run with no crew, and counts it once however much is missing") |
| Capacity warnings | Done (verified) | Roster plus booked seats against the seats on the bus is a **blocker**, not a statistic: it is a safety limit ("counts riders over the seats as a safety problem, roster and booked seats together") |
| Maintenance blocks | Done (verified) | The vehicle's state comes from `fleetStateOf`, the same reading the vehicles register and the fleet dashboard use, so a bus in the workshop cannot be "available" on one screen and blocked on another ("treats a bus in the workshop as a bus that cannot take the run") |
| A lapsed licence blocks the run | Done (verified) | "blocks a run whose driver's licence has lapsed, and says the date" |
| Available drivers and vehicles | Done (verified) | Free means no run and no hire that day; a bus that cannot move is listed last with the reason, and a driver whose licence has lapsed is a name to ring, not a driver to send ("lists who is free, and puts a bus that cannot move at the bottom with its reason") |
| Alerts | Done (verified) | The day's problems in sentences, safety first, then the runs that cannot leave, then what is late ("leaves a cancelled run out of the trouble counts, and states what it cannot answer") |
| Filters: date, status, company, route, driver, vehicle | Done (verified) | "narrows the list without shrinking the day", and the screen test that drives the selects ("narrows the list with a filter without pretending the rest of the day is gone") |
| The list and the day are not the same thing | Done (verified) | Filters narrow the list only; `dayRuns` travels with the board and the screen prints it, so a filtered list of one is never read as a quiet day |
| No map, and no invented times | Done (verified) | Every time is the timetable's; the limits are printed on the page ("prints what it cannot answer, instead of leaving it to be discovered") |
| The service filter | **Not built, and said so** | A run carries no service type in this build (TRP-01), so the board cannot filter by one. The limit is the first line on the page rather than a filter that quietly does nothing |
| The nav badge | Done (verified) | Runs still to leave today with no vehicle or no driver — the day's outstanding problem, not a count of everything |
| Tests | Done (verified) | 11 domain (`dispatchBoard.test.ts`) and 4 screen (`DispatchBoard.test.tsx`) — 15 new, every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1135 passed, 28 skipped** (93 files
passed, 5 skipped), coverage 85.24 % statements / 88.9 % lines, `build` succeeds.

## Phase 66 - The customer's own yes, recorded once (RNT-05, D-116)

A quotation has gone out to customers since Phase 11, and the only place their answer was kept was
somebody's memory or the free-text notes on the request. The office confirmed a hire on the strength of a
phone call, and nothing in the system said whether the customer had agreed — or *to which figure*, once a
quotation had been revised. This phase adds that record, and nothing that moves money.

| Item | Status | Evidence |
|---|---|---|
| A record of the customer's answer | Done (verified) | `Rental.acceptance` carries who answered, when, the channel, the quotation's own timestamp, its total and deposit, and an optional note ("writes down who agreed, when, and to which quotation") |
| The answer is tied to the figure it was given to | Done (verified) | The figures are copied, not looked up, so a requote cannot inherit an old agreement; the row says so in words — "the quotation has been replaced since. The figure on record now is different" (11 domain tests in `acceptance.test.ts`) |
| A lapsed quotation cannot be accepted | Done (verified) | "refuses a yes to a quotation that has lapsed, and says to issue a new one" — the refusal names the date the price ran out |
| One yes per quotation | Done (verified) | A second attempt is refused and names the first: "already accepted on 2026-01-01 by Admin One" ("refuses a second yes to the same quotation, and names the first") |
| Agreeing is not paying | Done (verified) | The command records no money and changes no status; the hire still confirms when finance records the deposit (D-90) — the status stays `quoted` in the same test |
| The customer's own act, or the office's word | Done (verified) | `client_portal` when the customer presses the button, `office` when staff record a yes given on the phone; the audit sentence says which, e.g. "RR-0001: Fin accepted the quotation of GHS 3000.00 on the office's word" |
| The customer answers only its own quotation | Done (verified) | `rentals:accept` held by administrator, operations, finance and the client contact, confined to its own client exactly as `rentals:create` is; another customer's hire answers "This request is not on your account." (`scope.test.ts`) |
| The portal can answer | Done (verified) | Client portal gains a **Quotation** column (figure, deposit, validity, and the answer once given) and an **Accept quotation** panel that prints the figure, the deposit and the date the price holds before the button (`ClientPortal.test.tsx`) |
| The office can record a yes given by phone | Done (verified) | **Record customer acceptance** on the rental, with an optional note; the Quotation card then carries the sentence |
| No notification | **Not built, and said so** | There is no mail or SMS provider in this build (NTF-01/02/03 are deferred, Phase 2). Nothing is sent, and nothing claims to have been: the register keeps that as RNT-05's remaining gap |
| Tests | Done (verified) | 19 new: 11 domain (`acceptance.test.ts`, including the schema-31 migration), 6 service (`service.test.ts`), 1 scoping (`scope.test.ts`), 1 screen (`ClientPortal.test.tsx`) — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1154 passed, 28 skipped** (94 files
passed, 5 skipped), coverage 85.29 % statements / 88.94 % lines, `build` succeeds.

## Phase 67 - A quotation with a number, a clock and terms (RNT-04, D-117)

The quotation is the document a customer reads, keeps and argues about, and it was the least finished
one in the build: no number of its own, a price that lapsed at midnight on a day counted in whole days,
and no terms at all. This phase closes those three gaps and leaves tax lines, discounts and an approval
signature where they were.

| Item | Status | Evidence |
|---|---|---|
| A quotation number | Done (verified) | `QUO-0001` from its own series, drawn from the counter every other record uses; the message and the audit entry name it ("numbers each quotation in its own series, and says so in the message") |
| Versioned | Done (verified) | A renewal keeps the number and raises `revision` to 2, 3, … with the earlier version kept in `quoteHistory` ("keeps the number on a renewal and raises the revision") |
| Terms and conditions | Done (verified) | `settings.rental.quotationTerms`, written by the company; **no default text exists**, quoting is blocked while it is empty ("refuses to issue a quotation when nobody has written the terms"), and the terms are copied onto each quotation so a later edit cannot rewrite what was sent ("copies the company's terms onto the quotation as they stand when it is issued") |
| Validity counted to the minute | Done (verified) | `quotationValidityHours` replaces whole days (schema 32, old days × 24); `validUntil` is a timestamp; every check compares instants ("stops being acceptable at the hour it was quoted for, not at midnight") |
| What the price includes | Done (verified) | `driverIncluded` recorded on the quotation from policy or the request, and printed on the office's card |
| An unnumbered old quotation is marked, not backfilled | Done (verified) | The migration gives it no number and blank terms; the screen warns it cannot be given to a customer as a document ("keeps an old quotation's figures and marks it as having no document behind it") |
| The customer sees the same document | Done (verified) | The portal's quotation column shows the number and revision; the acceptance panel prints the figure, the deposit, the terms and the moment the price stops holding (`ClientPortal.test.tsx`) |
| Tax lines, discounts, approval record | **Not built, and said so** | A quotation carries no tax lines (Q-14 is open), no discount line, and nobody signs one off. The register keeps all three named as RNT-04's remaining gaps |
| Tests | Done (verified) | 15 new: 10 domain (`quotations.test.ts`), 5 service (`service.test.ts`) — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1169 passed, 28 skipped** (95 files
passed, 5 skipped), coverage 85.35 % statements / 89 % lines, `build` succeeds.

## Phase 68 - What actually happened on the hire (RNT-07, D-118)

Completion recorded the final invoice and stopped there. The office could say what a hire was billed
and could not say when the bus left, when it came back, how far it went, whether it returned damaged,
or what the customer said. This phase records the journey beside the money, on the hire, and states the
balance from the invoice the customer actually holds.

| Item | Status | Evidence |
|---|---|---|
| Actual departure and return | Done (verified) | `start_rental` records the moment the vehicle left; completion records the return (defaulting to now, correctable) and refuses a return before the departure ("refuses a vehicle that came back before it left") |
| Actual distance when available | Done (verified) | Two odometer readings give the distance; a typed distance is accepted and marked as typed ("is measured from two odometer readings, and says it was", "is what the office typed when there are no readings, and says that instead") |
| Two answers, one question | Done (verified) | A typed distance that disagrees with the readings is refused, and the refusal states the measured figure ("refuses two answers to the same question rather than picking one") |
| Odometer readings feed maintenance | Done (verified) | A reading entered at the start or the end joins the odometer register the service intervals use ("records the moment the hire started, and the odometer it started from") |
| Damage notes | Done (verified) | Recorded in the office's words; blank says plainly that nothing was reported, and no work order is invented from a sentence ("records a damage note, and says plainly when nothing was reported") |
| Customer feedback | Done (verified) | Kept with the hire, in the words the office wrote down |
| The balance | Done (verified) | `rentalBalance` / `balanceLine` from the invoice for this hire and the payments against it, through the one balance rule; no invoice yet is said, not shown as zero ("shows what the hire cost and what is still owed against it") |
| Nothing invented | Done (verified) | A completion with no journey details records the times and leaves the rest blank; an older hire has no run and the screen says so ("completes a hire with no journey details at all, and claims nothing", schema-33 migration test) |
| Additional charges approved by somebody | **Not built, and said so** | An extra line still needs no second signature (Q-12). The register keeps it named as RNT-07's remaining gap |
| Tests | Done (verified) | 25 new: 20 domain (`run.test.ts`), 4 service (`service.test.ts`), 1 screen (`Rentals.test.tsx`) — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1195 passed, 28 skipped** (96 files
passed, 5 skipped), coverage 85.51 % statements / 89.13 % lines, `build` succeeds.

## Phase 69 - The journey the customer asked for (RNT-01, D-119)

A request recorded the dates and the two places. Everything the customer actually said about the day
— the times, the stops on the way, the suitcases, the wheelchair, who to ring on the morning, how the
enquiry even reached the office — had no home beyond a notes box. This phase records it, refuses the
two answers that cannot both be right, and prints what it knows without filling in what it does not.

| Item | Status | Evidence |
|---|---|---|
| Departure and return times | Done (verified) | Stored as 24-hour times, typed either way ("7:30" becomes "07:30"); a time it cannot read is refused rather than guessed ("takes one digit for the hour and stores the padded form", "refuses a time it cannot read") |
| Return time or duration | Done (verified) | The duration is worked out from the two times and the two dates and printed, so it cannot drift from them ("counts the time asked for from the two clock times", "says when it leaves and comes back, and how long that is") |
| A one-day hire that comes back before it leaves | Done (verified) | Refused, in words that name both corrections, with the two times left as typed ("refuses a one-day hire that comes back before it leaves") |
| Intermediate stops | Done (verified) | One per line, in the order the vehicle calls, up to eight; printed as "Calls at Achimota, then Nsawam." and "No intermediate stops were recorded." ("keeps the stops in the order the vehicle calls", "lists the stops in order") |
| Luggage and special needs | Done (verified) | Two separate notes, because a wheelchair is not a suitcase; printed only when something was written ("refuses a stop, a luggage note or a special need that is too long") |
| Who to ring on the day | Done (verified) | A name and a number, the name required beside a number, and the customer's own number named as the fallback instead of an empty cell ("wants a name beside a number", "names who to ring on the day") |
| Where the request came from | Done (verified) | A list of channels the desk chooses; the web form records `website` and the client portal records `portal`, because those two are known ("records where the request came from", "writes down the times, the stops…", enquiry test) |
| A correction does not wipe the journey | Done (verified) | Editing the purpose leaves the stops and the source alone ("keeps what a correction leaves out of the form", "keeps the journey when a correction leaves it out") |
| Nothing invented | Done (verified) | A request with no journey details stores blanks; a request written before schema 34 has no plan and the card says its times, stops and origin are unknown ("records blanks when the desk knows nothing", "loads it with no plan at all") |
| A stop costs nothing by itself | **Not built, deliberately** | Nothing here prices, routes or charges for a stop: the quotation is still the only document that puts a figure on the day |
| Tests | Done (verified) | 30 new: 25 domain (`request.test.ts`), 4 service (`service.test.ts`), 1 screen (`Rentals.test.tsx`, extended) — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1225 passed, 28 skipped** (97 files
passed, 5 skipped), `build` succeeds.

## Phase 70 - The stages a request goes through (RNT-02, D-120)

A request had one state before a price and one after it. Ten enquiries in a morning all looked the
same whether nobody had opened them, somebody was checking a driver's papers, or the customer had
agreed and never paid. This phase gives each of those its own name, on the rule that a stage is only
worth having if it changes what the office does next and the program can tell it is true.

| Item | Status | Evidence |
|---|---|---|
| The triage stages | Done (verified) | Submitted, under review and awaiting quotation, one step at a time via `advance_rental` ("walks a request through submitted, under review and awaiting quotation") |
| No skipping, no going back | Done (verified) | Refused with both stages named ("refuses a skipped stage and a step back") |
| The stages never block the work | Done (verified) | A quotation can be issued from any pre-quote stage ("lets a small request be priced without walking the stages at all") |
| Quotation sent and awaiting the customer | Done (verified) | One state, because there is no second moment to record; the answer itself is on the card (D-116) |
| The customer's yes as a stage | Done (verified) | `accepted` — agreed, deposit due — and the deposit still confirms ("records the customer's yes as its own stage, and confirms from it") |
| Dispatched | Done (verified) | `start_rental` writes `dispatched`; stored `in_progress` rows are rewritten by migration 022 and by `migrate()` for backups ("keeps an older backup's on-the-road hire, under the word this build uses") |
| Corrections while the request is open | Done (verified) | Allowed in every pre-quote stage, refused once a price is out ("allows a correction while a request is being looked at, and not after it is priced") |
| A renewed price reopens the question | Done (verified) | An agreed hire returns to `quoted` with the old acceptance still on record ("returns an agreed hire to waiting when the price is renewed") |
| One table for the screens and the service | Done (verified) | `rentalWorkflow.ts`; the strip, the buttons, the dashboard counts and the portal all read it ("has a move table for every status", "says whose move it is") |
| Messaging the customer at any stage | **Not built, and said so** | No mail or SMS channel exists; nothing in this phase claims a message was sent |
| Tests | Done (verified) | 19 new: 11 domain (`rentalWorkflow.test.ts`), 7 service, 1 extended screen flow — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1244 passed, 28 skipped** (98 files
passed, 5 skipped), `build` succeeds.

## Phase 71 - What the customer is asked to pay, and who signs it off (RNT-04, D-121)

The quotation had a number, a clock and the company's own terms, and then stopped short of the two
things a customer actually reads: the tax, and the reduction. Both arrived on the invoice instead, a
week after the customer had agreed to a smaller number. This phase puts the whole figure on the
quotation, and puts a second signature on the ones that need one.

| Item | Status | Evidence |
|---|---|---|
| Tax on the quotation, frozen when it is issued | Done (verified) | Lines copied from settings at issue, one shape shared with invoices; nothing is added when the company has not said it is registered ("charges no tax when the company has not said it is registered") |
| A declared discount, with its reason | Done (verified) | Amount and reason on the document; a reason is required above zero and a reduction larger than the price is refused ("refuses a discount with no reason, and a discount bigger than the price") |
| A total, and a deposit taken from it | Done (verified) | `total = lines − discount + tax` in whole pesewas; the deposit is the company's percentage of that total ("puts the tax and the discount on the document, and the deposit on what the customer pays") |
| A second signature above a figure the company sets | Done (verified) | `quotationApprovalAbove`; `null` means "not asked for" and the screen says so; refused for the quotation's own author ("needs a second signature above the threshold, and refuses the author's own") |
| The signature belongs to one figure | Done (verified) | Who, when, which total, an optional note; a renewal clears it and a figure that no longer matches is not current ("does not carry a signature onto a renewal") |
| An unsigned price cannot be agreed or paid | Done (verified) | Both the customer's yes and the deposit are refused, from the office and from the portal, in the customer's own words ("asks for nothing when the company has set no threshold") |
| An expired or unissued quotation has nothing to sign | Done (verified) | Refused with both reasons named ("refuses to approve a quotation that has expired, or one that is not out") |
| The audit trail shows the working | Done (verified) | The total leads, then the lines, the reduction and each tax line; the approval has its own entry naming the signer |
| Sending the quotation to the customer | **Not built, and said so** | There is no mail or SMS channel in this program; nothing in this phase claims a quotation was sent |
| Line types, and a waiting or overtime rate | **Not built, and said so** | A line is a description, a quantity and an amount; nothing distinguishes a distance charge from a waiting charge, so no rate can be applied. That remainder sits with FIN-01 |
| Tests | Done (verified) | 22 new: 15 domain (`quotations.test.ts`), 7 service; the rentals screen test now types a discount and reads the total back — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1266 passed, 28 skipped** (98 files
passed, 5 skipped), coverage 85.78 / 76.58 / 82.94 / 89.4, `build` succeeds. No migration: every new
field lives inside the quotation already stored on the rental (schema **36**).

## Phase 72 - A register can be read in another order (interface, D-122)

The office reads registers in whichever order its own logic chose. That is the right order to open on
and the wrong order for the question being asked — "who owes the most", "what did fuel cost", "who
touched this record" — so the only way to answer it was to read the list or export it into a
spreadsheet. This phase makes a column header sortable, on the three registers where that question is
asked out loud, and keeps the order where an export can see it.

| Item | Status | Evidence |
|---|---|---|
| A sortable header, one column at a time | Done (verified) | Ascending, then descending, then back to the screen's own order ("sorts ascending first, reverses on the second click, and clears on the third") |
| The state spoken, not just drawn | Done (verified) | `aria-sort` on the cell, `none` only where a sort exists, an `aria-hidden` arrow ("says which way the column is sorted, and clears on the third click", "does not claim a sort state on a column that cannot be sorted") |
| Values sort as values | Done (verified) | Money as numbers, dates by their stored form, references with digit runs compared by number ("sorts numbers as numbers, not as text", "sorts text in reading order") |
| Rows that tie do not move | Done (verified) | The screen's order is the tie-break ("keeps rows that tie in the order they arrived") |
| The order belongs to the screen | Done (verified) | `useTableSort` holds it and the table only reports the click ("offers a button only on a column that says how to sort"); sorting never escapes the filter ("keeps sorting inside the filter") |
| Three registers wired | Done (verified) | Invoices (every column but the action), rental requests, the audit log — where the sort is applied to all matches before the 500-row window |
| Animation, glow, remembered state | **Not built, on purpose** | No transition on the arrow, no row movement, nothing stored between visits |
| The other registers | **Not built, and said so** | A register adopts this by giving its columns a `sortValue` and calling the hook; the rest do not sort yet. Sorting inside a printed sheet is not offered |
| Tests | Done (verified) | 15 new: 10 pure ordering rules (`tableSort.test.ts`), 3 rendered header states (`primitives.test.tsx`), 2 on the real invoice register — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1281 passed, 28 skipped** (99 files
passed, 5 skipped), coverage 85.7 / 76.67 / 82.61 / 89.41, `build` succeeds. No schema change, no
migration.

## Phase 73 - What was charged after the price was agreed (RNT-07, D-123)

The quotation is settled before the vehicle leaves; the extras are decided after it comes back, by the
person who took the call. Until this phase those extras were anonymous lines on the final invoice — the
one place in the money trail where the person who wrote a figure was also the only person who saw it.
Now a charge carries a reason the customer reads and, above a figure the company sets, a second name.

| Item | Status | Evidence |
|---|---|---|
| A charge is recorded with its reason and its author | Done (verified) | `extraCharges` on the hire, reason required ("refuses a charge with no reason, and leaves the hire on the road"; "records the charge, its reason and who added it, and puts it on the final invoice") |
| The customer's invoice says why they are paying | Done (verified) | The reason is printed on the invoice line ("puts the reason on the customer's invoice line") |
| Above the company's figure, somebody else signs | Done (verified) | `extraChargeApprovalAbove`; the bill waits while a charge is unsigned ("will not bill a charge above the company's figure until somebody else signs it") |
| Never the author's own signature | Done (verified) | Refused by account, and by name for a charge recorded before accounts were kept ("refuses the person who added it") |
| One signature, for one amount | Done (verified) | A second approval is refused, and an edited charge is not the one that was signed ("counts as approved only for the amount it is actually for") |
| No figure set means nothing is asked for | Done (verified) | Said in words on the screen, and nothing waits ("asks for nothing when the company has set no figure, and says so") |
| An approval after the bill is refused | Done (verified) | Names the invoice and points at a credit note ("refuses to sign a charge that has already been billed, and names the invoice") |
| Older hires keep working | Done (verified) | Schema 37 migration leaves them with no charges ("carries no charges, and says so rather than inventing a blank one") |
| A waiting or overtime rate | **Not built, and said so** | Still FIN-01: a waiting charge is a figure somebody types, now with a reason and a signature behind it |
| Telling the customer about the charge | **Not built, and said so** | There is no mail or SMS channel; the record says what happened and claims nothing was sent |
| Tests | Done (verified) | 23 new: 15 domain (`extraCharges.test.ts`), 7 service on the full flow and the gate, 1 extended screen flow — every existing suite green |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1305 passed, 28 skipped** (100 files
passed, 5 skipped), coverage 85.64 / 76.6 / 82.44 / 89.35, `build` succeeds. Schema **37**; no migration,
because every new field lives on the rental record.


## Phase 74 - The design system, and one board built only from it (interface, D-124)

The screens were built one at a time and each has its own idea of a card. This phase builds the pieces
instead: one token file, one accent, dark by default, and a set of components that take their data. Then
it proves the set by building the operations overview out of nothing else, and a gallery that shows
every component in every state a query can put it in.

| Item | Status | Evidence |
|---|---|---|
| One place for colour, radius, type and motion | Done (verified) | `src/app/globals.css`; `tokens.css` deleted; contrast measured 17.07 (text), 7.92 (muted), 5.44 (dim), 8.16 (accent) — no pair below 4.5 |
| Shell: rail, top bar, ⌘K palette, phone strip | Done (verified) | `AppShell`, `SidebarNav`, `TopBar`, `CommandPalette` (\"opens the palette on ⌘K and navigates on Enter\") |
| Only screens that exist are links | Done (verified) | Unbuilt rows render disabled and marked *planned* (\"does not offer a link to a screen that has not been built\") |
| Four figures with a caption, a change and a shape | Done (verified) | `StatCard` (\"shows the figure, its caption and the change, and describes the sparkline\") |
| Register table with sorting, sticky header and three states | Done (verified) | `DataTable` on TanStack (\"reorders when a header is pressed\", \"announces loading\", \"shows a failure and offers a retry that really calls back\") |
| Rings, feed and map | Done (verified) | `RingGauge` (\"names the arcs and shows each count\", \"survives an empty fleet\"), `ActivityFeed` (\"lists entries newest first with a mono relative time\"), `FleetMap` (\"labels the picture as illustrative\") |
| The board | Done (verified) | `/dashboard` — four figures, map, ring with legend, live trips, activity (\"renders the four figures, the trackables and the sample-data label\", \"re-cuts the payload when the period changes\") |
| The gallery | Done (authored) | `/design` — tokens, type, buttons, badges, stat cards, rings, all four table states, feed, map, shell. Rendered by the server and checked for every section; not covered by an assertion of its own |
| Sample data says it is sample data | Done (verified) | `overviewSample()` carries \"Sample data — not records\"; printed on the board, and the map states that no vehicle reports a position |
| New booking | **Not built, and said so** | The button opens a dialog naming where a booking is recorded today and linking to it |
| Live vehicle positions | **Not built, on purpose** | No telematics provider; the map is a swappable placeholder with a data seam |
| The other 27 screens | **Not converted, and said so** | They still read `legacy.css`; conversion is one screen per phase |
| Tests | Done (verified) | 31 new in `src/components/tms/tms.test.tsx` — 31 passed |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1336 passed, 28 skipped** (101 files
passed, 5 skipped), coverage 85.25 / 76.73 / 81.21 / 88.72, `build` succeeds (both routes static). No schema change, no migration.

## Phase 75 - One product: the whole application on the dark palette (D-125)

The design system existed on two review pages and nowhere else: the twenty-seven working screens were
still white cards on a light canvas with an indigo accent, inside a dark rail. This phase ends the seam —
every screen now reads one palette and one frame — and adds the interaction layer that makes the product
feel built rather than assembled.

| Item | Status | Evidence |
|---|---|---|
| The old screens read the dark palette | Done (verified) | `legacy.css` values re-pointed (selectors untouched); the compiled stylesheet contains no light background and no dark text colour — checked by scanning every `background`/`color` declaration in the built CSS |
| The leftover utilities were remapped | Done (verified) | 494 `stone-*` and one `bg-white` token across 25 files; three tests on the sign-in and first-run screens still pass |
| One frame for the working app | Done (verified) | `AppFrame`: filled accent active item, section counts, sheet on a phone, content arriving on the glide curve (\"marks the current screen, carries the day's counts and names the user\", \"navigates, signs out and opens the palette\") |
| The first screen a new installation sees | Done (verified) | `/` first-run and sign-in rebuilt on the dark surface with the brand half as a statement; the end-to-end suite still runs first-time setup through it |
| The motion layer | Done (verified) | Sheen, gliding pill, spotlight, figure bump, page arrival, aurora on the two screens that are not work surfaces — all CSS, all stopped by `prefers-reduced-motion` (\"is one radio group, and the pill follows the choice\", \"steps with the arrow keys\") |
| Borrowed tastefully | Done (authored) | Four moves kept from kinetics.colorion.co and animatedbuttons.colorion.co; magnetic buttons, tilt, neon and cursor trails rejected as wrong for a dense desk |
| The working screens rebuilt on the components | **Not built, and said so** | They read the new palette and sit in the new frame, but their tables, forms and layout are still the pre-migration ones. That conversion continues one screen per pass |
| Tests | Done (verified) | 4 new in `src/components/tms/tms.test.tsx` — 35 in that file, 1,340 across the suite |

Gates after this phase: `typecheck` clean, `lint` clean, `test` **1340 passed, 28 skipped** (101 files
passed, 5 skipped), `build` succeeds. No schema change, no migration.

## Phase 76 - The whole-system audit (D-126)

| Item | Status | Notes |
| --- | --- | --- |
| Audit of the product as it stands at `5aed55e` | Done (verified) | `docs/AUDIT.md`: correctness, authorisation, security headers, database integrity, coverage, dependency risk, dead code, documentation accuracy and live behaviour, each with the command that reproduces it. **No P1 finding.** |
| Feature-register tally | Fixed | The table held 78 rows (39 Met / 26 Partial / 0 not built / 13 Deferred); the heading and the tally line said 72 / 34 / 26 / 12, and `docs/STATUS.md` said 14 deferred. All three now agree with the table, and D-126 makes the table the only count. |
| Database-suite count in the setup guide | Fixed | "14 tests, 4 files" became 28 tests in 5 files. |
| Dead weight | Reported, not removed | Ten `components/ui` files have no importer; `recharts` and `cmdk` are unused (`tw-animate-css` is used by `globals.css` and was wrongly suspected). Left in place for the owner to decide — see `docs/AUDIT.md` P2-2. |
| Gates at the audit | Pass | `tsc` clean, `eslint .` clean, 1,340 tests passed (28 skipped), `next build` 42 s, `npm audit` 0 vulnerabilities, database suite 28/28 against PostgreSQL 18.4. |
