import { cn } from "@/lib/utils";
import type { RingSummary } from "@/lib/mock/types";

const SIZE = 148;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const INK_FILL: Record<string, string> = {
  on_route: "bg-primary",
  available: "bg-info",
  maintenance: "bg-warning",
  reserved: "bg-muted-foreground",
};

const SLICE_INK: Record<string, string> = {
  on_route: "text-primary",
  available: "text-info",
  maintenance: "text-warning",
  reserved: "text-muted-foreground",
};


/**
 * The same mix as one bar. A ring is good at "how much", poor at "how many of each"; the bar answers
 * the second without a second legend. Decorative — the counts are already in the ring's list.
 */
export function FleetMixBar({ summary, className }: { summary: RingSummary; className?: string }) {
  const total = summary.slices.reduce((sum, slice) => sum + slice.count, 0);
  if (total === 0) return null;
  return (
    <div
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="img"
      aria-label={summary.slices.map((slice) => `${slice.label}: ${slice.count}`).join(". ")}
    >
      {summary.slices.map((slice) => (
        <span
          key={slice.key}
          className={cn("h-full first:rounded-l-full last:rounded-r-full", INK_FILL[slice.key] ?? "bg-muted-foreground")}
          style={{ width: `${(slice.count / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * How the fleet is spent this morning, as a ring and a legend.
 *
 * Each arc animates in from the ring's own circumference to its length (CSS only, and skipped
 * entirely when the reader has asked for reduced motion). The centre states the one number the ring
 * is about, so the picture is never the only place a figure lives.
 */
export function RingGauge({ summary, className }: { summary: RingSummary; className?: string }) {
  const total = summary.slices.reduce((sum, slice) => sum + slice.count, 0);
  let offset = 0;

  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-around", className)}>
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${summary.percent} per cent of the fleet is on route. ${summary.caption}`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-muted"
            aria-hidden="true"
          />
          {/* A group rotation, about the ring's own centre, so the first arc starts at twelve o'clock.
              Rotating each circle about its own centre would leave the start where it was. */}
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {total > 0 &&
              summary.slices.map((slice) => {
                const length = (slice.count / total) * CIRCUMFERENCE;
                const dashOffset = offset;
                offset += length;
                return (
                  <circle
                    key={slice.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    strokeWidth={STROKE}
                    strokeLinecap="butt"
                    strokeDasharray={`${Math.max(length - 4, 1)} ${CIRCUMFERENCE}`}
                    className={cn("animate-ring", SLICE_INK[slice.key] ?? "text-muted-foreground")}
                    stroke="currentColor"
                    style={{
                      ["--ring-circumference" as string]: CIRCUMFERENCE,
                      ["--ring-offset" as string]: -dashOffset,
                      strokeDashoffset: -dashOffset,
                    }}
                    aria-hidden="true"
                  />
                );
              })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[30px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums">{summary.percent}%</span>
          <span className="tms-mono mt-1.5 text-muted-foreground">On route</span>
        </div>
      </div>

      <ul className="w-full max-w-[15rem] space-y-2.5">
        {summary.slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5 text-[13px]">
            <span aria-hidden="true" className={cn("size-2 rounded-[2px] bg-current", SLICE_INK[slice.key] ?? "text-muted-foreground")} />
            <span className="flex-1 text-muted-foreground">{slice.label}</span>
            <span className="font-medium text-foreground tabular-nums">{slice.count}</span>
            <span className="w-9 text-right text-[12px] text-dim tabular-nums">{total ? Math.round((slice.count / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
