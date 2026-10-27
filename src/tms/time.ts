// Two clock questions, answered once (RNT-01, D-119 and RNT-07, D-118).
//
// The office writes "half seven" and types 7:30. A hire's duration and a request's planned duration
// are the same arithmetic, so they live here rather than being re-derived in each screen: a plan that
// says nine and a half hours and a run that says nine hours thirty minutes should not be able to
// disagree because one of them rounded differently.

/**
 * A clock time as the record stores it — "HH:MM", 24-hour — or null when what was typed is not a time.
 *
 * "8:00" is accepted and stored as "08:00": one form is easier to type and the other is what sorts and
 * compares. Anything else — "8", "8.00", "25:00", "noon" — is refused, because guessing turns a typed
 * mistake into a schedule nobody can argue with.
 */
export function readClock(value: string): string | null {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/**
 * A length of time in the largest unit that is honest: minutes under an hour, hours under two days,
 * and days above that, with the remainder kept rather than rounded away.
 *
 * Returns null for a negative or unreadable figure, which is a bug in the caller rather than
 * something to print.
 */
export function humanDuration(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} h ${rest} min`;
  const days = Math.floor(hours / 24);
  const leftover = hours % 24;
  return leftover === 0 ? `${days} day${days === 1 ? "" : "s"}` : `${days} days ${leftover} h`;
}
