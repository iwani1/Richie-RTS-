"use client";

import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The controls that sit above a list: a search box and one or more narrowing selects.
 *
 * Both are native controls on purpose. A native `<select>` is driven from the keyboard, by a screen
 * reader and by a phone's own picker, and it needs no library to do it — the caret is a Lucide icon
 * placed over the control rather than a colour baked into a data-URI, so it takes its colour from the
 * token that is being used, not from a grey somebody typed once.
 */

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name. Never a placeholder doing double duty. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative block w-full max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
        className="h-8 w-full rounded-control border border-border bg-card pr-2.5 pl-8 text-[13px] text-foreground shadow-xs transition-colors outline-none placeholder:text-dim hover:border-border focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 [&::-webkit-search-cancel-button]:appearance-none"
      />
    </span>
  );
}

export function FilterSelect({
  value,
  onChange,
  label,
  children,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name, e.g. "Filter by entity". */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-8 w-full appearance-none rounded-control border border-border bg-card pr-7 pl-2.5 text-[13px] text-foreground shadow-xs transition-colors outline-none hover:border-border focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-dim" aria-hidden="true" />
    </span>
  );
}

/** What the list is showing, said in the numbers it is showing: the line under a filtered table. */
export function FilterNote({ children }: { children: React.ReactNode }) {
  return <p className="tms-mono text-dim" role="status">{children}</p>;
}
