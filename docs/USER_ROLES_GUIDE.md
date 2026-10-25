# User roles guide

This guide is for the people who run Richie Transport Services day to day. It says what each role
can do, what it deliberately cannot do, and what to do when a screen says it is blocked.

The permission matrix in `docs/PERMISSIONS.md` is the technical record. This document is the same
information in the language of the business.

---

## The five roles

| Role | Who it is for | What they do |
|---|---|---|
| **Administrator** | the owner, or one trusted deputy | everything: accounts, settings, all records, the audit log, backups |
| **Operations / dispatch** | the person who runs the day | vehicles, drivers, rentals, routes, trips, dispatch, passengers, incidents, maintenance, documents |
| **Finance** | the person who bills and reconciles | quotations' confirmation step, invoices, payments, costs, the rental report |
| **Driver** | a driver, on their own phone | their own runs only: open a trip, board passengers, record a no-show, complete, report a defect |
| **Client contact** | a corporate client's office | their own client's routes, roster, agreement and rental requests; can raise a request, not confirm one |

There is one installation per company. Nobody signs in and sees another company's data, because there
is no other company in the database.

### Who approves what

- **Quotations** are prepared by finance or an administrator and confirmed by finance. Operations can
  prepare a quotation but not confirm it — the person who dispatches the vehicle is not the person who
  takes the money.
- **Invoices** are issued, voided and paid through the finance role only. Operations completes a
  rental, which produces the line items to bill, and then stops.
- **Settings** are administrator-only. This matters, because most blocks in the application exist
  because a setting has no confirmed value (see below).

---

## Administrator

**Can:** create, suspend and reactivate accounts; reset passwords; everything operations and finance
can do; read the audit log; export a redacted backup for review.

**Cannot:** see a password (only reset it). Cannot delete an account, a rental, an invoice or an audit
entry — records are archived by status, never removed.

**Typical first hour with a new installation:**

1. Open the application. While no account exists it asks for the first administrator: give the owner's name, email and a password of at least the configured minimum.
2. **Settings** — set the company name, currency, vehicle categories, payment methods, deposit
   percentage, quotation validity and on-time threshold. Everything left blank stays blank, and the
   feature that needs it stays blocked.
3. **Users** — add the operations and finance accounts, then the drivers and client contacts.
4. **Fleet** — add vehicles and drivers (or import them from CSV in **Vehicles → Import**).
5. **Settings → Invoicing** — set the tax position and payment terms. Invoices cannot be issued until
   these are set, on purpose.

**What the audit log shows:** who did what, when, and to which record, as a sentence. It does not show
IP addresses. Entries cannot be edited or deleted by anyone, including an administrator.

---

## Operations / dispatch

**Can:** add and edit vehicles and drivers; record odometer readings; create rental requests, quote
them, dispatch and complete them; create routes and stops; generate trips; assign vehicles and
drivers; create and manage passengers; report incidents, advance them, record costs; create work
orders, advance them, record costs; record compliance documents; draft a client's agreement, approve
it, suspend it or end it with a reason; read the audit log.

**Also sees, but cannot change:** the **Expenses** screen. Fuel, tolls and permits are part of what a run
costs, so operations reads them; entering or voiding that spending is the finance officer's job, and
the button is simply not offered.

**Cannot:** confirm a rental or take a deposit; issue an invoice or record a payment; record or void an
expense; change the terms of an agreement that has been approved (a change is a new agreement);
change settings; create accounts.

**The dispatch day:**

1. **Staff busing → Trips** — the day's runs. Assign a vehicle and a driver; the screen refuses a
   vehicle that is too small for the roster, already on another run at that time, assigned to a
   rental that day, under maintenance or out of service.
2. **Dispatch** — once the vehicle and driver are settled. Dispatch re-checks everything, so a roster
   that grew after assignment is caught before the vehicle leaves.
3. The driver starts and records each stop from their phone. You can watch boarding as it arrives.

**Blocked vehicle?** A safety defect blocks it. It stays blocked until the work order is closed and
the vehicle's status is moved back — record who released it in the work order note, and do not let
the person who reported the defect be the only sign-off.

---

## Finance

