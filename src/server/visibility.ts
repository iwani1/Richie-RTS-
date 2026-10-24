// What a signed-in account is allowed to read.
//
// Authorisation used to stop at the write path: every command was checked against the actor's role
// and refused by the database when a constraint said no, but both snapshot endpoints returned the
// whole dataset to anyone with a cookie. Own-record scope existed only in the browser
// (`src/tms/scope.ts`), where the caller already holds the payload, so it was a display choice and
// not a control (audit F-01).
//
// This module applies that scope on the server, once, to the thing that actually leaves the process:
//   - internal roles (administrator, operations, finance) read company-wide, as before;
//   - a driver reads their own driver record, the trips assigned to them and the vehicles those
//     trips used;
//   - a client contact reads their own client, its routes, roster and rental requests;
//   - a record-bound account with no linked record reads nothing. It does not fall back to
//     company-wide access.
//
// The audit log is not sent to record-bound roles at all: its summaries name other people's records.
//
// The response is also bounded. The audit log is append-only and grows without limit, and the audit
// screen renders the most recent 500 matches, so sending 5 000 was paying for rows the browser
// discards. The full count travels separately as `auditTotal`, so the screen can still say how many
// there are without carrying them.
import { scopedView } from "../tms/scope";
import type { Actor } from "../tms/service";
import type { Database } from "../tms/types";
import { redact } from "./snapshot";

/** How many audit rows travel with a snapshot. The screen shows at most this many. */
export const SNAPSHOT_AUDIT_LIMIT = 500;

export interface VisibleSnapshot {
  /** The database as this actor may see it, credentials removed. Null when nobody is signed in. */
  database: Database | null;
  /** How many audit entries exist, independent of how many were sent. */
  auditTotal: number;
}

/** The database narrowed to what `actor` may read, credentials removed. */
export function scopeDatabase(database: Database, actor: Actor | null): Database | null {
  if (!actor) return null;

  const view = scopedView(database, actor);
  const { link } = view;
  let visible: Database = database;

  if (link.bound) {
    const vehicleIds = new Set(view.vehicles.map((vehicle) => vehicle.id));
    visible = {
      ...database,
      // The account's own row, and only when it still exists and is the row being viewed.
      users: link.user ? [link.user] : [],
      drivers: link.driver ? [link.driver] : [],
      clients: link.client ? [link.client] : [],
      trips: view.trips,
      incidents: view.incidents,
      routes: view.routes,
      passengers: view.passengers,
      rentals: view.rentals,
      vehicles: view.vehicles,
      workOrders: view.workOrders,
      documents: view.documents,
      odometerReadings: database.odometerReadings.filter((reading) => vehicleIds.has(reading.vehicleId)),
      // Record-bound roles have no audit: the summaries name records that are not theirs.
      audit: [],
    };
  }

  // Credentials are removed last, so no branch above can accidentally reintroduce one.
  return { ...redact(visible), audit: visible.audit.slice(0, SNAPSHOT_AUDIT_LIMIT) };
}

/** The snapshot response body for `actor`, together with the true audit count. */
export function visibleSnapshot(database: Database, actor: Actor | null): VisibleSnapshot {
  return {
    database: scopeDatabase(database, actor),
    auditTotal: actor ? database.audit.length : 0,
  };
}
