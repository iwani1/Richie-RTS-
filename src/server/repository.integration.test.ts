// Integration tests against a real PostgreSQL.
//
// These exist to prove the claims the brief makes about the *database* rather than the UI:
//   §5.1  two overlapping bookings of the same vehicle cannot both exist;
//   §5.3  the audit log is append-only, enforced by a trigger, not by convention;
//   §5.7  an odometer reading cannot go backwards.
//
// Run with:
//   TEST_DATABASE_URL="postgresql://richie:dev@127.0.0.1:5432/richie_tms_test" npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { closeDb, db } from "./db";
import { loadDatabase, saveDatabase, truncateAll } from "./repository";
import { emptyDatabase, emptyRentalSettings, type Database, type Rental, type User, type Vehicle } from "../tms/types";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

const NOW = "2026-06-01T08:00:00.000Z";

function vehicle(id: string, registration: string): Vehicle {
  return {
    id,
    registration,
    categoryId: "cat-1",
    make: "Toyota",
    model: "Coaster",
    seatCapacity: 30,
    status: "available",
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function rental(id: string, overrides: Partial<Rental>): Rental {
  return {
    id,
    reference: `RR-${id}`,
    clientId: null,
    customerName: "Integration Test",
    customerPhone: "+233 00 000 0000",
    customerEmail: "test@example.invalid",
    purpose: "Test",
    pickupLocation: "Depot",
    dropoffLocation: "Site",
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    passengers: 10,
    vehicleCategoryId: "cat-1",
    driverRequired: false,
    notes: "",
    status: "confirmed",
    quote: null,
    quoteHistory: [],
    assignedVehicleId: "veh-1",
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function snapshotWith(rentals: Rental[]): Database {
  const base = emptyDatabase();
  return {
    ...base,
    settings: { ...base.settings, rental: emptyRentalSettings() },
    vehicles: [vehicle("veh-1", "GT 1000-26")],
    rentals,
  };
}

async function write(database: Database, before: Database = emptyDatabase()): Promise<void> {
  await db()
    .transaction()
    .execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
      await saveDatabase(trx, before, database);
    });
}

suite("PostgreSQL constraints, through the repository", () => {
  beforeAll(async () => {
    if (!connectionString) return;
    process.env.DATABASE_URL = connectionString;
    const { migrate } = await import("../../scripts/migrate");
    await migrate(connectionString, () => undefined);
    await db()
      .transaction()
      .execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
        await truncateAll(trx);
      });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("stores and reads back a confirmed rental with its reservation", async () => {
    const database = snapshotWith([rental("rent-1", { startDate: "2026-07-01", endDate: "2026-07-03" })]);
    await write(database);

    const reloaded = await loadDatabase();
    expect(reloaded.rentals.map((r) => r.id)).toEqual(["rent-1"]);
    expect(reloaded.vehicles[0].registration).toBe("GT 1000-26");

    const reservations = await db()
      .selectFrom("resource_reservation")
      .select(["resource_id", "period", "active"])
      .where("resource_id", "=", "veh-1")
      .execute();
    expect(reservations).toHaveLength(1);
    // Postgres 14+ canonicalises an inclusive upper bound: 1–3 July is stored and displayed as
    // [2026-07-01,2026-07-04). The inclusive `[]` literal in the migration is still the meaning.
    expect(reservations[0].period).toBe("[2026-07-01,2026-07-04)");
    expect(reservations[0].active).toBe(true);
  });

  it("refuses a second booking of the same vehicle on overlapping dates (SQLSTATE 23P01)", async () => {
    // 1–3 July is already reserved. 2–5 July overlaps by two days.
    const database = snapshotWith([
      rental("rent-1", { startDate: "2026-07-01", endDate: "2026-07-03" }),
      rental("rent-2", { startDate: "2026-07-02", endDate: "2026-07-05" }),
    ]);

    await expect(write(database)).rejects.toMatchObject({ code: "23P01" });

    // Nothing was written: the transaction rolled back, so the first booking is untouched.
    const reservations = await db().selectFrom("resource_reservation").select(["id"]).execute();
    expect(reservations).toHaveLength(1);
  });

  it("accepts back-to-back bookings, because the range is inclusive and non-overlapping", async () => {
    const database = snapshotWith([
      rental("rent-1", { startDate: "2026-07-01", endDate: "2026-07-03" }),
      rental("rent-2", { startDate: "2026-07-04", endDate: "2026-07-06" }),
    ]);
    await write(database);

    const reservations = await db().selectFrom("resource_reservation").select(["resource_id"]).execute();
    expect(reservations).toHaveLength(2);
  });

  it("refuses to rewrite or delete an audit entry", async () => {
    const entry = await db().selectFrom("audit_entry").select(["id"]).limit(1).executeTakeFirst();
    if (!entry) {
      // The seeded writes above produced no audit rows (they bypassed the command layer), so make
      // one directly: the trigger, not the writer, is what is under test.
      await sql`
        insert into audit_entry (id, at, actor_id, actor_name, action, entity, entity_id, summary)
        values ('audit-integration-1', now(), null, 'Integration', 'test:append', 'test', 'x', 'append test')
      `.execute(db());
    }
    await expect(
      sql`update audit_entry set summary = 'rewritten' where action = 'test:append'`.execute(db()),
    ).rejects.toThrow();
    await expect(sql`delete from audit_entry where action = 'test:append'`.execute(db())).rejects.toThrow();
  });

  it("refuses an odometer reading that goes backwards", async () => {
    const insert = (id: string, km: number, date: string) => sql`
      insert into odometer_reading (id, vehicle_id, reading_km, reading_date, status, note, void_reason, created_at, created_by, data)
      values (${id}, 'veh-1', ${km}, ${date}::date, 'current', '', null, now(), 'integration', ${JSON.stringify({ id })}::jsonb)
    `.execute(db());

    await insert("odo-1", 150_000, "2026-07-01");
    await expect(insert("odo-2", 140_000, "2026-07-02")).rejects.toThrow();
  });

  it("stores several contact accounts against one client (migration 005, Q-38)", async () => {
    const account = (id: string, email: string, primaryContact: boolean): User => ({
      id,
      fullName: `Contact ${id}`,
      email,
      role: "client_contact",
      active: true,
      driverId: null,
      clientId: "client-1",
      passengerId: null,
      primaryContact,
      passwordHash: "argon2id-hash",
      passwordSalt: "salt",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Diffed against what is already there, so unrelated rows from earlier tests stay put (a
    // vehicle cannot be deleted while odometer readings still point at it).
    const before = await loadDatabase();
    const database: Database = {
      ...before,
      clients: [
        ...before.clients,
        { id: "client-1", name: "Northstar Foods", contactName: "", contactPhone: "", contactEmail: "", reference: "", type: null, billingAddress: "", tin: "", notes: "", registrationNumber: "", registeredOn: "", status: "active", createdAt: NOW, updatedAt: NOW },
      ],
      users: [...before.users, account("user-1", "ops@northstar.test", false), account("user-2", "accounts@northstar.test", true)],
    };

    // Before migration 005 the unique index on app_user.client_id refused the second row outright.
    await write(database, before);
    const reloaded = await loadDatabase();
    const accounts = reloaded.users.filter((u) => u.clientId === "client-1");
    expect(accounts.map((u) => u.email).sort()).toEqual(["accounts@northstar.test", "ops@northstar.test"]);
    // The primary mark is carried in the row's data, so it survives the round trip.
    expect(accounts.filter((u) => u.primaryContact).map((u) => u.email)).toEqual(["accounts@northstar.test"]);
  });

  it("stores the branches of a client and keeps a closed one (migration 019, CLI-01)", async () => {
    const before = await loadDatabase();
    const client = {
      id: "client-branches",
      name: "Harbour Logistics",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      reference: "HBL-77",
      type: "organisation" as const,
      billingAddress: "",
      tin: "",
      notes: "",
      registrationNumber: "",
      registeredOn: "",
      status: "active" as const,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const database: Database = {
      ...before,
      clients: [...before.clients, client],
      clientLocations: [
        ...before.clientLocations,
        { id: "loc-1", clientId: client.id, name: "Tema depot", address: "Harbour Road", phone: "", contactName: "Yaw", status: "active", createdAt: NOW, updatedAt: NOW },
        { id: "loc-2", clientId: client.id, name: "Old yard", address: "Closed road", phone: "", contactName: "", status: "closed", createdAt: NOW, updatedAt: NOW },
      ],
    };

    await write(database, before);
    const reloaded = await loadDatabase();
    const stored = reloaded.clientLocations.filter((location) => location.clientId === client.id);
    expect(stored.map((location) => location.name).sort()).toEqual(["Old yard", "Tema depot"]);
    // Closing a branch is a status, not a delete: it is still there with its address.
    expect(stored.find((location) => location.id === "loc-2")?.status).toBe("closed");
    expect(stored.find((location) => location.id === "loc-2")?.address).toBe("Closed road");
  });

  it("refuses two branches of one client with the same name, whatever the case (migration 019)", async () => {
    // Inserted directly: the index is the database's own rule, independent of the validator.
    await expect(
      sql`
        insert into client_location (id, client_id, name, address, phone, contact_name, status, created_at, updated_at, data)
        values ('loc-dup', 'client-branches', '  tema  DEPOT ', '', '', '', 'active', now(), now(), '{}'::jsonb)
      `.execute(db()),
    ).rejects.toThrow(/client_location_name_uq|duplicate key/);
  });

  it("still refuses a second account for the same driver record", async () => {
    const insert = (id: string) => sql`
      insert into app_user (id, full_name, email, role, active, driver_id, client_id, password_hash, password_salt, created_at, updated_at, data)
      values (${id}, ${`Driver ${id}`}, ${`${id}@example.test`}, 'driver', true, 'driver-1', null, 'hash', 'salt', now(), now(), ${JSON.stringify({ id })}::jsonb)
    `.execute(db());
    await insert("driver-user-1");
    await expect(insert("driver-user-2")).rejects.toThrow();
  });
});
