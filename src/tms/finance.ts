// Invoices and manual payments (brief FIN-02, FIN-03, invariants 5.4 and 5.6).
//
// An invoice is raised from a completed rental's final invoice line items. The operator does not
// retype the prices here: the quotation was priced, the completion step recorded what was actually
// supplied, and this module turns that into a numbered document with the tax lines configured in
// settings. That is why an invoice cannot be issued for a rental that was never completed, and why
// every total is derived rather than entered.
//
// Numbers come from the shared allocator in `references.ts` (audit D-03), which the database mirrors
// into reference_counter so two writers cannot allocate the same number. An issued invoice never changes: identity, dates, lines
// and totals are frozen here and by trigger in migration 003. Only its status, amount paid and void
// note move, and the void path refuses once money has been recorded against it.

import { creditedTotal, invoiceBalance, livePayments } from "./creditNotes";
import { formatAmount, fromMinor, linesTotal, parseAmount, parsePositiveAmount, percentOfMinor, toMinor } from "./money";
import { allocateReference } from "./references";
import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type {
  CreditNote,
  Database,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  InvoiceTaxLine,
  Payment,
  PaymentStatus,
} from "./types";
import { PAYMENT_STATUSES } from "./types";

export const FINANCE_COMMAND_TYPES = [
  "issue_rental_invoice",
  "void_invoice",
  "record_payment",
  "advance_payment",
  "void_payment",
  "issue_credit_note",
  "void_credit_note",
] as const;

export interface IssueInvoiceInput {
  rentalId: string;
  issuedOn: string;
  discountAmount: string;
  discountReason: string;
  notes: string;
}

export interface PaymentInput {
  invoiceId: string;
  amount: string;
  method: string;
  paidOn: string;
  externalReference: string;
  note: string;
}

/**
 * What the operator types to take money off an invoice.
 *
 * `amount` is deliberately stated **before tax**: the credit note carries the invoice's own tax
 * lines, and the tax is worked out here rather than typed in. An operator who had to work out the
 * tax on a refund by hand would be the most likely place in the whole system for the two figures to
 * drift apart, and a credit note's tax must reverse the tax that was actually charged.
 */
export interface CreditNoteInput {
  invoiceId: string;
  issuedOn: string;
  amount: string;
  description: string;
  reason: string;
}

export type FinanceCommand =
  | { type: "issue_rental_invoice"; input: IssueInvoiceInput }
  | { type: "void_invoice"; id: string; reason: string }
  | { type: "record_payment"; input: PaymentInput }
  | { type: "advance_payment"; id: string; to: PaymentStatus }
  | { type: "void_payment"; id: string; reason: string }
  | { type: "issue_credit_note"; input: CreditNoteInput }
  | { type: "void_credit_note"; id: string; reason: string };

export function isFinanceCommand(command: { type: string }): command is FinanceCommand {
  return (FINANCE_COMMAND_TYPES as readonly string[]).includes(command.type);
}

const PAYMENT_RANK: Record<PaymentStatus, number> = { recorded: 1, verified: 2, reconciled: 3 };


/** What a rental can be billed for: the completion record, and nothing else. */
export function billableEventFor(rentalId: string): string {
  return `rental:${rentalId}:final`;
}

/**
 * What is still owed on an invoice: total, less money received, less what was credited back.
 *
 * Compared and subtracted in integer pesewas: `paid >= total` on floats is where an invoice that is
 * paid to the cedi shows a pesewa of balance forever (audit D-04). The arithmetic itself lives in
 * `creditNotes.ts` so the screen, the reports and this module cannot disagree (D-86).
 */
export function outstanding(db: Database, invoice: Invoice): number {
  return invoiceBalance(db, invoice).outstanding;
}

/**
 * The invoice as it stands once its payments are what the database holds.
 *
 * `amountPaid` is the sum of the payments that still count, and the status follows from that sum.
 * Both a recorded payment and a cancelled one move these same two fields, so they are worked out in
 * one place: a cancelled payment that left `amountPaid` where it was would make the invoice claim
 * money the office never received (D-88).
 */
