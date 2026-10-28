"use client";

import { cn } from "@/lib/utils";

/**
 * The sections of one screen.
 *
 * A real tab list: one tab stop for the strip, arrow keys move between the sections, Home and End
 * go to the ends, and the selected tab says so with `aria-selected` rather than with colour alone.
 * The underline is the accent; the words say which section is open.
 *
 * It exists because four screens were carrying a hand-written copy of the same five lines of
 * markup, which is how one of them ends up selected by a different mechanism than the others.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const select = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length];
    if (next) onChange(next.id);
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex gap-1 overflow-x-auto border-b border-divider", className)}>
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                select(index + 1);
                (event.currentTarget.parentElement?.children[index + 1] as HTMLElement | undefined)?.focus();
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                select(index - 1);
                (event.currentTarget.parentElement?.children[index - 1] as HTMLElement | undefined)?.focus();
              } else if (event.key === "Home") {
                event.preventDefault();
                select(0);
              } else if (event.key === "End") {
                event.preventDefault();
                select(tabs.length - 1);
              }
            }}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
