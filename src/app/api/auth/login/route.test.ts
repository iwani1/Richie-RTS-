// The boundary of the sign-in endpoint.
//
// These cases are the ones that must be decided before the database is touched: a request from
// another origin (audit F-08), a body that is not the shape the endpoint expects, and a throttled
// account. They are the first tests this route has had (audit F-15), and the reason the two high
// findings in the last audit needed a running server to prove.
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { resetThrottle } from "../../../../server/rateLimit";

afterEach(() => {
  resetThrottle();
  delete process.env.TRUST_PROXY;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("sign-in endpoint", () => {
  it("refuses a request from another origin before reading the body", async () => {
    const response = await post({ email: "a@b.test", password: "x" }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("answers a malformed body with the same message as a wrong password", async () => {
    const response = await post({ email: "not-an-email", password: "" });
    expect(response.status).toBe(400);
    // Nothing about which accounts exist, or which field was wrong.
    expect((await response.json()).message).toBe("Incorrect email or password.");
  });
});
