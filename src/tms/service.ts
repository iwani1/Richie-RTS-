// Command service: validation, authorisation, state transitions and audit.
// Pure and synchronous so it can be unit-tested and, later, moved behind an HTTP API
// unchanged. In this environment it runs in the browser (see docs/DECISIONS.md D-01).

import { validateClientLocation, type ClientLocationInput } from "./clients";
import { DRIVING_LIMITS, licenceClassProblem, parseTags, validateTags } from "./driving";
import { describeDocumentGaps, requiredDocumentGaps } from "./compliance";
import { overdueServiceFor } from "./maintenance";
import { can, type Permission } from "./permissions";
import { describeProblems, inspectBackup } from "./backupGuard";
import { MIN_PASSWORD_LENGTH } from "./crypto";
import { MAX_AMOUNT, formatAmount, isPercentWithTwoDecimals, linesTotal, parseAmount, parseQuantity, percentOf, toMinor } from "./money";
import { allocateReference } from "./references";
import { readVehicleDetail } from "./vehicles";
import { buildAcceptance, canAcceptQuotation } from "./acceptance";
import { QUOTATION_TERMS_LIMIT, quotationIsLive, validityEndsAt, validityProblem } from "./quotations";
import { confinedClientId } from "./scope";
import {
  CLIENT_STATUSES,
  CLIENT_TYPES,
  DOCUMENT_OWNER_TYPES,
  DRIVER_STATUSES,
  PRICING_BASES,
  REQUOTE_POLICIES,
  TAX_POSITIONS,
  migrate,
  type AuditEntry,
  type Client,
  type ClientLocation,
  type ClientStatus,
  type ClientType,
  type Database,
  type Driver,
  type DriverStatus,
  type FinalInvoice,
  type Quote,
  type QuoteLine,
  type ReferenceCounter,
  type Rental,
  type RentalSettings,
  type RentalStatus,
  type Role,
  ROLES,
  type Settings,
  type User,
  type Vehicle,
  type VehicleStatus,
} from "./types";

export interface Actor {
  id: string;
  fullName: string;
  role: Role;
}

export interface Credential {
  passwordHash: string;
  passwordSalt: string;
}

export interface VehicleInput {
  registration: string;
  categoryId: string;
  make: string;
  model: string;
  seatCapacity: string;
  /** What it runs on, in the office's words. Optional so old callers and the importer still work. */
  fuelType?: string;
  /** `""` means not recorded; stored as null (FLT-01, D-106). */
  ownership?: string;
  ownerName?: string;
  usualDriverId?: string;
  notes: string;
}

export interface DriverInput {
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiry: string;
  /** The classes printed on the licence, as typed: "C, D". Stored as a list (FLT-04). */
  licenceClasses?: string;
  /** Certificates the driver holds, as typed: "PSV, Defensive driving". */
  qualifications?: string;
  status: DriverStatus;
}

export type { ClientLocationInput };

export interface ClientInput {
  /** The code the office already uses for this customer. Optional: a walk-in has none. */
  reference?: string;
  name: string;
  /** Company or person. Null is allowed and shown as "not recorded" rather than guessed. */
  type?: ClientType | null;
  /** The company registration number, when the office has the certificate (CLI-01). */
  registrationNumber?: string;
  /** The date on that certificate, or blank when it was not written down (CLI-01). */
  registeredOn?: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** Where a bill is sent, printed on the invoice as typed. */
  billingAddress?: string;
  /** Tax identification number, printed on the invoice when the customer has one. */
  tin?: string;
  notes?: string;
  status: ClientStatus;
}

export interface UserInput {
  fullName: string;
  email: string;
  role: Role;
  active: boolean;
  // Which record this account acts for. Only meaningful for the driver, client_contact and
  // passenger roles; see PERMISSIONS.md "Own-record scope".
  driverId?: string | null;
  clientId?: string | null;
  // The rider this account is (PAX-01, D-97). A passenger sees its own journeys and nothing else,
  // so the link is required for that role and refused for every other one.
  passengerId?: string | null;
  // The one contact account we ring first for a client (Q-38). Ignored for other roles.
  primaryContact?: boolean;
}

export interface RentalRequestInput {
  clientId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  purpose: string;
  pickupLocation: string;
  dropoffLocation: string;
  startDate: string;
  endDate: string;
  passengers: string;
  vehicleCategoryId: string;
  driverRequired: boolean;
  notes: string;
}

/**
 * The public enquiry form (WEB-01).
 *
 * Deliberately narrower than `RentalRequestInput`: a member of the public may not name an internal
 * client, request a driver, or send anything that is not a plain string of a bounded length. Every
 * field is text from an HTML form, and the office turns the enquiry into a real request when it
 * calls back — which is why the record it creates is a draft and nothing more.
 */
export interface EnquiryInput {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  organization: string;
  purpose: string;
  pickupLocation: string;
  dropoffLocation: string;
  startDate: string;
  endDate: string;
  passengers: string;
  vehicleCategoryId: string;
  notes: string;
}

export interface QuoteLineInput {
  id?: string;
  description: string;
  quantity: string;
  unitAmount: string;
}

export interface QuoteInput {
  lines: QuoteLineInput[];
}

export interface DepositInput {
  amount: string;
  method: string;
  reference: string;
}

export interface AssignmentInput {
  vehicleId: string;
  driverId: string;
}

export type Command =
  | { type: "setup_administrator"; input: { fullName: string; email: string }; credential: Credential }
  | { type: "record_sign_in" }
  | { type: "create_user"; input: UserInput; credential: Credential }
  | { type: "update_user"; id: string; input: UserInput }
  | { type: "reset_user_password"; id: string; credential: Credential }
  // AUTH-05. Everyone may edit their own name and email, and change their own password; neither
  // needs users:update, because it is their own account rather than someone else's.
  | { type: "update_profile"; input: { fullName: string; email: string } }
  | { type: "change_own_password"; credential: Credential }
  | { type: "update_settings"; input: Settings }
  | { type: "create_vehicle"; input: VehicleInput }
  | { type: "update_vehicle"; id: string; input: VehicleInput }
  | { type: "transition_vehicle"; id: string; to: VehicleStatus; reason: string }
  | { type: "create_driver"; input: DriverInput }
  | { type: "update_driver"; id: string; input: DriverInput }
  | { type: "create_client"; input: ClientInput }
  | { type: "update_client"; id: string; input: ClientInput }
  | { type: "create_client_location"; input: ClientLocationInput }
  | { type: "update_client_location"; id: string; input: ClientLocationInput }
  | { type: "create_rental"; input: RentalRequestInput }
  | { type: "submit_enquiry"; input: EnquiryInput }
  | { type: "update_rental"; id: string; input: RentalRequestInput }
  | { type: "quote_rental"; id: string; input: QuoteInput }
  | { type: "requote_rental"; id: string; input: QuoteInput }
  | { type: "accept_quotation"; id: string; note: string }
  | { type: "confirm_rental"; id: string; input: DepositInput }
  | { type: "assign_rental"; id: string; input: AssignmentInput }
  | { type: "start_rental"; id: string }
  | { type: "complete_rental"; id: string; input: QuoteInput }
  | { type: "decline_rental"; id: string; reason: string }
  | { type: "cancel_rental"; id: string; reason: string }
  | { type: "import_backup"; database: Database }
  // Recording the export is what makes data leaving the system visible in the audit log.
  // The export itself stays client-side (it is a serialisation of the local database).
  | { type: "record_backup_export" };

// `kind` separates a clash with existing records (two dispatchers, one vehicle) from a field that
// needs correcting. The API maps a conflict to 409 and everything else to 400 (docs/API.md).
export type Failure = { ok: false; message: string; errors: Record<string, string>; kind?: "conflict" };
export type Success = { ok: true; db: Database; message: string };
export type CommandResult = Success | Failure;

export type Errors = Record<string, string>;

// Vehicle state machine (manual transitions). "in_service" will be system-driven by trips.
export const VEHICLE_TRANSITIONS: Record<VehicleStatus, readonly VehicleStatus[]> = {
  available: ["maintenance", "out_of_service", "retired"],
  maintenance: ["available", "out_of_service", "retired"],
  out_of_service: ["available", "maintenance", "retired"],
  retired: [],
};

