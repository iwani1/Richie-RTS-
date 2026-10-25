# State machines

Encoded and enforced in `src/tms/service.ts`. Each transition is authorised by a permission and written to the audit log. Illegal transitions are rejected server-side (here, service-side — see DECISIONS D-01).

## Vehicle (`VEHICLE_TRANSITIONS`)

| From | To | Actor permission | Preconditions |
|---|---|---|---|
| available | maintenance, out_of_service, retired | vehicles:transition | reason required |
| maintenance | available, out_of_service, retired | vehicles:transition | reason required |
| out_of_service | available, maintenance, retired | vehicles:transition | reason required |
| retired | (none) | - | terminal |

`in_service` is intentionally not a manual status; it is reserved for system-driven trip assignment in a later phase.

## Rental (`RENTAL_TRANSITIONS`)

| From | To | Actor permission | Preconditions |
|---|---|---|---|
| draft | quoted | rentals:quote | quoting settings configured (currency, pricing basis, deposit %, validity, >=1 payment method); >=1 valid line item |
| draft | cancelled | rentals:cancel | reason required |
| quoted | confirmed | rentals:confirm | quote not expired; deposit >= required; known payment method |
| quoted | declined | rentals:quote | reason required |
| quoted | cancelled | rentals:cancel | reason required |
| confirmed | in_progress | rentals:dispatch | vehicle assigned; driver assigned if required |
| confirmed | cancelled | rentals:cancel | reason required |
| in_progress | completed | rentals:complete | >=1 valid final-invoice line item |
| in_progress | cancelled | rentals:cancel | reason required |
| completed / declined / cancelled | (none) | - | terminal |

An expired quote can be renewed in place without changing rental status only when
`settings.rental.requotePolicy = revise_in_place`. The old quote snapshot is appended to
`quoteHistory` before the new snapshot becomes current. If policy is unset, renewal is blocked.
If policy is `new_request`, the existing cancel-and-create flow must be used. A quote cannot be
renewed before it expires. The new revision uses the configured pricing basis, deposit percent
and validity currently in force (Q-46).

Assignment (not a status change) requires `rentals:dispatch` and checks: vehicle category matches request; vehicle not retired/out_of_service; driver active with licence valid through the rental end date; and no overlapping confirmed/in-progress booking for the same vehicle or driver.

## Trip (`TRIP_*` rules in `busing.ts`)

| From | To | Actor permission | Preconditions |
|---|---|---|---|
| planned | planned (assign or reassign) | trips:assign | Vehicle in the route's category and Available; driver active with licence valid on the service date; no same-day time overlap for the vehicle or driver; no confirmed or in-progress rental covering the date |
| planned | dispatched | trips:dispatch | Route is active; vehicle and driver assigned; the assignment checks above pass again |
| dispatched | in_progress | trips:start | Route active; assigned resources still valid; own-record scope checked before state |
| in_progress | in_progress (record next stop) | trips:record | Exactly the next route stop; actual HH:MM not before previous stop; one boarded/no-show outcome for every active passenger at that stop; no other passenger |
| planned | cancelled | trips:cancel | Reason required |
| dispatched | completed | trips:complete (own run only for a driver) | Full-form compatibility: actual time for every route stop; one outcome for every active passenger; threshold snapshot taken |
| in_progress | completed | trips:complete (own run only for a driver) | Every stop and active passenger outcome already recorded progressively; replacement data is refused |
| dispatched | cancelled | trips:cancel | Reason required |
| completed / cancelled | (none) | - | Terminal; a completed stop log cannot be edited |

Trips are created only by `generate_trips` (trips:generate), which creates planned trips for operating dates inside the route's date range. Existing trips for a route and date are never duplicated. `startedAt` is recorded on the dispatched -> in_progress transition.

Mid-trip roster changes (Phase 11, D-40) are not a trip transition: while a trip is in
progress, operations may add, move, or deactivate passengers only where no boarding outcome
exists yet and the affected stop is still in the future on every in-progress trip on the route.
Recorded stops and boarded passengers are immutable.

