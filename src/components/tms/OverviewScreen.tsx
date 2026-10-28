"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, RefreshCw, Shapes } from "lucide-react";
import { AppShell } from "@/components/tms/AppShell";
import { PageHeader } from "@/components/tms/PageHeader";
import { StatCard, StatGrid } from "@/components/tms/StatCard";
import { Panel } from "@/components/tms/Panel";
import { FleetMixBar, RingGauge } from "@/components/tms/RingGauge";
import { FleetMap } from "@/components/tms/FleetMap";
import { DataTable, TableFoot, type TmsColumn } from "@/components/tms/DataTable";
import { ActivityFeed } from "@/components/tms/ActivityFeed";
import { StatusBadge, TripStatusBadge } from "@/components/tms/StatusBadge";
import { LiveDot } from "@/components/tms/LiveDot";
import { EmptyState } from "@/components/tms/States";
import { Button } from "@/components/ui/button";
import { BookingIntakeDialog } from "./BookingIntakeDialog";
import { overviewSample } from "@/lib/mock/overview.sample";
import type { LiveTrip, RangeKey } from "@/lib/mock/types";

/** A vehicle plate reads as a reference, not as prose: mono, and it stays on one line. */
function Mono({ children }: { children: React.ReactNode }) {
  return <span className="tms-mono text-foreground">{children}</span>;
}

function delay(trip: LiveTrip) {
  if (trip.status === "delayed" && trip.delayMinutes > 0) {
    return (
      <span className="tms-mono text-warning">
        {trip.eta} <span aria-hidden="true">·</span> +{trip.delayMinutes}m
      </span>
    );
  }
  if (!trip.eta) return <span className="tms-mono text-dim">—</span>;
  return <span className="tms-mono text-foreground">{trip.eta}</span>;
}

/**
 * Operations overview.
 *
 * Everything on this page is passed in: the screen asks `overviewSample` for a payload shaped like
 * the one a query will return, and hands slices of it to components that know nothing about sample
 * data. That is the whole seam — replacing the import with a fetch changes nothing else here.
 *
 * The page is honest about itself. The payload carries the words "Sample data — not records", they
 * are printed twice (header and map), and the map says in its own caption that no vehicle reports a
 * location in this build.
 */
