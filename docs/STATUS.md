# Where this system stands

One page, in plain words, for anyone who does not want to read the phase log.

## The short answer

**The core of the system is built and working.** Everything a transport office needs for a day's
work — vehicles, drivers, customers, bus rentals from enquiry to paid invoice, staff bus runs,
logistics, reports, the public enquiry form — is built, enforced on the server, and tested.

**It is not "everything in the brief".** The brief describes a larger product with three further
stages of work (contracts and bookings, notifications and GPS, payment integrations and payroll).
Those are named below, marked as not built, and were never part of this build's agreed scope.

Two different things are called "phase" in this repository, which is why the question is confusing:

| "Phase" | What it means | Where it stands |
|---|---|---|
| **Phases 0–30** (`docs/PROGRESS.md`) | The order in which *this build* was delivered — inspect, foundation, rentals, busing, logistics, the server rewrite, invoices, money, the seven queued policy answers, and so on | **All 31 closed**, each with its own evidence and gate run. Two carry a named open item: Phase 19's Playwright substitute (D-68) and Phase 20's live-database repeat |
| **Phases 1A, 1B, 1C, 2, 3** | The brief's own grouping of requirements (its roadmap) | **1A built · 1B partial · 1C partial · 2 and 3 not started** |

So: no delivery phase failed. What is unfinished is the brief's later roadmap, not this build's work.

## By the brief's phases

| Phase | What it covers | Verdict |
|---|---|---|
| **1A** — foundation | Sign-in and sessions, roles and permissions, settings, audit log, vehicles, drivers, clients, documents, rental requests → quotation → deposit → assignment → completion, invoices and payments, CSV import, maintenance, the public enquiry form, rental report | **Built.** 29 requirement IDs: 9 fully met, 20 met but narrower than the brief, **0 unbuilt** |
| **1B** — busing and dispatch | Routes, rosters, trip generation, dispatch, driver portal, manifests, no-shows, on-time reporting | **Mostly built.** 25 IDs: 5 met, 11 partial, 9 not built — the 9 are seat-level bookings (BKG-01…06), contracts, the route planning aid and emergency trip creation |
| **1C** — portals and reports | Customer portal, passenger portal, finance dashboard, financial reports | **Partly built.** 6 IDs: 4 partial, 2 not built (passenger portal, finance dashboard) |
| **2** — notifications, GPS, offline | SMS/email, in-app notifications, GPS tracking, driver app offline mode, boarding codes, two-factor sign-in, richer incidents | **Not started.** 11 IDs: 8 deferred, 3 partial (maintenance reminders, the two incident workflows) — the rest need a phone/SMS provider and hardware |
| **3** — money integrations | Card/mobile-money gateway, expenses with receipts, payroll, reconciliation, PDF reports | **Not started.** 7 IDs, 6 deferred, 1 partial (cost entries without receipts) |

Totals across all 78 brief requirements: **14 met · 39 partial · 11 not built · 14 deferred.**

"Partial" is not a failure mark. It means the system does the job, but does less than the brief's
full paragraph — for example it tracks a driver's licence expiry, but not a licence class.

## What works today, in plain words

- Sign in with a role; five roles, each with a different set of permissions; every attempt recorded.
- Company settings that start empty — nothing is invented, and a feature stays blocked until the rule
  it needs is set (tax position, deposit %, payment terms, vehicle categories).
- Vehicles, drivers, corporate clients, compliance documents with expiry dates, odometer, service
  intervals and a fleet-readiness view. A vehicle past its service interval is named to the
  dispatcher before it is chosen, and can be blocked outright with one setting; a safety defect
  always takes it off the road.
- CSV import for vehicles, drivers, clients and staff rosters: preview first, every rejected row
  named by line number, nothing merged or silently dropped; a rider who looks like someone already
  on the roster is flagged **Check** rather than refused.
- Bus rentals: request → quotation (with revisions) → deposit → vehicle and driver assignment →
  start → completion → invoice → payments. **A vehicle cannot be booked twice** — the database
  itself refuses, and six simultaneous attempts give one winner and five refusals.
- Invoices numbered per year, with your tax lines, discounts, due dates, voiding, part payments and
  exact settlement. Money is computed in whole pesewas with one rounding rule.
- Staff busing: routes, rosters, trip generation, dispatch, progressive boarding capture, on-time
  reporting, mid-run passenger changes with a seat-capacity check.
