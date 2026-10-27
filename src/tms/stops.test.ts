// Where a stop actually is (RTE-01, D-104).
//
// A stop was a name and a time, which is enough for a driver who already knows the estate and
// useless to anybody else. What is pinned here:
//
//   1. **Nothing is mandatory, and nothing is guessed.** A stop with no landmark is a fact, not a
//      failure; the screens print nothing rather than a placeholder.
//   2. **An address that is filled in must be real-shaped.** A mistyped Ghana Post GPS code is worse
//      than no code, because a driver follows it somewhere else. Half a coordinate pair is refused
//      for the same reason: it puts a pin in the sea and a driver believes it.
//   3. **Directions are not the route's identity.** Once trips exist the stop list is locked so
//      recorded runs still point at stops that exist — but a wrong landmark stays correctable, or a
//      driver follows a typo for the life of the route.
//   4. **Old routes keep working.** A route written before this phase gains blank directions.
import { describe, expect, it } from "vitest";

import { executeCommand, type AnyCommand } from "./commands";
import { execute, type Actor, type Credential } from "./service";
import { GHANA_POST_GPS_RE, STOP_DETAIL_LIMITS, migrateStop, readStopDetail, stopDetailLine, stopMapLink, stopsWithoutDirections } from "./stops";
import { emptyDatabase, emptyRentalSettings, migrate, type BusRoute, type Database } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const EMAILS = { admin: "admin@example.test", ops: "ops@example.test" } as const;
type Who = keyof typeof EMAILS;

const actorOf = (db: Database, who: Who): Actor => {
  const user = db.users.find((candidate) => candidate.email === EMAILS[who]);
  if (!user) throw new Error(`missing user ${who}`);
  return { id: user.id, fullName: user.fullName, role: user.role };
};

