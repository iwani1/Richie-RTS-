# Permission matrix (Phase 1A)

Source of truth: `src/tms/permissions.ts`. Enforced in `src/tms/service.ts` before any mutation; the UI additionally hides controls the actor cannot use.

Scope: internal roles (`administrator`, `operations`, `finance`) are **company-scoped**.
Record-bound roles (`driver`, `client_contact`, `passenger`) are **own-record scoped**: their account
is linked to exactly one driver record, one corporate client or one rider record, and every read and
write is confined to it. The links are `User.driverId`, `User.clientId` and `User.passengerId`
(schema version 5 for the first two; passenger accounts arrived with migration 016, D-97).

A driver record may be linked to one account only. A corporate client may have **several**
contact accounts — an operations contact and an accounts contact, say — each with its own login
and its own audit trail, and one of them marked `primaryContact` as the person the office rings
first (Q-38, D-77). The mark is held by one account per client; marking another takes it away.

### Passenger accounts (PAX-01, D-97)

A `passenger` account is the third record-bound role: one account per **rider** (`User.passengerId`),
and the rider is the person who stands at the stop. It holds exactly five permissions, and every one
of them is confined to that rider:

| Permission | Scope for a passenger |
|---|---|
| trips:read | the runs of its own route, and any run it holds a seat on |
| routes:read | its own route, plus the routes of runs it holds a seat on |
| bookings:read | its own seats only — never a colleague's |
| bookings:create | a seat **for itself**; the command refuses a seat requested in another rider's name |
| incidents:create | feedback about a journey it is on; the run decides the vehicle, and the vehicle is never withdrawn from service |

The unique index `app_user_passenger_uq` (migration 016) is what makes it one account per rider, and
`app_user.role` was widened in the same migration to accept the role. A passenger is **not** a client
contact: it sees one person, not a company roster, and it receives none of the settings table beyond
the company name and the two booking cut-offs (the table also carries rental prices and payment
terms). The per-permission tables below list the office roles and the two original bound roles;
where a row has no `passenger` column, the role does not hold that permission at all.

| Permission | driver | client_contact | Scope for these roles |
|---|:-:|:-:|---|
| trips:read | x | | only trips assigned to its linked driver record |
| trips:start | x | | only its own dispatched run |
| trips:record | x | | only the next unrecorded stop on its own out run, and a delay report on that same run (D-105) |
| trips:complete | x | | only its own run; completion requires every stop and boarding outcome |
| trips:correct | | | **not held by either bound role.** Recording a fact at the door and correcting it afterwards are different acts, and the correction is attributed (D-74). Operations and the administrator hold it |
| incidents:read | x | | only incidents on its own runs or vehicles |
| incidents:create | x | | only against a vehicle assigned to it; cannot withdraw a vehicle from service |
| routes:read | | x | only routes for its linked client |
| passengers:read | | x | only its client's roster (name and pickup stop are shown; contact details are not) |
| rentals:read | | x | only its client's rental requests |
| rentals:create | | x | client is forced to its own; the request cannot name another client |

Both roles are denied everything else, including all of staff logistics, fleet, users,
settings and audit. An account whose linked record is missing sees **nothing** — scope is
derived from the role on the actor and fails closed.

Enforcement lives in `src/tms/scope.ts` (reads) and in the service layer (writes). HONEST
Enforcement is in two places and both are tested: the service refuses the command, and the
snapshot endpoint refuses to send a collection the role cannot read (`src/server/visibility.ts`,
D-60). Hiding a control is a convenience, never the control.

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| users:read / create / update | x | | | | |
| settings:read | x | x | x | | |
| settings:update | x | | | | |
| vehicles:read | x | x | x | | |
| vehicles:create / update / transition | x | x | | | |
| drivers:read | x | x | x | | |
| drivers:create / update | x | x | | | |
| clients:read | x | x | x | | |
| clients:create / update | x | | x | | |
| rentals:read | x | x | x | | |
| rentals:create / update | x | x | | | |
| rentals:quote | x | x | x | | |
| rentals:confirm | x | | x | | |
| rentals:dispatch | x | x | | | |
| rentals:complete | x | x | | | |
| rentals:cancel | x | x | | | |
| invoices:read | x | | x | | |
| invoices:issue / void | x | | x | | |
| payments:record / advance / void | x | | x | | |
| audit:read | x | x | | | |
| backup:export / import | x | | | | |

Rental separation of duties: operations runs the request/dispatch/completion steps; finance issues quotations and records deposits (confirm). Administrators can do everything.

**The vehicle's photograph (FLT-01, D-108).** No new permission: filing, replacing and removing a
photograph are `vehicles:update`, and opening one is `vehicles:read` — so a driver, a client contact and
a rider may not read the pictures either. Finance reads the fleet and therefore the photographs; it may
not file one, because a photograph is a fact about the vehicle and the office is what maintains the
register. The GET route holds a second gate (the own-record check every screen already uses) even
though no bound role holds `vehicles:read` today: a route that trusts a role to be company-scoped is one
permission change away from handing out any bus in the company by id.

