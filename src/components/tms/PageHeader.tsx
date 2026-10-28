"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
 */
export function PageHeader({
  title,
  subtitle,
  range,
  onRangeChange,
  onNewBooking,
  className,
}: {
  title: string;
  subtitle: string;
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  onNewBooking?: () => void;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 border-b border-divider pb-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
        <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Reporting period" className="inline-flex items-center gap-0.5 rounded-control border border-border bg-card p-0.5">
          {RANGES.map((option) => {
            const active = range === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onRangeChange(option.key)}
                className={cn(
                  "rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-row-hover hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {onNewBooking && (
          <Button size="default" className="tms-press h-9 gap-1.5 rounded-control px-3.5 font-medium" onClick={onNewBooking}>
            <Plus className="size-4" aria-hidden="true" />
            New booking
          </Button>
        )}
      </div>
    </header>
  );
}
