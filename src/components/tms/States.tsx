import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A card's loading state: skeleton bars shaped like the rows that are coming. */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-px" role="status" aria-live="polite" aria-label="Loading rows">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-3 border-b border-divider px-4 py-3.5 last:border-b-0">
          {Array.from({ length: columns }).map((__, column) => (
            <span
              key={column}
              className="h-3 animate-pulse rounded bg-muted"
              style={{ width: column === 0 ? 64 : column === columns - 1 ? 44 : `${12 + ((row + column) % 3) * 6}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
        <Inbox className="size-5" />
      </span>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="max-w-[42ch] text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, onRetry, className }: { title: string; body: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)} role="alert">
      <span className="mb-1 grid size-10 place-items-center rounded-full bg-danger-tint text-danger" aria-hidden="true">
        <AlertTriangle className="size-5" />
      </span>
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
