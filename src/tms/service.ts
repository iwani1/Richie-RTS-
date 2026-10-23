// Command service: validation, authorisation, state transitions and audit.
// Pure and synchronous so it can be unit-tested and, later, moved behind an HTTP API
// unchanged. In this environment it runs in the browser (see docs/DECISIONS.md D-01).

import { can, type Permission } from "./permissions";
import { MIN_PASSWORD_LENGTH } from "./crypto";
import { confinedClientId } from "./scope";
import {
  CLIENT_STATUSES,
  DOCUMENT_OWNER_TYPES,
  DRIVER_STATUSES,
  PRICING_BASES,
  REQUOTE_POLICIES,
  migrate,
  type AuditEntry,
  type Client,
  type ClientStatus,
  type Database,
  type Driver,
  type DriverStatus,
  type FinalInvoice,
  type Quote,
  type QuoteLine,
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
  notes: string;
}

export interface DriverInput {
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiry: string;
  status: DriverStatus;
}

export interface ClientInput {
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: ClientStatus;
}

export interface UserInput {
  fullName: string;
  email: string;
  role: Role;
  active: boolean;
  // Which record this account acts for. Only meaningful for the driver and
  // client_contact roles; see PERMISSIONS.md "Own-record scope".
  driverId?: string | null;
  clientId?: string | null;
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
  | { type: "update_settings"; input: Settings }
  | { type: "create_vehicle"; input: VehicleInput }
  | { type: "update_vehicle"; id: string; input: VehicleInput }
  | { type: "transition_vehicle"; id: string; to: VehicleStatus; reason: string }
  | { type: "create_driver"; input: DriverInput }
  | { type: "update_driver"; id: string; input: DriverInput }
  | { type: "create_client"; input: ClientInput }
  | { type: "update_client"; id: string; input: ClientInput }
  | { type: "create_rental"; input: RentalRequestInput }
  | { type: "update_rental"; id: string; input: RentalRequestInput }
  | { type: "quote_rental"; id: string; input: QuoteInput }
  | { type: "requote_rental"; id: string; input: QuoteInput }
  | { type: "confirm_rental"; id: string; input: DepositInput }
  | { type: "assign_rental"; id: string; input: AssignmentInput }
  | { type: "start_rental"; id: string }
  | { type: "complete_rental"; id: string; input: QuoteInput }
  | { type: "decline_rental"; id: string; reason: string }
  | { type: "cancel_rental"; id: string; reason: string }
  | { type: "import_backup"; database: Database };

export type Failure = { ok: false; message: string; errors: Record<string, string> };
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

// Round to 2 dp without floating-point surprises.
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const datesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

export const PASSWORD_MIN_LENGTH = MIN_PASSWORD_LENGTH;

// A credential must look like something this app produced: 32 PBKDF2-SHA256 digest bytes
// and a 16-byte salt, both lower-case hex. Anything else is rejected before it becomes a
// user record, which closes two holes: an empty credential (which silently locks an account
// out) and a credential minted outside hashPassword() for a password the form would refuse.
const CREDENTIAL_HASH_RE = /^[0-9a-f]{64}$/;
const CREDENTIAL_SALT_RE = /^[0-9a-f]{32}$/;

export function validateCredential(credential: Credential | null | undefined): Errors {
  const errors: Errors = {};
  const hash = credential?.passwordHash;
  const salt = credential?.passwordSalt;
  if (typeof hash !== "string" || !CREDENTIAL_HASH_RE.test(hash)) {
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

export const fail = (message: string, errors: Errors = {}): Failure => ({ ok: false, message, errors });

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
  return { ...db, audit: [record, ...db.audit] };
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
  return {
    errors,
    value: {
      registration,
      categoryId: input.categoryId,
      make: input.make.trim(),
      model: input.model.trim(),
      seatCapacity: seats,
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
  if (!DRIVER_STATUSES.includes(input.status)) errors.status = "Invalid status.";
  return { errors, value: { fullName, phone, licenceNumber, licenceExpiry: input.licenceExpiry, status: input.status } };
}

export function validateClient(db: Database, input: ClientInput, excludeId?: string) {
  const errors: Errors = {};
  const name = input.name.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  if (!name) errors.name = "Client name is required.";
  else if (db.clients.some((c) => c.id !== excludeId && norm(c.name) === norm(name)))
    errors.name = "A client with this name already exists.";
  if (contactEmail && !EMAIL_RE.test(contactEmail)) errors.contactEmail = "Enter a valid email address.";
  if (!CLIENT_STATUSES.includes(input.status)) errors.status = "Invalid status.";
  return {
    errors,
    value: {
      name,
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      contactEmail,
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

  if (input.role === "driver") {
    if (clientId) errors.clientId = "A driver account is not linked to a client.";
    if (!driverId) errors.driverId = "Link this account to a driver record so it can see its own trips.";
    else if (!db.drivers.some((d) => d.id === driverId)) errors.driverId = "Driver record not found.";
    else if (db.users.some((u) => u.id !== excludeId && u.driverId === driverId))
      errors.driverId = "That driver record is already linked to another account.";
  } else if (input.role === "client_contact") {
    if (driverId) errors.driverId = "A client contact account is not linked to a driver.";
    if (!clientId) errors.clientId = "Link this account to a client so it can see its own records.";
    else if (!db.clients.some((c) => c.id === clientId)) errors.clientId = "Client not found.";
    else if (db.users.some((u) => u.id !== excludeId && u.clientId === clientId))
      errors.clientId = "That client already has a contact account. Multiple contacts per client are not supported yet (OPEN_QUESTIONS Q-38).";
  } else if (driverId || clientId) {
    errors.driverId = "Only driver and client contact accounts can be linked to a record.";
  }

  return { errors, value: { fullName, email, role: input.role, active: input.active, driverId, clientId } };
}

export function validateSettings(db: Database, input: Settings) {
  const errors: Errors = {};
  const companyName = input.companyName?.trim() || null;
  const currencyCode = input.currencyCode?.trim().toUpperCase() || null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) errors.currencyCode = "Use a three-letter ISO 4217 code (e.g. GHS).";
  const threshold = input.onTimeThresholdMinutes;
  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0))
    errors.onTimeThresholdMinutes = "Enter a whole number of minutes (0 or more).";

  const categories = input.vehicleCategories.map((c) => ({ id: c.id || makeId(), name: c.name.trim() }));
  const seenCat = new Set<string>();
  categories.forEach((c, i) => {
    if (!c.name) errors[`vehicleCategories.${i}`] = "Category name is required.";
    else if (seenCat.has(norm(c.name))) errors[`vehicleCategories.${i}`] = "Duplicate category name.";
    seenCat.add(norm(c.name));
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
    quotationValidityDays: rentalIn.quotationValidityDays,
    driversAlwaysIncluded: rentalIn.driversAlwaysIncluded,
    paymentMethods: rentalIn.paymentMethods.map((m) => m.trim()).filter(Boolean),
    requotePolicy: rentalIn.requotePolicy,
  };
  if (rental.pricingBasis !== null && !PRICING_BASES.includes(rental.pricingBasis)) errors["rental.pricingBasis"] = "Invalid pricing basis.";
  if (rental.depositPercent !== null && (!Number.isFinite(rental.depositPercent) || rental.depositPercent < 0 || rental.depositPercent > 100))
    errors["rental.depositPercent"] = "Deposit must be between 0 and 100 percent.";
  if (rental.quotationValidityDays !== null && (!Number.isInteger(rental.quotationValidityDays) || rental.quotationValidityDays < 1))
    errors["rental.quotationValidityDays"] = "Validity must be a whole number of days (1 or more).";
  const seenMethod = new Set<string>();
  for (const m of rental.paymentMethods) {
    if (seenMethod.has(norm(m))) errors["rental.paymentMethods"] = "Duplicate payment method.";
    seenMethod.add(norm(m));
  }
  if (rental.requotePolicy !== null && !REQUOTE_POLICIES.includes(rental.requotePolicy))
    errors["rental.requotePolicy"] = "Invalid expired-quotation policy.";

  const documentTypes = input.documentTypes.map((d) => ({ id: d.id || makeId(), name: d.name.trim(), appliesTo: d.appliesTo }));
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

  const maintenance = {
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
    value: { companyName, currencyCode, onTimeThresholdMinutes: threshold, vehicleCategories: categories, shifts, rental, documentTypes, documentReminderLeadDays, maintenance },
  };
}

// Returns true once management has supplied the rules quoting depends on (see OPEN_QUESTIONS Q-03,07,08,09,15).
export function rentalQuotingReady(settings: Settings): string[] {
  const missing: string[] = [];
  if (!settings.currencyCode) missing.push("billing currency");
  if (!settings.rental.pricingBasis) missing.push("rental pricing basis");
  if (settings.rental.depositPercent === null) missing.push("deposit percentage");
  if (settings.rental.quotationValidityDays === null) missing.push("quotation validity");
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

export function validateQuoteLines(input: QuoteInput) {
  const errors: Errors = {};
  const lines: QuoteLine[] = [];
  if (input.lines.length === 0) errors.lines = "Add at least one line item.";
  input.lines.forEach((line, i) => {
    const description = line.description.trim();
    const quantity = Number(line.quantity);
    const unitAmount = Number(line.unitAmount);
    if (!description) errors[`lines.${i}.description`] = "Description is required.";
    if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) errors[`lines.${i}.quantity`] = "Quantity must be greater than 0.";
    if (line.unitAmount.trim() === "" || !Number.isFinite(unitAmount) || unitAmount < 0) errors[`lines.${i}.unitAmount`] = "Amount must be 0 or more.";
    lines.push({ id: line.id || makeId(), description, quantity: Number.isFinite(quantity) ? quantity : 0, unitAmount: Number.isFinite(unitAmount) ? unitAmount : 0 });
  });
  const subtotal = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitAmount, 0));
  return { errors, lines, subtotal };
}

function buildQuote(db: Database, actor: Actor, input: QuoteInput, now: string): { ok: true; quote: Quote } | Failure {
  const missing = rentalQuotingReady(db.settings);
  if (missing.length)
    return fail(`Blocked: quotation settings are incomplete. An administrator must set: ${missing.join(", ")}.`);
  const { errors, lines, subtotal } = validateQuoteLines(input);
  if (Object.keys(errors).length) return fail("Please correct the quotation line items.", errors);
  const depositPercent = db.settings.rental.depositPercent!;
  const validityDays = db.settings.rental.quotationValidityDays!;
  const validUntil = new Date(new Date(now).getTime() + validityDays * 86_400_000).toISOString().slice(0, 10);
  return {
    ok: true,
    quote: {
      currencyCode: db.settings.currencyCode!,
      pricingBasis: db.settings.rental.pricingBasis!,
      lines,
      subtotal,
      depositPercent,
      depositRequired: round2((subtotal * depositPercent) / 100),
      validUntil,
      quotedAt: now,
      quotedBy: actor.fullName,
    },
  };
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
      const next = audit({ ...db, users: [...db.users, user] }, actor, {
        action: "users:create",
        entity: "user",
        entityId: user.id,
        summary: `Created user ${user.email} (${user.role}).`,
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
      const next = audit({ ...db, users: db.users.map((u) => (u.id === updated.id ? updated : u)) }, actor, {
        action: "users:update",
        entity: "user",
        entityId: updated.id,
        summary: `Updated user ${updated.email}: role ${updated.role}, ${updated.active ? "active" : "inactive"}.`,
      }, now);
      return { ok: true, db: next, message: `User ${updated.fullName} updated.` };
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
      const vehicle: Vehicle = { id: makeId(), ...value, status: "available", createdAt: now, updatedAt: now };
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
      const { errors, value } = validateClient(db, command.input);
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
      const { errors, value } = validateClient(db, command.input, existing.id);
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
      const reference = `RR-${String(db.rentals.length + 1).padStart(4, "0")}`;
      const rental: Rental = {
        id: makeId(),
        reference,
        ...value,
        status: "draft",
        quote: null,
        quoteHistory: [],
        assignedVehicleId: null,
        assignedDriverId: null,
        deposit: null,
        finalInvoice: null,
        resolutionReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const next = audit({ ...db, rentals: [...db.rentals, rental] }, actor, {
        action: "rentals:create",
        entity: "rental",
        entityId: rental.id,
        summary: `Rental request ${reference} created for ${rental.customerName}.`,
      }, now);
      return { ok: true, db: next, message: `Rental request ${reference} created.` };
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
      const built = buildQuote(db, actor!, command.input, now);
      if (!built.ok) return built;
      const quote = built.quote;
      const updated: Rental = { ...existing, status: "quoted", quote, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:quote",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} quoted: ${quote.currencyCode} ${quote.subtotal.toFixed(2)} (deposit ${quote.currencyCode} ${quote.depositRequired.toFixed(2)}), valid until ${quote.validUntil}.`,
      }, now);
      return { ok: true, db: next, message: `Quotation issued for ${updated.reference}.` };
    }

    case "requote_rental": {
      const denied = authorise(actor, "rentals:quote");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (existing.status !== "quoted" || !existing.quote)
        return fail("Only a quoted rental can be renewed. The request must remain in quoted status.");
      if (existing.quote.validUntil >= now.slice(0, 10))
        return fail("This quotation has not expired yet. Renewal is available only after the validity date.");
      const policy = db.settings.rental.requotePolicy;
      if (policy === null)
        return fail("Blocked: management has not set the expired-quotation policy in Settings → Bus rentals.");
      if (policy === "new_request")
        return fail("Management requires a new request for an expired quotation. Cancel this request and create a new one.");
      if (policy !== "revise_in_place") return fail("The expired-quotation policy is invalid. Ask an administrator to review Settings.");

      const built = buildQuote(db, actor!, command.input, now);
      if (!built.ok) return built;
      const quote = built.quote;
      const updated: Rental = {
        ...existing,
        quoteHistory: [...(existing.quoteHistory ?? []), existing.quote],
        quote,
        updatedAt: now,
      };
      const currentRevision = updated.quoteHistory.length + 1;
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:requote",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} quotation renewed in place (revision ${currentRevision}): ${quote.currencyCode} ${quote.subtotal.toFixed(2)}, valid until ${quote.validUntil}. Prior quotation retained.`,
      }, now);
      return { ok: true, db: next, message: `Quotation renewed for ${updated.reference} as revision ${currentRevision}; prior quotation retained.` };
    }

    case "confirm_rental": {
      const denied = authorise(actor, "rentals:confirm");
      if (denied) return denied;
      const existing = db.rentals.find((r) => r.id === command.id);
      if (!existing) return fail("Rental not found.");
      if (!RENTAL_TRANSITIONS[existing.status].includes("confirmed")) return fail(`A rental cannot be confirmed from status "${existing.status}".`);
      if (!existing.quote) return fail("This rental has no quotation to confirm.");
      if (existing.quote.validUntil < now.slice(0, 10)) return fail("The quotation has expired. Issue a new quotation before confirming.");
      const errors: Errors = {};
      const amount = Number(command.input.amount);
      const method = command.input.method.trim();
      if (command.input.amount.trim() === "" || !Number.isFinite(amount) || amount < 0) errors.amount = "Enter the deposit amount received.";
      else if (round2(amount) < existing.quote.depositRequired) errors.amount = `Deposit must be at least ${existing.quote.currencyCode} ${existing.quote.depositRequired.toFixed(2)}.`;
      if (!method) errors.method = "Select the payment method.";
      else if (!db.settings.rental.paymentMethods.includes(method)) errors.method = "Unknown payment method.";
      if (Object.keys(errors).length) return fail("Please correct the deposit details.", errors);
      const deposit = { amount: round2(amount), method, reference: command.input.reference.trim(), receivedAt: now };
      const updated: Rental = { ...existing, status: "confirmed", deposit, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:confirm",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} confirmed; deposit ${existing.quote.currencyCode} ${deposit.amount.toFixed(2)} via ${method}.`,
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

      const needsDriver = existing.driverRequired || db.settings.rental.driversAlwaysIncluded === true;
      const driver = db.drivers.find((d) => d.id === command.input.driverId);
      if (needsDriver) {
        if (!command.input.driverId) errors.driverId = "A driver is required for this rental.";
        else if (!driver) errors.driverId = "Unknown driver.";
        else if (driver.status !== "active") errors.driverId = `Driver is ${driver.status} and cannot be assigned.`;
        else if (driver.licenceExpiry < existing.endDate) errors.driverId = "Driver's licence expires before the rental end date.";
      } else if (command.input.driverId && !driver) {
        errors.driverId = "Unknown driver.";
      }

      // Double-booking prevention (the exclusion-constraint rule from Phase 0 section 5.1).
      if (!errors.vehicleId && vehicle) {
        const clash = db.rentals.find(
          (r) => r.id !== existing.id && ACTIVE_RENTAL_STATUSES.includes(r.status) && r.assignedVehicleId === vehicle.id && datesOverlap(existing.startDate, existing.endDate, r.startDate, r.endDate),
        );
        if (clash) errors.vehicleId = `Vehicle is already assigned to ${clash.reference} over overlapping dates.`;
      }
      if (!errors.driverId && command.input.driverId && driver) {
        const clash = db.rentals.find(
          (r) => r.id !== existing.id && ACTIVE_RENTAL_STATUSES.includes(r.status) && r.assignedDriverId === driver.id && datesOverlap(existing.startDate, existing.endDate, r.startDate, r.endDate),
        );
        if (clash) errors.driverId = `Driver is already assigned to ${clash.reference} over overlapping dates.`;
      }
      if (Object.keys(errors).length) return fail("Please correct the assignment.", errors);
      const updated: Rental = { ...existing, assignedVehicleId: command.input.vehicleId, assignedDriverId: command.input.driverId || null, updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:assign",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} assigned vehicle ${vehicle!.registration}${driver ? ` and driver ${driver.fullName}` : ""}.`,
      }, now);
      return { ok: true, db: next, message: `Resources assigned to ${updated.reference}.` };
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
      const updated: Rental = { ...existing, status: "in_progress", updatedAt: now };
      const next = audit({ ...db, rentals: db.rentals.map((r) => (r.id === updated.id ? updated : r)) }, actor, {
        action: "rentals:start",
        entity: "rental",
        entityId: updated.id,
        summary: `${updated.reference} started (in progress).`,
      }, now);
      return { ok: true, db: next, message: `${updated.reference} is now in progress.` };
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

    case "import_backup": {
      const denied = authorise(actor, "backup:import");
      if (denied) return denied;
      const imported = migrate(command.database);
      if (!imported) return fail("The file is not a valid Richie TMS backup (schema version 1 or 2).");
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
