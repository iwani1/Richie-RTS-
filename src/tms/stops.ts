// Where a stop actually is (RTE-01, D-104).
//
// A stop was a name and a time. "Estate gate, 06:15" tells a driver who already knows the estate
// where to go; it does not help the relief driver on their first morning, and it cannot be typed
// into a phone. This module is the one place that decides what counts as a usable answer, and how
// the answer reads on a screen or a printed manifest — so the form, the driver's run and the paper
// cannot disagree about the same stop.
//
// Everything here is optional. A stop with no landmark is not wrong, and the screens print nothing
// rather than a placeholder; but a stop that *has* a digital address must have a real-shaped one,
// because a mistyped Ghana Post GPS code is worse than no code: the driver follows it somewhere
// else.
import type { Database, RouteStop } from "./types";

export const STOP_DETAIL_LIMITS = {
  landmark: 200,
  digitalAddress: 20,
} as const;

/**
 * Ghana Post GPS addresses look like `GA-123-4567`: two letters for the region, three or four
 * digits for the district grid, four digits for the point. Checked for shape only — whether the
 * point exists is not something a form can know.
 */
export const GHANA_POST_GPS_RE = /^[A-Za-z]{2}-\d{3,4}-\d{4}$/;

/** A decimal degree value, with at most six places: about 11 cm, which is closer than a bus stops. */
const COORDINATE_RE = /^-?\d{1,3}(\.\d{1,6})?$/;

export interface StopDetailInput {
  landmark?: string;
  digitalAddress?: string;
  latitude?: string;
  longitude?: string;
}

export type StopProblems = Record<string, string>;

/**
 * Checks the descriptive part of one stop and returns its normalised values.
 *
 * `index` names the field so the form can point at the stop that needs fixing: `stops.2.landmark`.
 * Latitude and longitude are refused one without the other, because half a position puts a pin in
 * the Gulf of Guinea — and a driver would believe it.
 */
export function readStopDetail(
  input: StopDetailInput,
  index: number,
): { errors: StopProblems; value: Required<StopDetailInput> } {
  const errors: StopProblems = {};
  const landmark = (input.landmark ?? "").trim();
  const digitalAddress = (input.digitalAddress ?? "").trim().toUpperCase();
  const latitude = (input.latitude ?? "").trim();
  const longitude = (input.longitude ?? "").trim();

  if (landmark.length > STOP_DETAIL_LIMITS.landmark)
    errors[`stops.${index}.landmark`] = `Keep the landmark to ${STOP_DETAIL_LIMITS.landmark} characters.`;

  if (digitalAddress) {
    if (digitalAddress.length > STOP_DETAIL_LIMITS.digitalAddress)
      errors[`stops.${index}.digitalAddress`] = `Keep the digital address to ${STOP_DETAIL_LIMITS.digitalAddress} characters.`;
    else if (!GHANA_POST_GPS_RE.test(digitalAddress))
      errors[`stops.${index}.digitalAddress`] = "A Ghana Post GPS address looks like GA-123-4567.";
  }

  if (latitude && !COORDINATE_RE.test(latitude)) errors[`stops.${index}.latitude`] = "Use decimal degrees, such as 5.603717.";
  else if (latitude && (Number(latitude) < -90 || Number(latitude) > 90)) errors[`stops.${index}.latitude`] = "Latitude is between -90 and 90.";

  if (longitude && !COORDINATE_RE.test(longitude)) errors[`stops.${index}.longitude`] = "Use decimal degrees, such as -0.186964.";
  else if (longitude && (Number(longitude) < -180 || Number(longitude) > 180))
    errors[`stops.${index}.longitude`] = "Longitude is between -180 and 180.";

  if (!errors[`stops.${index}.latitude`] && !errors[`stops.${index}.longitude`]) {
    if (latitude && !longitude) errors[`stops.${index}.longitude`] = "Enter both coordinates, or neither.";
    else if (longitude && !latitude) errors[`stops.${index}.latitude`] = "Enter both coordinates, or neither.";
  }

  return { errors, value: { landmark, digitalAddress, latitude, longitude } };
}

/** The stop's directions as one line, or empty when nobody has described it. */
export function stopDetailLine(stop: Pick<RouteStop, "landmark" | "digitalAddress">): string {
  return [stop.landmark?.trim(), stop.digitalAddress?.trim()].filter(Boolean).join(" · ");
}

/**
 * A link a driver can tap, or null when the stop has no coordinates.
 *
 * Deliberately a plain map search rather than an embedded map: the driver's phone has whatever map
 * it has, this program carries no location data of its own, and nothing here needs an API key or an
 * internet bill (Q-01).
 */
export function stopMapLink(stop: Pick<RouteStop, "latitude" | "longitude" | "name">): string | null {
  if (!stop.latitude || !stop.longitude) return null;
  const point = `${stop.latitude},${stop.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point)}`;
}

/** Reads a stop back out of an older record, where the descriptive fields did not exist. */
export function migrateStop(stop: Partial<RouteStop> & { id: string; name: string; scheduledTime: string }): RouteStop {
  return {
    ...stop,
    landmark: typeof stop.landmark === "string" ? stop.landmark : "",
    digitalAddress: typeof stop.digitalAddress === "string" ? stop.digitalAddress : "",
    latitude: typeof stop.latitude === "string" ? stop.latitude : "",
    longitude: typeof stop.longitude === "string" ? stop.longitude : "",
  };
}

/**
 * How many stops of a route have no directions at all.
 *
 * The office needs to see this number rather than be told the register is complete: a route where
 * every stop is a bare name is a route that only works for the driver who already knows it.
 */
export function stopsWithoutDirections(db: Database, routeId: string): number {
  const route = db.routes.find((candidate) => candidate.id === routeId);
  return route ? route.stops.filter((stop) => stopDetailLine(stop) === "").length : 0;
}
