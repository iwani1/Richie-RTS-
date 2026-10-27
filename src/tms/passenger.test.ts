// The passenger portal's rules (brief 1C: PAX-01, D-97).
//
// Three properties are under test, and they are the ones that could go wrong quietly:
//
//   1. **one rider, one payload** — a passenger account sees its own record, its own seats and the
//      runs that carry it. A colleague's name, another company's route or the office's costs must
//      not be in the answer, and an account with no rider must see nothing at all;
//   2. **the brief's statuses** — requested, confirmed, assigned to trip, under way, picked up,
//      completed, cancelled or delayed — are each derived from a record, never invented, and the
//      ones the data cannot support say so instead of guessing;
//   3. **the rider can act only on itself** — ask for a seat in its own name, cancel its own seat,
//      report a problem with its own journey.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { cancellationProblem, eligibleRunsFor, journeyStateOf, journeysOf, nextJourney, pastJourneys, upcomingJourneys, PASSENGER_LIMITS } from "./passenger";
import { confinedPassengerId, scopedView } from "./scope";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, type Booking, type Database, type Trip } from "./types";

const NOW = "2026-06-01T05:00:00.000Z"; // one hour before the 06:00 departure
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

interface World {
  db: Database;
  ops: Actor;
  admin: Actor;
  riderId: string;
  otherRiderId: string;
  passengerUser: Actor;
  routeId: string;
  otherRouteId: string;
  tripId: string;
  otherTripId: string;
}

const actorOf = (db: Database, role: Actor["role"]): Actor => {
  const user = db.users.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`missing ${role} user`);
  return { id: user.id, fullName: user.fullName, role: user.role };
};

