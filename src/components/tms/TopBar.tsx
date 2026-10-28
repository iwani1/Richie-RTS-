"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveDot } from "./LiveDot";

/**
 * The bar above the work: where you are, how to get anywhere else, and what wants your attention.
 *
 * The search field is not an input — it opens the palette, where the typing actually happens. That
 * keeps one search surface in the product instead of two that filter differently, and it is why the
 * field carries the ⌘K hint rather than its own placeholder logic.
 */
export function TopBar({
  breadcrumb,
  onOpenPalette,
  className,
}: {
  breadcrumb: Array<{ label: string; href?: string }>;
  onOpenPalette: () => void;
  className?: string;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // A disclosure closes when the pointer leaves it or Escape is pressed; it is not a modal and must
  // not trap anything.
  useEffect(() => {
    if (!notificationsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!bellRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [notificationsOpen]);

  return (
    <header className={cn("sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 lg:px-6", className)}>
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1.5">
          {breadcrumb.map((crumb, index) => {
            const last = index === breadcrumb.length - 1;
            return (
              <li key={crumb.label} className="flex min-w-0 items-center gap-1.5">
                {index > 0 && <ChevronRight className="size-3 shrink-0 text-dim" aria-hidden="true" />}
                <span className={cn("tms-mono truncate", last ? "text-foreground" : "text-dim")} aria-current={last ? "page" : undefined}>
                  {crumb.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts="Control+K Meta+K"
          className="group hidden items-center gap-2 rounded-control border border-border bg-card px-2.5 py-1.5 text-[12px] text-dim transition-colors hover:border-border hover:text-muted-foreground focus-visible:outline-none md:flex"
        >
          <Search className="size-3.5" aria-hidden="true" />
          <span className="w-40 text-left">Search or jump to…</span>
          <kbd className="tms-mono rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
        </button>

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search or jump to a screen"
          aria-keyshortcuts="Control+K Meta+K"
          className="grid size-9 place-items-center rounded-control border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none md:hidden"
        >
          <Search className="size-4" aria-hidden="true" />
        </button>

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            className="relative grid size-9 place-items-center rounded-control border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
          >
            <Bell className="size-4" aria-hidden="true" />
            <LiveDot tone="primary" className="absolute top-2 right-2" />
          </button>

          {notificationsOpen && (
            <div
              role="dialog"
              aria-label="Notifications"
              className="animate-slide-in absolute right-0 z-40 mt-2 w-[19rem] rounded-card border border-border bg-popover p-3 shadow-pop"
            >
              <p className="tms-mono text-dim">Notifications</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                This build sends nothing and generates no alerts. The bell is wired to a real panel so the
                shape is settled; the messages arrive with the notification channel, which does not exist yet.
              </p>
              <p className="mt-2 text-[12px] text-dim">Nothing is queued, and nothing has been missed.</p>
            </div>
          )}
        </div>

        <button
          type="button"
          className="flex items-center gap-2 rounded-control border border-border bg-card py-1 pr-2 pl-1 text-left transition-colors hover:bg-row-hover focus-visible:outline-none"
          aria-label="Account menu"
        >
          <span className="grid size-7 place-items-center rounded-full bg-primary-tint text-[11px] font-semibold text-primary" aria-hidden="true">
            AB
          </span>
          <span className="hidden text-[12px] text-muted-foreground lg:inline">Ama Boateng</span>
        </button>
      </div>
    </header>
  );
}