/** A world with one configured category and one client, ready for a route. */
function build(): Database {
  const setup = execute(emptyDatabase(), null, { type: "setup_administrator", input: { fullName: "Admin", email: EMAILS.admin }, credential: cred }, NOW);
  if (!setup.ok) throw new Error(setup.message);
  let db = setup.db;
  const run = (command: AnyCommand) => {
    const result = executeCommand(db, actorOf(db, "admin"), command, NOW);
    if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
    db = result.db;
  };
  run({ type: "create_user", input: { fullName: "Ops", email: EMAILS.ops, role: "operations", active: true }, credential: cred });
  run({
    type: "update_settings",
    input: {
      ...db.settings,
      currencyCode: "GHS",
      vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
      shifts: [],
      rental: emptyRentalSettings(),
      workTypes: ["Service"],
      costCategories: ["Parts"],
      maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
    },
  });
  run({ type: "create_client", input: { name: "Acme", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
  return db;
}

type StopArg = { id?: string; name: string; scheduledTime: string; landmark?: string; digitalAddress?: string; latitude?: string; longitude?: string };

const routeInput = (db: Database, stops: StopArg[]) => ({
  type: "create_route" as const,
  input: {
    name: "Estate run",
    clientId: db.clients[0].id,
    direction: "to_work" as const,
    shiftId: "",
    vehicleCategoryId: db.settings.vehicleCategories[0].id,
    weekdays: [1, 2, 3, 4, 5],
    startDate: "2026-01-01",
    endDate: "",
    status: "active" as const,
    stops,
  },
});

describe("reading the directions of a stop (RTE-01)", () => {
  it("keeps a landmark, a digital address and a position, and tidies what was typed", () => {
    const { errors, value } = readStopDetail(
      { landmark: "  Behind the Total filling station ", digitalAddress: " ga-123-4567 ", latitude: "5.603717", longitude: "-0.186964" },
      0,
    );
    expect(errors).toEqual({});
    // The postcode is printed in capitals on the sign, so it is stored that way.
    expect(value).toEqual({
      landmark: "Behind the Total filling station",
      digitalAddress: "GA-123-4567",
      latitude: "5.603717",
      longitude: "-0.186964",
    });
  });

  it("accepts a stop with nothing recorded, because that is a fact rather than a failure", () => {
    expect(readStopDetail({}, 3).errors).toEqual({});
    expect(readStopDetail({}, 3).value).toEqual({ landmark: "", digitalAddress: "", latitude: "", longitude: "" });
  });

  it("names the stop that is wrong, so the form can point at it", () => {
    const { errors } = readStopDetail({ landmark: "x".repeat(STOP_DETAIL_LIMITS.landmark + 1) }, 2);
    expect(Object.keys(errors)).toEqual(["stops.2.landmark"]);
    expect(errors["stops.2.landmark"]).toContain(`${STOP_DETAIL_LIMITS.landmark} characters`);
  });

  it("refuses an address that is not a Ghana Post GPS address", () => {
    for (const bad of ["GA-123", "GAB-123-4567", "123-456-7890", "GA 123 4567", "GA-12-4567"]) {
      const { errors } = readStopDetail({ digitalAddress: bad }, 0);
      expect(errors["stops.0.digitalAddress"], bad).toBe("A Ghana Post GPS address looks like GA-123-4567.");
    }
    // The real shape, including a four-digit district grid, is accepted.
    expect(GHANA_POST_GPS_RE.test("AK-039-5028")).toBe(true);
    expect(readStopDetail({ digitalAddress: "AK-039-5028" }, 0).errors).toEqual({});
  });

  it("refuses a coordinate that is not a position, and one outside the world", () => {
    expect(readStopDetail({ latitude: "five", longitude: "0" }, 0).errors["stops.0.latitude"]).toBe("Use decimal degrees, such as 5.603717.");
    expect(readStopDetail({ latitude: "91", longitude: "0" }, 0).errors["stops.0.latitude"]).toBe("Latitude is between -90 and 90.");
    expect(readStopDetail({ latitude: "0", longitude: "-181" }, 0).errors["stops.0.longitude"]).toBe("Longitude is between -180 and 180.");
    expect(readStopDetail({ latitude: "5.6037171", longitude: "0" }, 0).errors["stops.0.latitude"]).toBe("Use decimal degrees, such as 5.603717.");
  });

  it("refuses half a position, because a driver would believe it", () => {
    expect(readStopDetail({ latitude: "5.6" }, 1).errors["stops.1.longitude"]).toBe("Enter both coordinates, or neither.");
    expect(readStopDetail({ longitude: "-0.18" }, 1).errors["stops.1.latitude"]).toBe("Enter both coordinates, or neither.");
  });

  it("reads as one line, or nothing at all", () => {
    expect(stopDetailLine({ landmark: "Blue wall", digitalAddress: "GA-123-4567" })).toBe("Blue wall · GA-123-4567");
    expect(stopDetailLine({ landmark: "Blue wall", digitalAddress: "" })).toBe("Blue wall");
    expect(stopDetailLine({ landmark: "", digitalAddress: "" })).toBe("");
  });

  it("links to a map only when there is a position to link to", () => {
    const link = stopMapLink({ name: "Estate gate", latitude: "5.603717", longitude: "-0.186964" });
    expect(link).toContain("5.603717%2C-0.186964");
    expect(stopMapLink({ name: "Estate gate", latitude: "", longitude: "" })).toBeNull();
  });
});

describe("storing the directions of a route (RTE-01)", () => {
  it("saves the landmark, the address and the position on each stop", () => {
    const db = build();
    const result = executeCommand(
      db,
      actorOf(db, "admin"),
      routeInput(db, [
        { name: "Estate gate", scheduledTime: "06:00", landmark: "Blue wall", digitalAddress: "GA-123-4567" },
        { name: "Head office", scheduledTime: "06:30", latitude: "5.603717", longitude: "-0.186964" },
      ]),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [first, second] = result.db.routes[0].stops;
    expect(first.landmark).toBe("Blue wall");
    expect(first.digitalAddress).toBe("GA-123-4567");
    expect(second.latitude).toBe("5.603717");
    // The screen can find the second stop's position and offer a map link.
    expect(stopMapLink(second)).not.toBeNull();
  });

  it("refuses a bad address by stop number rather than saving it", () => {
    const db = build();
    const result = executeCommand(
      db,
      actorOf(db, "admin"),
      routeInput(db, [
        { name: "Estate gate", scheduledTime: "06:00", digitalAddress: "not-an-address" },
        { name: "Head office", scheduledTime: "06:30" },
      ]),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors["stops.0.digitalAddress"]).toBe("A Ghana Post GPS address looks like GA-123-4567.");
    expect(db.routes).toHaveLength(0);
  });

  it("counts the stops nobody has described, rather than calling the route complete", () => {
    const db = build();
    const created = executeCommand(
      db,
      actorOf(db, "admin"),
      routeInput(db, [
        { name: "Estate gate", scheduledTime: "06:00", landmark: "Blue wall" },
        { name: "Mid", scheduledTime: "06:15" },
        { name: "Head office", scheduledTime: "06:30" },
      ]),
      NOW,
    );
    if (!created.ok) throw new Error(created.message);

    expect(stopsWithoutDirections(created.db, created.db.routes[0].id)).toBe(2);
    expect(stopsWithoutDirections(created.db, "no-such-route")).toBe(0);
  });

  it("still lets a wrong landmark be corrected once trips exist", () => {
    // Trips lock the stop list so a recorded run keeps pointing at a stop that exists. The
    // directions are not part of that identity: leaving a typo in place would follow the driver.
    const db = build();
    const created = executeCommand(
      db,
      actorOf(db, "admin"),
      routeInput(db, [
        { name: "Estate gate", scheduledTime: "06:00", landmark: "Blue wall" },
        { name: "Head office", scheduledTime: "06:30" },
      ]),
      NOW,
    );
    if (!created.ok) throw new Error(created.message);
    const route = created.db.routes[0];

    // One trip on the route is enough to raise the lock.
    const withTrip: Database = {
      ...created.db,
      trips: [
        {
          id: "t1",
          reference: "TR-0001",
          routeId: route.id,
          serviceDate: "2026-06-01",
          driverId: null,
          vehicleId: null,
          status: "planned",
          stopLogs: [],
          boardings: [],
          rosterChanges: [],
        } as never,
      ],
    };

    // The form sends back the stop ids it was given; a stop is identified by that id, its name and
    // its time, and only the directions are being changed here.
    const input = routeInput(
      withTrip,
      route.stops.map((stop, i) => ({ id: stop.id, name: stop.name, scheduledTime: stop.scheduledTime, landmark: i === 0 ? "Green wall, not blue" : "" })),
    );
    const edited = executeCommand(withTrip, actorOf(withTrip, "admin"), { ...input, type: "update_route", id: route.id } as never, NOW);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.db.routes[0].stops[0].landmark).toBe("Green wall, not blue");
  });

  it("still refuses to change a stop's name or time once trips exist", () => {
    const db = build();
    const created = executeCommand(
      db,
      actorOf(db, "admin"),
      routeInput(db, [
        { name: "Estate gate", scheduledTime: "06:00" },
        { name: "Head office", scheduledTime: "06:30" },
      ]),
      NOW,
    );
    if (!created.ok) throw new Error(created.message);
    const route = created.db.routes[0];
    const withTrip: Database = {
      ...created.db,
      trips: [{ id: "t1", reference: "TR-0001", routeId: route.id, serviceDate: "2026-06-01", driverId: null, vehicleId: null, status: "planned", stopLogs: [], boardings: [], rosterChanges: [] } as never],
    };

    const renamed = routeInput(withTrip, [
      { name: "Estate gate", scheduledTime: "06:00" },
      { name: "Head office (new)", scheduledTime: "06:30" },
    ]);
    const result = executeCommand(withTrip, actorOf(withTrip, "admin"), { ...renamed, type: "update_route", id: route.id } as never, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.stops).toContain("locked");
  });
});

describe("routes written before the directions existed (RTE-01)", () => {
  it("reads an older backup with blank directions rather than a broken route", () => {
    const db = build();
    const route: BusRoute = {
      id: "r1",
      reference: "RT-001",
      name: "Old route",
      clientId: "c1",
      direction: "to_work",
      shiftId: "",
      vehicleCategoryId: "cat",
      weekdays: [1],
      startDate: "2026-01-01",
      endDate: null,
      stops: [{ id: "s1", name: "Gate", scheduledTime: "06:00" } as never],
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const migrated = migrate({ ...db, schemaVersion: 24, routes: [route] });
    expect(migrated?.routes[0].stops[0]).toMatchObject({ name: "Gate", landmark: "", digitalAddress: "", latitude: "", longitude: "" });
  });

  it("fills the four fields for a stop read outside a backup too", () => {
    expect(migrateStop({ id: "s1", name: "Gate", scheduledTime: "06:00" })).toEqual({
      id: "s1",
      name: "Gate",
      scheduledTime: "06:00",
      landmark: "",
      digitalAddress: "",
      latitude: "",
      longitude: "",
    });
  });
});
