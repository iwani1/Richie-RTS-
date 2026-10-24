import { z } from "zod";
import { CROSS_SITE, json, readObject, sameOrigin } from "../../../server/api";
import { runCommand } from "../../../server/commands";
import { WeakPasswordError, hashPassword, verifyPassword } from "../../../server/password";
import { check, clear, recordFailure } from "../../../server/rateLimit";
import { currentUserId, signInAs } from "../../../server/session";
import { redactUser } from "../../../server/snapshot";
import { db } from "../../../server/db";
import { loadDatabase } from "../../../server/repository";

export const dynamic = "force-dynamic";

// AUTH-05. Everything here is about the signed-in account and nothing else: there is no id in the
// request to point somewhere else, so a role with no administrative permission still cannot read or
// write another person's record through this endpoint.

const detailsSchema = z.object({
  action: z.literal("details"),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().min(3).max(254),
});

const passwordSchema = z.object({
  action: z.literal("password"),
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const database = await loadDatabase(db());
  const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
  if (!user) return json(401, { ok: false, message: "Sign in is required." });

  // Login history is this account's own sign-ins, read from the append-only audit table rather than
  // a second event log. Ten is enough to answer "was that me?" without turning the page into a
  // surveillance screen.
  const signIns = await db()
    .selectFrom("audit_entry")
    .select(["at"])
    .where("actor_id", "=", userId)
    .where("action", "=", "auth:sign_in")
    .orderBy("at", "desc")
    .limit(10)
    .execute();

  return json(200, {
    ok: true,
    user: redactUser(user),
    signIns: signIns.map((entry) => ({ at: new Date(entry.at).toISOString() })),
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, CROSS_SITE);

  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const raw = await readObject(request);
  if (!raw) return json(400, { ok: false, message: "Malformed request." });

  if (raw.action === "details") {
    const parsed = detailsSchema.safeParse(raw);
    if (!parsed.success) return json(400, { ok: false, message: "Please correct the highlighted fields." });
    const result = await runCommand(
      { type: "update_profile", input: { fullName: parsed.data.fullName, email: parsed.data.email } },
      { userId },
    );
    if (!result.ok) return json(result.status, { ok: false, message: result.message, errors: result.errors });
    return json(200, { ok: true, message: result.message, user: redactUser(result.database.users.find((u) => u.id === userId)!) });
  }

  if (raw.action === "password") {
    const parsed = passwordSchema.safeParse(raw);
    if (!parsed.success) {
      return json(400, { ok: false, message: "Please correct the highlighted fields.", errors: { password: "Enter your current password and a new one." } });
    }

    // Guessing the current password here would be a second way to attack an account, so it is
    // throttled on the account, exactly like sign-in.
    const throttleKey = `password:${userId}`;
    const limit = check(throttleKey);
    if (!limit.allowed) {
      return Response.json(
        { ok: false, message: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds), "cache-control": "no-store" } },
      );
    }

    const database = await loadDatabase(db());
    const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) return json(401, { ok: false, message: "Sign in is required." });

    const valid = await verifyPassword(parsed.data.currentPassword, user);
    if (!valid) {
      recordFailure(throttleKey);
      return json(400, { ok: false, message: "Please correct the highlighted fields.", errors: { currentPassword: "That is not your current password." } });
    }
    clear(throttleKey);

    let credential: { passwordHash: string; passwordSalt: string };
    try {
      credential = await hashPassword(parsed.data.newPassword);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        return json(400, { ok: false, message: "Please correct the highlighted fields.", errors: { newPassword: error.message } });
      }
      throw error;
    }

    const result = await runCommand({ type: "change_own_password", credential }, { userId });
    if (!result.ok) return json(result.status, { ok: false, message: result.message, errors: result.errors });

    // The session records a digest of the old hash, so the command has just invalidated this cookie
    // too. Re-sealing it keeps the person signed in on the device they changed it from.
    const updated = result.database.users.find((u) => u.id === userId);
    if (updated) await signInAs(updated);
    return json(200, { ok: true, message: result.message });
  }

  return json(400, { ok: false, message: "Unknown profile action." });
}
