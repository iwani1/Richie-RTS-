# KPI definitions

## Source note

The uploaded brief names RPT-01 to RPT-03 but does not define them. An earlier version of this project described them as "on-time rate, utilisation, cost per trip". That was an assumption, not a definition from the business.

**Status now.** The owner approved definitions for utilisation, cost per trip and the cost-category
list (Q-29, D-78), and RPT-03 is implemented against them. The on-time rate and the rental report were
already implemented earlier. Where a definition below is still marked "proposal", it has not been
confirmed and the screen says so.

Every KPI on screen shows its reporting period, numerator, denominator and data coverage. A KPI with missing inputs shows "Not computed" or "Insufficient data", never a number.

## On-time rate (implemented; used by the busing screen and RPT-02)

> Labelled RPT-01 in an earlier draft. In the brief, RPT-01 is the rental report (below); on-time
> performance is part of RPT-02, the staff transport report.

**Formula**

    on-time rate = trips judged on time / trips judged (timed)

**Population.** Trips with status `completed` and a service date inside the reporting period.

**A trip is on time** when, for every stop, `actual_time - scheduled_time <= threshold_minutes`. The threshold is the on-time threshold setting, copied onto the trip at completion. Early arrivals count as on time.

**Exclusions and coverage**

| Item | Rule |
|---|---|
| Cancelled trips | Excluded from every count |
| Planned and dispatched trips | Not in the completed count |
| Completed trips with no threshold snapshot | In the completed count, excluded from timed and on-time counts. This happens when the threshold was not set at completion. Completed trips are not re-judged later |
| Data coverage | completed trips / scheduled trips (non-cancelled) in the period |

**Status values**

| Status | Meaning | Shown as |
|---|---|---|
| `ok` | At least one timed trip | Rate, with counts |
| `insufficient_data` | No completed trips in the period, or an invalid period | "Insufficient data" |
| `threshold_not_set` | Completed trips exist, but none has a threshold snapshot | "Not computed", with an explanation |

**Open points**

- Judging each stop, or the trip as a whole (Q-25).
- Whether early arrivals should count as on time (Q-25).
- Whether scheduled times should come from shift definitions (Q-27).

## Fleet utilisation (definition agreed, not yet surfaced on its own screen)

The owner approved a definition in Q-29 (D-78), so the figure is no longer "unknown":

    utilisation = committed vehicle-days ÷ available vehicle-days

- **Committed vehicle-days**: days in the period on which a vehicle was committed to work — a rental
  that held it (confirmed, in progress or completed, with a vehicle assigned) or a scheduled staff run
  that has not been cancelled (planned, dispatched, in progress or completed, with a vehicle assigned).
- **Available vehicle-days**: the acting fleet (vehicles not `retired`) × days in the period.
- **Consequence of the definition**: a day counts once per vehicle, so two rentals of the same vehicle
  on the same day are one vehicle-day, not two.

The rental report already prints the rental-only half of this number under the label "Utilisation",
and it says on screen that staff runs are not included. The fleet-wide figure still has no screen of
its own; the definition is settled, so what remains is presentation. The staff transport report
(RPT-02, below) does **not** use this figure: it measures occupancy per worked run — riders carried
over the seats the bus on that run actually offered — because a client asking "was my bus full?" is
asking a different question from "was the fleet busy?".

## Staff transport report (RPT-02, implemented)

`src/tms/staffReport.ts`. Every count is by **service date** — the day of the run the rider was
carried on, not the day a record was typed, so a seat booked on Friday for Monday belongs to Monday.

