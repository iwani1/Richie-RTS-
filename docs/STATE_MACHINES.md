# State machines

Encoded and enforced in `src/tms/service.ts`. Each transition is authorised by a permission and written to the audit log. Illegal transitions are rejected server-side (here, service-side — see DECISIONS D-01).

## Vehicle (`VEHICLE_TRANSITIONS`)

| From | To | Actor permission | Preconditions |
|---|---|---|---|
| available | maintenance, out_of_service, retired | vehicles:transition | reason required |
| maintenance | available, out_of_service, retired | vehicles:transition | reason required |
| out_of_service | available, maintenance, retired | vehicles:transition | reason required |
| retired | (none) | - | terminal |

Those four are the **condition** of a vehicle — the office's own judgement, and the only part a person
types. The brief's seven states (FLT-02, D-109) are the condition *plus* what the day's records are
doing with the bus. The other four are derived in `src/tms/fleetState.ts` and never stored, because a
stored copy would disagree with the runs the first time a run was cancelled in a hurry (the same
reasoning as D-103, where a driver's availability is read from the runs).

| State | What makes it | What leaves it |
|---|---|---|
| **Available** | Nothing is wrong with it and nothing on the day is holding it: no run planned, dispatched or running, no confirmed hire covering the day. | Office books it (Reserved), sends a run out (Assigned), or takes it off the road. |
| **Reserved** | A run on the day is `planned` with this vehicle, or a confirmed hire's dates cover the day but it has not started. | The run is dispatched (Assigned) or the hire starts (On trip); cancelling frees it. |
| **Assigned** | A run on the day is `dispatched` with this vehicle and a crew, or a confirmed hire covering the day has reached its start date. | The crew starts the run (On trip), or the run is cancelled or completed. |
| **On trip** | A run on the day is `in_progress`, or a hire with this vehicle is `in_progress`. | The run completes or is cancelled. The run's own end frees the vehicle, not a clock. |
| **Pending inspection** | A work order on the vehicle is `completed` and nobody has released it (`closed`, `maintenance:release`). The repair is done; the signature is missing. | The work order is released. |
| **Under maintenance** | A work order is `open`, `in_progress` or `on_hold`, or the office has set the vehicle to `maintenance` with no work order open. | The work is finished, or the office sets it back to Available. |
| **Out of service** | The office took it off the road — a safety defect from an incident, or a decision with a reason. | The office sets it back to Available or Maintenance, with a reason. |
| **Retired** | It has left the fleet. | Nothing. A retired vehicle does not come back. |

Precedence, highest first: **retired → out of service → maintenance → pending inspection → on trip →
assigned → reserved → available.** Work in the workshop outranks work on the road (a bus with its
wheels off cannot be driving), and a finished repair waiting for a signature outranks a commitment
(nobody may carry passengers until somebody signs the bus back).

A blocking state does not hide a commitment, it names it: a bus in the workshop that is still on
today's run sheet reads "Under maintenance … It is still committed to TR-0001". That is a plan that has
already gone wrong, and the register says so rather than leaving the dispatcher to find out at the gate.

The states decide nothing. What stops a vehicle being assigned is `assessResources` (`busing.ts`),
which reads the stored condition — the only thing a person can change — and the mandatory-paper and
service-interval rules beside it.

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

A refund never moves backwards or returns: `refund_frozen()` refuses any edit to the financial fields,
refuses to un-cancel one, and refuses to rewrite the cancellation's reason or the time it was cancelled, and `refund_no_delete()` refuses a delete. Cancelling does not remove the
number: it says the money was not paid back after all, and the amount becomes owed back again.
`refund_within_due()` re-checks the ceiling in the database under a row lock, so the same over-credit
cannot be paid out twice even by two operators at once.

## Expense (`Expense.status`, FIN-05, D-93)

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `recorded` | `expenses:record` | Company currency set; date is a real day not in the future; amount > 0; description (200 characters); category blank or from Settings; method blank or configured; payee (120 characters); receipt number (120 characters) — the paper cannot be *held* without one |
| `recorded` | `void` | `expenses:void` | Not already void; a reason (300 characters) |

There is no path to `recorded` from `void`, and no path from `recorded` back to an earlier state: an
expense **is never edited**. A wrong figure is voided with a reason and entered again as the next
number, so a report that used the old figure can still be explained. `expense_frozen()` refuses every
edit to the money fields and to the receipt facts, allows the void once, and requires the reason and
time together; `expense_no_delete()` refuses a delete. A voided expense counts in nothing — not the
cost report, not the money report, not the finance home — and the number stays on the list.

## Booking (`Booking.status`, BKG-03…05, D-83)

A booking is one named rider's seat on one named run — never a second roster. Every transition is
authorised (`bookings:create` / `bookings:manage`) and writes both a history line on the booking and
an audit entry.

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `requested` | `bookings:create` | The client's covering contract is `active` on that date (a client with no contract on file is not blocked, and a terminated one does not gate); rider active, same client as the route, **not** already on the route's roster; a run exists on that date, is not cancelled, completed, departed or **already under way**; a vehicle is assigned so seats can be counted; a seat is free; outside the request cut-off (if one is set) |
| `requested` | `confirmed` | `bookings:manage` | A seat is still free, the run has not left, and the covering contract is still `active` (it may have been suspended since the request) |
| `requested` / `offered` | `waitlisted` | `bookings:manage` | Attempting to confirm when the run is full: the request moves to the waiting list instead of failing |
| `waitlisted` | `offered` | automatic, on a cancellation | The oldest waiter on that run, and only when the freed seat actually makes room. **Never `confirmed`**: the offer waits for a person |
| `offered` / `requested` / `waitlisted` | `confirmed` | `bookings:manage` | A seat is free (`offered` already holds one) |
| `requested` / `offered` / `waitlisted` / `confirmed` | `rejected` | `bookings:manage` | A reason is required; kept with the booking |
| `requested` / `offered` / `waitlisted` / `confirmed` | `cancelled` | `bookings:manage`; the client's own contact (`bookings:create`) for its own company; or **the rider whose seat it is** (`bookings:create`, PAX-01, D-97) | A reason is required; refused inside the cancellation cut-off when one is set; a held seat is offered to the oldest waiter. A passenger may cancel only its own seat, never a colleague's |
| `rejected` / `cancelled` | (none) | - | terminal — the record is kept, the seat is released |

Both cut-offs are minutes before the run's first stop departs and both are **blank by default**: an
unset cut-off means no deadline, not a guessed one. A booking never changes a trip or a roster row.

A booking that holds a seat (`confirmed` or `offered`) is a person on the run's manifest (D-85): the
stop record expects an outcome for them at their pickup stop, and the completion expects one for the
run. The manifest is fixed once the run is `in_progress`, so no seat can be added to a bus that has
left.

## What a rider is shown (`JourneyPhase`, PAX-01, D-97)

There is no new record here: the page derives one state per journey from three existing ones, in this
order, and never in the other direction.

| Rider's state | Read from | What it means |
|---|---|---|
| Seat requested / on the waiting list / seat offered / not accepted / cancelled | `Booking.status` | the seat's own history, before the run is considered at all |
| Seat held (no bus) | run `planned`/`dispatched` with **no** `vehicleId` | the seat is real, the bus is not assigned yet |
| Bus assigned / ready to leave | run `planned` / `dispatched` with a vehicle | a bus and driver are on the run; "ready to leave" means dispatched, not moving |
| Under way | run `in_progress`, no boarding recorded | the driver started the run. **No position and no ETA**: neither is recorded |
| Picked up | run `in_progress`, boarding `boarded` | the door recorded the rider aboard |
| Travelled / not recorded aboard | run `completed`, boarding `boarded` / `no_show` | what the driver recorded at the stop |
| Run cancelled | run `cancelled` | with the reason the office typed when it cancelled |

**Delayed is not a phase in this list, and that is still a decision** (D-97, D-105): the list names what
happened to the seat and the run, and a delay is neither. Since Phase 56 a delay *is* recorded — by the
driver or the office, while the run is out — and `journeyStateOf()` appends it to whatever phase the
run is in, so "under way" can read "under way. This run is reported 20 minutes behind its timetable —
traffic at the junction." A run nobody reported stays silent, which is why the portal prints its limit
in the rider's own words rather than leaving the silence to be read as punctuality.

## Contract (`Contract.status`, CLI-02, D-95)

The status records where the paper is; it does **not** record expiry. A contract whose end date has
passed reads **Expired** on every screen because `contractStateOf()` derives it from `end_date` — the
stored status stays `active` until somebody suspends or terminates it. That is the point: a date
passing is not an event a person records, and a stored "expired" would be wrong between nightly runs.

| From | To | Who | Preconditions |
|---|---|---|---|
| — | `draft` | `contracts:create` | Client chosen, start date given, end date after it or blank (open-ended); the routes named must belong to that client |
| `draft` | `pending_approval` | `contracts:advance` | The terms are in a state somebody would sign; nothing else is checked, because approval is the gate |
| `pending_approval` | `active` | `contracts:advance` | The end date has not already passed (a lapsed term cannot be put in force; the message names the date); no other live contract covers any of its days |
| `pending_approval` | `draft` | `contracts:advance` | A reason is required |
| `active` | `suspended` | `contracts:advance` | A reason is required — typically an unpaid invoice |
| `active` | `terminated` | `contracts:advance` | A reason is required; terminal |
| `suspended` | `active` | `contracts:advance` | The end date has not already passed |
| `suspended` | `terminated` | `contracts:advance` | A reason is required; terminal |
| `terminated` | (none) | - | terminal — service resumes under a new numbered contract |

Terms are editable in `draft` and `pending_approval` only. After approval the record is a record: a
renegotiation is a new contract with `replacesId` naming this one, and the old one is suspended or
terminated. Two **drafts** may overlap (that is how a renewal is prepared); two **live** contracts may
not, and `replacesId` does not waive that — the renewal starts after the old term ends.

## Planned (not yet implemented)

Quotation (as a standalone revisable document) and the rental-vs-trip split are still Not Started.
