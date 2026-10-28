import { cn } from "@/lib/utils";

/**
 * The "this is happening now" mark: a small dot with a soft halo, pulsing.
 *
 * Decorative by default — the word next to it says what is live, and a screen reader is given that
 * word rather than a heartbeat. The pulse is CSS only and stops under `prefers-reduced-motion`.
 */
export function LiveDot({
  tone = "success",
  label,
  className,
}: {
  tone?: "success" | "warning" | "danger" | "primary" | "muted";
  /** Read out when the dot itself is the only signal. Omit when a visible word sits beside it. */
  label?: string;
  className?: string;
}) {
  const ink = {
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    primary: "text-primary",
    muted: "text-muted-foreground",
  }[tone];

  return (
    <span className={cn("relative inline-flex size-2 shrink-0 items-center justify-center", ink, className)} role={label ? "img" : undefined} aria-label={label}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-current opacity-25 animate-pulse-dot" />
      <span aria-hidden="true" className="relative size-1.5 rounded-full bg-current" />
    </span>
  );
}
