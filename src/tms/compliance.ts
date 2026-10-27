// Fleet and driver compliance documents (Q-16: document types and reminder lead time).
//
// This is deliberately separate from Driver.licenceExpiry, which already drives trip
// assignment eligibility (busing.ts, service.ts) and is left untouched (Integrity rule 6).
// A compliance document is any other paper the company tracks - insurance, roadworthy
// certificate, permits, IDs - named by the company itself in Settings, never invented
// here (Integrity rule 3). Reminder "expiring soon" status only appears once an
// administrator sets a lead time; until then only already-expired documents are flagged,
// exactly like the existing driver-licence check on the dashboard.

import { audit, authorise, fail, isValidDate, makeId, type Actor, type CommandResult, type Errors } from "./service";
import { DOCUMENT_OWNER_TYPES, type ComplianceDocument, type Database, type DocumentReminder } from "./types";
import { REMINDER_LIMITS, reminderFor } from "./documentReminders";

export const COMPLIANCE_COMMAND_TYPES = ["create_document", "update_document", "acknowledge_document_reminder"] as const;

export interface CreateDocumentInput {
  ownerType: "vehicle" | "driver";
  ownerId: string;
  documentTypeId: string;
  documentNumber: string;
  issuedDate: string;
  expiryDate: string;
  notes: string;
}

export interface UpdateDocumentInput {
  documentNumber: string;
  issuedDate: string;
  expiryDate: string;
  notes: string;
}

/**
 * Somebody taking a lapsed-or-lapsing paper's renewal on (FLT-03, D-110).
 *
 * The date is what makes this a reminder rather than a shrug: "somebody is dealing with it" with no
 * date is a sentence that can sit on a screen for a year.
 */
export interface AcknowledgeReminderInput {
  documentId: string;
  note: string;
  expectedBy: string;
}

export type ComplianceCommand =
  | { type: "create_document"; input: CreateDocumentInput }
  | { type: "update_document"; id: string; input: UpdateDocumentInput }
  | { type: "acknowledge_document_reminder"; input: AcknowledgeReminderInput };

export function isComplianceCommand(command: { type: string }): command is ComplianceCommand {
  return (COMPLIANCE_COMMAND_TYPES as readonly string[]).includes(command.type);
}

export type DocumentStatus = "expired" | "expiring_soon" | "valid" | "unknown";

/**
 * A document's status against today's date and the configured reminder lead time.
 * "expiring_soon" is only ever returned when a lead time has been set (Integrity rule 4:
 * never imply a judgement the business has not actually configured).
 */
export function documentStatus(expiryDate: string, leadDays: number | null, today: string): DocumentStatus {
  if (!isValidDate(expiryDate)) return "unknown";
  if (expiryDate < today) return "expired";
  if (leadDays === null) return "valid";
  const lead = new Date(`${today}T00:00:00Z`);
  lead.setUTCDate(lead.getUTCDate() + leadDays);
  const leadCutoff = lead.toISOString().slice(0, 10);
  return expiryDate <= leadCutoff ? "expiring_soon" : "valid";
}

/**
 * Whole days from `today` to `date`; negative when the date has passed. Both sides are read as
 * UTC calendar days, so a document that expires today returns 0 regardless of the workstation's
 * timezone. Returns null for an unparseable date rather than guessing.
 */
export function daysUntil(date: string, today: string): number | null {
  if (!isValidDate(date) || !isValidDate(today)) return null;
  const from = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const to = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((to - from) / 86400000);
}

/**
 * One missing or expired document that a company has declared mandatory (Q-16, D-76).
 *
 * `expiryDate` is null when no document of that type was ever recorded, so the caller can say
 * "none recorded" rather than pretending one exists and has lapsed.
 */
export interface RequiredDocumentGap {
  documentTypeId: string;
  name: string;
  expiryDate: string | null;
  reason: "missing" | "expired";
}

/**
 * The documents a vehicle or driver must hold on a given date, and does not.
 *
 * Only types the company marked as required are considered, and only on the date the work happens:
 * a certificate that expires before the run is as useless as one that was never recorded. Returns an
 * empty list when nothing is required, so a company that has not made that decision is never
 * blocked by it.
 */
