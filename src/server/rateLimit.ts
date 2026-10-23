// A deliberately small sign-in throttle.
//
// It is in-process memory, so it resets on restart and does not coordinate across replicas.
// That is honest and adequate for the deployment this application targets (one Next.js server on
// one workstation), and it removes the trivial online password-guessing loop an unthrottled login
// endpoint offers. If the app is ever run behind several instances, move the counter into
// PostgreSQL or the reverse proxy. Recorded as a known limit in docs/SECURITY-NOTES.md.
type Bucket = { failures: number; resetAt: number };

const BUCKETS = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export interface ThrottleResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function attempt(key: string, now = Date.now()): ThrottleResult {
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.failures >= MAX_FAILURES) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.failures += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clear(key: string): void {
  BUCKETS.delete(key);
}

/** Test seam. */
export function resetThrottle(): void {
  BUCKETS.clear();
}
