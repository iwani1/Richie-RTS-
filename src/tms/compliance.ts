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
import { DOCUMENT_OWNER_TYPES, type ComplianceDocument, type Database } from "./types";

export const COMPLIANCE_COMMAND_TYPES = ["create_document", "update_document"] as const;

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

export type ComplianceCommand =
  | { type: "create_document"; input: CreateDocumentInput }
  | { type: "update_document"; id: string; input: UpdateDocumentInput };

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
  }
}
