// A deliberately small sign-in throttle.
//
// Keys are chosen by the route: sign-in keeps one bucket per account and one per address, so a
// forged address cannot buy extra guesses against an account (audit F-02).
//
// It is in-process memory, so it resets on restart and does not coordinate across replicas.
// That is honest and adequate for the deployment this application targets (one Next.js server on
// one workstation), and it removes the trivial online password-guessing loop an unthrottled login
// endpoint offers. If the app is ever run behind several instances, move the counter into
// PostgreSQL or the reverse proxy. Recorded as a known limit in docs/DATA_PROTECTION.md.
type Bucket = { failures: number; resetAt: number };

const BUCKETS = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export interface ThrottleResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Whether this key may try again, without counting the attempt.
 *
 * Counting on arrival punished the honest operator: eight validation mistakes during first-run
 * setup locked the installation for fifteen minutes. Only failures are recorded, so this asks the
 * question and `recordFailure` answers it.
 */
export function check(key: string, now = Date.now()): ThrottleResult {
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (bucket.failures >= MAX_FAILURES) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Counts one failed attempt against a key. */
export function recordFailure(key: string, now = Date.now()): void {
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  bucket.failures += 1;
}

/** Check, then count. Kept for callers that count every arrival; the sign-in routes use `check`. */
export function attempt(key: string, now = Date.now()): ThrottleResult {
  const result = check(key, now);
  if (result.allowed) recordFailure(key, now);
  return result;
}

export function clear(key: string): void {
  BUCKETS.delete(key);
}

/** Test seam. */
export function resetThrottle(): void {
  BUCKETS.clear();
}
