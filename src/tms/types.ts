// Domain types for Richie TMS - Phase 1A (foundation and master data).
// Business rules that are unknown are modelled as nullable settings with no default.

export const ROLES = ["administrator", "operations", "finance", "driver", "client_contact"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: "Administrator",
  operations: "Operations / dispatch",
  finance: "Finance",
  driver: "Driver",
  client_contact: "Client contact",
};

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  // Own-record access depends on which record this account acts for. A driver account
  // points at its driver record, a client_contact account at its corporate client. Both
  // are null for internal staff, whose access is company-scoped.
  driverId: string | null;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
}

// "in_service" is reserved for trip assignment (later phase) and is not manually selectable in Phase 1A.
export const VEHICLE_STATUSES = ["available", "maintenance", "out_of_service", "retired"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available: "Available",
  maintenance: "Under maintenance",
  out_of_service: "Out of service",
  retired: "Retired",
};

export interface Vehicle {
  id: string;
  registration: string;
  categoryId: string;
  make: string;
  model: string;
  seatCapacity: number;
  status: VehicleStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const DRIVER_STATUSES = ["active", "suspended", "inactive"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  licenceNumber: string;
  licenceExpiry: string; // YYYY-MM-DD
  status: DriverStatus;
  createdAt: string;
  updatedAt: string;
}

export const CLIENT_STATUSES = ["active", "inactive"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface Client {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleCategory {
  id: string;
  name: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export const PRICING_BASES = ["per_day", "per_km", "per_trip"] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

// Q-24: the company decides what to do with an expired quote. No default policy.
export const REQUOTE_POLICIES = ["revise_in_place", "new_request"] as const;
export type RequotePolicy = (typeof REQUOTE_POLICIES)[number];
export const REQUOTE_POLICY_LABELS: Record<RequotePolicy, string> = {
  revise_in_place: "Revise the same request",
  new_request: "Cancel and raise a new request",
};

export const PRICING_BASIS_LABELS: Record<PricingBasis, string> = {
  per_day: "Per day",
  per_km: "Per kilometre",
  per_trip: "Per trip (flat)",
};

// Rental business rules. Every field is unknown until management supplies it (no default).
export interface RentalSettings {
  pricingBasis: PricingBasis | null;
  depositPercent: number | null; // 0..100
  quotationValidityDays: number | null;
  driversAlwaysIncluded: boolean | null;
  paymentMethods: string[];
  requotePolicy: RequotePolicy | null;
}

// Compliance document types (Q-16). Admin-defined, same pattern as VehicleCategory/Shift:
// no catalogue is assumed, the company names its own document types.
export const DOCUMENT_OWNER_TYPES = ["vehicle", "driver", "both"] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

export interface DocumentType {
  id: string;
  name: string;
  appliesTo: DocumentOwnerType;
}

// Every field below is a business fact the company must supply. None has a default.
export interface Settings {
  companyName: string | null;
  currencyCode: string | null;
  onTimeThresholdMinutes: number | null;
  vehicleCategories: VehicleCategory[];
  shifts: Shift[];
  rental: RentalSettings;
  documentTypes: DocumentType[];
  // No default: until the tax position is set, invoices cannot be issued (brief 2.3, 9).
  taxPosition: TaxPosition | null;
  taxLines: TaxLineSetting[];
  // Payment terms in days from issue; no default, because "30 days" would be an invented term.
  invoiceDueDays: number | null;
  // Days before expiry a document counts as "expiring soon". No default (Q-16): until
  // set, compliance reporting shows only already-expired documents, exactly like the
  // existing driver-licence check on the dashboard.
  documentReminderLeadDays: number | null;
  maintenance: MaintenanceSettings;
}

// Service intervals per vehicle category (OPEN_QUESTIONS Q-17, Q-37). Every field is null
// until management supplies it. A schedule must configure at least one basis.
export interface ServiceSchedule {
  categoryId: string;
  intervalKm: number | null;
  intervalDays: number | null;
  remindLeadKm: number | null;
  remindLeadDays: number | null;
}

export interface MaintenanceSettings {
  schedules: ServiceSchedule[];
}

export function emptyMaintenanceSettings(): MaintenanceSettings {
  return { schedules: [] };
}

export const RENTAL_STATUSES = ["draft", "quoted", "confirmed", "in_progress", "completed", "declined", "cancelled"] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  draft: "Draft",
  quoted: "Quoted",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
};

export interface QuoteLine {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number; // major currency units
}

export interface Quote {
  currencyCode: string;
  pricingBasis: PricingBasis;
  lines: QuoteLine[];
  subtotal: number;
  depositPercent: number;
  depositRequired: number;
  validUntil: string; // YYYY-MM-DD
  quotedAt: string;
  quotedBy: string;
}

export interface DepositPayment {
  amount: number;
  method: string;
  reference: string;
  receivedAt: string;
}

export interface FinalInvoice {
  currencyCode: string;
  lines: QuoteLine[];
  total: number;
  issuedAt: string;
  issuedBy: string;
}

export interface Rental {
  id: string;
  reference: string; // RR-0001
  clientId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  purpose: string;
  pickupLocation: string;
  dropoffLocation: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  passengers: number;
  vehicleCategoryId: string;
  driverRequired: boolean;
  notes: string;
  status: RentalStatus;
  quote: Quote | null;
  // Immutable previous quotation snapshots; quote is the current/latest version.
  quoteHistory: Quote[];
  assignedVehicleId: string | null;
  assignedDriverId: string | null;
  deposit: DepositPayment | null;
  finalInvoice: FinalInvoice | null;
  resolutionReason: string | null; // decline / cancel reason
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
}

// ---- Staff busing (recurring employee transport) ----
export const DIRECTIONS = ["to_work", "to_home"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABELS: Record<Direction, string> = {
  to_work: "Home to work",
  to_home: "Work to home",
};

export const ROUTE_STATUSES = ["active", "suspended", "ended"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export interface RouteStop {
  id: string;
  name: string;
  scheduledTime: string; // HH:MM pickup time at this stop
}

export interface BusRoute {
  id: string;
  reference: string; // RT-001
  name: string;
  clientId: string;
  direction: Direction;
  shiftId: string | null;
  vehicleCategoryId: string;
  weekdays: number[]; // 0 = Sunday ... 6 = Saturday
  startDate: string;
  endDate: string | null;
  stops: RouteStop[];
  status: RouteStatus;
  createdAt: string;
  updatedAt: string;
}

export const PASSENGER_STATUSES = ["active", "inactive"] as const;
export type PassengerStatus = (typeof PASSENGER_STATUSES)[number];

export interface Passenger {
  id: string;
  clientId: string;
  fullName: string;
  employeeRef: string;
  phone: string;
  routeId: string | null;
  stopId: string | null;
  status: PassengerStatus;
  createdAt: string;
  updatedAt: string;
}

export const TRIP_STATUSES = ["planned", "dispatched", "in_progress", "completed", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  planned: "Planned",
  dispatched: "Dispatched",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type BoardingOutcome = "boarded" | "no_show";

export interface StopLog {
  stopId: string;
  actualTime: string; // HH:MM
}

export interface BoardingRecord {
  passengerId: string;
  stopId: string;
  outcome: BoardingOutcome;
}

export interface Trip {
  id: string;
  reference: string; // TR-0001
  routeId: string;
  serviceDate: string; // YYYY-MM-DD
  status: TripStatus;
  vehicleId: string | null;
  driverId: string | null;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  stopLogs: StopLog[];
  boardings: BoardingRecord[];
  onTimeThresholdMinutes: number | null; // snapshot of the setting taken at completion
  createdAt: string;
  updatedAt: string;
}

// ---- Staff logistics (breakdown response, maintenance coordination, cost reporting) ----
export const INCIDENT_TYPES = ["breakdown", "accident", "damage", "safety_concern", "other"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  damage: "Damage",
  safety_concern: "Safety concern",
  other: "Other",
};

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const INCIDENT_STATUSES = ["reported", "acknowledged", "responding", "resolved", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  responding: "Response in progress",
  resolved: "Resolved",
  closed: "Closed",
};

// What the operator chose to do with the vehicle's status, recorded explicitly rather
// than assumed. "unchanged" leaves the vehicle exactly as it was.
export const VEHICLE_RESTORATIONS = ["unchanged", "available", "maintenance", "out_of_service"] as const;
export type VehicleRestoration = (typeof VEHICLE_RESTORATIONS)[number];

// Append-only timeline shared by incidents and work orders.
export interface LogEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  note: string;
  fromStatus: string | null;
  toStatus: string | null;
}

// A recorded cost fact. Amounts are operator-entered facts, never rates or prices the
// system invented. Categories are free text because no taxonomy has been supplied (Q-29).
export interface CostEntry {
  id: string;
  description: string;
  category: string;
  amount: number;
  incurredDate: string; // YYYY-MM-DD
  recordedAt: string;
  recordedBy: string;
}

export interface Incident {
  id: string;
  reference: string; // IN-0001
  type: IncidentType;
  severity: IncidentSeverity;
  vehicleId: string | null;
  tripId: string | null;
  reportedDate: string; // YYYY-MM-DD
  description: string;
  assignedTo: string | null;
  takeVehicleOutOfService: boolean;
  status: IncidentStatus;
  resolutionNote: string | null;
  vehicleRestoredTo: VehicleRestoration | null;
  costEntries: CostEntry[];
  log: LogEntry[];
  createdAt: string;
  updatedAt: string;
}

export const WORK_ORDER_STATUSES = ["open", "in_progress", "on_hold", "completed", "closed"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  completed: "Completed",
  closed: "Closed",
};

export interface WorkOrder {
  id: string;
  reference: string; // WO-0001
  vehicleId: string;
  title: string;
  workType: string; // free text: no work taxonomy has been supplied
  workshop: string; // free text: no approved workshop list has been supplied
  description: string;
  reportedOdometer: number | null;
  plannedDate: string | null;
  incidentId: string | null; // breakdown that raised this work, if any
  status: WorkOrderStatus;
  holdReason: string | null;
  completedAt: string | null; // set when the work order first reaches completed
  // Operator decision: does this work reset the service interval? Never inferred.
  resetsServiceInterval: boolean;
  costEntries: CostEntry[];
  costsConfirmedComplete: boolean;
  completionNote: string | null;
  log: LogEntry[];
  createdAt: string;
  updatedAt: string;
}

// A compliance document held against one vehicle or one driver (insurance, roadworthy
// certificate, ID, permit, etc. - the company names its own types in Settings). This is
// separate from Driver.licenceExpiry, which already drives trip-assignment eligibility
// and is left untouched (Integrity rule 6: preserve working code).
export interface ComplianceDocument {
  id: string;
  ownerType: "vehicle" | "driver";
  ownerId: string;
  documentTypeId: string;
  documentNumber: string;
  issuedDate: string | null; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OdometerReading {
  id: string;
  vehicleId: string;
  readingKm: number;
  readingDate: string; // YYYY-MM-DD
  note: string;
  status: "current" | "void";
  voidReason: string | null;
  createdAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------- invoicing (FIN-02, FIN-03)
//
// An invoice is the record the business is paid against. It is not the same thing as the
// quotation: a quotation can be revised, an issued invoice cannot (brief 5.4). Payments point at an
// invoice and are never edited; a correction is a new record with its own approver.
export const INVOICE_STATUSES = ["issued", "part_paid", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  issued: "Issued",
  part_paid: "Part paid",
  paid: "Paid",
  void: "Void",
};

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number; // major currency units, before tax
}

/** A tax line captured at issue time, so a later rate change never rewrites an issued invoice. */
export interface InvoiceTaxLine {
  name: string;
  ratePercent: number;
  amount: number;
}

export interface Invoice {
  id: string;
  reference: string; // INV-2026-0001, from the database reference counter
  /** Rental invoices in Phase 1A. Corporate invoices arrive with contracts (FIN-02, Phase 1B). */
  kind: "rental";
  rentalId: string | null;
  clientId: string | null;
  customerName: string;
  currencyCode: string;
  lines: InvoiceLine[];
  taxLines: InvoiceTaxLine[];
  subtotal: number;
  total: number;
  amountPaid: number;
  status: InvoiceStatus;
  /** What is being billed. A unique index makes a second invoice for it impossible (brief 5.4). */
  billableEvent: string;
  issuedOn: string; // YYYY-MM-DD
  dueOn: string; // YYYY-MM-DD
  notes: string;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PAYMENT_STATUSES = ["recorded", "verified", "reconciled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  recorded: "Recorded",
  verified: "Verified",
  reconciled: "Reconciled",
};

/**
 * A manual payment (FIN-03). The financial fields are written once; only the verification and
 * reconciliation status advances, and the database refuses any other change (migration 003).
 */
export interface Payment {
  id: string;
  reference: string; // PAY-2026-0001
  invoiceId: string;
  amount: number;
  currencyCode: string;
  method: string;
  paidOn: string; // YYYY-MM-DD
  externalReference: string; // bank slip / MoMo transaction id, if the operator has one
  status: PaymentStatus;
  note: string;
  log: LogEntry[];
  recordedBy: string;
  recordedAt: string;
}

export const TAX_POSITIONS = ["not_registered", "registered"] as const;
export type TaxPosition = (typeof TAX_POSITIONS)[number];

export const TAX_POSITION_LABELS: Record<TaxPosition, string> = {
  not_registered: "Not VAT registered — no tax lines on invoices",
  registered: "VAT registered — apply the configured tax lines",
};

/** A configurable tax line. Rates are never hard-coded; the accountant supplies them (brief 9). */
export interface TaxLineSetting {
  id: string;
  name: string;
  ratePercent: number;
}

/** A per-scope, per-year number series (brief 5.6). Stored with the data so a restored backup
 *  never reissues a reference that was already printed on a document. */
export interface ReferenceCounter {
  scope: "invoice" | "payment";
  period: string; // YYYY
  last: number;
}

export const SCHEMA_VERSION = 11;

export interface Database {
  schemaVersion: typeof SCHEMA_VERSION;
  users: User[];
  vehicles: Vehicle[];
  drivers: Driver[];
  clients: Client[];
  rentals: Rental[];
  routes: BusRoute[];
  passengers: Passenger[];
  trips: Trip[];
  incidents: Incident[];
  workOrders: WorkOrder[];
  documents: ComplianceDocument[];
  odometerReadings: OdometerReading[];
  invoices: Invoice[];
  payments: Payment[];
  referenceCounters: ReferenceCounter[];
  settings: Settings;
  audit: AuditEntry[];
}

export function emptyRentalSettings(): RentalSettings {
  return { pricingBasis: null, depositPercent: null, quotationValidityDays: null, driversAlwaysIncluded: null, paymentMethods: [], requotePolicy: null };
}

export function emptyDatabase(): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    vehicles: [],
    drivers: [],
    clients: [],
    rentals: [],
    routes: [],
    passengers: [],
    trips: [],
    incidents: [],
    workOrders: [],
    documents: [],
    odometerReadings: [],
    invoices: [],
    payments: [],
    referenceCounters: [],
    settings: {
      companyName: null,
      currencyCode: null,
      onTimeThresholdMinutes: null,
      vehicleCategories: [],
      shifts: [],
      rental: emptyRentalSettings(),
      documentTypes: [],
      documentReminderLeadDays: null,
      taxPosition: null,
      taxLines: [],
      invoiceDueDays: null,
      maintenance: emptyMaintenanceSettings(),
    },
    audit: [],
  };
}

// Forward-compatible migration for data stored by earlier versions (schema 1 had no
// rentals and no rental settings). Returns null if the value is not a recognised DB.
export function migrate(value: unknown): Database | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(v.schemaVersion as number)) return null;
  if (!Array.isArray(v.users) || !Array.isArray(v.vehicles) || !Array.isArray(v.drivers) || !Array.isArray(v.clients) || !Array.isArray(v.audit)) return null;
  if (typeof v.settings !== "object" || v.settings === null) return null;
  const settings = v.settings as Record<string, unknown>;
  const legacyRental = (settings.rental as Partial<RentalSettings>) ?? {};
  const rental = {
    ...emptyRentalSettings(),
    ...legacyRental,
    requotePolicy: legacyRental.requotePolicy ?? null,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    users: (v.users as User[]).map((u) => ({ ...u, driverId: u.driverId ?? null, clientId: u.clientId ?? null })),
    vehicles: v.vehicles as Database["vehicles"],
    drivers: v.drivers as Database["drivers"],
    clients: v.clients as Database["clients"],
    rentals: Array.isArray(v.rentals) ? (v.rentals as Rental[]).map((rental) => ({ ...rental, quoteHistory: rental.quoteHistory ?? [] })) : [],
    routes: Array.isArray(v.routes) ? (v.routes as BusRoute[]) : [],
    passengers: Array.isArray(v.passengers) ? (v.passengers as Passenger[]) : [],
    trips: Array.isArray(v.trips) ? (v.trips as Trip[]).map((trip) => ({ ...trip, startedAt: trip.startedAt ?? null })) : [],
    incidents: Array.isArray(v.incidents) ? (v.incidents as Incident[]) : [],
    workOrders: Array.isArray(v.workOrders)
      ? (v.workOrders as WorkOrder[]).map((order) => ({
          ...order,
          // Legacy records were never marked as a service; do not invent that decision.
          completedAt: order.completedAt ?? null,
          resetsServiceInterval: order.resetsServiceInterval ?? false,
        }))
      : [],
    documents: Array.isArray(v.documents) ? (v.documents as ComplianceDocument[]) : [],
    odometerReadings: Array.isArray(v.odometerReadings) ? (v.odometerReadings as OdometerReading[]) : [],
    invoices: Array.isArray(v.invoices)
      ? (v.invoices as Invoice[]).map((invoice) => ({ ...invoice, taxLines: invoice.taxLines ?? [] }))
      : [],
    payments: Array.isArray(v.payments) ? (v.payments as Payment[]) : [],
    // Counters arrive in schema 11. Older data had no invoices, so there is nothing to continue.
    referenceCounters: Array.isArray(v.referenceCounters) ? (v.referenceCounters as ReferenceCounter[]) : [],
    settings: {
      companyName: (settings.companyName as string | null) ?? null,
      currencyCode: (settings.currencyCode as string | null) ?? null,
      onTimeThresholdMinutes: (settings.onTimeThresholdMinutes as number | null) ?? null,
      vehicleCategories: (settings.vehicleCategories as VehicleCategory[]) ?? [],
      shifts: (settings.shifts as Shift[]) ?? [],
      rental,
      documentTypes: (settings.documentTypes as DocumentType[]) ?? [],
      documentReminderLeadDays: (settings.documentReminderLeadDays as number | null) ?? null,
      taxPosition: (settings.taxPosition as TaxPosition | null) ?? null,
      taxLines: (settings.taxLines as TaxLineSetting[]) ?? [],
      invoiceDueDays: (settings.invoiceDueDays as number | null) ?? null,
      maintenance: { ...emptyMaintenanceSettings(), ...((settings.maintenance as Partial<MaintenanceSettings>) ?? {}) },
    },
    audit: v.audit as Database["audit"],
  };
}
