import { cn } from "@/lib/utils";

/**
 * How much of a service interval has been used, as a bar.
 *
 * Decorative by contract: every caller sets the same numbers beside it, so the bar never carries a
 * fact on its own. The colour repeats the state the words already state — green for inside the
 * interval, amber for the reminder band, red for overdue, grey when there is no schedule to measure
 * against.
 */
export function IntervalBar({
  percent,
  tone = "ok",
  className,
}: {
  /** 0–100. Anything outside is clamped rather than drawn over the end of the track. */
  percent: number;
  tone?: "ok" | "due" | "overdue" | "none";
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, Math.round(percent)));
  const fill = {
    ok: "bg-success",
    due: "bg-warning",
    overdue: "bg-danger",
    none: "bg-dim",
  }[tone];

  return (
    <span className={cn("block h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-secondary", className)} aria-hidden="true">
      <span className={cn("block h-full rounded-full transition-[width] duration-500 ease-out", fill)} style={{ width: `${width}%` }} />
    </span>
  );
}
