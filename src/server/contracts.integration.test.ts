// Contracts against PostgreSQL: the two guarantees the pure layer cannot give on its own.
//
// `contracts.test.ts` proves the rules in JavaScript. This file proves that the **database** refuses
// them too, because everything the domain layer checks is only a good error message until the table
// agrees:
//   1. an approved contract's terms cannot be rewritten — not by a bug in a command, not by a hand
//      `update` — while its status may still move (D-95);
//   2. a contract row is never deleted (brief 5.9);
//   3. the number it was given comes from `reference_counter` and the table accepts the series, so a
//      `CT-` counter cannot be refused by `012`'s constraint the way refunds once were.
//
// Run with:
//   TEST_DATABASE_URL="postgresql://richie:dev@127.0.0.1:5432/richie_tms_test" npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { closeDb, db } from "./db";
import { runCommand } from "./commands";
import { loadDatabase, truncateAll } from "./repository";
import type { AnyCommand } from "../tms/commands";
import type { Database } from "../tms/types";

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

const NOW = "2026-06-01T08:00:00.000Z";
const cred = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

async function step(type: string, body: Record<string, unknown>, userId: string | null): Promise<Database> {
  const result = await runCommand({ type, ...body } as AnyCommand, { userId, now: NOW });
  if (!result.ok) throw new Error(`${type} failed: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.database;
}

/** A signed-in administrator, a currency, and one corporate client to hold a contract. */
async function world(): Promise<{ adminId: string; clientId: string }> {
  const setup = await step("setup_administrator", { input: { fullName: "Admin", email: "admin@example.test" }, credential: cred }, null);
  const adminId = setup.users[0].id;
  const configured = await step("update_settings", { input: { ...setup.settings, currencyCode: "GHS" } }, adminId);
  void configured;
  const withClient = await step(
    "create_client",
    { input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active" } },
    adminId,
  );
  return { adminId, clientId: withClient.clients[0].id };
}

const contract = (clientId: string) => ({
  input: {
    clientId,
    serviceType: "staff_transport",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    routeIds: [],
    weekdays: [],
    shiftIds: [],
    vehicleCategoryId: "",
    pricingModel: "Monthly rate per bus",
    billingFrequency: "Monthly in arrears",
    paymentTerms: "30 days from invoice",
    serviceLevelTargets: "",
    notes: "",
  },
});

/** Draft a contract and approve it, returning its id and the number it was given. */
async function activeContract(clientId: string, adminId: string): Promise<{ id: string; reference: string }> {
  const drafted = await step("create_contract", contract(clientId), adminId);
  const row = drafted.contracts[0];
  await step("advance_contract", { id: row.id, to: "pending_approval", reason: "" }, adminId);
  await step("advance_contract", { id: row.id, to: "active", reason: "" }, adminId);
  return { id: row.id, reference: row.reference };
}

suite("contracts, against PostgreSQL", () => {
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

  it("takes its number from the counter, through the table's own scope list", async () => {
    const { adminId, clientId } = await world();
    const first = await step("create_contract", contract(clientId), adminId);
    expect(first.contracts[0].reference).toBe("CT-0001");

    // The counter row is written in the same transaction as the contract (D-03): if it were not, the
    // series would restart at 1 after a deploy.
    const stored = await db().selectFrom("reference_counter").selectAll().where("scope", "=", "contract").execute();
    expect(stored).toEqual([{ scope: "contract", period: "all", last: 1 }]);

    const second = await step("create_contract", contract(clientId), adminId);
    expect(second.contracts.map((row) => row.reference)).toEqual(["CT-0001", "CT-0002"]);

    const reloaded = await loadDatabase();
    expect(reloaded.contracts.map((row) => row.reference)).toEqual(["CT-0001", "CT-0002"]);
  });

  it("refuses to rewrite an approved contract's terms, whoever asks", async () => {
    const { adminId, clientId } = await world();
    const { id } = await activeContract(clientId, adminId);

    // The domain layer would refuse this too; the point is that a hand `update` cannot get past the
    // table when the domain layer is wrong (D-95).
    await expect(
      db().updateTable("contract").set({ start_date: "2026-02-01" }).where("id", "=", id).execute(),
    ).rejects.toThrow(/not rewritten/);

    await expect(
      db().updateTable("contract").set({ data: sql`jsonb_set(data, '{paymentTerms}', '"60 days"')` }).where("id", "=", id).execute(),
    ).rejects.toThrow(/not rewritten/);

    // A draft may still be corrected — approval is the gate, not creation.
    const draft = await step("create_contract", contract(clientId), adminId);
    const draftId = draft.contracts[1].id;
    await expect(
      db().updateTable("contract").set({ start_date: "2026-03-01" }).where("id", "=", draftId).execute(),
    ).resolves.toBeDefined();
  });

  it("lets the status move while the terms stay frozen", async () => {
    const { adminId, clientId } = await world();
    const { id } = await activeContract(clientId, adminId);

    await expect(
      db().updateTable("contract").set({ status: "suspended" }).where("id", "=", id).execute(),
    ).resolves.toBeDefined();

    const stored = await db().selectFrom("contract").select(["status"]).where("id", "=", id).executeTakeFirstOrThrow();
    expect(stored.status).toBe("suspended");
  });

  it("never deletes a contract, and refuses to bring a terminated one back", async () => {
    const { adminId, clientId } = await world();
    const { id } = await activeContract(clientId, adminId);

    await expect(db().deleteFrom("contract").where("id", "=", id).execute()).rejects.toThrow(/never deleted/);

    await db().updateTable("contract").set({ status: "terminated" }).where("id", "=", id).execute();
    await expect(
      db().updateTable("contract").set({ status: "active" }).where("id", "=", id).execute(),
    ).rejects.toThrow(/stays terminated/);
  });

  it("stores the transcribed terms and reads them back unchanged", async () => {
    const { adminId, clientId } = await world();
    const { id, reference } = await activeContract(clientId, adminId);

    const reloaded = await loadDatabase();
    const stored = reloaded.contracts.find((row) => row.id === id)!;
    expect(stored).toMatchObject({
      reference,
      clientName: "Acme Ltd",
      // Typed from the paper, exactly as entered — nothing is derived from the billing frequency.
      pricingModel: "Monthly rate per bus",
      billingFrequency: "Monthly in arrears",
      paymentTerms: "30 days from invoice",
      status: "active",
    });
  });
});
