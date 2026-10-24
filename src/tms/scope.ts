// Own-record access scope.
//
// Internal staff (administrator, operations, finance) work company-wide. Record-bound
// roles work against the single record their account is linked to:
//   driver        -> its driver record, and therefore the trips/vehicles assigned to it
//   client_contact -> its corporate client, and therefore that client's routes, roster
//                     and rental requests
//
// This module is the single definition of that scope, and it is applied twice: on the
// server in `src/server/visibility.ts`, so the payload an account receives already
// excludes what it may not read, and again in the portals, which is why a portal can
// render straight from `scopedView()` without its own filtering. The server-side call is
// the control; the client-side one is what keeps the two views in step.
// Writes are checked separately in the service layer and are testable end to end.

import { isRecordBound } from "./permissions";
import type { Actor } from "./service";
import type {
  BusRoute,
  Client,
  ComplianceDocument,
  Database,
  Driver,
  Incident,
  Passenger,
  Rental,
  Trip,
  User,
  Vehicle,
} from "./types";

export interface ActorLink {
  user: User | null;
  driver: Driver | null;
  client: Client | null;
  bound: boolean;
}

/** Resolves which domain record the signed-in account acts for. */
export function actorLink(db: Database, actor: Actor | null): ActorLink {
  const user = actor ? db.users.find((u) => u.id === actor.id) ?? null : null;
  // Scope is taken from the role on the actor, not from the looked-up user row, so an
  // actor whose row cannot be found is still confined. This fails closed: a record-bound
  // role with no linked record sees nothing (see the empty branch in scopedView).
  const bound = actor ? isRecordBound(actor.role) : false;
  return {
    user,
    driver: user?.driverId ? db.drivers.find((d) => d.id === user.driverId) ?? null : null,
    client: user?.clientId ? db.clients.find((c) => c.id === user.clientId) ?? null : null,
    bound,
  };
}

/** The set of vehicles a driver has been assigned to on any trip. */
export function driverVehicleIds(db: Database, driverId: string): Set<string> {
  return new Set(db.trips.filter((t) => t.driverId === driverId).map((t) => t.vehicleId).filter(Boolean) as string[]);
}

export function driverTripIds(db: Database, driverId: string): Set<string> {
  return new Set(db.trips.filter((t) => t.driverId === driverId).map((t) => t.id));
}

/**
 * Returns only the records this actor may see. For internal roles this is the whole
 * database slice; for record-bound roles it is their own records and what hangs off them.
 */
export function scopedView(db: Database, actor: Actor | null) {
  const link = actorLink(db, actor);

  if (!link.bound || !link.user) {
    return {
      link,
      trips: db.trips,
      incidents: db.incidents,
      routes: db.routes,
      passengers: db.passengers,
      rentals: db.rentals,
      vehicles: db.vehicles,
      workOrders: db.workOrders,
      documents: db.documents,
    };
  }

  if (link.driver) {
    const trips = db.trips.filter((t) => t.driverId === link.driver!.id);
    const tripIds = new Set(trips.map((t) => t.id));
    const vehicleIds = new Set(trips.map((t) => t.vehicleId).filter(Boolean) as string[]);
    const routeIds = new Set(trips.map((t) => t.routeId));
    return {
      link,
      trips,
      // A driver reports and follows up incidents only on its own runs or vehicles.
      incidents: db.incidents.filter((i) => (i.tripId !== null && tripIds.has(i.tripId)) || (i.vehicleId !== null && vehicleIds.has(i.vehicleId))),
      routes: db.routes.filter((r) => routeIds.has(r.id)),
      // Roster details are minimised in the portal; only name and pickup stop are shown.
      passengers: db.passengers.filter((p) => p.routeId !== null && routeIds.has(p.routeId)),
      rentals: [] as Rental[],
      vehicles: db.vehicles.filter((v) => vehicleIds.has(v.id)),
      workOrders: [],
      // A driver sees compliance documents for its own driver record and for vehicles
      // it has been assigned to (read-only; see documents:read in permissions.ts).
      documents: db.documents.filter(
        (doc) => (doc.ownerType === "driver" && doc.ownerId === link.driver!.id) || (doc.ownerType === "vehicle" && vehicleIds.has(doc.ownerId)),
      ),
    };
  }

  if (link.client) {
    const routes = db.routes.filter((r) => r.clientId === link.client!.id);
    const routeIds = new Set(routes.map((r) => r.id));
    return {
      link,
      // A client sees the trips run for its own routes and nothing else.
      trips: db.trips.filter((t) => routeIds.has(t.routeId)),
      incidents: [] as Incident[],
      routes,
      passengers: db.passengers.filter((p) => p.clientId === link.client!.id),
      rentals: db.rentals.filter((r) => r.clientId === link.client!.id),
      vehicles: [] as Vehicle[],
      workOrders: [],
      // A client contact has no compliance-document access; those concern the fleet.
      documents: [] as ComplianceDocument[],
    };
  }

  // A record-bound account with no linked record sees nothing. This is deliberate:
  // an unlinked account must not fall back to company-wide access.
  return {
    link,
    trips: [] as Trip[],
    incidents: [] as Incident[],
    routes: [] as BusRoute[],
    passengers: [] as Passenger[],
    rentals: [] as Rental[],
    vehicles: [] as Vehicle[],
    workOrders: [],
    documents: [] as ComplianceDocument[],
  };
}

/** True when the actor may report an incident against this vehicle. */
export function mayReportOnVehicle(db: Database, actor: Actor | null, vehicleId: string): boolean {
  const link = actorLink(db, actor);
  if (!link.bound) return true;
  if (link.driver) return driverVehicleIds(db, link.driver.id).has(vehicleId);
  return false;
}

/**
 * True when the actor may act on this trip. Internal staff act company-wide; a driver
 * only on the trip assigned to its linked driver record.
 */
export function mayActOnTrip(db: Database, actor: Actor | null, tripId: string): boolean {
  const link = actorLink(db, actor);
  if (!link.bound) return true;
  if (!link.driver) return false;
  return db.trips.some((t) => t.id === tripId && t.driverId === link.driver!.id);
}

/** The client a client_contact account is confined to, or null for internal staff. */
export function confinedClientId(db: Database, actor: Actor | null): string | null {
  const link = actorLink(db, actor);
  return link.bound ? link.client?.id ?? null : null;
}
