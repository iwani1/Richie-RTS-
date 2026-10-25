// Contracts (brief CLI-02, D-95).
//
// What has to be true for the record to be worth keeping:
//   * the number is issued once and never reused;
//   * the terms are transcribed, validated against the company's own lists and never invented;
//   * approval is a gate: before it the record is an ordinary draft, after it the terms are frozen and
//     only the state moves, with a reason, into a history that names who moved it;
//   * "expired" is derived from the end date rather than stored, and both the screen and the booking
//     rule read the same word from the same function;
//   * a booking is refused only when the system actually has an agreement to point at.
import { describe, expect, it } from "vitest";
import { executeCommand, type AnyCommand } from "./commands";
import { bookingContractProblem, contractCovers, contractStateOf, contractsDueForRenewal, isContractEditable } from "./contracts";
import type { Actor, CommandResult, Credential } from "./service";
import { emptyDatabase, emptyRentalSettings, type Contract, type Database } from "./types";

const NOW = "2026-06-01T09:00:00.000Z";
const TODAY = "2026-06-01";
const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };

const actorOf = (db: Database, role: Actor["role"]): Actor => {
  const user = db.users.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`missing ${role} user`);
  return { id: user.id, fullName: user.fullName, role: user.role };
};

function run(db: Database, actor: Actor, command: AnyCommand, now = NOW): Database {
  const result = executeCommand(db, actor, command, now);
  if (!result.ok) throw new Error(`${command.type}: ${result.message} ${JSON.stringify(result.errors)}`);
  return result.db;
}
const attempt = (db: Database, actor: Actor, command: AnyCommand, now = NOW): CommandResult => executeCommand(db, actor, command, now);
const errorsOf = (result: CommandResult): Record<string, string> => (result.ok ? {} : result.errors);

interface World {
  db: Database;
  admin: Actor;
  ops: Actor;
  finance: Actor;
  clientId: string;
  otherClientId: string;
  routeId: string;
  otherRouteId: string;
  shiftId: string;
  categoryId: string;
}