**CSV import (MIG-01).** There is no separate import permission: importing vehicles needs
`vehicles:create`, drivers need `drivers:create`, clients need `clients:create`. Each imported row
runs through the same command as a typed one, so a role that cannot add a vehicle by hand cannot
add one by file either. The preview is a read: it changes nothing and is refused for a role without
the same permission.

**Employee roster.** `passengers:read` is held by administrator, operations and
client_contact (own client). Finance does not hold it, so the roster — names, employee
references and phone numbers — never reaches a finance session. This is a server-side filter on
the payload, not only a hidden tab (D-60).

## Reporting (RPT-01)

| Destination | Permission | Notes |
|---|---|---|
| Rental report (`/reports`) | `kpis:read` | administrator, operations, finance |
| CSV download | same snapshot | the file is built from the payload the role already received, so it cannot contain a record the role cannot read |

Drivers and client contacts have no reporting destination: their payload is own-record scoped, and a
company-wide report cannot be assembled from it.

## Invoices and payments (FIN-02, FIN-03)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| invoices:read | x | | x | | |
| invoices:issue | x | | x | | |
| invoices:void | x | | x | | |
| payments:record | x | | x | | |
| payments:advance | x | | x | | |
| payments:void | x | | x | | |
| credits:issue | x | | x | | |
| credits:void | x | | x | | |
| refunds:record | x | | x | | |
| refunds:void | x | | x | | |

`payments:void` is separate from `payments:record` on purpose (D-88): the person who took the money in
is not always the person who may take it back, and the cancellation carries that person's name.

`refunds:record` and `refunds:void` (D-92) are kept apart from all four of the above. Paying money back
is a payment the office *makes*, not a correction to a bill (that is `credits:issue`) and not a
correction to money received (that is `payments:void`). The ceiling is enforced where the money is:
`refunds:record` can only pay back what an invoice still owes, and the database refuses more.

`expenses:read`, `expenses:record` and `expenses:void` (D-93) cover spending that is not a repair:
fuel, tolls, permits, rent, allowances. **Operations may read it** — fuel and tolls are part of what its
own runs cost, and the cost report is where that lands — but entering or voiding spending is a money
job. A driver and a client contact hold none of the three, because an expense names who was paid
(`visibility.ts`, `SECTION_PERMISSIONS`). Recording requires the company currency, so a company that
has not set one cannot enter spending at all.

`receipts:read` and `receipts:write` (Q-51, D-100) cover the **scanned copy** of a receipt: filing the
image against an entry, opening it, and taking it off with a reason. They are separate from
`expenses:read` on purpose. Operations reads the expense register — fuel and tolls are part of what its
runs cost — but a scan photographs a supplier's paper, a bank reference and sometimes a card. So the
paper is finance's and the administrator's, and operations receives not even the file names: a receipt
scan is a file whose access has to be decided on the server, before a byte leaves the folder. Reading
and writing are one decision here rather than two, because filing a scan and opening one are the same
act of keeping the office's paper in order (unlike invoices, where issuing and voiding are different
acts by different people).

Read scope: `invoices:read` also opens the invoice's payments, credit notes and refunds, because all
three are part of the invoice — and it is the permission the **Statements** destination needs (D-90), because a
statement is those same three collections read for one customer over a period. Record-bound roles receive none of the three collections, so a driver or client
contact never sees a customer's billing (`visibility.ts`, `SECTION_PERMISSIONS`).

Separation of duties: operations completes a rental and therefore produces the line items that will
be billed, but cannot issue the invoice or record money against it. Finance issues, records payments
and advances verification and reconciliation; only an administrator can also do it.

Two rules are enforced in the service and again in the database (migration `003`):

- an invoice is never edited after issue — identity, dates, lines and totals are frozen by trigger;
- a payment is written once — only its status may advance, and only forwards
  (recorded → verified → reconciled).

Voiding needs `invoices:void` and is refused once any payment stands against the invoice. The voided
invoice keeps its number, so a corrected invoice receives the next one and the audit trail keeps both.

Taking money *off* an invoice after it has gone out needs `credits:issue` (and `credits:void` to undo a
credit note). It is deliberately separate from `invoices:void`: a credit note is a numbered document
of its own, not a correction of the invoice's details, and the two are different facts — "this document
never counted" and "everything except this counted" (D-86). Finance and the administrator hold both;
operations holds neither, exactly as with issuing and recording money.

## Compliance documents (Phase 6)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| documents:read | x | x | — | own only | — |
| documents:create | x | x | — | — | — |
| documents:update | x | x | — | — | — |

A driver's `documents:read` is own-record: it returns documents for its own driver record and
for vehicles assigned to it, and the driver portal renders them read-only. A driver can never
write a document record. Finance cannot read licence or insurance documents at all: those are
personal/compliance records and billing does not need them (brief section 6, D-60). Document
types themselves are edited under `settings:update` (administrator only). Taking a paper's renewal on
(FLT-03, D-110) is `documents:update`: it writes a record with the person's name on it, so it is the
same right as correcting the paper, and a driver cannot do it.

