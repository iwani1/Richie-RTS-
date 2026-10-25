// The concurrency proof the Phase 1A gate asks for, against a real PostgreSQL.
//
// Two dispatchers, one vehicle, the same week. The exit criterion is that only one of them can win,
// and that the loser is told so in a sentence rather than handed a 500 (or, worse, that both are
// told they succeeded).
//
// Two levels are tested, because they protect against different things:
//   1. `runCommand` — the path the HTTP route uses. Writes are serialised by an advisory lock, so
//      the later request sees the first one's assignment and is refused by the service check.
//   2. `saveDatabase` with no lock in front of it — two transactions racing on the same period.
//      Nothing in the application serialises these, so the exclusion constraint is the only thing
//      between the company and a double booking. If this ever passes with two winners, the
//      constraint has been dropped or weakened.
//
// Run with:
//   TEST_DATABASE_URL="postgresql://richie:dev@127.0.0.1:5432/richie_tms_test" npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { closeDb, db } from "./db";
import { runCommand } from "./commands";
import { loadDatabase, saveDatabase, truncateAll } from "./repository";
import type { AnyCommand } from "../tms/commands";
import { emptyDatabase, type Database, type Rental, type Vehicle } from "../tms/types";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

const NOW = "2026-06-01T08:00:00.000Z";
const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

async function command(type: string, body: Record<string, unknown>, userId: string | null) {
  return runCommand({ type, ...body } as AnyCommand, { userId, now: NOW });
}

