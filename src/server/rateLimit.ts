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

// A second, general window for endpoints that are public rather than credential-checking: the
// enquiry form counts arrivals, not failures, because every arrival is work the office has to read.
// Kept apart from BUCKETS so a burst of enquiries cannot lock anyone out of signing in.
type Window = { count: number; resetAt: number };
const WINDOWS = new Map<string, Window>();

/**
 * Counts one arrival against a key and says whether it is within the limit.
 *
 * The clock is taken per call and windows are fixed rather than sliding: a caller cannot nudge the
 * boundary by spacing attempts, and the state stays one integer per key.
 */
export function take(key: string, limit: number, windowMs: number, now = Date.now()): ThrottleResult {
  const current = WINDOWS.get(key);
  if (!current || current.resetAt <= now) {
    // Cheap sweep: without it a long-running server keeps one entry per address it has ever seen.
    if (WINDOWS.size > 1_000) {
      for (const [existing, window] of WINDOWS) if (window.resetAt <= now) WINDOWS.delete(existing);
    }
    WINDOWS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clear(key: string): void {
  BUCKETS.delete(key);
}

/** Test seam. */
export function resetThrottle(): void {
  BUCKETS.clear();
  WINDOWS.clear();
}
