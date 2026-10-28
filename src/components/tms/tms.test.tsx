// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ActivityFeed, relativeTime } from "@/components/tms/ActivityFeed";
import { AppShell } from "@/components/tms/AppShell";
import { BookingIntakeDialog } from "@/components/tms/BookingIntakeDialog";
import { DataTable, type TmsColumn } from "@/components/tms/DataTable";
import { FilterNote, FilterSelect, SearchField } from "@/components/tms/FilterBar";
import { DesignGallery } from "@/components/tms/DesignGallery";
import { GlidingTabs } from "@/components/tms/GlidingTabs";
import { AppFrame } from "@/components/tms/AppFrame";
import { BusFront, Receipt } from "lucide-react";
import { FleetMap } from "@/components/tms/FleetMap";
import { LiveDot } from "@/components/tms/LiveDot";
import { OverviewScreen } from "@/components/tms/OverviewScreen";
import { PageHeader } from "@/components/tms/PageHeader";
import { FleetMixBar, RingGauge } from "@/components/tms/RingGauge";
import { StatCard, StatGrid } from "@/components/tms/StatCard";
import { StatusBadge, TripStatusBadge } from "@/components/tms/StatusBadge";
import { TopBar } from "@/components/tms/TopBar";
import type { ActivityEntry, Kpi, RingSummary, FleetMapData } from "@/lib/mock/types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("relativeTime", () => {
  const now = "2026-10-28T14:20:00.000Z";
  const at = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();

  it("reads a fresh event as just now, then in minutes, hours and days", () => {
    expect(relativeTime(at(0), now)).toBe("just now");
    expect(relativeTime(at(9), now)).toBe("9m ago");
    expect(relativeTime(at(120), now)).toBe("2h ago");
    expect(relativeTime(at(60 * 24), now)).toBe("yesterday");
    expect(relativeTime(at(60 * 24 * 3), now)).toBe("3d ago");
  });

  it("gives nothing rather than a wrong time when a timestamp is malformed", () => {
    expect(relativeTime("not a date", now)).toBe("");
    expect(relativeTime(at(5), "also not a date")).toBe("");
  });
});