async function step(type: string, body: Record<string, unknown>, userId: string | null): Promise<Database> {
  const result = await command(type, body, userId);
  if (!result.ok) throw new Error(`${type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.database;
}

/** An administrator, one category, one vehicle and the settings a rental needs. */
async function world(): Promise<{ adminId: string; vehicleId: string }> {
  const setup = await step("setup_administrator", { input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, null);
  const adminId = setup.users[0].id;
  const configured = await step(
    "update_settings",
    {
      input: {
        ...setup.settings,
        companyName: "Richie Transport Services",
        currencyCode: "GHS",
        vehicleCategories: [{ id: "", name: "Coaster" }],
        rental: {
          ...setup.settings.rental,
          pricingBasis: "per_day",
          depositPercent: 20,
          quotationValidityDays: 14,
          paymentMethods: ["Cash", "Bank transfer"],
        },
      },
    },
    adminId,
  );
  const created = await step(
    "create_vehicle",
    { input: { registration: "GT 1000-26", categoryId: configured.settings.vehicleCategories[0].id, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" } },
    adminId,
  );
  return { adminId, vehicleId: created.vehicles[0].id };
}

/** A rental taken as far as "confirmed", which is the state assignment requires. */
async function confirmedRental(adminId: string, name: string): Promise<{ id: string }> {
  const categoryId = (await loadDatabase()).settings.vehicleCategories[0].id;
  const created = await step(
    "create_rental",
    {
      input: {
        clientId: null,
        customerName: name,
        customerPhone: "+233 24 000 0000",
        customerEmail: "ops@example.test",
        purpose: "Staff retreat",
        pickupLocation: "Accra",
        dropoffLocation: "Kumasi",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        passengers: "12",
        vehicleCategoryId: categoryId,
        driverRequired: false,
        notes: "",
      },
    },
    adminId,
  );
  const rental = created.rentals[created.rentals.length - 1];
  await step("quote_rental", { id: rental.id, input: { lines: [{ description: "Two days", quantity: "2", unitAmount: "1500" }] } }, adminId);
  await step("confirm_rental", { id: rental.id, input: { amount: "600", method: "Cash", reference: `DEP-${name.replace(/\s/g, "-")}` } }, adminId);
  return { id: rental.id };
}

function vehicleRow(id: string): Vehicle {
  return {
    id,
    registration: "GT 2000-26",
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

function rentalRow(id: string, vehicleId: string): Rental {
  return {
    id,
    reference: `RR-${id.slice(-2)}`,
    clientId: null,
    customerName: "Direct write",
    customerPhone: "+233 24 000 0000",
    customerEmail: "ops@example.test",
    purpose: "Test",
    pickupLocation: "Accra",
    dropoffLocation: "Kumasi",
    startDate: "2026-07-01",
    endDate: "2026-07-03",
    passengers: 10,
    vehicleCategoryId: "cat-1",
    driverRequired: false,
    notes: "",
    status: "confirmed",
    quote: null,
    quoteHistory: [],
    assignedVehicleId: vehicleId,
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

suite("concurrent dispatch, against PostgreSQL", () => {
  beforeAll(async () => {
    if (!connectionString) return;
    process.env.DATABASE_URL = connectionString;
    const { migrate } = await import("../../scripts/migrate");
    await migrate(connectionString, () => undefined);
  });

  beforeEach(async () => {
    if (!connectionString) return;
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

  it("lets exactly one of six simultaneous assignments win", async () => {
    const { adminId, vehicleId } = await world();
    const rentals = [];
    for (let i = 0; i < 6; i += 1) rentals.push(await confirmedRental(adminId, `Customer ${i + 1}`));

    const results = await Promise.all(
      rentals.map((rental) => command("assign_rental", { id: rental.id, input: { vehicleId, driverId: "" } }, adminId)),
    );

    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(5);
    for (const loser of losers) {
      if (loser.ok) throw new Error("unreachable: filtered to failures");
      // A readable conflict, not a 500 and not a constraint name.
      expect(loser.status).toBe(409);
      expect(loser.errors.vehicleId).toMatch(/already assigned to RR-/);
    }

    const stored = await loadDatabase();
    expect(stored.rentals.filter((rental) => rental.assignedVehicleId === vehicleId)).toHaveLength(1);

    const reservations = await db()
      .selectFrom("resource_reservation")
      .select(["resource_id", "period"])
      .where("resource_id", "=", vehicleId)
      .where("active", "=", true)
      .execute();
    expect(reservations).toHaveLength(1);
  }, 60_000);

  it("refuses the second of two overlapping writes with no application lock in the way", async () => {
    const base = emptyDatabase();
    // The vehicle is already in the database, so both writers see the same starting state and
    // neither is inserting it: the only thing left to race on is the booking itself.
    const seeded: Database = { ...base, vehicles: [vehicleRow("veh-race")] };
    await db()
      .transaction()
      .execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
        await saveDatabase(trx, base, seeded);
      });
    const before = await loadDatabase();

    // Both transactions start from that same state and assign a different rental to the same
    // vehicle over the same days. Nothing serialises them.
    const write = (rentalId: string) =>
      db()
        .transaction()
        .execute(async (trx) => {
          const after: Database = { ...before, rentals: [rentalRow(rentalId, "veh-race")] };
          await saveDatabase(trx, before, after);
        });

    const outcomes = await Promise.allSettled([write("rent-01"), write("rent-02")]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    // Both refusals are the database doing its job, and which one arrives depends on how the two
    // transactions interleave: 23P01 is the exclusion constraint rejecting the second booking,
    // 40P01 is PostgreSQL detecting the deadlock between two writers that each hold part of the
    // work. Asserting only 23P01 made this test fail on timing rather than on behaviour (CI run
    // 40161502901 caught it). The invariants below are what actually have to hold.
    expect(["23P01", "40P01"]).toContain(reason.code);

    const reservations = await db()
      .selectFrom("resource_reservation")
      .select(["resource_id"])
      .where("resource_id", "=", "veh-race")
      .where("active", "=", true)
      .execute();
    expect(reservations).toHaveLength(1);

    // The loser was rolled back whole: no rental without a reservation.
    const stored = await loadDatabase();
    expect(stored.rentals).toHaveLength(1);
  }, 60_000);
});
