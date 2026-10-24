# Spec conformance check — 24 October 2026

**Question asked:** read `richie-tms-standing-brief.md` (the brief, §1–§15) and
`richie-tms-phase-prompts.md` (Phase 0 / 1A / 1B / 1C / 2 / 3 + utility prompts), then cross-check
them against the application as it actually runs.

**Answer, in one sentence:** no — the application is a solid, genuinely server-backed TMS that
meets the brief's integrity rules, the rental lifecycle, fleet/compliance, work orders, route → trip
→ boarding → on-time flow and the permission/audit core, but it does **not** meet the brief as a
whole: **7 of 78 feature IDs are met, 38 are partial, 19 are missing (all of them Phase 1A–1C
obligations), 14 are later-phase and untouched**, four named stack standards are replaced or absent,
6 of the brief's 10 roles do not exist, and 6 of the 8 end-to-end workflows in §8 cannot run end to
end. It is also **below its own phase gates**: the Phase 1A exit criteria are not met, so starting
1B/1C was premature by the brief's own rules (§14: "Do not start the next phase while the current
phase's exit criteria are unmet").

This run changed no application code. Everything below was executed against a live production build
(`next build` + `next start`) on a real PostgreSQL instance.

---

## 1. How this was verified

| Item | Value |
|---|---|
| Build | `npm run build` → production build; served with `next start` on port 3000 |
| Database | PostgreSQL-wire server (PGlite socket server) on `127.0.0.1:55432`; `npm run db:migrate` applied `001_init.sql` + `002_resource_reservations.sql` |
| Gates re-run this session | `npm run typecheck` clean · `npm run lint` clean · `npm test` **203 passed, 5 skipped (208)** |
| Data | created through the public API only: administrator, settings, 2 vehicles, 2 drivers, 1 corporate client, 6 rentals, 2 routes, 12 trips, 25 passengers, 2 documents, 1 incident, 1 work order, 5 users |
| Roles exercised | administrator, operations, finance, driver, client_contact — each with its own session cookie |
| Evidence form | command → response, quoted verbatim where it matters |

No feature below is marked "met" on the strength of a document, a screen rendering, or an untested
claim. Where I could not exercise something (a notification provider, a map, a phone), it is marked
missing or deferred — never assumed.

---

## 2. Scoreboard

### 2.1 Feature IDs (§7) — 78 in total

| Status | Count | IDs |
|---|---|---|
| **Met** (works; ran it) | **7** | AUTH-01, AUD-01, RNT-06, RNT-08, RTE-03, TRP-02, DRV-04 |
| **Partial** (some of it exists; gaps named in §5) | **38** | AUTH-02, AUTH-03, AUTH-04, SET-01, CUS-01, RNT-01, RNT-02, RNT-03, RNT-04, RNT-05, RNT-07, RNT-09, FLT-01, FLT-02, FLT-03, FLT-04, FLT-05, MNT-01, MNT-02, MNT-03, CLI-01, CLI-03, EMP-01, EMP-03, RTE-01, RTE-02, TRP-01, DSP-01, DSP-02, DSP-04, DRV-01, DRV-02, INC-01, INC-02, FIN-01, FIN-03, FIN-05, RPT-02 |
| **Missing** (nothing built, and all of these were due in Phase 1A/1B/1C) | **19** | AUTH-05, MIG-01, WEB-01, CLI-02, EMP-02, BKG-01, BKG-02, BKG-03, BKG-04, BKG-05, BKG-06, DSP-03, RTE-04, PAX-01, FIN-02, FIN-07, RPT-01, RPT-03, RPT-04 |
| **Deferred** (Phase 2/3, not attempted — honest) | **14** | AUTH-06, MNT-04, RTE-05, DRV-03, DRV-05, PAX-02, FIN-04, FIN-06, FIN-08, NTF-01, NTF-02, NTF-03, RPT-05, GPS-01 |

### 2.2 Everything else

