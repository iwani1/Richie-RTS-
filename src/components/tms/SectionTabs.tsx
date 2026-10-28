"use client";

import { cn } from "@/lib/utils";

/** The ids a strip and its panel share. One function, so the two can never drift apart. */
export function sectionIds(prefix: string, id: string) {
  return { tabId: `${prefix}-tab-${id}`, panelId: `${prefix}-panel-${id}` };
}

/**
 * The sections of one screen.
 *
 * A real tab list: one tab stop for the strip, arrow keys move between the sections, Home and End
 * go to the ends, and the selected tab says so with `aria-selected` rather than with colour alone.
 * The underline is the accent; the words say which section is open.
 *
 * Two things it gets right that a hand-written strip usually does not:
 *
 *  * **Focus follows selection for every key that changes it.** Arrows, Home and End move the
 *    selection *and* the focus, so the tab the reader is standing on is always the tab that is open.
 *    Moving one without the other strands the keyboard on a `tabIndex={-1}` control, and the next
 *    Tab press leaves the strip from somewhere the reader is not.
 *  * **The strip names the panel it controls**, through `aria-controls` on the tab and
 *    `aria-labelledby` on the panel (`SectionPanel` below), so a screen reader announces the
 *    section as a named region rather than as loose content under a row of buttons.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix,
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Where the tab and panel ids start. Screens with more than one strip need to say. */
  idPrefix: string;
  className?: string;
}) {
  const move = (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const target = (index + tabs.length) % tabs.length;
    const next = tabs[target];
    if (!next) return;
    onChange(next.id);
    // The buttons are siblings already in the document, so their nodes are stable: focus can move
    // in the same event that changes the selection.
    const sibling = event.currentTarget.parentElement?.children[target];
    if (sibling instanceof HTMLElement) sibling.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex gap-1 overflow-x-auto border-b border-divider", className)}>
      {tabs.map((tab, index) => {
        const active = tab.id === value;
        const { tabId, panelId } = sectionIds(idPrefix, tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index + 1, event);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index - 1, event);
              } else if (event.key === "Home") {
                event.preventDefault();
                move(0, event);
              } else if (event.key === "End") {
                event.preventDefault();
                move(tabs.length - 1, event);
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

/**
 * The panel a `SectionTabs` strip controls. It carries the id the tabs point at and the name of the
 * section, so the content is announced as "Work orders, tab panel" rather than as anonymous text
 * under a row of buttons.
 *
 * It is focusable (`tabIndex={0}`) because a keyboard reader should be able to step from the strip
 * into the panel and scroll it with the arrow keys; the focus ring is suppressed because the panel
 * is the whole width of the screen and a ring around it says nothing.
 */
export function SectionPanel({
  prefix,
  id,
  children,
}: {
  prefix: string;
  id: string;
  children: React.ReactNode;
}) {
  const { tabId, panelId } = sectionIds(prefix, id);
  // Labelled by the tab itself, never by a copy of its words: a second rendering of "Hire report" is
  // one more thing a screen reader has to read and one more match for a reader looking for it.
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0} className="focus-visible:outline-none">
      {children}
    </div>
  );
}
