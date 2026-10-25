// Cost reporting for staff logistics.
//
// Costs are operator-entered facts. This module never invents a rate or a price, and it does not
// decide what a category means: the names come from the company's list in Settings, and an entry
// without one is reported as "Uncategorised" (Q-29, D-78).
// Every figure is returned together with its reporting period and data coverage, and a
// total is only produced once the company currency has been set (no default).

import { sumAmounts } from "./money";
import type { CostEntry, Database } from "./types";

export interface CostLine extends CostEntry {
  source: "incident" | "work_order";
  sourceReference: string;
  sourceDate: string;
}

export interface CostReport {
  from: string;
  to: string;
  currencyCode: string | null;
  lines: CostLine[];
  total: number;
  incidentsWithCosts: number;
  incidentsWithoutCosts: number;
  workOrdersWithCosts: number;
  workOrdersWithoutCosts: number;
  workOrdersCostsConfirmed: number;
  coverage: number | null;
  status: "ok" | "no_costs" | "currency_not_set";
  message: string;
}

const dateOf = (iso: string) => iso.slice(0, 10);

export function costReport(db: Database, from: string, to: string): CostReport {
  const inRange = (d: string) => d >= from && d <= to;
  const currencyCode = db.settings.currencyCode;

  const incidents = db.incidents.filter((i) => inRange(i.reportedDate));
  const workOrders = db.workOrders.filter((w) => inRange(dateOf(w.createdAt)));

  const lines: CostLine[] = [];
  for (const incident of incidents) {
    for (const cost of incident.costEntries) {
      if (!inRange(cost.incurredDate)) continue;
      lines.push({ ...cost, source: "incident", sourceReference: incident.reference, sourceDate: incident.reportedDate });
    }
  }
  for (const order of workOrders) {
    for (const cost of order.costEntries) {
      if (!inRange(cost.incurredDate)) continue;
      lines.push({ ...cost, source: "work_order", sourceReference: order.reference, sourceDate: dateOf(order.createdAt) });
    }
  }
  lines.sort((a, b) => (a.incurredDate === b.incurredDate ? a.description.localeCompare(b.description) : a.incurredDate < b.incurredDate ? -1 : 1));

  const incidentsWithCosts = incidents.filter((i) => i.costEntries.length > 0).length;
  const workOrdersWithCosts = workOrders.filter((w) => w.costEntries.length > 0).length;
  const workOrdersCostsConfirmed = workOrders.filter((w) => w.costsConfirmedComplete).length;
  const recordsInScope = incidents.length + workOrders.length;
  const recordsWithCosts = incidentsWithCosts + workOrdersWithCosts;
  const coverage = recordsInScope > 0 ? recordsWithCosts / recordsInScope : null;
  // Added in whole pesewas: a hundred cost lines summed as floats can land a cent out (D-04).
  const total = sumAmounts(lines.map((line) => line.amount));

  const base = {
    from,
    to,
    currencyCode,
    lines,
    total,
    incidentsWithCosts,
    incidentsWithoutCosts: incidents.length - incidentsWithCosts,
    workOrdersWithCosts,
    workOrdersWithoutCosts: workOrders.length - workOrdersWithCosts,
    workOrdersCostsConfirmed,
    coverage,
  };

  if (from > to)
    return { ...base, status: "no_costs", message: "The reporting period is invalid: the start date is after the end date." };
  if (!currencyCode)
    return {
      ...base,
      status: "currency_not_set",
      message: "The company currency has not been set (OPEN_QUESTIONS Q-14), so no total is shown. Amounts cannot be added together across currencies.",
    };
  if (lines.length === 0)
    return {
      ...base,
      status: "no_costs",
      message: "No costs have been recorded in this period. This is not the same as zero cost: it means nothing was entered.",
    };
  return {
    ...base,
    status: "ok",
    message: `${recordsWithCosts} of ${recordsInScope} incident(s) and work order(s) in this period have at least one recorded cost.`,
  };
}
