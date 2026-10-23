// What the browser is allowed to see.
//
// The prototype kept the whole database in localStorage, password hashes included — an audit
// finding in its own right (audit/H-02). The server owns the database now and the browser gets
// this redacted projection: every record, but credentials blank. Nothing on the client can
// therefore verify, reproduce or replay a password, and an exported file cannot leak one.
import type { Database, User } from "../tms/types";

/** A user record as the browser receives it: no credential material at all. */
export function redactUser(user: User): User {
  return { ...user, passwordHash: "", passwordSalt: "" };
}

export function redact(database: Database): Database {
  return { ...database, users: database.users.map(redactUser) };
}

export interface SnapshotResponse {
  /** The redacted database; null when nobody is signed in. */
  database: Database | null;
  /** True while no administrator exists, which is the only state that unlocks setup. */
  setupRequired: boolean;
  user: User | null;
}
