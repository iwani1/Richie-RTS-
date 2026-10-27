import { describe, expect, it } from "vitest";
import {
  ACTIVE_RENTAL_STATUSES,
  awaitingCustomer,
  awaitingPrice,
  canEditRequest,
  canMoveRental,
  isActiveRental,
  nextTriageStep,
  PRE_QUOTE_STATUSES,
  RENTAL_TRANSITIONS,
  TRIAGE_ACTIONS,
  TRIAGE_STATUSES,
} from "./rentalWorkflow";
import { RENTAL_STATUSES, RENTAL_STATUS_LABELS, type RentalStatus } from "./types";

describe("the rental pipeline (RNT-02, D-120)", () => {
  it("has a move table for every status, and a label for every status", () => {
    for (const status of RENTAL_STATUSES) {
      expect(RENTAL_TRANSITIONS[status]).toBeDefined();
      expect(RENTAL_STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(RENTAL_TRANSITIONS).sort()).toEqual([...RENTAL_STATUSES].sort());
  });

  it("never moves a hire back to where it came from", () => {
    for (const status of RENTAL_STATUSES) {
      expect(RENTAL_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("leaves the two endings final", () => {
    expect(RENTAL_TRANSITIONS.completed).toEqual([]);
    expect(RENTAL_TRANSITIONS.declined).toEqual([]);
    expect(RENTAL_TRANSITIONS.cancelled).toEqual([]);
  });

  it("walks the triage states one step at a time", () => {
    expect(canMoveRental("draft", "submitted")).toBe(true);
    expect(canMoveRental("submitted", "under_review")).toBe(true);
    expect(canMoveRental("under_review", "awaiting_quotation")).toBe(true);
    // Skipping a stage, and stepping back, are both refused.
    expect(canMoveRental("draft", "under_review")).toBe(false);
    expect(canMoveRental("draft", "awaiting_quotation")).toBe(false);
    expect(canMoveRental("under_review", "submitted")).toBe(false);
    expect(canMoveRental("awaiting_quotation", "under_review")).toBe(false);
  });

  it("lets a quotation be issued from anywhere before one exists", () => {
    for (const status of PRE_QUOTE_STATUSES) {
      expect(canMoveRental(status, "quoted")).toBe(true);
    }
    // …and not from a stage that has already had one.
    expect(canMoveRental("confirmed", "quoted")).toBe(false);
    expect(canMoveRental("dispatched", "quoted")).toBe(false);
  });

  it("separates saying yes from paying", () => {
    expect(canMoveRental("quoted", "accepted")).toBe(true);
    expect(canMoveRental("accepted", "confirmed")).toBe(true);
    // The customer's yes is not the deposit, and the deposit is not recorded as a yes.
    expect(canMoveRental("quoted", "dispatched")).toBe(false);
    expect(canMoveRental("accepted", "dispatched")).toBe(false);
    expect(canMoveRental("confirmed", "accepted")).toBe(false);
  });

  it("drops an accepted hire back to waiting when the price is renewed", () => {
    // Renewal is not a table move: it writes the new quotation and returns the request to `quoted`,
    // because the agreement on record refers to the old figure (see the service test).
    expect(RENTAL_TRANSITIONS.accepted).not.toContain("quoted");
    expect(TRIAGE_STATUSES).not.toContain("quoted");
  });

  it("names the next triage step, and stops naming one at the end", () => {
    expect(nextTriageStep("draft")).toBe("submitted");
    expect(nextTriageStep("submitted")).toBe("under_review");
    expect(nextTriageStep("under_review")).toBe("awaiting_quotation");
    expect(nextTriageStep("awaiting_quotation")).toBeNull();
    expect(nextTriageStep("quoted")).toBeNull();
    expect(nextTriageStep("completed")).toBeNull();
  });

  it("gives every step a sentence in the office's words", () => {
    for (const status of TRIAGE_STATUSES) {
      expect(TRIAGE_ACTIONS[status]).toBeTruthy();
    }
  });

  it("allows a correction until a price exists", () => {
    for (const status of PRE_QUOTE_STATUSES) expect(canEditRequest(status)).toBe(true);
    for (const status of ["quoted", "accepted", "confirmed", "dispatched", "completed", "declined", "cancelled"] as RentalStatus[]) {
      expect(canEditRequest(status)).toBe(false);
    }
  });

  it("counts a hire as holding a vehicle only once the deposit is in", () => {
    expect(ACTIVE_RENTAL_STATUSES).toEqual(["confirmed", "dispatched"]);
    expect(isActiveRental("confirmed")).toBe(true);
    expect(isActiveRental("dispatched")).toBe(true);
    // An agreed-but-unpaid hire holds nothing, which is what "no vehicle is held until confirmed" says.
    expect(isActiveRental("accepted")).toBe(false);
    expect(isActiveRental("quoted")).toBe(false);
  });

  it("says whose move it is", () => {
    expect(awaitingPrice("draft")).toBe(true);
    expect(awaitingPrice("awaiting_quotation")).toBe(true);
    expect(awaitingPrice("quoted")).toBe(false);
    expect(awaitingCustomer("quoted")).toBe(true);
    expect(awaitingCustomer("accepted")).toBe(true);
    expect(awaitingCustomer("confirmed")).toBe(false);
  });
});