function run(db: Database, actor: Actor | null, command: AnyCommand, now = NOW): Database {
  const result = executeCommand(db, actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}

const attempt = (db: Database, actor: Actor | null, command: AnyCommand, now = NOW) => executeCommand(db, actor, command, now);

/**
 * One client, two routes (the daily run and an evening run), four riders, a bus on every run and a
 * passenger account linked to the first rider.
 */
function build(options: { cancellationCutoff?: number | null; requestCutoff?: number | null } = {}): World {
  let db = emptyDatabase();
  const setup = execute(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  db = setup.db;
  const admin = actorOf(db, "administrator");
  db = run(db, admin, { type: "create_user", input: { fullName: "Ops", email: "ops@example.test", role: "operations", active: true }, credential: cred });
  const ops = actorOf(db, "operations");
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
      workTypes: [],
      costCategories: [],
      maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: options.requestCutoff ?? null, cancellationCutoffMinutes: options.cancellationCutoff ?? null },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  db = run(db, ops, { type: "create_vehicle", input: { registration: "GT 100-26", categoryId, make: "", model: "", seatCapacity: "3", notes: "" } });
  db = run(db, ops, { type: "create_driver", input: { fullName: "Kojo", phone: "024", licenceNumber: "L-1", licenceExpiry: "2030-01-01", status: "active" } });
  db = run(db, admin, { type: "create_client", input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", status: "active" } });
  const clientId = db.clients[0].id;

  const routeInput = (name: string, starts: string) => ({
    name,
    clientId,
    direction: "to_work" as const,
    shiftId: "",
    vehicleCategoryId: categoryId,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    startDate: "2026-01-01",
    endDate: "",
    status: "active" as const,
    stops: [
      { name: `${name} gate`, scheduledTime: starts },
      { name: `${name} office`, scheduledTime: starts === "06:00" ? "06:30" : "18:30" },
    ],
  });
  db = run(db, ops, { type: "create_route", input: routeInput("Estate run", "06:00") });
  db = run(db, ops, { type: "create_route", input: routeInput("Evening run", "18:00") });
  const routeId = db.routes[0].id;
  const otherRouteId = db.routes[1].id;

  // Ama is on the morning roster; Kofi is a colleague on the same client who travels occasionally.
  db = run(db, ops, { type: "create_passenger", input: { fullName: "Ama Boateng", employeeRef: "A-1", phone: "055", clientId, routeId, stopId: db.routes[0].stops[0].id, status: "active" } });
  const riderId = db.passengers[0].id;
  db = run(db, ops, { type: "create_passenger", input: { fullName: "Kofi Mensah", employeeRef: "K-1", phone: "024", clientId, routeId: "", stopId: "", status: "active" } });
  const otherRiderId = db.passengers[1].id;

  for (const route of [routeId, otherRouteId]) {
    db = run(db, ops, { type: "generate_trips", routeId: route, fromDate: "2026-06-01", toDate: "2026-06-03" });
  }
  for (const trip of db.trips) {
    db = run(db, ops, { type: "assign_trip", id: trip.id, input: { vehicleId: db.vehicles[0].id, driverId: db.drivers[0].id } });
  }
  const tripId = db.trips.find((trip) => trip.routeId === routeId && trip.serviceDate === "2026-06-01")!.id;
  const otherTripId = db.trips.find((trip) => trip.routeId === otherRouteId && trip.serviceDate === "2026-06-01")!.id;

  db = run(db, admin, {
    type: "create_user",
    input: { fullName: "Ama Boateng", email: "ama@example.test", role: "passenger", active: true, passengerId: riderId },
    credential: cred,
  });
  const passengerUser = actorOf(db, "passenger");

  return { db, ops, admin, riderId, otherRiderId, passengerUser, routeId, otherRouteId, tripId, otherTripId };
}

const tripOf = (db: Database, id: string) => db.trips.find((trip) => trip.id === id) as Trip;
const bookingsOf = (db: Database, riderId: string) => db.bookings.filter((booking) => booking.passengerId === riderId);

describe("passenger accounts - the link (PAX-01)", () => {
  it("refuses a passenger account with no rider, and a second account on the same rider", () => {
    const w = build();

    const unlinked = attempt(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "No Rider", email: "norider@example.test", role: "passenger", active: true },
      credential: cred,
    });
    expect(unlinked.ok).toBe(false);
    if (!unlinked.ok) expect(unlinked.errors.passengerId).toMatch(/link this account to a rider/i);

    const duplicate = attempt(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "Second Ama", email: "ama2@example.test", role: "passenger", active: true, passengerId: w.riderId },
      credential: cred,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors.passengerId).toMatch(/already linked/i);

    const unknown = attempt(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "Ghost", email: "ghost@example.test", role: "passenger", active: true, passengerId: "no-such-rider" },
      credential: cred,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.passengerId).toMatch(/not found/i);
  });

  it("refuses a driver or client link on a passenger account, and a rider link on an office account", () => {
    const w = build();
    const mixed = attempt(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "Mixed", email: "mixed@example.test", role: "passenger", active: true, passengerId: w.riderId, driverId: w.db.drivers[0].id },
      credential: cred,
    });
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.errors.driverId).toMatch(/not linked to a driver/i);

    const office = attempt(w.db, w.admin, {
      type: "create_user",
      input: { fullName: "Office Rider", email: "office@example.test", role: "operations", active: true, passengerId: w.riderId },
      credential: cred,
    });
    expect(office.ok).toBe(false);
    if (!office.ok) expect(office.errors.driverId).toMatch(/Only driver, client contact and passenger/i);
  });

  it("names the rider's own record, and only that record, in the payload", () => {
    const w = build();
    const view = scopedView(w.db, w.passengerUser);
    expect(view.link.bound).toBe(true);
    expect(view.link.passenger?.fullName).toBe("Ama Boateng");
    expect(view.passengers.map((p) => p.id)).toEqual([w.riderId]);

    // Every office-side collection is empty for this account.
    expect(view.rentals).toEqual([]);
    expect(view.contracts).toEqual([]);
    expect(view.workOrders).toEqual([]);
    expect(view.documents).toEqual([]);

    // Only the runs that carry Ama: her own route, and nothing on the evening run until she books it.
    expect(view.trips.every((trip) => trip.routeId === w.routeId)).toBe(true);
    expect(view.routes.map((route) => route.id)).toEqual([w.routeId]);
    expect(view.bookings).toEqual([]);
  });

  it("fails closed when the linked rider record is gone", () => {
    const w = build();
    const orphaned: Database = { ...w.db, users: w.db.users.map((user) => (user.id === w.passengerUser.id ? { ...user, passengerId: null } : user)) };
    const view = scopedView(orphaned, w.passengerUser);
    expect(view.link.bound).toBe(true);
    expect(view.link.passenger).toBeNull();
    expect(view.trips).toEqual([]);
    expect(view.passengers).toEqual([]);
    expect(view.bookings).toEqual([]);
    expect(confinedPassengerId(orphaned, w.passengerUser)).toBeNull();
  });
});

