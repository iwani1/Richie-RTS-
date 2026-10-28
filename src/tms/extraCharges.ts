// Charges added when a hire comes back, and the second signature some of them need (RNT-07, D-123).
//
// The quotation is agreed before the vehicle leaves; the extras are decided after it comes back, by
// whoever took the call — a tank of fuel, a damaged seat, an hour of waiting the customer agreed to on
// the phone. That timing is what makes them worth a rule: the customer is not standing at the desk, the
// price was settled days ago, and the person adding the charge is the person who benefits from it.
//
// So an extra charge carries three things the rest of the hire does not: a **reason** in the office's
// own words (a charge nobody can explain is the first line of a dispute), **who added it**, and an
// **approval** — required only above a figure the company sets, and never given by the person who added
// it. Null in that setting is a real answer: this company has not asked for a second signature on
// charges, and the screens say so rather than implying the money was checked.
//
// The arithmetic is the money module's, as everywhere else: amounts in whole pesewas, one rounding per
// line. Nothing here decides a price or writes a record; `service.ts` does that, and `finance.ts` reads
// the signatures before it will bill them.
import { formatAmount, linesTotal, parseAmount, parseQuantity, toMinor } from "./money";
import type { Approval, ExtraCharge, QuoteLine, Rental } from "./types";

/** The errors a form shows, keyed the way the screen names its fields. */
export type ChargeErrors = Record<string, string>;

/** What the office types to add a charge. Amounts and quantities arrive as text, and are never coerced. */
export interface ChargeInput {
  description: string;
  quantity: string;
  unitAmount: string;
  reason: string;
}

/** The figure a charge is entered at, in money: quantity × unit amount, one rounding. */
export function chargeAmount(charge: { quantity: number; unitAmount: number }): number {
  return linesTotal([{ quantity: charge.quantity, unitAmount: charge.unitAmount }]);
}

/**
 * Whether this charge is large enough to need a second signature.
 *
 * `null` means the company has not set a figure, and no charge is caught by a rule nobody wrote.
 */
export function chargeNeedsApproval(amount: number, threshold: number | null): boolean {
  return threshold !== null && Number.isFinite(threshold) && toMinor(amount) >= toMinor(threshold);
}

/** True when a charge has been signed off for the amount it is actually for. */
export function chargeIsApproved(charge: ExtraCharge): boolean {
  return charge.approval !== null && typeof charge.approval.at === "string" && toMinor(charge.approval.total) === toMinor(chargeAmount(charge));
}

/** The charges on a hire that the company's rule catches and nobody has signed: what holds up the bill. */
export function unapprovedCharges(rental: Rental, threshold: number | null): ExtraCharge[] {
  return rental.extraCharges.filter((charge) => chargeNeedsApproval(chargeAmount(charge), threshold) && !chargeIsApproved(charge));
}

/**
 * Why this person cannot sign this charge off, in words, or null when they can.
 *
 * Four eyes, as with a quotation (D-121): whoever added the charge is not whoever approves it, and an
 * approval already given is not given again. A name is compared only for a charge recorded before the
 * author's account was kept, because a control that silently passes old records is not a control.
 */
export function chargeApprovalProblem(charge: ExtraCharge, chargeIndex: number, approverId: string | null, approverName: string): string | null {
  if (chargeIsApproved(charge)) {
    return `This charge was already approved by ${charge.approval!.byName} on ${charge.approval!.at.slice(0, 10)}.`;
  }
  const sameAccount = charge.addedById !== null && approverId !== null && charge.addedById === approverId;
  const sameName = charge.addedById === null && charge.addedByName.trim().toLowerCase() === approverName.trim().toLowerCase();
  if (sameAccount || sameName) {
    const which = charge.description.trim() ? `the charge for ${charge.description.trim()}` : `charge ${chargeIndex + 1}`;
    return `The person who added ${which} cannot also approve it. Somebody else has to sign it off.`;
  }
  return null;
}