// Rental lifecycle: request -> quotation -> deposit/confirm -> assign -> trip -> final billing.
export const RENTAL_TRANSITIONS: Record<RentalStatus, readonly RentalStatus[]> = {
  draft: ["quoted", "cancelled"],
  quoted: ["confirmed", "declined", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

const ACTIVE_RENTAL_STATUSES: readonly RentalStatus[] = ["confirmed", "in_progress"];

const datesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;

// A credential must look like something this app produced: 32 PBKDF2-SHA256 digest bytes
// and a 16-byte salt, both lower-case hex. Anything else is rejected before it becomes a
// user record, which closes two holes: an empty credential (which silently locks an account
// out) and a credential minted outside hashPassword() for a password the form would refuse.
const CREDENTIAL_HASH_RE = /^[0-9a-f]{64}$/;
const CREDENTIAL_SALT_RE = /^[0-9a-f]{32}$/;
// Argon2id PHC string, as produced by the server's password hasher (D-51). Argon2 carries its own
// salt inside the string, so passwordSalt is legitimately empty for these credentials.
const ARGON2_RE = /^\$argon2(id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export function validateCredential(credential: Credential | null | undefined): Errors {
  const errors: Errors = {};
  const hash = credential?.passwordHash;
  const salt = credential?.passwordSalt;
  if (typeof hash !== "string" || hash.length === 0) {
    errors.password = "The password must be set through the app so it is hashed before it reaches the service layer.";
  } else if (ARGON2_RE.test(hash)) {
    // Well-formed Argon2id credential; the salt is embedded.
  } else if (!CREDENTIAL_HASH_RE.test(hash)) {
    errors.password = "The password must be set through the app so it is hashed before it reaches the service layer.";
  } else if (typeof salt !== "string" || !CREDENTIAL_SALT_RE.test(salt)) {
    errors.password = "The password salt is missing or malformed.";
  }
  return errors;
}

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const fail = (message: string, errors: Errors = {}, kind?: Failure["kind"]): Failure =>
  kind ? { ok: false, message, errors, kind } : { ok: false, message, errors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const norm = (value: string) => value.trim().toLowerCase();
const normReg = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function authorise(actor: Actor | null, permission: Permission): Failure | null {
  if (!actor) return fail("Sign in is required.");
  if (!can(actor.role, permission)) return fail(`Not permitted: your role lacks ${permission}.`);
  return null;
}

// The audit log is held in browser storage and rewritten in full on every command, so it must
// have a ceiling. At this size the persisted snapshot stays well inside a 5 MB origin quota;
// older entries leave through the audited backup export, not by being silently dropped.
export const AUDIT_LIMIT = 5_000;

export function audit(
  db: Database,
  actor: Actor | null,
  entry: Pick<AuditEntry, "action" | "entity" | "entityId" | "summary">,
  now: string,
): Database {
  const record: AuditEntry = {
    id: makeId(),
    at: now,
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? "System",
    ...entry,
  };
  return { ...db, audit: [record, ...db.audit].slice(0, AUDIT_LIMIT) };
}

// ---------- validators ----------

export function validateVehicle(db: Database, input: VehicleInput, excludeId?: string) {
  const errors: Errors = {};
  const registration = input.registration.trim().toUpperCase();
  if (!registration) errors.registration = "Registration is required.";
  else if (db.vehicles.some((v) => v.id !== excludeId && normReg(v.registration) === normReg(registration)))
    errors.registration = "A vehicle with this registration already exists.";
  if (!input.categoryId) errors.categoryId = "Select a vehicle category.";
  else if (!db.settings.vehicleCategories.some((c) => c.id === input.categoryId))
    errors.categoryId = "Unknown vehicle category.";
  const seats = Number(input.seatCapacity);
  if (input.seatCapacity.trim() === "" || !Number.isInteger(seats) || seats < 1)
    errors.seatCapacity = "Seat capacity must be a whole number of at least 1.";
  // What the vehicle itself is (FLT-01, D-106): what it runs on, whether it is ours, whose it is and
  // which driver habitually takes it out. Kept in its own module so the form, the register and the
  // importer cannot disagree about the same record.
  const detail = readVehicleDetail(db, input);
  Object.assign(errors, detail.errors);
  return {
    errors,
    value: {
      registration,
      categoryId: input.categoryId,
      make: input.make.trim(),
      model: input.model.trim(),
      seatCapacity: seats,
      ...detail.value,
      notes: input.notes.trim(),
    },
  };
}

export function validateDriver(db: Database, input: DriverInput, excludeId?: string) {
  const errors: Errors = {};
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const licenceNumber = input.licenceNumber.trim().toUpperCase();
  if (!fullName) errors.fullName = "Full name is required.";
  if (!phone) errors.phone = "Phone number is required.";
  if (!licenceNumber) errors.licenceNumber = "Licence number is required.";
  else if (db.drivers.some((d) => d.id !== excludeId && d.licenceNumber.toUpperCase() === licenceNumber))
    errors.licenceNumber = "A driver with this licence number already exists.";
  if (!isValidDate(input.licenceExpiry)) errors.licenceExpiry = "Enter the licence expiry date (YYYY-MM-DD).";
  // What the licence allows (FLT-04). Classes are upper-cased because that is how they are printed,
  // so "c" and "C" are one class rather than two.
  const licenceClasses = parseTags(input.licenceClasses ?? "", { upper: true });
  const qualifications = parseTags(input.qualifications ?? "");
  Object.assign(
    errors,
    validateTags("licenceClasses", licenceClasses, {
      max: DRIVING_LIMITS.classesPerDriver,
      length: DRIVING_LIMITS.classLength,
      label: "licence class",
    }),
  );
  Object.assign(
    errors,
    validateTags("qualifications", qualifications, {
      max: DRIVING_LIMITS.qualificationsPerDriver,
      length: DRIVING_LIMITS.qualificationLength,
      label: "qualification",
    }),
  );
  if (!DRIVER_STATUSES.includes(input.status)) errors.status = "Invalid status.";
  return {
    errors,
    value: { fullName, phone, licenceNumber, licenceExpiry: input.licenceExpiry, licenceClasses, qualifications, status: input.status },
  };
}

export function validateClient(db: Database, input: ClientInput, excludeId?: string, today?: string) {
  const errors: Errors = {};
  const name = input.name.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  const reference = (input.reference ?? "").trim();
  const billingAddress = (input.billingAddress ?? "").trim();
  const tin = (input.tin ?? "").trim();
  const notes = (input.notes ?? "").trim();
  const registrationNumber = (input.registrationNumber ?? "").trim();
  const registeredOn = (input.registeredOn ?? "").trim();

  if (!name) errors.name = "Client name is required.";
  else if (db.clients.some((c) => c.id !== excludeId && norm(c.name) === norm(name)))
    errors.name = "A client with this name already exists.";

  // A customer code is the office's own, so it is not generated here — but two customers cannot
  // share one, or the code stops identifying anybody.
  if (reference.length > 40) errors.reference = "Keep the customer code to 40 characters.";
  else if (reference && db.clients.some((c) => c.id !== excludeId && c.reference && norm(c.reference) === norm(reference)))
    errors.reference = "Another client already uses this code.";

  const type = input.type ?? null;
  if (type !== null && !CLIENT_TYPES.includes(type)) errors.type = "Choose organisation or individual.";

  if (contactEmail && !EMAIL_RE.test(contactEmail)) errors.contactEmail = "Enter a valid email address.";
  if (billingAddress.length > 300) errors.billingAddress = "Keep the billing address to 300 characters.";
  // A TIN is whatever the customer's own document says; only its shape is checked, never its meaning.
  if (tin && !/^[A-Za-z0-9][A-Za-z0-9 /-]{3,29}$/.test(tin)) errors.tin = "A tax number is 4–30 letters, digits, spaces or hyphens.";
  if (notes.length > 500) errors.notes = "Keep the note to 500 characters.";
  // The certificate number is typed from the paper and is not reformatted: offices write it with
  // their own punctuation, and only the length is this program's business.
  if (registrationNumber.length > 40) errors.registrationNumber = "Keep the registration number to 40 characters.";
  if (registeredOn) {
    if (!isValidDate(registeredOn)) errors.registeredOn = "Enter the registration date as a real day.";
    // A certificate cannot be issued tomorrow. Without a reference day the check is skipped rather
    // than guessed, which is what the older call sites (tests of validation alone) rely on.
    else if (today && registeredOn > today) errors.registeredOn = "A company cannot be registered in the future.";
  }
  if (!CLIENT_STATUSES.includes(input.status)) errors.status = "Invalid status.";

  return {
    errors,
    value: {
      reference,
      name,
      type,
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      contactEmail,
      billingAddress,
      tin: tin.toUpperCase(),
      notes,
      registrationNumber,
      registeredOn,
      status: input.status,
    },
  };
}

export function validateUser(db: Database, input: UserInput, excludeId?: string) {
  const errors: Errors = {};
  const fullName = input.fullName.trim();
  const email = norm(input.email);
  if (!fullName) errors.fullName = "Full name is required.";
  if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
  else if (db.users.some((u) => u.id !== excludeId && u.email === email)) errors.email = "A user with this email already exists.";
  if (!ROLES.includes(input.role)) errors.role = "Invalid role.";

  const driverId = input.driverId || null;
  const clientId = input.clientId || null;
  const passengerId = input.passengerId || null;

  if (input.role === "driver") {
    if (clientId) errors.clientId = "A driver account is not linked to a client.";
    if (passengerId) errors.passengerId = "A driver account is not linked to a rider.";
    if (!driverId) errors.driverId = "Link this account to a driver record so it can see its own trips.";
    else if (!db.drivers.some((d) => d.id === driverId)) errors.driverId = "Driver record not found.";
    else if (db.users.some((u) => u.id !== excludeId && u.driverId === driverId))
      errors.driverId = "That driver record is already linked to another account.";
  } else if (input.role === "client_contact") {
    if (driverId) errors.driverId = "A client contact account is not linked to a driver.";
    if (passengerId) errors.passengerId = "A client contact account is not linked to a rider.";
    if (!clientId) errors.clientId = "Link this account to a client so it can see its own records.";
    else if (!db.clients.some((c) => c.id === clientId)) errors.clientId = "Client not found.";
    // A company usually has an operations contact and an accounts contact. Both get their own
    // login, each sees only that client, and one is marked primary (Q-38, D-77).
  } else if (input.role === "passenger") {
    // PAX-01 (D-97). A passenger is one person, not a company: the link is what confines the
    // account to its own journeys, so it is required rather than optional.
    if (driverId) errors.driverId = "A passenger account is not linked to a driver.";
    if (clientId) errors.clientId = "A passenger account is not linked to a client; link the rider record instead.";
    if (!passengerId) errors.passengerId = "Link this account to a rider so it can see its own journeys.";
    else if (!db.passengers.some((p) => p.id === passengerId)) errors.passengerId = "Rider record not found.";
    else if (db.users.some((u) => u.id !== excludeId && u.passengerId === passengerId))
      errors.passengerId = "That rider is already linked to another account.";
  } else if (driverId || clientId || passengerId) {
    errors.driverId = "Only driver, client contact and passenger accounts can be linked to a record.";
  }

  const primaryContact = input.primaryContact === true;
  if (primaryContact && input.role !== "client_contact")
    errors.primaryContact = "Only a client contact account can be the primary contact.";

  return {
    errors,
    value: {
      fullName,
      email,
      role: input.role,
      active: input.active,
      driverId,
      clientId,
      passengerId,
      primaryContact: primaryContact && input.role === "client_contact",
    },
  };
}

/**
 * Puts a saved account back into the list and keeps "one primary contact per client" true: marking
 * an account primary takes the mark off whichever account of that client held it (Q-38).
 */
function withAccount(users: User[], account: User): User[] {
  return users.map((u) => {
    if (u.id === account.id) return account;
    if (account.primaryContact && u.primaryContact && u.clientId === account.clientId) return { ...u, primaryContact: false };
    return u;
  });
}

/** The audit clause for a saved account that carries the primary mark, and who lost it. */
function primaryNote(db: Database, account: User, wasPrimary: boolean): string {
  if (!account.primaryContact) return "";
  const client = db.clients.find((c) => c.id === account.clientId);
  const demoted = wasPrimary
    ? []
    : db.users.filter((u) => u.id !== account.id && u.primaryContact && u.clientId === account.clientId).map((u) => u.fullName);
  return `, primary contact${client ? ` for ${client.name}` : ""}${demoted.length ? ` (mark taken from ${demoted.join(", ")})` : ""}`;
}

/**
 * A short list of names the company keeps itself (work types, cost categories). Trimmed, deduped
 * case-insensitively, and empty is allowed: an empty list means "not named yet", which the screens
 * say plainly instead of inventing values (Q-34, Q-29).
 */
function validateNameList(names: string[], prefix: string, errors: Errors, maxLength: number): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  names.forEach((raw, index) => {
    const name = raw.trim();
    if (!name) {
      errors[`${prefix}.${index}`] = "Enter a name, or remove the row.";
      return;
    }
    if (name.length > maxLength) errors[`${prefix}.${index}`] = `Keep the name to ${maxLength} characters.`;
    else if (seen.has(norm(name))) errors[`${prefix}.${index}`] = "Duplicate name.";
    seen.add(norm(name));
    cleaned.push(name);
  });
  return cleaned;
}

export function validateSettings(db: Database, input: Settings) {
  const errors: Errors = {};
  const companyName = input.companyName?.trim() || null;
  const currencyCode = input.currencyCode?.trim().toUpperCase() || null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) errors.currencyCode = "Use a three-letter ISO 4217 code (e.g. GHS).";
  const threshold = input.onTimeThresholdMinutes;
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0))
    errors.onTimeThresholdMinutes = "Enter a whole number of minutes (0 or more).";

  const categories = input.vehicleCategories.map((c) => ({
    id: c.id || makeId(),
    name: c.name.trim(),
    // The classes that may drive this category (FLT-04). Left empty, the category checks nothing.
    licenceClasses: parseTags(typeof c.licenceClasses === "string" ? c.licenceClasses : (c.licenceClasses ?? []).join(", "), { upper: true }),
  }));
  const seenCat = new Set<string>();
  categories.forEach((c, i) => {
    if (!c.name) errors[`vehicleCategories.${i}`] = "Category name is required.";
    else if (seenCat.has(norm(c.name))) errors[`vehicleCategories.${i}`] = "Duplicate category name.";
    seenCat.add(norm(c.name));
    Object.assign(
      errors,
      Object.fromEntries(
        Object.entries(
          validateTags(`vehicleCategories.${i}.licenceClasses`, c.licenceClasses, {
            max: DRIVING_LIMITS.classesPerDriver,
            length: DRIVING_LIMITS.classLength,
            label: "licence class",
          }),
        ),
      ),
    );
  });
  const removedInUse = db.settings.vehicleCategories.filter(
    (old) => !categories.some((c) => c.id === old.id) && db.vehicles.some((v) => v.categoryId === old.id),
  );
  if (removedInUse.length)
    errors.vehicleCategories = `Cannot remove categories in use by vehicles: ${removedInUse.map((c) => c.name).join(", ")}.`;

  const shifts = input.shifts.map((s) => ({ id: s.id || makeId(), name: s.name.trim(), startTime: s.startTime.trim(), endTime: s.endTime.trim() }));
  const seenShift = new Set<string>();
  shifts.forEach((s, i) => {
    if (!s.name) errors[`shifts.${i}`] = "Shift name is required.";
    else if (seenShift.has(norm(s.name))) errors[`shifts.${i}`] = "Duplicate shift name.";
    else if (!TIME_RE.test(s.startTime) || !TIME_RE.test(s.endTime)) errors[`shifts.${i}`] = "Start and end must be HH:MM (24-hour).";
    seenShift.add(norm(s.name));
  });

  const rentalIn = input.rental;
  const rental: RentalSettings = {
    pricingBasis: rentalIn.pricingBasis,
    depositPercent: rentalIn.depositPercent,
    quotationValidityHours: rentalIn.quotationValidityHours,
    driversAlwaysIncluded: rentalIn.driversAlwaysIncluded,
    paymentMethods: rentalIn.paymentMethods.map((m) => m.trim()).filter(Boolean),
    requotePolicy: rentalIn.requotePolicy,
    // RNT-04 (D-117): the terms are the company's words, trimmed and kept as typed. No default is
    // supplied anywhere, and quoting stays blocked until somebody writes them.
    quotationTerms: (rentalIn.quotationTerms ?? "").trim(),
  };
  if (rental.pricingBasis !== null && !PRICING_BASES.includes(rental.pricingBasis)) errors["rental.pricingBasis"] = "Invalid pricing basis.";
  // A percentage is computed in integer basis points (money.ts), so it may not carry more precision
  // than the arithmetic can represent: 33.333% would silently become 33.33% and the deposit would be
  // a different number from the one on the screen.
  if (rental.depositPercent !== null && (!Number.isFinite(rental.depositPercent) || rental.depositPercent < 0 || rental.depositPercent > 100))
    errors["rental.depositPercent"] = "Deposit must be between 0 and 100 percent.";
  else if (rental.depositPercent !== null && !isPercentWithTwoDecimals(rental.depositPercent))
    errors["rental.depositPercent"] = "Give the deposit to at most two decimal places.";
  const validityError = validityProblem(rental.quotationValidityHours);
  // Not set is a setting to fill in later, not a mistake to correct: only a number out of range is
  // refused here, and quoting says "not set" when it is missing.
  if (rental.quotationValidityHours !== null && validityError) errors["rental.quotationValidityHours"] = validityError;
  if (rental.quotationTerms.length > QUOTATION_TERMS_LIMIT)
    errors["rental.quotationTerms"] = `Keep the terms under ${QUOTATION_TERMS_LIMIT} characters.`;
  const seenMethod = new Set<string>();
  for (const m of rental.paymentMethods) {
    if (seenMethod.has(norm(m))) errors["rental.paymentMethods"] = "Duplicate payment method.";
    seenMethod.add(norm(m));
  }
  if (rental.requotePolicy !== null && !REQUOTE_POLICIES.includes(rental.requotePolicy))
    errors["rental.requotePolicy"] = "Invalid expired-quotation policy.";

  const documentTypes = input.documentTypes.map((d) => ({
    id: d.id || makeId(),
    name: d.name.trim(),
    appliesTo: d.appliesTo,
    required: d.required === true,
  }));
  const seenDocType = new Set<string>();
  documentTypes.forEach((d, i) => {
    if (!d.name) errors[`documentTypes.${i}`] = "Document type name is required.";
    else if (seenDocType.has(norm(d.name))) errors[`documentTypes.${i}`] = "Duplicate document type name.";
    else if (!DOCUMENT_OWNER_TYPES.includes(d.appliesTo)) errors[`documentTypes.${i}`] = "Invalid applies-to value.";
    seenDocType.add(norm(d.name));
  });
  const removedDocTypesInUse = db.settings.documentTypes.filter(
    (old) => !documentTypes.some((d) => d.id === old.id) && db.documents.some((doc) => doc.documentTypeId === old.id),
  );
  if (removedDocTypesInUse.length)
    errors.documentTypes = `Cannot remove document types with recorded documents: ${removedDocTypesInUse.map((d) => d.name).join(", ")}.`;

  const documentReminderLeadDays = input.documentReminderLeadDays;
  if (documentReminderLeadDays !== null && (!Number.isInteger(documentReminderLeadDays) || documentReminderLeadDays < 0))
    errors.documentReminderLeadDays = "Enter a whole number of days (0 or more).";

  // Invoicing settings (FIN-02). The tax position has no default: until somebody states it, an
  // invoice cannot be issued at all, because guessing would put a tax line on a legal document.
  const taxPosition = input.taxPosition ?? null;
  if (taxPosition !== null && !(TAX_POSITIONS as readonly string[]).includes(taxPosition)) errors.taxPosition = "Invalid tax position.";
  const taxLines = (input.taxLines ?? []).map((line) => ({ id: line.id || makeId(), name: line.name.trim(), ratePercent: Number(line.ratePercent) }));
  const seenTax = new Set<string>();
  taxLines.forEach((line, i) => {
    if (!line.name) errors[`taxLines.${i}`] = "Tax line name is required.";
    else if (seenTax.has(norm(line.name))) errors[`taxLines.${i}`] = "Duplicate tax line name.";
    else if (!Number.isFinite(line.ratePercent) || line.ratePercent < 0 || line.ratePercent > 100) errors[`taxLines.${i}`] = "Rate must be between 0 and 100 percent.";
    else if (!isPercentWithTwoDecimals(line.ratePercent)) errors[`taxLines.${i}`] = "Give the rate to at most two decimal places.";
    seenTax.add(norm(line.name));
  });
  if (taxPosition === "registered" && taxLines.length === 0 && !errors.taxPosition) errors.taxLines = "A VAT-registered company needs at least one tax line.";
  const invoiceDueDays = input.invoiceDueDays ?? null;
  if (invoiceDueDays !== null && (!Number.isInteger(invoiceDueDays) || invoiceDueDays < 0))
    errors.invoiceDueDays = "Enter a whole number of days (0 or more).";

  // FLT-05 (D-112). A money figure in the billing currency, per vehicle per day, to at most two
  // decimals. Blank stays blank: the dashboard then counts idle days and puts no money on them.
  const fleetStandingCostPerDay = input.fleetStandingCostPerDay ?? null;
  if (
    fleetStandingCostPerDay !== null &&
    (!Number.isFinite(fleetStandingCostPerDay) ||
      fleetStandingCostPerDay < 0 ||
      fleetStandingCostPerDay > MAX_AMOUNT ||
      Math.abs(fleetStandingCostPerDay * 100 - Math.round(fleetStandingCostPerDay * 100)) > 1e-9)
  )
    errors.fleetStandingCostPerDay = "Enter an amount of 0 or more, with at most two decimal places.";

  const workTypes = validateNameList(input.workTypes ?? [], "workTypes", errors, 40);
  const costCategories = validateNameList(input.costCategories ?? [], "costCategories", errors, 40);

  // BKG-02/BKG-05 (D-83). Both cut-offs are optional and both are minutes before departure. A
  // negative or absurd value is refused here rather than silently ignored at booking time.
  const booking = {
    requestCutoffMinutes: input.booking?.requestCutoffMinutes ?? null,
    cancellationCutoffMinutes: input.booking?.cancellationCutoffMinutes ?? null,
  };
  for (const [key, value] of [
    ["requestCutoffMinutes", booking.requestCutoffMinutes],
    ["cancellationCutoffMinutes", booking.cancellationCutoffMinutes],
  ] as const) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value > 7 * 24 * 60)
      errors[`booking.${key}`] = "Enter a whole number of minutes (0 or more, up to a week).";
  }

  const maintenance = {
    // Q-43 (D-80): only a stored `true` turns the warning into a block. Anything else — a missing
    // field from an older backup, a stray string — leaves the vehicle able to work.
    blockOnOverdueService: input.maintenance.blockOnOverdueService === true,
    schedules: input.maintenance.schedules.map((schedule) => ({
      categoryId: schedule.categoryId,
      intervalKm: schedule.intervalKm,
      intervalDays: schedule.intervalDays,
      remindLeadKm: schedule.remindLeadKm,
      remindLeadDays: schedule.remindLeadDays,
    })),
  };
  const seenScheduleCategory = new Set<string>();
  maintenance.schedules.forEach((schedule, index) => {
    const prefix = `maintenance.schedules.${index}`;
    if (!categories.some((category) => category.id === schedule.categoryId)) errors[prefix] = "Vehicle category not found.";
    if (seenScheduleCategory.has(schedule.categoryId)) errors[prefix] = "A vehicle category can have only one schedule.";
    seenScheduleCategory.add(schedule.categoryId);
    if (schedule.intervalKm === null && schedule.intervalDays === null) errors[prefix] = "Set a km interval, a day interval, or both.";
    for (const [key, value] of [
      ["intervalKm", schedule.intervalKm],
      ["intervalDays", schedule.intervalDays],
      ["remindLeadKm", schedule.remindLeadKm],
      ["remindLeadDays", schedule.remindLeadDays],
    ] as const) {
      if (value === null) continue;
      if (!Number.isInteger(value) || value < 0) errors[prefix] = `${key} must be a whole number of 0 or more.`;
    }
  });

  return {
    errors,
    value: {
      companyName,
      currencyCode,
      onTimeThresholdMinutes: threshold,
      vehicleCategories: categories,
      shifts,
      rental,
      documentTypes,
      documentReminderLeadDays,
      taxPosition,
      taxLines,
      invoiceDueDays,
      fleetStandingCostPerDay,
      workTypes,
      costCategories,
      maintenance,
      booking,
    },
  };
}

