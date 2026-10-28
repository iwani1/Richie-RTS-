"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
 *
 * A figure that has somewhere to go gets an `href`. Reading "3 late" and being unable to press it is
 * the commonest dead end a board has; the card carries the arrow so the door is visible before the
 * pointer finds it. A figure with nowhere honest to go stays a plain card rather than a link to
 * nothing.
 */
export function StatCard({
  kpi,
  index = 0,
  href,
  onPress,
  pressLabel,
  className,
}: {
  kpi: Kpi;
  index?: number;
  href?: string;
  /** Act in place — narrow the list below, for instance — when there is no screen to go to. */
  onPress?: () => void;
  /** The accessible name of that action: "Show the 18 runs that are moving". */
  pressLabel?: string;
  className?: string;
}) {
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

  const card = (
    <article
      className={cn("tms-surface tms-lift tms-spotlight tms-stagger animate-fade-up group relative overflow-hidden p-4", className)}
      style={{ ["--stagger" as string]: index }}
      onPointerMove={spotlight.onPointerMove}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="tms-mono text-muted-foreground">{kpi.label}</p>
        {(href || onPress) && (
          <ArrowUpRight
            className="size-3.5 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        )}
      </div>
      {/* The figure changes in place; this wrapper stays put so a screen reader is told once. */}
      <div aria-live="polite">
        <p key={pulse} className={cn("mt-2 inline-block text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums", pulse > 0 && "animate-bump")}>
          {kpi.value}
        </p>
      </div>
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

  if (href) {
    return (
      <Link href={href} className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {card}
      </Link>
    );
  }
  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        aria-label={pressLabel ?? `${kpi.label}: ${kpi.value}`}
        className="block w-full rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {card}
      </button>
    );
  }
  return card;
}

/** The row of four. The grid owns the sibling-dimming behaviour, so it is one hover idea, not four. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("tms-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}
