// What leaves the server, per role.
//
// These tests exist because the read path had no authorisation for most of this project's life: a
// driver account received every client, every other driver's trips and the audit log (audit F-01).
// They assert the shape of the payload the HTTP layer sends, not what a screen chooses to render.
import { describe, expect, it } from "vitest";
import { SNAPSHOT_AUDIT_LIMIT, scopeDatabase, visibleSnapshot } from "./visibility";
import { emptyDatabase, type AuditEntry, type Client, type Database, type Driver, type Trip, type User, type Vehicle } from "../tms/types";

const at = "2026-01-01T00:00:00.000Z";

const user = (id: string, role: User["role"], links: Partial<User> = {}): User => ({
  id,
  fullName: `Person ${id}`,
  email: `${id}@example.test`,
  role,
  active: true,
  driverId: null,
  clientId: null,
  primaryContact: false,
  passwordHash: `argon2id-hash-${id}`,
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
  ...links,
});

const driver = (id: string): Driver => ({
  id,
  fullName: `Driver ${id}`,
  phone: "+233 00 000 0000",
  licenceNumber: `DL-${id}`,
  licenceExpiry: "2030-01-01",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const vehicle = (id: string): Vehicle => ({
  id,
  registration: `GT-${id}`,
  categoryId: "cat",
  make: "Toyota",
  model: "Hiace",
  seatCapacity: 14,
  status: "available",
  notes: "",
  createdAt: at,
  updatedAt: at,
});

const client = (id: string): Client => ({
  id,
  name: `Client ${id}`,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  status: "active",
  createdAt: at,
  updatedAt: at,
});

const trip = (id: string, driverId: string, vehicleId: string, routeId: string): Trip => ({
  id,
  reference: `TR-${id}`,
  routeId,
  serviceDate: "2026-01-01",
  status: "planned",
  vehicleId,
  driverId,
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
  cancelReason: null,
  cancelledAt: null,
  cancelledBy: null,
  incidentId: null,
  stopLogs: [],
  boardings: [],
  onTimeThresholdMinutes: null,
  corrections: [], rosterChanges: [],
  origin: "schedule",
  originReason: null,
  createdAt: at,
  updatedAt: at,
});

const audit = (n: number): AuditEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `a-${i}`,
    at: new Date(Date.parse(at) + i * 1000).toISOString(),
    actorId: null,
    actorName: "Operations",
    action: "vehicles:create",
    entity: "vehicle",
    entityId: "v1",
    summary: "Vehicle added.",
  }));

function world(): Database {
  const base = emptyDatabase();
  return {
    ...base,
    users: [
      user("admin", "administrator"),
      user("driver-user", "driver", { driverId: "d1" }),
      user("other-driver-user", "driver", { driverId: "d2" }),
      user("client-user", "client_contact", { clientId: "c1" }),
      user("unlinked", "driver"),
    ],
    drivers: [driver("d1"), driver("d2")],
    clients: [client("c1"), client("c2")],
    vehicles: [vehicle("v1"), vehicle("v2")],
    routes: [
      {
        id: "r1",
        reference: "RT-001",
        name: "Route 1",
        clientId: "c1",
        direction: "to_work",
        shiftId: null,
        vehicleCategoryId: "cat",
        startDate: "2026-01-01",
        endDate: null,
        status: "active",
        weekdays: [],
        stops: [],
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "r2",
        reference: "RT-002",
        name: "Route 2",
        clientId: "c2",
        direction: "to_work",
        shiftId: null,
        vehicleCategoryId: "cat",
        startDate: "2026-01-01",
        endDate: null,
        status: "active",
        weekdays: [],
        stops: [],
        createdAt: at,
        updatedAt: at,
      },
    ],
    trips: [trip("t1", "d1", "v1", "r1"), trip("t2", "d2", "v2", "r2")],
    audit: audit(1200),
  };
}

const actor = (id: string, role: User["role"]) => ({ id, fullName: `Person ${id}`, role });