describe("StatusBadge", () => {
  it("carries the word as well as the colour, so state is never colour alone", () => {
    render(<StatusBadge tone="warning">Delayed</StatusBadge>);
    expect(screen.getByText("Delayed")).toBeTruthy();
  });

  it("names every trip state in one vocabulary", () => {
    render(
      <div>
        <TripStatusBadge status="on_route" />
        <TripStatusBadge status="cancelled" />
        <TripStatusBadge status="scheduled" />
      </div>,
    );
    expect(screen.getByText("On route")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
  });
});

describe("LiveDot", () => {
  it("is decorative when a visible word sits beside it", () => {
    const { container } = render(<LiveDot tone="success" />);
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("describes itself when it is the only signal", () => {
    render(<LiveDot tone="danger" label="Service degraded" />);
    expect(screen.getByRole("img", { name: "Service degraded" })).toBeTruthy();
  });
});

const KPI: Kpi = {
  key: "active",
  label: "Active trips",
  value: "18",
  delta: { value: "3", trend: "up", caption: "vs yesterday" },
  series: [30, 50, 40],
  seriesLabel: "Three days: 30, 50, 40.",
};

describe("StatCard", () => {
  it("shows the figure, its caption and the change, and describes the sparkline", () => {
    render(<StatCard kpi={KPI} />);
    expect(screen.getByText("Active trips")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("vs yesterday")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Three days: 30, 50, 40." })).toBeTruthy();
  });

  it("leaves the series out when the payload has none", () => {
    render(<StatCard kpi={{ key: "bare", label: "Revenue", value: "GH₵ 48,200" }} />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is wrapped by a grid that owns the sibling dim", () => {
    const { container } = render(
      <StatGrid>
        <StatCard kpi={KPI} index={0} />
        <StatCard kpi={{ ...KPI, key: "b" }} index={1} />
      </StatGrid>,
    );
    expect(container.querySelector(".tms-kpi-grid")).toBeTruthy();
  });
});

const RING: RingSummary = {
  percent: 64,
  caption: "14 of 22 vehicles are on route.",
  slices: [
    { key: "on_route", label: "On route", count: 14 },
    { key: "available", label: "Available", count: 5 },
    { key: "maintenance", label: "Maintenance", count: 3 },
  ],
};

describe("RingGauge", () => {
  it("states the percentage, names the arcs and shows each count", () => {
    render(<RingGauge summary={RING} />);
    expect(screen.getByRole("img", { name: /64 per cent of the fleet is on route/ })).toBeTruthy();
    // The centre states 64%, and so does the first legend row.
    expect(screen.getAllByText("64%").length).toBe(2);
    // The word "On route" is both the centre label and the first legend row.
    expect(screen.getAllByText("On route").length).toBe(2);
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("survives an empty fleet instead of dividing by zero", () => {
    render(<RingGauge summary={{ percent: 0, caption: "Nothing measured.", slices: [] }} />);
    expect(screen.getByText("0%")).toBeTruthy();
  });
});

describe("FleetMixBar", () => {
  it("gives each slice the share of the bar its count earns", () => {
    const { container } = render(<FleetMixBar summary={RING} />);
    const shares = Array.from(container.querySelectorAll("span")).map((span) =>
      Number.parseFloat((span as HTMLElement).style.width),
    );
    expect(shares.map((share) => Math.round(share * 100) / 100)).toEqual([63.64, 22.73, 13.64]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(100, 6);
  });

  it("says the counts in words, because the bar is a picture", () => {
    render(<FleetMixBar summary={RING} />);
    expect(screen.getByRole("img", { name: "On route: 14. Available: 5. Maintenance: 3" })).toBeTruthy();
  });

  it("draws nothing at all when the fleet is empty", () => {
    const { container } = render(<FleetMixBar summary={{ percent: 0, caption: "", slices: [] }} />);
    expect(container.querySelector("div")).toBeNull();
  });
});

// The palette is a decision, and decisions drift. These read the stylesheet itself rather than a
// rendered element: a colour appears here once, and every component inherits it.
describe("palette", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("keeps the Studio values in one place", () => {
    expect(css).toMatch(/--background: #0a0c11;/);
    expect(css).toMatch(/--card: #12151d;/);
    expect(css).toMatch(/--primary: #7c88ff;/);
    expect(css).toMatch(/--action: #4453f0;/);
    expect(css).toMatch(/--action-foreground: #ffffff;/);
  });

  it("keeps one accent: no amber survives the switch", () => {
    expect(css.toLowerCase()).not.toContain("#ff8a00");
    expect(css.toLowerCase()).not.toContain("#ffa333");
  });

  it("keeps the dim ink at or above the 4.5:1 floor on a card", () => {
    // #7e879e on #12151d is 5.08:1; Studio's own faint (#667085) is 3.67 and was lightened.
    const relative = (hex: string) => {
      const channel = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [relative(a), relative(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(ratio("#7e879e", "#12151d")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#9aa2b6", "#12151d")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", "#4453f0")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#0a0c11", "#7c88ff")).toBeGreaterThanOrEqual(4.5);
  });
});

interface Row {
  id: string;
  route: string;
}

const COLUMNS: TmsColumn<Row>[] = [
  { accessorKey: "id", header: "Trip", enableSorting: true, cell: ({ row }) => <span>{row.original.id}</span> },
  { accessorKey: "route", header: "Route", enableSorting: false },
];

const ROWS: Row[] = [
  { id: "TRP-2418", route: "East Legon → Airport" },
  { id: "TRP-2410", route: "Dansoman → Accra Central" },
];

describe("DataTable", () => {
  it("renders rows, a caption and a sortable header", () => {
    render(<DataTable data={ROWS} columns={COLUMNS} caption="Trips in progress" />);
    expect(screen.getByText("Trips in progress")).toBeTruthy();
    expect(screen.getByText("TRP-2418")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trip" })).toBeTruthy();
    // A column that opted out of sorting is a heading, not a button.
    expect(screen.queryByRole("button", { name: "Route" })).toBeNull();
  });

  it("reorders when a header is pressed", () => {
    render(<DataTable data={ROWS} columns={COLUMNS} />);
    const order = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(order()).toEqual(["TRP-2418", "TRP-2410"]);
    fireEvent.click(screen.getByRole("button", { name: "Trip" }));
    expect(order()).toEqual(["TRP-2410", "TRP-2418"]);
    expect(screen.getByRole("columnheader", { name: /Trip/ }).getAttribute("aria-sort")).toBe("ascending");
  });

  it("announces loading instead of drawing an empty table", () => {
    render(<DataTable data={[]} columns={COLUMNS} state="loading" />);
    expect(screen.getByRole("status", { name: "Loading rows" })).toBeTruthy();
  });

  it("shows the empty state with the words the screen chose", () => {
    render(<DataTable data={[]} columns={COLUMNS} emptyTitle="No runs today" emptyBody="Nothing is scheduled." />);
    expect(screen.getByText("No runs today")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("draws only the rows it is told to, and takes them from the sorted order", () => {
    const four: Row[] = [
      { id: "TRP-3", route: "c" },
      { id: "TRP-1", route: "a" },
      { id: "TRP-4", route: "d" },
      { id: "TRP-2", route: "b" },
    ];
    render(<DataTable data={four} columns={COLUMNS} limit={2} />);
    const drawn = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    // The first two in the order given, because nothing has been sorted yet.
    expect(drawn()).toEqual(["TRP-3", "TRP-1"]);

    // Sorting applies to every row, and only then is the window taken — so the limit never hides
    // the rows a sort was meant to bring to the top.
    fireEvent.click(screen.getByRole("button", { name: "Trip" }));
    expect(drawn()).toEqual(["TRP-1", "TRP-2"]);
  });

  it("shows a failure and offers a retry that really calls back", () => {
    const onRetry = vi.fn();
    render(<DataTable data={[]} columns={COLUMNS} state="error" errorMessage="The list could not be read." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const ACTIVITY: ActivityEntry[] = [
  { id: "a1", kind: "dispatch", title: "TRP-2418 left the yard", actor: "Kojo Mensah", at: "2026-10-28T14:11:00.000Z" },
  { id: "a2", kind: "alert", title: "TRP-2421 is 9 minutes behind", actor: "Samuel Botchwey", at: "2026-10-28T13:56:00.000Z" },
];

describe("ActivityFeed", () => {
  it("lists entries newest first with a mono relative time", () => {
    render(<ActivityFeed entries={ACTIVITY} now="2026-10-28T14:20:00.000Z" />);
    expect(screen.getByText("TRP-2418 left the yard")).toBeTruthy();
    expect(screen.getByText("9m ago")).toBeTruthy();
    expect(screen.getByText("24m ago")).toBeTruthy();
    expect(screen.getByText("Dispatch")).toBeTruthy();
  });

  it("honours a limit without pretending the rest did not happen", () => {
    render(<ActivityFeed entries={ACTIVITY} now="2026-10-28T14:20:00.000Z" limit={1} />);
    expect(screen.getByText("TRP-2418 left the yard")).toBeTruthy();
    expect(screen.queryByText("TRP-2421 is 9 minutes behind")).toBeNull();
  });
});

const MAP: FleetMapData = {
  caption: "Illustrative positions. No vehicle reports a live location.",
  routes: [{ id: "r1", points: [[10, 10], [50, 40]] }],
  markers: [
    { id: "GT 4821-24", x: 20, y: 30, label: "TRP-2418 · on route", status: "moving" },
    { id: "GR 5502-22", x: 40, y: 50, label: "TRP-2421 · late", status: "alert" },
  ],
};

describe("FleetMap", () => {
  it("labels the picture as illustrative and repeats the payload's caption", () => {
    render(<FleetMap data={MAP} />);
    const map = screen.getByRole("img", { name: /Illustrative fleet map/ });
    expect(map).toBeTruthy();
    expect(screen.getByText(/No vehicle reports a live location/)).toBeTruthy();
    expect(screen.getByText("1 moving")).toBeTruthy();
    expect(screen.getByText("1 late")).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("offers the period as one keyboard-reachable radio group", () => {
    const onRangeChange = vi.fn();
    render(<PageHeader title="Operations" subtitle="Today's runs" range="today" onRangeChange={onRangeChange} />);
    const group = screen.getByRole("radiogroup", { name: "Reporting period" });
    expect(within(group).getByRole("radio", { name: "Today" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Week" }));
    expect(onRangeChange).toHaveBeenCalledWith("week");
  });

  it("works without a period, for a screen that has none, and takes its own actions", () => {
    const onReload = vi.fn();
    render(
      <PageHeader
        kicker="Governance"
        title="Audit log"
        subtitle="Append-only"
        actions={<button onClick={onReload}>Reload</button>}
      />,
    );
    expect(screen.getByText("Governance")).toBeTruthy();
    // No empty segmented control is drawn for a screen that reports on no period.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("only shows the primary action when the screen can act on it", () => {
    const onNewBooking = vi.fn();
    const { rerender } = render(<PageHeader title="Operations" subtitle="x" range="today" onRangeChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /new booking/i })).toBeNull();
    rerender(<PageHeader title="Operations" subtitle="x" range="today" onRangeChange={vi.fn()} onNewBooking={onNewBooking} />);
    fireEvent.click(screen.getByRole("button", { name: /new booking/i }));
    expect(onNewBooking).toHaveBeenCalledTimes(1);
  });
});

describe("FilterBar", () => {
  function Harness() {
    const [query, setQuery] = useState("");
    const [entity, setEntity] = useState("all");
    return (
      <div>
        <SearchField label="Search audit log" placeholder="Search" value={query} onChange={setQuery} />
        <FilterSelect label="Filter by entity" value={entity} onChange={setEntity}>
          <option value="all">All records</option>
          <option value="rental">rental</option>
        </FilterSelect>
        <FilterNote>{query === "" ? "Nothing filtered" : `Searching for ${query}`}</FilterNote>
        <p data-testid="state">{`${query}|${entity}`}</p>
      </div>
    );
  }

  it("names both controls and reports what they are doing", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "kofi" } });
    fireEvent.change(screen.getByLabelText("Filter by entity"), { target: { value: "rental" } });
    expect(screen.getByTestId("state").textContent).toBe("kofi|rental");
    expect(screen.getByRole("status").textContent).toBe("Searching for kofi");
  });

  it("keeps the note quiet until something changes", () => {
    render(<Harness />);
    expect(screen.getByRole("status").textContent).toBe("Nothing filtered");
  });
});

describe("AppShell", () => {
  it("puts the skip link first, then the rail and the content", () => {
    render(
      <AppShell breadcrumb={[{ label: "Operations" }]}>
        <p>Screen body</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByText("Screen body")).toBeTruthy();
  });

  it("does not offer a link to a screen that has not been built", () => {
    render(
      <AppShell breadcrumb={[{ label: "Operations" }]}>
        <p>Body</p>
      </AppShell>,
    );
    // The review shell renders the rail twice — a desktop column and a phone strip — and both
    // must behave the same way.
    const rails = screen.getAllByRole("navigation", { name: "Sections" });
    expect(rails.length).toBe(2);
    for (const rail of rails) {
      expect(within(rail).queryByRole("link", { name: /Live trips/ })).toBeNull();
      expect(within(rail).getByText("Live trips")).toBeTruthy();
    }
  });

  it("opens the palette on ⌘K and navigates on Enter", () => {
    render(
      <AppShell breadcrumb={[{ label: "Operations" }]}>
        <p>Body</p>
      </AppShell>,
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = screen.getByRole("textbox", { name: "Search screens" });
    fireEvent.change(input, { target: { value: "design" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/design");
  });
});

describe("TopBar", () => {
  it("routes both search shapes into one palette instead of two search boxes", () => {
    const onOpenPalette = vi.fn();
    render(<TopBar breadcrumb={[{ label: "Operations" }]} onOpenPalette={onOpenPalette} />);
    fireEvent.click(screen.getByRole("button", { name: /search or jump to a screen/i }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("opens the notification panel and closes it again on Escape", () => {
    render(<TopBar breadcrumb={[{ label: "Operations" }]} onOpenPalette={vi.fn()} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
    // The panel says what is true: no channel exists, so nothing has been sent or missed.
    expect(screen.getByText(/This build sends nothing/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("BookingIntakeDialog", () => {
  it("says where a booking is recorded today rather than pretending to accept one", () => {
    render(<BookingIntakeDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "New booking" })).toBeTruthy();
    expect(screen.getByText(/recorded in the live application/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the live application" }).getAttribute("href")).toBe("/");
  });
});

describe("OverviewScreen", () => {
  it("renders the four figures, the trackables and the sample-data label", () => {
    render(<OverviewScreen />);
    expect(screen.getByRole("heading", { name: "Operations overview" })).toBeTruthy();
    expect(screen.getByText("Sample data — not records")).toBeTruthy();
    expect(screen.getAllByText("Active trips").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Illustrative fleet map/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /per cent of the fleet is on route/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Live trips: route, driver, vehicle, status and estimated arrival" })).toBeTruthy();
    expect(screen.getByText("TRP-2418")).toBeTruthy();
  });

  it("re-cuts the payload when the period changes", () => {
    render(<OverviewScreen />);
    fireEvent.click(screen.getByRole("radio", { name: "Month" }));
    expect(screen.getByText("512")).toBeTruthy();
  });

  it("refreshes through a real loading state rather than a decorative spinner", async () => {
    vi.useFakeTimers();
    render(<OverviewScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh the trip list" }));
    expect(screen.getByRole("status", { name: "Loading rows" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("DesignGallery", () => {
  it("shows every shared component, including the states a real query can be in", () => {
    render(<DesignGallery />);
    for (const heading of ["Colour", "Type", "Buttons", "Badges and live dots", "Stat cards", "Ring gauge", "Table", "States", "Activity feed", "Map", "Shell"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    // The four table states on one page: ready rows, a skeleton, an empty card and a failure.
    expect(screen.getByText("TRP-2418")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading rows" })).toBeTruthy();
    expect(screen.getAllByText("No runs in this period").length).toBeGreaterThan(0);
    expect(screen.getByText(/The list could not be read/)).toBeTruthy();
    // The gallery's own primary action explains itself instead of pretending to book.
    // The page header's action is the first one; the buttons section shows a second, as a specimen.
    fireEvent.click(screen.getAllByRole("button", { name: /new booking/i })[0]);
    expect(screen.getByRole("dialog", { name: "New booking" })).toBeTruthy();
  });
});

describe("GlidingTabs", () => {
  it("is one radio group, and the pill follows the choice", () => {
    const onChange = vi.fn();
    render(
      <GlidingTabs
        ariaLabel="Reporting period"
        value="today"
        onChange={onChange}
        options={[
          { key: "today", label: "Today" },
          { key: "week", label: "Week" },
          { key: "month", label: "Month" },
        ]}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Reporting period" });
    expect(within(group).getByRole("radio", { name: "Today" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });

  it("steps with the arrow keys, so the pointer is not the only way", () => {
    const onChange = vi.fn();
    render(
      <GlidingTabs
        ariaLabel="Reporting period"
        value="today"
        onChange={onChange}
        options={[
          { key: "today", label: "Today" },
          { key: "week", label: "Week" },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Reporting period" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("week");
  });
});

describe("AppFrame", () => {
  const groups = [
    {
      label: "Service desk",
      items: [
        { key: "dashboard", label: "Dashboard", caption: "The day", icon: BusFront },
        { key: "invoices", label: "Invoices", caption: "Billing", icon: Receipt, count: 3 },
      ],
    },
  ];

  const frameProps = {
    groups,
    activeKey: "dashboard",
    crumbs: ["Service desk", "Dashboard"],
    user: { name: "Ama Boateng", role: "Administrator" },
    company: "Richie Transport Services",
    clock: "09:41",
  };

  it("marks the current screen, carries the day's counts and names the user", () => {
    render(
      <AppFrame {...frameProps} onNavigate={vi.fn()} onSignOut={vi.fn()} onOpenPalette={vi.fn()}>
        <p>Screen body</p>
      </AppFrame>,
    );
    // The phone copy lives inside a sheet, which mounts only when the menu is opened.
    const rails = screen.getAllByRole("navigation", { name: "Sections" });
    expect(rails.length).toBe(1);
    for (const rail of rails) {
      expect(within(rail).getByRole("button", { name: /Dashboard/ }).getAttribute("aria-current")).toBe("page");
      expect(within(rail).getByText("3")).toBeTruthy();
    }
    expect(screen.getByText("Ama Boateng")).toBeTruthy();
    expect(screen.getByText("Screen body")).toBeTruthy();
  });

  it("navigates, signs out and opens the palette", () => {
    const onNavigate = vi.fn();
    const onSignOut = vi.fn();
    const onOpenPalette = vi.fn();
    render(
      <AppFrame {...frameProps} onNavigate={onNavigate} onSignOut={onSignOut} onOpenPalette={onOpenPalette}>
        <p>Body</p>
      </AppFrame>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Invoices/ })[0]);
    expect(onNavigate).toHaveBeenCalledWith("invoices");
    fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]);
    expect(onSignOut).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Search or jump to a screen/ }));
    expect(onOpenPalette).toHaveBeenCalled();
  });
});
