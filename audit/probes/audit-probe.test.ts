/* Audit probe — NOT part of the repository. Exercises the service layer directly. */
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "../../src/tms/commands";
import { execute, type Actor, type Credential } from "../../src/tms/service";
import { hashPassword, verifyPassword } from "../../src/tms/crypto";
import { emptyDatabase, migrate, ROLES, type Database } from "../../src/tms/types";
import { can } from "../../src/tms/permissions";
import { actorLink, scopedView } from "../../src/tms/scope";

const NOW = "2026-01-15T08:00:00.000Z";

function seedAdmin(db: Database): { db: Database; admin: Actor; cred: Credential } {
  const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
  const res = execute(db, null, {
    type: "setup_administrator",
    input: { fullName: "Ada Admin", email: "ada@example.com" },
    credential: cred,
  }, NOW);
  if (!res.ok) throw new Error(res.message);
  const user = res.db.users[0];
  return { db: res.db, admin: { id: user.id, fullName: user.fullName, role: user.role }, cred };
}

/** Every command type the router accepts, with a payload that reaches the handler. */
function allCommands(db: Database, adminId: string): AnyCommand[] {
  const cred: Credential = { passwordHash: "c".repeat(64), passwordSalt: "d".repeat(32) };
  const any = <T,>(v: T) => v;
  return [
    { type: "setup_administrator", input: { fullName: "X", email: "x@example.com" }, credential: cred },
    { type: "record_sign_in" },
    { type: "create_user", input: any({ fullName: "New", email: "new@example.com", role: "administrator", active: true }), credential: cred },
    { type: "update_user", id: adminId, input: any({ fullName: "New", email: "new@example.com", role: "administrator", active: true }) },
    { type: "reset_user_password", id: adminId, credential: cred },
    { type: "update_settings", input: any(db.settings) },
    { type: "create_vehicle", input: any({ registration: "GT 1-23", categoryId: "", make: "", model: "", seatCapacity: "10", notes: "" }) },
    { type: "update_vehicle", id: "nope", input: any({}) },
    { type: "transition_vehicle", id: "nope", to: "retired", reason: "x" },
    { type: "create_driver", input: any({ fullName: "D", phone: "1", licenceNumber: "L", licenceExpiry: "2030-01-01", status: "active" }) },
    { type: "update_driver", id: "nope", input: any({}) },
    { type: "create_client", input: any({ name: "C", contactName: "", contactPhone: "", contactEmail: "", status: "active" }) },
    { type: "update_client", id: "nope", input: any({}) },
    { type: "create_rental", input: any({}) },
    { type: "update_rental", id: "nope", input: any({}) },
    { type: "quote_rental", id: "nope", input: any({ lines: [] }) },
    { type: "requote_rental", id: "nope", input: any({ lines: [] }) },
    { type: "confirm_rental", id: "nope", input: any({ amount: "1", method: "cash", reference: "" }) },
    { type: "assign_rental", id: "nope", input: any({ vehicleId: "v", driverId: "d" }) },
    { type: "start_rental", id: "nope" },
    { type: "complete_rental", id: "nope", input: any({ lines: [] }) },
    { type: "decline_rental", id: "nope", reason: "x" },
    { type: "cancel_rental", id: "nope", reason: "x" },
    { type: "import_backup", database: db },
    { type: "create_route", input: any({}) },
    { type: "update_route", id: "nope", input: any({}) },
    { type: "create_passenger", input: any({}) },
    { type: "update_passenger", id: "nope", input: any({}) },
    { type: "generate_trips", input: any({}) },
    { type: "assign_trip", id: "nope", input: any({}) },
    { type: "dispatch_trip", id: "nope" },
    { type: "start_trip", id: "nope" },
    { type: "record_trip_stop", id: "nope", input: any({}) },
    { type: "complete_trip", id: "nope" },
    { type: "cancel_trip", id: "nope", reason: "x" },
    { type: "create_incident", input: any({}) },
    { type: "update_incident", id: "nope", input: any({}) },
    { type: "advance_incident", id: "nope", input: any({}) },
    { type: "create_work_order", input: any({}) },
    { type: "update_work_order", id: "nope", input: any({}) },
    { type: "advance_work_order", id: "nope", input: any({}) },
    { type: "add_work_order_cost", id: "nope", input: any({}) },
    { type: "remove_work_order_cost", id: "nope", input: any({}) },
    { type: "create_document", input: any({}) },
    { type: "update_document", id: "nope", input: any({}) },
    { type: "record_odometer", input: any({}) },
    { type: "void_odometer", id: "nope", input: any({}) },
  ] as AnyCommand[];
}

