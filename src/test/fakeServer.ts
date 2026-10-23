// A stand-in for the API, for UI tests.
//
// The UI no longer owns a database: it fetches a redacted snapshot and posts commands. So the
// tests supply the other half of that contract here, in memory, using the same pure domain layer
// the real server uses. That keeps the 114 behavioural tests meaningful (they still drive real
// components and real commands) while proving the UI works against a request/response boundary
// instead of a localStorage write.
//
// What this deliberately does NOT do: enforce SQL constraints. Those are proven against a real
// PostgreSQL in the integration suite (src/server/*.integration.test.ts).
import { vi } from "vitest";
import { executeCommand, type AnyCommand } from "../tms/commands";
import type { Actor } from "../tms/service";
import { emptyDatabase, type Database, type User } from "../tms/types";

const NOW = () => new Date().toISOString();

interface FakeRecord {
  database: Database;
  userId: string | null;
  passwords: Map<string, string>;
}

const servers: FakeRecord[] = [];

function redact(database: Database): Database {
  return { ...database, users: database.users.map((user) => ({ ...user, passwordHash: "", passwordSalt: "" })) };
}

function actorOf(user: User | undefined | null): Actor | null {
  return user && user.active ? { id: user.id, fullName: user.fullName, role: user.role } : null;
}

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const fakeCredential = () => ({ passwordHash: "f".repeat(64), passwordSalt: "a".repeat(32) });

function handle(record: FakeRecord, url: string, method: string, body: Record<string, unknown>): Response {
  const { database } = record;

  if (url.endsWith("/api/session") && method === "GET") {
    const user = database.users.find((candidate) => candidate.id === record.userId) ?? null;
    return json(200, {
      ok: true,
      setupRequired: database.users.length === 0,
      user: user ? { ...user, passwordHash: "", passwordSalt: "" } : null,
      database: actorOf(user) ? redact(database) : null,
    });
  }

  if (url.endsWith("/api/setup") && method === "POST") {
    if (database.users.length > 0) return json(409, { ok: false, message: "Setup has already been completed. Sign in instead." });
    const result = executeCommand(
      database,
      null,
      { type: "setup_administrator", input: { fullName: String(body.fullName), email: String(body.email) }, credential: fakeCredential() },
      NOW(),
    );
    if (!result.ok) return json(400, { ok: false, message: result.message, errors: result.errors });
    record.database = result.db;
    const admin = result.db.users[0];
    record.userId = admin.id;
    record.passwords.set(admin.id, String(body.password));
    return json(201, {
      ok: true,
      message: result.message,
      setupRequired: false,
      user: { ...admin, passwordHash: "", passwordSalt: "" },
      database: redact(result.db),
    });
  }

  if (url.endsWith("/api/auth/login") && method === "POST") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const user = database.users.find((candidate) => candidate.email.toLowerCase() === email && candidate.active);
    if (!user || record.passwords.get(user.id) !== String(body.password)) {
      return json(401, { ok: false, message: "Incorrect email or password." });
    }
    record.userId = user.id;
    const recorded = executeCommand(database, actorOf(user), { type: "record_sign_in" }, NOW());
    if (recorded.ok) record.database = recorded.db;
    return json(200, {
      ok: true,
      message: "Signed in.",
      setupRequired: false,
      user: { ...user, passwordHash: "", passwordSalt: "" },
      database: redact(record.database),
    });
  }

  if (url.endsWith("/api/auth/logout") && method === "POST") {
    record.userId = null;
    return json(200, { ok: true, message: "Signed out." });
  }

  if (url.endsWith("/api/commands") && method === "POST") {
    const actor = actorOf(record.database.users.find((candidate) => candidate.id === record.userId) ?? null);
    if (!actor) return json(401, { ok: false, message: "Sign in is required." });
    const type = String(body.type ?? "");
    if (type === "import_backup" || type === "setup_administrator") return json(400, { ok: false, message: "Unknown command." });
    let command = body as unknown as AnyCommand;
    if (type === "create_user" || type === "reset_user_password") {
      const { password, ...rest } = body;
      command = { ...rest, credential: fakeCredential() } as unknown as AnyCommand;
      void password;
    }
    const result = executeCommand(record.database, actor, command, NOW());
    if (!result.ok) return json(400, { ok: false, message: result.message, errors: result.errors });
    record.database = result.db;
    return json(200, { ok: true, message: result.message, database: redact(result.db) });
  }

  return json(404, { ok: false, message: `No route for ${method} ${url}` });
}

/**
 * Installs a fake API for the current test and returns handles to inspect it.
 * Call in `beforeEach`, after seeding (or pass the seeded database).
 */
export function installFakeServer(database: Database = emptyDatabase(), userId: string | null = null) {
  const record: FakeRecord = { database, userId, passwords: new Map() };
  servers.push(record);

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    return handle(record, url, method, body);
  };

  vi.stubGlobal("fetch", vi.fn(impl));
  return {
    /** The server's current database, as the domain layer sees it. */
    db: () => record.database,
    /** Replace the server-side data (used after seeding with the pure domain layer). */
    setDatabase: (next: Database) => {
      record.database = next;
    },
    setUser: (id: string | null) => {
      record.userId = id;
    },
    /** Register a password so a UI sign-in test can succeed. */
    setPassword: (id: string, password: string) => {
      record.passwords.set(id, password);
    },
  };
}

export function resetFakeServers() {
  servers.length = 0;
}