describe("passenger accounts - the seat limit belongs to the rider", () => {
  it("lets the rider request a seat for itself on another run of its own client", () => {
    const w = build();
    const next = run(w.db, w.passengerUser, {
      type: "create_booking",
      input: { passengerId: w.riderId, routeId: w.otherRouteId, serviceDate: "2026-06-02", toDate: "", type: "one_time", note: "Late shift" },
    });
    const bookings = bookingsOf(next, w.riderId);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe("requested");
    expect(bookings[0].routeId).toBe(w.otherRouteId);
    expect(bookings[0].stopId).toBe(w.db.passengers[0].stopId);
  });

  it("refuses a seat requested in a colleague's name", () => {
    const w = build();
    const result = attempt(w.db, w.passengerUser, {
      type: "create_booking",
      input: { passengerId: w.otherRiderId, routeId: w.otherRouteId, serviceDate: "2026-06-02", toDate: "", type: "one_time", note: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.passengerId).toMatch(/for yourself only/i);
  });

  it("lets the rider cancel its own seat and refuses a colleague's", () => {
    const w = build();
    let db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderId, routeId: w.otherRouteId, serviceDate: "2026-06-02", toDate: "", type: "one_time", note: "" },
    });
    db = run(db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.otherRiderId, routeId: w.otherRouteId, serviceDate: "2026-06-03", toDate: "", type: "one_time", note: "" },
    });
    const mine = db.bookings.find((booking) => booking.passengerId === w.riderId)!;
    const theirs = db.bookings.find((booking) => booking.passengerId === w.otherRiderId)!;

    const refused = attempt(db, w.passengerUser, { type: "cancel_booking", id: theirs.id, reason: "Not my seat" });
    expect(refused.ok).toBe(false);

    const cancelled = run(db, w.passengerUser, { type: "cancel_booking", id: mine.id, reason: "Working from home" });
    const after = cancelled.bookings.find((booking) => booking.id === mine.id)!;
    expect(after.status).toBe("cancelled");
    expect(after.cancelledBy).toBe("Ama Boateng");
    expect(after.note).toMatch(/Working from home/);
  });

  it("tells the rider why a run cannot be asked for, rather than hiding it", () => {
    const w = build();
    const runs = eligibleRunsFor(w.db, w.db.passengers[0], NOW, "2026-06-01", "2026-06-03");

    // The rider's own route: the roster is the seat, so there is nothing to book.
    const own = runs.filter((run) => run.route.id === w.routeId);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((run) => run.bookable === false)).toBe(true);
    expect(own[0].why).toMatch(/your seat on it is automatic/i);

    // Another run of the same client is bookable on a day with room.
    const other = runs.filter((run) => run.route.id === w.otherRouteId);
    expect(other.some((run) => run.bookable)).toBe(true);
  });

  it("applies the office's request cut-off to the list and to the command", () => {
    // 800 minutes is a deliberately odd cut-off: it puts both of the day's runs inside it, so the
    // test measures the rule rather than the clock.
    const w = build({ requestCutoff: 800 });
    const runs = eligibleRunsFor(w.db, w.db.passengers[0], NOW, "2026-06-01", "2026-06-01");
    const evening = runs.find((run) => run.route.id === w.otherRouteId)!;
    expect(evening.bookable).toBe(false);
    expect(evening.why).toMatch(/Requests for this run close 800 minutes/);

    const result = attempt(w.db, w.passengerUser, {
      type: "create_booking",
      input: { passengerId: w.riderId, routeId: w.otherRouteId, serviceDate: "2026-06-01", toDate: "", type: "one_time", note: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/inside the 800-minute booking cut-off/i);
  });
});

