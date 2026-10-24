// The server's single write path.
//
// Every mutation runs here, in one transaction, under an advisory lock:
//   1. lock, so two operators cannot interleave read-modify-write on the same snapshot;
//   2. load the snapshot from PostgreSQL;
//   3. resolve the actor from the session cookie — never from the request body;
//   4. run the pure command layer, which authorises, validates, transitions and audits;
//   5. write the difference, which the database re-checks (constraints, exclusion, append-only).
//
// Step 5 is the point: the service layer's checks are a good error message, the constraints are
// the guarantee (brief §5.1, §5.3, §5.7).
import { sql } from "kysely";
import { db } from "./db";
import { loadDatabase, saveDatabase } from "./repository";
import { executeCommand, type AnyCommand } from "../tms/commands";
import type { Actor, CommandResult } from "../tms/service";
import type { Database, User } from "../tms/types";

/** Advisory lock key for the command writer. Any stable bigint works; one app, one writer. */
const WRITE_LOCK = 728411;

export type ServerFailure = {
  ok: false;
  status: number;
  message: string;
  errors: Record<string, string>;
};
export type ServerSuccess = { ok: true; status: number; message: string; database: Database };
export type ServerResult = ServerSuccess | ServerFailure;

export function actorFromUser(user: User | null | undefined): Actor | null {
  if (!user || !user.active) return null;
  return { id: user.id, fullName: user.fullName, role: user.role };
}

export function findActor(database: Database, userId: string | null): { user: User | null; actor: Actor | null } {
  if (!userId) return { user: null, actor: null };
  const user = database.users.find((u) => u.id === userId && u.active) ?? null;
  return { user, actor: actorFromUser(user) };
}

/**
 * What the operator needs to fix a rejected password, and nothing they already know.
 *
 * The credentials at fault are named from DATABASE_URL — user, host, port and database, never the
 * secret itself — because "the password is wrong" does not say *which* of the two places to change.
 * The two causes that actually happen are spelled out: a password that differs between .env and the
 * database, and a password containing a character that has to be percent-encoded inside a URL.
 */
function passwordRejectedMessage(): string {
  let target = "";
  let placeholder = false;
  let placeholderValue = "";
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    // The example value from .env.example. It is not a password the database could have, so say
    // that outright instead of offering the general advice.
    const found = decodeURIComponent(url.password);
    placeholder = /^(change[-_ ]?me|your[-_ ]?password)$/i.test(found);
    if (placeholder) placeholderValue = found;
    const user = decodeURIComponent(url.username);
    if (user) {
      target = ` for user "${user}" at ${url.hostname || "the configured host"}${
        url.port ? `:${url.port}` : ""
      }${url.pathname && url.pathname !== "/" ? ` (database "${url.pathname.slice(1)}")` : ""}`;
    }
  } catch {
    // A malformed URL is reported by the configuration check, not here.
  }
  if (placeholder) {
    return [
      `DATABASE_URL still contains the example password "${placeholderValue}"${target}.`,
      "",
      "The database was created with a different password. Put that one in .env:",
      "  grep '^DATABASE_URL' .env                              # what the app is sending",
      "  podman inspect richie-db --format '{{json .Config.Env}}' # what it was created with",
      "",
      "Or change the database to match .env:",
      `  podman exec -it richie-db psql -U richie -d postgres -c "ALTER USER richie WITH PASSWORD 'new-password';"`,
      "",
      "Then restart the server (Ctrl+C, then npm start); a running process keeps the .env it started with.",
    ].join("\n");
  }
  return [
    `The database rejected the password in DATABASE_URL${target}.`,
    "",
    "Either the password in .env is not the one the database was created with, or it contains a",
    "character that must be percent-encoded inside a URL:",
    "  @ -> %40    : -> %3A    / -> %2F    ? -> %3F    # -> %23    % -> %25",
    "",
    "Set the same password on both sides. For the podman container in the README:",
    '  podman exec -it richie-db psql -U richie -d postgres -c "ALTER USER richie WITH PASSWORD \'new-password\';"',
    "then put that identical password in DATABASE_URL and restart the server (Ctrl+C, then npm start).",
    "",
    "docs/SETUP_AND_DEPLOYMENT.md §5 has the full sequence.",
  ].join("\n");
}