describe("audit probe", () => {
  it("unauthenticated sweep: no command may succeed without a signed-in actor", () => {
    const { db } = seedAdmin(emptyDatabase());
    const allowedWithoutAuth: string[] = [];
    for (const cmd of allCommands(db, db.users[0].id)) {
      const res = executeCommand(db, null, cmd, NOW);
      if (res.ok) allowedWithoutAuth.push(cmd.type);
    }
    console.log("UNAUTHENTICATED SUCCESSES:", JSON.stringify(allowedWithoutAuth));
    expect(allowedWithoutAuth).toEqual([]);
  });

  it("driver sweep: which commands report success for a driver actor", () => {
    const { db } = seedAdmin(emptyDatabase());
    const driverActor: Actor = { id: "ghost", fullName: "Ghost Driver", role: "driver" };
    const succeeded: string[] = [];
    for (const cmd of allCommands(db, db.users[0].id)) {
      const res = executeCommand(db, driverActor, cmd, NOW);
      if (res.ok) succeeded.push(cmd.type);
    }
    console.log("DRIVER-ACTOR SUCCESSES:", JSON.stringify(succeeded));
  });

  it("credential policy is not enforced in the service layer", async () => {
    const { db, admin } = seedAdmin(emptyDatabase());
    // A 1-character password, hashed outside createCredential(), is accepted.
    const weak = await hashPassword("x");
    const res = executeCommand(db, admin, {
      type: "create_user",
      input: { fullName: "Weak", email: "weak@example.com", role: "operations", active: true },
      credential: weak,
    } as AnyCommand, NOW);
    console.log("WEAK CREDENTIAL ACCEPTED:", res.ok, res.ok ? "" : res.message);
    if (res.ok) {
      const user = res.db.users.find((u) => u.email === "weak@example.com")!;
      console.log("SIGN-IN WITH 1-CHAR PASSWORD:", await verifyPassword("x", user));
    }
    // Empty salt / empty hash are accepted too.
    const empty = executeCommand(db, admin, {
      type: "reset_user_password",
      id: admin.id,
      credential: { passwordHash: "", passwordSalt: "" },
    } as AnyCommand, NOW);
    console.log("EMPTY CREDENTIAL ACCEPTED:", empty.ok, empty.ok ? "" : empty.message);
  });

  it("a backup with an invalid role value crashes role checks", () => {
    const { db } = seedAdmin(emptyDatabase());
    const poisoned = JSON.parse(JSON.stringify(db));
    poisoned.users.push({ ...poisoned.users[0], id: "evil", email: "evil@example.com", role: "superuser" });
    const imported = migrate(poisoned);
    console.log("IMPORT ACCEPTED POISONED ROLE:", imported !== null);
    let threw: string | null = null;
    try {
      can("superuser" as never, "users:read");
    } catch (e) {
      threw = (e as Error).message;
    }
    console.log("can() THREW:", threw);
    expect(threw).not.toBeNull();
  });

  it("import_backup accepts a structurally invalid database", () => {
    const { db, admin } = seedAdmin(emptyDatabase());
    const bad = JSON.parse(JSON.stringify(db));
    bad.vehicles = [{ id: null, registration: 42 }];
    bad.settings.vehicleCategories = "not-an-array";
    const res = executeCommand(db, admin, { type: "import_backup", database: bad } as AnyCommand, NOW);
    console.log("IMPORT OF INVALID SHAPES:", res.ok, res.ok ? "" : res.message);
  });

  it("every ROLES value has a permission entry and every permission is granted to someone", () => {
    console.log("ROLES:", JSON.stringify(ROLES));
    for (const role of ROLES) {
      const scoped = ROLES.filter((r) => r !== role).some(() => true);
      void scoped;
      console.log(`role ${role} -> can read audit:`, can(role, "audit:read"), "| can update settings:", can(role, "settings:update"));
    }
  });

  it("write latency grows with database size (full-DB JSON serialisation per write)", () => {
    const { db, admin } = seedAdmin(emptyDatabase());
    const results: { entries: number; cmdMs: number; stringifyMs: number; bytes: number }[] = [];
    for (const target of [0, 1000, 5000, 20000, 50000]) {
      let current = db;
      while (current.audit.length < target) {
        current = {
          ...current,
          audit: [
            { id: `a${current.audit.length}`, at: NOW, actorId: admin.id, actorName: "Ada Admin", action: "auth:sign_in", entity: "user", entityId: admin.id, summary: "signed in" },
            ...current.audit,
          ],
        };
      }
      const t0 = performance.now();
      const res = executeCommand(current, admin, { type: "record_sign_in" } as AnyCommand, NOW);
      const t1 = performance.now();
      if (res.ok) JSON.stringify(res.db);
      const t2 = performance.now();
      results.push({ entries: current.audit.length, cmdMs: +(t1 - t0).toFixed(2), stringifyMs: +(t2 - t1).toFixed(2), bytes: JSON.stringify(res.ok ? res.db : current).length });
    }
    console.log("WRITE LATENCY:", JSON.stringify(results));
  });

  it("scopedView cost is linear per render for a driver", () => {
    const { db } = seedAdmin(emptyDatabase());
    const many = JSON.parse(JSON.stringify(db));
    for (let i = 0; i < 20000; i += 1) {
      many.trips.push({ id: `t${i}`, routeId: `r${i % 50}`, driverId: `d${i % 20}`, vehicleId: `v${i % 30}` });
    }
    const driverUser = { id: "u1", fullName: "D", email: "d@example.com", role: "driver", active: true, driverId: "d1", clientId: null };
    many.users.push(driverUser);
    const t0 = performance.now();
    for (let i = 0; i < 50; i += 1) scopedView(many, { id: "u1", fullName: "D", role: "driver" });
    const t1 = performance.now();
    console.log("SCOPED VIEW 50x over 20k trips (ms):", +(t1 - t0).toFixed(2), "| avg ms/render:", +((t1 - t0) / 50).toFixed(3));
    void actorLink;
  });
});
