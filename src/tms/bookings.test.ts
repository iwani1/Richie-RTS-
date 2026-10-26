// Bookings (BKG-01..06, D-83).
//
// The properties under test are the ones the brief names: a unique reference per booking, a rider
// who is not already sitting on the roster, a capacity check that counts roster + bookings, a
// waiting list that is *offered* a freed seat and never auto-confirmed, cancellation with a reason
// and a cut-off, and a history of what changed.
import { describe, expect, it } from "vitest";
import { capacityOf, manifestAtStop, manifestFor, seatsHeld } from "./bookings";
import { executeCommand, type AnyCommand } from "./commands";
import { execute, type Actor, type CommandResult, type Credential } from "./service";
import type { RouteInput } from "./busing";
import { emptyDatabase, emptyRentalSettings, type Database, type Trip, type User } from "./types";

const NOW = "2026-06-01T05:00:00.000Z"; // one hour before the 06:00 departure
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  finance: Actor;
  routeId: string;
  clientId: string;
  tripId: string;
  /** Riders on the route's roster: they already hold a seat and cannot book one. */
  rosterIds: string[];
  /** A visitor with no route of their own. */
  visitorId: string;
  /** A visitor belonging to the other client. */
  strangerId: string;
}

const actorOf = (db: Database, role: Actor["role"]): Actor => {
  const user = db.users.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`missing ${role} user`);
  return { id: user.id, fullName: user.fullName, role: user.role };
};

const errorsOf = (result: CommandResult) => (result.ok ? {} : result.errors);

