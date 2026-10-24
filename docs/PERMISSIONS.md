# Permission matrix (Phase 1A)

Source of truth: `src/tms/permissions.ts`. Enforced in `src/tms/service.ts` before any mutation; the UI additionally hides controls the actor cannot use.

Scope: internal roles (`administrator`, `operations`, `finance`) are **company-scoped**.
Record-bound roles (`driver`, `client_contact`) are **own-record scoped**: their account is
linked to exactly one driver record or one corporate client, and every read and write is
confined to it. The links are `User.driverId` and `User.clientId` (schema version 5).

| Permission | driver | client_contact | Scope for these roles |
|---|:-:|:-:|---|
| trips:read | x | | only trips assigned to its linked driver record |
| trips:start | x | | only its own dispatched run |
| trips:record | x | | only the next unrecorded stop on its own in-progress run |
| trips:complete | x | | only its own run; completion requires every stop and boarding outcome |
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
| audit:read | x | x | | | |
| backup:export / import | x | | | | |

Rental separation of duties: operations runs the request/dispatch/completion steps; finance issues quotations and records deposits (confirm). Administrators can do everything.

**Employee roster.** `passengers:read` is held by administrator, operations and
client_contact (own client). Finance does not hold it, so the roster — names, employee
references and phone numbers — never reaches a finance session. This is a server-side filter on
the payload, not only a hidden tab (D-60).

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
types themselves are edited under `settings:update` (administrator only).

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
| maintenance:cost | x | | x | | |
| costs:read | x | x | x | | |

Separation of duties: operations runs the response and the maintenance work; finance records and
reviews costs. The two roles can read each other's records so the work and the bill stay
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