**Can:** see rentals, clients, vehicles, trips, incidents and maintenance costs; prepare quotations;
confirm rentals and record the deposit; issue and void invoices; record payments and advance them to
verified and reconciled; cancel a payment recorded in error; issue and void credit notes; pay money
back to a customer and cancel a refund recorded in error; record spending that is not a repair — fuel,
tolls, permits — and void a wrong entry with a reason; print invoices, credit notes and statements;
read the rental report. **Lands on the Finance screen**, which is where the
money work starts: money in and out for a period, who is late paying and by how many days, completed
hires nobody has invoiced yet, and payments still to verify or reconcile. The "Margin" figure appears
only when both sides of the period are complete (an invoice and a cost line in the period, and no
completed hire left unbilled); when it says "Not available", the reason under it says what is missing.

**Cannot:** see the employee roster, staff phone numbers, vehicle or driver documents, accounts, or
the audit log. This is not a display choice: those collections are removed from the data the finance
session receives (D-60).

**Billing a rental:**

1. Operations completes the rental, recording what was actually supplied.
2. **Invoices → Issue an invoice** — choose the completed rental. The amounts come from the completion
   record; you add a discount only if there is a reason for it.
3. The tax lines and due date come from Settings and are fixed on the document.
4. **Record a payment** against the invoice. Enter the bank slip or mobile money reference: if that
   reference was already recorded against this invoice, the system tells you and adds nothing.
5. **Verify**, then **Reconcile**, as the money clears.

**Corrections.** An issued invoice cannot be edited. If it is wrong and **nothing has been paid**, you
may void it (with a reason) and issue a corrected one — the corrected invoice takes the next number,
and both stay on record.

If money **has** been paid, the void is refused. Take the money off with a **credit note** instead:
open the invoice, choose **Credit the invoice**, and say what it is for and why. The amount you type is
before tax; the tax is worked out from the invoice's own rates, so the credit reverses exactly the tax
that was charged. The credit note gets its own number (CN-2026-0001), leaves the payments exactly as
they were recorded, and reduces what the invoice asks for. It cannot exceed the invoice total, it can
be voided with a reason if you make a mistake, and it can never be edited or deleted.

**If a payment itself is wrong** — keyed against the wrong invoice, or for money that never arrived —
open the invoice and choose **Cancel** beside that payment, then say why. The payment keeps its number,
stays in the list marked **Cancelled** with your reason, and stops counting towards what was received:
the invoice goes back to what it actually owed, and the reports and the printed sheet follow. It is a
one-way door — a cancelled payment is never un-cancelled, so if the money really did arrive, record it
again as a new payment. If it had already been matched to the bank statement, the panel tells you what
that statement will now be short by before you agree.

Cancelling is not a refund. Cancelling says the money was never received. Giving real money back is a
**credit note** with a refund stated on it, and then a **refund** record when the money actually leaves
(below) — one says what is owed back, the other says what was paid.

**Paying money back to a customer.** When a credit note takes a bill below what the customer has
already paid, the invoice says a refund is due. Open that invoice and choose **Pay a refund** when the
money actually leaves: the form fills in what is still owed back, and asks for the date, the method and
a reason. The refund gets its own number (REF-…), and the invoice, the customer's statement and the
money report all show it. Recorded a refund that never left the bank? Cancel it with a reason — the
number stays on the file and the money becomes owed back again. A refund is not a cost: it comes off
the cash movement figure, not off what the work cost.

**How bad is the debt?** The Finance screen opens with **Debt by age**: everything still owed, in the
same four bands a statement prints, with the customers behind them and how late each one's oldest
invoice is. It is measured as at today, not inside the period you chose, because a debt does not stop
being old when somebody changes a date filter. If the invoices are in more than one currency no total is
shown, and it says so.

**Chasing what a customer owes.** **Statements** in the menu shows one customer's account for a period
of your choosing: what was charged, what came in, what was credited, the balance brought forward from
before the period, and the balance as at the end of it, with the debt aged into bands (not yet due,
1–30, 31–60, over 60 days) and a line saying what each band is worth doing. Pick the customer on the
left, set the period above, then **Print statement** — the sheet is the paper you send, and it says in
print that it is a statement of account rather than a demand for payment.

Three things worth knowing before you send one:

- the **balance brought forward** is taken from the day before the period starts, so a short period
  still carries the arrears in rather than showing a clean account;
- a **cancelled payment** does not appear at all — that money never arrived, so it is not the
  customer's figure to be reminded of;
