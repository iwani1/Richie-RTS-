"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlidingTabs } from "./GlidingTabs";
import type { RangeKey } from "@/lib/mock/types";

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/**
 * The top of every screen: what this is, the period it is reporting on, and the one action that
 * matters. The range control is a real radio group, so it can be driven from the keyboard and is
 * announced as one control rather than three buttons.
 *
 * Not every screen reports on a period — an append-only log has no "this week" — so the range is
 * optional. A screen that has no period passes none and is not given an empty one to explain away.
 */
export function PageHeader({
  kicker,
  title,
  subtitle,
  range,
  onRangeChange,
  actions,
  onNewBooking,
  className,
}: {
  /** The mono line above the title, saying what part of the product this is. */
  kicker?: string;
  title: string;
  subtitle: string;
  range?: RangeKey;
  onRangeChange?: (range: RangeKey) => void;
  /** Screen-specific controls, placed beside the period. At most one primary action per screen. */
  actions?: React.ReactNode;
  onNewBooking?: () => void;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 border-b border-divider pb-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        {kicker && <p className="tms-mono text-dim">{kicker}</p>}
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
        <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {range && onRangeChange && (
          <GlidingTabs
            options={RANGES.map((option) => ({ key: option.key, label: option.label }))}
            value={range}
            onChange={(key) => onRangeChange(key as RangeKey)}
            ariaLabel="Reporting period"
          />
        )}

        {actions}

        {onNewBooking && (
          <Button size="default" className="tms-press tms-sheen h-9 gap-1.5 rounded-control px-3.5 font-medium" onClick={onNewBooking}>
            <Plus className="size-4" aria-hidden="true" />
            New booking
          </Button>
        )}
      </div>
    </header>
  );
}
