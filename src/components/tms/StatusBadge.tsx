import { cn } from "@/lib/utils";
import type { TripStatus, ActivityKind } from "@/lib/mock/types";

export type BadgeTone = "success" | "danger" | "info" | "warning" | "primary" | "neutral";

const TONE: Record<BadgeTone, string> = {
  success: "bg-success-tint text-success",
  danger: "bg-danger-tint text-danger",
  info: "bg-info-tint text-info",
  warning: "bg-warning-tint text-warning",
  primary: "bg-primary-tint text-primary",
  neutral: "bg-neutral-tint text-muted-foreground",
};

/**
 * A status is a word, a 6px dot and a 13% tint of the status colour — never a solid fill, and never
 * colour alone: the word carries the meaning, the colour reinforces it.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] leading-none font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const TRIP: Record<TripStatus, { label: string; tone: BadgeTone }> = {
  on_route: { label: "On route", tone: "success" },
  boarding: { label: "Boarding", tone: "info" },
  delayed: { label: "Delayed", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

/** The trip vocabulary in one place, so two screens cannot call the same state by different names. */
export function TripStatusBadge({ status }: { status: TripStatus }) {
  const { label, tone } = TRIP[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

const ACTIVITY: Record<ActivityKind, { tone: BadgeTone; label: string }> = {
  dispatch: { tone: "primary", label: "Dispatch" },
  status: { tone: "success", label: "Status" },
  alert: { tone: "danger", label: "Alert" },
  finance: { tone: "info", label: "Money" },
  maintenance: { tone: "warning", label: "Maintenance" },
  system: { tone: "neutral", label: "System" },
};

export function ActivityKindBadge({ kind }: { kind: ActivityKind }) {
  const { tone, label } = ACTIVITY[kind];
  return (
    <StatusBadge tone={tone} dot={false} className="text-[11px]">
      {label}
    </StatusBadge>
  );
}
