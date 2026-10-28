"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BusFront,
  CalendarClock,
  ChartColumn,
  CircleUser,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  Receipt,
  Settings2,
  Truck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Set when the screen does not exist in this build yet: the row says so instead of pretending. */
  planned?: boolean;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/trips", label: "Live trips", icon: BusFront, planned: true },
      { href: "/dispatch", label: "Dispatch", icon: ClipboardList, planned: true },
      { href: "/bookings", label: "Bookings", icon: CalendarClock, planned: true },
    ],
  },
  {
    label: "Fleet",
    items: [
      { href: "/fleet", label: "Vehicles", icon: Truck, planned: true },
      { href: "/drivers", label: "Drivers", icon: CircleUser, planned: true },
      { href: "/maintenance", label: "Maintenance", icon: Gauge, planned: true },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/invoices", label: "Invoices", icon: Receipt, planned: true },
      { href: "/reports", label: "Reports", icon: ChartColumn, planned: true },
      { href: "/settings", label: "Settings", icon: Settings2, planned: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/design", label: "Design system", icon: Palette },
      { href: "/", label: "Live application", icon: Wallet },
    ],
  },
];

/**
 * The rail.
 *
 * Two shapes, one component: a vertical list on a desk, a horizontally scrolling strip on a phone.
 * Only the destinations that exist are links — a row for a screen that has not been built renders as
 * a disabled item with the word "planned", because a menu that looks live and goes nowhere is worse
 * than a shorter menu.
 */
export function SidebarNav({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();

  const isActive = (item: NavItem) => (item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const tile = (item: NavItem, active: boolean) => {
    const Glyph = item.icon;
    const base = cn(
      "group relative flex items-center gap-2.5 rounded-control text-[13px] font-medium transition-colors",
      orientation === "vertical" ? "w-full px-2.5 py-2" : "shrink-0 px-2.5 py-1.5",
      active ? "bg-primary text-primary-foreground" : item.planned ? "text-dim" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );

    const inner = (
      <>
        <Glyph className={cn("size-4 shrink-0", active ? "text-primary-foreground" : "text-dim group-hover:text-sidebar-accent-foreground")} aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {item.planned && (
          <span className={cn("tms-mono ml-auto rounded-full px-1.5 py-0.5 text-[9px] tracking-[0.06em]", active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-dim")}>
            planned
          </span>
        )}
      </>
    );

    if (item.planned) {
      return (
        <span key={item.href} className={base} aria-disabled="true" title={`${item.label} is built in a later phase`}>
          {inner}
        </span>
      );
    }

    return (
      <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={base}>
        {inner}
      </Link>
    );
  };

  if (orientation === "horizontal") {
    return (
      <nav aria-label="Sections" className="flex gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GROUPS.flatMap((group) => group.items).map((item) => tile(item, isActive(item)))}
      </nav>
    );
  }

  return (
    <nav aria-label="Sections" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-1">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="tms-mono mb-1.5 px-2.5 text-dim">{group.label}</p>
          <div className="space-y-0.5">{group.items.map((item) => tile(item, isActive(item)))}</div>
        </div>
      ))}
    </nav>
  );
}