/** Maps a PostgreSQL error to the operator-facing result. Never leaks SQL or internals (§5.10). */
export function describeDatabaseError(error: unknown): ServerFailure {
  const pg = error as { code?: string; constraint?: string; message?: string };
  const conflict = (message: string): ServerFailure => ({ ok: false, status: 409, message, errors: {} });
  switch (pg.code) {
    // Connection-level failures. These are the operator's to fix, so they are reported as a
    // deployment problem (503) with the value at fault, never as "the change could not be saved".
    case "28P01":
      return { ok: false, status: 503, message: passwordRejectedMessage(), errors: {} };
    case "28000":
      return {
        ok: false,
        status: 503,
        message: "The database refused this connection: check the user in DATABASE_URL and pg_hba.conf.",
        errors: {},
      };
    case "3D000":
      return {
        ok: false,
        status: 503,
        message: "The database named in DATABASE_URL does not exist. Create it, then run npm run db:migrate.",
        errors: {},
      };
    case "42P01":
      if (typeof pg.message === "string" && pg.message.includes("schema_migrations")) {
        return { ok: false, status: 503, message: "The schema has not been created. Run: npm run db:migrate", errors: {} };
      }
      return { ok: false, status: 500, message: "The database schema is incomplete. Run: npm run db:migrate", errors: {} };
    case "23P01":
      return conflict("That vehicle or driver already has a booking overlapping those dates.");
    case "23505":
      switch (pg.constraint) {
        case "vehicle_registration_uq":
          return conflict("A vehicle with this registration already exists.");
        case "driver_licence_uq":
          return conflict("A driver with this licence number already exists.");
        case "client_name_uq":
          return conflict("A client with this name already exists.");
        case "app_user_email_key":
          return conflict("A user with this email already exists.");
        case "app_user_driver_uq":
          return conflict("That driver record is already linked to another account.");
        case "app_user_client_uq":
          return conflict("That client already has a contact account.");
        case "trip_route_date_uq":
          return conflict("A trip already exists for this route on that date.");
        case "rental_reference_key":
        case "trip_reference_key":
        case "bus_route_reference_key":
        case "incident_reference_key":
        case "work_order_reference_key":
          return conflict("A record with that reference already exists.");
        default:
          return conflict("That change conflicts with an existing record.");
      }
    case "23503":
      return conflict("A related record is missing or is still in use, so this change was not saved.");
    case "23514":
      return { ok: false, status: 400, message: "A value was rejected by the database (check dates, amounts and counts).", errors: {} };
    case "OD-001":
      return { ok: false, status: 400, message: pg.message ?? "Odometer reading rejected.", errors: { readingKm: "Reading cannot be lower than the last recorded reading." } };
    case "AUD-001":
      return { ok: false, status: 403, message: "The audit log is append-only.", errors: {} };
    default:
      if (typeof pg.message === "string" && pg.message.includes("OD-001")) {
        return { ok: false, status: 400, message: "Reading cannot be lower than the last recorded reading.", errors: { readingKm: "Reading cannot be lower than the last recorded reading." } };
      }
      return { ok: false, status: 500, message: "The change could not be saved. The server log has the detail.", errors: {} };
  }
}

/**
 * Runs one command for the signed-in user and returns the new state, or a failure that the API
 * turns into an HTTP response. Nothing is written unless the whole command succeeds.
 */
export async function runCommand(
  command: AnyCommand,
  options: { userId?: string | null; now?: string } = {},
): Promise<ServerResult> {
  // The actor is taken from the session cookie unless a caller has just established the identity
  // itself (sign-in and first-run setup, where the cookie is being minted in the same response).
  const now = options.now ?? new Date().toISOString();
  try {
    const userId = options.userId === undefined ? await sessionUserId() : options.userId;
    return await db()
      .transaction()
      .execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(${WRITE_LOCK})`.execute(trx);
        const before = await loadDatabase(trx);
        const { actor } = findActor(before, userId);
        const result: CommandResult = executeCommand(before, actor, command, now);
        if (!result.ok) {
          return { ok: false as const, status: statusForFailure(result.message), message: result.message, errors: result.errors };
        }
        await saveDatabase(trx, before, result.db);
        return { ok: true as const, status: 200, message: result.message, database: result.db };
      });
  } catch (error) {
    if (isConfigurationError(error)) {
      // Still the operator's to fix: do not bury it under "the change could not be saved".
      return { ok: false, status: 503, message: error.message.replace(/\n/g, " "), errors: {} };
    }
    if (process.env.NODE_ENV !== "production") {
      // Development only: make constraint failures diagnosable without a debugger.
      console.error("[command]", command.type, error instanceof Error ? error.message : error);
    }
    return describeDatabaseError(error);
  }
}

function statusForFailure(message: string): number {
  if (/sign in is required/i.test(message)) return 401;
  if (/^Not permitted/i.test(message)) return 403;
  return 400;
}

/**
 * The signed-in user's id, resolved lazily. `next/headers` is only importable inside a request,
 * so the import is deferred: CLI scripts and integration tests load this module without a
 * request context, and they never call the paths that need a cookie.
 */
async function sessionUserId(): Promise<string | null> {
  const { currentUserId } = await import("./session");
  return currentUserId();
}

/** Reads the current snapshot for the signed-in user without mutating anything. */
/** A configuration error is the operator's to fix, and is worth showing verbatim. */
function isConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Invalid server configuration");
}

export async function readSnapshot(): Promise<{ ok: true; database: Database; actor: Actor | null } | { ok: false; status: number; message: string }> {
  try {
    // Reading the session needs SESSION_SECRET, so this belongs inside the guard: outside it, a
    // misconfigured deployment threw past the caller and reached the browser as an HTML 500 that
    // the application could only report as "cannot reach the server".
    const userId = await sessionUserId();
    const database = await loadDatabase();
    const { actor } = findActor(database, userId);
    return { ok: true, database, actor };
  } catch (error) {
    if (isConfigurationError(error)) {
      return { ok: false, status: 503, message: error.message.replace(/\n/g, " ") };
    }
    const described = describeDatabaseError(error);
    if (described.status >= 500) {
      // Its own message when it has one (a rejected password, a missing database); the generic
      // "cannot reach the database" only when it does not.
      const generic = "The database is not reachable. Check docs/SETUP_AND_DEPLOYMENT.md §5.";
      return { ok: false, status: 503, message: described.message && described.message !== "The change could not be saved. The server log has the detail." ? described.message : generic };
    }
    return { ok: false, status: described.status, message: described.message };
  }
}
