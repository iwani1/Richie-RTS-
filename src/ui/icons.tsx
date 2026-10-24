// One icon family, drawn inline: 20×20 box, 1.5px stroke, currentColor, `aria-hidden` by default
// because every icon in this application sits beside its own label. No icon font, no image weight.
import type { ReactElement, SVGProps } from "react";

type IconName =
  | "dashboard"
  | "rental"
  | "invoice"
  | "busing"
  | "logistics"
  | "readiness"
  | "compliance"
  | "vehicle"
  | "driver"
  | "client"
  | "user"
  | "settings"
  | "audit"
  | "search"
  | "chevron"
  | "alert"
  | "clock"
  | "eye"
  | "eyeOff";

const paths: Record<IconName, ReactElement> = {
  // A document with a folded corner and a ruled line — a bill, not a page of editorial text.
  invoice: (
    <>
      <path d="M5 3h6l4 4v10H5z" />
      <path d="M11 3v4h4" />
      <path d="M7.5 11h5M7.5 13.5h5" />
    </>
  ),
  // A board with a departures line — the operations desk.
  dashboard: (
    <>
      <path d="M3 4h14M3 10h9M3 16h14" />
      <circle cx="15.5" cy="10" r="1.6" />
    </>
  ),
  // A key tag, for a rental booking.
  rental: (
    <>
      <path d="M11.5 3.5 16.5 8.5 9 16H4v-5z" />
      <circle cx="12.8" cy="7.2" r="1.3" />
    </>
  ),
  // A route with two stops.
  busing: (
    <>
      <circle cx="5" cy="15" r="2" />
      <circle cx="15" cy="5" r="2" />
      <path d="M7 15h4a2 2 0 0 0 2-2V7" />
    </>
  ),
  // A spanner over a bolt.
  logistics: (
    <>
      <path d="M13.5 3.2a3.6 3.6 0 0 0 3.3 5.3L8.4 16.9 5 13.5l8.3-8.4a3.6 3.6 0 0 0 .2-1.9z" />
      <path d="M4 16.5 5.5 18" />
    </>
  ),
  // A gauge needle.
  readiness: (
    <>
      <path d="M3.5 14a7 7 0 0 1 13 0" />
      <path d="M10 14 13 9.5" />
      <circle cx="10" cy="14" r="1" />
    </>
  ),
  // A document with a folded corner.
  compliance: (
    <>
      <path d="M5 3h6l4 4v10H5z" />
      <path d="M11 3v4h4M7.5 12h5" />
    </>
  ),
  vehicle: (
    <>
      <path d="M3 12V8h14v4M3 12v3h14v-3" />
      <circle cx="6.5" cy="15" r="1.4" />
      <circle cx="13.5" cy="15" r="1.4" />
      <path d="M5 8l2-3h6l2 3" />
    </>
  ),
  driver: (
    <>
      <circle cx="10" cy="7" r="2.8" />
      <path d="M4.5 16.5c0-2.6 2.5-4.3 5.5-4.3s5.5 1.7 5.5 4.3" />
    </>
  ),
  client: (
    <>
      <path d="M4 16.5V6.5L10 4l6 2.5v10" />
      <path d="M7.5 16.5v-5h5v5M3 16.5h14" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="7.5" r="2.4" />
      <path d="M3.5 16c0-2.3 2-3.8 4.5-3.8S12.5 13.7 12.5 16" />
      <path d="M14 5.5h3.5M14 9h3.5M14 12.5h2" />
    </>
  ),
  settings: (
    <>
      <path d="M3 6h14M3 10h14M3 14h14" />
      <circle cx="7" cy="6" r="1.6" />
      <circle cx="13" cy="10" r="1.6" />
      <circle cx="8.5" cy="14" r="1.6" />
    </>
  ),
  // A stamped page.
  audit: (
    <>
      <path d="M5 3h10v14H5z" />
      <path d="M7.5 7h5M7.5 10h5M7.5 13h3" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="4.5" />
      <path d="M12.5 12.5 17 17" />
    </>
  ),
  chevron: <path d="M7.5 5.5 12 10l-4.5 4.5" />,
  alert: (
    <>
      <path d="M10 3.5 17 16H3z" />
      <path d="M10 8v3.5M10 13.6v.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.5" />
    </>
  ),
  // An open eye, for revealing a password that is hidden.
  eye: (
    <>
      <path d="M2.2 10S5.1 4.8 10 4.8 17.8 10 17.8 10 14.9 15.2 10 15.2 2.2 10 2.2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </>
  ),
  // The same eye struck through, for hiding it again.
  eyeOff: (
    <>
      <path d="M2.2 10S5.1 4.8 10 4.8c1.4 0 2.7.4 3.8 1" />
      <path d="M17.8 10s-2.9 5.2-7.8 5.2c-1.4 0-2.7-.4-3.8-1" />
      <path d="M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4" />
      <path d="m3.2 3.2 13.6 13.6" />
    </>
  ),
};

export function Icon({ name, className, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export type { IconName };
