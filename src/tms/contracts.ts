// Contracts: the paper behind a corporate account (brief CLI-02, D-95).
//
// A client record said only that the company existed. Nothing could answer "is this account still under
// an agreement, for which days, and until when?" — the question that decides whether next week's run is
// the office's job or a favour. This module holds the agreement itself.
//
// Three rules, each of which stops a specific kind of quiet wrong answer:
//
//   * **The record is a transcription.** Pricing model, billing frequency, payment terms and
//     service-level targets are typed from the signed contract. The system does not compute a rate and
//     does not invent terms, because a contract is evidence of what two parties agreed, not a guess.
//   * **Expiry is computed from the end date, not stored.** A date passing is not an event anyone
//     records, and a stored "expired" would be wrong between nightly runs. `contractStateOf()` derives
//     it, and every screen prints the same word from the same function.
//   * **An approved contract is not rewritten.** Before approval, drafting and correction are ordinary
//     edits; once it is active, the terms are frozen and a renegotiated agreement is a **new** numbered
//     contract that names the one it replaces. A signed term that can be edited is worth nothing when
//     it is the thing being argued about.
//
// Expiry and suspension are facts about an account, not a ban on work: the booking rule refuses a new
// request only when a contract **covers** that date and is not active, or when the client's contract has
// run out and no replacement exists. A client with no contract on file is unchanged — the system does
// not invent an agreement in order to refuse work under it.

import { allocateReference } from "./references";
import { authorise, audit, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type { Contract, ContractEvent, ContractServiceType, ContractState, ContractStatus, Contract as ContractRecord, Database } from "./types";
import { CONTRACT_SERVICE_TYPES } from "./types";

export const CONTRACT_COMMAND_TYPES = ["create_contract", "update_contract", "advance_contract"] as const;

/** What an operator types from the signed contract. Every free-text field may be blank. */
export interface ContractInput {
  clientId: string;
  serviceType: ContractServiceType;
  startDate: string;
  endDate: string;
  routeIds: string[];
  weekdays: number[];
  shiftIds: string[];
  vehicleCategoryId: string;
  pricingModel: string;
  billingFrequency: string;
  paymentTerms: string;
  serviceLevelTargets: string;
  notes: string;
}

export type ContractCommand =
  | { type: "create_contract"; input: ContractInput & { replaceContractId?: string } }
  | { type: "update_contract"; id: string; input: ContractInput }
  | { type: "advance_contract"; id: string; to: ContractStatus; reason: string };

export function isContractCommand(command: { type: string }): command is ContractCommand {
  return (CONTRACT_COMMAND_TYPES as readonly string[]).includes(command.type);
}

// ---------- state ----------

/** The state a person should read: the stored status, or "expired" when an active term has run out. */
export function contractStateOf(contract: Pick<Contract, "status" | "endDate">, today: string): ContractState {
  if (contract.status === "active" && contract.endDate !== null && contract.endDate < today) return "expired";
  return contract.status;
}

/** Whether the contract's dates include this day. An open-ended contract includes every day from its start. */
export function contractCovers(contract: Pick<Contract, "startDate" | "endDate">, date: string): boolean {
  return contract.startDate <= date && (contract.endDate === null || date <= contract.endDate);
}

/** Contracts that still mean something: anything not terminated and not drafted. */
export const LIVE_CONTRACT_STATUSES: readonly ContractStatus[] = ["pending_approval", "active", "suspended"];

/**
 * What stops a booking under this client's contracts, or null when nothing does (BKG-02, D-95).
 *
 * The rule only speaks when the system has an agreement to speak about:
 *   * a contract **covers** the date and is not active → refused, naming the contract and its state;
 *   * no contract covers the date but an earlier one **ended** before it → refused as lapsed, because
 *     the account is governed by an agreement that ran out and nobody renewed it;
 *   * the client has no contracts at all → allowed. Nothing is assumed, so nothing is refused.
 */
export function bookingContractProblem(db: Database, clientId: string, date: string, today: string): string | null {
  const contracts = db.contracts.filter((contract) => contract.clientId === clientId && contract.status !== "terminated");
  if (contracts.length === 0) return null;
  const covering = contracts.filter((contract) => contractCovers(contract, date));
  if (covering.length > 0) {
    const live = covering.find((contract) => contractStateOf(contract, today) === "active");
    if (live) return null;
    const blocker = covering[0];
    const state = contractStateOf(blocker, today);
    return `Client contract ${blocker.reference} is ${state === "expired" ? "expired" : state.replace("_", " ")}, so bookings for ${date} cannot be taken under it.`;
  }
  const lapsed = contracts
    .filter((contract) => contract.endDate !== null && contract.endDate < date)
    .sort((a, b) => (a.endDate! < b.endDate! ? 1 : -1))[0];
  if (lapsed) {
    return `Client contract ${lapsed.reference} ended on ${lapsed.endDate} and has not been renewed, so bookings for ${date} need a new contract first.`;
  }
  return null;
}

/** Contracts that end within the reminder window, so a renewal is not discovered on the last day. */
export function contractsDueForRenewal(db: Database, today: string): ContractRecord[] {
  const lead = db.settings.documentReminderLeadDays;
  if (lead === null) return [];
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + lead * 86_400_000).toISOString().slice(0, 10);
  return db.contracts.filter(
    (contract) => contract.status === "active" && contract.endDate !== null && contract.endDate >= today && contract.endDate <= limit,
  );
}