## Fleet readiness and odometer (Phase 8)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| fleet:read | x | x | | | |
| fleet:record | x | x | | | |
| fleet:void | x | x | | | |

Operations records odometer readings and readiness is computed from them. Finance has no fleet
access: readiness is operational, not financial. Service schedules are company settings, so only
administrators change them (`settings:update`).

## Staff logistics (Phase 3)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| incidents:read | x | x | x | | |
| incidents:create / incidents:update | x | x | | | |
| incidents:advance | x | x | | | |
| incidents:cost | x | | x | | |
| maintenance:read | x | x | x | | |
| maintenance:create / maintenance:update / maintenance:advance | x | x | | | |
| maintenance:release | x | x | | | |
| maintenance:cost | x | | x | | |
| costs:read | x | x | x | | |
| expenses:read | x | x | x | | |
| expenses:record / expenses:void | x | | x | | |
| receipts:read / receipts:write | x | | x | | |

Separation of duties: operations runs the response and the maintenance work; finance records and
reviews costs. **Releasing a vehicle is a separate permission from advancing the work.**
`maintenance:advance` moves a work order through open, in progress, on hold and completed;
`maintenance:release` is what closing the work order needs, because closing is the act that
returns the vehicle to service. The person who releases it is recorded on the work order
(`releasedBy`, `releasedAt`) and the audit entry is `maintenance:release`, not
`maintenance:advance` (brief MNT-02). Administrator and operations hold both today; a workshop
account would be given advance without release, which is the reason the two were split. The two roles can read each other's records so the work and the bill stay
traceable to the same event. Drivers and client contacts have no staff logistics access yet
(see OPEN_QUESTIONS Q-33 and Q-35).

## Staff busing (Phase 2)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| routes:read | x | x | x | | |
| routes:create / update | x | x | | | |
| passengers:read | x | x | — | | |
| passengers:create / update | x | x | | | |
| trips:read | x | x | x | | |
| trips:generate / assign / dispatch / start / record / complete / cancel | x | x | | | |
| kpis:read | x | x | x | | |

Separation of duties: operations runs routes, rosters and trips. Finance reads KPIs and trip records for costing but never the employee roster, and cannot change operational records. Drivers can start and progressively record only trips assigned to their linked driver record. Client contacts retain the client-scoped route/roster portal.

Additional invariants enforced by the service:

- Setup of the first administrator is only possible when no users exist.
- A user cannot deactivate themselves or remove their own administrator role.
- At least one active administrator must remain.
- Backup import is refused if the importing administrator is absent from the backup.

The role list and assignments are a proposal pending Q-21 in `OPEN_QUESTIONS.md`.

## Corporate agreements (CLI-02, D-95)

| Permission | administrator | operations | finance | driver | client_contact |
|---|:-:|:-:|:-:|:-:|:-:|
| clients:read | x | x | x | | |
| clients:create / update | x | x | x | | |
| contracts:read | x | x | x | | x (own client only) |
| contracts:create / contracts:update | x | x | | | |
| contracts:advance | x | x | | | |

Reading an agreement and changing one are separate. `contracts:update` corrects the terms of a
**draft** or a contract awaiting approval; once it is active the terms are frozen (D-95) and a change
is a new numbered contract. `contracts:advance` is what moves the status — approving, suspending,
terminating — and each of those moves writes an audit entry naming the person and the reason.

**Finance reads contracts** because the pricing model, billing frequency and payment terms on the
agreement are what it invoices against; it does not draft or approve them, because an agreement is a
commitment the office makes, not a billing task.

**A client contact sees its own client's contracts** and no other client's, because the agreement is
about that company. It reads; it never writes. Drivers receive no contract at all: a driver has no
reason to know what a client pays. This is own-record scope, enforced by `contracts:read` together
with the snapshot's client binding (`visibility.ts`, `scope.ts`).

The booking gate uses the same records rather than a second copy of "is this account current": a
request is refused when the covering contract is not `active`, and again at confirmation in case it
was suspended in between.

## The public enquiry form (WEB-01)

One command and two endpoints need no permission at all, because they are reached by people who have
no account: `submit_enquiry` in `src/tms/service.ts`, and `GET`/`POST /api/enquiry`. They confer no
authority — the only thing an anonymous caller can do is create a **draft** rental request, which
then sits in the same queue as one taken at the desk and still needs `rentals:update`, `rentals:quote`,
`rentals:confirm` and the rest to go anywhere.

| Actor | May reach `/api/enquiry` | Effect |
|---|:-:|---|
| Nobody (no cookie) | yes | Creates a draft request attributed to `System` in the audit log |
| Any signed-in role | yes | The same draft, attributed to that account — the route never reads the cookie |

Hiding it is not part of the model: it is deliberately public. What keeps it safe is that it can do
exactly one thing, that it returns no records, and that it is throttled per address.
