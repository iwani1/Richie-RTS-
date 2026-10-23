import { beforeEach, describe, expect, it } from "vitest";
import { attempt, clear, resetThrottle } from "./rateLimit";

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
});
