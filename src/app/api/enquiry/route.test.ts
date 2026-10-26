// The boundary of the only unauthenticated write in the application (WEB-01).
//
// What these cases are for: a stranger's request must cost the server almost nothing before it is
// validated, must not be able to open a transaction by skipping the form, and must never receive a
// record back. The write itself is covered in src/tms/enquiry.test.ts and through the running
// server by scripts/e2e-workflow-c.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.fn();
const settingsRow = { data: { vehicleCategories: [{ id: "cat-1", name: "Coaster", licenceClasses: [] }] } };

vi.mock("../../../server/commands", () => ({ runCommand }));
vi.mock("../../../server/db", () => ({
  db: () => ({
    selectFrom: () => ({ select: () => ({ executeTakeFirst: async () => settingsRow }) }),
  }),
}));

const { GET, POST } = await import("./route");
const { issueEnquiryToken } = await import("../../../server/enquiryToken");
const { resetThrottle } = await import("../../../server/rateLimit");
const { resetEnvCache } = await import("../../../server/env");

const TOKEN = "tok";
const body = (overrides: Record<string, unknown> = {}) => ({
  token: TOKEN,
  customerName: "Akosua Boateng",
  customerPhone: "+233 24 123 4567",
  customerEmail: "",
  organization: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  passengers: "18",
  vehicleCategoryId: "cat-1",
  notes: "",
  ...overrides,
});

/** A token that was issued a minute ago: old enough to look like a person filled the form in. */
const agedToken = () => issueEnquiryToken(Date.now() - 60_000);

const post = (payload: Record<string, unknown>) =>
  POST(
    new Request("http://localhost:3000/api/enquiry", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://richietransport.example" },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/db";
  process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-characters-long";
  resetEnvCache();
  resetThrottle();
  runCommand.mockReset();
  runCommand.mockResolvedValue({
    ok: true,
    status: 200,
    message: "Thank you. Your request is recorded as RR-0004, and the office will call +233 24 123 4567 to confirm it.",
    database: { rentals: [] },
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TRUST_PROXY;
});

describe("public enquiry endpoint", () => {
  it("opens the form with the vehicle types and a signed token, and no records", async () => {
    const response = await GET(new Request("http://localhost:3000/api/enquiry"));
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, open: true, categories: [{ id: "cat-1", name: "Coaster" }] });
    expect(typeof payload.token).toBe("string");
    // Nothing else travels: no vehicles, no prices, no counts — and no licence classes either,
    // which are the office's rule for its own drivers (FLT-04), not the public's business.
    expect(JSON.stringify(payload)).not.toContain("licenceClasses");
    expect(Object.keys(payload).sort()).toEqual(["categories", "ok", "open", "token"]);
  });

  it("does not accept a submission that has no token at all", async () => {
    const response = await post({ ...body(), token: "" });
    expect(response.status).toBe(400);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("does not accept a token used too quickly to have been typed", async () => {
    const response = await post({ ...body(), token: issueEnquiryToken() });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toMatch(/open too long|finished loading/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot as though it worked, and writes nothing", async () => {
    const response = await post({ ...body(), token: agedToken(), website: "https://spam.example" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, reference: null });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("creates an anonymous enquiry and returns only the reference", async () => {
    const response = await post({ ...body(), token: agedToken() });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({ ok: true, reference: "RR-0004" });
    expect(Object.keys(payload).sort()).toEqual(["message", "ok", "reference"]);

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "submit_enquiry" }),
      // Explicitly anonymous: never `undefined`, which would read the session cookie.
      { userId: null },
    );
  });

  it("passes a validation failure through with its field errors", async () => {
    runCommand.mockResolvedValueOnce({
      ok: false,
      status: 400,
      message: "Please correct the highlighted fields.",
      errors: { customerPhone: "A phone number is needed so the office can call you back." },
    });
    const response = await post({ ...body(), token: agedToken() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      errors: { customerPhone: expect.stringMatching(/phone number/) },
    });
  });

  it("throttles one address instead of letting it flood the office", async () => {
    // Eight in ten minutes is the limit; the ninth is refused before a transaction opens.
    for (let i = 0; i < 8; i += 1) {
      const allowed = await post({ ...body(), token: agedToken() });
      expect(allowed.status).toBe(200);
    }
    const refused = await post({ ...body(), token: agedToken() });
    expect(refused.status).toBe(429);
    expect((await refused.json()) as { retryAfterSeconds: number }).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    expect(runCommand).toHaveBeenCalledTimes(8);
  });

  it("counts against the forwarded address only when a proxy is declared", async () => {
    process.env.TRUST_PROXY = "1";
    resetThrottle();
    for (let i = 0; i < 8; i += 1) {
      const response = await POST(
        new Request("http://localhost:3000/api/enquiry", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` },
          body: JSON.stringify({ ...body(), token: agedToken() }),
        }),
      );
      expect(response.status).toBe(200);
    }
    // Every one of those requests arrived from the same proxy-appended hop.
    const refused = await POST(
      new Request("http://localhost:3000/api/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9, 203.0.113.7" },
        body: JSON.stringify({ ...body(), token: agedToken() }),
      }),
    );
    expect(refused.status).toBe(429);
  });
});