/** Apply a command that is expected to succeed; returns the new database. */
function run(db: Database, actor: Actor, command: AnyCommand, now = NOW): Database {
  const result = executeCommand(db, actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}

function attempt(db: Database, actor: Actor, command: AnyCommand, now = NOW) {
  return executeCommand(db, actor, command, now);
}

function build(options: { seats?: string; rosterSize?: number } = {}): World {
  let db = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin = actorOf(db, "administrator");
  for (const [fullName, role] of [["Ops", "operations"], ["Fin", "finance"]] as const) {
    db = run(db, admin, { type: "create_user", input: { fullName, email: `${role}@example.test`, role, active: true }, credential: cred });
  }
  const ops = actorOf(db, "operations");
  const finance = actorOf(db, "finance");

  db = run(db, admin, {
    type: "update_settings",
    input: {
      companyName: "Richie Transport Services",
      currencyCode: "GHS",
      onTimeThresholdMinutes: 5,
      vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
      shifts: [],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: null,
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      workTypes: ["Service"],
      costCategories: ["Parts"],
      maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;

  db = run(db, ops, { type: "create_vehicle", input: { registration: "GT 900-26", categoryId, make: "", model: "", seatCapacity: options.seats ?? "4", notes: "" } });
  db = run(db, ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  db = run(db, finance, { type: "create_client", input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  db = run(db, finance, { type: "create_client", input: { name: "Beta Foods", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const clientId = db.clients[0].id;
  const otherClientId = db.clients[1].id;

  const routeInput = (name: string, client: string): RouteInput => ({
    name,
    clientId: client,
    direction: "to_work",
    shiftId: "",
    vehicleCategoryId: categoryId,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2026-01-01",
    endDate: "",
    status: "active",
    stops: [
      { name: "Estate gate", scheduledTime: "06:00" },
      { name: "Head office", scheduledTime: "06:30" },
    ],
  });
  db = run(db, ops, { type: "create_route", input: routeInput("Estate run", clientId) });
  db = run(db, ops, { type: "create_route", input: routeInput("Beta run", otherClientId) });
  const routeId = db.routes[0].id;
  const stopId = db.routes[0].stops[0].id;

  const rosterIds: string[] = [];
  for (let i = 0; i < (options.rosterSize ?? 2); i += 1) {
    db = run(db, ops, {
      type: "create_passenger",
      input: { fullName: `Roster ${i + 1}`, employeeRef: `R-${i + 1}`, phone: "", clientId, routeId, stopId, status: "active" },
    });
    rosterIds.push(db.passengers[db.passengers.length - 1].id);
  }
  // A visitor: on the client's books, but not on anybody's daily roster.
  db = run(db, ops, { type: "create_passenger", input: { fullName: "Visiting Vic", employeeRef: "V-1", phone: "", clientId, routeId: "", stopId: "", status: "active" } });
  const visitorId = db.passengers[db.passengers.length - 1].id;
  db = run(db, ops, { type: "create_passenger", input: { fullName: "Beta Stranger", employeeRef: "B-1", phone: "", clientId: otherClientId, routeId: "", stopId: "", status: "active" } });
  const strangerId = db.passengers[db.passengers.length - 1].id;

  db = run(db, ops, { type: "generate_trips", routeId, fromDate: "2026-06-01", toDate: "2026-06-05" });
  // Every planned run gets the bus, so a seat can be counted on each of them.
  for (const trip of db.trips.filter((candidate) => candidate.routeId === routeId)) {
    db = run(db, ops, { type: "assign_trip", id: trip.id, input: { vehicleId: db.vehicles[0].id, driverId: db.drivers[0].id } });
  }
  const tripId = db.trips.find((trip) => trip.routeId === routeId && trip.serviceDate === "2026-06-01")!.id;

  return { db, admin, ops, finance, routeId, clientId, tripId, rosterIds, visitorId, strangerId };
}

/** Another visitor on the same client's books. Keeps each scenario's riders independent. */
function addVisitor(w: World, fullName: string): { db: Database; id: string } {
  const db = run(w.db, w.ops, { type: "create_passenger", input: { fullName, employeeRef: fullName.slice(0, 3), phone: "", clientId: w.clientId, routeId: "", stopId: "", status: "active" } });
  return { db, id: db.passengers[db.passengers.length - 1].id };
}

const request = (w: World, over: Partial<{ passengerId: string; routeId: string; serviceDate: string; toDate: string; type: "one_time" | "recurring"; note: string }> = {}): AnyCommand => ({
  type: "create_booking",
  input: { passengerId: w.visitorId, routeId: w.routeId, serviceDate: "2026-06-01", toDate: "", type: "one_time", note: "", ...over },
});

const tripOf = (db: Database, id: string) => db.trips.find((trip) => trip.id === id) as Trip;

describe("bookings - the request (BKG-01, BKG-02)", () => {
  it("books a named seat for a visitor, with its own reference and a first history entry", () => {
    const w = build();
    const result = attempt(w.db, w.ops, request(w, { note: "Interview candidate." }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [booking] = result.db.bookings;
    expect(booking.reference).toBe("BK-0001");
    expect(booking.status).toBe("requested");
    expect(booking.tripId).toBe(w.tripId);
    expect(booking.serviceDate).toBe("2026-06-01");
    expect(booking.seriesId).toBeNull();
    expect(booking.history).toHaveLength(1);
    expect(booking.history[0].note).toBe("Interview candidate.");
    expect(booking.history[0].by).toBe("Ops");
    // Nothing is confirmed by asking: a person still has to look at the seats.
    expect(seatsHeld(result.db, w.tripId)).toBe(0);
    expect(result.message).toMatch(/1 booking requested for Visiting Vic on 2026-06-01/);
    expect(result.db.audit[0].action).toBe("bookings:create");

    // The same rider on the same run is not booked twice.
    const again = attempt(result.db, w.ops, request(w));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/already booked/);
  });

  it("refuses a rider who is already on the route's roster, rather than counting the seat twice", () => {
    const w = build();
    const result = attempt(w.db, w.ops, request(w, { passengerId: w.rosterIds[0] }));
    expect(result.ok).toBe(false);
    expect(errorsOf(result).passengerId).toMatch(/already on RT-001's roster/);
  });

  it("refuses an inactive rider, a rider from another client, and an unknown route", () => {
    const w = build();
    const inactive = run(w.db, w.ops, { type: "create_passenger", input: { fullName: "Left The Firm", employeeRef: "X-1", phone: "", clientId: w.clientId, routeId: "", stopId: "", status: "inactive" } });
    const inactiveId = inactive.passengers[inactive.passengers.length - 1].id;
    const left = attempt(inactive, w.ops, request(w, { passengerId: inactiveId }));
    expect(left.ok).toBe(false);
    expect(errorsOf(left).passengerId).toMatch(/inactive on the roster/);

    const wrongClient = attempt(w.db, w.ops, request(w, { passengerId: w.strangerId }));
    expect(wrongClient.ok).toBe(false);
    expect(errorsOf(wrongClient).routeId).toMatch(/belongs to a different client/);

    const wrongRoute = attempt(w.db, w.ops, request(w, { routeId: "nope" }));
    expect(wrongRoute.ok).toBe(false);
    expect(errorsOf(wrongRoute).routeId).toMatch(/Unknown route/);
  });

  it("refuses a date with no run, a date that is not a date, and a backwards series", () => {
    const w = build();
    const noRun = attempt(w.db, w.ops, request(w, { serviceDate: "2026-06-20" }));
    expect(noRun.ok).toBe(false);
    if (!noRun.ok) expect(noRun.message).toMatch(/No run exists for RT-001/);

    const nonsense = attempt(w.db, w.ops, request(w, { serviceDate: "soon" }));
    expect(nonsense.ok).toBe(false);
    expect(errorsOf(nonsense).serviceDate).toMatch(/Enter the date of travel/);

    const backwards = attempt(w.db, w.ops, request(w, { type: "recurring", serviceDate: "2026-06-03", toDate: "2026-06-01" }));
    expect(backwards.ok).toBe(false);
    expect(errorsOf(backwards).toDate).toMatch(/before the first/);
  });

  it("books one seat per run for a recurring request and names the dates it could not take", () => {
    const w = build();
    const result = attempt(w.db, w.ops, request(w, { type: "recurring", serviceDate: "2026-06-01", toDate: "2026-06-08" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Runs exist for the 1st to the 5th only; the 6th to the 8th have no run and are named, not hidden.
    expect(result.db.bookings).toHaveLength(5);
    expect(new Set(result.db.bookings.map((booking) => booking.seriesId)).size).toBe(1);
    expect(result.db.bookings[0].seriesId).toMatch(/^series-BK-0001$/);
    expect(result.message).toMatch(/2026-06-06 \(nothing scheduled\)/);
    expect(result.message).toMatch(/Not booked/);
    // Each run keeps its own reference.
    expect(result.db.bookings.map((booking) => booking.reference)).toEqual(["BK-0001", "BK-0002", "BK-0003", "BK-0004", "BK-0005"]);
  });

  it("is refused for finance, whose work does not include the roster", () => {
    const w = build();
    const result = attempt(w.db, w.finance, request(w));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Not permitted/);
  });
});

describe("bookings - capacity and confirmation (BKG-03, BKG-04)", () => {
  it("counts the roster and the live bookings against the vehicle's seats", () => {
    const w = build({ seats: "4", rosterSize: 2 });
    expect(capacityOf(w.db, tripOf(w.db, w.tripId))).toMatchObject({ seats: 4, roster: 2, booked: 0, free: 2 });

    const db = run(w.db, w.ops, request(w));
    const bookingId = db.bookings[0].id;
    const confirmed = attempt(db, w.ops, { type: "confirm_booking", id: bookingId });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    expect(confirmed.db.bookings[0].status).toBe("confirmed");
    expect(capacityOf(confirmed.db, tripOf(confirmed.db, w.tripId))).toMatchObject({ booked: 1, free: 1 });
    expect(seatsHeld(confirmed.db, w.tripId)).toBe(1);
    expect(confirmed.db.bookings[0].history.map((entry) => entry.action)).toEqual(["Requested", "Confirmed"]);
    expect(confirmed.db.audit[0].action).toBe("bookings:confirm");
    expect(confirmed.message).toMatch(/1 seat\(s\) left/);
  });

  it("puts a request on the waiting list when the run is full, and confirms nobody", () => {
    const w = build({ seats: "3", rosterSize: 2 }); // one bookable seat
    const guestA = addVisitor(w, "First Guest");
    const guestB = addVisitor({ ...w, db: guestA.db }, "Second Guest");

    let db = run(guestB.db, w.ops, request(w, { passengerId: guestA.id }));
    db = run(db, w.ops, request(w, { passengerId: guestB.id }));
    const [first, second] = db.bookings;

    const confirmFirst = attempt(db, w.ops, { type: "confirm_booking", id: first.id });
    expect(confirmFirst.ok).toBe(true);
    if (!confirmFirst.ok) return;

    const confirmSecond = attempt(confirmFirst.db, w.ops, { type: "confirm_booking", id: second.id });
    expect(confirmSecond.ok).toBe(true);
    if (!confirmSecond.ok) return;
    expect(confirmSecond.message).toMatch(/waiting list/);
    expect(confirmSecond.db.bookings.find((booking) => booking.id === second.id)!.status).toBe("waitlisted");
    expect(confirmSecond.db.bookings.find((booking) => booking.id === second.id)!.history.at(-1)!.action).toBe("Waitlisted");
    // Full means waiting, never a second confirmed seat.
    expect(seatsHeld(confirmSecond.db, w.tripId)).toBe(1);
    expect(confirmSecond.db.audit[0].action).toBe("bookings:waitlist");
  });

  it("refuses to promise a seat on a run with no vehicle, because its seats cannot be counted", () => {
    const w = build();
    const withAdhoc = run(w.db, w.ops, { type: "create_adhoc_trip", input: { routeId: w.routeId, serviceDate: "2026-06-10", reason: "Extra run, no bus assigned yet.", vehicleId: "", driverId: "" } });
    const adhocTrip = withAdhoc.trips.find((trip) => trip.serviceDate === "2026-06-10")!;
    expect(adhocTrip.vehicleId).toBeNull();

    const blocked = attempt(withAdhoc, w.ops, request(w, { serviceDate: "2026-06-10" }));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/No seat could be requested.*No vehicle is assigned/);
  });
});

describe("bookings - cancelling, the waiting list and the history (BKG-05, BKG-06)", () => {
  /** Two visitors on a one-seat run: one confirmed, one waiting. */
  function pair() {
    const w = build({ seats: "3", rosterSize: 2 });
    const guestA = addVisitor(w, "First Guest");
    const guestB = addVisitor({ ...w, db: guestA.db }, "Second Guest");
    let db = run(guestB.db, w.ops, request(w, { passengerId: guestA.id }));
    db = run(db, w.ops, request(w, { passengerId: guestB.id }));
    const firstId = db.bookings[0].id;
    const secondId = db.bookings[1].id;
    db = run(db, w.ops, { type: "confirm_booking", id: firstId });
    db = run(db, w.ops, { type: "confirm_booking", id: secondId });
    return { w, db, firstId, secondId };
  }

  it("offers the freed seat to the oldest waiter and confirms nobody", () => {
    const { w, db, firstId, secondId } = pair();
    expect(db.bookings.find((booking) => booking.id === secondId)!.status).toBe("waitlisted");

    const cancelled = attempt(db, w.ops, { type: "cancel_booking", id: firstId, reason: "Interview postponed." });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    const waiter = cancelled.db.bookings.find((booking) => booking.id === secondId)!;
    expect(waiter.status).toBe("offered");
    expect(waiter.offeredAt).toBe(NOW);
    expect(cancelled.message).toMatch(/offered to BK-0002; nobody is confirmed yet/);

    // The offer is confirmed by a person, not by the system.
    const confirmed = attempt(cancelled.db, w.ops, { type: "confirm_booking", id: secondId });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.db.bookings.find((booking) => booking.id === secondId)!.status).toBe("confirmed");
  });

  it("requires a reason to cancel, and refuses to cancel twice", () => {
    const { w, db, firstId } = pair();
    const noReason = attempt(db, w.ops, { type: "cancel_booking", id: firstId, reason: "  " });
    expect(noReason.ok).toBe(false);
    expect(errorsOf(noReason).reason).toMatch(/required/);

    const once = attempt(db, w.ops, { type: "cancel_booking", id: firstId, reason: "Plans changed." });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = attempt(once.db, w.ops, { type: "cancel_booking", id: firstId, reason: "Again." });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.message).toMatch(/already cancelled/);
  });

  it("keeps the whole history of what happened to the booking", () => {
    const { w, db, firstId } = pair();
    const cancelled = attempt(db, w.ops, { type: "cancel_booking", id: firstId, reason: "Bus full that day." });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    const booking = cancelled.db.bookings.find((candidate) => candidate.id === firstId)!;
    expect(booking.history.map((entry) => entry.action)).toEqual(["Requested", "Confirmed", "Cancelled"]);
    expect(booking.history[2].note).toBe("Bus full that day.");
    expect(booking.cancelledBy).toBe("Ops");
    expect(booking.cancelledAt).toBe(NOW);
    // The record is kept, so the seat count and the story agree.
    expect(cancelled.db.bookings).toHaveLength(2);
    expect(cancelled.db.audit[0].action).toBe("bookings:cancel");
  });

  it("rejects a request with a reason, and will not confirm a rejected booking", () => {
    const { w, db, secondId } = pair();
    const noReason = attempt(db, w.ops, { type: "reject_booking", id: secondId, reason: "" });
    expect(noReason.ok).toBe(false);

    const rejected = attempt(db, w.ops, { type: "reject_booking", id: secondId, reason: "The bus is reserved for the audit team." });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const booking = rejected.db.bookings.find((candidate) => candidate.id === secondId)!;
    expect(booking.status).toBe("rejected");
    expect(booking.note).toMatch(/audit team/);
    expect(rejected.db.audit[0].action).toBe("bookings:reject");

    const confirm = attempt(rejected.db, w.ops, { type: "confirm_booking", id: secondId });
    expect(confirm.ok).toBe(false);
  });
});

describe("bookings - cut-offs (BKG-02, BKG-05, D-83)", () => {
  it("applies a cancellation cut-off only when one is configured", () => {
    const w = build();
    const configured = attempt(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: 120 } },
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;

    let db = run(configured.db, w.ops, request(w));
    const bookingId = db.bookings[0].id;
    db = run(db, w.ops, { type: "confirm_booking", id: bookingId });

    // NOW is one hour before departure, inside a two-hour cut-off.
    const late = attempt(db, w.ops, { type: "cancel_booking", id: bookingId, reason: "Changed plans." });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toMatch(/Too late to cancel.*cut-off is 120/);

    // With no cut-off configured the same cancellation is allowed: no invented deadline.
    const plain = run(w.db, w.ops, request(w));
    const open = attempt(plain, w.ops, { type: "cancel_booking", id: plain.bookings[0].id, reason: "Changed plans." });
    expect(open.ok).toBe(true);
  });

  it("applies a booking cut-off to a request inside it, while leaving later dates alone", () => {
    const w = build();
    const configured = attempt(w.db, w.admin, {
      type: "update_settings",
      input: { ...w.db.settings, booking: { requestCutoffMinutes: 120, cancellationCutoffMinutes: null } },
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;

    const today = attempt(configured.db, w.ops, request(w));
    expect(today.ok).toBe(false);
    if (!today.ok) expect(today.message).toMatch(/inside the 120-minute booking cut-off/);

    // Tomorrow's run is unaffected.
    const tomorrow = attempt(configured.db, w.ops, request(w, { serviceDate: "2026-06-02" }));
    expect(tomorrow.ok).toBe(true);
  });
});

describe("bookings - who may book and cancel (D-60)", () => {
  /** A client contact account linked to the first client. */
  function withClientContact(w: World): World {
    const user: User = {
      id: "u-contact",
      fullName: "Contact Person",
      email: "contact@acme.test",
      role: "client_contact",
      active: true,
      driverId: null,
      clientId: w.clientId,
      passengerId: null,
      primaryContact: true,
      passwordHash: "",
      passwordSalt: "",
      createdAt: NOW,
      updatedAt: NOW,
    };
    return { ...w, db: { ...w.db, users: [...w.db.users, user] } };
  }

  it("lets a client's own contact book and cancel its own staff, and nothing else", () => {
    const w = withClientContact(build());
    const contact: Actor = { id: "u-contact", fullName: "Contact Person", role: "client_contact" };

    const own = attempt(w.db, contact, request(w));
    expect(own.ok).toBe(true);
    if (!own.ok) return;

    // Not another client's rider.
    const stranger = attempt(w.db, contact, request(w, { passengerId: w.strangerId }));
    expect(stranger.ok).toBe(false);
    expect(errorsOf(stranger).passengerId).toMatch(/confined to your own company/);

    // It may cancel a request it made...
    const cancelled = attempt(own.db, contact, { type: "cancel_booking", id: own.db.bookings[0].id, reason: "No longer needed." });
    expect(cancelled.ok).toBe(true);

    // ...but not confirm a seat: capacity is the office's judgement.
    const confirm = attempt(own.db, contact, { type: "confirm_booking", id: own.db.bookings[0].id });
    expect(confirm.ok).toBe(false);
    if (!confirm.ok) expect(confirm.message).toMatch(/Not permitted/);
  });
});

describe("bookings - a booked seat is on the run's list of people (D-85)", () => {
  /** A confirmed booked seat for the visitor, on the fixture's 06:00 run. */
  function withBookedSeat(w: World) {
    let db = run(w.db, w.ops, request(w, { note: "Interview candidate." }));
    const bookingId = db.bookings[0].id;
    db = run(db, w.ops, { type: "confirm_booking", id: bookingId });
    return { db, bookingId };
  }

  it("puts a confirmed seat on the manifest at its pickup stop, and leaves a request off it", () => {
    const w = build();
    // A request holds nothing, so nobody is expected aboard yet.
    const requested = run(w.db, w.ops, request(w));
    expect(manifestFor(requested, tripOf(requested, w.tripId))).toHaveLength(w.rosterIds.length);

    const confirmed = run(requested, w.ops, { type: "confirm_booking", id: requested.bookings[0].id });
    const manifest = manifestFor(confirmed, tripOf(confirmed, w.tripId));
    expect(manifest).toHaveLength(w.rosterIds.length + 1);
    const visitor = manifest.find((entry) => entry.source === "booking")!;
    expect(visitor.passenger.fullName).toBe("Visiting Vic");
    expect(visitor.bookingReference).toBe("BK-0001");
    // A visitor with no stop of their own gets on at the first stop, where the bus actually is.
    expect(visitor.pickupStopId).toBe(confirmed.routes[0].stops[0].id);
    expect(manifestAtStop(confirmed, tripOf(confirmed, w.tripId), visitor.pickupStopId)).toHaveLength(3);
  });

  it("takes a cancelled seat off the manifest", () => {
    const w = build();
    const { db, bookingId } = withBookedSeat(w);
    const cancelled = run(db, w.ops, { type: "cancel_booking", id: bookingId, reason: "Interview cancelled." });
    expect(manifestFor(cancelled, tripOf(cancelled, w.tripId)).some((entry) => entry.source === "booking")).toBe(false);
  });

  it("counts a rider once, as a roster rider, if they are on the roster and hold a seat", () => {
    const w = build();
    const { db } = withBookedSeat(w);
    // Reach into the record the way a later roster change would: the visitor joins this route's roster.
    const rid = db.bookings[0].passengerId;
    const edited: Database = {
      ...db,
      passengers: db.passengers.map((passenger) => (passenger.id === rid ? { ...passenger, routeId: w.routeId, stopId: db.routes[0].stops[0].id } : passenger)),
    };
    const manifest = manifestFor(edited, tripOf(edited, w.tripId));
    expect(manifest.filter((entry) => entry.passenger.id === rid)).toHaveLength(1);
    expect(manifest.find((entry) => entry.passenger.id === rid)!.source).toBe("roster");
  });

  it("will not record a stop that leaves the booked visitor unaccounted for", () => {
    const w = build();
    const { db } = withBookedSeat(w);
    const dispatched = run(db, w.ops, { type: "dispatch_trip", id: w.tripId });
    const started = run(dispatched, w.ops, { type: "start_trip", id: w.tripId });
    const stopId = started.routes[0].stops[0].id;

    // The two roster riders are not the whole list any more.
    const partial = attempt(started, w.ops, {
      type: "record_trip_stop",
      id: w.tripId,
      input: { stopId, actualTime: "06:03", boardings: w.rosterIds.map((passengerId) => ({ passengerId, outcome: "boarded" as const })) },
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors.boardings).toMatch(/every rider expected at Estate gate \(3\)/);

    const visitorId = started.bookings[0].passengerId;
    const complete = attempt(started, w.ops, {
      type: "record_trip_stop",
      id: w.tripId,
      input: {
        stopId,
        actualTime: "06:03",
        boardings: [...w.rosterIds.map((passengerId) => ({ passengerId, outcome: "boarded" as const })), { passengerId: visitorId, outcome: "boarded" as const }],
      },
    });
    expect(complete.ok).toBe(true);
    if (complete.ok) expect(complete.db.trips.find((trip) => trip.id === w.tripId)!.boardings).toHaveLength(3);
  });

  it("will not complete a run that leaves the booked visitor unaccounted for", () => {
    const w = build();
    const { db } = withBookedSeat(w);
    const dispatched = run(db, w.ops, { type: "dispatch_trip", id: w.tripId });
    const stops = dispatched.routes[0].stops;
    const visitorId = db.bookings[0].passengerId;
    const times = stops.map((stop) => ({ stopId: stop.id, actualTime: "06:05" }));

    const partial = attempt(dispatched, w.ops, {
      type: "complete_trip",
      id: w.tripId,
      input: { stopTimes: times, boardings: w.rosterIds.map((passengerId) => ({ passengerId, outcome: "boarded" as const })) },
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors.boardings).toMatch(/1 still to record/);

    const complete = attempt(dispatched, w.ops, {
      type: "complete_trip",
      id: w.tripId,
      input: {
        stopTimes: times,
        boardings: [...w.rosterIds.map((passengerId) => ({ passengerId, outcome: "boarded" as const })), { passengerId: visitorId, outcome: "no_show" as const }],
      },
    });
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    const trip = complete.db.trips.find((candidate) => candidate.id === w.tripId)!;
    expect(trip.status).toBe("completed");
    expect(trip.boardings.find((record) => record.passengerId === visitorId)!.outcome).toBe("no_show");
    expect(complete.message).toMatch(/On time/);
  });

  it("refuses a new seat once the run is under way, because the list of people is fixed", () => {
    const w = build();
    const dispatched = run(w.db, w.ops, { type: "dispatch_trip", id: w.tripId });
    const started = run(dispatched, w.ops, { type: "start_trip", id: w.tripId });
    const late = attempt(started, w.ops, request(w));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.message).toMatch(/already under way; its list of riders is fixed/);
  });

  it("will not move the run to a smaller vehicle than the roster and the sold seats need", () => {
    const w = build({ seats: "4", rosterSize: 2 });
    const guest = addVisitor(w, "Third Guest");
    let db = run(guest.db, w.ops, request(w, { passengerId: guest.id }));
    db = run(db, w.ops, { type: "confirm_booking", id: db.bookings[0].id });

    // A second, smaller bus in the same category: 2 seats cannot carry 2 roster riders + 1 booked seat.
    db = run(db, w.ops, { type: "create_vehicle", input: { registration: "GT 902-26", categoryId: db.settings.vehicleCategories[0].id, make: "", model: "", seatCapacity: "2", notes: "" } });
    const small = db.vehicles[db.vehicles.length - 1].id;
    const reassign = attempt(db, w.ops, { type: "assign_trip", id: w.tripId, input: { vehicleId: small, driverId: db.drivers[0].id } });
    expect(reassign.ok).toBe(false);
    if (!reassign.ok) expect(reassign.errors.vehicleId).toMatch(/booked seat\(s\)/);
  });

  it("refuses a seat on a date no active contract covers, and names the contract in the way (D-95)", () => {
    const w = build();
    // A contract for the client, still a draft: it covers 1 June but is not in force.
    const withContract = run(w.db, w.ops, {
      type: "create_contract",
      input: {
        clientId: w.clientId,
        serviceType: "staff_transport",
        startDate: "2026-06-01",
        endDate: "2026-12-31",
        routeIds: [w.routeId],
        weekdays: [1, 2, 3, 4, 5],
        shiftIds: [],
        vehicleCategoryId: "",
        pricingModel: "Per trip",
        billingFrequency: "",
        paymentTerms: "",
        serviceLevelTargets: "",
        notes: "",
      },
    });

    const refused = attempt(withContract, w.ops, request(w));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.message).toMatch(/CT-0001/);
      expect(refused.errors.serviceDate).toMatch(/cannot be taken under it/);
    }

    // Approving the contract is what makes the same request acceptable — nothing else changed.
    const id = withContract.contracts[0].id;
    let approved = run(withContract, w.ops, { type: "advance_contract", id, to: "pending_approval", reason: "" });
    approved = run(approved, w.admin, { type: "advance_contract", id, to: "active", reason: "" });
    const allowed = attempt(approved, w.ops, request(w));
    expect(allowed.ok).toBe(true);
  });

  it("re-checks the contract when a requested seat is confirmed, not only when it was asked for (D-95)", () => {
    const w = build();
    let db = run(w.db, w.ops, request(w));
    const id = db.bookings[0].id;

    // A contract that is suspended by the time the office looks at the seat.
    db = run(db, w.ops, {
      type: "create_contract",
      input: {
        clientId: w.clientId,
        serviceType: "staff_transport",
        startDate: "2026-06-01",
        endDate: "2026-12-31",
        routeIds: [w.routeId],
        weekdays: [],
        shiftIds: [],
        vehicleCategoryId: "",
        pricingModel: "",
        billingFrequency: "",
        paymentTerms: "",
        serviceLevelTargets: "",
        notes: "",
      },
    });
    const contractId = db.contracts[0].id;
    db = run(db, w.ops, { type: "advance_contract", id: contractId, to: "pending_approval", reason: "" });
    db = run(db, w.admin, { type: "advance_contract", id: contractId, to: "active", reason: "" });
    db = run(db, w.ops, { type: "advance_contract", id: contractId, to: "suspended", reason: "Invoice unpaid" });

    const confirm = attempt(db, w.ops, { type: "confirm_booking", id });
    expect(confirm.ok).toBe(false);
    if (!confirm.ok) expect(confirm.message).toMatch(/CT-0001 is suspended/);
  });
});