export function requiredDocumentGaps(db: Database, ownerType: "vehicle" | "driver", ownerId: string, onDate: string): RequiredDocumentGap[] {
  const gaps: RequiredDocumentGap[] = [];
  for (const type of db.settings.documentTypes) {
    if (!type.required) continue;
    if (type.appliesTo !== "both" && type.appliesTo !== ownerType) continue;
    const recorded = db.documents.filter((doc) => doc.ownerType === ownerType && doc.ownerId === ownerId && doc.documentTypeId === type.id);
    if (recorded.length === 0) {
      gaps.push({ documentTypeId: type.id, name: type.name, expiryDate: null, reason: "missing" });
      continue;
    }
    // The latest expiry wins: a renewed certificate replaces the old one.
    const latest = recorded.map((doc) => doc.expiryDate).sort().at(-1) as string;
    if (latest < onDate) gaps.push({ documentTypeId: type.id, name: type.name, expiryDate: latest, reason: "expired" });
  }
  return gaps;
}

/** The gap list as one sentence the operator can act on, naming the paper and the date. */
export function describeDocumentGaps(label: string, gaps: readonly RequiredDocumentGap[]): string {
  const parts = gaps.map((gap) => (gap.reason === "missing" ? `no ${gap.name} is recorded` : `its ${gap.name} expired on ${gap.expiryDate}`));
  return `${label} cannot be assigned: ${parts.join("; ")}. Record the document in Compliance first.`;
}

function validateDocumentCore(db: Database, ownerType: "vehicle" | "driver", ownerId: string, documentTypeId: string): Errors {
  const errors: Errors = {};
  if (!DOCUMENT_OWNER_TYPES.includes(ownerType)) errors.ownerType = "Invalid owner type.";
  if (!ownerId) errors.ownerId = ownerType === "vehicle" ? "Select a vehicle." : "Select a driver.";
  else if (ownerType === "vehicle" && !db.vehicles.some((v) => v.id === ownerId)) errors.ownerId = "Vehicle not found.";
  else if (ownerType === "driver" && !db.drivers.some((d) => d.id === ownerId)) errors.ownerId = "Driver not found.";

  const docType = db.settings.documentTypes.find((d) => d.id === documentTypeId);
  if (!documentTypeId) errors.documentTypeId = "Select a document type.";
  else if (!docType) errors.documentTypeId = "Document type not found.";
  else if (docType.appliesTo !== "both" && docType.appliesTo !== ownerType)
    errors.documentTypeId = `${docType.name} applies to ${docType.appliesTo}s, not ${ownerType}s.`;
  return errors;
}

function validateDates(issuedDate: string, expiryDate: string): Errors {
  const errors: Errors = {};
  if (!isValidDate(expiryDate)) errors.expiryDate = "Enter a valid expiry date.";
  if (issuedDate && !isValidDate(issuedDate)) errors.issuedDate = "Enter a valid issued date, or leave it blank.";
  if (!errors.expiryDate && !errors.issuedDate && issuedDate && issuedDate > expiryDate)
    errors.issuedDate = "Issued date cannot be after the expiry date.";
  return errors;
}

