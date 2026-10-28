"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  href: string;
  label: string;
  hint: string;
  /** True when the destination is not built yet: shown, described, and not a link. */
  planned?: boolean;
}

const DEFAULT_ITEMS: PaletteItem[] = [
  { href: "/dashboard", label: "Operations overview", hint: "KPIs, fleet, live trips" },
  { href: "/design", label: "Design system", hint: "Every component, every state" },
  { href: "/", label: "Live application", hint: "The signed-in TMS on the real database" },
  { href: "/trips", label: "Live trips", hint: "Built in a later phase", planned: true },
  { href: "/bookings", label: "Bookings", hint: "Built in a later phase", planned: true },
];

/**
 * ⌘K. One search over where you can go, with the keyboard doing the work: type, arrow, Enter.
 *
 * It navigates and it says what each destination is for. It does not invent actions — a palette that
 * offers "create a booking" and cannot would be a dead control with a search box on top.
 */
export function CommandPalette({ open, onOpenChange, items = DEFAULT_ITEMS }: { open: boolean; onOpenChange: (open: boolean) => void; items?: PaletteItem[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Jump to a screen</DialogTitle>
        {/* Mounted only while open: every opening starts from an empty query and the first row, with
            no effect to reset state after the fact. */}
        <PaletteBody items={items} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ items, onDone }: { items: PaletteItem[]; onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const choose = (item: PaletteItem | undefined) => {
    if (!item || item.planned) return;
    onDone();
    router.push(item.href);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-divider px-3.5 py-3">
        <Search className="size-4 shrink-0 text-dim" aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((current) => (results.length ? (current + 1) % results.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(results[active]);
            }
          }}
          placeholder="Jump to a screen…"
          aria-label="Search screens"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-dim"
        />
        <kbd className="tms-mono rounded border border-border px-1.5 py-0.5 text-[10px] text-dim">Esc</kbd>
      </div>

      <div role="listbox" aria-label="Screens" className="max-h-[50vh] overflow-y-auto p-1.5">
        {results.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches “{query}”.</p>}
        {results.map((item, index) => (
          <div
            key={item.href}
            role="option"
            aria-selected={index === active}
            aria-disabled={item.planned || undefined}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              choose(item);
            }}
            className={cn(
              "flex cursor-default items-baseline justify-between gap-3 rounded-control px-2.5 py-2 text-[13px]",
              index === active && !item.planned ? "bg-row-hover text-foreground" : item.planned ? "text-dim" : "text-muted-foreground",
            )}
          >
            <span className="font-medium">{item.label}</span>
            <span className="truncate text-[11.5px] text-dim">{item.hint}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 border-t border-divider bg-background px-3.5 py-2">
        <span className="tms-mono flex items-center gap-1 text-dim">
          <CornerDownLeft className="size-3" aria-hidden="true" /> to open
        </span>
        <span className="tms-mono ml-auto text-dim">↑ ↓ to move</span>
      </div>
    </>
  );
}