describe("snapshot scope", () => {
  it("sends an unlinked or signed-out account nothing at all", () => {
    expect(scopeDatabase(world(), null)).toBeNull();
    const unlinked = scopeDatabase(world(), actor("unlinked", "driver"))!;
    // Their own account row is theirs to see; nothing else is.
    expect(unlinked.users.map((u) => u.id)).toEqual(["unlinked"]);
    expect(unlinked.drivers).toEqual([]);
    expect(unlinked.trips).toEqual([]);
    expect(unlinked.vehicles).toEqual([]);
  });

  it("gives a driver their own record, their trips and nothing else", () => {
    const visible = scopeDatabase(world(), actor("driver-user", "driver"))!;
    expect(visible.users.map((u) => u.id)).toEqual(["driver-user"]);
    expect(visible.drivers.map((d) => d.id)).toEqual(["d1"]);
    expect(visible.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(visible.vehicles.map((v) => v.id)).toEqual(["v1"]);
    // The fleet, the other driver, the client book and the audit log are not theirs.
    expect(visible.clients).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("withholds staff phone numbers from a client contact but keeps the manifest", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("client-user", "client_contact"))!;
    expect(visible.passengers.map((p) => p.fullName)).toEqual(["Ama Boateng"]);
    expect(visible.passengers.every((p) => p.phone === "")).toBe(true);
  });

  it("gives a client contact their own client and the trips run for it", () => {
    const visible = scopeDatabase(world(), actor("client-user", "client_contact"))!;
    expect(visible.clients.map((c) => c.id)).toEqual(["c1"]);
    expect(visible.routes.map((r) => r.id)).toEqual(["r1"]);
    expect(visible.trips.map((t) => t.id)).toEqual(["t1"]);
    expect(visible.drivers).toEqual([]);
    expect(visible.vehicles).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("gives finance rentals and costs but not the employee roster, documents, accounts or audit", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    w.documents = [
      { id: "doc1", ownerType: "driver", ownerId: "d1", documentTypeId: "t1", documentNumber: "DL-1", issuedDate: "2026-01-01", expiryDate: "2030-01-01", notes: "", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("fin", "finance"))!;
    // Billing context stays.
    expect(visible.clients.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(visible.trips).toHaveLength(2);
    expect(visible.vehicles).toHaveLength(2);
    // Personal and restricted records do not travel at all (brief section 6).
    expect(visible.passengers).toEqual([]);
    expect(visible.documents).toEqual([]);
    expect(visible.users).toEqual([]);
    expect(visible.audit).toEqual([]);
  });

  it("keeps the employee roster and audit trail for operations", () => {
    const w = world();
    w.passengers = [
      { id: "p1", clientId: "c1", fullName: "Ama Boateng", employeeRef: "E-1", phone: "+233200000001", routeId: "r1", stopId: null, status: "active", createdAt: at, updatedAt: at },
    ];
    const visible = scopeDatabase(w, actor("ops", "operations"))!;
    expect(visible.passengers.map((p) => p.id)).toEqual(["p1"]);
    expect(visible.audit).toHaveLength(SNAPSHOT_AUDIT_LIMIT);
  });

  it("keeps company-wide access for internal staff, and bounds the audit window", () => {
    const { database, auditTotal } = visibleSnapshot(world(), actor("admin", "administrator"));
    expect(database!.users).toHaveLength(5);
    expect(database!.trips).toHaveLength(2);
    expect(database!.audit).toHaveLength(SNAPSHOT_AUDIT_LIMIT);
    expect(auditTotal).toBe(1200);
  });

  it("never sends credential material, whatever the role", () => {
    for (const [id, role] of [
      ["admin", "administrator"],
      ["driver-user", "driver"],
      ["client-user", "client_contact"],
    ] as const) {
      const visible = scopeDatabase(world(), actor(id, role))!;
      expect(visible.users.every((u) => u.passwordHash === "" && u.passwordSalt === "")).toBe(true);
    }
  });

  it("reports the true audit count even when it sends none of the rows", () => {
    const visible = visibleSnapshot(world(), actor("driver-user", "driver"));
    expect(visible.database!.audit).toEqual([]);
    expect(visible.auditTotal).toBe(1200);
  });
});
