import type { Settings } from "./types";

/**
 * The five rules the app cannot function without. Each one is nullable or empty until management
 * supplies it (no defaults are invented), so "still unset" is a real state of the installation and
 * is shown on the dashboard, on Settings, and in the first-run copy from this one list.
 */
export interface SetupItem {
  key: "company_name" | "currency" | "vehicle_categories" | "shifts" | "on_time_threshold";
  label: string;
  /** What breaks, or stays blocked, while this is unset. Shown beside the item, never guessed. */
  consequence: string;
  done: boolean;
}

export function setupChecklist(settings: Settings): SetupItem[] {
  return [
    {
      key: "company_name",
      label: "Company name",
      consequence: "Quotations and invoices have no issuer",
      done: Boolean(settings.companyName),
    },
    {
      key: "currency",
      label: "Billing currency",
      consequence: "Money cannot be quoted or totalled",
      done: Boolean(settings.currencyCode),
    },
    {
      key: "vehicle_categories",
      label: "Vehicle categories (at least one)",
      consequence: "Vehicles cannot be classified or scheduled",
      done: settings.vehicleCategories.length > 0,
    },
    {
      key: "shifts",
      label: "Shift definitions",
      consequence: "Staff busing cannot place runs in a shift",
      done: settings.shifts.length > 0,
    },
    {
      key: "on_time_threshold",
      label: "On-time threshold (minutes)",
      consequence: "Punctuality cannot be judged",
      done: settings.onTimeThresholdMinutes !== null,
    },
  ];
}

export interface SetupProgress {
  items: SetupItem[];
  done: number;
  outstanding: number;
  /** 0–100, whole percent. */
  percent: number;
  complete: boolean;
}

export function setupProgress(settings: Settings): SetupProgress {
  const items = setupChecklist(settings);
  const done = items.filter((i) => i.done).length;
  const outstanding = items.length - done;
  return {
    items,
    done,
    outstanding,
    percent: Math.round((done / items.length) * 100),
    complete: outstanding === 0,
  };
}
