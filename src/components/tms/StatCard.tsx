"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpotlight } from "./useSpotlight";
import type { Kpi } from "@/lib/mock/types";

const TREND = {
  up: { icon: ArrowUpRight, className: "text-success" },
  down: { icon: ArrowDownRight, className: "text-danger" },
  flat: { icon: Minus, className: "text-muted-foreground" },
} as const;

/** Bars of a recorded series. Height is relative to the series' own maximum, never to a target. */
function Sparkline({ series, label }: { series: number[]; label?: string }) {
  const max = Math.max(...series, 1);
  return (
    <div className="mt-3 flex h-9 items-end gap-1" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {series.map((value, index) => (
        <span
          key={index}
          className="flex-1 origin-bottom rounded-[2px] bg-primary/25 animate-grow-bar last:bg-primary"
          style={{ height: `${Math.max(12, Math.round((value / max) * 100))}%`, ["--stagger" as string]: index }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/**
 * One recorded figure: mono caption, 30px number, delta chip, and the shape of the last seven
 * periods. It takes a `Kpi` — the screen decides what the figure is, the card only decides how it
 * looks.
 */
export function StatCard({ kpi, index = 0, className }: { kpi: Kpi; index?: number; className?: string }) {
  const delta = kpi.delta;
  const trend = delta ? TREND[delta.trend] : null;
  const TrendIcon = trend?.icon;
  const spotlight = useSpotlight<HTMLElement>();

  // A figure that changes says so once: the value is re-keyed so the bump replays, and the first
  // render is silent — nothing bounces just because a page opened.
  const firstValue = useRef(kpi.value);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (firstValue.current === kpi.value) return;
    firstValue.current = kpi.value;
    setPulse((count) => count + 1);
  }, [kpi.value]);

  return (
    <article
      className={cn("tms-surface tms-lift tms-spotlight tms-stagger animate-fade-up group relative overflow-hidden p-4", className)}
      style={{ ["--stagger" as string]: index }}
      onPointerMove={spotlight.onPointerMove}
    >
      <p className="tms-mono text-muted-foreground">{kpi.label}</p>
      <p key={pulse} className={cn("mt-2 inline-block text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums", pulse > 0 && "animate-bump")}>
        {kpi.value}
      </p>
      <div className="mt-2.5 flex min-h-5 items-center gap-2">
        {delta && trend && TrendIcon && (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums",
                delta.trend === "up" ? "bg-success-tint" : delta.trend === "down" ? "bg-danger-tint" : "bg-neutral-tint",
                trend.className,
              )}
            >
              <TrendIcon className="size-3" aria-hidden="true" />
              {delta.value}
            </span>
            <span className="text-[12px] text-dim">{delta.caption}</span>
          </>
        )}
      </div>
      {kpi.series && kpi.series.length > 1 && <Sparkline series={kpi.series} label={kpi.seriesLabel} />}
    </article>
  );
}

/** The row of four. The grid owns the sibling-dimming behaviour, so it is one hover idea, not four. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("tms-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}