function withPaymentsToDate(db: Database, invoice: Invoice, now: string): Invoice {
  const balance = invoiceBalance(db, invoice);
  return {
    ...invoice,
    amountPaid: balance.paid,
    // A void invoice stays void: nothing about cancelling a payment brings one back to life.
    status: invoice.status === "void" ? "void" : statusFor(toMinor(invoice.total), toMinor(balance.paid)),
    updatedAt: now,
  };
}

function statusFor(totalMinor: number, paidMinorTotal: number): InvoiceStatus {
  if (paidMinorTotal <= 0) return "issued";
  return paidMinorTotal >= totalMinor ? "paid" : "part_paid";
}

/**
 * Tax on the taxable subtotal, each line rounded once, half-up.
 *
 * 15% of GHS 15.90 is GHS 2.385, which a person writing the invoice by hand would put down as
 * GHS 2.39. The old float helper produced 2.38 for that subtotal (audit D-04).
 */
function taxLinesFor(db: Database, subtotal: number): InvoiceTaxLine[] {
  if (db.settings.taxPosition !== "registered") return [];
  const subtotalMinor = toMinor(subtotal);
  return db.settings.taxLines.map((line) => ({
    name: line.name,
    ratePercent: line.ratePercent,
    amount: fromMinor(percentOfMinor(subtotalMinor, line.ratePercent)),
  }));
}

/**
 * The tax a credit note reverses, taken from the invoice's own snapshot rather than from today's
 * settings.
 *
 * If the rate changed after the invoice went out, the credit still has to reverse the tax that was
 * actually charged on that document, or the two figures would not cancel. An invoice raised before
 * the company registered for tax has no lines, so its credit has no tax either.
 */
