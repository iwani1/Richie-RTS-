import { describe, expect, it } from "vitest";
import {
  chargeAmount,
  chargeApproval,
  chargeApprovalLine,
  chargeApprovalProblem,
  chargeIsApproved,
  chargeLines,
  chargeNeedsApproval,
  readExtraCharges,
  unapprovedCharges,
} from "./extraCharges";
import type { ExtraCharge, Rental } from "./types";

// Charges added when a hire comes back (RNT-07, D-123). The rules worth writing down are the ones
// that keep money honest: a charge carries a reason, a charge above the company's figure needs a
// second signature, and the person who added it is never the person who signs it.

const who = { id: "u1", fullName: "Ama Mensah" };
let counter = 0;
const nextId = () => `ch-${++counter}`;

const charge = (overrides: Partial<ExtraCharge> = {}): ExtraCharge => ({
  id: "ch-1",
  description: "Damaged seat cover",
  quantity: 1,
  unitAmount: 250,
  reason: "Seat cover torn on return",
  addedById: "u1",
  addedByName: "Ama Mensah",
  addedAt: "2026-06-09T10:00:00.000Z",
  approval: null,
  ...overrides,
});

describe("reading the charges an office types", () => {
  it("keeps a charge with its reason and who added it", () => {
    const { errors, charges } = readExtraCharges(
      [{ description: " Fuel ", quantity: "2", unitAmount: "150.50", reason: "Two tanks, receipt attached" }],
      who,
      "2026-06-09T10:00:00.000Z",
      nextId,
    );
    expect(errors).toEqual({});
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ description: "Fuel", quantity: 2, unitAmount: 150.5, reason: "Two tanks, receipt attached", addedById: "u1", addedByName: "Ama Mensah", approval: null });
  });

  it("ignores the empty row a form starts with", () => {
    const { errors, charges } = readExtraCharges([{ description: "", quantity: "1", unitAmount: "", reason: "" }], who, "2026-06-09T10:00:00.000Z", nextId);
    expect(errors).toEqual({});
    expect(charges).toEqual([]);
  });

  it("refuses a charge with no reason, because the customer reads it", () => {
    const { errors, charges } = readExtraCharges([{ description: "Waiting", quantity: "1", unitAmount: "80", reason: "  " }], who, "2026-06-09T10:00:00.000Z", nextId);
    expect(errors["extraCharges.0.reason"]).toBe("Give a reason for the charge: the customer will read it.");
    // The row is still returned, so the screen can keep what was typed while it says what is missing.
    expect(charges).toHaveLength(1);
  });

  it("refuses a charge with no description, or an amount that is not money", () => {
    const { errors } = readExtraCharges([{ description: " ", quantity: "1", unitAmount: "100.005", reason: "Late return" }], who, "2026-06-09T10:00:00.000Z", nextId);
    expect(errors["extraCharges.0.description"]).toBe("Say what the charge is for.");
    expect(errors["extraCharges.0.unitAmount"]).toBe("Use at most two decimal places: amounts are in pesewas.");
  });
});

describe("what a charge is worth", () => {
  it("multiplies quantity by amount, rounding once", () => {
    expect(chargeAmount({ quantity: 2, unitAmount: 150.5 })).toBe(301);
    expect(chargeAmount({ quantity: 1.5, unitAmount: 90 })).toBe(135);
  });

  it("needs a signature only above the figure the company set", () => {
    expect(chargeNeedsApproval(250, 500)).toBe(false);
    expect(chargeNeedsApproval(500, 500)).toBe(true);
    // No figure set is not "everything is approved": it is "nobody asked for a signature".
    expect(chargeNeedsApproval(5000, null)).toBe(false);
  });

  it("counts as approved only for the amount it is actually for", () => {
    const signed = charge({ approval: { at: "2026-06-09T11:00:00.000Z", byActorId: "u2", byName: "Kofi Boateng", note: "", total: 250 } });
    expect(chargeIsApproved(signed)).toBe(true);
    // A charge edited after it was signed is not the charge that was signed.
    expect(chargeIsApproved({ ...signed, unitAmount: 400 })).toBe(false);
  });
});

describe("who may sign a charge off", () => {
  it("refuses the person who added it", () => {
    expect(chargeApprovalProblem(charge(), 0, "u1", "Ama Mensah")).toBe(
      "The person who added the charge for Damaged seat cover cannot also approve it. Somebody else has to sign it off.",
    );
  });

  it("allows somebody else, and then refuses a second signature", () => {
    expect(chargeApprovalProblem(charge(), 0, "u2", "Kofi Boateng")).toBeNull();
    const signed = charge({ approval: { at: "2026-06-09T11:00:00.000Z", byActorId: "u2", byName: "Kofi Boateng", note: "", total: 250 } });
    expect(chargeApprovalProblem(signed, 0, "u3", "Yaa Asantewaa")).toBe("This charge was already approved by Kofi Boateng on 2026-06-09.");
  });

  it("falls back to the name for a charge recorded before accounts were kept", () => {
    expect(chargeApprovalProblem(charge({ addedById: null }), 0, "u9", "  ama mensah ")).toContain("cannot also approve it");
    expect(chargeApprovalProblem(charge({ addedById: null }), 0, "u9", "Kofi Boateng")).toBeNull();
  });
});

describe("the sentence a screen prints about a charge", () => {
  it("says what is required, or that nothing was asked for", () => {
    expect(chargeApprovalLine(charge(), 500, "GHS")).toBeNull();
    expect(chargeApprovalLine(charge(), 100, "GHS")).toBe("A second signature is required: this charge is at or above GHS 100.00.");
    expect(chargeApprovalLine(charge(), null, "GHS")).toBe("No approval is required: the company has not set a figure that needs one.");
  });

  it("says who signed it, and repeats what they wrote", () => {
    const signed = charge({ approval: { at: "2026-06-09T11:00:00.000Z", byActorId: "u2", byName: "Kofi Boateng", note: "Seen the photo", total: 250 } });
    expect(chargeApprovalLine(signed, 100, "GHS")).toBe('Approved by Kofi Boateng on 2026-06-09. "Seen the photo"');
  });
});

describe("what holds up the bill", () => {
  const rental = (charges: ExtraCharge[]): Rental => ({ extraCharges: charges } as Rental);

  it("lists only the charges that need a signature and have none", () => {
    const small = charge({ id: "small", unitAmount: 50 });
    const large = charge({ id: "large", unitAmount: 900 });
    const signedLarge = charge({ id: "signed", unitAmount: 900, approval: { at: "2026-06-09T11:00:00.000Z", byActorId: "u2", byName: "Kofi Boateng", note: "", total: 900 } });
    expect(unapprovedCharges(rental([small, large, signedLarge]), 500).map((c) => c.id)).toEqual(["large"]);
    // With no figure set, nothing is waiting: the company never asked for a signature.
    expect(unapprovedCharges(rental([small, large]), null)).toEqual([]);
  });

  it("puts the reason on the customer's invoice line", () => {
    expect(chargeLines([charge()])).toEqual([
      { id: "ch-1", description: "Damaged seat cover (Seat cover torn on return)", quantity: 1, unitAmount: 250 },
    ]);
  });

  it("records the signature against the amount", () => {
    expect(chargeApproval(charge(), { id: "u2", fullName: "Kofi Boateng" }, "  Seen the photo  ", "2026-06-09T11:00:00.000Z")).toEqual({
      at: "2026-06-09T11:00:00.000Z",
      byActorId: "u2",
      byName: "Kofi Boateng",
      note: "Seen the photo",
      total: 250,
    });
  });
});
