// The two request-boundary helpers.
//
// `clientKey` decides who is being throttled; `sameOrigin` decides whether a state-changing request
// came from this application. Both were the subject of audit findings: the first because it trusted
// a header the client controls (F-02), the second because it did not exist (F-08).
import { afterEach, describe, expect, it } from "vitest";
import { clientKey, sameOrigin } from "./api";

const request = (headers: Record<string, string> = {}, url = "http://localhost:3000/api/commands") =>
  new Request(url, { method: "POST", headers });

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("client key", () => {
  it("ignores a forwarded address unless a proxy is declared", () => {
    delete process.env.TRUST_PROXY;
    expect(clientKey(request({ "x-forwarded-for": "203.0.113.9" }))).toBe("local");
    expect(clientKey(request({ "x-real-ip": "203.0.113.9" }))).toBe("local");
  });

  it("uses the hop the proxy appended, not the one the caller wrote", () => {
    process.env.TRUST_PROXY = "1";
    // A caller can prepend anything; the last entry is the one the trusted proxy added.
    expect(clientKey(request({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("falls back to x-real-ip, then to a shared key", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientKey(request({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientKey(request())).toBe("local");
  });
});

describe("same origin", () => {
  it("accepts either loopback spelling, because both reach the same server", () => {
    expect(sameOrigin(request({ origin: "http://127.0.0.1:3000" }, "http://127.0.0.1:3000/api/commands"))).toBe(true);
  });

  it("accepts a request from its own origin", () => {
    expect(sameOrigin(request({ origin: "http://localhost:3000" }))).toBe(true);
  });

  it("accepts a request with no Origin at all — a script has no cookie to ride on", () => {
    expect(sameOrigin(request())).toBe(true);
  });

  it("refuses another site's origin", () => {
    expect(sameOrigin(request({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(request({ origin: "http://localhost:3001" }))).toBe(false);
  });

  it("compares against PUBLIC_ORIGIN when a proxy rewrites the host", () => {
    process.env.PUBLIC_ORIGIN = "https://tms.example.com/";
    expect(sameOrigin(request({ origin: "https://tms.example.com" }, "http://10.0.0.5:3000/api/commands"))).toBe(true);
    // Reaching the same server directly on its internal address is still same-origin.
    expect(sameOrigin(request({ origin: "http://10.0.0.5:3000" }, "http://10.0.0.5:3000/api/commands"))).toBe(true);
  });
});