describe("passenger accounts - the brief's statuses, one by one", () => {
  const bookingWith = (status: Booking["status"]): Booking =>
    ({
      id: "booking-1",
      reference: "BK-0001",
      passengerId: "rider-1",
      clientId: "client-1",
      routeId: "route-1",
      stopId: "stop-1",
      tripId: "trip-1",
      serviceDate: "2026-06-01",
      status,
      type: "one_time",
      note: "",
      seriesId: null,
      offeredAt: null,
      cancelledAt: null,
      cancelledBy: null,
      history: [],
      createdAt: NOW,
      updatedAt: NOW,
    }) as Booking;

  it("names a request, a waiting place, an offer, a refusal and a cancellation as the seat's own states", () => {
    const trip = { ...tripOf(build().db, build().tripId) };
    expect(journeyStateOf(trip, bookingWith("requested"), "rider-1").label).toBe("Seat requested");
    expect(journeyStateOf(trip, bookingWith("waitlisted"), "rider-1").label).toBe("On the waiting list");
    expect(journeyStateOf(trip, bookingWith("offered"), "rider-1").label).toBe("Seat offered");
    expect(journeyStateOf(trip, bookingWith("rejected"), "rider-1").label).toBe("Not accepted");
    expect(journeyStateOf(trip, bookingWith("cancelled"), "rider-1").label).toBe("Cancelled");
  });

  it("separates a held seat with no bus from a run with a bus on it", () => {
    const w = build();
    const planned = tripOf(w.db, w.tripId);
    const noBus = journeyStateOf({ ...planned, vehicleId: null }, null, w.riderId);
    expect(noBus.label).toBe("Seat held");
    expect(noBus.detail).toMatch(/A bus has not been assigned/i);

    const assigned = journeyStateOf(planned, null, w.riderId);
    expect(assigned.label).toBe("Bus assigned");

    const released = journeyStateOf({ ...planned, status: "dispatched" }, null, w.riderId);
    expect(released.label).toBe("Ready to leave");
  });

  it("says a started run is under way, and never invents an arrival time", () => {
    const w = build();
    const running = journeyStateOf({ ...tripOf(w.db, w.tripId), status: "in_progress" }, null, w.riderId);
    expect(running.label).toBe("Under way");
    expect(running.detail).toMatch(/position is not tracked/i);
    expect(PASSENGER_LIMITS.join(" ")).toMatch(/live position is not tracked/i);
    // D-105 changed the honest answer: a delay *is* recorded now — but only when somebody reported
    // one, so an unreported late bus still says nothing and the rider is told to ring.
    expect(PASSENGER_LIMITS.join(" ")).toMatch(/delay shows only when the driver or the office has reported one/i);
  });

  it("reports the boarding recorded at the door: picked up, then travelled", () => {
    const w = build();
    const boarding = [{ passengerId: w.riderId, stopId: w.db.routes[0].stops[0].id, outcome: "boarded" as const }];
    const aboard = journeyStateOf({ ...tripOf(w.db, w.tripId), status: "in_progress", boardings: boarding }, null, w.riderId);
    expect(aboard.label).toBe("Picked up");
    const done = journeyStateOf({ ...tripOf(w.db, w.tripId), status: "completed", boardings: boarding }, null, w.riderId);
    expect(done.label).toBe("Travelled");

    const missed = journeyStateOf({ ...tripOf(w.db, w.tripId), status: "completed", boardings: [{ ...boarding[0], outcome: "no_show" }] }, null, w.riderId);
    expect(missed.label).toBe("Not recorded aboard");
    expect(missed.detail).toMatch(/Tell the office if that is wrong/i);
  });

  it("reports a cancelled run with the reason the office recorded", () => {
    const w = build();
    const cancelled = journeyStateOf({ ...tripOf(w.db, w.tripId), status: "cancelled", cancelReason: "Bus broke down" }, null, w.riderId);
    expect(cancelled.label).toBe("Run cancelled");
    expect(cancelled.detail).toMatch(/Bus broke down/);
  });

  it("orders a rider's journeys: upcoming soonest first, history newest first", () => {
    const w = build();
    const journeys = journeysOf(w.db, w.db.passengers[0], []);
    expect(journeys.length).toBe(3); // three days of the morning route
    expect(journeys.map((journey) => journey.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(upcomingJourneys(journeys, "2026-06-02").map((j) => j.date)).toEqual(["2026-06-02", "2026-06-03"]);
    expect(nextJourney(journeys, "2026-06-02")?.date).toBe("2026-06-02");

    const finished = journeys.map((journey, index) => (index === 0 ? { ...journey, trip: { ...journey.trip, status: "completed" as const } } : journey));
    expect(pastJourneys(finished, "2026-06-02").map((j) => j.date)).toEqual(["2026-06-01"]);
  });
});

describe("passenger accounts - cancelling what the rider holds", () => {
  it("refuses to cancel once the run has finished or started, and says why", () => {
    const w = build();
    const db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderId, routeId: w.otherRouteId, serviceDate: "2026-06-02", toDate: "", type: "one_time", note: "" },
    });
    const booking = bookingsOf(db, w.riderId)[0];
    expect(cancellationProblem(db, booking, NOW)).toBeNull();

    const finished: Database = { ...db, trips: db.trips.map((trip) => (trip.id === booking.tripId ? { ...trip, status: "completed" } : trip)) };
    expect(cancellationProblem(finished, booking, NOW)).toMatch(/has finished/i);

    const started: Database = { ...db, trips: db.trips.map((trip) => (trip.id === booking.tripId ? { ...trip, status: "in_progress" } : trip)) };
    expect(cancellationProblem(started, booking, NOW)).toMatch(/already running/i);
  });

  it("honours the office's cancellation cut-off", () => {
    const w = build({ cancellationCutoff: 90 });
    const db = run(w.db, w.ops, {
      type: "create_booking",
      input: { passengerId: w.riderId, routeId: w.otherRouteId, serviceDate: "2026-06-01", toDate: "", type: "one_time", note: "" },
    });
    const booking = bookingsOf(db, w.riderId)[0];
    // NOW is 05:00; the evening run leaves at 18:00, so the 90-minute cut-off has not been reached.
    expect(cancellationProblem(db, booking, NOW)).toBeNull();
    // At 17:00 the same seat is inside the cut-off.
    expect(cancellationProblem(db, booking, "2026-06-01T17:00:00.000Z")).toMatch(/closes changes 90 minutes/i);
  });
});