export function OverviewScreen({ initialRange = "today" }: { initialRange?: RangeKey }) {
  const [range, setRange] = useState<RangeKey>(initialRange);
  // The payload is re-cut when the period changes; the relative times in the feed are measured from
  // the payload's own capture time, so they never drift with the reader's clock.
  const data = useMemo(() => overviewSample(range), [range]);
  const [tripsState, setTripsState] = useState<"ready" | "loading">("ready");
  const [bookingOpen, setBookingOpen] = useState(false);

  const refreshTrips = () => {
    setTripsState("loading");
    // Nothing is fetched in this build: the sample payload is re-cut after a beat so the loading
    // state is a real state the screen can be in, not a screenshot in a document.
    window.setTimeout(() => setTripsState("ready"), 550);
  };

  const columns = useMemo<TmsColumn<LiveTrip>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Trip",
        enableSorting: true,
        cell: ({ row }) => <Mono>{row.original.id}</Mono>,
      },
      {
        accessorKey: "route",
        header: "Route",
        enableSorting: true,
        cell: ({ row }) => <span className="text-foreground">{row.original.route}</span>,
      },
      {
        accessorKey: "driver",
        header: "Driver",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.driver === "Not assigned" ? (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              Not assigned
            </span>
          ) : (
            row.original.driver
          ),
      },
      {
        accessorKey: "vehicle",
        header: "Vehicle",
        enableSorting: false,
        cell: ({ row }) => <Mono>{row.original.vehicle}</Mono>,
      },
      {
        accessorKey: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => <TripStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "eta",
        header: "ETA",
        enableSorting: true,
        cell: ({ row }) => delay(row.original),
      },
    ],
    [],
  );

  const running = data.trips.filter((trip) => trip.status === "on_route" || trip.status === "boarding" || trip.status === "delayed").length;

  return (
    <AppShell breadcrumb={[{ label: "Richie TMS" }, { label: "Operations" }, { label: "Overview" }]}>
      <PageHeader
        title="Operations overview"
        subtitle={`${data.company} — ${range === "today" ? "today's" : range === "week" ? "this week's" : "this month's"} runs, vehicles and money on one board. Sample data; the register lives in the live application.`}
        range={range}
        onRangeChange={setRange}
        onNewBooking={() => setBookingOpen(true)}
      />

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusBadge tone="neutral">{data.sampleLabel}</StatusBadge>
        <span className="tms-mono flex items-center gap-1.5 text-dim">
          <LiveDot tone="success" /> {running} runs moving
        </span>
        <span className="tms-mono text-dim">Operator {data.operator}</span>
        <Link
          href="/"
          className="tms-mono ml-auto inline-flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none"
        >
          Live application <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <StatGrid className="mt-4">
        {data.kpis.map((kpi, index) => (
          <StatCard key={kpi.key} kpi={kpi} index={index} />
        ))}
      </StatGrid>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          kicker="Fleet"
          title="Where the vehicles are"
          description="Route lines and vehicle positions for the runs in progress."
          action={<span className="tms-mono rounded-full border border-border px-2 py-0.5 text-dim">Illustrative</span>}
          bodyClassName="px-3 pb-3"
        >
          <FleetMap data={data.map} />
          <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-dim">
            No telematics provider is connected in this build, so these positions are drawn from sample data. The
            component takes its markers and routes as props, so a real map replaces it without touching this page.
          </p>
        </Panel>

        <Panel
          className="xl:col-span-4"
          kicker="Utilisation"
          title="How the fleet is spent"
          description={data.ring.caption}
          action={
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/design" aria-label="See the ring in the design system">
                <Shapes className="size-3.5" aria-hidden="true" />
                Gallery
              </Link>
            </Button>
          }
        >
          <div className="px-4 pb-4">
            <RingGauge summary={data.ring} />
            <FleetMixBar summary={data.ring} className="mt-4" />
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel className="xl:col-span-8" kicker="Live trips" title="On the road now" bodyClassName="-mt-1">
          <DataTable
            data={data.trips}
            columns={columns}
            state={tripsState}
            caption="Live trips: route, driver, vehicle, status and estimated arrival"
            initialSorting={[{ id: "id", desc: true }]}
            maxHeight="22rem"
            emptyTitle="No runs in this period"
            emptyBody="Change the period, or add a booking to put a run on this board."
            toolbar={
              <>
                <span className="tms-mono flex items-center gap-1.5 text-dim">
                  <LiveDot tone="success" /> {data.trips.length} runs
                </span>
                <span className="tms-mono hidden text-dim sm:inline">Sorted by trip</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshTrips}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Refresh the trip list"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Refresh
                </Button>
              </>
            }
          />
          <TableFoot left={`Showing ${data.trips.length} of ${data.trips.length} runs`} right={range === "today" ? "Today" : range === "week" ? "This week" : "This month"} />
        </Panel>

        <Panel
          className="xl:col-span-4"
          kicker="Activity"
          title="Latest on the board"
          action={
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link href="/design" aria-label="See the activity feed in the design system">
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                Gallery
              </Link>
            </Button>
          }
        >
          <ActivityFeed entries={data.activity} now={data.capturedAt} className="px-4 pb-4" />
          {data.activity.length === 0 && (
            <EmptyState title="Nothing has happened yet" body="Dispatches, status changes and alerts appear here as they occur." />
          )}
        </Panel>
      </div>

      <BookingIntakeDialog open={bookingOpen} onOpenChange={setBookingOpen} />
    </AppShell>
  );
}
