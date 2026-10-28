"use client";

import { useMemo, useState } from "react";
import { Command, Plus, Sparkles } from "lucide-react";
import { AppShell } from "@/components/tms/AppShell";
import { CommandPalette } from "@/components/tms/CommandPalette";
import { PageHeader } from "@/components/tms/PageHeader";
import { GlidingTabs } from "@/components/tms/GlidingTabs";
import { StatCard, StatGrid } from "@/components/tms/StatCard";
import { Panel } from "@/components/tms/Panel";
import { RingGauge } from "@/components/tms/RingGauge";
import { FleetMap } from "@/components/tms/FleetMap";
import { DataTable, TableFoot, type TmsColumn } from "@/components/tms/DataTable";
import { ActivityFeed } from "@/components/tms/ActivityFeed";
import { ActivityKindBadge, StatusBadge, TripStatusBadge, type BadgeTone } from "@/components/tms/StatusBadge";
import { LiveDot } from "@/components/tms/LiveDot";
import { BookingIntakeDialog } from "@/components/tms/BookingIntakeDialog";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/tms/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { overviewSample } from "@/lib/mock/overview.sample";
import type { Kpi, RangeKey, TripStatus } from "@/lib/mock/types";

const TONES: BadgeTone[] = ["success", "danger", "info", "warning", "primary", "neutral"];
const TRIP_STATUSES: TripStatus[] = ["on_route", "boarding", "delayed", "scheduled", "completed", "cancelled"];

const SWATCHES: Array<{ name: string; value: string; note: string }> = [
  { name: "bg", value: "#0E0E10", note: "Page" },
  { name: "sidebar", value: "#121214", note: "Rail" },
  { name: "card", value: "#1A1A1D", note: "Card surface" },
  { name: "row-hover", value: "#202024", note: "Row hover, secondary" },
  { name: "border", value: "#2A2A2E", note: "Card edge" },
  { name: "divider", value: "#26262A", note: "Row rule" },
  { name: "primary", value: "#FF8A00", note: "The one accent" },
  { name: "text", value: "#F2F1EE", note: "Primary text" },
  { name: "muted", value: "#A8A6A0", note: "Body text" },
  { name: "dim", value: "#8A8882", note: "Floor — never darker" },
  { name: "success", value: "#4CD08A", note: "On time, available" },
  { name: "warning", value: "#E4A11B", note: "Late, workshop" },
  { name: "danger", value: "#FF6B6B", note: "Failed, cancelled" },
  { name: "info", value: "#6B9BF2", note: "Boarding, completed" },
];

const TYPE: Array<{ size: string; use: string; className: string }> = [
  { size: "30px", use: "KPI figure", className: "text-[30px] leading-none font-semibold tracking-[-0.03em] tabular-nums" },
  { size: "26px", use: "Page title", className: "text-[26px] leading-tight font-semibold tracking-[-0.03em]" },
  { size: "15px", use: "Card title", className: "text-[15px] leading-tight font-semibold" },
  { size: "14px", use: "Row emphasis", className: "text-[14px] font-medium" },
  { size: "13px", use: "Body", className: "text-[13px]" },
  { size: "12px", use: "Caption", className: "text-[12px]" },
  { size: "11px", use: "Mono label", className: "tms-mono" },
];

interface DemoRow {
  id: string;
  route: string;
  vehicle: string;
  status: TripStatus;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "TRP-2418", route: "East Legon → Airport", vehicle: "GT 4821-24", status: "on_route" },
  { id: "TRP-2419", route: "Tema Community 1 → Tema Port", vehicle: "GW 1194-23", status: "on_route" },
  { id: "TRP-2421", route: "Madina → Ridge", vehicle: "GR 5502-22", status: "delayed" },
];

const DEMO_KPIS: Kpi[] = [
  { key: "up", label: "Delta up", value: "18", delta: { value: "3", trend: "up", caption: "vs yesterday" }, series: [34, 42, 38, 55, 61, 58, 72], seriesLabel: "Rising series, 34 to 72." },
  { key: "down", label: "Delta down", value: "7", delta: { value: "2", trend: "down", caption: "2 in the workshop" }, series: [64, 58, 66, 52, 49, 55, 47], seriesLabel: "Falling series, 64 to 47." },
  { key: "flat", label: "Delta flat", value: "94.2%", delta: { value: "0", trend: "flat", caption: "no change" }, series: [90, 90, 91, 90, 90, 91, 90], seriesLabel: "Flat series, 90 to 91." },
  { key: "bare", label: "No series", value: "GH₵ 48,200" },
];

/** A labelled block: what is being shown, and any note that belongs with it. */
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {note && <p className="text-[12px] text-dim">{note}</p>}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/**
 * The component gallery.
 *
 * Every shared component, in every state it can be in: ready, loading, empty, failed, disabled,
 * pressed, sorted. It exists so a reviewer can judge the pieces on their own, and so a state that
 * only appears on a bad day can be looked at on a good one.
 */
