// Invoices and manual payments (brief FIN-02, FIN-03, invariants 5.4 and 5.6).
//
// An invoice is raised from a completed rental's final invoice line items. The operator does not
// retype the prices here: the quotation was priced, the completion step recorded what was actually
// supplied, and this module turns that into a numbered document with the tax lines configured in
// settings. That is why an invoice cannot be issued for a rental that was never completed, and why
// every total is derived rather than entered.
//
// Numbers come from referenceCounters, which the database mirrors in reference_counter so two
// writers cannot allocate the same number. An issued invoice never changes: identity, dates, lines
// and totals are frozen here and by trigger in migration 003. Only its status, amount paid and void
// note move, and the void path refuses once money has been recorded against it.

import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import type {
  Database,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  InvoiceTaxLine,
  Payment,
  PaymentStatus,
  ReferenceCounter,
} from "./types";
import { PAYMENT_STATUSES } from "./types";

export const FINANCE_COMMAND_TYPES = ["issue_rental_invoice", "void_invoice", "record_payment", "advance_payment"] as const;

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

export type FinanceCommand =
  | { type: "issue_rental_invoice"; input: IssueInvoiceInput }
  | { type: "void_invoice"; id: string; reason: string }
  | { type: "record_payment"; input: PaymentInput }
  | { type: "advance_payment"; id: string; to: PaymentStatus };

export function isFinanceCommand(command: { type: string }): command is FinanceCommand {
  return (FINANCE_COMMAND_TYPES as readonly string[]).includes(command.type);
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const PAYMENT_RANK: Record<PaymentStatus, number> = { recorded: 1, verified: 2, reconciled: 3 };

const pad4 = (n: number) => String(n).padStart(4, "0");

/** Allocate the next number in `scope` for the year `period`. Counters only move forwards. */
export function allocateReference(
  db: Database,
  scope: ReferenceCounter["scope"],
  period: string,
): { reference: string; counters: ReferenceCounter[] } {
  const existing = db.referenceCounters.find((counter) => counter.scope === scope && counter.period === period);
  const next = (existing?.last ?? 0) + 1;
  const counters = existing
    ? db.referenceCounters.map((counter) => (counter === existing ? { ...counter, last: next } : counter))
    : [...db.referenceCounters, { scope, period, last: next }];
  const prefix = scope === "invoice" ? "INV" : "PAY";
  return { reference: `${prefix}-${period}-${pad4(next)}`, counters };
}

/** What a rental can be billed for: the completion record, and nothing else. */
export function billableEventFor(rentalId: string): string {
  return `rental:${rentalId}:final`;
}

export function outstanding(db: Database, invoice: Invoice): number {
  const paid = db.payments.filter((payment) => payment.invoiceId === invoice.id).reduce((sum, payment) => sum + payment.amount, 0);
  return round2(Math.max(invoice.total - paid, 0));
}

function statusFor(total: number, paid: number): InvoiceStatus {
  if (paid <= 0) return "issued";
  return paid >= total ? "paid" : "part_paid";
}

function taxLinesFor(db: Database, subtotal: number): InvoiceTaxLine[] {
  if (db.settings.taxPosition !== "registered") return [];
  return db.settings.taxLines.map((line) => ({
    name: line.name,
    ratePercent: line.ratePercent,
    amount: round2((subtotal * line.ratePercent) / 100),
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

      const discount = input.discountAmount.trim() === "" ? 0 : Number(input.discountAmount);
      if (input.discountAmount.trim() !== "" && (!Number.isFinite(discount) || discount < 0)) {
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
        lines.push({ id: makeId(), description: `Discount: ${input.discountReason.trim()}`, quantity: 1, unitAmount: -round2(discount) });
      }
      const subtotal = round2(lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0));
      if (subtotal < 0) return fail("The discount is larger than the invoice, so the total would be negative.");
      const taxLines = taxLinesFor(db, subtotal);
      const total = round2(subtotal + taxLines.reduce((sum, line) => sum + line.amount, 0));

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
          summary: `${invoice.reference} issued to ${invoice.customerName} for ${rental!.reference}: ${currencyCode} ${total.toFixed(2)}, due ${invoice.dueOn}.`,
        },
        now,
      );
      return { ok: true, db: next, message: `${invoice.reference} issued: ${currencyCode} ${total.toFixed(2)} due ${invoice.dueOn}.` };
    }

    case "void_invoice": {
      const denied = authorise(actor, "invoices:void");
      if (denied) return denied;
      const invoice = db.invoices.find((record) => record.id === command.id);
      if (!invoice) return fail("Invoice not found.");
      if (invoice.status === "void") return fail(`${invoice.reference} is already void.`);
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Give a short reason." });
      const payments = db.payments.filter((payment) => payment.invoiceId === invoice.id);
      if (payments.length) {
        return fail(
          `${invoice.reference} has ${payments.length} payment${payments.length === 1 ? "" : "s"} recorded against it, so it cannot be voided. Payments are immutable; correct the balance with an adjusting entry.`,
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

      const amount = Number(input.amount);
      const dueNow = invoice ? outstanding(db, invoice) : 0;
      if (input.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) errors.amount = "Enter the amount received.";
      else if (invoice && amount > dueNow + 0.001) {
        errors.amount = `${invoice.reference} has ${invoice.currencyCode} ${dueNow.toFixed(2)} outstanding, so this payment is too large.`;
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
        amount: round2(amount),
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
      };

      const paidTotal = round2(
        db.payments.filter((existing) => existing.invoiceId === invoice!.id).reduce((sum, existing) => sum + existing.amount, 0) + payment.amount,
      );
      const updated: Invoice = { ...invoice!, amountPaid: paidTotal, status: statusFor(invoice!.total, paidTotal), updatedAt: now };
      const next = audit(
        {
          ...db,
          referenceCounters: counters,
          payments: [...db.payments, payment],
          invoices: db.invoices.map((record) => (record.id === updated.id ? updated : record)),
        },
        actor,
        {
          action: "finance:payment_record",
          entity: "payment",
          entityId: payment.id,
          summary: `${payment.reference} ${payment.currencyCode} ${payment.amount.toFixed(2)} recorded against ${updated.reference} (${method}). Outstanding ${updated.currencyCode} ${outstanding({ ...db, payments: [...db.payments, payment] }, updated).toFixed(2)}.`,
        },
        now,
      );
      const balance = round2(Math.max(updated.total - paidTotal, 0));
      return {
        ok: true,
        db: next,
        message: `${payment.reference} recorded. ${updated.reference} outstanding: ${updated.currencyCode} ${balance.toFixed(2)}.`,
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
  }
}
