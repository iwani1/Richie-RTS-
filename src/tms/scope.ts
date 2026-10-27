// Own-record access scope.
//
// Internal staff (administrator, operations, finance) work company-wide. Record-bound
// roles work against the single record their account is linked to:
//   driver        -> its driver record, and therefore the trips/vehicles assigned to it
//   client_contact -> its corporate client, and therefore that client's routes, roster,
//                     rental requests, agreements, and the billing on its own invoices
//                     (CLI-03, D-114)
//   passenger     -> its own rider record, the route it travels on and the runs that carry
//                     it, and the seats it holds (PAX-01, D-97)
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
  Booking,
  BusRoute,
  Client,
  ComplianceDocument,
  Contract,
  CreditNote,
  Database,
  Driver,
  Incident,
  Invoice,
  Passenger,
  Payment,
  Refund,
  Rental,
  Trip,
  User,
  Vehicle,
} from "./types";

export interface ActorLink {
  user: User | null;
  driver: Driver | null;
  client: Client | null;
  passenger: Passenger | null;
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
    passenger: user?.passengerId ? db.passengers.find((p) => p.id === user.passengerId) ?? null : null,
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
 * The billing on one client's own invoices (CLI-03, D-114): the invoice, the money that came in
 * against it, what was credited off it, and what was paid back.
 *
 * The four move together or not at all. A client shown an invoice total without its payments would
 * read a paid bill as money owed; a client shown a balance without its credit notes would read a
 * credited bill as money owed. So the payload carries all four, and the portal states the balance with
 * `invoiceBalance` — the same rule the office's screens and the printed statement use.
 *
 * An invoice is matched on the client it names **or** on the rental it bills, because invoices written
 * before the client was copied onto the document (CUS-01) carry only the rental.
 */
function clientBilling(db: Database, clientId: string) {
  const rentalIds = new Set(db.rentals.filter((rental) => rental.clientId === clientId).map((rental) => rental.id));
  const invoices = db.invoices.filter(
    (invoice) => invoice.clientId === clientId || (invoice.rentalId !== null && rentalIds.has(invoice.rentalId)),
  );
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  return {
    invoices,
    payments: db.payments.filter((payment) => invoiceIds.has(payment.invoiceId)),
    creditNotes: db.creditNotes.filter((note) => invoiceIds.has(note.invoiceId)),
    refunds: db.refunds.filter((refund) => invoiceIds.has(refund.invoiceId)),
  };
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
      bookings: db.bookings,
      contracts: db.contracts,
      invoices: db.invoices,
      payments: db.payments,
      creditNotes: db.creditNotes,
      refunds: db.refunds,
    };
  }

  if (link.driver) {
    const trips = db.trips.filter((t) => t.driverId === link.driver!.id);
    const tripIds = new Set(trips.map((t) => t.id));
    const vehicleIds = new Set(trips.map((t) => t.vehicleId).filter(Boolean) as string[]);
    const routeIds = new Set(trips.map((t) => t.routeId));
    // D-85: a booked rider usually has no route of their own, so "passengers on my routes" would
    // leave the driver with a seat and no name to call. A rider holding a confirmed seat on one of
    // this driver's runs is part of that run's list of people, and nothing else about them is shown.
    // Only a seat that still holds one: a request or a waiting-list place is not a passenger this
    // driver is collecting, and nothing about it belongs in their payload.
    const bookedOnMyRuns = new Set(
      db.bookings
        .filter((booking) => tripIds.has(booking.tripId) && (booking.status === "confirmed" || booking.status === "offered"))
        .map((booking) => booking.passengerId),
    );
    return {
      link,
      trips,
      // A driver reports and follows up incidents only on its own runs or vehicles.
      incidents: db.incidents.filter((i) => (i.tripId !== null && tripIds.has(i.tripId)) || (i.vehicleId !== null && vehicleIds.has(i.vehicleId))),
      routes: db.routes.filter((r) => routeIds.has(r.id)),
      // Roster details are minimised in the portal; only name and pickup stop are shown.
      passengers: db.passengers.filter((p) => (p.routeId !== null && routeIds.has(p.routeId)) || bookedOnMyRuns.has(p.id)),
      rentals: [] as Rental[],
      vehicles: db.vehicles.filter((v) => vehicleIds.has(v.id)),
      workOrders: [],
      // A driver sees compliance documents for its own driver record and for vehicles
      // it has been assigned to (read-only; see documents:read in permissions.ts).
      documents: db.documents.filter(
        (doc) => (doc.ownerType === "driver" && doc.ownerId === link.driver!.id) || (doc.ownerType === "vehicle" && vehicleIds.has(doc.ownerId)),
      ),
      // A driver sees the seats booked on the runs they are driving, so nobody is turned away for a
      // seat the office already sold.
      bookings: db.bookings.filter((booking) => tripIds.has(booking.tripId)),
      // A driver has no business reading what the company agreed to charge a client (D-95).
      contracts: [] as Contract[],
      // D-114: nor what the client was billed. Billing is the customer's own, and the office's
      // commercial terms with them.
      invoices: [] as Invoice[],
      payments: [] as Payment[],
      creditNotes: [] as CreditNote[],
      refunds: [] as Refund[],
    };
  }

  if (link.passenger) {
    const me = link.passenger;
    // The seats this rider holds, on its own route or on another run of the same client.
    const myBookings = db.bookings.filter((booking) => booking.passengerId === me.id);
    const routeIds = new Set<string>(myBookings.map((booking) => booking.routeId));
    if (me.routeId) routeIds.add(me.routeId);
    const trips = db.trips.filter((trip) => routeIds.has(trip.routeId) && (trip.routeId === me.routeId || myBookings.some((booking) => booking.tripId === trip.id)));
    const vehicleIds = new Set(trips.map((trip) => trip.vehicleId).filter(Boolean) as string[]);
    return {
      link,
      // The journeys: the runs on the rider's own route, plus any run a seat was booked on.
      trips,
      // The rider's own feedback, and nothing else in the incident log: an incident names a vehicle,
      // a responder and sometimes another person's accident, so only the ones this account raised
      // travel (D-85's lesson: a collection missing from a bound branch leaks the whole table).
      incidents: db.incidents.filter((incident) => incident.log.some((entry) => entry.actorId === link.user?.id)),
      routes: db.routes.filter((route) => routeIds.has(route.id)),
      // One person in this payload: the rider reading it. No colleague's name, phone or stop.
      passengers: [me],
      rentals: [] as Rental[],
      // Only the vehicles carrying this rider, so the portal can say which bus to look for —
      // registration is on the side of a bus in a yard, not personal data.
      vehicles: db.vehicles.filter((vehicle) => vehicleIds.has(vehicle.id)),
      workOrders: [],
      documents: [] as ComplianceDocument[],
      bookings: myBookings,
      contracts: [] as Contract[],
      // D-114: billing belongs to the customer who was billed, not to the rider on the bus.
      invoices: [] as Invoice[],
      payments: [] as Payment[],
      creditNotes: [] as CreditNote[],
      refunds: [] as Refund[],
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
      bookings: db.bookings.filter((booking) => booking.clientId === link.client!.id),
      // D-95: a client contact sees the agreements that cover its own account — the term, the service
      // and which routes are in scope — which is what its dashboard is for (CLI-03). Nothing about
      // another client's contract can reach it.
      contracts: db.contracts.filter((contract) => contract.clientId === link.client!.id),
      // D-114: its own invoices, and the payments, credit notes and refunds against them. Four
      // collections that must travel together: a total without its payments reads as money owed, and
      // a payment without the credit note beside it reads as a balance that never moved.
      ...clientBilling(db, link.client.id),
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
    bookings: [] as Booking[],
    contracts: [] as Contract[],
    invoices: [] as Invoice[],
    payments: [] as Payment[],
    creditNotes: [] as CreditNote[],
    refunds: [] as Refund[],
  };
}

