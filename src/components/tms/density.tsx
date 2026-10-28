"use client";

import { useSyncExternalStore } from "react";
import { AlignJustify, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How tightly a table is set.
 *
 * One preference for the whole product, not one per table: somebody who has chosen compact rows has
 * chosen them for the hour they are reconciling, and every list they open should honour that. The
 * value lives in `localStorage` behind a tiny store, so a table does not have to be wrapped in a
 * provider and a screen does not have to thread a prop down to reach it.
 */
export type Density = "comfortable" | "compact";

const KEY = "richie.density";
const listeners = new Set<() => void>();
let cached: Density | null = null;

function read(): Density {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    // Private mode, or storage disabled. A preference that cannot be remembered is not an error.
    cached = "comfortable";
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(next: Density) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Remembered for this session at least: `cached` above still holds it.
  }
  for (const listener of listeners) listener();
}

/** The reader's choice, or comfortable on the server and before the first read. */
export function useDensity(): Density {
  return useSyncExternalStore(subscribe, read, () => "comfortable");
}

/** Row padding per density. Comfortable is a working row; compact is a scanning row. */
export const ROW_PADDING: Record<Density, string> = {
  comfortable: "py-3",
  compact: "py-1.5",
};

export const HEADER_HEIGHT: Record<Density, string> = {
  comfortable: "h-9",
  compact: "h-8",
};

/**
 * The switch itself. Two buttons in a labelled group rather than a toggle: "compact" and
 * "comfortable" are both states a reader might arrive looking for, and a single button hides one.
 */
export function DensityToggle({ className }: { className?: string }) {
  const density = useDensity();
  const options: Array<{ key: Density; label: string; Icon: typeof Rows3 }> = [
    { key: "comfortable", label: "Comfortable rows", Icon: Rows3 },
    { key: "compact", label: "Compact rows", Icon: AlignJustify },
  ];

  return (
    <div
      role="group"
      aria-label="Row density"
      className={cn("inline-flex items-center gap-0.5 rounded-control border border-border bg-card p-0.5", className)}
    >
      {options.map(({ key, label, Icon }) => {
        const active = density === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={label}
            onClick={() => write(key)}
            className={cn(
              "grid size-6 place-items-center rounded-[7px] transition-colors focus-visible:outline-none",
              active ? "bg-muted text-foreground" : "text-dim hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