/**
 * Q-43 (D-80). While the strict rule is off, an overdue routine service is said in the message the
 * office reads after assigning or starting a hire — the only place left, since nothing was refused.
 */
function rentalServiceNotice(db: Database, vehicleId: string | null, now: string): string {
  if (!vehicleId) return "";
  const overdue = overdueServiceFor(db, vehicleId, now.slice(0, 10));
  return overdue ? ` Note: ${overdue} Settings allows this because an overdue service only warns.` : "";
}

// Returns true once management has supplied the rules quoting depends on (see OPEN_QUESTIONS Q-03,07,08,09,15).
export function rentalQuotingReady(settings: Settings): string[] {
  const missing: string[] = [];
  if (!settings.currencyCode) missing.push("billing currency");
  if (!settings.rental.pricingBasis) missing.push("rental pricing basis");
  if (settings.rental.depositPercent === null) missing.push("deposit percentage");
  if (settings.rental.quotationValidityHours === null) missing.push("quotation validity");
  // D-117: a quotation carries terms, and this build writes none of its own. Until the company has
  // written them, there is no sheet to send.
  if (settings.rental.quotationTerms.trim() === "") missing.push("quotation terms");
  if (settings.rental.paymentMethods.length === 0) missing.push("at least one payment method");
  return missing;
}