## Route status (manual)

| Status | Effect |
|---|---|
| active | Trips may be generated and dispatched |
| suspended | Trips cannot be generated or dispatched. Existing planned trips are kept (Q-31) |
| ended | Passengers cannot be assigned to it; no trips are generated |

Stops, client and vehicle category are locked once any trip exists for the route (D-14).

## Passenger status (manual)

active or inactive. Only active passengers appear in a trip's roster, which is taken at completion. Inactive passengers are not expected to board.

## Incident (`IN-*`, `INCIDENT_TRANSITIONS` in `logistics.ts`)

| From | To | Permission | Preconditions |
|---|---|---|---|
| reported | acknowledged | incidents:advance | — |
| acknowledged | responding | incidents:advance | A responder must be named for a breakdown |
| responding | resolved | incidents:advance | Resolution note required; operator chooses the vehicle status afterwards |
| resolved | closed | incidents:advance | Every linked work order must be closed |

Type and severity are free choices from the configured lists. A breakdown, accident or damage
report requires a vehicle; a safety concern or "other" does not. `takeVehicleOutOfService` is an
operator choice recorded at report time and applied immediately. The report freezes once the
incident is `responding`; corrections are appended to the response log. `closed` is terminal.

## Work order (`WO-*`, `WORK_ORDER_TRANSITIONS` in `logistics.ts`)

| From | To | Permission | Preconditions |
|---|---|---|---|
| open | in_progress | maintenance:advance | Vehicle moves to maintenance |
| in_progress | on_hold | maintenance:advance | Hold reason required |
| in_progress / on_hold | completed | maintenance:advance | Note required; cost position confirmed (recorded, or explicitly confirmed as none) |
| completed | closed | maintenance:advance | Cost review note required; operator chooses the vehicle status, but "Available" is refused while another work order for that vehicle is active |

`completed` and `closed` cannot be edited; further work needs a new work order. Costs can be
added and removed until `closed`. `closed` is terminal. The vehicle cannot be set to `retired`
here — that stays with the vehicle register.

## Odometer reading (`fleet:*`, Phase 8)

A reading is `current` or `void`. It becomes void only with a reason (`fleet:void`); voided
readings stay in the audit trail and are excluded from every calculation. A new reading may not be
lower than the newest current reading for that vehicle; correcting one means voiding the wrong
entry first.

## Service interval anchor (Phase 8)

A work order becomes the "last service" for a vehicle only when it carries
`resetsServiceInterval` and reaches `completed` (or is later closed). The flag is an operator
choice recorded while the work order is still editable; `completedAt` is fixed at the completion
transition. There is no transition that retroactively marks or unmarks a service.

## Invoice (`Invoice.status`, FIN-02)

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `issued` | `invoices:issue` | Rental completed (a final invoice exists); currency, tax position and payment terms configured; no other live invoice for the same billable event |
| `issued` | `part_paid` | automatic | A payment is recorded that is less than the total |
| `issued` / `part_paid` | `paid` | automatic | Recorded payments reach the total |
| `issued` | `void` | `invoices:void` | A reason is given and **no payment and no live credit note** exists (void the credit note first) |

No transition leaves `void`, and no transition edits the document: identity, dates, lines and totals
are frozen by trigger (`003_invoices_and_payments.sql`). `amount_paid` is derived from the payment
rows.

The status describes **money received**, and nothing else. Whether the bill is closed is the balance's
answer: `outstanding = total − paid − credited` (`src/tms/creditNotes.ts`, D-86). An invoice can
therefore be `issued` or `part_paid` with nothing left to collect because a credit note took the rest
off it — the screen adds **Settled by credit** and the screen, the reports and the finance home all
read the same figure.

## Credit note (`CreditNote.status`, FIN-02, D-86)

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `issued` | `credits:issue` | Invoice exists and is not void; a date on or after the invoice; a line description and a reason; an amount > 0 before tax; `credited + this ≤ invoice total` |
| `issued` | `void` | `credits:void` | A reason is given |