- Staff logistics: incidents, work orders with costs, and a vehicle release that needs its own
  permission and records who released it and when.
- Reports: rental report with a date range, coverage and CSV; fleet readiness; cost report;
  financial report (revenue by customer, payments received, outstanding at the period end, expenses
  by category, cost per trip and per passenger) with CSV.
- A public enquiry form that can be embedded on the company website — throttled, spam-trapped, and
  it creates a draft request without exposing any data.
- Driver and client portals showing only their own records.

## What is not built

**Whole features absent** (11 brief IDs):

| Missing | What it means in practice | Why |
|---|---|---|
| Bookings (BKG-01…06) | Passengers cannot book a single seat on a scheduled run with a booking reference; journeys are modelled as a route roster and a trip | Phase 1B; a booking entity is a project of its own |
| Contracts (CLI-02) | No contract record, so corporate terms live in the quotation and the invoice rather than in an agreement with dates and a status | Phase 1B; needs the owner's contract wording |
| Route planning aid (RTE-04) | Dispatchers choose vehicles manually; nothing suggests a plan | Phase 1B |
| Finance dashboard (FIN-07) | Finance sees the operations dashboard; there is no money-only home screen | Phase 1C |
| Passenger portal (PAX-01) | Passengers cannot sign in to see their own journeys | Phase 1C |
| Emergency trip creation (DSP-03) | A trip exists only if a route generates it | Phase 1B |

**Deferred to Phase 2/3** (14 IDs): SMS and email, in-app notifications, GPS tracking, two-factor
sign-in, offline driver mode, boarding codes/OTP, payment gateway, payroll and driver allowances,
receipts on expenses, PDF reports. These need a provider, hardware or a decision the owner has not
made, so they are recorded rather than half-built.

**Blocked by a missing provider**: email invitations and self-service password reset. An
administrator creates accounts and resets passwords; there is no mail server, so nothing pretends to
send mail.

## The honest middle: built, but narrower than the brief

These work, and the difference is worth knowing before relying on them:

- **Driver register** — licence number and expiry, not licence class or qualifications.
- **Vehicle statuses** — four (available, maintenance, out of service, retired), not the brief's
  seven; "reserved" and "on trip" are derived from assignments rather than stored.
- **Rental request** — dates, not departure and return times; no intermediate stops or luggage notes.
- **Quotations** — line items, deposit and validity, but no quotation number, tax line or discount
  line (those live on the invoice).
- **Customer register** — several named contacts per client, one marked primary; still not billing
  details, credit terms or a customer type.
- **Work orders** — five statuses, no parts list or inspection record; the release step is complete.
- **Rental report** — eight figures with CSV; other reports do not yet share its filters and export.

## How this is proved, not asserted

- `npm run typecheck`, `npm run lint`, `npm test` (**328 passed, 14 skipped**), `npm run build` — all
  green on the current commit, and re-run in this check.
- 14 integration tests against real PostgreSQL in CI, including six operators racing for one vehicle.
- `npm run e2e` — 39 checks against the built, started application over HTTP.
- The trial on real data: §1–§10 passed on a copy of the database on 2026-10-25 (recorded in
  `docs/REAL_DATA_TRIAL.md` §10), including the invoice arithmetic checked to the pesewa.
- The conformance audit (`audit/SPEC-CONFORMANCE-2026-10-24.md`) lists every defect it found; **all
  four are fixed**, with the last two — reference numbers and money — each recorded as a decision
  (D-71, D-72) with the alternative that was rejected.

## What is worth doing next, in order of value

1. **Repeat the trial's §5–§8 on the live database** (port 3000). The copy passed; this is the step
   that says the system is ready for a working day.
2. **Credit notes** — a wrong invoice can be voided, but a part refund or adjustment cannot yet be
   corrected in-app. This is the largest gap in the money story.
3. **EMP-02: import the passenger roster from CSV** — routes and rosters are typed by hand today,
   and the import machinery already exists to build on.
4. **RPT-03 / FIN-07** — the financial reports and the finance home screen.
5. **Bookings and contracts (Phase 1B)** — the only genuinely large piece left: six booking IDs and
   the contract record they depend on, and the one change that adds to the data model rather than
   building on it.

Everything else on the missing list needs a provider (SMS, mail, GPS, card payments), hardware, or a
business decision that has not been made.