describe("passenger accounts - feedback is a report about a journey (PAX-01)", () => {
  const feedback = (over: Record<string, unknown> = {}) => ({
    type: "create_incident" as const,
    input: { type: "safety_concern" as const, severity: "medium" as const, vehicleId: "", tripId: "", reportedDate: "2026-06-01", description: "The bus was overcrowded and the door would not close.", assignedTo: "", takeVehicleOutOfService: false, ...over },
  });

  it("records a rider's report against its own run, with that run's bus, and never withdraws the bus", () => {
    const w = build();
    const db = run(w.db, w.passengerUser, feedback({ tripId: w.tripId }));
    expect(db.incidents).toHaveLength(1);
    expect(db.incidents[0].tripId).toBe(w.tripId);
    expect(db.incidents[0].vehicleId).toBe(w.db.vehicles[0].id);
    expect(db.incidents[0].takeVehicleOutOfService).toBe(false);
    expect(db.vehicles[0].status).toBe("available");
  });

  it("refuses a report about a journey the rider is not on", () => {
    const w = build();
    const result = attempt(w.db, w.passengerUser, feedback({ tripId: w.otherTripId }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/journey you are on/i);

    const noRun = attempt(w.db, w.passengerUser, feedback());
    expect(noRun.ok).toBe(false);
    if (!noRun.ok) expect(noRun.errors.tripId).toBeTruthy();
  });

  it("shows the rider its own feedback and nobody else's", () => {
    const w = build();
    const db = run(w.db, w.passengerUser, feedback({ tripId: w.tripId }));
    const view = scopedView(db, w.passengerUser);
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0].description).toMatch(/overcrowded/);

    // An incident operations raised on the same run is not the rider's to read.
    const opsReported = run(db, w.ops, feedback({ tripId: w.tripId, description: "Fleet-wide tyre check." }));
    const afterView = scopedView(opsReported, w.passengerUser);
    expect(afterView.incidents).toHaveLength(1);
    expect(afterView.incidents[0].description).toMatch(/overcrowded/);
  });
});

// DSP-04, D-105: the office reported a delay, so the rider is told about it in the same breath as
// the run's own state — not on another screen, and not only by a colour.
describe("a reported delay reaches the rider", () => {
  const delayEntry = (minutes: number, reason: string) => ({
    id: "dl-1",
    at: "2026-06-01T07:20:00.000Z",
    minutes,
    reason,
    reportedBy: "Ops",
  });

  it("adds the delay to what the run says, keeping the run's own story first", () => {
    const w = build();
    const running = { ...tripOf(w.db, w.tripId), status: "in_progress" as const };
    const late = journeyStateOf({ ...running, delays: [delayEntry(20, "Traffic at the junction")] }, null, w.riderId);
    expect(late.label).toBe("Under way");
    expect(late.detail).toMatch(/position is not tracked/i);
    expect(late.detail).toMatch(/20 minutes behind its timetable — Traffic at the junction\./);
    // The phase is unchanged: a delay is not a different kind of journey.
    expect(late.phase).toBe("under_way");
  });

  it("goes quiet once the run catches up: there is nothing left to act on", () => {
    const w = build();
    const running = { ...tripOf(w.db, w.tripId), status: "in_progress" as const };
    const normal = journeyStateOf(running, null, w.riderId);
    const cleared = journeyStateOf(
      { ...running, delays: [delayEntry(20, "Traffic"), delayEntry(0, "The road reopened")] },
      null,
      w.riderId,
    );
    // The history stays on the run for the office to explain afterwards; the rider is not made to
    // read a warning about something that is no longer true.
    expect(cleared.detail).toBe(normal.detail);
  });

  it("stays quiet on a finished run: its lateness is in the stop times, not a live claim", () => {
    const w = build();
    const done = { ...tripOf(w.db, w.tripId), status: "completed" as const, delays: [delayEntry(20, "Traffic")] };
    expect(journeyStateOf(done, null, w.riderId).detail).not.toMatch(/behind its timetable/);
  });
});