No transition leaves `void`; a void credit note is not resurrected, because un-voiding would silently
restore a discount the office had withdrawn. No transition edits the document: reference, invoice,
customer, currency, amounts, date, reason, lines and tax lines are frozen by trigger
(`008_credit_notes.sql`). Deleting one is refused outright.

## Payment (`Payment.status`, FIN-03)

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `recorded` | `payments:record` | Invoice not void; amount > 0 and ≤ outstanding; configured method; date not before the invoice; external reference not already used on this invoice |
| `recorded` | `verified` | `payments:advance` | — |
| `verified` | `reconciled` | `payments:advance` | — |

Backwards transitions are refused in the service and by trigger. The financial fields are immutable
after insert; only the status may move.

**Cancelling** is a separate one-way fact, not a fourth status (D-88):

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `voidedAt` + `voidReason` set | `payments:void` | Payment not already cancelled; a reason (300 characters); any verification status, with the reconciliation warning stated when it is `reconciled` |

A cancelled payment never returns: the trigger refuses to clear either column, and the status stays
exactly as it was. Cancelling is not a refund: cancelling says the money never arrived, a refund says
real money went back out (below).

## Refund (`Refund.status`, FIN-03, D-92)

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `paid` | `refunds:record` | Invoice not void; amount > 0 and ≤ `paid + credited − total − refunded`; a configured method; date not before the invoice; a reason (300 characters); external reference not already used on a live refund |
| `paid` | `void` | `refunds:void` | Not already cancelled; a reason (300 characters) |

A refund never moves backwards or returns: `refund_frozen()` refuses any edit to the financial fields
and refuses to un-cancel one, and `refund_no_delete()` refuses a delete. Cancelling does not remove the
number: it says the money was not paid back after all, and the amount becomes owed back again.
`refund_within_due()` re-checks the ceiling in the database under a row lock, so the same over-credit
cannot be paid out twice even by two operators at once.

## Booking (`Booking.status`, BKG-03…05, D-83)

A booking is one named rider's seat on one named run — never a second roster. Every transition is
authorised (`bookings:create` / `bookings:manage`) and writes both a history line on the booking and
an audit entry.

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `requested` | `bookings:create` | Rider active, same client as the route, **not** already on the route's roster; a run exists on that date, is not cancelled, completed, departed or **already under way**; a vehicle is assigned so seats can be counted; a seat is free; outside the request cut-off (if one is set) |
| `requested` | `confirmed` | `bookings:manage` | A seat is still free, and the run has not left |
| `requested` / `offered` | `waitlisted` | `bookings:manage` | Attempting to confirm when the run is full: the request moves to the waiting list instead of failing |
| `waitlisted` | `offered` | automatic, on a cancellation | The oldest waiter on that run, and only when the freed seat actually makes room. **Never `confirmed`**: the offer waits for a person |
| `offered` / `requested` / `waitlisted` | `confirmed` | `bookings:manage` | A seat is free (`offered` already holds one) |
| `requested` / `offered` / `waitlisted` / `confirmed` | `rejected` | `bookings:manage` | A reason is required; kept with the booking |
| `requested` / `offered` / `waitlisted` / `confirmed` | `cancelled` | `bookings:manage`, or the client's own contact (`bookings:create`) for its own company | A reason is required; refused inside the cancellation cut-off when one is set; a held seat is offered to the oldest waiter |
| `rejected` / `cancelled` | (none) | - | terminal — the record is kept, the seat is released |

Both cut-offs are minutes before the run's first stop departs and both are **blank by default**: an
unset cut-off means no deadline, not a guessed one. A booking never changes a trip or a roster row.

A booking that holds a seat (`confirmed` or `offered`) is a person on the run's manifest (D-85): the
stop record expects an outcome for them at their pickup stop, and the completion expects one for the
run. The manifest is fixed once the run is `in_progress`, so no seat can be added to a bus that has
left.

## Planned (not yet implemented)

Quotation (as a standalone revisable document), the rental-vs-trip split and contract state machines
are still Not Started.
