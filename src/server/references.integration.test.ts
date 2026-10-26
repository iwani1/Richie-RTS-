// The numbering guarantee, proved against PostgreSQL rather than against a pure function.
//
// Three things can only be shown with a real database:
//   1. the counter is written in the same transaction as the record it numbers, and is still there
//      after a reload (a series that lives only in memory restarts at 1 on the next deploy);
//   2. deleting a record does not free its number — the failure audit D-03 describes;
//   3. the counter cannot be rewound, so a restore of an older backup cannot reissue a number.
//
// Run with:
//   TEST_DATABASE_URL="postgresql://richie:dev@127.0.0.1:5432/richie_tms_test" npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { closeDb, db } from "./db";
import { runCommand } from "./commands";
import { loadDatabase, truncateAll } from "./repository";
import type { AnyCommand } from "../tms/commands";
import { emptyDatabase, type Database } from "../tms/types";
import { REFERENCE_SERIES } from "../tms/references";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

const NOW = "2026-06-01T08:00:00.000Z";
const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

async function step(type: string, body: Record<string, unknown>, userId: string | null): Promise<Database> {
  const result = await runCommand({ type, ...body } as AnyCommand, { userId, now: NOW });
  if (!result.ok) throw new Error(`${type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.database;
}

async function world(): Promise<{ adminId: string; categoryId: string }> {
  const setup = await step("setup_administrator", { input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, null);
  const adminId = setup.users[0].id;
  const configured = await step(
    "update_settings",
    {
      input: {
        ...setup.settings,
        currencyCode: "GHS",
        vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
        rental: { ...setup.settings.rental, pricingBasis: "per_day", depositPercent: 20, paymentMethods: ["Cash"] },
      },
    },
    adminId,
  );
  return { adminId, categoryId: configured.settings.vehicleCategories[0].id };
}

const request = (categoryId: string, name: string) => ({
  input: {
    clientId: null,
    customerName: name,
    customerPhone: "",
    customerEmail: "",
    purpose: "",
    pickupLocation: "",
    dropoffLocation: "",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    passengers: "10",
    vehicleCategoryId: categoryId,
    driverRequired: false,
    notes: "",
  },
});

suite("reference numbering, against PostgreSQL", () => {
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

  it("stores the counter with the record, and reads it back on the next command", async () => {
    const { adminId, categoryId } = await world();
    const first = await step("create_rental", request(categoryId, "First"), adminId);
    expect(first.rentals[0].reference).toBe("RR-0001");

    // Straight from the table, not from the returned snapshot: if this row is missing, the series
    // restarts at 1 on the next process.
    const stored = await db().selectFrom("reference_counter").selectAll().execute();
    expect(stored).toEqual([{ scope: "rental", period: "all", last: 1 }]);

    const reloaded = await loadDatabase();
    expect(reloaded.referenceCounters).toEqual([{ scope: "rental", period: "all", last: 1 }]);

    const second = await step("create_rental", request(categoryId, "Second"), adminId);
    expect(second.rentals.map((rental) => rental.reference)).toEqual(["RR-0001", "RR-0002"]);
  });

  it("does not hand a deleted record's number to the next record", async () => {
    const { adminId, categoryId } = await world();
    await step("create_rental", request(categoryId, "First"), adminId);
    const second = await step("create_rental", request(categoryId, "Second"), adminId);
    const doomed = second.rentals[1];

    // The shape a backup import or a hand correction leaves behind: the record is gone, the number
    // was already printed.
    await db().deleteFrom("rental").where("id", "=", doomed.id).execute();

    const third = await step("create_rental", request(categoryId, "Third"), adminId);
    expect(third.rentals.map((rental) => rental.reference)).toEqual(["RR-0001", "RR-0003"]);
  });

  it("refuses to rewind a series, so an older backup cannot reissue a number", async () => {
    const { adminId, categoryId } = await world();
    await step("create_rental", request(categoryId, "First"), adminId);
    const second = await step("create_rental", request(categoryId, "Second"), adminId);
    void second;

    await expect(
      db().updateTable("reference_counter").set({ last: 1 }).where("scope", "=", "rental").execute(),
    ).rejects.toThrow(/cannot move backwards/);

    // The series is intact after the refusal.
    const stored = await db().selectFrom("reference_counter").select("last").where("scope", "=", "rental").executeTakeFirstOrThrow();
    expect(stored.last).toBe(2);
  });

  it("keeps separate series for records and for money, in their own shapes", async () => {
    const { adminId, categoryId } = await world();
    const rentals = await step("create_rental", request(categoryId, "First"), adminId);
    void rentals;

    const counters = await db().selectFrom("reference_counter").selectAll().orderBy("scope").execute();
    expect(counters).toEqual([{ scope: "rental", period: "all", last: 1 }]);

    // An invoice series has not been touched, and starts at its own 1 when it is.
    const invoice = await db().selectFrom("reference_counter").selectAll().where("scope", "=", "invoice").execute();
    expect(invoice).toHaveLength(0);
    expect(emptyDatabase().referenceCounters).toEqual([]);
  });

  it("lets the database store a counter for every series the application can allocate", async () => {
    // A series is a name in `REFERENCE_SERIES` plus a check constraint listing which names
    // `reference_counter` may hold. Adding one and forgetting the constraint is invisible to every
    // unit test — the counter only meets the constraint where there is a database — and it showed up
    // as a 400 on the screen for refunds (010) before this test existed.
    const scopes = Object.keys(REFERENCE_SERIES);
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      await db()
        .insertInto("reference_counter")
        .values({ scope, period: "all", last: 1 })
        .execute();
    }

    const stored = await db().selectFrom("reference_counter").select("scope").orderBy("scope").execute();
    expect(stored.map((row) => row.scope).sort()).toEqual([...scopes].sort());
  });
});