/** True when the actor may report an incident against this vehicle. */
export function mayReportOnVehicle(db: Database, actor: Actor | null, vehicleId: string): boolean {
  const link = actorLink(db, actor);
  if (!link.bound) return true;
  if (link.driver) return driverVehicleIds(db, link.driver.id).has(vehicleId);
  // A rider does not choose a vehicle: the bus it travelled on is the subject of its report, so the
  // command substitutes the run's vehicle rather than accepting one from the browser.
  if (link.passenger) return db.trips.some((trip) => trip.vehicleId === vehicleId && mayReportOnRun(db, actor, trip.id));
  return false;
}

/**
 * True when this run is one the rider is actually on (PAX-01, D-97): a run of its own route, or a run
 * it holds a live seat on. Anything else is somebody else's journey.
 */
export function mayReportOnRun(db: Database, actor: Actor | null, tripId: string): boolean {
  const link = actorLink(db, actor);
  if (!link.bound) return true;
  if (!link.passenger) return false;
  const trip = db.trips.find((candidate) => candidate.id === tripId);
  if (!trip) return false;
  if (trip.routeId === link.passenger.routeId) return true;
  return db.bookings.some(
    (booking) =>
      booking.tripId === trip.id &&
      booking.passengerId === link.passenger!.id &&
      (booking.status === "confirmed" || booking.status === "offered" || booking.status === "requested" || booking.status === "waitlisted"),
  );
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

/** The rider a passenger account is confined to, or null for every other role (PAX-01, D-97). */
export function confinedPassengerId(db: Database, actor: Actor | null): string | null {
  const link = actorLink(db, actor);
  return link.bound ? link.passenger?.id ?? null : null;
}

/** The client a client_contact account is confined to, or null for internal staff. */
export function confinedClientId(db: Database, actor: Actor | null): string | null {
  const link = actorLink(db, actor);
  return link.bound ? link.client?.id ?? null : null;
}