- an account that has been **paid more than it was invoiced** says it is in credit, and how much is
  owed back, instead of showing a demand for nothing.

Statements cover one customer at a time on purpose: a page listing what every customer owes is a
different document with a different risk attached to it.

**Sending a copy.** Open the invoice and choose **Print invoice**, or **Print** beside a credit note.
The preview shows exactly what will be printed; the **Print or save as PDF** button opens your
browser's print dialog, where "Save as PDF" gives you a file to email. The sheet carries the company
name from Settings, the customer, the dates, every line, the tax at the rate that was charged, what was
received, what was credited, and what is still owed (or what is owed back). A void document prints as
void and asks for nothing. Nothing is sent or stored by the system: what you do with the file is yours.

If the credit takes the bill below what the customer has already paid, the invoice says **a refund is
due** and shows the amount. That refund is money you pay out, so record it the way you record any other
outgoing; the system does not pretend the customer paid less than they did.

---

## Driver

**Can:** see their own record, the runs assigned to them, the route and stops, the passenger count and
the vehicle; start their own run; record boarding and no-shows at each stop; complete the run; report
a defect or breakdown.

**Cannot:** see any other driver's work, any client's billing, staff contact details or the fleet
register; cannot start a run that is not theirs, before its service day, or after it.

**On the road:**

1. Open **My runs** → today's run → **Start**.
2. At each stop, tap the passengers who boarded; mark anyone who did not appear as a no-show. A stop
   that has been recorded cannot be changed afterwards, so record only what you saw.
3. **Complete** once every stop is recorded.
4. If the vehicle is unsafe, report a defect **before** setting off. It blocks the vehicle until
   maintenance releases it.

A run's list of people is the roster **plus** the seats the office booked on it. A booked visitor
appears with their seat reference beside the name ("Booked seat BK-0001"); record whether they
boarded like anybody else. You cannot complete a run while anyone on the list has no outcome.

If the phone has no signal, record the stop when it returns. Offline queuing is not built yet
(Phase 2), so write the times down and enter them as soon as you are back in coverage.

---

## Client contact

**Can:** see their own client's record, its agreement — the service, the term and whether it is
active, suspended or has lapsed — its routes and stops, the staff roster assigned to those
routes (names and stops, not phone numbers) and that client's rental requests; raise a rental request;
request a seat on a run for one of their own company's people, and cancel a seat booking they made.

**Cannot:** see any other client or another company's agreement, any billing, the price on their own
agreement (the screen states the service and the term, not the money), staff phone numbers, invoices or
payments; cannot draft, approve or end a contract; cannot
confirm a rental or accept a quotation (that step belongs to finance); cannot **confirm** a booked
seat (the office confirms it once the seats are counted) and cannot book a seat for another company.

---

## When a screen says it is blocked

The application refuses rather than guesses. The message names what is missing, and it is almost
always a setting:

| Message | What it means | Who fixes it |
|---|---|---|
| `Blocked: quotation settings are incomplete. An administrator must set: …` | pricing basis, deposit %, validity, currency or payment methods are unset | administrator, in Settings |
| `Invoicing is not configured` | tax position or payment terms are unset | administrator, in Settings → Invoicing |
| `Not permitted: your role lacks …` | the role does not hold that permission | an administrator, if the role should have it |
| `A rental cannot be … from status "…"` | the record is past or before that step | operations, by following the workflow in order |
| `This invoice has payments recorded…` | a paid invoice cannot be voided | finance: cancel the payment if it was recorded in error, or issue a credit note |
| `PAY-… is already cancelled` | a cancelled payment is never un-cancelled | finance, by recording the money again as a new payment |
| `Vehicle is … and cannot be assigned` | maintenance, out of service or retired | operations / maintenance, by releasing it |

## Passwords and accounts

- Passwords are set by an administrator; nobody can read them, including the administrator.
- A reset signs the account out everywhere it is signed in.
- A suspended account cannot sign in, and its existing sessions stop working on the next request.
- There is no self-service "forgot password" link yet, because no mail provider is configured. Ask an
  administrator to reset it.

## What is not built yet

Contracts, notifications (SMS or email), offline driver mode, boarding codes,
GPS tracking, credit notes and PDF documents. The screens do not offer them, and `docs/PROGRESS.md`
records each one with its status. If a supervisor asks for one of these, the answer is that it is on
the roadmap, not that it is hidden somewhere.
