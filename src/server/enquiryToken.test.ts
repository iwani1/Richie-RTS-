// WEB-01: the signed time-trap on the public form.
//
// The point of each case is what a bot cannot do: forge a timestamp, reuse a token from another
// deployment, or post the instant it has one.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "./env";
import { issueEnquiryToken, MAX_FORM_HOURS, MIN_FORM_SECONDS, verifyEnquiryToken } from "./enquiryToken";

const SECRET = "test-secret-that-is-at-least-32-characters-long";
const NOW = Date.UTC(2026, 5, 1, 8, 0, 0);

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/db";
  process.env.SESSION_SECRET = SECRET;
  resetEnvCache();
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe("enquiry token", () => {
  it("accepts a token once the form has been open for a few seconds", () => {
    const token = issueEnquiryToken(NOW);
    expect(verifyEnquiryToken(token, NOW + MIN_FORM_SECONDS * 1000)).toEqual({ ok: true });
    expect(verifyEnquiryToken(token, NOW + 60_000)).toEqual({ ok: true });
  });

  it("refuses a token used the instant it was issued", () => {
    const token = issueEnquiryToken(NOW);
    expect(verifyEnquiryToken(token, NOW + 500)).toEqual({ ok: false, reason: "too-fast" });
  });

  it("refuses a token from a tab left open past the limit", () => {
    const token = issueEnquiryToken(NOW);
    const stale = NOW + (MAX_FORM_HOURS * 3600 + 1) * 1000;
    expect(verifyEnquiryToken(token, stale)).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses a timestamp moved back or forward without the matching signature", () => {
    const issued = Number(issueEnquiryToken(NOW).split(".")[0]);
    const signature = issueEnquiryToken(NOW).split(".")[1];
    expect(verifyEnquiryToken(`${issued + 600}.${signature}`, NOW + 3_600_000)).toEqual({ ok: false, reason: "forged" });
    expect(verifyEnquiryToken(`${issued - 600}.${signature}`, NOW + 3_600_000)).toEqual({ ok: false, reason: "forged" });
  });

  it("refuses a token signed with a different secret, and anything malformed", () => {
    const token = issueEnquiryToken(NOW);
    process.env.SESSION_SECRET = "a-different-secret-of-at-least-32-characters";
    resetEnvCache();
    expect(verifyEnquiryToken(token, NOW + 60_000)).toEqual({ ok: false, reason: "forged" });
    for (const bad of ["", "abc", "123", "123.", ".abc", "1.2.3", "12a.abc"]) {
      expect(verifyEnquiryToken(bad, NOW).ok).toBe(false);
    }
  });
});
