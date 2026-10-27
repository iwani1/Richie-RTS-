# Where this system stands

One page, in plain words, for anyone who does not want to read the phase log.

## The short answer

**The core of the system is built and working.** Everything a transport office needs for a day's
work — vehicles, drivers, customers, bus rentals from enquiry to paid invoice, staff bus runs,
logistics, reports, the public enquiry form — is built, enforced on the server, and tested.

**It is not "everything in the brief".** The brief describes a larger product with further stages of
work (notifications and GPS, payment integrations and payroll). Those are named below, marked as not
built, and were never part of this build's agreed scope.

Two different things are called "phase" in this repository, which is why the question is confusing:

| "Phase" | What it means | Where it stands |
|---|---|---|
| **Phases 0–69** (`docs/PROGRESS.md`) | The order in which *this build* was delivered — inspect, foundation, rentals, busing, logistics, the server rewrite, invoices, money, the queued policy answers, then the requirement IDs one at a time — and so on | **All 68 phase headings closed**, each with its own evidence and gate run. Two carry a named open item: Phase 19's Playwright substitute (D-68) and Phase 20's live-database repeat |
| **Phases 1A, 1B, 1C, 2, 3** | The brief's own grouping of requirements (its roadmap) | **1A built · 1B partial · 1C partial · 2 and 3 not started** |

So: no delivery phase failed. What is unfinished is the brief's later roadmap, not this build's work.

## By the brief's phases

