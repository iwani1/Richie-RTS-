// Optional demo data, for a trial installation only.
//
// Two locks, both deliberate:
//   1. ALLOW_DEMO_SEED=true must be set, and the script refuses outright when NODE_ENV=production.
//   2. DEMO_ADMIN_PASSWORD must be supplied. There is no default password in this repository,
//      because a shipped default is a published backdoor.
//
// The records below are illustrative, not business facts: rates, identifiers, phone numbers and
// licence numbers are placeholders. Settings that the business must supply (currency, thresholds,
// document types, service intervals) are left empty, exactly as the first-run UI leaves them.
import { loadEnvFile } from "./env-loader";
import { sql } from "kysely";
import { closeDb, db } from "../src/server/db";
import { loadDatabase, saveDatabase, truncateAll } from "../src/server/repository";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/server/password";
import { executeCommand, type AnyCommand } from "../src/tms/commands";
import type { Actor } from "../src/tms/service";
import { emptyDatabase, type Database } from "../src/tms/types";

let current: Database = emptyDatabase();

loadEnvFile();

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Refusing to seed: set ALLOW_DEMO_SEED=true in .env to load demo records.");
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed: demo data must never be loaded into production (brief integrity rule 9).");
    process.exit(1);
  }
  const email = (process.env.DEMO_ADMIN_EMAIL ?? "admin@richie.test").trim().toLowerCase();
  const password = process.env.DEMO_ADMIN_PASSWORD;
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    console.error(`Refusing to seed: set DEMO_ADMIN_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters) in .env.`);
    process.exit(1);
  }

  const credential = await hashPassword(password);
  let applied = 0;
  const run = async (actor: Actor | null, command: AnyCommand) => {
    const result = executeCommand(current, actor, command);
    if (!result.ok) throw new Error(`${command.type} refused: ${result.message} ${JSON.stringify(result.errors)}`);
    current = result.db;
    applied += 1;
    return result;
  };

  const pool = db();
  await pool.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(728411)`.execute(trx);
    const existing = await loadDatabase(trx);
    if (existing.users.length > 0) {
      throw new Error(
        "This installation already has accounts; demo data is only loaded into an empty database.\n" +
          "To replace what is there: npm run db:reset   (empties every table, keeps the schema)\n" +
          "then run npm run db:seed again. This deletes the records and accounts already present.",
      );
    }
    await truncateAll(trx);

    const seeded = await loadDatabase(trx);
    current = seeded;
    await run(null, { type: "setup_administrator", input: { fullName: "Demo Administrator", email }, credential });
    const admin: Actor = { id: current.users[0].id, fullName: current.users[0].fullName, role: "administrator" };

    // Vehicle categories come first: registration is blocked until a category exists (Q-04).
    await run(admin, {
      type: "update_settings",
      input: {
        ...current.settings,
        vehicleCategories: [
          { id: "", name: "Coaster (30 seats)" },
          { id: "", name: "Sprinter (14 seats)" },
        ],
      },
    });
    const [coaster, sprinter] = current.settings.vehicleCategories.map((category) => category.id);

    await run(admin, { type: "create_client", input: { name: "Demo Client — Manufacturing Ltd", contactName: "Demo Contact", contactPhone: "+233 00 000 0000", contactEmail: "demo@example.invalid", status: "active" } });
    const clientId = current.clients[0].id;

    await run(admin, { type: "create_vehicle", input: { registration: "GT 0001-26", categoryId: coaster, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "Demo record" } });
    await run(admin, { type: "create_vehicle", input: { registration: "GT 0002-26", categoryId: sprinter, make: "Mercedes-Benz", model: "Sprinter", seatCapacity: "14", notes: "Demo record" } });

    await run(admin, { type: "create_driver", input: { fullName: "Demo Driver One", phone: "+233 00 000 0001", licenceNumber: "DEMO-DL-0001", licenceExpiry: "2030-12-31", status: "active" } });
    await run(admin, { type: "create_driver", input: { fullName: "Demo Driver Two", phone: "+233 00 000 0002", licenceNumber: "DEMO-DL-0002", licenceExpiry: "2030-12-31", status: "active" } });

    await run(admin, {
      type: "create_route",
      input: {
        name: "Demo staff run (east estate)",
        clientId,
        direction: "to_work",
        shiftId: "",
        vehicleCategoryId: coaster,
        weekdays: [0, 1, 2, 3, 4],
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
        status: "active",
        stops: [
          { name: "Estate gate", scheduledTime: "06:00" },
          { name: "Market junction", scheduledTime: "06:20" },
          { name: "Head office", scheduledTime: "07:00" },
        ],
      },
    });

    await saveDatabase(trx, seeded, current);
  });

  console.log(`Demo data loaded: ${applied} records written. Sign in as ${email}.`);
  console.log("Settings that the business must supply are still empty by design: currency, on-time threshold,");
  console.log("document types, service intervals, and rental pricing/deposit rules.");
  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
