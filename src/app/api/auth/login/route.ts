import { NextResponse } from "next/server";
import { z } from "zod";
import { clientKey, json } from "../../../../server/api";
import { runCommand } from "../../../../server/commands";
import { burnEquivalentWork, verifyPassword } from "../../../../server/password";
import { clear, attempt } from "../../../../server/rateLimit";
import { signInAs } from "../../../../server/session";
import { redact } from "../../../../server/snapshot";
import { db } from "../../../../server/db";
import { loadDatabase } from "../../../../server/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  // The same message for a malformed body, an unknown account and a wrong password: the caller
  // learns nothing about which accounts exist.
  if (!parsed.success) return json(400, { ok: false, message: "Incorrect email or password." });

  const { email, password } = parsed.data;
  const key = `${clientKey(request)}:${email}`;
  const throttle = attempt(key);
  if (!throttle.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many attempts. Try again in a few minutes." },
      { status: 429, headers: { "retry-after": String(throttle.retryAfterSeconds), "cache-control": "no-store" } },
    );
  }

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.active);
  if (!user) {
    // Spend the same time as a real verification so timing does not reveal a missing account.
    await burnEquivalentWork(password);
    return json(401, { ok: false, message: "Incorrect email or password." });
  }
  const valid = await verifyPassword(password, user);
  if (!valid) return json(401, { ok: false, message: "Incorrect email or password." });

  clear(key);
  await signInAs(user.id);
  // Signing in is a business event, so it goes in the audit log through the normal command path.
  const recorded = await runCommand({ type: "record_sign_in" }, { userId: user.id });
  const next = recorded.ok ? recorded.database : database;
  return json(200, {
    ok: true,
    message: "Signed in.",
    user: { ...user, passwordHash: "", passwordSalt: "" },
    database: redact(next),
    setupRequired: false,
  });
}