| Phase | What it covers | Verdict |
|---|---|---|
| **1A** — foundation | Sign-in and sessions, roles and permissions, settings, audit log, vehicles, drivers, clients, documents, rental requests → quotation → deposit → assignment → completion, invoices and payments, CSV import, maintenance, the public enquiry form, rental report | **Built.** 24 requirement IDs: 13 fully met, 11 met but narrower than the brief, **0 unbuilt**. The fleet dashboard arrived in Phase 62 — totals and the state of every bus today, utilisation over a period in vehicle-days, downtime from the work orders, and idle days priced only at the standing cost management sets. The fleet register became whole in Phases 57–59: what the bus runs on, whose it is, its usual driver, a photograph kept in a folder of its own, and the seven states the brief asks for — four typed by the office, three read from the runs |
| **1B** — busing and dispatch | Routes, rosters, trip generation, dispatch, driver portal, manifests, no-shows, seat bookings, on-time reporting, corporate agreements, a planning aid | **Built, with narrower registers than the brief.** 25 IDs: 16 met, 9 partial, **0 not built**. The client dashboard became whole in Phase 64 (D-114): a corporate contact now reads its own invoices and what is still owed on them. Contracts arrived in Phase 46 (a transcribed term, the lifecycle, renewals, a booking gate) and the planning aid in Phase 47 — ranked pairs that explain themselves, with no geometry because no stop has a position — and the dispatch board in Phase 65, which reads a whole day and changes nothing |
| **1B** — a run that is late | A delay is reported while the run is out: minutes behind the timetable, why, who said it — on the dispatch sheet, the driver's screen, the client's portal and the rider's page (Phase 56, D-105) | **Built.** The newest report is the current one, a run can say it caught up (`0`), and nothing is edited afterwards. The transport report still measures lateness from the stop times afterwards; the two are different facts and both are shown |
| **1C** — portals and reports | Customer portal, passenger portal, finance dashboard, staff transport and financial reports | **Built.** 6 IDs: 3 met (finance dashboard, passenger portal, staff transport report), 3 partial (the customer portal, the financial report's service column, its filters), **0 not built**. The passenger portal arrived in Phase 48 — a rider's own journeys, seats and references, with the bus's position honestly absent because nothing records one. The staff transport report arrived in Phase 50 — runs worked, riders carried, no-shows, the gap nobody recorded, empty seats, delays where they were measured, and the seats people asked for |
| **2** — notifications, GPS, offline | SMS/email, in-app notifications, GPS tracking, driver app offline mode, boarding codes, two-factor sign-in, richer incidents | **Not started.** 10 IDs: 7 deferred, 3 partial (maintenance reminders, the two incident workflows) — the rest need a phone/SMS provider and hardware |
| **3** — money integrations | Card/mobile-money gateway, expenses with receipts, payroll, reconciliation, PDF reports | **Started.** 7 IDs: 2 met, 5 deferred. Met: expenses with a receipt number, whether the paper is held **and, since Phase 51, the scanned copy itself** (kept in a folder on the office machine for three years, open to finance and administrators only), and the **printed management report** (a document the browser prints or saves as PDF — no stored file, no email) |

Totals across all 72 brief requirements: **34 met · 26 partial · 0 not built · 12 deferred.**

The register counts its own rows. The brief carried 78 requirement IDs when the register was opened
and 72 after later IDs were merged into their neighbours; the total follows the table in
`docs/PROGRESS.md` rather than the older number.

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
- **A fleet register that describes the bus**: what it runs on, whether it is ours, whose it is when
  it is not, which driver habitually takes it out, and **a photograph** — one picture per vehicle,
  kept in a folder of its own and copied with the nightly backup, added or replaced from the register,
  and taken off with a reason that is written into the audit log. Nothing is assumed: an ownership
  nobody has recorded stays unrecorded rather than calling a hired bus ours, and the register counts
  the buses with no fuel type, no ownership and no photograph instead of looking complete.
- CSV import for vehicles, drivers, clients and staff rosters: preview first, every rejected row
  named by line number, nothing merged or silently dropped; a rider who looks like someone already
  on the roster is flagged **Check** rather than refused.
- **A quotation a customer can name**: its own number (`QUO-0001`), a revision when it is renewed,
  the terms the company wrote for itself, and a validity counted to the minute rather than to midnight.
- **A request records the journey the customer asked for**: the times, the stops on the way, the
  luggage, the special needs, who to ring on the day, and how the enquiry reached the office — with a
  same-day hire that comes back before it leaves refused rather than quietly swapped.
- **A completed hire records the journey**: when the vehicle left and came back (to the minute), the
  distance from its odometer — or a distance typed and marked as typed — the damage that came back, and
  what the customer said, beside what the hire cost and what is still owed on it.
- Bus rentals: request → quotation (with revisions) → **the customer's own yes, recorded once and
  against that quotation** → deposit → vehicle and driver assignment → start → completion → invoice →
  payments. Agreeing is not paying: the deposit is still what confirms the hire, and nothing here
  sends the customer a message, because there is no mail channel. **A vehicle cannot be booked
  twice** — the database itself refuses, and six simultaneous attempts give one winner and five
  refusals.
- Invoices numbered per year, with your tax lines, discounts, due dates, voiding, part payments and
  exact settlement. Money is computed in whole pesewas with one rounding rule.
- **A refund record**: money actually paid back to a customer is its own numbered document with a
  date, a method and a reason, capped at what is still owed back, cancellable once, stated on the
  invoice, the customer statement, the money report and the finance home — instead of being booked as
  a plain expense that lost the customer and inflated the month's costs.
- **Debt by age** on the finance home: everything still owed, across every customer, in the bands a
  statement prints (not yet due, 1–30, 31–60, over 60 days), with the customers behind it — so "how bad
  is the debt?" is one glance rather than a column added up by hand.
- **A customer statement**: one customer's whole account for a period — what was charged, paid and
  credited, the balance carried in and out, and how old the money still owed is (not yet due, 1–30,
  31–60, over 60 days). It prints as the sheet you send when you chase a debt, and it refuses to add
  two currencies together or to state an account with nothing to state.
- **Correcting a payment**: a figure keyed against the wrong invoice, or for money that never arrived,
  can be cancelled with a reason. The record keeps its number and stays in the list, the amount stops
  counting as received, and the invoice goes back to what it actually owed — in the reports and on the
  printed sheet as well as on the screen. It is a one-way door, and a payment already matched to the
  bank statement warns what the match will be short by before it is cancelled.
- **A scanned copy of a receipt**, filed against an expense rather than kept in a shoebox: the image
  lives in a folder on the office machine, is kept three years, is copied to the backup every night,
  and can be opened only by finance and administrators. A wrong scan is taken off with a reason and
  stays on the record, so an auditor's question has an answer. The register counts the entries still
  without one.
- **Expenses**: money spent that is not a repair — fuel, tolls, permits, rent, allowances — entered
  from the receipt with the number printed on it and whether the paper is actually in the file. Each
  entry is numbered (EXP-2026-0001), never edited: a wrong one is voided with a reason and entered
  again, so a report built on the old figure stays explainable. It counts in the same cost figure the
  cost tab and the money report use, and the report states how much spending has no receipt number at
  all. **The scanned copy is stored** beside the entry (Phase 51, D-100) — see the bullet above.
- **Printable documents**: an invoice and each credit note print as a formatted A4 sheet, or save as a
  PDF from the browser's own print dialog. The printed amount due is the same figure the screen shows,
  a void document says so in words before any figure, and a statement prints money paid back as its
  own line with the refund's number, so the customer can trace the receipt.
- **Credit notes** for an invoice that has already gone out: a numbered document (CN-2026-0001) that
  takes money off one invoice — an overcharge, a hire partly not delivered, a late goodwill discount.
  It carries the invoice's own tax, leaves the payments exactly as recorded, can be voided with a
  reason, and can never exceed the bill. If it takes the bill below what the customer already paid,
  the screen says a refund is due rather than hiding it. The invoice screen, both money reports and
  the finance home all use the one balance rule, so they cannot disagree.
- Staff busing: routes, rosters, trip generation, dispatch, progressive boarding capture, on-time
  reporting, mid-run passenger changes with a seat-capacity check, and a run created outside the
  schedule when a bus fails or a one-off movement appears — with a written reason, and checked
  exactly as a planned run is.
- Seat bookings for the people who are not on the roster — a visitor, a new hire, somebody from a
  sister company. Each booking carries its own reference (BK-0001) and its own history; seats are
  counted as roster + bookings against the vehicle, a full run puts the request on a waiting list,
  and a freed seat is **offered** to the oldest waiter and confirmed by a person, never by the
  system. A booked seat is a person on that run's list: the driver sees who to collect and where, and
  the run cannot be completed until somebody records whether they travelled. Request and cancellation cut-offs are optional settings: blank means no deadline.
- Staff logistics: incidents, work orders with costs, and a vehicle release that needs its own
  permission and records who released it and when.
- **A printable management report**: the same figures the Reports screen shows — a period, eight key
  numbers, revenue by customer and by service, costs by category, money credited and refunded, why
  hires were lost, fleet utilisation and the per-unit costs — laid out as an A4 document and printed
  or saved as a PDF from the browser. It is built from the reports on the screen, so the paper can
  never disagree with them; an amount that cannot be stated is printed as "Not stated" with the reason
  on the page rather than as a zero, and the coverage counts travel with it.
- **A staff transport report**, as its own tab beside the hire report: runs promised, worked and
  cancelled, riders carried out of those expected, no-shows, the riders nobody recorded, boarding
  rate, occupancy measured against the seats of the bus that ran, delay averaged over the stops that
  were actually late, the on-time rate the busing screen shows, seats asked for by status, why seats
  were lost, and per-route and per-client tables — with a card naming the four things the records
  cannot say. CSV of the same figures.
- Reports: rental report with a date range, coverage and CSV; fleet readiness; cost report;
  financial report (revenue by customer, payments received, outstanding at the period end, expenses
  by category, cost per trip and per passenger) with CSV.
- A public enquiry form that can be embedded on the company website — throttled, spam-trapped, and
  it creates a draft request without exposing any data.
- A finance home: what came in and went out in a chosen period, who is late paying and by how many
  days, which completed hires have no invoice yet, and which payments still need verifying. The
  period figures are the same ones the Reports screen produces, and a margin is shown only when both
  sides of the account are complete for that period — otherwise the screen says what is missing.
- Driver, client and **rider** portals showing only their own records. A client contact sees its own
  account: what has been billed, what came in, what was credited and what is still owed, with the
  invoices, payments, credit notes and refunds behind those figures and another customer's absent by
  construction (Phase 64, D-114). A rider signs in to one page:
  the next run with its pickup stop and time, the bus to look for, every seat it holds with its
  booking reference, whether the seat is only requested, waiting, held, assigned to a bus, under way,
  or already travelled — and its own history. It can ask for a seat on another of its company's runs
  (with the office's reason printed on the ones it may not), cancel a seat inside the cut-off, and
  report a problem with a journey, which reaches operations as an incident against that run. **Where
  the bus is, the page does not pretend to know**: no map and no arrival countdown, because nothing in
  this build records a position (PAX-02).

## What is not built

**Whole features absent** (none in Phase 1A–1C). Every brief requirement in the three delivered phases
is now built at least in part; what remains is the deferred Phase 2/3 work below.

**Deferred to Phase 2/3** (14 IDs): SMS and email, in-app notifications, GPS tracking, two-factor
sign-in, offline driver mode, boarding codes/OTP, payment gateway, payroll and driver allowances,
receipts on expenses. These need a provider, hardware or a decision the owner has not made, so they
are recorded rather than half-built.

**Blocked by a missing provider**: email invitations and self-service password reset. An
administrator creates accounts and resets passwords; there is no mail server, so nothing pretends to
send mail.

## The honest middle: built, but narrower than the brief

These work, and the difference is worth knowing before relying on them:

- **Compliance reminders** — papers that are running out are listed on their own card and on the
  dashboard, and somebody can take a renewal on with a note and the date they expect the new paper,
  recorded in the audit log. Nothing is emailed or texted: there is no provider (Phase 2), and the
  screen says so. A reminder is a record of who is dealing with it, not a message.
- **Driver register** — licence number, expiry, the classes printed on the licence and the
  certificates held, with dispatch refusing a driver whose class does not cover the vehicle once the
  office has said which classes a vehicle category needs. A qualification is **recorded, not
  enforced** — which job needs which certificate is Q-52.
- **Vehicle statuses** — all seven of the brief's states since Phase 59 (D-109), but only four are
  stored: Reserved, Assigned, On Trip and Pending Inspection are read from the runs, the hires and the
  work orders. That is deliberate — a stored copy would disagree with the records — and the register
  shows the office's word beneath the state whenever the two differ.
- **Rental request** — dates, not departure and return times; no intermediate stops or luggage notes.
- **Stops** — a name, a time, a landmark, a Ghana Post GPS address and decimal coordinates, with what
  is missing counted on the routes screen. There is no map inside the program: the driver gets a
  plain maps link when a stop has a position.
- **Quotations** — line items, deposit and validity, but no quotation number, tax line or discount
  line (those live on the invoice).
- **Customer register** — everything a document needs and a company's shape: the office's own customer
  code, organisation/individual, a registration number and date, a billing address, a tax number, notes,
  named **branches** (address, person, phone, open or closed) and a per-customer history, with the
  agreement in force stated on the row. Still not credit terms, a credit limit or a separate billing
  contact per branch: an invoice prints one billing address, the customer's own.
- **Work orders** — five statuses, no parts list or inspection record; the release step is complete.
- **Reports and exports** — every report has a date range and a CSV, and the finance home, a customer's statement, the fleet dashboard and the expenses screen now export too; what is still missing is one bar that narrows a report by client, route, driver or vehicle, because a filtered figure is not the company figure and needs its own definition.
- **Credit notes** — one line each, typed before tax (the tax follows from the invoice). A note cannot
  carry several lines from the screen yet, and a refund that is actually paid out is recorded as an
  ordinary expense, because there is no cash book.
- **Cancelling a payment** — it says the money was never received. Giving real money back is still a
  credit note with a refund stated on it, and the refund itself is an expense; there is no refund
  record and no cash book.

## How this is proved, not asserted

- `npm run typecheck`, `npm run lint`, `npm test` (**1225 passed, 28 skipped**), `npm run build` — all
  green on the current commit, and re-run in this check.
- Integration tests against real PostgreSQL in CI, including six operators racing for one vehicle,
  the database refusing to credit an invoice past its own total, the database refusing to un-cancel a
  payment or to cancel one without a reason, and the database refusing to rewrite an approved
  contract's terms or delete a contract at all.
- `npm run e2e` — 39 checks against the built, started application over HTTP.
- The trial on real data: §1–§10 passed on a copy of the database on 2026-10-25 (recorded in
  `docs/REAL_DATA_TRIAL.md` §10), including the invoice arithmetic checked to the pesewa.
- The conformance audit (`audit/SPEC-CONFORMANCE-2026-10-24.md`) lists every defect it found; **all
  four are fixed**, with the last two — reference numbers and money — each recorded as a decision
  (D-71, D-72) with the alternative that was rejected.

## What is worth doing next, in order of value

1. **Repeat the trial's §5–§8 on the live database** (port 3000). The copy passed; this is the step
   that says the system is ready for a working day.
2. **The agreement's own words** — contracts are built (CLI-02, Phase 46) and bookings are gated on
   them, but the pricing basis, billing frequency and payment terms are free text the office types
   from the signed paper. The owner should decide the wording those four fields usually carry, so a
   clerk is choosing rather than composing (Q-13).
3. **Sending the documents** — an invoice, a credit note, a statement and the management report now
   print or save as a PDF from the browser, but nothing is emailed and no copy is stored: sending one
   is still a manual step, because there is no mail server and nowhere agreed to keep a file (Q-51).
4. **How long a file is kept** — scanned receipts (Q-51) now live in a folder for three years and a
   vehicle photograph (Q-18) in a folder of its own, but how long an unindexed photograph, or a stored
   PDF of a document, should stay is still the owner's decision. Nothing deletes a file on the strength
   of a screen action in the meantime.

Everything else on the missing list needs a provider (SMS, mail, GPS, card payments), hardware, or a
business decision that has not been made.
