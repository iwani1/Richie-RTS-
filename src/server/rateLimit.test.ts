import { beforeEach, describe, expect, it } from "vitest";
import { attempt, check, clear, recordFailure, resetThrottle } from "./rateLimit";

describe("sign-in throttle", () => {
  beforeEach(resetThrottle);

  it("allows a burst and then refuses with a retry hint", () => {
    const start = 1_000_000;
    for (let i = 0; i < 8; i += 1) expect(attempt("1.2.3.4:a@b.test", start).allowed).toBe(true);
    const blocked = attempt("1.2.3.4:a@b.test", start + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("forgets the count after the window", () => {
    const start = 1_000_000;
    for (let i = 0; i < 8; i += 1) attempt("k", start);
    expect(attempt("k", start + 15 * 60 * 1000 + 1).allowed).toBe(true);
  });

  it("keys separately per address and account, so one guesser cannot lock everyone out", () => {
    for (let i = 0; i < 8; i += 1) attempt("1.2.3.4:a@b.test");
    expect(attempt("1.2.3.4:a@b.test").allowed).toBe(false);
    expect(attempt("5.6.7.8:a@b.test").allowed).toBe(true);
    expect(attempt("1.2.3.4:c@d.test").allowed).toBe(true);
  });

  it("clears a key after a successful sign-in", () => {
    for (let i = 0; i < 8; i += 1) attempt("k");
    clear("k");
    expect(attempt("k").allowed).toBe(true);
  });

  it("asks without counting, so a successful sign-in never consumes the budget", () => {
    // A first run with a mistyped field used to lock the installation: every arrival counted.
    for (let i = 0; i < 20; i += 1) expect(check("setup:local").allowed).toBe(true);
  });

  it("counts only failures, and refuses once they reach the limit", () => {
    const start = 1_000_000;
    for (let i = 0; i < 8; i += 1) recordFailure("account:a@b.test", start);
    expect(check("account:a@b.test", start).allowed).toBe(false);
    expect(check("account:a@b.test", start + 15 * 60 * 1000 + 1).allowed).toBe(true);
  });
});