export function validateRentalRequest(db: Database, input: RentalRequestInput, excludeId?: string) {
  const errors: Errors = {};
  const clientId = input.clientId || null;
  if (clientId && !db.clients.some((c) => c.id === clientId)) errors.clientId = "Unknown client.";
  const customerName = input.customerName.trim();
  if (!customerName) errors.customerName = "Customer or organisation name is required.";
  const customerEmail = input.customerEmail.trim().toLowerCase();
  if (customerEmail && !EMAIL_RE.test(customerEmail)) errors.customerEmail = "Enter a valid email address.";
  if (!input.vehicleCategoryId) errors.vehicleCategoryId = "Select a vehicle category.";
  else if (!db.settings.vehicleCategories.some((c) => c.id === input.vehicleCategoryId)) errors.vehicleCategoryId = "Unknown vehicle category.";
  if (!isValidDate(input.startDate)) errors.startDate = "Enter the start date.";
  if (!isValidDate(input.endDate)) errors.endDate = "Enter the end date.";
  if (!errors.startDate && !errors.endDate && input.endDate < input.startDate) errors.endDate = "End date cannot be before the start date.";
  const passengers = Number(input.passengers);
  if (input.passengers.trim() === "" || !Number.isInteger(passengers) || passengers < 1) errors.passengers = "Passengers must be a whole number of at least 1.";
  void excludeId;
  return {
    errors,
    value: {
      clientId,
      customerName,
      customerPhone: input.customerPhone.trim(),
      customerEmail,
      purpose: input.purpose.trim(),
      pickupLocation: input.pickupLocation.trim(),
      dropoffLocation: input.dropoffLocation.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      passengers,
      vehicleCategoryId: input.vehicleCategoryId,
      driverRequired: input.driverRequired,
      notes: input.notes.trim(),
    },
  };
}

/**
 * Validation for the public form.
 *
 * Stricter than the desk form in the two places that matter for an unauthenticated caller: every
 * string has a ceiling, and the start date may not be in the past. It reuses `validateRentalRequest`
 * for the rules that are genuinely the same, so a public enquiry cannot slip a value past a check
 * the office would have caught.
 */
