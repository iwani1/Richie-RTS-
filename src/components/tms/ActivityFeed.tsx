import { cn } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/mock/types";
import { ActivityKindBadge } from "./StatusBadge";

const MINUTE = 60_000;

/**
 * A timestamp the way a person reads one: "4m ago", "2h ago", "yesterday". Deliberately coarse —
 * a dispatch desk cares whether something just happened, not the second it happened.
 */
export function relativeTime(iso: string, now: string): string {
  const then = new Date(iso).getTime();
  const reference = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(reference)) return "";
  const minutes = Math.round((reference - then) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * What has happened, newest first.
 *
 * `now` is passed in rather than read from the clock here: the feed must say the same thing on the
 * server render and in the browser, and a relative time computed from `Date.now()` in two places
 * is two different sentences.
 */
export function ActivityFeed({
  entries,
  now,
  className,
  limit,
}: {
  entries: ActivityEntry[];
  now: string;
  className?: string;
  limit?: number;
}) {
  const shown = limit ? entries.slice(0, limit) : entries;

  return (
    <ol className={cn("relative", className)}>
      {shown.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
          {/* the rail: a line from this entry to the next, and none after the last one */}
          {index < shown.length - 1 && <span aria-hidden="true" className="absolute top-4 bottom-0 left-[3px] w-px bg-divider" />}
          <span
            aria-hidden="true"
            className={cn(
              "relative z-10 mt-1.5 size-[7px] shrink-0 rounded-full ring-4 ring-card",
              entry.kind === "alert" ? "bg-danger" : entry.kind === "dispatch" ? "bg-primary" : entry.kind === "status" ? "bg-success" : "bg-dim",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px] leading-snug text-foreground">{entry.title}</p>
              <time dateTime={entry.at} className="tms-mono shrink-0 text-dim">
                {relativeTime(entry.at, now)}
              </time>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <ActivityKindBadge kind={entry.kind} />
              <span className="text-[12px] text-muted-foreground">{entry.actor}</span>
              {index === 0 && <span className="text-[11px] text-dim">· latest</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
