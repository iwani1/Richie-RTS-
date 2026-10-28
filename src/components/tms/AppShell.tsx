"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { SidebarNav } from "./SidebarNav";
import { TopBar } from "./TopBar";

/**
 * The frame: a rail on a desk, a scrolling strip on a phone, a top bar over both.
 *
 * The shell owns only what is genuinely shared — the palette's open state and the ⌘K shortcut. Every
 * screen passes its own breadcrumb and its own content, which is why a new page needs a line, not a
 * layout.
 */
export function AppShell({
  breadcrumb,
  children,
  className,
}: {
  breadcrumb: Array<{ label: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.key === "k" || event.key === "K") || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("min-h-dvh bg-background text-foreground", className)}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-card focus:px-3 focus:py-2 focus:text-[13px] focus:text-foreground"
      >
        Skip to content
      </a>

      <div className="flex">
        {/* Desktop rail */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex" aria-label="Main">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <span className="grid size-8 place-items-center rounded-control bg-primary text-[13px] font-bold text-primary-foreground" aria-hidden="true">
              R
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">Richie TMS</p>
              <p className="tms-mono truncate text-[10px] text-dim">Transport Services</p>
            </div>
          </div>
          <SidebarNav />
          <div className="border-t border-sidebar-border px-3 py-3">
            <p className="tms-mono text-[10px] text-dim">Interface review build</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-dim">Sample data. Records live behind sign-in.</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <TopBar breadcrumb={breadcrumb} onOpenPalette={() => setPaletteOpen(true)} />

          {/* Phone: the rail becomes a horizontal strip under the bar. */}
          <div className="border-b border-border bg-sidebar lg:hidden">
            <SidebarNav orientation="horizontal" />
          </div>

          <main id="main-content" className="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-6 lg:py-6">
            {children}
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
