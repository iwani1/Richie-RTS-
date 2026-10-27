import { z } from "zod";
import { CROSS_SITE, json, sameOrigin } from "../../../server/api";
import { runCommand } from "../../../server/commands";
import { WeakPasswordError, hashPassword } from "../../../server/password";
import { currentUserId } from "../../../server/session";
import { visibleSnapshot } from "../../../server/visibility";
import { KNOWN_COMMAND_TYPES } from "../../../tms/commandTypes";
import { can } from "../../../tms/permissions";
import { db } from "../../../server/db";
import { findActor } from "../../../server/commands";
import { loadDatabase } from "../../../server/repository";

export const dynamic = "force-dynamic";

// One endpoint for every state change. The browser sends a command *intent*; the server decides
// whether it is allowed, validates it, applies it in a transaction and returns the new redacted
// snapshot. The client no longer holds a database it can mutate, which is the whole point of the
// rebuild (brief §5.1, §5.3, §5.10).
// The list of commands the browser may send lives in `src/tms/commandTypes.ts`, where a test can
// compare it against every module's command types. It used to live here and had silently lost three
// commands (D-89).
const COMMAND_TYPES = new Set<string>(KNOWN_COMMAND_TYPES);
const PASSWORD_TYPES = new Set(["create_user", "reset_user_password"]);

// `setup_administrator` is deliberately absent: it is only reachable from /api/setup, which
// refuses once an account exists. `import_backup` is absent too — a client-supplied database
// would let any signed-in user overwrite every table and every credential, so restore is a
// server-side operation (scripts/restore.ts) documented in docs/SETUP_AND_DEPLOYMENT.md.

const envelope = z.object({
  type: z.string().min(1).max(64),
  password: z.string().min(1).max(1024).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  id: z.string().min(1).max(64).optional(),
  reason: z.string().max(2000).optional(),
  // A note the customer attached to an acceptance (D-116). Optional, and never required: a yes is a
  // yes with or without a sentence beside it.
  note: z.string().max(1000).optional(),
  // The odometer read out when a hire starts (RNT-07, D-118). Optional: many hires have none.
  odometerKm: z.string().max(20).optional(),
  to: z.string().max(40).optional(),
  routeId: z.string().max(64).optional(),
  fromDate: z.string().max(40).optional(),
  toDate: z.string().max(40).optional(),
  costId: z.string().max(64).optional(),
  kind: z.enum(["vehicles", "drivers", "clients"]).optional(),
  csv: z.string().max(200_000).optional(),
});

// Which permission each command needs at the boundary. The service layer checks again with the
// real actor; this table exists so an unauthenticated or obviously unpermitted call is rejected
// before a transaction opens, and so the mapping is visible in one place (docs/PERMISSIONS.md).
const PERMISSION_FOR: Record<string, Parameters<typeof can>[1]> = {
  update_settings: "settings:update",
  issue_rental_invoice: "invoices:issue",
  void_invoice: "invoices:void",
  issue_credit_note: "credits:issue",
  void_credit_note: "credits:void",
  record_payment: "payments:record",
  advance_payment: "payments:advance",
  void_payment: "payments:void",
  record_refund: "refunds:record",
  void_refund: "refunds:void",
  record_expense: "expenses:record",
  void_expense: "expenses:void",
  create_contract: "contracts:create",
  update_contract: "contracts:update",
  advance_contract: "contracts:advance",
  create_user: "users:create",
  update_user: "users:update",
  reset_user_password: "users:update",
  record_backup_export: "backup:export",
};

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json(403, CROSS_SITE);

  const userId = await currentUserId();
  if (!userId) return json(401, { ok: false, message: "Sign in is required." });

  const parsed = envelope.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { ok: false, message: "Malformed command." });
  const body = parsed.data;
  if (!COMMAND_TYPES.has(body.type)) return json(400, { ok: false, message: "Unknown command." });

  // Permission pre-check against the current role. The actor is re-resolved inside runCommand, so
  // a role changed mid-request still cannot get an unauthorised write through.
  if (body.type in PERMISSION_FOR) {
    const database = await loadDatabase(db());
    const user = database.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) return json(401, { ok: false, message: "Sign in is required." });
    if (!can(user.role, PERMISSION_FOR[body.type])) {
      return json(403, { ok: false, message: "Not permitted." });
    }
  }

  // Credentials are minted here, never accepted from the browser. A client that sends a
  // `passwordHash` of its own choosing is ignored: the field is not part of the envelope.
  let credential: { passwordHash: string; passwordSalt: string } | undefined;
  if (PASSWORD_TYPES.has(body.type)) {
    if (!body.password) return json(400, { ok: false, message: "A password is required.", errors: { password: "Enter a password." } });
    try {
      credential = await hashPassword(body.password);
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        return json(400, { ok: false, message: "Please correct the highlighted fields.", errors: { password: error.message } });
      }
      throw error;
    }
  }

  const { password: _password, ...rest } = body;
  const command = (credential ? { ...rest, credential } : rest) as unknown as Parameters<typeof runCommand>[0];
  const result = await runCommand(command, { userId });
  if (!result.ok) return json(result.status, { ok: false, message: result.message, errors: result.errors });
  // The same scope as the read endpoint: what a command returns must never be more than what the
  // account may see (audit F-01).
  const { actor } = findActor(result.database, userId);
  const visible = visibleSnapshot(result.database, actor);
  return json(200, {
    ok: true,
    message: result.message,
    database: visible.database,
    auditTotal: visible.auditTotal,
  });
}