function creditTaxLinesFor(invoice: Invoice, subtotal: number): InvoiceTaxLine[] {
  const subtotalMinor = toMinor(subtotal);
  return invoice.taxLines.map((line) => ({
    name: line.name,
    ratePercent: line.ratePercent,
    amount: fromMinor(percentOfMinor(subtotalMinor, line.ratePercent)),
  }));
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function executeFinance(db: Database, actor: Actor | null, command: FinanceCommand, now = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "issue_rental_invoice": {
      const denied = authorise(actor, "invoices:issue");
      if (denied) return denied;
      const errors: Errors = {};
      const input = command.input;
      const rental = db.rentals.find((record) => record.id === input.rentalId);
      if (!input.rentalId) errors.rentalId = "Select the rental to invoice.";
      else if (!rental) errors.rentalId = "Rental not found.";

      if (rental && !rental.finalInvoice) {
        errors.rentalId = `${rental.reference} has no final invoice yet. Complete the rental first: the amounts billed come from that step.`;
      }
      if (!isValidDate(input.issuedOn)) errors.issuedOn = "Enter the invoice date.";
      else if (input.issuedOn > now.slice(0, 10)) errors.issuedOn = "An invoice cannot be dated in the future.";

      // Blank means "no discount"; anything else is decimal text, read exactly.
      const discountParsed = input.discountAmount.trim() === "" ? { amount: 0, problem: null } : parseAmount(input.discountAmount);
      const discount = discountParsed.amount;
      if (discountParsed.problem === "too-many-decimals") {
        errors.discountAmount = "Use at most two decimal places: amounts are in pesewas.";
      } else if (discountParsed.problem === "too-large") {
        errors.discountAmount = "That amount looks wrong. Check the figure.";
      } else if (discountParsed.problem) {
        errors.discountAmount = "Enter the discount as an amount of 0 or more, or leave it blank.";
      }
      if (discount > 0 && !input.discountReason.trim()) errors.discountReason = "Give a reason for the discount.";

      // Settings that have no confirmed value block the action instead of defaulting (brief 2.3, 9).
      if (db.settings.taxPosition === null) {
        errors.taxPosition = "Set the company tax position in Settings before issuing an invoice.";
      } else if (db.settings.taxPosition === "registered" && db.settings.taxLines.length === 0) {
        errors.taxPosition = "The company is set as VAT registered but no tax lines are configured in Settings.";
      }
      if (db.settings.invoiceDueDays === null) {
        errors.invoiceDueDays = "Set the payment terms (days) in Settings before issuing an invoice.";
      }
      if (input.notes.trim().length > 1000) errors.notes = "Keep the note to 1000 characters.";

      const currencyCode = db.settings.currencyCode ?? rental?.finalInvoice?.currencyCode ?? "";
      if (!currencyCode) errors.currencyCode = "Set the company currency in Settings before issuing an invoice.";

      if (rental && !errors.rentalId) {
        const live = db.invoices.find((invoice) => invoice.billableEvent === billableEventFor(rental.id) && invoice.status !== "void");
        if (live) {
          errors.rentalId = `${rental.reference} is already invoiced as ${live.reference}. Void that invoice before issuing another, so the same service is never billed twice.`;
        }
      }
      if (Object.keys(errors).length) return fail("Please correct the invoice details.", errors);

      const finalLines: InvoiceLine[] = (rental!.finalInvoice?.lines ?? []).map((line) => ({
        id: makeId(),
        description: line.description,
        quantity: line.quantity,
        unitAmount: line.unitAmount,
      }));
      if (finalLines.length === 0) return fail("The final invoice on this rental has no line items, so there is nothing to bill.");
      const lines = [...finalLines];
      if (discount > 0) {
        lines.push({ id: makeId(), description: `Discount: ${input.discountReason.trim()}`, quantity: 1, unitAmount: -discount });
      }
      // Every total below is summed in whole pesewas (money.ts): line amounts, then tax on the
      // rounded subtotal, then the total. One rounding at each step, none inside a sum.
      const subtotalMinor = lines.reduce((sum, line) => sum + toMinor(linesTotal([line])), 0);
      if (subtotalMinor < 0) return fail("The discount is larger than the invoice, so the total would be negative.");
      const subtotal = fromMinor(subtotalMinor);
      const taxLines = taxLinesFor(db, subtotal);
      const totalMinor = subtotalMinor + taxLines.reduce((sum, line) => sum + toMinor(line.amount), 0);
      const total = fromMinor(totalMinor);

      const period = input.issuedOn.slice(0, 4);
      const { reference, counters } = allocateReference(db, "invoice", period);
      const invoice: Invoice = {
        id: makeId(),
        reference,
        kind: "rental",
        rentalId: rental!.id,
        clientId: rental!.clientId,
        customerName: rental!.customerName,
        currencyCode,
        lines,
        taxLines,
        subtotal,
        total,
        amountPaid: 0,
        status: "issued",
        billableEvent: billableEventFor(rental!.id),
        issuedOn: input.issuedOn,
        dueOn: addDays(input.issuedOn, db.settings.invoiceDueDays!),
        notes: input.notes.trim(),
        voidReason: null,
        voidedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const next = audit(
        { ...db, referenceCounters: counters, invoices: [...db.invoices, invoice] },
        actor,
        {
          action: "finance:invoice_issue",
          entity: "invoice",
          entityId: invoice.id,
          summary: `${invoice.reference} issued to ${invoice.customerName} for ${rental!.reference}: ${currencyCode} ${formatAmount(total)}, due ${invoice.dueOn}.`,
        },
        now,
      );
      return { ok: true, db: next, message: `${invoice.reference} issued: ${currencyCode} ${formatAmount(total)} due ${invoice.dueOn}.` };
    }

    case "void_invoice": {
      const denied = authorise(actor, "invoices:void");
      if (denied) return denied;
      const invoice = db.invoices.find((record) => record.id === command.id);
      if (!invoice) return fail("Invoice not found.");
      if (invoice.status === "void") return fail(`${invoice.reference} is already void.`);
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Give a short reason." });
      // Only payments that still count block a void: a cancelled one never happened, so it cannot
      // stand in the way of cancelling the invoice it was wrongly recorded against (D-88).
      const payments = livePayments(db).filter((payment) => payment.invoiceId === invoice.id);
      if (payments.length) {
        return fail(
          `${invoice.reference} has ${payments.length} payment${payments.length === 1 ? "" : "s"} recorded against it, so it cannot be voided. Cancel the payment if it was recorded in error, or take the money off with a credit note.`,
        );
      }
      const credits = db.creditNotes.filter((note) => note.invoiceId === invoice.id && note.status === "issued");
      if (credits.length) {
        return fail(
          `${invoice.reference} has ${credits.length === 1 ? `credit note ${credits[0].reference}` : `${credits.length} credit notes`} against it, so it cannot be voided. Void the credit note first if it was wrong.`,
        );
      }
      const updated: Invoice = { ...invoice, status: "void", voidReason: command.reason.trim(), voidedAt: now, updatedAt: now };
      const next = audit(
        { ...db, invoices: db.invoices.map((record) => (record.id === updated.id ? updated : record)) },
        actor,
        {
          action: "finance:invoice_void",
          entity: "invoice",
          entityId: updated.id,
          summary: `${updated.reference} voided. Reason: ${command.reason.trim()}`,
        },
        now,
      );
      return { ok: true, db: next, message: `${updated.reference} voided.` };
    }

    case "record_payment": {
      const denied = authorise(actor, "payments:record");
      if (denied) return denied;
      const errors: Errors = {};
      const input = command.input;
      const invoice = db.invoices.find((record) => record.id === input.invoiceId);
      if (!input.invoiceId) errors.invoiceId = "Select the invoice this payment is for.";
      else if (!invoice) errors.invoiceId = "Invoice not found.";
      else if (invoice.status === "void") errors.invoiceId = `${invoice.reference} is void and cannot take payments.`;

      const parsed = parsePositiveAmount(input.amount ?? "");
      const amount = parsed.amount;
      const dueNow = invoice ? outstanding(db, invoice) : 0;
      if (parsed.problem === "too-many-decimals") errors.amount = "Use at most two decimal places: amounts are in pesewas.";
      else if (parsed.problem === "too-large") errors.amount = "That amount looks wrong. Check the figure.";
      else if (parsed.problem) errors.amount = "Enter the amount received.";
      // Compared in whole pesewas, so an invoice settled exactly is settled: no 0.001 fudge factor,
      // and no way for the last pesewa to be both owed and paid (audit D-04).
      else if (invoice && toMinor(amount) > toMinor(dueNow)) {
        errors.amount = `${invoice.reference} has ${invoice.currencyCode} ${formatAmount(dueNow)} outstanding, so this payment is too large.`;
      }

      const method = input.method.trim();
      if (!method) errors.method = "Select the payment method.";
      else if (!db.settings.rental.paymentMethods.includes(method)) errors.method = "Unknown payment method. Add it in Settings first.";
      if (!isValidDate(input.paidOn)) errors.paidOn = "Enter the date the payment was received.";
      else if (invoice && input.paidOn < invoice.issuedOn) errors.paidOn = `A payment cannot pre-date the invoice (${invoice.issuedOn}).`;
      if (input.externalReference.trim().length > 120) errors.externalReference = "Keep the external reference to 120 characters.";
      if (input.note.trim().length > 500) errors.note = "Keep the note to 500 characters.";
      if (Object.keys(errors).length) return fail("Please correct the payment details.", errors);

      const externalReference = input.externalReference.trim();
      // Idempotency: the bank slip or MoMo transaction id is the key (brief 5.4, 5.8). Recording the
      // same slip twice returns the existing payment instead of adding a second one.
      const duplicate = externalReference
        ? db.payments.find((payment) => payment.invoiceId === invoice!.id && payment.externalReference === externalReference)
        : undefined;
      if (duplicate) {
        return {
          ok: true,
          db,
          message: `That external reference is already recorded as ${duplicate.reference}; nothing was added.`,
        };
      }

      const period = input.paidOn.slice(0, 4);
      const { reference, counters } = allocateReference(db, "payment", period);
      const payment: Payment = {
        id: makeId(),
        reference,
        invoiceId: invoice!.id,
        amount,
        currencyCode: invoice!.currencyCode,
        method,
        paidOn: input.paidOn,
        externalReference,
        status: "recorded",
        note: input.note.trim(),
        log: [
          {
            id: makeId(),
            at: now,
            actorId: actor?.id ?? null,
            actorName: actor?.fullName ?? "System",
            note: `Payment recorded via ${method}.`,
            fromStatus: null,
            toStatus: "recorded",
          },
        ],
        recordedBy: actor?.fullName ?? "System",
        recordedAt: now,
        voidReason: null,
        voidedAt: null,
      };

      // The invoice's paid figure and status are worked out from the payments that will exist, by
      // the one helper both this command and a cancellation use (D-88).
      const recorded = { ...db, referenceCounters: counters, payments: [...db.payments, payment] };
      const updated = withPaymentsToDate(recorded, invoice!, now);
      const balance = invoiceBalance(recorded, updated);
      const next = audit(
        {
          ...recorded,
          invoices: db.invoices.map((record) => (record.id === updated.id ? updated : record)),
        },
        actor,
        {
          action: "finance:payment_record",
          entity: "payment",
          entityId: payment.id,
          summary: `${payment.reference} ${payment.currencyCode} ${formatAmount(payment.amount)} recorded against ${updated.reference} (${method}). Outstanding ${updated.currencyCode} ${formatAmount(balance.outstanding)}.`,
        },
        now,
      );
      return {
        ok: true,
        db: next,
        message: `${payment.reference} recorded. ${updated.reference} outstanding: ${updated.currencyCode} ${formatAmount(balance.outstanding)}.`,
      };
    }

    case "void_payment": {
      // A payment recorded against the wrong invoice, or for money that never arrived, has to be
      // correctable: otherwise the invoice asks for money the office never received and the only way
      // out is a hand-written row in the database (D-88). The record keeps its number, the reason is
      // kept beside it, and the invoice goes back to what it actually owed.
      const denied = authorise(actor, "payments:void");
      if (denied) return denied;
      const payment = db.payments.find((record) => record.id === command.id);
      if (!payment) return fail("Payment not found.");
      if (payment.voidedAt) return fail(`${payment.reference} is already cancelled.`);
      const reason = command.reason.trim();
      if (!reason) return fail("A reason is required.", { reason: "Say why this payment is being cancelled." });
      if (reason.length > 300) return fail("Keep the reason to 300 characters.", { reason: "Keep the reason to 300 characters." });
      const invoice = db.invoices.find((record) => record.id === payment.invoiceId);
      if (!invoice) return fail("The invoice this payment was recorded against is missing, so its balance cannot be corrected.");

      const cancelled: Payment = {
        ...payment,
        voidReason: reason,
        voidedAt: now,
        log: [
          ...payment.log,
          {
            id: makeId(),
            at: now,
            actorId: actor?.id ?? null,
            actorName: actor?.fullName ?? "System",
            note: `Payment cancelled: ${reason}`,
            fromStatus: payment.status,
            toStatus: payment.status,
          },
        ],
      };
      const afterCancel = { ...db, payments: db.payments.map((record) => (record.id === cancelled.id ? cancelled : record)) };
      const updated = withPaymentsToDate(afterCancel, invoice, now);
      const balance = invoiceBalance(afterCancel, updated);
      const reconciledNote =
        payment.status === "reconciled"
          ? " It had already been reconciled with the bank statement, so that reconciliation is now short by this amount."
          : "";
      const next = audit(
        { ...afterCancel, invoices: db.invoices.map((record) => (record.id === updated.id ? updated : record)) },
        actor,
        {
          action: "finance:payment_void",
          entity: "payment",
          entityId: cancelled.id,
          summary: `${cancelled.reference} ${cancelled.currencyCode} ${formatAmount(cancelled.amount)} cancelled against ${updated.reference} (was ${payment.status}). Reason: ${reason}${reconciledNote} ${updated.reference} outstanding: ${updated.currencyCode} ${formatAmount(balance.outstanding)}.`,
        },
        now,
      );
      return {
        ok: true,
        db: next,
        message: `${cancelled.reference} cancelled. ${updated.reference} outstanding: ${updated.currencyCode} ${formatAmount(balance.outstanding)}.${reconciledNote}`,
      };
    }

    case "advance_payment": {
      const denied = authorise(actor, "payments:advance");
      if (denied) return denied;
      const payment = db.payments.find((record) => record.id === command.id);
      if (!payment) return fail("Payment not found.");
      if (!(PAYMENT_STATUSES as readonly string[]).includes(command.to)) return fail("Unknown payment status.");
      if (PAYMENT_RANK[command.to] <= PAYMENT_RANK[payment.status]) {
        return fail(`${payment.reference} is already ${payment.status}; payment status only moves forwards.`);
      }
      const updated: Payment = {
        ...payment,
        status: command.to,
        log: [
          ...payment.log,
          {
            id: makeId(),
            at: now,
            actorId: actor?.id ?? null,
            actorName: actor?.fullName ?? "System",
            note: `Status advanced to ${command.to}.`,
            fromStatus: payment.status,
            toStatus: command.to,
          },
        ],
      };
      const next = audit(
        { ...db, payments: db.payments.map((record) => (record.id === updated.id ? updated : record)) },
        actor,
        {
          action: `finance:payment_${command.to}`,
          entity: "payment",
          entityId: updated.id,
          summary: `${updated.reference} marked ${command.to}.`,
        },
        now,
      );
      return { ok: true, db: next, message: `${updated.reference} marked ${command.to}.` };
    }

    case "issue_credit_note": {
      const denied = authorise(actor, "credits:issue");
      if (denied) return denied;
      const errors: Errors = {};
      const input = command.input;
      const invoice = db.invoices.find((record) => record.id === input.invoiceId);
      if (!input.invoiceId) errors.invoiceId = "Select the invoice this credit is for.";
      else if (!invoice) errors.invoiceId = "Invoice not found.";
      else if (invoice.status === "void") errors.invoiceId = `${invoice.reference} is void, so there is nothing left to credit.`;

      const parsed = parsePositiveAmount(input.amount ?? "");
      const subtotal = parsed.problem ? 0 : parsed.amount;
      const taxLines = invoice ? creditTaxLinesFor(invoice, subtotal) : [];
      const total = fromMinor(toMinor(subtotal) + taxLines.reduce((sum, line) => sum + toMinor(line.amount), 0));
      const roomMinor = invoice ? toMinor(invoice.total) - toMinor(creditedTotal(db, invoice)) : 0;

      if (parsed.problem === "too-many-decimals") errors.amount = "Use at most two decimal places: amounts are in pesewas.";
      else if (parsed.problem === "too-large") errors.amount = "That amount looks wrong. Check the figure.";
      else if (parsed.problem) errors.amount = "Enter the amount to credit, before tax.";
      else if (invoice && toMinor(total) > roomMinor) {
        // The ceiling is the invoice's own total, less what has already been credited. Stated in the
        // same terms as the figures on screen: this is money off the bill, not money in the bank.
        errors.amount =
          roomMinor <= 0
            ? `${invoice.reference} has already been credited in full; nothing is left to take off it.`
            : `That is more than ${invoice.reference} has left: ${invoice.currencyCode} ${formatAmount(fromMinor(roomMinor))} including tax.`;
      }

      const description = input.description.trim();
      if (!description) errors.description = "Say what this credit is for, as it should read on the document.";
      else if (description.length > 200) errors.description = "Keep the description to 200 characters.";
      const reason = input.reason.trim();
      if (!reason) errors.reason = "Give a short reason. It is kept on the record.";
      else if (reason.length > 300) errors.reason = "Keep the reason to 300 characters.";
      if (!isValidDate(input.issuedOn)) errors.issuedOn = "Enter the date of the credit note.";
      else if (invoice && input.issuedOn < invoice.issuedOn) errors.issuedOn = `A credit note cannot pre-date the invoice (${invoice.issuedOn}).`;
      if (Object.keys(errors).length) return fail("Please correct the credit note details.", errors);

      const period = input.issuedOn.slice(0, 4);
      const { reference, counters } = allocateReference(db, "creditNote", period);
      const note: CreditNote = {
        id: makeId(),
        reference,
        invoiceId: invoice!.id,
        invoiceReference: invoice!.reference,
        clientId: invoice!.clientId,
        customerName: invoice!.customerName,
        currencyCode: invoice!.currencyCode,
        // One line in this release: the amount the office decided to take off, described in the
        // operator's own words. The document shape allows more lines if a later form offers them.
        lines: [{ id: makeId(), description, quantity: 1, unitAmount: subtotal }],
        taxLines,
        subtotal,
        total,
        reason,
        issuedOn: input.issuedOn,
        status: "issued",
        voidReason: null,
        voidedAt: null,
        createdBy: actor?.fullName ?? "System",
        createdAt: now,
        updatedAt: now,
      };
      const nextDb = { ...db, referenceCounters: counters, creditNotes: [...db.creditNotes, note] };
      const balance = invoiceBalance(nextDb, invoice!);
      const taxMinor = toMinor(total) - toMinor(subtotal);
      const taxNote = taxLines.length ? ` (including ${invoice!.currencyCode} ${formatAmount(fromMinor(taxMinor))} tax)` : "";
      const refundNote = balance.refundDue > 0
        ? ` ${invoice!.reference} is now paid past its total: ${invoice!.currencyCode} ${formatAmount(balance.refundDue)} is owed back to the customer as a refund.`
        : ` ${invoice!.reference} outstanding: ${invoice!.currencyCode} ${formatAmount(balance.outstanding)}.`;
      const next = audit(
        nextDb,
        actor,
        {
          action: "finance:credit_note_issue",
          entity: "creditNote",
          entityId: note.id,
          summary: `${note.reference} credited ${note.currencyCode} ${formatAmount(note.total)} against ${invoice!.reference}. Reason: ${reason}.${refundNote}`,
        },
        now,
      );
      return { ok: true, db: next, message: `${note.reference} issued for ${note.currencyCode} ${formatAmount(note.total)}${taxNote}.${refundNote}` };
    }

    case "void_credit_note": {
      const denied = authorise(actor, "credits:void");
      if (denied) return denied;
      const note = db.creditNotes.find((record) => record.id === command.id);
      if (!note) return fail("Credit note not found.");
      if (note.status === "void") return fail(`${note.reference} is already void.`);
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Give a short reason." });
      const updated: CreditNote = {
        ...note,
        status: "void",
        voidReason: command.reason.trim(),
        voidedAt: now,
        updatedAt: now,
      };
      const nextDb = { ...db, creditNotes: db.creditNotes.map((record) => (record.id === updated.id ? updated : record)) };
      const invoice = db.invoices.find((record) => record.id === note.invoiceId);
      const balance = invoice ? invoiceBalance(nextDb, invoice) : null;
      const next = audit(
        nextDb,
        actor,
        {
          action: "finance:credit_note_void",
          entity: "creditNote",
          entityId: updated.id,
          summary: `${updated.reference} voided: ${updated.currencyCode} ${formatAmount(updated.total)} restored to ${note.invoiceReference}. Reason: ${updated.voidReason}`,
        },
        now,
      );
      return {
        ok: true,
        db: next,
        message: `${updated.reference} voided.${balance ? ` ${note.invoiceReference} outstanding: ${note.currencyCode} ${formatAmount(balance.outstanding)}.` : ""}`,
      };
    }
  }
}