| Metric | Formula | Population and exclusions |
|---|---|---|
| Runs scheduled | count of runs | Service date in the period, **status not `cancelled`**. A cancelled run is counted separately, never dropped |
| Runs worked | count of runs | Service date in the period, status `completed` |
| Runs cancelled | count of runs | Service date in the period, status `cancelled`, whatever the reason |
| Runs outside the schedule | count of runs | Service date in the period, `origin = adhoc` (DSP-03) |
| Expected | riders on the manifest of each **completed** run | `manifestFor()`: the route's active roster plus every seat that still holds one, a booking rider already on the roster counted once |
| Carried | count of boarding records | `outcome = boarded` on a completed run. **Never the roster size** — a rider is carried when somebody recorded them at the door |
| No-shows | count of boarding records | `outcome = no_show` on a completed run |
| Not recorded | expected − (carried + no-shows), floored at zero | Riders the manifest expected on a completed run with no outcome recorded at all. Shown as its own count and never folded into a rate |
| Boarding rate | carried ÷ (carried + no-shows) | Null when nothing was decided. "Not recorded" riders are outside the denominator, which is why the count travels with the rate |
| Seats offered | sum of `vehicle.seatCapacity` | Completed runs in the period **with a vehicle assigned**. A completed run with no vehicle offers no seats and is counted in the coverage |
| Occupancy | carried ÷ seats offered | Null when no seats were offered. Can be 0 % |
| Average delay | mean of (actual − scheduled) over stops where the actual time is **later** than the timetable | Recorded stops on runs in the period. Early arrivals contribute nothing: an early stop is not a small delay, and averaging it in would let one early stop cancel one late one out. Null when no stop was recorded late |
| Late stops | count of recorded stops later than the timetable | The denominator behind the average delay |
| On time | `onTimeReport()` from `kpis.ts`, unchanged | Judged against the threshold snapshotted when the run was completed, so a corrected stop time flows in without re-judging old runs against today's setting |
| Seats asked for | count of bookings by status | Bookings for a run whose **service date** is in the period — requested, confirmed, waiting list, offered, refused, cancelled |
| Seats not held now | requested + waiting list + refused + cancelled | The complement of held: seats somebody asked for that are not on a manifest today |
| Why seats were lost | count by the reason typed on refusal or cancellation | Most frequent first; a missing reason is reported as "No reason recorded" |

**A reported delay is a different figure, and is not in this report.** Since Phase 56 (D-105) a run
can carry delay reports — minutes behind the timetable, and why — entered while it was out. Those are
what the dispatch desk and the client's portal show *during* the run. The figures above are measured
from the stop times *after* it, and the two are deliberately not mixed: a report is somebody's
statement on the road, a stop time is a record of when the bus arrived.

**Per route and per client.** The same counts grouped by the run's route and by the route's client,
plus booked seats per client. A route whose runs were all cancelled still appears, with zero worked:
that is the thing worth seeing, and a route that vanished would read as one that never existed.

**Coverage shown with the report.** Runs with no vehicle assigned (they contribute no seats, so
occupancy is measured over fewer runs); completed runs with no boarding recorded; stops recorded of
stops expected; roster riders with no pickup stop. Each one explains a total a reader would
otherwise have to guess at.

**What the report cannot say.** Stated on the screen beside the figures (`STAFF_REPORT_LIMITS`):
fuel and mileage are not per route (an expense records no run and an odometer reading records no
route, so both belong to the money report); downtime is not measured, because nothing records a
vehicle being unavailable for a period; contract performance is not measured, because a run records
no agreement; a delay is known only where a stop time was recorded, and an unrecorded stop counts as
missing, never as on time.

**Statuses.** `invalid_range` — the start date is after the end date, every figure is zero and the
message names the mistake, because a slice of time would be read as a real period. `empty` — no run
has a service date in the period, or none was completed; the scheduled and cancelled counts still
print. `ok` otherwise. "Nothing ran" and "nobody travelled" are different sentences.

**Permission scope.** The staff tab is offered only to a role that may read the employee roster
(`passengers:read`); the payload has already been narrowed by the server, so the tab and the CSV can
never contain a rider the signed-in role cannot see.

## RPT-03 Financial report (implemented)

Computed by `src/tms/financialReport.ts` and covered by `src/tms/financialReport.test.ts`. The screen
prints it under the rental report, sharing the same period.

