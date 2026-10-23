import { z } from "zod";
import { clientKey, json } from "../../../server/api";
import { runCommand } from "../../../server/commands";
import { WeakPasswordError, hashPassword } from "../../../server/password";
import { attempt } from "../../../server/rateLimit";
import { signInAs } from "../../../server/session";
import { redact } from "../../../server/snapshot";
import { db } from "../../../server/db";
import { loadDatabase } from "../../../server/repository";

export const dynamic = "force-dynamic";

// First run only. The `setup_administrator` command itself refuses once any user exists, so this
// endpoint is not the security boundary — the service layer is, and the database refuses a second
// account for the same record as well.
const bodySchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const throttle = attempt(`setup:${clientKey(request)}`);
  if (!throttle.allowed) return json(429, { ok: false, message: "Too many attempts. Try again later." });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string") errors[field] ??= issue.message;
    }
    return json(400, { ok: false, message: "Please correct the highlighted fields.", errors });
  }

  const current = await loadDatabase(db());
  if (current.users.length > 0) {
    return json(409, { ok: false, message: "Setup has already been completed. Sign in instead." });
  }

  let credential;
  try {
    credential = await hashPassword(parsed.data.password);
  } catch (error) {
    if (error instanceof WeakPasswordError) {
      return json(400, { ok: false, message: "Please correct the highlighted fields.", errors: { password: error.message } });
    }
    throw error;
  }

  const result = await runCommand(
    {
      type: "setup_administrator",
      input: { fullName: parsed.data.fullName, email: parsed.data.email },
      credential,
    },
    { userId: null },
  );
  if (!result.ok) return json(result.status, { ok: false, message: result.message, errors: result.errors });

  const admin = result.database.users.find((user) => user.email.toLowerCase() === parsed.data.email);
  if (!admin) return json(500, { ok: false, message: "The administrator account could not be read back." });
  await signInAs(admin.id);
  return json(201, {
    ok: true,
    message: "Administrator account created.",
    user: { ...admin, passwordHash: "", passwordSalt: "" },
    database: redact(result.database),
    setupRequired: false,
  });
}