| Brief section | Verdict |
|---|---|
| §2 Integrity rules | **Met** — the strongest part of the build |
| §4 Stack | **Partly** — 5 of 11 standards met; 3 replaced (2 with a decision record); 3 omitted (1 with a record) |
| §5 Engineering invariants | **Partly** — 5.1 (DB constraint), 5.4 (numeric type), 5.5 (timestamptz), 5.9, 5.10(partly); 5.3, 5.6, 5.7, 5.8 fail as written |
| §6 Roles and permissions | **Partly** — 5 roles, not 10; deny-by-default matrix is real and enforced server-side |
| §7 Feature backlog | **7 / 78 met** (see above) |
| §8 Workflows A–G | **1 of 7** runs end to end (C is the closest; see §7 below) |
| §9 Ghana requirements | **Partly** — GHS, +233, MoMo-as-configured-string; no timezone pinning; no coordinates/landmark/digital address |
| §10 Security and privacy | **Largely met** for what exists; file uploads, retention jobs and monitoring not applicable/absent |
| §11 Interface standards | **Partly** — strong forms/a11y/empty states; no pagination, no CSV export, IA ≠ the brief's nav |
| §12 Testing requirements | **Partly** — 208 tests, real-Postgres constraint tests; no Playwright, no parallel-request test, no generated cross-tenant tests, no full from-to matrices |
| §13 Definition of done | **Partly** — gates pass; `docs/PROGRESS.md` is **not** tracked per feature ID (only 3 IDs appear) |
| §14 Session protocol | **Partly** — gates are run and docs updated, but by phase, not by feature ID; phases advanced with gates unmet |
| §15 Deliverables | **Partly** — 10 of 13 named docs exist; `API.md`, `BACKUP_AND_RECOVERY.md`, `USER_ROLES_GUIDE.md` absent; no seed script (owner's instruction) |

---

## 3. §4 Stack and standards

| Standard | Status | Evidence |
|---|---|---|
| Next.js App Router, React, TypeScript `strict`, Tailwind | **Met** | `src/app/page.tsx` + one client shell; `tsconfig` strict; Tailwind 4 via PostCSS; `next 15.5.28` |
| PostgreSQL 15+ with `btree_gist` | **Met** | `db/migrations/002` uses `exclude using gist`; migration creates the extension |
| Prisma ORM + hand-written SQL migrations | **Replaced** — Kysely + `pg` | Decision **D-50** records it; reason is honest (Prisma's engine binary cannot be downloaded in the build environment) |
| Zod at every server boundary | **Met** | `zod` at `api/commands`, `api/auth/login`, `api/setup`, `env.ts` — i.e. every route |
| Auth: "one maintained library … never hand-roll sessions or password hashing" | **Contradicts**, but recorded | `iron-session` + `@node-rs/argon2` wired by hand in `src/server/session.ts` (D-51). No cryptography is hand-written, but the brief's examples (Auth.js / Better Auth) are not used and the brief's "one library" is two libraries |
| `pg-boss` (or scheduled endpoints with documented limits) | **Absent** | `docs/ARCHITECTURE.md` §Job runner: "Not present… daily generation, document-expiry reminders and retention jobs are still not implemented". No scheduled endpoint exists either |
| Vitest, integration tests against real Postgres | **Met** | 203 unit/UI + 5 integration tests (exclusion constraint, audit immutability, odometer) |
| Playwright end-to-end | **Absent** | not a dependency; no `e2e/`, no `playwright.config`; §12's 8 flows are not automated at all |
| Docker Compose for PostgreSQL | **Withdrawn by the owner** | README documents a single `podman run` line instead; the owner rejected compose/`run.sh` scripting |
| One package manager | **Met** | npm only, `package-lock.json` committed |
| `src/modules/<domain>/{service,policy,schema,repo}` | **Not followed, no decision record** | code lives in `src/tms/*` (domain) and `src/server/*` (transport/persistence). Business rules are centralised (`service.ts`, `busing.ts`, `logistics.ts`, `compliance.ts`) and route handlers are thin, so the *intent* is met; the *layout* is not |
| Providers behind interfaces (maps, SMS, email, payments) | **Not built** | no provider module exists; ARCHITECTURE lists them as seams with "None" |
| Quality gates before "done" | **Met** | `typecheck` 0 · `lint` 0 · `test` 203/5 · `build` ✓; CI (`ci.yml`, `codeql.yml`, `dependency-review.yml`) green on `e9f399e` |

---

## 4. §5 Engineering invariants (each must have tests)

| Invariant | Status | Evidence |
|---|---|---|
| **5.1 Double-booking, enforced in the database** | **Met** | `resource_reservation` with `exclude using gist (resource_type, resource_id, period with &&)`; integration test asserts SQLSTATE `23P01`; live: overlapping vehicle/driver refused, cancelled rental's dates released and re-used successfully, second trip for a driver that morning refused (`Driver is already on TR-0002 at an overlapping time that day.`) |
| 5.1 seat capacity, `SELECT … FOR UPDATE` inside the booking transaction | **Fails** | **seat capacity is never compared with passenger count anywhere** (`seatCapacity` appears only in the vehicle form). Live: 25 active passengers on a 22-seat Coaster accepted; trip assigned to that vehicle |
| 5.1 concurrency test with parallel requests | **Absent** | no parallel-request test; only a sequential "second insert fails" integration test |
| 5.2 Tenant isolation through one scoped layer + generated cross-tenant tests | **Adapted** | single company; `scope.ts` + `visibility.ts` implement own-record scope (live: driver sees 1 vehicle/3 trips/0 clients/0 audit; client sees only its own rental). No cross-tenant tests because there are no tenants (single-tenant decision is in D-51's context) |
| 5.3 One transition table per entity, one function, `status_history` row per change | **Partial** | transition tables exist for rental, trip, vehicle, work order, incident; but the rental machine is **7 states, not the brief's 12**; there is **no `status_history` table** — history is per-entity JSON (`log`) plus `audit_entry`, which stores no from→to; no exhaustive from-to matrix test |
| 5.4 `NUMERIC(14,2)`, one totals function, immutable invoices, unique billable event, idempotent callbacks | **Partial** | `numeric(14,2)` columns exist for quote/deposit/invoice/cost totals ✔; all arithmetic is done in **JS floating point** (`round2`) before `toFixed(2)` ✘; there is **no invoice or payment entity**, so immutability, credit notes, unique billable event and idempotent callbacks have nothing to attach to |
| 5.5 `timestamptz` UTC, displayed in `Africa/Accra`, recurrence in local time | **Partial** | timestamptz ✔; **the string `Africa/Accra` does not appear anywhere in `src`** — every date/time is formatted with `toLocaleString(undefined, …)`, i.e. the viewer's OS timezone |
| 5.6 References from DB sequences (`QTE-2026-0001`) | **Fails** | no `sequence`/`nextval` in any migration; references are counters — `RR-${rentals.length+1}`, `RT-${routes.length+1}`, `TR-${counter}`, `IN-0001`, `WO-0001`; no year segment; collision-prone if a record is ever removed |
| 5.7 Append-only audit with actor, action, entity, summary, **IP**, timestamp | **Partial** | trigger blocks update/delete (integration test) ✔; `audit_entry` has **no IP column**; live audit rows show actor/action/entity/summary/at only |
| 5.8 Idempotency keys | **Absent** | no client event ID or idempotency key anywhere (`grep eventId|idempot` → 0 hits) |
| 5.9 Archive/deactivate, retention schedule | **Partial** | records are deactivated (status), never hard-deleted by the UI; `docs/DATA_PROTECTION.md` proposes retention, but no retention job exists |
| 5.10 Typed errors, no internals to clients, structured logs with request ID | **Partial** | error bodies are field-level messages, no stack traces ✔; one `console.error("[command] …")`, **no request ID, no structured logger** |

---

## 5. §7 Feature backlog — detail per ID

Legend: **M** met · **P** partial · **X** missing · **D** deferred. "Evidence" is what I ran.

### Foundation and administration

| ID | St | Evidence / gap |
|---|---|---|
| AUTH-01 | **M** | Setup → login (`200`), `/api/session` scoped, `POST /api/commands` unauthenticated → **401**; sealed cookie, 8-hour TTL, `httpOnly`, `sameSite=lax`, `secure` in production; sign-in throttle 8 failures / 15 min keyed per account **and** per address |
| AUTH-02 | **P** | suspend/reactivate exists (`active` flag, `update_user`); **no invitation or activation flow** — an administrator types the password at creation |
| AUTH-03 | **P** | administrator-initiated `reset_user_password` (also ends existing sessions, D-58); **no self-service reset** (no email channel) |
| AUTH-04 | **P** | role assignment works (`create_user` for operations/finance/driver/client_contact); permissions are `resource:action`, deny-by-default, checked in the service; a non-administrator cannot create or edit users, so no self-elevation path. Company association is a single `clientId` on a client-contact user. There is no dispatcher, fleet-manager, HR-admin, passenger, rental-customer or technician role |
| AUTH-05 | **X** | no profile screen, no "my login history" (`auth:sign_in` goes to the audit log, which only administrators can read) |
| AUTH-06 | **D** | Phase 2; no 2FA |
| AUD-01 | **M** | append-only trigger (DB `on conflict do nothing`, no update/delete), viewer with search. Two caveats: `audit:read` is granted to `operations` and `finance` although the brief says the viewer is for Super Administrators, and the viewer loads only the newest 5,000 rows (older rows remain in the table) |
| SET-01 | **P** | registry holds company name, currency, on-time threshold, vehicle categories, shifts, rental pricing basis, deposit %, quotation validity, drivers-always-included, payment methods, expired-quote policy, document types + lead days, maintenance intervals. **Missing**: tax lines, cancellation windows, boarding-code policy, the contract-expiry booking rule, contract billing frequency/terms. Anything unset blocks its dependent action (verified: `create_vehicle` refused before categories existed; quote refused before tax/deposit settings) |
| MIG-01 | **X** | no CSV code at all (`grep -ri csv src` → only a CSS word) |

### Customers and bus rentals

| ID | St | Evidence / gap |
|---|---|---|
| CUS-01 | **P** | client: name, contact name/email/phone, status. **No** reference, billing details, type, notes, branches, history |
| RNT-01 | **P** | customer, dates, pickup/destination, passenger count, purpose, vehicle category, driver required, notes. **No** departure/return time, intermediate stops, luggage/special needs, trip contact, request source |
| RNT-02 | **P** | `draft → quoted → confirmed → in_progress → completed`, plus `declined`/`cancelled`; invalid transitions rejected and tested. **7 states, not 12** — no Submitted/Under Review/Awaiting Quotation/Quotation Sent/Awaiting Customer Confirmation/Dispatched; no separate quotation or booking entity |
| RNT-03 | **P** | live: wrong category refused, overlapping vehicle/driver refused, expired licence refused, availability computed from reservations. **Capacity is not checked** (see 5.1) |
| RNT-04 | **P** | line items, subtotal, deposit %, valid-until, currency, quote history on requote, expired quote cannot be confirmed (`The quotation has expired…`) nor renewed without the configured policy. **No** quotation number, no version field (revision number is derived from history length), **no tax lines**, no terms and conditions, no approval record |
| RNT-05 | **P** | confirmation validates quote, resources, deposit floor (`Deposit must be at least GHS 420.00` → refused `GHS 300.00`), writes reservations; cancelled rentals release them. **No** customer acceptance record, **no notification**, no payment beyond the deposit |
| RNT-06 | **M** | assign/reassign with validation; every assignment is an audit entry (`RR-0004 assigned vehicle GT-1001 and driver Kofi Mensah.`) |
| RNT-07 | **P** | completion produces a final invoice snapshot with additional charge lines (`GHS 2250.00` = 1800 + 300 + 150 waiting). **No** actual departure/return time, distance, damage/incident notes, customer feedback, outstanding balance, or staff review step |
| RNT-08 | **M** | cancellation records a reason and frees the reservation (verified by re-using the same vehicle/dates afterwards) |
| RNT-09 | **P** | client portal lists own requests, quotation, status; can raise a request (live `RR-0005`). **Cannot accept or cancel**, cannot see payment status as a record (no payments exist) |
| WEB-01 | **X** | no public enquiry endpoint, no embeddable form, no spam protection, no rate-limited public route |

### Fleet and drivers

| ID | St | Evidence / gap |
|---|---|---|
| FLT-01 | **P** | registration, make, model, category, seats, status, notes; odometer readings; insurance/roadworthiness as documents. **No** photo, fuel type, ownership/leasing, usual driver |
| FLT-02 | **P** | statuses `available / maintenance / out_of_service / retired`; blocked vehicle cannot be assigned (live: `Vehicle must be Available to be assigned (currently under maintenance).`). **The brief's 7 states are not modelled** (no reserved/assigned/on-trip/pending-inspection), and no per-date maintenance scheduling (D-15/D-16 say so) |
| FLT-03 | **P** | documents created live with expiry + configurable lead; status computed as valid/expiring/expired. **No reminder is ever sent** (no job, no notification channel) |
| FLT-04 | **P** | licence number, expiry, phone, status. **No** licence class, qualifications, availability calendar |
| FLT-05 | **P** | readiness counts (ready/due/overdue/no-reading) and maintenance-due computation. **No** utilisation, downtime, assigned/on-trip counts, expiring-document total on the fleet view |

### Maintenance

| ID | St | Evidence / gap |
|---|---|---|
| MNT-01 | **P** | live: `WO-0001` raised from an incident with vehicle, work type, priority, date, odometer, workshop, required work, cost lines; transitions `open → in_progress → completed`; completion **refuses** until costs are confirmed (`Confirm the cost position…`). **Statuses are 5, not the brief's 8**; no parts list, inspection results, release information |
| MNT-02 | **P** | live: safety incident took `GT-1001` out of service; work order moved it to maintenance; assignment blocked; completion requires a note and cost confirmation. **No maintenance-technician role exists**, so "a technician cannot self-release" is satisfied only because that role does not exist |
| MNT-03 | **P** | interval rules (km / days / lead) per category, computed from odometer; a passed date never marks work done. **No reminder job** |
| MNT-04 | **D** | Phase 3 |

### Corporate clients, contracts, employees

| ID | St | Evidence / gap |
|---|---|---|
| CLI-01 | **P** | name, contact, phone, email, status. **No** registration details, billing address, branches, notes, history |
| CLI-02 | **X** | no contract entity, no contract status machine, no attachments, no renewal reminders |
| CLI-03 | **P** | client portal limited to own routes, roster (names/stop), rental requests. **No** invoices, contracts, bookings |
| EMP-01 | **P** | "passengers" register: name, phone, employee reference, company, route, stop, status. **No** department, work location, shift, drop-off point, eligibility, accessibility needs, restricted-field marking |
| EMP-02 | **X** | no CSV import, no template, no preview, no duplicate detection |
| EMP-03 | **P** | status toggle and route/stop reassignment. **No** location/shift management, eligibility rules, permitted exports |

### Routes, bookings, trips, dispatch

| ID | St | Evidence / gap |
|---|---|---|
| RTE-01 | **P** | stops have a name and a scheduled time only. **No coordinates, landmark description or Ghana digital address** — an explicit §9 requirement |
| RTE-02 | **P** | reference (`RT-001`), name, client, direction, shift, category, weekdays, date range, ordered stops with monotonic times, status. **No** capacity requirement, expected duration, origin/destination fields |
| RTE-03 | **M** | live: 10 trips generated for a Mon–Fri route across a fortnight, one row per service date, duplicate generation refused by a unique constraint |
| RTE-04 | **X** | no planning aid, no map estimates, no approved stop-order record |
| BKG-01…06 | **X** | there is no booking entity. Journeys are implied by a passenger's route membership; there is no request, approval, cut-off, cancellation window, waiting list, or history of booking changes |
| TRP-01 | **P** | reference, route, service date, ordered stop logs, boardings, driver, vehicle, status, threshold snapshot, completion. **No** service type/rental link, no `ready_for_dispatch` / `delayed` / `interrupted` states |
| TRP-02 | **M** | manifest = route roster with per-stop boarding outcomes; live completion recorded boarded/no-show per passenger |
| DSP-01 | **P** | dashboard shows today's departures and unassigned work; trips tab lists and filters by status. **No** calendar, no capacity warnings, no maintenance-block panel, no full filter set (date/service/company/route/driver/vehicle) |
| DSP-02 | **P** | assign/reassign validates availability, category, licence expiry and time conflicts (all verified live). **No** override-with-reason path |
| DSP-03 | **X** | no emergency one-off trip creation command |
| DSP-04 | **P** | no-show recorded per passenger; `cancel_trip` with reason. **No** delay recording, no interrupt state |

### Driver and passenger interfaces

| ID | St | Evidence / gap |
|---|---|---|
| DRV-01 | **P** | mobile-first driver home: today's/upcoming runs, next departure, route + stops, passenger count, vehicle, history, own documents, own incidents. **No** alerts |
| DRV-02 | **P** | start, record each stop with boarding outcomes, complete. **No** "mark ready", external navigation, report delay, confirm drop-off; **events are not idempotent** (no client event ID, §5.8) |
| DRV-03 | **D** | no boarding codes/OTP (Phase 2) |
| DRV-04 | **M** | driver can report a defect/breakdown/incident; live incident `IN-0001` created |
| DRV-05 | **D** | no offline/PWA queue (Phase 2) |
| PAX-01 | **X** | there is no passenger/employee role or portal. `client_contact` is a corporate contact, not a passenger |
| PAX-02 | **D** | Phase 2 |

### Incidents

| ID | St | Evidence / gap |
|---|---|---|
| INC-01 | **P** | reference, type, severity, vehicle, trip, description, assignment, status, log, costs. **No** driver field, time-of-day, location, restricted "people affected", attachments, responder/resolution fields (partial) |
| INC-02 | **P** | vehicle taken out of service, work order raised, incident stays open. **No** affected-trip/passenger identification, no eligible-replacement listing, no confirmation/swap step, no passenger notification, no assignment history for the replacement |

### Finance

| ID | St | Evidence / gap |
|---|---|---|
| FIN-01 | **P** | rental pricing basis (per day / per km / per trip), free line items, deposit %, discounts? — **no discount field, no tax lines, no waiting/overtime rules, no contract pricing models** |
| FIN-02 | **X** | **no invoice entity at all** — no number, no status, no paid/outstanding, no itemised invoice table, no duplicate-billing constraint. A rental carries a `finalInvoice` JSON snapshot |
| FIN-03 | **P** | the confirmation deposit records amount, method, reference and date. **No** standalone payment register, no verification/reconciliation status, no immutability, no adjustment/correction path |
| FIN-04 | **D** | Phase 3; no provider integration |
| FIN-05 | **P** | cost lines on work orders and incidents (category, description, amount, date). **No** expense register, supplier, method, receipt, approval |
| FIN-06 | **D** | Phase 3 |
| FIN-07 | **X** | no finance dashboard; the finance role sees the general dashboard, with no outstanding invoices, payments or reconciliation |
| FIN-08 | **D** | Phase 3 |

### Notifications, reporting, location

| ID | St | Evidence / gap |
|---|---|---|
| NTF-01…03 | **D** | **no notification code of any kind** (`grep -ri notification|sms|nodemailer src` → 0 hits). "Not configured" is claimed in the architecture doc, which is honest, but Phase 2 is untouched |
| RPT-01 | **X** | no rental report (enquiries, quotations, acceptance rate, revenue, outstanding, utilisation, cancellation reasons) |
| RPT-02 | **P** | one KPI: on-time rate with reporting period, coverage and `insufficient_data` status — correct in spirit (integrity rule 4). Nothing else: no bookings, no-shows, passengers transported, route utilisation, contract performance, downtime, fuel, mileage, document expiry |
| RPT-03 | **X** | no financial reports |
| RPT-04 | **X** | no report filters and **no CSV export anywhere** (the only CSV string in `src` is inside a CSS comment) |
| RPT-05 | **D** | Phase 3 |
| GPS-01 | **D** | no provider interface; correctly not fabricated, but the "provider interface + Not configured" half is also absent |

---

## 6. §6 Roles and permissions

| Requirement | Status | Evidence |
|---|---|---|
| Ten named roles | **Fails** | `ROLES = administrator · operations · finance · driver · client_contact` — 5. No dispatcher, fleet manager, corporate HR administrator, passenger, rental customer, maintenance technician |
| `resource:action`, deny-by-default | **Met** | 69 permissions; `can()` fails closed on an unknown role |
| Checks in the service layer, not middleware/UI | **Met** | live: operations `settings:update` → `Not permitted.`; finance `vehicles:create` → `Not permitted: your role lacks vehicles:create.`; driver `assign_trip` → `Not permitted: your role lacks trips:assign.`; client `confirm_rental`/`update_rental` → not permitted |
| Users cannot grant themselves roles | **Met** | only `administrator` holds `users:create`/`users:update`; last-administrator guard tested |
| Corporate HR sees only own company | **Partly** | client_contact sees only own client's routes/roster/rentals ✔ (live) |
| Rental customers see only their own data | **Partly** | there is no rental-customer role; client_contact's own rental only ✔ |
| Drivers see only their own trips; cannot self-assign or change prices | **Met** | live driver session: 3 of 12 trips, 1 vehicle, 0 clients, 0 audit; no assign/quote permissions |
| Dispatchers cannot change finance settings | **Met** | operations lacks `settings:update` (and there is no finance-settings permission) |
| **Finance has no unrestricted access to operational or personal data** | **Fails** | `finance` holds `passengers:read`, `incidents:read`, `documents:read`, `audit:read`. Live finance session returned **25 passengers with names, employee references and phone numbers** |
| Maintenance technicians cannot release a safety-blocked vehicle without approval | **Not applicable in form** | no technician role; the release path exists for operations/administrator |
| 2FA for privileged roles | **X** | no 2FA |

---

## 7. §8 Core workflows

| Workflow | Verdict | What actually runs |
|---|---|---|
| **A. Recurring corporate staff transport** | **Does not run end to end** | client → route with stops → roster → generate trips → assign → dispatch → start → per-stop boarding → complete, with on-time result, all live ✔. **Missing**: contracts (CLI-02), employee eligibility (EMP-01/03), bookings (BKG-01..04), capacity check (BKG-04), corporate invoicing (FIN-02), staff transport reports (RPT-02) |
| **B. Employee return journey** | **Does not run** | no booking, no return-journey concept; a return leg would be a second hand-built route |
| **C. Bus rental** | **Closest to complete; still not end to end** | request → quote → deposit/confirm → assign → start → complete → final invoice snapshot, all live ✔. **Missing**: public enquiry (WEB-01), invoice entity + payment records (FIN-02/03), approval of additional charges (RNT-07), rental reports (RPT-01), Playwright proof |
| **D. Vehicle breakdown** | **Partial** | driver/ops reports incident → vehicle out of service → work order → maintenance blocked from assignment, live ✔. **Missing**: affected-trip/passenger identification, replacement proposal, passenger notification (INC-02, NTF-01) |
| **E. Maintenance and release** | **Largely works** | work order, blocking, costs, completion, restore to available; audit record of the move. **Missing**: separate approval role, inspection record, MNT-03 reminders |
| **F. Corporate invoicing** | **Does not run** | no contracts, no billable-service records, no invoice entity, no duplicate-billing check, no financial reports |
| **G. Emergency transport** | **Does not run** | no emergency trip creation (DSP-03); a one-off route could be hand-built but that is not the workflow |

---

## 8. §9 Ghana requirements

| Requirement | Status |
|---|---|
| GHS currency | **Met** — `Intl.NumberFormat` with the currency from settings; live amounts `GHS 2250.00` |
| `+233` phone numbers | **Stored as typed**, validated loosely; no format enforcement |
| `Africa/Accra` | **Fails** — no timezone is pinned anywhere; display uses the viewer's OS zone (§5.5) |
| Mobile money as a first-class payment record type | **Partly** — MoMo is a configurable free-text payment method and a deposit method (`momo_mtn` in my seeded data); there is no payment record to be "first class" |
| Configurable tax lines, no hard-coded rates | **Fails** — no tax lines exist |
| Coordinates, landmark, Ghana digital address | **Fails** — stops are name + time |
| Data Protection Act documentation | **Met** — `docs/DATA_PROTECTION.md` (marked draft, needs legal review) |
| Low-end Android / flaky connections | **Partly** — driver portal is mobile-first and light; no offline mode |
| Website enquiry link | **Fails** — no WEB-01 |

---

## 9. §10 Security and privacy

| Requirement | Status |
|---|---|
| HTTPS in production, HSTS | **Adapted** — HSTS is opt-in via `HTTPS=1` (D-59); TLS itself is terminated by the host |
| Secure, expiring sessions; auth abuse protection | **Met** — sealed `httpOnly` cookie, 8 h TTL, throttle per account and address |
| Server-side validation; XSS/CSRF | **Met** — Zod at the boundary, React escaping, same-origin check on commands (D-59) |
| Security headers | **Met** — CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` all observed on `GET /` |
| File uploads restricted | **Not applicable** — no upload feature |
| Protect home addresses, contacts, driver data, incident records | **Partly** — own-record redaction works; **finance and operations receive the full roster with phone numbers**; the client portal's own copy says "Contact details are held by your account manager" while the payload contains them |
| No internals in errors | **Met** |
| Dependency audit in CI, secrets in env | **Met** — `npm audit` in CI (0 findings), `dependency-review`, CodeQL; `.env.example`, no secrets in git |
| Health check, monitoring, backup/restore | **Partly** — `/api/health` returns DB reachability; `db:backup`/`db:restore` scripts exist; no monitoring, no failed-job monitoring (no jobs), no documented restore rehearsal |

---

## 10. §11 Interface standards

| Requirement | Status |
|---|---|
| Navy primary, white/neutral, subtle teal | **Contradicts by owner instruction** — the shipped "Daylight" system is a neutral surface with **one indigo accent `#4453f0`** (owner's Direction E). Recorded here so the deviation is not mistaken for drift |
| Navigation sections (Overview, Corporate Clients, Contracts, Employees, Customers, Rental Requests, Quotations, Bookings, Routes and Schedules, Trips and Dispatch, Drivers, Fleet, Maintenance, Incidents, Finance, Reports, Notifications, User Management, Settings) | **Different IA** — 14 destinations: Dashboard, My runs, My account, Bus rentals, Staff busing, Staff logistics, Fleet readiness, Compliance, Vehicles, Drivers, Clients, Users, Settings, Audit log. **No Contracts, Employees, Bookings, Finance, Reports or Notifications sections** because those features do not exist |
| Role-specific dashboards | **Partial** — one dashboard whose content is permission-filtered and which changes for a driver/client (they get portals); there are no distinct dispatcher / finance / fleet-manager dashboards |
| Every table: loading, empty, error; pagination; search; filters | **Partial** — loading/empty/error states and search are implemented and tested; **no table has pagination**; filters are thin (status/date only) |
| Every form: client+server validation, input preserved, double-submit prevention, destructive confirmation | **Met** — verified in the audit and re-verified live (field-level errors, disabled submits) |
| WCAG 2.1 AA, keyboard, labels | **Met** — skip link, focus trap, 4.5:1 body contrast, tests; the earlier two interface rejections were design, not accessibility |
| Responsive; driver/passenger pages mobile-first | **Met** for driver; no passenger pages |

---

## 11. §12 Testing requirements

| Requirement | Status | Evidence |
|---|---|---|
| Unauthenticated access rejected | **Met** | `POST /api/commands` → 401 live; `api.test.ts` |
| No self-granted roles; cross-company denied on direct API calls (generated per route) | **Partly** | privilege guard tested; **no generated per-route cross-tenant suite** (single tenant) |
| Drivers cannot touch other drivers' trips | **Met** | `visibility.test.ts`; live scoped session |
| Finance permissions behave as defined | **Partly** | writes denied ✔; read scope wider than §6 allows ✘ |
| Full from-to matrix for every stateful entity | **Absent** | per-transition tests only; no exhaustive matrix |
| Valid/invalid/duplicate bookings; capacity never exceeded; conflicting assignments rejected; **parallel requests cannot double-book** | **Partly** | conflicts and duplicates ✔ live; **capacity not enforced**; **no parallel-request test** |
| Rentals: enquiry, arithmetic, expired quote, conflicts, deposit rule, additional-charge approval, cancellation frees resources | **Partly** | arithmetic ✔ (2250 = 1800+300+150), expired quote refused ✔, conflicts ✔, deposit floor ✔, cancellation frees ✔; **enquiry missing, approval missing** |
| Maintenance: lifecycle, blocking, unsafe vehicle not dispatched, release approval | **Met in substance** | live work-order lifecycle, blocking and refusal to complete without cost confirmation |
| Finance: invoice totals, repeated callbacks, balances, no double invoicing, adjustments audited | **Absent** | no invoice/payment entities |
| Reporting: KPIs match `docs/KPIS.md`, filters, isolation, exports | **Absent** | one KPI (on-time) matching its documented formula; no filters/exports |
| Playwright, the 8 listed flows | **Absent** | Playwright is not installed; zero E2E tests |

---

## 12. §13 Definition of done

| Criterion | Status |
|---|---|
| 1. Interface, server logic, validation, persistence, permissions | **Met** for built features |
| 2. Automated tests that passed in this session | **Met** — 203 passed / 5 skipped, re-run today |
| 3. `typecheck`, `lint`, `test`, `build` | **Met** — all four clean |
| 4. Cross-company and permission-denial tests | **Partly** — permission denial yes, cross-company not applicable/absent |
| 5. No dead controls | **Met** in the areas I exercised; unavailable capabilities are labelled ("Not configured", "blocked until management supplies them") |
| 6. `docs/PROGRESS.md` updated **with the feature ID** and real status | **Fails** — PROGRESS is organised by phase and by feature *name*; only three brief IDs (RPT-01, RPT-02, RPT-03) appear anywhere. A reader cannot map the brief to progress |

---

## 13. §15 Deliverables

| Required | Status |
|---|---|
| `docs/ARCHITECTURE.md`, `ERD.md`, `PERMISSIONS.md`, `STATE_MACHINES.md`, `KPIS.md`, `SETUP_AND_DEPLOYMENT.md`, `DATA_PROTECTION.md`, `PROGRESS.md`, `DECISIONS.md`, `OPEN_QUESTIONS.md` | **Present** |
| `docs/API.md` | **Missing** |
| `docs/BACKUP_AND_RECOVERY.md` | **Missing** (backup/restore are described inside SETUP_AND_DEPLOYMENT) |
| `docs/USER_ROLES_GUIDE.md` | **Missing** |
| List of outstanding integrations and known limitations | **Partly** — ARCHITECTURE has a limits section; README points at SETUP §12 (not a §15 replacement) |
| Seed scripts labelled demo data | **Absent by owner instruction** ("no demo data"); the database starts empty — an intentional, documented deviation |
| `.env.example`, migrations, tests, CI | **Present** |
| `STATE_MACHINES.md` covering all nine entities | **Partial** — PROGRESS itself says invoice, contract and incident machines are Not Started |

---

## 14. Phase-gate verdicts (`richie-tms-phase-prompts.md`)

**Phase 0** — deliverables produced, migrations/health/CI/lint present; **hosting verification still "Blocked"** in PROGRESS (Q-01), so section 2 of the Phase 0 prompt was never satisfied. Gate: **partly**.

**Phase 1A** — exit criteria, as written:
| Criterion | Verdict |
|---|---|
| Workflow C end to end **via Playwright** | **Not met** — runs manually end to end minus invoice/payment/enquiry; no Playwright |
| Parallel requests cannot double-book a vehicle or driver | **Not demonstrated** — DB constraint exists and is tested sequentially; no parallel test |
| Cross-role and permission-denial tests | **Met** |
| Quotation and invoice arithmetic tests | **Partly** — quotation yes, **no invoice exists** |
| Safety-blocked vehicle cannot be assigned; release needs approval | **Met** in substance |
| Records persist after logout, login and restart | **Met** |

→ **Phase 1A gate is not met** (Playwright, invoices/payments, WEB-01, MIG-01, RPT-01, parallel test).
Phase 1B and 1C were started anyway, which the brief's §14 explicitly forbids.

**Phase 1B** — **Not met**: no contracts, no CSV import, no bookings, no capacity check, no override-with-reason, no corporate invoicing, no cross-company isolation suite, no trip/booking/contract from-to matrices, no driver-event idempotency. What does exist (routes, trips, manifests, dispatch validation, driver portal) is genuinely good.

**Phase 1C** — **Not met**: no PAX-01, no RPT-01/02/03/04 reports, no FIN-07, no exports, no eight end-to-end scenarios. `SETUP_AND_DEPLOYMENT.md` *was* followed from a clean checkout in an earlier session, which is one of its criteria.

**Phase 2 / 3** — **Not started**, and honestly so.

---

## 15. Contradictions and defects found in this run

### 15.1 Contradictions of the brief (not previously recorded as decisions)

1. **Ten roles → five.** No dispatcher, fleet manager, corporate HR administrator, passenger, rental customer, maintenance technician (§6).
2. **`pg-boss` / scheduled jobs absent and no scheduled endpoints either** (§4). Daily trip generation, reminders and retention have nowhere to run.
3. **No Playwright** (§4, §12) — the eight required flows have no automated proof.
4. **`src/modules/<domain>/…` not followed** and no decision record explains the `src/tms` + `src/server` layout (§4).
5. **References are counters, not sequences with a year** (`RR-0001` from `rentals.length + 1`) (§5.6).
6. **Money is arithmetic in JS floats** despite `numeric(14,2)` columns (§5.4).
7. **No `status_history` rows with from→to**; history is per-entity JSON plus an audit row without a status pair (§5.3).
8. **No `Africa/Accra` display pinning** (§5.5, §9).
9. **Audit log has no IP address** (§5.7).
10. **No idempotency keys for driver events** (§5.8) — this also blocks Phase 2's offline work.
11. **Finance can read the whole employee roster with phone numbers** (§6 "no unrestricted access to operational or personal data"). Verified live: 25 passengers returned to the finance session.
12. **Seat capacity is never enforced** (§5.1, §12 "capacity never exceeded"). Verified live: 25 staff on a 22-seat Coaster, assigned without complaint.
13. **`docs/PROGRESS.md` is not tracked per feature ID** (§13.6, §14).
14. **Three §15 documents are missing**, and `STATE_MACHINES.md` omits three of the nine entities.

### 15.2 Defects found by driving the running app

| # | Defect | Reproduction | Impact |
|---|---|---|---|
| 1 | **No service-date guard on starting work** | `start_rental` on `RR-0001` (start date **2026-11-02**) succeeded on **2026-10-24**; `start_trip` on `TR-0001` (service date **2026-10-26**) succeeded on 2026-10-24 | A rental or run can be "in progress" weeks early; the only precondition is status + assignment |
| 2 | **Never checks seats against passengers** | 25 active passengers on `GT-1001` (22 seats) → `assign_trip` → *"TR-0002 assigned."* | Overloading is invisible; contradicts §5.1 and §12 |
| 3 | **Client portal discloses staff contact details** | client session `/api/session` returns each passenger's `phone` and `employeeRef`, while `ClientPortal.tsx` says "Names and pickup stops only. Contact details are held by your account manager." | The interface's own privacy claim is false |
| 4 | **Finance read scope** | finance session returns 25 passengers incl. `+233203334444` | §6 least-privilege breach |
| 5 | **No invoice or payment record** | `record_payment` → `Unknown command.`; the only money trail is `deposit` and `finalInvoice` JSON on the rental | No invoice number, no paid/outstanding, no immutability, no reconciliation, and reports have nothing to reconcile against |
| 6 | **No pagination on any table** | `grep -rn "pagination\|pageSize"` → 0 hits | §11 unmet; the app will not hold a real fleet's data |
| 7 | **Stale documentation of the shipped interface** | `docs/PROGRESS.md` Phase 14 still describes "bright editorial", "front page", "numbered contents strip", "masthead", "rubric"; `src/index.css` keeps a "ledger tables" comment and per-route `--rubric` colours; `package.json` description and the README title say **"Transport Management Ledger"** | The owner banned that vocabulary and the editorial direction; docs and metadata still carry it |
| 8 | **Dead dependency** | `@fontsource-variable/fraunces` is installed but nothing imports it | Unused install weight |

Observation, not a defect: `GET /` is served with `Cache-Control: s-maxage=31536000`. The HTML is a
shell and all data is fetched after authentication, so this is not a data leak — but any future
server-rendered, session-dependent content must not inherit that header.

---

## 16. What would make it conform (in the brief's own order)

1. **Close Phase 1A before anything else** — `docs/API.md`, `BACKUP_AND_RECOVERY.md`, `USER_ROLES_GUIDE.md`; invoice + payment entities with numbers, statuses, immutability and a unique billable-event constraint; the rental report; the public enquiry endpoint; CSV import; a Playwright suite for workflow C; a parallel-request double-booking test.
2. **Fix the four live defects**: service-date guards, seat-capacity enforcement, finance read scope, client-portal field redaction.
3. **Then Phase 1B**: contracts, employees with eligibility, bookings with capacity under a transaction, dispatch override-with-reason, corporate invoicing; add the remaining five roles as the permissions they need.
4. **Then the invariants**: sequence-backed references (`QTE-2026-0001`), `status_history`, integers/`NUMERIC` in the domain layer instead of floats, `Africa/Accra` display, IP in the audit log, idempotency keys.
5. **Then the job runner** (`pg-boss` or documented scheduled endpoints) so reminders, retention and daily generation stop being fiction.
6. **Re-cut `docs/PROGRESS.md` per feature ID** with the six statuses from §14, and re-state Phase 14 as the shipped Daylight interface.

*No application code was changed in producing this report.*
