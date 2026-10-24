import { clientKey, json, readObject } from "../../../server/api";
import { runCommand } from "../../../server/commands";
import { db } from "../../../server/db";
import { issueEnquiryToken, TOKEN_REFUSED, verifyEnquiryToken } from "../../../server/enquiryToken";
import { take } from "../../../server/rateLimit";
import type { Settings } from "../../../tms/types";

export const dynamic = "force-dynamic";

// The public enquiry endpoint (WEB-01).
//
// This is the only unauthenticated write in the application, so it is built to give away nothing:
//  * it never returns a record — only a reference and a sentence;
//  * it cannot read anything back, so one enquirer cannot see another's request;
//  * it reads no session, so a signed-in member of staff posting here gets an ordinary enquiry;
//  * it is throttled per address and carries a signed time-trap (enquiryToken.ts);
//  * what it creates is a draft, which the office still has to quote and confirm.
//
// Cross-site posting is allowed on purpose. The desktop command route refuses it because it acts
// with a cookie; this route has no cookie to ride, and the form is meant to be embedded on the
// company's own website, which may not share this origin.

/** Enquiries one address may open in ten minutes before it is asked to wait. */
const LIMIT = 8;
const WINDOW_MS = 10 * 60 * 1000;

const text = (body: Record<string, unknown>, key: string, max = 300): string => {
  const value = body[key];
  return typeof value === "string" ? value.slice(0, max) : "";
};

/**
 * What the form needs in order to render: the vehicle types the company offers, and a token that
 * proves the form was actually opened. No record, no count, no prices.
 */
export async function GET(request: Request) {
  const throttle = take(`enquiry-open:${clientKey(request)}`, 60, WINDOW_MS);
  if (!throttle.allowed) {
    return json(429, { ok: false, message: "Too many requests. Try again shortly.", retryAfterSeconds: throttle.retryAfterSeconds });
  }
  const row = await db().selectFrom("app_settings").select("data").executeTakeFirst();
  const settings = (row?.data ?? null) as Settings | null;
  const categories = (settings?.vehicleCategories ?? []).map((category) => ({ id: category.id, name: category.name }));
  return json(200, {
    ok: true,
    token: issueEnquiryToken(),
    categories,
    // Shown next to the form so a caller knows whether to bother filling it in.
    open: categories.length > 0,
  });
}

export async function POST(request: Request) {
  const body = await readObject(request);
  if (!body) return json(400, { ok: false, message: "Malformed request.", errors: {} });

  // A honeypot field that no person sees and no browser autofills. A submission that fills it is
  // answered as if it had worked, so a bot has no signal to tune against, and nothing is written.
  if (text(body, "website", 500).trim()) {
    return json(200, { ok: true, message: "Thank you. The office will be in touch.", reference: null });
  }

  const verdict = verifyEnquiryToken(text(body, "token", 200));
  if (!verdict.ok) return json(400, { ok: false, message: TOKEN_REFUSED, errors: {} });

  const throttle = take(`enquiry:${clientKey(request)}`, LIMIT, WINDOW_MS);
  if (!throttle.allowed) {
    return json(429, {
      ok: false,
      message: "That is a lot of requests from this connection. Please call the office, or try again later.",
      errors: {},
      retryAfterSeconds: throttle.retryAfterSeconds,
    });
  }

  const result = await runCommand(
    {
      type: "submit_enquiry",
      input: {
        customerName: text(body, "customerName", 200),
        customerPhone: text(body, "customerPhone", 60),
        customerEmail: text(body, "customerEmail", 250),
        organization: text(body, "organization", 200),
        purpose: text(body, "purpose", 400),
        pickupLocation: text(body, "pickupLocation", 200),
        dropoffLocation: text(body, "dropoffLocation", 200),
        startDate: text(body, "startDate", 20),
        endDate: text(body, "endDate", 20),
        passengers: text(body, "passengers", 10),
        vehicleCategoryId: text(body, "vehicleCategoryId", 100),
        notes: text(body, "notes", 1200),
      },
    },
    // Explicitly anonymous: `undefined` would mean "read the cookie", which would let a signed-in
    // browser's enquiry be attributed to a member of staff.
    { userId: null },
  );

  if (!result.ok) return json(result.status, { ok: false, message: result.message, errors: result.errors });

  // The reference is read back from the message the service composed, so the route has no reason to
  // reach into the database it has just been handed — and cannot be tempted to return any of it.
  const reference = /RR-\d+/.exec(result.message)?.[0] ?? null;
  return json(200, { ok: true, message: result.message, reference });
}

// Nothing about this route is cacheable, including its failures.
export const revalidate = 0;