export function executeCompliance(
  db: Database,
  actor: Actor | null,
  command: ComplianceCommand,
  now: string = new Date().toISOString(),
): CommandResult {
  switch (command.type) {
    case "create_document": {
      const denied = authorise(actor, "documents:create");
      if (denied) return denied;
      if (db.settings.documentTypes.length === 0)
        return fail("Blocked: no document types are configured. An administrator must add them in Settings first.");

      const { ownerType, ownerId, documentTypeId } = command.input;
      const errors: Errors = { ...validateDocumentCore(db, ownerType, ownerId, documentTypeId) };
      Object.assign(errors, validateDates(command.input.issuedDate, command.input.expiryDate));
      const documentNumber = command.input.documentNumber.trim();
      const notes = command.input.notes.trim();
      if (documentNumber.length > 80) errors.documentNumber = "Keep the document number to 80 characters.";
      if (notes.length > 1000) errors.notes = "Keep notes to 1000 characters.";
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);

      const created: ComplianceDocument = {
        id: makeId(),
        ownerType,
        ownerId,
        documentTypeId,
        documentNumber,
        issuedDate: command.input.issuedDate || null,
        expiryDate: command.input.expiryDate,
        notes,
        createdAt: now,
        updatedAt: now,
      };
      const docType = db.settings.documentTypes.find((d) => d.id === documentTypeId)!;
      const ownerLabel =
        ownerType === "vehicle" ? db.vehicles.find((v) => v.id === ownerId)?.registration : db.drivers.find((d) => d.id === ownerId)?.fullName;
      const next = audit({ ...db, documents: [...db.documents, created] }, actor, {
        action: "documents:create",
        entity: "document",
        entityId: created.id,
        summary: `${docType.name} recorded for ${ownerType} ${ownerLabel ?? ownerId}, expires ${created.expiryDate}.`,
      }, now);
      return { ok: true, db: next, message: `${docType.name} recorded.` };
    }

    case "update_document": {
      const denied = authorise(actor, "documents:update");
      if (denied) return denied;
      const existing = db.documents.find((d) => d.id === command.id);
      if (!existing) return fail("Document not found.");

      const errors: Errors = { ...validateDates(command.input.issuedDate, command.input.expiryDate) };
      const documentNumber = command.input.documentNumber.trim();
      const notes = command.input.notes.trim();
      if (documentNumber.length > 80) errors.documentNumber = "Keep the document number to 80 characters.";
      if (notes.length > 1000) errors.notes = "Keep notes to 1000 characters.";
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);

      // Owner and document type are locked after creation: a document record that
      // changed owner would no longer be evidence of the original filing (Integrity rule 1).
      const updated: ComplianceDocument = {
        ...existing,
        documentNumber,
        issuedDate: command.input.issuedDate || null,
        expiryDate: command.input.expiryDate,
        notes,
        updatedAt: now,
      };
      const docType = db.settings.documentTypes.find((d) => d.id === existing.documentTypeId);
      const next = audit({ ...db, documents: db.documents.map((d) => (d.id === updated.id ? updated : d)) }, actor, {
        action: "documents:update",
        entity: "document",
        entityId: updated.id,
        summary: `${docType?.name ?? "Document"} updated, now expires ${updated.expiryDate}.`,
      }, now);
      return { ok: true, db: next, message: "Document updated." };
    }

    case "acknowledge_document_reminder": {
      const denied = authorise(actor, "documents:update");
      if (denied) return denied;

      const document = db.documents.find((d) => d.id === command.input.documentId);
      if (!document) return fail("Document not found.");

      const today = now.slice(0, 10);
      const leadDays = db.settings.documentReminderLeadDays;
      const status = documentStatus(document.expiryDate, leadDays, today);
      // A paper nobody has to think about yet does not get taken on: an acknowledgement that can be
      // given at any time is one that means "I clicked", and it would silence the reminder that
      // matters when the date finally arrives.
      if (status === "unknown")
        return fail("The expiry date on this paper cannot be read, so there is nothing to take on. Correct the date first.");
      if (status === "valid") {
        return fail(
          leadDays === null
            ? `Nothing is due on this paper: no reminder lead time is set, and it has not expired (it expires ${document.expiryDate}).`
            : `${docTypeName(db, document)} for ${ownerLabel(db, document)} is not due yet: it expires ${document.expiryDate}, outside the ${leadDays}-day lead time.`,
          { documentId: "This paper is not due for renewal yet." },
        );
      }

      const note = command.input.note.trim();
      const expectedBy = command.input.expectedBy.trim();
      const errors: Errors = {};
      if (!note) errors.note = "Say what is being done about it — \"chasing the insurer\" is enough.";
      else if (note.length > REMINDER_LIMITS.note) errors.note = `Keep it to ${REMINDER_LIMITS.note} characters.`;
      if (expectedBy) {
        if (!isValidDate(expectedBy)) errors.expectedBy = "Enter the date you expect the new paper, or leave it blank.";
        else if (expectedBy < today) errors.expectedBy = "A date that has already passed is not when you expect the paper. Enter today or later.";
      }
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);

      const created: DocumentReminder = {
        id: makeId(),
        documentId: document.id,
        // The date they were looking at. Renewing the paper moves it, and the reminder comes back.
        expiryDate: document.expiryDate,
        note,
        expectedBy: expectedBy || null,
        acknowledgedBy: actor?.fullName ?? "System",
        acknowledgedAt: now,
      };
      const previous = reminderFor(db, document);
      const next = audit({ ...db, documentReminders: [...db.documentReminders, created] }, actor, {
        action: "documents:reminder",
        entity: "document",
        entityId: document.id,
        summary:
          `${docTypeName(db, document)} for ${ownerLabel(db, document)} (expires ${document.expiryDate}): ` +
          `${previous ? `replaces the acknowledgement by ${previous.acknowledgedBy}; ` : ""}taken on — ${note}` +
          `${created.expectedBy ? `, expected by ${created.expectedBy}` : ""}.`,
      }, now);
      return {
        ok: true,
        db: next,
        message: `Renewal taken on.${created.expectedBy ? ` The register shows it expected by ${created.expectedBy}.` : ""}`,
      };
    }
  }
}

const docTypeName = (db: Database, document: ComplianceDocument): string =>
  db.settings.documentTypes.find((type) => type.id === document.documentTypeId)?.name ?? "Document";

const ownerLabel = (db: Database, document: ComplianceDocument): string =>
  document.ownerType === "vehicle"
    ? db.vehicles.find((vehicle) => vehicle.id === document.ownerId)?.registration ?? "unknown vehicle"
    : db.drivers.find((driver) => driver.id === document.ownerId)?.fullName ?? "unknown driver";