export function validateEnquiry(db: Database, input: EnquiryInput, today: string) {
  const errors: Errors = {};
  const customerName = input.customerName.trim();
  if (customerName.length < 2) errors.customerName = "Enter the name the vehicle is for.";
  else if (customerName.length > 120) errors.customerName = "Keep the name to 120 characters.";

  const customerPhone = input.customerPhone.trim();
  const digits = customerPhone.replace(/[^0-9]/g, "");
  if (!customerPhone) errors.customerPhone = "A phone number is needed so the office can call you back.";
  else if (digits.length < 7 || digits.length > 20) errors.customerPhone = "Enter a phone number the office can reach you on.";
  else if (customerPhone.length > 40) errors.customerPhone = "Keep the phone number to 40 characters.";

  const customerEmail = input.customerEmail.trim().toLowerCase();
  if (customerEmail && !EMAIL_RE.test(customerEmail)) errors.customerEmail = "Enter a valid email address, or leave it blank.";
  else if (customerEmail.length > 200) errors.customerEmail = "Keep the email address to 200 characters.";

  const organization = input.organization.trim();
  if (organization.length > 160) errors.organization = "Keep the organisation to 160 characters.";
  if (input.purpose.trim().length > 300) errors.purpose = "Keep the purpose to 300 characters.";
  if (input.pickupLocation.trim().length > 160) errors.pickupLocation = "Keep the pickup point to 160 characters.";
  if (input.dropoffLocation.trim().length > 160) errors.dropoffLocation = "Keep the destination to 160 characters.";
  if (input.notes.trim().length > 1000) errors.notes = "Keep the note to 1000 characters.";

  if (!isValidDate(input.startDate)) errors.startDate = "Enter the first day you need the vehicle.";
  else if (input.startDate < today) errors.startDate = "Choose a date from today onwards.";
  if (!isValidDate(input.endDate)) errors.endDate = "Enter the last day you need the vehicle.";
  else if (!errors.startDate && input.endDate < input.startDate) errors.endDate = "The last day cannot be before the first.";

  const passengers = Number(input.passengers);
  if (input.passengers.trim() === "" || !Number.isInteger(passengers) || passengers < 1) {
    errors.passengers = "Passengers must be a whole number of at least 1.";
  } else if (passengers > 100) {
    errors.passengers = "Enter 100 or fewer passengers per vehicle.";
  }

  const categoryId = input.vehicleCategoryId;
  if (!categoryId) errors.vehicleCategoryId = "Choose the kind of vehicle you need.";
  else if (!db.settings.vehicleCategories.some((category) => category.id === categoryId)) {
    errors.vehicleCategoryId = "That vehicle type is not offered. Pick one from the list, or call the office.";
  }

  // The office needs to see, at a glance, that this did not arrive at the desk.
  const notes = [
    "Received from the public enquiry form.",
    organization ? `Organisation: ${organization}` : "",
    input.notes.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    errors,
    value: {
      clientId: null,
      customerName,
      customerPhone,
      customerEmail,
      purpose: input.purpose.trim(),
      pickupLocation: input.pickupLocation.trim(),
      dropoffLocation: input.dropoffLocation.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      passengers,
      vehicleCategoryId: categoryId,
      driverRequired: false,
      notes,
    },
  };
}

export function validateQuoteLines(input: QuoteInput) {
  const errors: Errors = {};
  const lines: QuoteLine[] = [];
  if (input.lines.length === 0) errors.lines = "Add at least one line item.";
  input.lines.forEach((line, i) => {
    const description = line.description.trim();
    // Amounts and quantities are read as decimal text and never coerced: `100.005` is a mistake to
    // show the operator, not a number to round behind their back (audit D-04).
    const quantity = parseQuantity(line.quantity ?? "");
    const amount = parseAmount(line.unitAmount ?? "");
    if (!description) errors[`lines.${i}.description`] = "Description is required.";
    if (quantity.problem === "too-many-decimals") errors[`lines.${i}.quantity`] = "Use at most three decimal places.";
    else if (quantity.problem) errors[`lines.${i}.quantity`] = "Quantity must be greater than 0.";
    if (amount.problem === "too-many-decimals") errors[`lines.${i}.unitAmount`] = "Use at most two decimal places: amounts are in pesewas.";
    else if (amount.problem === "too-large") errors[`lines.${i}.unitAmount`] = "That amount looks wrong. Check the figure.";
    else if (amount.problem) errors[`lines.${i}.unitAmount`] = "Amount must be 0 or more.";
    lines.push({ id: line.id || makeId(), description, quantity: quantity.quantity, unitAmount: amount.amount });
  });
  // Summed in whole pesewas, then rounded once per line — the same arithmetic the invoice repeats,
  // so a quotation and the invoice raised from it cannot disagree by a cent.
  const subtotal = Object.keys(errors).length ? 0 : linesTotal(lines);
  return { errors, lines, subtotal };
}

/**
 * The quotation to write (RNT-04, D-117).
 *
 * It draws its own number from the `quotation` series, records which revision it is, copies the
 * company's terms as they stand today, and holds the price for the configured number of hours from the
 * minute it was issued. A renewal passes the previous quotation so the number is kept and the revision
 * goes up: one document, two versions, and the customer can say which one they are holding.
 */
function buildQuote(
  db: Database,
  actor: Actor,
  input: QuoteInput,
  now: string,
  rental: Rental,
  previous: Quote | null,
): { ok: true; quote: Quote; counters: ReferenceCounter[] } | Failure {
  const missing = rentalQuotingReady(db.settings);
  if (missing.length)
    return fail(`Blocked: quotation settings are incomplete. An administrator must set: ${missing.join(", ")}.`);
  const { errors, lines, subtotal } = validateQuoteLines(input);
  if (Object.keys(errors).length) return fail("Please correct the quotation line items.", errors);
  const depositPercent = db.settings.rental.depositPercent!;
  const validityHours = db.settings.rental.quotationValidityHours!;
  // A renewal keeps the number it was issued under; a first issue draws the next one in the series.
  const allocated = previous ? null : allocateReference(db, "quotation", now.slice(0, 4));
  const quote: Quote = {
    currencyCode: db.settings.currencyCode!,
    pricingBasis: db.settings.rental.pricingBasis!,
    lines,
    subtotal,
    depositPercent,
    depositRequired: percentOf(subtotal, depositPercent),
    validUntil: validityEndsAt(now, validityHours),
    quotedAt: now,
    quotedBy: actor.fullName,
    number: previous ? previous.number : allocated!.reference,
    revision: previous ? previous.revision + 1 : 1,
    terms: db.settings.rental.quotationTerms.trim(),
    // The policy answers it when it has been set; otherwise the request's own answer stands.
    driverIncluded: db.settings.rental.driversAlwaysIncluded ?? rental.driverRequired,
  };
  return { ok: true, quote, counters: allocated ? allocated.counters : db.referenceCounters };
}

export function isDatabaseShape(value: unknown): value is Database {
  return migrate(value) !== null;
}

// ---------- command execution ----------