| Metric | Formula | Population and exclusions |
|---|---|---|
| Revenue by customer | sum of `invoice.total`, grouped by the name billed | Non-void invoices issued in the period. An invoice with no name is its own line, "No customer named". The row also carries **Credited** (credit notes issued on or before the period end), so invoiced − credited − paid = outstanding on screen |
| Revenue by service | the same invoices grouped by what was sold | Only vehicle hire is invoiced in this build; the report has one line and says so |
| Invoiced | sum of `invoice.total` | Non-void invoices issued in the period |
| Received | sum of `payment.amount` | Payments whose `paidOn` is in the period, whatever the invoice date |
| Credited | sum of `creditNote.total` | Credit notes **issued** in the period; a voided note counts for nothing. Money taken off a bill, never money received (D-86) |
| Outstanding | sum over non-void invoices issued on or before the period end of (total − payments paid on or before the period end − credit notes issued on or before the period end), floored at zero | Valued **at the period end**: a payment or a credit note dated later does not settle an invoice that was unpaid then. The arithmetic is the one helper in `src/tms/creditNotes.ts`, so this figure, the hire report and the invoice screen cannot disagree |
| Expenses by category | sum of recorded cost entries **and standalone expenses**, grouped by the configured category | Cost entries whose `incurredDate` is in the period on incidents reported or work orders raised in the period, plus live expenses whose `incurredOn` is in the period (D-93). Blank categories are shown as "Uncategorised". A voided expense counts for nothing; the cost report also states how many expenses carry no receipt number |
| Cost per trip | recorded expenses ÷ scheduled runs completed in the period | Null ("Not available") when no run was completed. This is the Q-29 definition |
| Cost per passenger | recorded expenses ÷ riders recorded as boarded on those completed runs | A no-show is not a passenger carried. Null when nobody boarded |

**What it deliberately does not do.** It does not compute profit or cost per vehicle. Fuel, tolls and
permits can now be entered (D-93), but an expense carries no vehicle and no trip, and driver pay is not
captured at all, so a cost per vehicle or a true margin would still flatter the business. That
limitation is printed under the figures rather than buried here.

**Margin, and the rule that keeps it honest (FIN-07, D-84).** One figure is called margin, and it is
withheld unless all four of these are true: the company currency is set; at least one non-void invoice
was issued in the period; at least one cost line was recorded in it; and **no hire completed in the
period is left unbilled**. The last condition is the important one — an unbilled hire is revenue that
exists and has not been written down, so a margin computed over it overstates the business. When the
rule fails the screen prints the reason instead of the number. Margin is `(invoiced − credited) − expenses`, shown
with its percentage of revenue; it is **not** profit (tax owed, deposits held and driver pay are not in it).
Cash movement (payments received minus recorded spend minus refunds paid back) is shown beside it, because the two answer
different questions.

**Coverage shown with the report.** Uncategorised cost lines; invoices with no customer name;
completed runs with no vehicle recorded; and the revenue-by-service line, which makes the
single-service limitation visible.

**Money paid back (D-92).** `Refunded` is cash, not cost: the sum of live refunds whose `paidOn` falls
in the period. It is stated on its own line and **never** added to `Costs recorded`, because a refund
does not make the work more expensive — it returns money that was never earned. It is subtracted in the
finance home's cash movement, which is a bank question rather than a margin question. A cancelled refund
counts as nothing.

**Debt ageing (RPT-04, D-90, D-91).** A fourth way of cutting the same money: everything still owed on
live invoices, **as at a stated date**, placed in the band its due date earns — not yet due, 1–30 days
late, 31–60, over 60. An invoice is measured at `outstanding` (total less payments that still count less
live credit notes), so a part-paid invoice is aged at what is left, never at its total; a void invoice
and a cancelled payment contribute nothing. The denominator is the invoices themselves: the four bands
must add up to the sum of `outstanding` over the same invoices, which is what the tests assert.

