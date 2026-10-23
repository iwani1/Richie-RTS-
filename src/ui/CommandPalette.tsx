import { useEffect, useMemo, useRef, useState } from "react";
import { NAV_ITEMS, type Route } from "../routes";
import type { Permission } from "../tms/permissions";
import { Icon } from "./icons";

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
    () => NAV_ITEMS.filter((item) => item.route !== "documents").filter((item) => !item.permission || allowed(item.permission)),
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
    <div className="rts-palette-wrap">
      <button type="button" className="rts-palette-scrim" aria-label="Close the command palette" onClick={onClose} />
      <div className="rts-palette" role="dialog" aria-modal="true" aria-label="Jump to a screen">
        <div className="rts-palette-field">
          <Icon name="search" className="rts-palette-icon" />
          <input
            ref={inputRef}
            className="rts-palette-input"
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
          <kbd className="rts-kbd">Esc</kbd>
        </div>

        <ul className="rts-palette-list" id="rts-palette-list" role="listbox" aria-label="Screens" ref={listRef}>
          {results.map((item, index) => (
            <li
              key={item.route}
              id={`rts-palette-${item.route}`}
              role="option"
              aria-selected={index === active}
              className="rts-palette-option"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(index);
              }}
            >
              <span className="rts-palette-option-label">{item.label}</span>
              <span className="rts-palette-option-caption">{item.caption}</span>
            </li>
          ))}
        </ul>

        {results.length === 0 && (
          <p className="rts-palette-empty">
            Nothing matches “{query}”. Screens you can reach here are limited to your role.
          </p>
        )}

        <div className="rts-palette-foot">
          <span>
            <kbd className="rts-kbd">↑</kbd> <kbd className="rts-kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="rts-kbd">Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
