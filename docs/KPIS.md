# KPI definitions

## Source note

The uploaded brief names RPT-01 to RPT-03 but does not define them. An earlier version of this project described them as "on-time rate, utilisation, cost per trip". That was an assumption, not a definition from the business. The definitions below are proposals. Management must confirm them (OPEN_QUESTIONS Q-29), and the screens say so.

Every KPI on screen shows its reporting period, numerator, denominator and data coverage. A KPI with missing inputs shows "Not computed" or "Insufficient data", never a number.

## RPT-01 On-time rate (implemented; definition pending confirmation)

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