export function DesignGallery() {
  const sample = useMemo(() => overviewSample("today"), []);
  const [range, setRange] = useState<RangeKey>("today");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [motionTab, setMotionTab] = useState("today");
  const [spotValue, setSpotValue] = useState(18);

  const demoColumns = useMemo<TmsColumn<DemoRow>[]>(
    () => [
      { accessorKey: "id", header: "Trip", enableSorting: true, cell: ({ row }) => <span className="tms-mono text-foreground">{row.original.id}</span> },
      { accessorKey: "route", header: "Route", enableSorting: true },
      { accessorKey: "vehicle", header: "Vehicle", enableSorting: false, cell: ({ row }) => <span className="tms-mono">{row.original.vehicle}</span> },
      { accessorKey: "status", header: "Status", enableSorting: false, cell: ({ row }) => <TripStatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <AppShell breadcrumb={[{ label: "Richie TMS" }, { label: "System" }, { label: "Design system" }]}>
      <PageHeader
        title="Design system"
        subtitle="Every shared component in every state. Tokens are the only source of colour, radius and motion; nothing here invents a value."
        range={range}
        onRangeChange={setRange}
        onNewBooking={() => setBookingOpen(true)}
      />

      <Section title="Colour" note="Fourteen values, one accent. Badges are 13% tints of these.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {SWATCHES.map((swatch) => (
            <div key={swatch.name} className="tms-surface overflow-hidden">
              <div className="h-12 w-full" style={{ background: swatch.value }} aria-hidden="true" />
              <div className="px-2.5 py-2">
                <p className="tms-mono text-foreground">{swatch.name}</p>
                <p className="mt-0.5 text-[11px] text-dim">{swatch.note}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type" note="Seven sizes. Mono is for machine data only: references, times, captions.">
        <div className="tms-surface divide-y divide-divider">
          {TYPE.map((row) => (
            <div key={row.size} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="tms-mono w-12 shrink-0 text-dim">{row.size}</span>
              <span className={`min-w-0 flex-1 text-foreground ${row.className}`}>Richie Transport Services</span>
              <span className="text-[11.5px] text-dim">{row.use}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" note="Height 36px, radius 10px, one primary per view. Press moves 3px down.">
        <div className="tms-surface space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="default">
              <Plus aria-hidden="true" /> New booking
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Small</Button>
            <Button size="xs">Extra small</Button>
            <Button disabled>Disabled</Button>
            <span className="tms-mono text-dim">Icon-only buttons carry an aria-label</span>
            <Button size="icon" aria-label="Open the command palette" onClick={() => setPaletteOpen(true)}>
              <Command aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Motion" note="Borrowed from kinetics.colorion.co and animatedbuttons.colorion.co, cut to four moves. All of it stops for reduced motion.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="tms-surface p-4">
            <p className="tms-mono text-dim">Sheen</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              One diagonal highlight crosses the primary action on hover, once. Never loops, never moves a label.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button className="tms-press tms-sheen h-9">
                <Sparkles aria-hidden="true" />
                Primary with sheen
              </Button>
              <Button variant="outline" className="tms-press h-9">
                Plain press
              </Button>
            </div>
          </div>
          <div className="tms-surface p-4">
            <p className="tms-mono text-dim">Gliding pill</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              The highlight measures the chosen option and travels to it; the labels underneath are the real radio group.
            </p>
            <div className="mt-3">
              <GlidingTabs
                ariaLabel="Motion sample period"
                value={motionTab}
                onChange={setMotionTab}
                options={[
                  { key: "today", label: "Today" },
                  { key: "week", label: "Week" },
                  { key: "month", label: "Month" },
                ]}
              />
            </div>
          </div>
          <div className="tms-surface p-4 xl:col-span-2">
            <p className="tms-mono text-dim">Spotlight and figure bump</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              A card warms under the pointer and follows it; a figure that changes says so once with a small spring.
              Hover a card below and press the button to change a number.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatCard kpi={{ key: "spot", label: "Spotlight sample", value: String(spotValue), delta: { value: "1", trend: "up", caption: "press to add one" } }} />
              <div className="tms-surface tms-spotlight flex flex-col items-start justify-center gap-2 p-4">
                <p className="text-[13px] text-muted-foreground">Every card that carries the class follows the pointer.</p>
                <Button size="sm" variant="outline" onClick={() => setSpotValue((value) => value + 1)}>
                  Add one
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Badges and live dots" note="Tint, not fill: 13% of the status colour, the same colour as text, and a 6px dot.">
        <div className="tms-surface space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {TONES.map((tone) => (
              <StatusBadge key={tone} tone={tone}>
                {tone}
              </StatusBadge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TRIP_STATUSES.map((status) => (
              <TripStatusBadge key={status} status={status} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["dispatch", "status", "alert", "finance", "maintenance", "system"] as const).map((kind) => (
              <ActivityKindBadge key={kind} kind={kind} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-divider pt-3">
            {(["success", "warning", "danger", "primary", "muted"] as const).map((tone) => (
              <span key={tone} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <LiveDot tone={tone} label={`${tone} indicator`} /> {tone}
              </span>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Stat cards" note="Hover one and its siblings dim. Bars grow from the bottom; 80ms apart.">
        <StatGrid>{DEMO_KPIS.map((kpi, index) => <StatCard key={kpi.key} kpi={kpi} index={index} />)}</StatGrid>
      </Section>

      <Section title="Ring gauge" note="SVG arcs, animated once on mount, with the percentage in the middle.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel kicker="Utilisation" title="Fleet split" description={sample.ring.caption}>
            <RingGauge summary={sample.ring} className="px-4 pb-4" />
          </Panel>
          <Panel kicker="Utilisation" title="Every vehicle out" description="The same ring at its ceiling.">
            <RingGauge
              summary={{ percent: 100, caption: "All vehicles on route.", slices: [{ key: "on_route", label: "On route", count: 22 }] }}
              className="px-4 pb-4"
            />
          </Panel>
        </div>
      </Section>

      <Section title="Table" note="Sticky header, hover row, sortable columns. Four states, all shown.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel kicker="Ready" title="Rows loaded" bodyClassName="-mt-1">
            <DataTable data={DEMO_ROWS} columns={demoColumns} caption="Demo rows" maxHeight="14rem" initialSorting={[{ id: "id", desc: true }]} />
            <TableFoot left="Showing 3 of 3" right="Sorted by trip" />
          </Panel>
          <Panel kicker="Loading" title="Skeleton while the query runs" bodyClassName="-mt-1">
            <TableSkeleton rows={3} columns={4} />
          </Panel>
          <Panel kicker="Empty" title="Nothing matched" bodyClassName="-mt-1">
            <DataTable data={[]} columns={demoColumns} emptyTitle="No runs in this period" emptyBody="Change the period, or add a booking to put a run on this board." />
          </Panel>
          <Panel kicker="Failed" title="The request did not arrive" bodyClassName="-mt-1">
            <DataTable
              data={[]}
              columns={demoColumns}
              state="error"
              errorMessage="The list could not be read. Nothing has been changed, and nothing is lost."
              onRetry={() => undefined}
            />
          </Panel>
        </div>
      </Section>

      <Section title="States" note="Shared empty and failed blocks, for cards that are not tables.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="tms-surface">
            <EmptyState
              title="No maintenance due"
              body="Every vehicle in the sample is inside its service interval. This block is what the card shows when a list is genuinely empty."
            />
          </div>
          <div className="tms-surface">
            <ErrorState
              title="That could not be saved"
              body="The server rejected the change. Retrying is safe: the request either applied in full or not at all."
              onRetry={() => undefined}
            />
          </div>
        </div>
      </Section>

      <Section title="Activity feed" note="Mono relative times, measured from the payload, not the reader's clock.">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel kicker="Activity" title="Latest on the board">
            <ActivityFeed entries={sample.activity} now={sample.capturedAt} className="px-4 pb-4" />
          </Panel>
          <Panel kicker="Activity" title="Nothing yet">
            <EmptyState title="No activity in this period" body="Dispatches, status changes and alerts appear here as they occur." />
          </Panel>
        </div>
      </Section>

      <Section title="Map" note="A swappable component with a static placeholder. It never claims a live position.">
        <Panel kicker="Fleet" title="Where the vehicles are" description={sample.map.caption} bodyClassName="px-3 pb-3">
          <FleetMap data={sample.map} />
        </Panel>
      </Section>

      <Section title="Shell" note="The rail, the top bar, the ⌘K palette and the phone strip all surround this page.">
        <div className="tms-surface p-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            The frame is the page you are reading. On a desktop the rail is a 240px column with grouped sections and a
            filled accent item for the current screen; below 1024px it becomes a horizontal strip under the top bar.
            The section menu lists only destinations that exist — an unbuilt screen is shown disabled and marked
            <span className="tms-mono mx-1 text-dim">planned</span> rather than offered as a link.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)}>
              <Command aria-hidden="true" /> Open the command palette
            </Button>
            <span className="text-[12px] text-dim">⌘K or Ctrl-K anywhere in the shell.</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="gallery-field" className="tms-mono text-dim">
                Field label
              </Label>
              <Input id="gallery-field" placeholder="Inter, 13px, 36px tall" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="gallery-invalid" className="tms-mono text-dim">
                Invalid field
              </Label>
              <Input id="gallery-invalid" aria-invalid="true" defaultValue="GT 4821" className="mt-1.5" />
              <p className="mt-1 text-[11.5px] text-danger">A plate reads two letters, four digits and a two-digit year.</p>
            </div>
          </div>
        </div>
      </Section>

      <p className="mt-8 border-t border-divider pt-4 text-[12px] leading-relaxed text-dim">
        Everything on this page is sample data. The design system has no write path: it renders states, and the states a
        real query can return are the ones shown above.
      </p>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <BookingIntakeDialog open={bookingOpen} onOpenChange={setBookingOpen} />
    </AppShell>
  );
}
