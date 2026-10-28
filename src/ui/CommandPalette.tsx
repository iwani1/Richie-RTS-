import { useEffect, useMemo, useRef, useState } from "react";
import { NAV_ITEMS, type Route } from "../routes";
import type { Permission } from "../tms/permissions";
import { CornerDownLeft, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Keyboard navigation for the whole workspace: Ctrl-K / ⌘K, type a few letters, Enter.
 *
 * Scope is deliberate. It navigates and it tells you what each destination is for; it does not
 * invent actions. An action palette would need a server-side action model ("create rental for
 * GT 0001-26"), and promising that in a launcher that cannot yet do it would be a dead control.
 */
export function CommandPalette({
  onClose,
  onNavigate,
  allowed,
}: {
  onClose: () => void;
  onNavigate: (route: Route) => void;
  allowed: (permission: Permission) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(
    () => NAV_ITEMS.filter((item) => !item.permission || allowed(item.permission)),
    [allowed],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.caption}`.toLowerCase().includes(q));
  }, [items, query]);

  // Mounted only while open (the shell renders it conditionally), so no reset effect is needed:
  // every opening starts from a fresh query and a fresh selection.
  useEffect(() => {
    // Focus after paint so the dialog is in the document when the input takes focus.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (index: number) => {
    const item = results[index];
    if (!item) return;
    onNavigate(item.route);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Tab") {
      // The input is the only focusable control inside the dialog, so Tab must not walk out into
      // the page behind it. Keeping focus here is the trap, without inventing a focus manager.
      event.preventDefault();
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(results.length - 1, 0));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        className="absolute inset-0 bg-foreground/40"
        aria-label="Close the command palette"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to a screen"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a screen…"
            aria-label="Search screens"
            role="combobox"
            aria-expanded="true"
            aria-controls="rts-palette-list"
            aria-activedescendant={results[active] ? `rts-palette-${results[active].route}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-border px-1.5 font-mono text-[9.5px] text-muted-foreground">Esc</kbd>
        </div>

        <ul className="max-h-[52vh] overflow-y-auto p-1.5" id="rts-palette-list" role="listbox" aria-label="Screens" ref={listRef}>
          {results.map((item, index) => (
            <li
              key={item.route}
              id={`rts-palette-${item.route}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex cursor-default items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-[13px]",
                index === active ? "bg-primary/10 text-foreground" : "text-foreground/90",
              )}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span className="font-medium">{item.label}</span>
              <span className="truncate text-[11.5px] text-muted-foreground">{item.caption}</span>
            </li>
          ))}
        </ul>

        {results.length === 0 && (
          <p className="px-3.5 py-4 text-[13px] text-muted-foreground">
            Nothing matches “{query}”. Screens you can reach here are limited to your role.
          </p>
        )}

        <div className="flex items-center gap-4 border-t border-border bg-muted/40 px-3.5 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1 font-mono text-[9.5px]">↑</kbd>
            <kbd className="rounded border border-border px-1 font-mono text-[9.5px]">↓</kbd>
            to move
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" aria-hidden="true" />
            to open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <X className="size-3" aria-hidden="true" />
            Esc to close
          </span>
        </div>
      </div>
    </div>
  );
}