function build(): World {
  let db = emptyDatabase();
  const setup = executeCommand(db, null, { type: "setup_administrator", input: { fullName: "Admin One", email: "admin@example.test" }, credential: cred }, NOW);
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
      vehicleCategories: [{ id: "", name: "Coaster" }],
      shifts: [{ id: "", name: "Day", startTime: "06:00", endTime: "14:00" }],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: 30,
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      workTypes: ["Service"],
      costCategories: [],
      maintenance: { schedules: [], blockOnOverdueService: false },
      booking: { requestCutoffMinutes: null, cancellationCutoffMinutes: null },
    },
  });
  const categoryId = db.settings.vehicleCategories[0].id;
  const shiftId = db.settings.shifts[0].id;
  db = run(db, finance, { type: "create_client", input: { name: "Acme Ltd", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
  db = run(db, finance, { type: "create_client", input: { name: "Beta Foods", contactName: "", contactPhone: "", contactEmail: "", status: "active" } });
  const clientId = db.clients[0].id;
  const otherClientId = db.clients[1].id;
  db = run(db, ops, {
    type: "create_route",
    input: {
      name: "Estate run",
      clientId,
      direction: "to_work",
      shiftId: "",
      vehicleCategoryId: categoryId,
      weekdays: [1, 2, 3, 4, 5],
      startDate: "2026-01-01",
      endDate: "",
      status: "active",
      stops: [
        { name: "Estate gate", scheduledTime: "06:00" },
        { name: "Head office", scheduledTime: "06:30" },
      ],
    },
  });
  db = run(db, ops, {
    type: "create_route",
    input: {
      name: "Beta run",
      clientId: otherClientId,
      direction: "to_work",
      shiftId: "",
      vehicleCategoryId: categoryId,
      weekdays: [1, 2, 3, 4, 5],
      startDate: "2026-01-01",
      endDate: "",
      status: "active",
      stops: [
        { name: "Gate", scheduledTime: "07:00" },
        { name: "Factory", scheduledTime: "07:40" },
      ],
    },
  });
  return { db, admin, ops, finance, clientId, otherClientId, routeId: db.routes[0].id, otherRouteId: db.routes[1].id, shiftId, categoryId };
}

const input = (w: World, over: Partial<Record<string, unknown>> = {}) => ({
  clientId: w.clientId,
  serviceType: "staff_transport" as const,
  startDate: "2026-06-01",
  endDate: "2026-12-31",
  routeIds: [w.routeId],
  weekdays: [1, 2, 3, 4, 5],
  shiftIds: [w.shiftId],
  vehicleCategoryId: w.categoryId,
  pricingModel: "Monthly rate per bus",
  billingFrequency: "Monthly in arrears",
  paymentTerms: "30 days from invoice",
  serviceLevelTargets: "On time within 10 minutes",
  notes: "",
  ...over,
});

const create = (w: World, over: Partial<Record<string, unknown>> = {}): Database => run(w.db, w.ops, { type: "create_contract", input: input(w, over) });
const contractOf = (db: Database): Contract => db.contracts[0];

/** Draft → awaiting approval → active, the path a real agreement takes. */
function approve(db: Database, w: World, now = NOW): Database {
  const id = contractOf(db).id;
  let next = run(db, w.ops, { type: "advance_contract", id, to: "pending_approval", reason: "" }, now);
  next = run(next, w.admin, { type: "advance_contract", id, to: "active", reason: "" }, now);
  return next;
}

describe("contracts - the record (CLI-02)", () => {
  it("drafts a numbered contract from the paper, with a first history entry", () => {
    const w = build();
    const db = create(w);
    const contract = contractOf(db);

    expect(contract.reference).toBe("CT-0001");
    expect(contract.status).toBe("draft");
    expect(contract.clientName).toBe("Acme Ltd");
    expect(contract.endDate).toBe("2026-12-31");
    expect(contract.pricingModel).toBe("Monthly rate per bus");
    expect(contract.paymentTerms).toBe("30 days from invoice");
    expect(contract.history).toHaveLength(1);
    expect(contract.history[0]).toMatchObject({ from: "draft", to: "draft", actor: "Ops" });
    expect(db.audit[0].action).toBe("contracts:create");
    expect(db.referenceCounters).toEqual(expect.arrayContaining([{ scope: "contract", period: "all", last: 1 }]));
  });

  it("leaves the end date empty for an open-ended agreement rather than inventing one", () => {
    const w = build();
    const db = create(w, { endDate: "" });
    expect(contractOf(db).endDate).toBeNull();
  });

  it("refuses what the company's own lists do not contain", () => {
    const w = build();
    const result = attempt(w.db, w.ops, {
      type: "create_contract",
      input: input(w, {
        clientId: "",
        startDate: "2026-13-01",
        endDate: "2026-05-01",
        shiftIds: ["nope"],
        vehicleCategoryId: "nope",
        serviceType: "spaceflight",
      } as never),
    });
    expect(result.ok).toBe(false);
    const errors = errorsOf(result);
    expect(errors.clientId).toMatch(/Choose the client/);
    expect(errors.startDate).toMatch(/day the contract starts|already covers/);
    expect(errors.serviceType).toMatch(/which service/);
    expect(errors.shiftIds).toMatch(/not in Settings/);
    expect(errors.vehicleCategoryId).toMatch(/not in Settings/);
    expect(w.db.contracts).toHaveLength(0);
  });

  it("refuses a contract over another client's route", () => {
    const w = build();
    const result = attempt(w.db, w.ops, { type: "create_contract", input: input(w, { routeIds: [w.otherRouteId] }) });
    expect(result.ok).toBe(false);
    expect(errorsOf(result).routeIds).toMatch(/must belong to that client/);
  });

  it("refuses a second live agreement over the same days", () => {
    const w = build();
    let db = create(w);
    const id = contractOf(db).id;
    db = run(db, w.ops, { type: "advance_contract", id, to: "pending_approval", reason: "" });

    const clash = attempt(db, w.ops, { type: "create_contract", input: input(w) });
    expect(clash.ok).toBe(false);
    expect(errorsOf(clash).startDate).toMatch(/CT-0001 already covers 2026-06-01/);
  });

  it("lets drafting happen on a client's own terms, but only with permission", () => {
    const w = build();
    const denied = attempt(w.db, w.finance, { type: "create_contract", input: input(w) });
    expect(denied.ok).toBe(false);
    expect(denied.ok === false && denied.message).toMatch(/Not permitted|contracts:create/);
    // Finance may read the terms it invoices against, which is why it holds contracts:read.
    expect(w.db.contracts).toHaveLength(0);
  });
});

describe("contracts - the state machine (D-95)", () => {
  it("moves draft → awaiting approval → active, recording each step with who took it", () => {
    const w = build();
    const db = approve(create(w), w);
    const contract = contractOf(db);

    expect(contract.status).toBe("active");
    expect(contract.history.map((event) => event.to)).toEqual(["draft", "pending_approval", "active"]);
    expect(contract.history[1].actor).toBe("Ops");
    expect(contract.history[2].actor).toBe("Admin One");
    expect(db.audit[0].action).toBe("contracts:advance");
  });

  it("refuses to rewrite the terms once approved, and offers the new contract instead", () => {
    const w = build();
    const db = approve(create(w), w);
    const id = contractOf(db).id;

    const edit = attempt(db, w.ops, { type: "update_contract", id, input: input(w, { pricingModel: "Something better for us" }) });
    expect(edit.ok).toBe(false);
    expect(edit.ok === false && edit.message).toMatch(/Its terms are what was agreed, so a change is a new contract/);
    expect(isContractEditable(contractOf(db))).toBe(false);

    // The replacement is a new numbered record that names the one it replaced, and the old one stands.
    // A renegotiation is the next term, not a second agreement over the same days: it starts the day
    // after the old one ends.
    const replacement = run(db, w.ops, {
      type: "create_contract",
      input: { ...input(w, { startDate: "2027-01-01", endDate: "2027-12-31", pricingModel: "Renegotiated" }), replaceContractId: id },
    });
    expect(replacement.contracts.map((contract) => contract.reference)).toEqual(["CT-0002", "CT-0001"]);
    expect(replacement.contracts[0].replacesId).toBe(id);
    expect(replacement.contracts[0].history[0].note).toMatch(/replace CT-0001/);
    expect(replacement.contracts[1].pricingModel).toBe("Monthly rate per bus");
  });

  it("suspends only with a reason, resumes, and cannot be un-terminated", () => {
    const w = build();
    let db = approve(create(w), w);
    const id = contractOf(db).id;

    expect(attempt(db, w.ops, { type: "advance_contract", id, to: "suspended", reason: "" }).ok).toBe(false);
    db = run(db, w.ops, { type: "advance_contract", id, to: "suspended", reason: "Client has not paid the last invoice" });
    expect(contractOf(db).status).toBe("suspended");
    expect(contractOf(db).history.at(-1)).toMatchObject({ to: "suspended", note: "Client has not paid the last invoice" });

    db = run(db, w.ops, { type: "advance_contract", id, to: "active", reason: "" });
    expect(contractOf(db).status).toBe("active");

    db = run(db, w.ops, { type: "advance_contract", id, to: "terminated", reason: "Client moved to another provider" });
    expect(contractOf(db).status).toBe("terminated");

    const revive = attempt(db, w.ops, { type: "advance_contract", id, to: "active", reason: "" });
    expect(revive.ok).toBe(false);
    expect(revive.ok === false && revive.message).toMatch(/is terminated; the record stays/);
  });

  it("refuses to make a contract active after its own end date has passed", () => {
    const w = build();
    let db = create(w, { startDate: "2025-01-01", endDate: "2025-12-31" });
    const id = contractOf(db).id;
    db = run(db, w.ops, { type: "advance_contract", id, to: "pending_approval", reason: "" });
    const activate = attempt(db, w.ops, { type: "advance_contract", id, to: "active", reason: "" }, "2026-06-01T09:00:00.000Z");
    expect(activate.ok).toBe(false);
    expect(activate.ok === false && activate.message).toMatch(/ended on 2025-12-31/);
  });

  it("sends a contract back to draft with a reason, not silently", () => {
    const w = build();
    let db = create(w);
    const id = contractOf(db).id;
    db = run(db, w.ops, { type: "advance_contract", id, to: "pending_approval", reason: "" });
    expect(attempt(db, w.ops, { type: "advance_contract", id, to: "draft", reason: "" }).ok).toBe(false);
    db = run(db, w.ops, { type: "advance_contract", id, to: "draft", reason: "The rate on the paper is wrong" });
    expect(contractOf(db).status).toBe("draft");
    expect(contractOf(db).history.at(-1)?.note).toBe("The rate on the paper is wrong");
  });
});

describe("contracts - what a person reads (D-95)", () => {
  it("calls an active contract expired once its end date has passed, without changing the record", () => {
    const live = { status: "active" as const, endDate: "2026-05-31" };
    expect(contractStateOf(live, "2026-06-01")).toBe("expired");
    expect(contractStateOf(live, "2026-05-31")).toBe("active");
    expect(contractStateOf({ status: "active", endDate: null }, "2030-01-01")).toBe("active");
    // A suspended contract whose end date has passed is suspended, not expired: somebody did something
    // about it, and that is the fact worth showing.
    expect(contractStateOf({ status: "suspended", endDate: "2026-05-31" }, "2026-06-01")).toBe("suspended");
  });

  it("covers its own term, and every day after its start when open-ended", () => {
    expect(contractCovers({ startDate: "2026-01-01", endDate: "2026-03-31" }, "2026-02-15")).toBe(true);
    expect(contractCovers({ startDate: "2026-01-01", endDate: "2026-03-31" }, "2026-04-01")).toBe(false);
    expect(contractCovers({ startDate: "2026-01-01", endDate: null }, "2031-12-31")).toBe(true);
    expect(contractCovers({ startDate: "2026-01-01", endDate: null }, "2025-12-31")).toBe(false);
  });

  it("names the renewals that fall inside the reminder window, and nothing when no window is set", () => {
    const w = build();
    let db = approve(create(w, { startDate: "2026-01-01", endDate: "2026-06-20" }), w);
    const due = contractsDueForRenewal(db, "2026-06-01");
    expect(due.map((contract) => contract.reference)).toEqual(["CT-0001"]);
    expect(contractsDueForRenewal(db, "2026-01-02")).toEqual([]);

    db = { ...db, settings: { ...db.settings, documentReminderLeadDays: null } };
    expect(contractsDueForRenewal(db, "2026-06-01")).toEqual([]);
  });
});

describe("contracts - what stops a booking (BKG-02, D-95)", () => {
  it("says nothing when the client has no contract on file", () => {
    const w = build();
    expect(bookingContractProblem(w.db, w.clientId, TODAY, TODAY)).toBeNull();
  });

  it("allows a date an active contract covers", () => {
    const w = build();
    const db = approve(create(w), w);
    expect(bookingContractProblem(db, w.clientId, TODAY, TODAY)).toBeNull();
  });

  it("refuses a date covered by a contract that is not active, and names it", () => {
    const w = build();
    const db = create(w); // still a draft, and its term covers today
    const problem = bookingContractProblem(db, w.clientId, TODAY, TODAY);
    expect(problem).toContain("CT-0001");
    expect(problem).toMatch(/is draft, so bookings for 2026-06-01 cannot be taken under it/);
  });

  it("refuses a date after the only contract ran out, and says it was not renewed", () => {
    const w = build();
    // Approved while it was still in force, as a real contract would have been.
    const db = approve(create(w, { startDate: "2025-01-01", endDate: "2025-12-31" }), w, "2025-06-01T09:00:00.000Z");
    const problem = bookingContractProblem(db, w.clientId, "2026-06-01", "2026-06-01");
    expect(problem).toMatch(/CT-0001 ended on 2025-12-31 and has not been renewed/);
  });

  it("ignores a terminated contract, because it no longer governs anything", () => {
    const w = build();
    let db = approve(create(w), w);
    const id = contractOf(db).id;
    db = run(db, w.ops, { type: "advance_contract", id, to: "terminated", reason: "Client left" });
    expect(bookingContractProblem(db, w.clientId, TODAY, TODAY)).toBeNull();
  });
});

describe("contracts - scope and permissions", () => {
  it("shows contracts to the office, not to a driver", () => {
    const w = build();
    const db = approve(create(w), w);
    const contract = contractOf(db);
    expect(contract.clientId).toBe(w.clientId);
    // A driver holds no contract permission at all, so the payload never carries one.
    const driverUser = { ...db.users[0], id: "driver-user", role: "driver" as const, driverId: null };
    const driverActor: Actor = { id: driverUser.id, fullName: driverUser.fullName, role: "driver" };
    expect(executeCommand({ ...db, users: [...db.users, driverUser] }, driverActor, { type: "create_contract", input: input(w) }).ok).toBe(false);
  });

  it("keeps an unrecognised week day out of the record", () => {
    const w = build();
    const result = attempt(w.db, w.ops, { type: "create_contract", input: input(w, { weekdays: [9] }) });
    expect(result.ok).toBe(false);
    expect(errorsOf(result).weekdays).toMatch(/service days from the week/);
  });

  it("keeps the client's name as it was when the contract was made", () => {
    const w = build();
    const db = create(w);
    const renamed: Database = { ...db, clients: db.clients.map((client) => (client.id === w.clientId ? { ...client, name: "Acme Holdings Ltd" } : client)) };
    // The record keeps the signed name; the client link still resolves to the current one.
    expect(contractOf(renamed).clientName).toBe("Acme Ltd");
    expect(renamed.clients.find((client) => client.id === w.clientId)?.name).toBe("Acme Holdings Ltd");
  });
});
