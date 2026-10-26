// Branches, and the agreement a customer's row has to mention (CLI-01, D-102).
//
// A corporate customer is not one address. It is a head office that receives the bill and depots,
// plants or sites that the staff are collected from, and the office names them ("Tema depot").
// Keeping them as free text on the client record would make "which of their offices is this run
// for?" a question with a different answer every time somebody typed it, so a branch is a record
// with an owner, an address, a person and a state.
//
// Nothing is deleted here. A branch that closes is marked closed and keeps its address, because the
// trip records and the invoices that named it are still on file and outlive the branch.
import { contractStateOf } from "./contracts";
import type { Database } from "./types";
import { CLIENT_LOCATION_STATUSES, CONTRACT_STATUS_LABELS, type ClientLocation, type ClientLocationStatus, type Contract } from "./types";

export const CLIENT_LOCATION_LIMITS = {
  name: 80,
  address: 300,
  phone: 40,
  contactName: 80,
  /** More branches than this under one customer is almost certainly a spreadsheet mistake. */
  perClient: 40,
} as const;

export interface ClientLocationInput {
  clientId: string;
  name: string;
  address?: string;
  phone?: string;
  contactName?: string;
  status?: ClientLocationStatus;
}

export type ClientLocationErrors = Partial<Record<keyof ClientLocationInput, string>>;

/** Case and spacing are not part of a branch's name: "Tema depot" and "tema  depot" are one place. */
const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Checks a branch before it is written.
 *
 * `excludeId` is the branch being edited, so saving it without changing its name is not a clash
 * with itself. A second branch with the same name under the same customer is refused: two rows
 * called "Tema depot" would make the name useless for picking one.
 */
export function validateClientLocation(
  db: Database,
  input: ClientLocationInput,
  excludeId?: string,
): { errors: ClientLocationErrors; value: Omit<ClientLocation, "id" | "createdAt" | "updatedAt"> } {
  const errors: ClientLocationErrors = {};
  const name = input.name.trim();
  const address = (input.address ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const contactName = (input.contactName ?? "").trim();
  const status: ClientLocationStatus = input.status ?? "active";

  const client = db.clients.find((c) => c.id === input.clientId);
  if (!client) errors.clientId = "Choose the customer this branch belongs to.";

  if (!name) errors.name = "Give the branch a name, such as \"Tema depot\".";
  else if (name.length > CLIENT_LOCATION_LIMITS.name) errors.name = `Keep the branch name to ${CLIENT_LOCATION_LIMITS.name} characters.`;
  else if (
    db.clientLocations.some(
      (location) => location.id !== excludeId && location.clientId === input.clientId && norm(location.name) === norm(name),
    )
  )
    errors.name = "This customer already has a branch with this name.";

  if (address.length > CLIENT_LOCATION_LIMITS.address) errors.address = `Keep the address to ${CLIENT_LOCATION_LIMITS.address} characters.`;
  if (phone.length > CLIENT_LOCATION_LIMITS.phone) errors.phone = `Keep the phone to ${CLIENT_LOCATION_LIMITS.phone} characters.`;
  if (contactName.length > CLIENT_LOCATION_LIMITS.contactName)
    errors.contactName = `Keep the contact person to ${CLIENT_LOCATION_LIMITS.contactName} characters.`;
  if (!CLIENT_LOCATION_STATUSES.includes(status)) errors.status = "Choose open or closed.";

  if (!errors.name && excludeId === undefined) {
    const count = db.clientLocations.filter((location) => location.clientId === input.clientId).length;
    if (count >= CLIENT_LOCATION_LIMITS.perClient)
      errors.clientId = `This customer already has ${CLIENT_LOCATION_LIMITS.perClient} branches. Close one before adding another.`;
  }

  return {
    errors,
    value: {
      clientId: client ? client.id : input.clientId,
      name,
      address,
      phone,
      contactName,
      status,
    },
  };
}

/**
 * The line a customer's row shows about their agreement, in the register's own words.
 *
 * It reads the contracts collection rather than a stored flag on the client: a flag is a second
 * copy of a fact the contract already holds, and the copy is the one that goes stale. An agreement
 * that has ended is still named — that the customer *had* one matters when they ring up.
 */
export function clientAgreementLine(clientId: string, contracts: Contract[], today: string): string {
  const mine = contracts.filter((contract) => contract.clientId === clientId);
  if (mine.length === 0) return "no agreement on file";

  // Prefer an agreement that is running, then one waiting to start, then the most recent one that
  // has ended. Ties are broken by the start date, so the answer never depends on array order.
  const rank = (contract: Contract) => {
    const state = contractStateOf(contract, today);
    return state === "active" ? 0 : state === "pending_approval" || state === "draft" ? 1 : 2;
  };
  const [chosen] = [...mine].sort(
    (a, b) => rank(a) - rank(b) || (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0),
  );

  const state = CONTRACT_STATUS_LABELS[contractStateOf(chosen, today)];
  // An agreement with no end date is open-ended, which is what the contract screen already says.
  if (chosen.endDate === null) return `${chosen.reference} ${state.toLowerCase()}, open-ended`;
  return `${chosen.reference} ${state.toLowerCase()} to ${chosen.endDate}`;
}