export function execute(db: Database, actor: Actor | null, command: Command, now: string = new Date().toISOString()): CommandResult {
  switch (command.type) {
    case "setup_administrator": {
      if (db.users.length > 0) return fail("Setup has already been completed.");
      const { errors, value } = validateUser(db, { ...command.input, role: "administrator", active: true });
      const credentialErrors = validateCredential(command.credential);
      if (Object.keys(errors).length || Object.keys(credentialErrors).length)
        return fail("Please correct the highlighted fields.", { ...errors, ...credentialErrors });
      const user: User = { id: makeId(), ...value, ...command.credential, createdAt: now, updatedAt: now };
      const next = audit({ ...db, users: [user] }, { id: user.id, fullName: user.fullName, role: user.role }, {
        action: "users:setup",
        entity: "user",
        entityId: user.id,
        summary: `Initial administrator account created for ${user.email}.`,
      }, now);
      return { ok: true, db: next, message: "Administrator account created." };
    }

    case "record_sign_in": {
      if (!actor) return fail("Sign in is required.");
      return { ok: true, db: audit(db, actor, { action: "auth:sign_in", entity: "user", entityId: actor.id, summary: `${actor.fullName} signed in.` }, now), message: "Signed in." };
    }

    case "create_user": {
      const denied = authorise(actor, "users:create");
      if (denied) return denied;
      const { errors, value } = validateUser(db, command.input);
      const credentialErrors = validateCredential(command.credential);
      if (Object.keys(errors).length || Object.keys(credentialErrors).length)
        return fail("Please correct the highlighted fields.", { ...errors, ...credentialErrors });
      const user: User = { id: makeId(), ...value, ...command.credential, createdAt: now, updatedAt: now };
      const next = audit({ ...db, users: withAccount([...db.users, user], user) }, actor, {
        action: "users:create",
        entity: "user",
        entityId: user.id,
        summary: `Created user ${user.email} (${user.role})${primaryNote(db, user, false)}.`,
      }, now);
      return { ok: true, db: next, message: `User ${user.fullName} created.` };
    }

    case "update_user": {
      const denied = authorise(actor, "users:update");
      if (denied) return denied;
      const existing = db.users.find((u) => u.id === command.id);
      if (!existing) return fail("User not found.");
      const { errors, value } = validateUser(db, command.input, existing.id);
      if (actor!.id === existing.id && !value.active) errors.active = "You cannot deactivate your own account.";
      if (actor!.id === existing.id && value.role !== "administrator") errors.role = "You cannot remove your own administrator role.";
      const otherAdmins = db.users.filter((u) => u.id !== existing.id && u.active && u.role === "administrator").length;
      if (existing.role === "administrator" && otherAdmins === 0 && (!value.active || value.role !== "administrator"))
        errors.role = "At least one active administrator must remain.";
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: User = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, users: withAccount(db.users, updated) }, actor, {
        action: "users:update",
        entity: "user",
        entityId: updated.id,
        summary: `Updated user ${updated.email}: role ${updated.role}, ${updated.active ? "active" : "inactive"}${primaryNote(db, updated, existing.primaryContact)}.`,
      }, now);
      return { ok: true, db: next, message: `User ${updated.fullName} updated.` };
    }

    case "update_profile": {
      if (!actor) return fail("Sign in is required.");
      const existing = db.users.find((u) => u.id === actor.id);
      if (!existing) return fail("Your account no longer exists.");
      const errors: Errors = {};
      const fullName = command.input.fullName.trim();
      const email = norm(command.input.email);
      if (!fullName) errors.fullName = "Full name is required.";
      if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
      else if (db.users.some((u) => u.id !== existing.id && u.email === email)) errors.email = "Another account already uses that email address.";
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: User = { ...existing, fullName, email, updatedAt: now };
      const next = audit({ ...db, users: db.users.map((u) => (u.id === updated.id ? updated : u)) }, actor, {
        action: "users:update_profile",
        entity: "user",
        entityId: updated.id,
        summary: `${existing.fullName} updated their own profile${email !== existing.email ? ` (email changed to ${email})` : ""}.`,
      }, now);
      return { ok: true, db: next, message: "Your profile was updated." };
    }

    case "change_own_password": {
      if (!actor) return fail("Sign in is required.");
      const existing = db.users.find((u) => u.id === actor.id);
      if (!existing) return fail("Your account no longer exists.");
      const credentialErrors = validateCredential(command.credential);
      if (Object.keys(credentialErrors).length) return fail("Please correct the highlighted fields.", credentialErrors);
      const updated: User = { ...existing, ...command.credential, updatedAt: now };
      const next = audit({ ...db, users: db.users.map((u) => (u.id === updated.id ? updated : u)) }, actor, {
        action: "users:change_password",
        entity: "user",
        entityId: updated.id,
        summary: `${updated.fullName} changed their own password.`,
      }, now);
      // The password hash is part of the session's credential tag, so every other session for this
      // account stops working the moment this returns; the caller re-signs the current one.
      return { ok: true, db: next, message: "Your password was changed." };
    }

    case "reset_user_password": {
      const denied = authorise(actor, "users:update");
      if (denied) return denied;
      const existing = db.users.find((u) => u.id === command.id);
      if (!existing) return fail("User not found.");
      const credentialErrors = validateCredential(command.credential);
      if (Object.keys(credentialErrors).length) return fail("Please correct the highlighted fields.", credentialErrors);
      const updated: User = { ...existing, ...command.credential, updatedAt: now };
      const next = audit({ ...db, users: db.users.map((u) => (u.id === updated.id ? updated : u)) }, actor, {
        action: "users:reset_password",
        entity: "user",
        entityId: updated.id,
        summary: `Password reset for ${updated.email}.`,
      }, now);
      return { ok: true, db: next, message: `Password reset for ${updated.fullName}.` };
    }

    case "update_settings": {
      const denied = authorise(actor, "settings:update");
      if (denied) return denied;
      const { errors, value } = validateSettings(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const next = audit({ ...db, settings: value }, actor, {
        action: "settings:update",
        entity: "settings",
        entityId: "settings",
        summary: `Settings updated (${value.vehicleCategories.length} categories, ${value.shifts.length} shifts).`,
      }, now);
      return { ok: true, db: next, message: "Settings saved." };
    }

    case "create_vehicle": {
      const denied = authorise(actor, "vehicles:create");
      if (denied) return denied;
      if (db.settings.vehicleCategories.length === 0) return fail("Blocked: no vehicle categories are configured. An administrator must add them in Settings first.");
      const { errors, value } = validateVehicle(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      // A new vehicle has no photograph: the file is filed afterwards, through its own route (D-108).
      const vehicle: Vehicle = { id: makeId(), ...value, photo: null, status: "available", createdAt: now, updatedAt: now };
      const next = audit({ ...db, vehicles: [...db.vehicles, vehicle] }, actor, {
        action: "vehicles:create",
        entity: "vehicle",
        entityId: vehicle.id,
        summary: `Added vehicle ${vehicle.registration} (${vehicle.seatCapacity} seats).`,
      }, now);
      return { ok: true, db: next, message: `Vehicle ${vehicle.registration} added.` };
    }

    case "update_vehicle": {
      const denied = authorise(actor, "vehicles:update");
      if (denied) return denied;
      const existing = db.vehicles.find((v) => v.id === command.id);
      if (!existing) return fail("Vehicle not found.");
      const { errors, value } = validateVehicle(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: Vehicle = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, vehicles: db.vehicles.map((v) => (v.id === updated.id ? updated : v)) }, actor, {
        action: "vehicles:update",
        entity: "vehicle",
        entityId: updated.id,
        summary: `Updated vehicle ${updated.registration}.`,
      }, now);
      return { ok: true, db: next, message: `Vehicle ${updated.registration} updated.` };
    }

    case "transition_vehicle": {
      const denied = authorise(actor, "vehicles:transition");
      if (denied) return denied;
      const existing = db.vehicles.find((v) => v.id === command.id);
      if (!existing) return fail("Vehicle not found.");
      if (!VEHICLE_TRANSITIONS[existing.status].includes(command.to))
        return fail(`Transition ${existing.status} -> ${command.to} is not allowed.`, { to: "Not an allowed transition from the current status." });
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Give a short reason for the status change." });
      const updated: Vehicle = { ...existing, status: command.to, updatedAt: now };
      const next = audit({ ...db, vehicles: db.vehicles.map((v) => (v.id === updated.id ? updated : v)) }, actor, {
        action: "vehicles:transition",
        entity: "vehicle",
        entityId: updated.id,
        summary: `${updated.registration}: ${existing.status} -> ${command.to}. Reason: ${command.reason.trim()}`,
      }, now);
      return { ok: true, db: next, message: `${updated.registration} is now ${command.to.replace("_", " ")}.` };
    }

    case "create_driver": {
      const denied = authorise(actor, "drivers:create");
      if (denied) return denied;
      const { errors, value } = validateDriver(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const driver: Driver = { id: makeId(), ...value, createdAt: now, updatedAt: now };
      const next = audit({ ...db, drivers: [...db.drivers, driver] }, actor, {
        action: "drivers:create",
        entity: "driver",
        entityId: driver.id,
        summary: `Added driver ${driver.fullName} (licence ${driver.licenceNumber}).`,
      }, now);
      return { ok: true, db: next, message: `Driver ${driver.fullName} added.` };
    }

    case "update_driver": {
      const denied = authorise(actor, "drivers:update");
      if (denied) return denied;
      const existing = db.drivers.find((d) => d.id === command.id);
      if (!existing) return fail("Driver not found.");
      const { errors, value } = validateDriver(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: Driver = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, drivers: db.drivers.map((d) => (d.id === updated.id ? updated : d)) }, actor, {
        action: "drivers:update",
        entity: "driver",
        entityId: updated.id,
        summary: `Updated driver ${updated.fullName} (${updated.status}).`,
      }, now);
      return { ok: true, db: next, message: `Driver ${updated.fullName} updated.` };
    }

    case "create_client": {
      const denied = authorise(actor, "clients:create");
      if (denied) return denied;
      const { errors, value } = validateClient(db, command.input, undefined, now.slice(0, 10));
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const client: Client = { id: makeId(), ...value, createdAt: now, updatedAt: now };
      const next = audit({ ...db, clients: [...db.clients, client] }, actor, {
        action: "clients:create",
        entity: "client",
        entityId: client.id,
        summary: `Added corporate client ${client.name}.`,
      }, now);
      return { ok: true, db: next, message: `Client ${client.name} added.` };
    }

    case "update_client": {
      const denied = authorise(actor, "clients:update");
      if (denied) return denied;
      const existing = db.clients.find((c) => c.id === command.id);
      if (!existing) return fail("Client not found.");
      const { errors, value } = validateClient(db, command.input, existing.id, now.slice(0, 10));
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: Client = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, clients: db.clients.map((c) => (c.id === updated.id ? updated : c)) }, actor, {
        action: "clients:update",
        entity: "client",
        entityId: updated.id,
        summary: `Updated client ${updated.name} (${updated.status}).`,
      }, now);
      return { ok: true, db: next, message: `Client ${updated.name} updated.` };
    }

    case "create_client_location": {
      const denied = authorise(actor, "clients:create");
      if (denied) return denied;
      const { errors, value } = validateClientLocation(db, command.input);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const location: ClientLocation = { id: makeId(), ...value, createdAt: now, updatedAt: now };
      const client = db.clients.find((c) => c.id === location.clientId);
      const next = audit({ ...db, clientLocations: [...db.clientLocations, location] }, actor, {
        action: "clients:location_create",
        // The entry belongs to the customer, so the customer's own History panel shows it.
        entity: "client",
        entityId: location.clientId,
        summary: `Added branch ${location.name}${location.address ? ` (${location.address})` : ""} to ${client?.name ?? "the customer"}.`,
      }, now);
      return { ok: true, db: next, message: `Branch ${location.name} added to ${client?.name ?? "the customer"}.` };
    }

    case "update_client_location": {
      const denied = authorise(actor, "clients:update");
      if (denied) return denied;
      const existing = db.clientLocations.find((location) => location.id === command.id);
      if (!existing) return fail("Branch not found.");
      const { errors, value } = validateClientLocation(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: ClientLocation = { ...existing, ...value, updatedAt: now };
      const client = db.clients.find((c) => c.id === updated.clientId);
      const next = audit(
        { ...db, clientLocations: db.clientLocations.map((location) => (location.id === updated.id ? updated : location)) },
        actor,
        {
          action: "clients:location_update",
          entity: "client",
          entityId: updated.clientId,
          summary:
            updated.status === "closed" && existing.status !== "closed"
              ? `Closed branch ${updated.name} of ${client?.name ?? "the customer"}. The address is kept.`
              : `Updated branch ${updated.name} of ${client?.name ?? "the customer"}.`,
        },
        now,
      );
      return { ok: true, db: next, message: `Branch ${updated.name} updated.` };
    }

    case "create_rental": {
      const denied = authorise(actor, "rentals:create");
      if (denied) return denied;
      if (db.settings.vehicleCategories.length === 0) return fail("Blocked: no vehicle categories are configured. An administrator must add them in Settings first.");
      // Own-record scope: a client contact may only raise requests for its own client.
      // The client is forced here rather than trusted from the request.
      const confined = confinedClientId(db, actor);
      const scopedInput = confined === null ? command.input : { ...command.input, clientId: confined };
      const { errors, value } = validateRentalRequest(db, scopedInput);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const { reference, counters } = allocateReference(db, "rental", now.slice(0, 4));
      const rental: Rental = {
        id: makeId(),
        reference,
        ...value,
        status: "draft",
        quote: null,
        quoteHistory: [],
        // Nobody has agreed to anything yet; an enquiry is not an order (D-116).
        acceptance: null,
        assignedVehicleId: null,
        assignedDriverId: null,
        deposit: null,
        finalInvoice: null,
        resolutionReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const next = audit({ ...db, referenceCounters: counters, rentals: [...db.rentals, rental] }, actor, {
        action: "rentals:create",
        entity: "rental",
        entityId: rental.id,
        summary: `Rental request ${reference} created for ${rental.customerName}.`,
      }, now);
      return { ok: true, db: next, message: `Rental request ${reference} created.` };
    }

    // The one command a member of the public can reach (WEB-01). It carries no authority: whoever
    // calls it gets a draft request and nothing else — no list, no quote, no confirmation, no way to
    // read another enquiry back. The route in front of it (src/app/api/enquiry) adds the throttling
    // and the time-trap; this case is the write.
    case "submit_enquiry": {
      if (db.settings.vehicleCategories.length === 0) {
        return fail("Enquiries are not open yet: no vehicle types are configured. Call the office instead.");
      }
      const { errors, value } = validateEnquiry(db, command.input, now.slice(0, 10));
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const { reference, counters } = allocateReference(db, "rental", now.slice(0, 4));
      const rental: Rental = {
        id: makeId(),
        reference,
        ...value,
        status: "draft",
        quote: null,
        quoteHistory: [],
        // Nobody has agreed to anything yet; an enquiry is not an order (D-116).
        acceptance: null,
        assignedVehicleId: null,
        assignedDriverId: null,
        deposit: null,
        finalInvoice: null,
        resolutionReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const next = audit({ ...db, referenceCounters: counters, rentals: [...db.rentals, rental] }, actor, {
        action: "rentals:enquiry",
        entity: "rental",
        entityId: rental.id,
        summary: `Website enquiry ${reference} from ${rental.customerName}.`,
      }, now);
      return {
        ok: true,
        db: next,
        message: `Thank you. Your request is recorded as ${reference}, and the office will call ${rental.customerPhone} to confirm it.`,
      };
    }

    case "update_rental": {
      const denied = authorise(actor, "rentals:update");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (existing.status !== "draft") return fail("Only draft requests can be edited. Changes after quoting are not permitted in this phase.");
      const { errors, value } = validateRentalRequest(db, command.input, existing.id);
      if (Object.keys(errors).length) return fail("Please correct the highlighted fields.", errors);
      const updated: Rental = { ...existing, ...value, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:update",
        entity: "rental",
        entityId: updated.id,
        summary: `Rental request ${updated.reference} edited.`,
      }, now);
      return { ok: true, db: next, message: `Rental request ${updated.reference} updated.` };
    }

    case "quote_rental": {
      const denied = authorise(actor, "rentals:quote");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes("quoted")) return fail(`A quotation cannot be issued from status "${existing.status}".`);
      const built = buildQuote(db, actor!, command.input, now, existing, null);
      if (!built.ok) return built;
      const quote = built.quote;
      const updated: Rental = { ...existing, status: "quoted", quote, updatedAt: now };
      const next = audit({ ...db, referenceCounters: built.counters, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:quote",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} quoted as ${quote.number} (revision ${quote.revision}): ${quote.currencyCode} ${quote.subtotal.toFixed(2)} (deposit ${quote.currencyCode} ${quote.depositRequired.toFixed(2)}), valid until ${quote.validUntil}.`,
      }, now);
      return { ok: true, db: next, message: `Quotation ${quote.number} issued for ${updated.reference}.` };
    }

    case "requote_rental": {
      const denied = authorise(actor, "rentals:quote");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (existing.status !== "quoted" || !existing.quote)
        return fail("Only a quoted rental can be renewed. The request must remain in quoted status.");
      if (quotationIsLive(existing.quote, now))
        return fail("This quotation has not expired yet. Renewal is available only after the validity date.");
      const policy = db.settings.rental.requotePolicy;
      if (policy === null)
        return fail("Blocked: management has not set the expired-quotation policy in Settings → Bus rentals.");
      if (policy === "new_request")
        return fail("Management requires a new request for an expired quotation. Cancel this request and create a new one.");
      if (policy !== "revise_in_place") return fail("The expired-quotation policy is invalid. Ask an administrator to review Settings.");

      const built = buildQuote(db, actor!, command.input, now, existing, existing.quote);
      if (!built.ok) return built;
      const quote = built.quote;
      const updated: Rental = {
        ...existing,
        quoteHistory: [...(existing.quoteHistory ?? []), existing.quote],
        quote,
        updatedAt: now,
      };
      const currentRevision = quote.revision;
      const next = audit({ ...db, referenceCounters: built.counters, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:requote",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} quotation ${quote.number} renewed in place (revision ${currentRevision}): ${quote.currencyCode} ${quote.subtotal.toFixed(2)}, valid until ${quote.validUntil}. Prior quotation retained.`,
      }, now);
      return { ok: true, db: next, message: `Quotation ${quote.number} renewed for ${updated.reference} as revision ${currentRevision}; prior quotation retained.` };
    }

    // The customer saying yes to a quotation (RNT-05, D-116).
    //
    // Two ways in, and the record says which: the customer's own contact pressing accept in the
    // portal, or the office writing down a yes that came by phone — the way most of this business
    // actually agrees to a price. It is not the deposit: accepting a quotation changes no money and
    // moves no status, so the rental stays `quoted` until somebody records the deposit.
    case "accept_quotation": {
      const denied = authorise(actor, "rentals:accept");
      if (denied) return denied;
      const existing = db.rentals.find((rental) => rental.id === command.id);
      if (!existing) return fail("Rental not found.");

      // Own-record scope: a client contact may only answer its own client's quotation. The refusal
      // says nothing about the other customer's rental, only that this one is not theirs.
      const confined = confinedClientId(db, actor);
      if (confined !== null && existing.clientId !== confined) {
        return fail("This request is not on your account.");
      }

      const problems = canAcceptQuotation(existing, now);
      if (Object.keys(problems).length) return fail(problems.status ?? problems.quote ?? problems.acceptance ?? "This quotation cannot be accepted.", problems);

      const acceptance = buildAcceptance(
        existing,
        { actorId: actor?.id ?? null, name: actor?.fullName ?? "Unknown", channel: confined !== null ? "client_portal" : "office" },
        command.note ?? "",
        now,
      );
      const updated: Rental = { ...existing, acceptance, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((rental) => (rental.id === updated.id ? updated : rental)) }, actor, {
        action: "rentals:accept",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference}: ${acceptance.byName} accepted the quotation of ${acceptance.currencyCode} ${formatAmount(acceptance.total)} ${
          acceptance.channel === "client_portal" ? "in the customer portal" : "on the office's word"
        }${acceptance.note ? `. "${acceptance.note}"` : "."}`,
      }, now);
      return {
        ok: true,
        db: next,
        message: `${updated.reference}: the quotation of ${acceptance.currencyCode} ${formatAmount(acceptance.total)} is accepted.`,
      };
    }

    case "confirm_rental": {
      const denied = authorise(actor, "rentals:confirm");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes("confirmed")) return fail(`A rental cannot be confirmed from status "${existing.status}".`);
      if (!existing.quote) return fail("This rental has no quotation to confirm.");
      if (!quotationIsLive(existing.quote, now)) return fail("The quotation has expired. Issue a new quotation before confirming.");
      const errors: Errors = {};
      const parsed = parseAmount(command.input.amount ?? "");
      const method = command.input.method.trim();
      if (parsed.problem === "too-many-decimals") errors.amount = "Use at most two decimal places: amounts are in pesewas.";
      else if (parsed.problem === "too-large") errors.amount = "That amount looks wrong. Check the figure.";
      else if (parsed.problem) errors.amount = "Enter the deposit amount received.";
      else if (toMinor(parsed.amount) < toMinor(existing.quote.depositRequired)) {
        errors.amount = `Deposit must be at least ${existing.quote.currencyCode} ${formatAmount(existing.quote.depositRequired)}.`;
      }
      if (!method) errors.method = "Select the payment method.";
      else if (!db.settings.rental.paymentMethods.includes(method)) errors.method = "Unknown payment method.";
      if (Object.keys(errors).length) return fail("Please correct the deposit details.", errors);
      const deposit = { amount: parsed.amount, method, reference: command.input.reference.trim(), receivedAt: now };
      const updated: Rental = { ...existing, status: "confirmed", deposit, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:confirm",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} confirmed; deposit ${existing.quote.currencyCode} ${formatAmount(deposit.amount)} via ${method}.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} confirmed.` };
    }

    case "assign_rental": {
      const denied = authorise(actor, "rentals:dispatch");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (existing.status !== "confirmed" && existing.status !== "in_progress") return fail("Resources can only be assigned to confirmed or in-progress rentals.");
      const errors: Errors = {};
      const vehicle = db.vehicles.find((v) => v.id === command.input.vehicleId);
      if (!command.input.vehicleId) errors.vehicleId = "Select a vehicle.";
      else if (!vehicle) errors.vehicleId = "Unknown vehicle.";
      else if (vehicle.status === "retired" || vehicle.status === "out_of_service") errors.vehicleId = `Vehicle is ${vehicle.status.replace("_", " ")} and cannot be assigned.`;
      else if (vehicle.categoryId !== existing.vehicleCategoryId) errors.vehicleId = "Vehicle category does not match the requested category.";
      else if (vehicle.seatCapacity < existing.passengers)
        errors.vehicleId = `This vehicle seats ${vehicle.seatCapacity}; the request is for ${existing.passengers} passengers. Choose a larger vehicle or book two.`;
      else {
        // A company may declare a document mandatory before a vehicle carries passengers (Q-16,
        // D-76). Checked against the hire's start date, not today: a paper that expires before the
        // job is no better than one that was never recorded.
        const gaps = requiredDocumentGaps(db, "vehicle", vehicle.id, existing.startDate);
        if (gaps.length) errors.vehicleId = describeDocumentGaps(`Vehicle ${vehicle.registration}`, gaps);
        else if (db.settings.maintenance.blockOnOverdueService) {
          // Q-43 (D-80): the same rule for a hire as for a run — a routine service that has run past
          // its interval stops the vehicle being put to work. Judged as at today.
          const overdue = overdueServiceFor(db, vehicle.id, now.slice(0, 10));
          if (overdue) errors.vehicleId = `${overdue} The vehicle cannot be hired until it is serviced: Settings blocks an overdue service.`;
        }
      }

      const needsDriver = existing.driverRequired || db.settings.rental.driversAlwaysIncluded === true;
      const driver = db.drivers.find((d) => d.id === command.input.driverId);
      if (needsDriver) {
        if (!command.input.driverId) errors.driverId = "A driver is required for this rental.";
        else if (!driver) errors.driverId = "Unknown driver.";
        else if (driver.status !== "active") errors.driverId = `Driver is ${driver.status} and cannot be assigned.`;
        else if (driver.licenceExpiry < existing.endDate) errors.driverId = "Driver's licence expires before the rental end date.";
        else if (
          licenceClassProblem(
            db,
            driver,
            // The vehicle actually being hired decides the class; the requested category is the
            // fallback for a hire confirmed before a vehicle was chosen.
            vehicle?.categoryId ?? existing.vehicleCategoryId,
          )
        )
          errors.driverId = licenceClassProblem(db, driver, vehicle?.categoryId ?? existing.vehicleCategoryId)!;
        else {
          const gaps = requiredDocumentGaps(db, "driver", driver.id, existing.startDate);
          if (gaps.length) errors.driverId = describeDocumentGaps(`Driver ${driver.fullName}`, gaps);
        }
      } else if (command.input.driverId && !driver) {
        errors.driverId = "Unknown driver.";
      }

      // Double-booking prevention (the exclusion-constraint rule from Phase 0 section 5.1).
      let conflict = false;
      if (!errors.vehicleId && vehicle) {
        const clash = db.rentals.find(
          (r) => r.id !== existing.id && ACTIVE_RENTAL_STATUSES.includes(r.status) && r.assignedVehicleId === vehicle.id && datesOverlap(existing.startDate, existing.endDate, r.startDate, r.endDate),
        );
        if (clash) {
          errors.vehicleId = `Vehicle is already assigned to ${clash.reference} over overlapping dates.`;
          conflict = true;
        }
      }
      if (!errors.driverId && command.input.driverId && driver) {
        const clash = db.rentals.find(
          (r) => r.id !== existing.id && ACTIVE_RENTAL_STATUSES.includes(r.status) && r.assignedDriverId === driver.id && datesOverlap(existing.startDate, existing.endDate, r.startDate, r.endDate),
        );
        if (clash) {
          errors.driverId = `Driver is already assigned to ${clash.reference} over overlapping dates.`;
          conflict = true;
        }
      }
      if (Object.keys(errors).length) return fail("Please correct the assignment.", errors, conflict ? "conflict" : undefined);
      const updated: Rental = { ...existing, assignedVehicleId: command.input.vehicleId, assignedDriverId: command.input.driverId || null, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:assign",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} assigned vehicle ${vehicle!.registration}${driver ? ` and driver ${driver.fullName}` : ""}.`,
      }, now);
      return { ok: true, db: next, message: `Resources assigned to ${updated.reference}.${rentalServiceNotice(db, updated.assignedVehicleId, now)}` };
    }

    case "start_rental": {
      const denied = authorise(actor, "rentals:dispatch");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes("in_progress")) return fail(`A rental cannot start from status "${existing.status}".`);
      if (!existing.assignedVehicleId) return fail("Assign a vehicle before starting the rental.");
      const needsDriver = existing.driverRequired || db.settings.rental.driversAlwaysIncluded === true;
      if (needsDriver && !existing.assignedDriverId) return fail("Assign a driver before starting the rental.");
      // Re-checked on the day: a certificate can lapse between assignment and the hire (D-76).
      {
        const vehicle = db.vehicles.find((v) => v.id === existing.assignedVehicleId);
        if (vehicle) {
          const gaps = requiredDocumentGaps(db, "vehicle", vehicle.id, now.slice(0, 10));
          if (gaps.length) return fail(describeDocumentGaps(`Vehicle ${vehicle.registration}`, gaps));
        }
        const driver = db.drivers.find((d) => d.id === existing.assignedDriverId);
        if (driver) {
          const gaps = requiredDocumentGaps(db, "driver", driver.id, now.slice(0, 10));
          if (gaps.length) return fail(describeDocumentGaps(`Driver ${driver.fullName}`, gaps));
        }
        // And the routine service, re-checked on the day for the same reason as the papers.
        if (vehicle && db.settings.maintenance.blockOnOverdueService) {
          const overdue = overdueServiceFor(db, vehicle.id, now.slice(0, 10));
          if (overdue) return fail(`${overdue} The vehicle cannot be hired until it is serviced: Settings blocks an overdue service.`);
        }
      }
      // Ghana has no daylight saving, so the UTC calendar day is the business day (brief 5.5).
      // A hire cannot start before its booked date, nor after the day it was due back.
      const today = now.slice(0, 10);
      if (today < existing.startDate)
        return fail(`${existing.reference} is booked from ${existing.startDate}. It cannot be started before that date.`);
      if (today > existing.endDate)
        return fail(`${existing.reference} was due back on ${existing.endDate}. Cancel it or record a new booking instead.`);
      const updated: Rental = { ...existing, status: "in_progress", updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:start",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} started (in progress).`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} is now in progress.${rentalServiceNotice(db, updated.assignedVehicleId, now)}` };
    }

    case "complete_rental": {
      const denied = authorise(actor, "rentals:complete");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes("completed")) return fail(`A rental cannot be completed from status "${existing.status}".`);
      const { errors, lines, subtotal } = validateQuoteLines(command.input);
      if (Object.keys(errors).length) return fail("Please correct the final invoice line items.", errors);
      const finalInvoice: FinalInvoice = {
        currencyCode: existing.quote?.currencyCode ?? db.settings.currencyCode ?? "",
        lines,
        total: subtotal,
        issuedAt: now,
        issuedBy: actor!.fullName,
      };
      const updated: Rental = { ...existing, status: "completed", finalInvoice, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:complete",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} completed; final invoice ${finalInvoice.currencyCode} ${finalInvoice.total.toFixed(2)}.`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} completed.` };
    }

    case "decline_rental":
    case "cancel_rental": {
      const target: RentalStatus = command.type === "decline_rental" ? "declined" : "cancelled";
      const permission: Permission = command.type === "decline_rental" ? "rentals:quote" : "rentals:cancel";
      const denied = authorise(actor, permission);
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes(target)) return fail(`A rental cannot be ${target} from status "${existing.status}".`);
      if (!command.reason.trim()) return fail("A reason is required.", { reason: "Give a short reason." });
      const updated: Rental = { ...existing, status: target, resolutionReason: command.reason.trim(), updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: `rentals:${target}`,
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} ${target}. Reason: ${command.reason.trim()}`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} ${target}.` };
    }

    case "record_backup_export": {
      const denied = authorise(actor, "backup:export");
      if (denied) return denied;
      const next = audit(db, actor, {
        action: "backup:export",
        entity: "database",
        entityId: "database",
        summary: `Exported a full backup: ${db.users.length} users, ${db.vehicles.length} vehicles, ${db.drivers.length} drivers, ${db.clients.length} clients, ${db.rentals.length} rentals, ${db.passengers.length} passengers.`,
      }, now);
      return { ok: true, db: next, message: "Backup export recorded." };
    }

    case "import_backup": {
      const denied = authorise(actor, "backup:import");
      if (denied) return denied;
      // A backup is untrusted input: validate every record the app later trusts, not just
      // the top-level shape (see backupGuard.ts).
      const { database: imported, problems } = inspectBackup(command.database);
      if (!imported) return fail(`This file cannot be imported. ${describeProblems(problems)}`, { database: "Rejected by the backup validator." });
      const stillAdmin = imported.users.some((u) => u.id === actor!.id && u.active && u.role === "administrator");
      if (!stillAdmin) return fail("Import refused: your administrator account is not present in the backup, which would lock you out.");
      const next = audit(imported, actor, {
        action: "backup:import",
        entity: "database",
        entityId: "database",
        summary: `Restored backup with ${imported.vehicles.length} vehicles, ${imported.drivers.length} drivers, ${imported.clients.length} clients, ${imported.rentals.length} rentals, ${imported.users.length} users.`,
      }, now);
      return { ok: true, db: next, message: "Backup restored." };
    }
  }
}
