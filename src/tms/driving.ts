// What a driver is licensed and qualified for, and whether they may take this vehicle (FLT-04, D-103).
//
// Until now a driver's record was a number and an expiry date: dispatch checked that the licence had
// not run out, and nothing checked *what* they were licensed to drive. A driver holding a small-car
// licence could be signed to a 45-seat coach, and the system would say the licence was in order.
//
// The vocabulary is the office's own. Ghana's DVLA prints classes on the licence, and the office
// knows which of its vehicles each class covers; nothing here decides that for them. A vehicle
// category may *declare* the classes that may drive it, and an undeclared category checks nothing —
// an empty cell means nobody has said, and inventing a rule would ground a working fleet.
//
// The rule deliberately fails closed once a requirement is declared: a driver whose class is not
// recorded cannot be shown to hold the one required, so the assignment is refused with the fix
// named. That is the difference between "we checked and it is fine" and "we cannot check".
import type { Database, Driver } from "./types";

export const DRIVING_LIMITS = {
  /** Longest licence-class token accepted, e.g. "C1E". */
  classLength: 10,
  classesPerDriver: 8,
  qualificationLength: 40,
  qualificationsPerDriver: 12,
} as const;

/**
 * Turns what a person typed into tags: comma or semicolon separated, inner runs of spaces collapsed,
 * blanks dropped, duplicates removed ignoring case. `upper` is used for licence classes, which are
 * printed in capitals on the licence and should compare equal however they are typed.
 */
export function parseTags(text: string, options: { upper?: boolean } = {}): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of (text ?? "").split(/[,;]/)) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const normalised = options.upper ? tag.toUpperCase() : tag;
    const key = normalised.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(normalised);
  }
  return tags;
}

/** Splits a licence-class list into the errors a form can show. */
export function validateTags(
  field: string,
  tags: string[],
  limits: { max: number; length: number; label: string },
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (tags.length > limits.max) errors[field] = `Keep this to ${limits.max} entries.`;
  else {
    const long = tags.find((tag) => tag.length > limits.length);
    if (long) errors[field] = `"${long.slice(0, limits.length + 5)}" is too long for a ${limits.label} (${limits.length} characters at most).`;
  }
  return errors;
}

/** The classes the office has said may drive this category. Empty means nobody has said. */
export function classesFor(db: Database, categoryId: string): string[] {
  return db.settings.vehicleCategories.find((category) => category.id === categoryId)?.licenceClasses ?? [];
}

/**
 * Why this driver may not be signed to a vehicle of this category, or null when nothing stops it.
 *
 * Checked only where the office has classified the category. The message names the licence classes
 * required, the ones the driver holds, and what to do about it — a refusal that only says "no" is
 * how an operator learns to work around the system.
 */
export function licenceClassProblem(db: Database, driver: Driver, categoryId: string): string | null {
  const required = classesFor(db, categoryId);
  if (required.length === 0) return null;

  const category = db.settings.vehicleCategories.find((candidate) => candidate.id === categoryId);
  const categoryName = category?.name ?? "this vehicle category";
  const wanted = required.join(", ");
  const held = (driver.licenceClasses ?? []).map((klass) => klass.toUpperCase());

  if (held.length === 0) {
    return `Driver ${driver.fullName}'s licence class is not recorded, and ${categoryName} requires ${wanted}. Record the class from their licence before assigning this vehicle.`;
  }
  if (held.some((klass) => required.some((needed) => needed.toUpperCase() === klass))) return null;
  return `Driver ${driver.fullName} holds licence class ${held.join(", ")}, and ${categoryName} requires ${wanted}. A driver may only be signed to a vehicle they are licensed to drive.`;
}

/**
 * What a driver is doing today, in the register's words.
 *
 * Derived from the trips and hires that name them, never stored: a stored "available" flag is the
 * first thing that goes stale when a run is cancelled. Only a live run counts — a completed trip is
 * not keeping the driver busy.
 */
export function driverAvailabilityLine(db: Database, driverId: string, today: string): string {
  const trip = db.trips.find(
    (candidate) =>
      candidate.driverId === driverId &&
      candidate.serviceDate === today &&
      (candidate.status === "planned" || candidate.status === "dispatched" || candidate.status === "in_progress"),
  );
  if (trip) {
    const route = db.routes.find((candidate) => candidate.id === trip.routeId);
    return route ? `On ${trip.reference} (${route.name}) today` : `On ${trip.reference} today`;
  }

  const hire = db.rentals.find(
    (candidate) =>
      candidate.assignedDriverId === driverId &&
      (candidate.status === "confirmed" || candidate.status === "in_progress") &&
      candidate.startDate <= today &&
      today <= candidate.endDate,
  );
  if (hire) return `On hire ${hire.reference} today`;

  return "Free today";
}
