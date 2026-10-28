"use client";

import { useState } from "react";
import { ChevronRight, LogOut, Menu, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LiveDot } from "./LiveDot";

export interface FrameItem {
  /** Stable key: the route name in the live application. */
  key: string;
  label: string;
  caption: string;
  icon: LucideIcon;
  /** Work waiting on this section. Zero and undefined both mean "nothing to say". */
  count?: number;
}

export interface FrameGroup {
  label: string;
  items: FrameItem[];
}

/**
 * The frame the working application sits in.
 *
 * One rail, rendered twice — fixed on a desk, inside a sheet on a phone — and one top bar. It knows
 * nothing about the screens: it is given groups, a current key and a navigate callback, which is why
 * the same frame serves the twenty-odd destinations whose contents are still being converted.
 *
 * What it adds over a plain sidebar: the current section is a filled accent tile rather than a pale
 * one, the sections carry their own counts so the day's work is visible before you open anything,
 * and the content arrives on the glide curve each time the route changes instead of snapping.
 */
export function AppFrame({
  groups,
  activeKey,
  onNavigate,
  crumbs,
  user,
  onSignOut,
  onOpenPalette,
  busy,
  clock,
  company,
  banner,
  dataRoute,
  children,
}: {
  groups: FrameGroup[];
  activeKey: string;
  onNavigate: (key: string) => void;
  crumbs: string[];
  user: { name: string; role: string };
  onSignOut: () => void;
  onOpenPalette: () => void;
  busy?: boolean;
  clock?: string | null;
  company: string;
  banner?: React.ReactNode;
  dataRoute?: string;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  const navigate = (key: string) => {
    setNavOpen(false);
    onNavigate(key);
  };

  const rail = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-[10px] bg-primary text-[13px] font-bold text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
        >
          R
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">Richie TMS</p>
          <p className="tms-mono truncate text-[10px] text-dim">{company}</p>
        </div>
      </div>

      <nav aria-label="Sections" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-3.5">
            <p className="tms-mono px-2.5 pb-1.5 text-dim">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.key === activeKey;
                const Glyph = item.icon;
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => navigate(item.key)}
                      aria-current={active ? "page" : undefined}
                      title={`${item.label} — ${item.caption}`}
                      className={cn(
                        "group relative flex w-full items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[12.5px] transition-[background-color,color,transform] duration-200 focus-visible:outline-none",
                        active
                          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--primary)]"
                          : "font-medium text-sidebar-foreground hover:translate-x-[2px] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Glyph
                        className={cn("size-4 shrink-0 transition-colors", active ? "text-primary" : "text-dim group-hover:text-sidebar-accent-foreground")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.count ? (
                        <span
                          className={cn(
                            "tms-mono rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                            active ? "bg-primary-tint text-primary" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {item.count}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-2.5 border-t border-sidebar-border px-2.5 py-3">
        <div className="flex items-center justify-between px-0.5">
          <span
            className="tms-mono text-[11px] text-muted-foreground"
            aria-label={clock ? `Current time ${clock}` : undefined}
          >
            {clock ?? "--:--"}
          </span>
          <button
            type="button"
            onClick={onOpenPalette}
            aria-keyshortcuts="Control+K Meta+K"
            className="tms-mono flex items-center gap-1.5 rounded-md px-1.5 py-1 text-dim transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none"
          >
            <Search className="size-3" aria-hidden="true" />
            Jump to
            <kbd className="rounded border border-sidebar-border px-1 py-0.5 text-[9px] text-muted-foreground">⌘K</kbd>
          </button>
        </div>

        <div className="flex items-center gap-2.5 px-0.5">
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-tint text-[10px] font-semibold text-primary"
          >
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-foreground">{user.name}</p>
            <p className="tms-mono truncate text-[9.5px] text-dim">{user.role}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="text-dim hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background" data-route={dataRoute}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:text-[13px] focus:text-foreground"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border lg:block" aria-label="Main">
        {rail}
      </aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0" aria-label="Main">
          <SheetTitle className="sr-only">Sections</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 lg:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            <Menu aria-hidden="true" />
          </Button>

          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                return (
                  <li key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1.5">
                    {index > 0 && <ChevronRight className="size-3 shrink-0 text-dim" aria-hidden="true" />}
                    <span className={cn("tms-mono truncate", last ? "text-foreground" : "text-dim")} aria-current={last ? "page" : undefined}>
                      {crumb}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {busy && (
              <span className="text-[11.5px] font-medium text-muted-foreground" role="status">
                <span className="flex items-center gap-1.5">
                  <LiveDot tone="primary" />
                  Saving
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={onOpenPalette}
              aria-keyshortcuts="Control+K Meta+K"
              className="hidden items-center gap-2 rounded-control border border-border bg-card px-2.5 py-1.5 text-[12px] text-dim transition-colors hover:text-muted-foreground focus-visible:outline-none md:flex"
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
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full border border-border bg-card text-[10px] font-semibold text-primary"
              title={`${user.name} — ${user.role}`}
              aria-hidden="true"
            >
              {initials(user.name)}
            </span>
            <span className="sr-only">Signed in as {user.name}</span>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-[1440px] px-4 py-5 pb-10 lg:px-7">
          {banner}
          {/* Re-keyed on the route so each screen arrives rather than snapping in. */}
          <div key={activeKey} className="tms-page min-h-[40vh]">
            {children}
          </div>
          <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-[11.5px] text-dim">
            <span>Richie Transport Services · Operations workspace</span>
            <span>Every change is attributed and audit-logged</span>
            <span className="tms-mono">build {process.env.NEXT_PUBLIC_BUILD ?? "unknown"}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
