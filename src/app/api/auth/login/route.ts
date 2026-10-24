import { NextResponse } from "next/server";
import { z } from "zod";
import { CROSS_SITE, clientKey, json, sameOrigin } from "../../../../server/api";
import { runCommand } from "../../../../server/commands";
import { burnEquivalentWork, verifyPassword } from "../../../../server/password";
import { check, clear, recordFailure } from "../../../../server/rateLimit";
import { signInAs } from "../../../../server/session";
import { visibleSnapshot } from "../../../../server/visibility";
import { db } from "../../../../server/db";
import { loadDatabase } from "../../../../server/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, CROSS_SITE);

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  // The same message for a malformed body, an unknown account and a wrong password: the caller
  // learns nothing about which accounts exist.
  if (!parsed.success) return json(400, { ok: false, message: "Incorrect email or password." });

  const { email, password } = parsed.data;
  // Two buckets, both must allow. The address bucket limits spraying across many accounts; the
  // account bucket cannot be reset from the request, so guessing one account's password is bounded
  // even when the address is forged or every request shares one address (audit F-02).
  // Without a declared proxy there is no address to speak of — every request looks the same — and
  // an address bucket would then lock out the whole installation after one person mistypes. The
  // account bucket is the one that cannot be forged, so it always applies.
  const address = clientKey(request);
  const addressKey = address === "local" ? null : `address:${address}`;
  const accountKey = `account:${email}`;
  const addressLimit = addressKey ? check(addressKey) : { allowed: true, retryAfterSeconds: 0 };
  const accountLimit = check(accountKey);
  if (!addressLimit.allowed || !accountLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts. Try again in a few minutes." },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.max(addressLimit.retryAfterSeconds, accountLimit.retryAfterSeconds)),
          "cache-control": "no-store",
        },
      },
    );
  }

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.active);
  if (!user) {
    // Spend the same time as a real verification so timing does not reveal a missing account.
    await burnEquivalentWork(password);
    recordFailure(accountKey);
    if (addressKey) recordFailure(addressKey);
    return json(401, { ok: false, message: "Incorrect email or password." });
  }
  const valid = await verifyPassword(password, user);
  if (!valid) {
    recordFailure(accountKey);
    if (addressKey) recordFailure(addressKey);
    return json(401, { ok: false, message: "Incorrect email or password." });
  }

  clear(accountKey);
  if (addressKey) clear(addressKey);
  await signInAs(user);
  // Signing in is a business event, so it goes in the audit log through the normal command path.
  const recorded = await runCommand({ type: "record_sign_in" }, { userId: user.id });
  const next = recorded.ok ? recorded.database : database;
  const actor = { id: user.id, fullName: user.fullName, role: user.role };
  const visible = visibleSnapshot(next, actor);
  return json(200, {
    ok: true,
    message: "Signed in.",
    user: { ...user, passwordHash: "", passwordSalt: "" },
    database: visible.database,
    auditTotal: visible.auditTotal,
    setupRequired: false,
  });
}