/**
 * The sentence a screen prints under a charge, or null when there is nothing to say.
 *
 * It answers one question — "is this money checked?" — and never says a charge is approved when it is
 * not, nor that one is fine merely because no figure has been set.
 */
export function chargeApprovalLine(charge: ExtraCharge, threshold: number | null, currency: string): string | null {
  const amount = chargeAmount(charge);
  if (chargeIsApproved(charge)) {
    const note = charge.approval!.note ? ` "${charge.approval!.note}"` : "";
    return `Approved by ${charge.approval!.byName} on ${charge.approval!.at.slice(0, 10)}.${note}`;
  }
  if (chargeNeedsApproval(amount, threshold)) return `A second signature is required: this charge is at or above ${currency} ${formatAmount(threshold!)}.`;
  return threshold === null ? "No approval is required: the company has not set a figure that needs one." : null;
}

/**
 * Read the charges typed at completion.
 *
 * Blank rows are ignored rather than refused: the form starts with one empty row and an office that
 * added nothing should not have to delete it. A row that is partly filled in is a mistake to show, and
 * its errors are keyed by row so the screen can point at the field that is wrong.
 */
export function readExtraCharges(
  input: ChargeInput[] | undefined,
  actor: { id: string | null; fullName: string },
  now: string,
  makeId: () => string,
): { errors: ChargeErrors; charges: ExtraCharge[] } {
  const errors: ChargeErrors = {};
  const charges: ExtraCharge[] = [];
  (input ?? []).forEach((row, index) => {
    const description = (row.description ?? "").trim();
    const reason = (row.reason ?? "").trim();
    const quantityText = (row.quantity ?? "").trim();
    const amountText = (row.unitAmount ?? "").trim();
    // A row counts as untouched when there is no description, no reason and no amount. The form starts
    // every row with a quantity of 1, so a quantity on its own is not a half-filled charge.
    const blank = !description && !reason && !amountText;
    if (blank) return;
    const quantity = parseQuantity(quantityText === "" ? "1" : quantityText);
    const amount = parseAmount(amountText);
    if (!description) errors[`extraCharges.${index}.description`] = "Say what the charge is for.";
    if (!reason) errors[`extraCharges.${index}.reason`] = "Give a reason for the charge: the customer will read it.";
    if (quantity.problem === "too-many-decimals") errors[`extraCharges.${index}.quantity`] = "Use at most three decimal places.";
    else if (quantity.problem) errors[`extraCharges.${index}.quantity`] = "Quantity must be greater than 0.";
    if (amount.problem === "too-many-decimals") errors[`extraCharges.${index}.unitAmount`] = "Use at most two decimal places: amounts are in pesewas.";
    else if (amount.problem === "too-large") errors[`extraCharges.${index}.unitAmount`] = "That amount looks wrong. Check the figure.";
    else if (amount.problem) errors[`extraCharges.${index}.unitAmount`] = "Amount must be 0 or more.";
    charges.push({
      id: makeId(),
      description,
      quantity: quantity.quantity,
      unitAmount: amount.amount,
      reason,
      addedById: actor.id,
      addedByName: actor.fullName,
      addedAt: now,
      approval: null,
    });
  });
  return { errors, charges };
}

/**
 * The charges as invoice lines.
 *
 * The customer's copy has to say why they are paying, so the reason the office wrote is printed under
 * the charge rather than kept in the record. Revenue on the invoice is the same arithmetic as anywhere
 * else: quantity × unit amount, one rounding.
 */
export function chargeLines(charges: ExtraCharge[]): QuoteLine[] {
  return charges.map((charge) => ({
    id: charge.id,
    description: charge.reason ? `${charge.description} (${charge.reason})` : charge.description,
    quantity: charge.quantity,
    unitAmount: charge.unitAmount,
  }));
}

/** The approval written when somebody signs a charge off. */
export function chargeApproval(charge: ExtraCharge, actor: { id: string | null; fullName: string }, note: string, now: string): Approval {
  return {
    at: now,
    byActorId: actor.id,
    byName: actor.fullName,
    note: note.trim(),
    total: chargeAmount(charge),
  };
}
