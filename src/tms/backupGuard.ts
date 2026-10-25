// Strict validation for an imported backup.
//
// `migrate()` only checks that a backup is *broadly* the right shape: a known schema
// version, a few arrays, a settings object. Everything else is cast. A backup file is
// untrusted input — it can arrive from another deployment, a USB stick or an email — and
// every record in it is trusted by the app afterwards, so the records that the code actually
// depends on are checked here before they reach the database.
//
// Rejections are collected rather than thrown so the operator is told what is wrong with the
// file instead of getting a white screen.

import { migrate, ROLES, type Database } from "./types";

export interface BackupProblem {
  path: string;
  message: string;
}

// A backup larger than this is not a backup of this application. The cap also stops a
// crafted file from exhausting memory before any check runs.
const MAX_RECORDS = 100_000;

const PASSWORD_HASH_RE = /^[0-9a-f]{64}$/;
const PASSWORD_SALT_RE = /^[0-9a-f]{32}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown, max = 500): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

const isOptionalId = (value: unknown): boolean => value === null || value === undefined || isText(value, 100);

/**
 * Validates an untrusted backup file. Returns the migrated database when it is safe to load,
 * or null plus a list of problems when it is not.
 */
export function inspectBackup(value: unknown): { database: Database | null; problems: BackupProblem[] } {
  const problems: BackupProblem[] = [];
  const database = migrate(value);
  if (!database) {
    return { database: null, problems: [{ path: "(root)", message: "Not a Richie TMS backup this build can read (schema version 1-14)." }] };
  }

  const fail = (path: string, message: string) => {
    // Keep the report readable: a corrupt file can repeat one fault hundreds of times.
    if (problems.length < 50) problems.push({ path, message });
  };

  const collection = (key: keyof Database) => {
    const rows = database[key];
    if (!Array.isArray(rows)) {
      fail(String(key), "Expected a list.");
      return [] as unknown[];
    }
    if (rows.length > MAX_RECORDS) fail(String(key), `Too many records (${rows.length}); the limit is ${MAX_RECORDS}.`);
    return rows as unknown[];
  };

  for (const key of ["vehicles", "drivers", "clients", "rentals", "routes", "passengers", "trips", "incidents", "workOrders", "documents", "odometerReadings", "audit"] as const) {
    collection(key).forEach((row, i) => {
      if (!isRecord(row)) fail(`${key}[${i}]`, "Expected a record.");
      else if (!isText(row.id, 100)) fail(`${key}[${i}].id`, "Missing record id.");
    });
  }

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  collection("users").forEach((row, i) => {
    const path = `users[${i}]`;
    if (!isRecord(row)) return fail(path, "Expected a record.");
    if (!isText(row.id, 100)) return fail(`${path}.id`, "Missing record id.");
    if (seenIds.has(row.id)) return fail(`${path}.id`, "Duplicate user id.");
    seenIds.add(row.id);
    if (!isText(row.fullName)) fail(`${path}.fullName`, "Missing full name.");
    if (!isText(row.email)) fail(`${path}.email`, "Missing email.");
    else if (seenEmails.has(row.email)) fail(`${path}.email`, "Duplicate email.");
    else seenEmails.add(row.email);
    // Roles are looked up in the permission matrix, so an unknown value would make every
    // permission check throw. This is the check that a crafted backup used to bypass.
    if (!ROLES.includes(row.role as never)) fail(`${path}.role`, `Unknown role "${String(row.role)}".`);
    if (typeof row.active !== "boolean") fail(`${path}.active`, "Active must be true or false.");
    if (typeof row.passwordHash !== "string" || !PASSWORD_HASH_RE.test(row.passwordHash)) fail(`${path}.passwordHash`, "Not a PBKDF2-SHA256 digest.");
    if (typeof row.passwordSalt !== "string" || !PASSWORD_SALT_RE.test(row.passwordSalt)) fail(`${path}.passwordSalt`, "Not a 16-byte salt.");
    if (!isOptionalId(row.driverId)) fail(`${path}.driverId`, "Driver link must be an id or null.");
    if (!isOptionalId(row.clientId)) fail(`${path}.clientId`, "Client link must be an id or null.");
    if (row.role === "driver" && !row.driverId) fail(`${path}.driverId`, "A driver account must be linked to a driver record.");
    if (row.role === "client_contact" && !row.clientId) fail(`${path}.clientId`, "A client contact must be linked to a client record.");
  });

  const settings = database.settings;
  if (!isRecord(settings)) fail("settings", "Expected an object.");
  else {
    for (const key of ["vehicleCategories", "shifts", "documentTypes"] as const) {
      if (!Array.isArray(settings[key])) fail(`settings.${key}`, "Expected a list.");
    }
    if (!isRecord(settings.rental)) fail("settings.rental", "Expected an object.");
    if (!isRecord(settings.maintenance)) fail("settings.maintenance", "Expected an object.");
  }

  return { database: problems.length ? null : database, problems };
}

/** One-line summary for the failure message shown to the operator. */
export function describeProblems(problems: BackupProblem[]): string {
  const shown = problems.slice(0, 3).map((p) => `${p.path}: ${p.message}`);
  const rest = problems.length > shown.length ? ` (+${problems.length - shown.length} more)` : "";
  return `${shown.join(" ")}${rest}`;
}
