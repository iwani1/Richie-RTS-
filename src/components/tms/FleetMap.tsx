import { cn } from "@/lib/utils";
import type { FleetMapData } from "@/lib/mock/types";
import { LiveDot } from "./LiveDot";

const MARKER_INK = {
  moving: "bg-success",
  alert: "bg-danger",
  idle: "bg-info",
} as const;

/**
 * The fleet picture.
 *
 * This build has no location provider, so what is drawn is a **placeholder**: a dark canvas with the
 * sample route lines and marker positions that came in through props. It is deliberately a separate
 * component with a data prop, so replacing it with MapLibre and a real dark style is one file and one
 * import — no screen decides how the map is drawn.
 *
 * Markers are positioned elements rather than SVG circles: the route canvas stretches to whatever
 * width the card has, and a circle stretched by a viewBox would be an ellipse. A dot is a dot.
 *
 * Nothing here claims a live position: the caption the payload carries says what the picture is, and
 * the card that holds it says it again.
 */
export function FleetMap({ data, className }: { data: FleetMapData; className?: string }) {
  const moving = data.markers.filter((marker) => marker.status === "moving").length;
  const late = data.markers.filter((marker) => marker.status === "alert").length;

  return (
    <figure
      role="img"
      aria-label={`Illustrative fleet map: ${data.markers.length} vehicles at sample positions, ${moving} moving and ${late} late. ${data.caption}`}
      className={cn("relative m-0 overflow-hidden rounded-[calc(var(--radius-card)-1px)] bg-background", className)}
    >
      <div className="relative h-[260px] w-full sm:h-[300px]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <pattern id="tms-map-grid" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 8 0 L 0 0 0 8" fill="none" className="stroke-border" strokeWidth="0.25" />
            </pattern>
          </defs>

          <rect width="100" height="100" fill="url(#tms-map-grid)" />

          {/* Two soft land shapes, drawn to give the grid somewhere to sit — decoration only. */}
          <g className="fill-muted/40">
            <path d="M0 68 L18 60 L31 64 L44 54 L58 60 L72 50 L88 56 L100 50 L100 100 L0 100 Z" opacity="0.35" />
            <path d="M6 18 L20 12 L34 20 L48 14 L62 22 L78 16 L94 24 L100 20 L100 34 L88 30 L70 36 L54 30 L38 38 L22 32 L8 36 Z" opacity="0.22" />
          </g>

          {/* Route lines from the data, never from the component. */}
          {data.routes.map((route) => (
            <polyline
              key={route.id}
              points={route.points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              className="stroke-primary/45"
              strokeWidth="0.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        {data.markers.map((marker) => (
          <span
            key={marker.id}
            aria-hidden="true"
            title={marker.label}
            className="absolute grid size-2 -translate-x-1/2 -translate-y-1/2 place-items-center"
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
          >
            <span className={cn("absolute size-5 animate-pulse-dot rounded-full opacity-25", MARKER_INK[marker.status])} />
            <span className={cn("relative size-2 rounded-full ring-2 ring-background", MARKER_INK[marker.status])} />
          </span>
        ))}
      </div>

      <figcaption aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider px-4 py-2.5">
        <span className="tms-mono flex items-center gap-1.5 text-dim">
          <LiveDot tone="success" />
          {moving} moving
        </span>
        <span className="tms-mono flex items-center gap-1.5 text-dim">
          <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
          {late} late
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">{data.caption}</span>
      </figcaption>
    </figure>
  );
}