- **Per customer** — the customer statement (D-90), for a period, with the balance carried in and out.
- **Across the company** — the finance home's *Debt by age* card (D-91).
- **One banding function** (`ageBucketFor`) serves both, so an invoice cannot be 60 days late on the
  finance home and 61 on a statement sent to the customer.
- **One currency only.** When the outstanding invoices are in more than one currency, no total is
  stated and the currencies are named: adding them would produce a number true of nothing.

## Cost categories (Q-29, D-78)

Every recorded cost carries a category chosen from the list in Settings, or none at all. Nothing is
assumed: a new installation starts with an empty list, records costs as "Uncategorised", and the
report shows that line instead of hiding it. This is what makes "how much did tyres cost" answerable.

## Reporting rules applied to every KPI

1. Always show the reporting period.
2. Always show the numerator and denominator, or the counts behind them.
3. Always show data coverage.
4. Never show a KPI as verified when an input is missing (Integrity rule 4).
5. Do not compute profit or margin until revenue and cost inputs exist, and never while work done in
   the period is still unbilled (the FIN-07 margin rule above).

## Rental report (RPT-01, implemented)

Every figure is computed by `src/tms/rentalReport.ts` and covered by `src/tms/rentalReport.test.ts`.
The period is inclusive of both dates, by calendar day (Africa/Accra, no daylight saving — brief 5.5).

| Metric | Formula | Population and exclusions |
|---|---|---|
| Enquiries | count of rentals | `rental.created_at` inside the period. Every request counts, whatever its current status |
| Quotations issued | count of rentals with a quotation | `rental.quote.quotedAt` inside the period; the latest quotation counts once, revisions do not inflate the count |
| Accepted | quotations whose rental is `confirmed`, `in_progress` or `completed` | Quoted in the period |
| Declined | quotations whose rental is `declined` | Quoted in the period |
| Cancelled | rentals cancelled in the period | `updatedAt` inside the period, status `cancelled` |
| Acceptance rate | accepted ÷ quotations issued | Null when nothing was quoted. Shown as "Not available", never 0% |
| Invoiced | sum of `invoice.total` | Invoices issued in the period, excluding `void` |
| Received | sum of `payment.amount` | Payments whose `paidOn` is in the period, whatever the invoice date |
| Credited | sum of `creditNote.total` | Credit notes issued in the period, excluding `void` (D-86) |
| Outstanding | sum of (invoice total − recorded payments − issued credit notes), floored at zero | Non-void invoices issued on or before the period end, including earlier periods, because money owed is a running balance. Same helper as the finance report |
| Rental vehicle-days | count of days in the period on which a rental holds a vehicle | Rentals with status `confirmed`, `in_progress` or `completed` **and** an assigned vehicle, overlapping the day |
| Available vehicle-days | vehicles in the fleet excluding `retired` × days in the period | The acting fleet, not the fleet as it was on each day — a limitation stated on screen |
| Utilisation | rental vehicle-days ÷ available vehicle-days | Null when the period has no days or no vehicles. Can be 0%. Does not include staff-busing trips, which have their own occupancy measure in the staff transport report (RPT-02) |
| Reasons | count by `resolutionReason` | Cancelled and declined rentals in the period; a missing reason is reported as "No reason recorded", never dropped |

**Coverage shown with the report.** Requests in the period without a quotation; confirmed rentals with
no vehicle assigned; invoices with no currency. The first explains a low quotation count, the second is
a data-quality alarm (it should be zero), the third explains withheld money.

**Money and currency.** If the company currency is not set, the money figures are not printed: the
screen and the CSV say "Not configured"/"not available" and the report carries the reason. A bare
number would be a guess about the unit (brief §2.3).

**Permission scope.** The screen reads the snapshot the server already narrowed for the signed-in
role, and the CSV is written from that same snapshot, so an export cannot contain a record the role
cannot read. The destination is gated by `kpis:read`.
