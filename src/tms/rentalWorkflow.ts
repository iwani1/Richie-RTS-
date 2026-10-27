// The stages a rental request goes through (RNT-02, D-120).
//
// The pipeline is here rather than scattered through the screens, because a state table that lives in
// two places is a table that disagrees with itself: a button offered for a move the service refuses, a
// count on a dashboard that uses a different idea of "active" from the one that blocks a vehicle.
//
// Two things this table deliberately does **not** do:
//
//   * **It does not make the office walk every step.** The three triage states before a price
//     (submitted, under review, awaiting quotation) are there for the requests that need looking at;
//     a quotation can still be issued from any of them, so a small request is never blocked by
//     paperwork. A state only means something if skipping it is allowed and the pipeline says so.
//   * **It does not name one fact twice.** A hire that has left the yard is `dispatched` — the same
//     word the trip board uses for the same moment — and the departure time is the one D-118 records
//     when that happens. There is no separate "in progress" state, because it would be a second name
//     for a fact already on the record.
import type { RentalStatus } from "./types";

/**
 * What may follow what, and nothing else.
 *
 * `declined` means the customer said no; `cancelled` means the hire stopped after somebody had taken
 * it on. Both are final: a cancelled request is not quietly reopened, it is a new request.
 */
export const RENTAL_TRANSITIONS: Record<RentalStatus, readonly RentalStatus[]> = {
  draft: ["submitted", "quoted", "cancelled"],
  submitted: ["under_review", "quoted", "cancelled"],
  under_review: ["awaiting_quotation", "quoted", "cancelled"],
  awaiting_quotation: ["quoted", "cancelled"],
  quoted: ["accepted", "confirmed", "declined", "cancelled"],
  accepted: ["confirmed", "declined", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["completed", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

/** The three states between "we have the request" and "we have a price for it". */
export const TRIAGE_STATUSES: readonly RentalStatus[] = ["submitted", "under_review", "awaiting_quotation"];

/** Requests nobody has priced yet. The office's inbox. */
export const PRE_QUOTE_STATUSES: readonly RentalStatus[] = ["draft", ...TRIAGE_STATUSES];

/** Hires that hold a vehicle and a driver: the ones a second booking cannot have. */
export const ACTIVE_RENTAL_STATUSES: readonly RentalStatus[] = ["confirmed", "dispatched"];

/** The customer has a price in front of them, or has agreed to one and not yet paid the deposit. */
export const AWAITING_CUSTOMER_STATUSES: readonly RentalStatus[] = ["quoted", "accepted"];

export function canMoveRental(from: RentalStatus, to: RentalStatus): boolean {
  return RENTAL_TRANSITIONS[from].includes(to);
}

/**
 * The next triage step, or null when the request is past triage or already at its end.
 *
 * The screens use this for the one button that moves a request along, so the office never sees a move
 * the service would refuse, and the button always names where it is going.
 */
export function nextTriageStep(status: RentalStatus): RentalStatus | null {
  const index = TRIAGE_STATUSES.indexOf(status);
  if (status === "draft") return "submitted";
  if (index === -1) return null;
  return TRIAGE_STATUSES[index + 1] ?? null;
}

/** The words on that button, in the office's language rather than the table's. */
export const TRIAGE_ACTIONS: Partial<Record<RentalStatus, string>> = {
  submitted: "Take this request on",
  under_review: "Start the review",
  awaiting_quotation: "Ready to be priced",
};

/** A request that has not been priced can still be corrected; one that has cannot. */
export function canEditRequest(status: RentalStatus): boolean {
  return PRE_QUOTE_STATUSES.includes(status);
}

/** A hire that is out with a vehicle, or waiting to go out. */
export function isActiveRental(status: RentalStatus): boolean {
  return ACTIVE_RENTAL_STATUSES.includes(status);
}

/** True while nobody has put a price in front of the customer. */
export function awaitingPrice(status: RentalStatus): boolean {
  return PRE_QUOTE_STATUSES.includes(status);
}

/** True while the next move is the customer's — a price to answer, or a deposit to pay. */
export function awaitingCustomer(status: RentalStatus): boolean {
  return AWAITING_CUSTOMER_STATUSES.includes(status);
}
