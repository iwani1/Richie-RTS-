# KPI definitions

## Source note

The uploaded brief names RPT-01 to RPT-03 but does not define them. An earlier version of this project described them as "on-time rate, utilisation, cost per trip". That was an assumption, not a definition from the business. The definitions below are proposals. Management must confirm them (OPEN_QUESTIONS Q-29), and the screens say so.

Every KPI on screen shows its reporting period, numerator, denominator and data coverage. A KPI with missing inputs shows "Not computed" or "Insufficient data", never a number.

## On-time rate (implemented; belongs to RPT-02, definition pending confirmation)

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

## RPT-02 Fleet utilisation (not configured)

No definition exists in the source material. The calculation needs available hours per vehicle per period, which are not captured. The screen shows "Not configured" and no estimate. Definition and inputs are needed (Q-29).

## RPT-03 Cost per trip (not configured)

No definition exists in the source material. The calculation needs a cost ledger (fuel, maintenance, driver pay, tolls and other costs) **and** a rule for which costs belong to a trip. Neither exists. The screen shows "Not configured". Definition, cost categories and the attribution rule are needed (Q-29).

### What Phase 3 does report instead

`costs.ts` reports **recorded costs**, which is a narrower and clearly different thing:

    coverage = records with at least one recorded cost / records in scope

Records in scope are incidents (by reported date) and work orders (by raised date) in the
reporting period. Entries are counted by date incurred.

| Shown | Meaning |
|---|---|
| Total recorded | Sum of amounts entered, only when the company currency is set |
| Data coverage | How many records have any cost recorded at all |
| Records with no cost | Counted separately and labelled as such |
| Message when empty | "Nothing was recorded. This is not the same as zero cost." |

This is **not** a cost per trip, not a cost per vehicle, not an operating cost and not a margin.
It is the sum of what someone typed in, and it says so.

## Reporting rules applied to every KPI

1. Always show the reporting period.
2. Always show the numerator and denominator, or the counts behind them.
3. Always show data coverage.
4. Never show a KPI as verified when an input is missing (Integrity rule 4).
5. Do not compute profit or margin until revenue and cost inputs exist.

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
| Outstanding | sum of (invoice total − recorded payments) | Non-void invoices issued on or before the period end, including earlier periods, because money owed is a running balance |
| Rental vehicle-days | count of days in the period on which a rental holds a vehicle | Rentals with status `confirmed`, `in_progress` or `completed` **and** an assigned vehicle, overlapping the day |
| Available vehicle-days | vehicles in the fleet excluding `retired` × days in the period | The acting fleet, not the fleet as it was on each day — a limitation stated on screen |
| Utilisation | rental vehicle-days ÷ available vehicle-days | Null when the period has no days or no vehicles. Can be 0%. Does not include staff-busing trips, which are RPT-02 |
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