// ---------- validation ----------

const MAX_SHORT = 120;
const MAX_LONG = 500;

function validateContract(db: Database, input: ContractInput, id: string | null): Errors {
  const errors: Errors = {};
  const client = db.clients.find((candidate) => candidate.id === input.clientId);
  if (!input.clientId) errors.clientId = "Choose the client this contract is with.";
  else if (!client) errors.clientId = "Unknown client.";
  else if (client.status === "inactive") errors.clientId = "That client is inactive; a contract with them cannot be opened.";

  if (!CONTRACT_SERVICE_TYPES.includes(input.serviceType)) errors.serviceType = "Choose which service the contract covers.";

  if (!isValidDate(input.startDate)) errors.startDate = "Enter the day the contract starts.";
  if (input.endDate && !isValidDate(input.endDate)) errors.endDate = "Enter the day the contract ends, or leave it blank for open-ended.";
  if (isValidDate(input.startDate) && isValidDate(input.endDate) && input.endDate < input.startDate) {
    errors.endDate = "The contract cannot end before it starts.";
  }

  const unknownRoutes = input.routeIds.filter((routeId) => !db.routes.some((route) => route.id === routeId));
  if (unknownRoutes.length > 0) errors.routeIds = "One of the routes named does not exist.";
  else if (client) {
    // A contract naming another client's route would promise service the office does not run for them.
    const foreign = input.routeIds.filter((routeId) => db.routes.find((route) => route.id === routeId)?.clientId !== client.id);
    if (foreign.length > 0) errors.routeIds = "Every route on a contract must belong to that client.";
  }

  if (input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) errors.weekdays = "Pick service days from the week.";
  const unknownShifts = input.shiftIds.filter((shiftId) => !db.settings.shifts.some((shift) => shift.id === shiftId));
  if (unknownShifts.length > 0) errors.shiftIds = "One of the shifts named is not in Settings.";
  if (input.vehicleCategoryId && !db.settings.vehicleCategories.some((category) => category.id === input.vehicleCategoryId)) {
    errors.vehicleCategoryId = "That vehicle category is not in Settings.";
  }

  const texts: [keyof ContractInput, string][] = [
    ["pricingModel", "Pricing model"],
    ["billingFrequency", "Billing frequency"],
    ["paymentTerms", "Payment terms"],
    ["serviceLevelTargets", "Service-level targets"],
    ["notes", "Notes"],
  ];
  for (const [field, label] of texts) {
    const value = input[field];
    if (typeof value !== "string") {
      errors[field] = `${label} must be text.`;
      continue;
    }
    const limit = field === "notes" || field === "serviceLevelTargets" ? MAX_LONG : MAX_SHORT;
    if (value.length > limit) errors[field] = `${label} is too long (${limit} characters at most).`;
  }

  // The one rule that needs the other records: a client cannot have two contracts covering the same day
  // in a state that both claim the account. Two drafts may coexist (one being prepared while the other
  // is on the table), but two live agreements cannot.
  if (client && isValidDate(input.startDate)) {
    const others = db.contracts.filter(
      (contract) =>
        contract.id !== id &&
        contract.clientId === client.id &&
        LIVE_CONTRACT_STATUSES.includes(contract.status) &&
        contractCovers(contract, input.startDate) &&
        (contract.startDate <= (input.endDate || "9999-12-31")),
    );
    if (others.length > 0) {
      errors.startDate = `${others[0].reference} already covers ${input.startDate} for ${client.name}. End that one or start after ${others[0].endDate ?? "it is closed"}.`;
    }
  }

  return errors;
}

