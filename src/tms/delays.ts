// A run that is late, while it is still happening (DSP-04, D-105).
//
// The stop times already measure lateness after the fact — `staffReport.ts` averages it from the
// recorded arrivals. That is not the fact the office needs at 07:20, when a client rings to ask
// where the bus has got to. A delay entry is that different fact: *this run*, *this far behind*,
// *for this reason*, recorded by a person whose name is on it.
//
// One entry is one statement, and the statements are append-only. A second entry is the delay
// getting worse, or the run catching up (`minutes: 0`); the earlier ones stay, because a client
// asking "why were my staff late on Tuesday" is answered by what was known at the time, not by
// whatever the record has since been tidied into.
//
// This module owns the two things that must not be reimplemented per screen: what a usable entry
// is, and how it reads in a sentence.
import type { Trip, TripDelay } from "./types";

export const DELAY_LIMITS = {
  /** Beyond this it is not a delay, it is a run that did not happen; cancel it instead. */
  maxMinutes: 600,
  /** Room for a sentence, not for a report. The audit log carries the long version. */
  reason: 200,
} as const;

export interface DelayInput {
  minutes?: number | string;
  reason?: string;
}

export type DelayProblems = Record<string, string>;

/**
 * Reads what the form sent, or says what is wrong with it.
 *
 * `minutes` arrives from a number input as a string, so it is read as text and converted: an empty
 * box and a box holding "12" must not both count as twelve. A negative number is refused rather
 * than treated as early, because nobody reports a bus being minus ten minutes late.
 */
export function readDelayInput(input: DelayInput, allowZero = false): { errors: DelayProblems; value: TripDelay["minutes"] | null; reason: string } {
  const errors: DelayProblems = {};
  const raw = typeof input.minutes === "number" ? String(input.minutes) : (input.minutes ?? "").trim();
  const reason = (input.reason ?? "").trim();

  let minutes: number | null = null;
  if (!raw) errors.minutes = "Enter how many minutes behind the timetable the run is.";
  else if (!/^\d{1,3}$/.test(raw)) errors.minutes = "Enter whole minutes, such as 20.";
  else {
    minutes = Number(raw);
    if (minutes > DELAY_LIMITS.maxMinutes)
      errors.minutes = `Enter ${DELAY_LIMITS.maxMinutes} minutes or fewer. Beyond that, cancel the run and record why.`;
    else if (minutes === 0 && !allowZero) errors.minutes = "Enter at least one minute. To say the run caught up, use “back on time”.";
  }

  if (!reason) errors.reason = "Say what is holding the run up: traffic, a closed road, a breakdown.";
  else if (reason.length > DELAY_LIMITS.reason) errors.reason = `Keep the reason to ${DELAY_LIMITS.reason} characters.`;

  return { errors, value: Object.keys(errors).length === 0 ? minutes : null, reason };
}

/** Minutes as words, because "20 min" on a screen is read as a code. */
export function minutesLabel(minutes: number): string {
  if (minutes === 0) return "on time";
  if (minutes === 1) return "1 minute";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 1 ? "1 hour" : `${hours} hours`;
  if (rest === 0) return hourPart;
  return `${hourPart} ${rest} minute${rest === 1 ? "" : "s"}`;
}

/**
 * The delay the run is under *now*: the most recent statement, and only while the run is still out.
 *
 * A completed run is not "currently late" no matter what was recorded — its lateness is in its stop
 * times, which is what the transport report measures. Returning null there keeps a finished run from
 * appearing in a live "running late" count.
 */
export function liveDelay(trip: Trip): TripDelay | null {
  if (trip.status !== "dispatched" && trip.status !== "in_progress") return null;
  const latest = trip.delays[trip.delays.length - 1];
  if (!latest || latest.minutes <= 0) return null;
  return latest;
}

/** The most recent statement of any kind, including "back on time". Null when none was made. */
export function latestDelay(trip: Trip): TripDelay | null {
  return trip.delays[trip.delays.length - 1] ?? null;
}

/**
 * One delay as a sentence.
 *
 * `"20 minutes late — traffic on the Spintex road"`, or `"back on time — the road reopened"`. The
 * time is not repeated here: every screen that shows this already says which run and which day.
 */
export function delayLine(delay: TripDelay): string {
  if (delay.minutes === 0) return `back on time — ${delay.reason}`;
  return `${minutesLabel(delay.minutes)} late — ${delay.reason}`;
}

/**
 * The same fact for somebody outside the office: a rider, or the client paying for the run.
 *
 * Written as a full sentence because it is read on its own, under a badge, by a person deciding
 * whether to keep waiting at a stop. Callers pass a *live* delay — `liveDelay()` — so a run that has
 * caught up says nothing; the `0` branch exists for completeness and for screens that summarise a
 * history rather than a moment.
 */
export function delayNote(delay: TripDelay): string {
  if (delay.minutes === 0) return `A delay was reported on this run and has since cleared: ${delay.reason}.`;
  return `This run is reported ${minutesLabel(delay.minutes)} behind its timetable — ${delay.reason}.`;
}

/**
 * What a run's delay history adds up to for a reader: the current statement and how many times it
 * moved. Two or more entries means the first answer was not the last one, which is worth knowing.
 */
export function delaySummary(trip: Trip): string {
  const latest = latestDelay(trip);
  if (!latest) return "";
  const count = trip.delays.length;
  return count > 1 ? `${delayLine(latest)} (${count} reports)` : delayLine(latest);
}

/** The runs on a day that are out and behind, for the desk's own count. */
export function runningLate(trips: Trip[]): Trip[] {
  return trips.filter((trip) => liveDelay(trip) !== null);
}