function summarise(input: ContractInput, clientName: string): string {
  const term = input.endDate ? `${input.startDate} to ${input.endDate}` : `from ${input.startDate}, open-ended`;
  return `${clientName}, ${term}`;
}

// ---------- commands ----------

export function executeContracts(db: Database, actor: Actor | null, command: ContractCommand, now: string = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "create_contract": {
      const denied = authorise(actor, "contracts:create");
      if (denied) return denied;
      const input = command.input;
      const errors = validateContract(db, input, null);
      const replacement = input.replaceContractId ? db.contracts.find((contract) => contract.id === input.replaceContractId) : undefined;
      if (input.replaceContractId && !replacement) errors.replaceContractId = "Unknown contract to replace.";
      if (Object.keys(errors).length > 0) return fail("This contract cannot be created yet.", errors);

      const client = db.clients.find((candidate) => candidate.id === input.clientId)!;
      const { counters, reference } = allocateReference(db, "contract", now.slice(0, 4));
      const contract: Contract = {
        id: makeId(),
        reference,
        clientId: client.id,
        clientName: client.name,
        serviceType: input.serviceType,
        startDate: input.startDate,
        endDate: input.endDate || null,
        status: "draft",
        routeIds: [...new Set(input.routeIds)],
        weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
        shiftIds: [...new Set(input.shiftIds)],
        vehicleCategoryId: input.vehicleCategoryId,
        pricingModel: input.pricingModel.trim(),
        billingFrequency: input.billingFrequency.trim(),
        paymentTerms: input.paymentTerms.trim(),
        serviceLevelTargets: input.serviceLevelTargets.trim(),
        notes: input.notes.trim(),
        replacesId: replacement ? replacement.id : null,
        history: [
          {
            at: now,
            actor: actor!.fullName,
            from: "draft",
            to: "draft",
            note: replacement ? `Drafted to replace ${replacement.reference}.` : "Drafted.",
          },
        ],
        createdBy: actor!.fullName,
        createdAt: now,
        updatedAt: now,
      };
      const next = { ...db, contracts: [contract, ...db.contracts], referenceCounters: counters };
      return {
        ok: true,
        db: audit(next, actor, {
          action: "contracts:create",
          entity: "contract",
          entityId: contract.id,
          summary: `Contract ${reference} drafted: ${summarise(input, client.name)}.`,
        }, now),
        message: `${reference} drafted for ${client.name}. Approval is the next step before it counts.`,
      };
    }

    case "update_contract": {
      const denied = authorise(actor, "contracts:update");
      if (denied) return denied;
      const contract = db.contracts.find((candidate) => candidate.id === command.id);
      if (!contract) return fail("Unknown contract.");
      if (contract.status !== "draft" && contract.status !== "pending_approval") {
        return fail(
          `Contract ${contract.reference} is ${contract.status.replace("_", " ")}. Its terms are what was agreed, so a change is a new contract that names this one — a signed term that can be edited is worth nothing.`,
        );
      }
      const errors = validateContract(db, command.input, contract.id);
      if (Object.keys(errors).length > 0) return fail("This contract cannot be saved yet.", errors);

      const client = db.clients.find((candidate) => candidate.id === command.input.clientId)!;
      const updated: Contract = {
        ...contract,
        clientId: client.id,
        clientName: client.name,
        serviceType: command.input.serviceType,
        startDate: command.input.startDate,
        endDate: command.input.endDate || null,
        routeIds: [...new Set(command.input.routeIds)],
        weekdays: [...new Set(command.input.weekdays)].sort((a, b) => a - b),
        shiftIds: [...new Set(command.input.shiftIds)],
        vehicleCategoryId: command.input.vehicleCategoryId,
        pricingModel: command.input.pricingModel.trim(),
        billingFrequency: command.input.billingFrequency.trim(),
        paymentTerms: command.input.paymentTerms.trim(),
        serviceLevelTargets: command.input.serviceLevelTargets.trim(),
        notes: command.input.notes.trim(),
        updatedAt: now,
      };
      const next = { ...db, contracts: db.contracts.map((candidate) => (candidate.id === contract.id ? updated : candidate)) };
      return {
        ok: true,
        db: audit(next, actor, {
          action: "contracts:update",
          entity: "contract",
          entityId: contract.id,
          summary: `${contract.reference} corrected while ${contract.status === "draft" ? "draft" : "awaiting approval"}: ${summarise(command.input, client.name)}.`,
        }, now),
        message: `${contract.reference} saved.`,
      };
    }

    case "advance_contract": {
      const denied = authorise(actor, "contracts:advance");
      if (denied) return denied;
      const contract = db.contracts.find((candidate) => candidate.id === command.id);
      if (!contract) return fail("Unknown contract.");

      const allowed: Record<ContractStatus, ContractStatus[]> = {
        draft: ["pending_approval"],
        pending_approval: ["active", "draft"],
        active: ["suspended", "terminated"],
        suspended: ["active", "terminated"],
        terminated: [],
      };
      if (!allowed[contract.status].includes(command.to)) {
        return fail(
          contract.status === "terminated"
            ? `Contract ${contract.reference} is terminated; the record stays, and a new contract is how service resumes.`
            : `Contract ${contract.reference} cannot go from ${contract.status.replace("_", " ")} to ${command.to.replace("_", " ")}.`,
        );
      }

      const needsReason = command.to === "suspended" || command.to === "terminated" || (command.to === "draft" && contract.status === "pending_approval");
      const reason = (command.reason ?? "").trim();
      if (needsReason && !reason) {
        return fail(
          command.to === "draft"
            ? "Say why the contract is going back to draft, so the next reader knows what changed."
            : `Say why ${contract.reference} is being ${command.to === "suspended" ? "suspended" : "terminated"}.`,
          { reason: "A reason is required." },
        );
      }
      if (reason.length > 300) return fail("Keep the reason under 300 characters.", { reason: "Too long." });

      if (command.to === "active" && contract.endDate !== null && contract.endDate <= now.slice(0, 10)) {
        return fail(`Contract ${contract.reference} ended on ${contract.endDate}. A contract that has run out cannot be made active — enter the renewal as a new contract.`);
      }

      const state = contractStateOf(contract, now.slice(0, 10));
      const event: ContractEvent = { at: now, actor: actor!.fullName, from: state, to: command.to, note: reason };
      const updated: Contract = {
        ...contract,
        status: command.to,
        history: [...contract.history, event],
        updatedAt: now,
      };
      const next = { ...db, contracts: db.contracts.map((candidate) => (candidate.id === contract.id ? updated : candidate)) };
      const wording: Record<ContractStatus, string> = {
        draft: "returned to draft",
        pending_approval: "sent for approval",
        active: contract.status === "suspended" ? "resumed" : "approved and active",
        suspended: "suspended",
        terminated: "terminated",
      };
      return {
        ok: true,
        db: audit(next, actor, {
          action: "contracts:advance",
          entity: "contract",
          entityId: contract.id,
          summary: `${contract.reference} ${wording[command.to]}${reason ? `: ${reason}` : "."}`,
        }, now),
        message: `${contract.reference} ${wording[command.to]}.`,
      };
    }
  }
}

/** Whether a contract can still be edited: drafting and approval are ordinary edits, approval is not. */
export function isContractEditable(contract: Pick<Contract, "status">): boolean {
  return contract.status === "draft" || contract.status === "pending_approval";
}
