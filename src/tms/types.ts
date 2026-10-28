// Domain types for Richie TMS - Phase 1A (foundation and master data).
// Business rules that are unknown are modelled as nullable settings with no default.

export const ROLES = ["administrator", "operations", "finance", "driver", "client_contact", "passenger"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  administrator: "Administrator",
  operations: "Operations / dispatch",
  finance: "Finance",
  driver: "Driver",
  client_contact: "Client contact",
  passenger: "Passenger",
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
  // points at its driver record, a client_contact account at its corporate client, and a
  // passenger account at the rider it is (PAX-01, D-97). All three are null for internal
  // staff, whose access is company-scoped.
  driverId: string | null;
  clientId: string | null;
  passengerId: string | null;
  // Which of a client's contact accounts is the one we ring first (Q-38, D-77). Only a
  // client_contact account can hold it, and only one per client; everything else is false.
  primaryContact: boolean;
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

/**
 * Whether the bus is ours, hired in, or being paid off (FLT-01, D-106).
 *
 * Null on a record nobody has classified. That is not the same as "owned": assuming ownership of a
 * leased bus is how a fleet report ends up claiming assets the company does not have.
 */
export const VEHICLE_OWNERSHIPS = ["owned", "leased", "hire_purchase"] as const;
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIPS)[number];
export const VEHICLE_OWNERSHIP_LABELS: Record<VehicleOwnership, string> = {
  owned: "Owned",
  leased: "Leased",
  hire_purchase: "Hire purchase",
};

/**
 * A photograph of the vehicle itself, filed through `/api/vehicle-photo` (FLT-01, D-108).
 *
 * The row is an index: the bytes live in a folder beside the database, exactly as a receipt scan does
 * (D-100), for the same reasons — a backup that carries a thousand photographs is slow to move, and a
 * name chosen by a phone must never become a path on this machine. Everything here is what the server
 * learned from the bytes and from its own clock; none of it comes from the browser.
 */
export interface VehiclePhoto {
  /** The name the file was stored under: always `vhcl_…`, always generated here. */
  storedName: string;
  /** The name the phone gave it, kept to be shown and for the download header. Never used as a path. */
  originalName: string;
  /** Decided by sniffing the first bytes, not by the browser's `Content-Type`. */
  mimeType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Vehicle {
  id: string;
  registration: string;
  categoryId: string;
  make: string;
  model: string;
  seatCapacity: number;
  status: VehicleStatus;
  /** What it runs on, in the office's own words: "Diesel", "Petrol". Blank = not recorded. */
  fuelType: string;
  /** Owned, leased or on hire purchase. Null = nobody has recorded it (not "owned"). */
  ownership: VehicleOwnership | null;
  /** Whose vehicle it is when it is not ours. Blank when owned, or when nobody has said. */
  ownerName: string;
  /**
   * The driver who normally takes this vehicle out (FLT-01). A habit, not an assignment: the run's
   * own vehicle and driver are what dispatch records, and this never stands in for them.
   */
  usualDriverId: string | null;
  /** The vehicle's photograph, or null when none has been filed (FLT-01). */
  photo: VehiclePhoto | null;
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
  /**
   * The classes printed on the licence, as the office reads them (FLT-04, D-103). Empty means
   * nobody has recorded them — and an undeclared class is not the same as one we checked.
   */
  licenceClasses: string[];
  /** Certificates the driver holds, as the office names them: "PSV", "Defensive driving". */
  qualifications: string[];
  status: DriverStatus;
  createdAt: string;
  updatedAt: string;
}

export const CLIENT_STATUSES = ["active", "inactive"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_TYPES = ["organisation", "individual"] as const;
/** Whether the customer is a company or a person. Null on a record nobody has classified yet. */
export type ClientType = (typeof CLIENT_TYPES)[number];
export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  organisation: "Organisation",
  individual: "Individual",
};

/**
 * A customer (CUS-01).
 *
 * The register used to be a name and a phone number, which is enough to ring somebody and not enough
 * to bill them. `reference` is the code the office already uses in its own files; `billingAddress` and
 * `tin` are what an invoice has to carry for a company to claim the tax, and what the office needs
 * when a customer asks for a copy of an old invoice. Nothing here is invented: every field may be
 * blank, and a blank is shown as "not recorded" rather than filled in with a guess.
 */
export interface Client {
  id: string;
  /** The customer's own code, as the office knows them. Blank when they have none. */
  reference: string;
  name: string;
  /** A company or a person. Null until somebody says which. */
  type: ClientType | null;
  /** The company registration number, when the office has the certificate (CLI-01). */
  registrationNumber: string;
  /** The date on that certificate, `YYYY-MM-DD`, or blank when it was not written down. */
  registeredOn: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** Where a bill is sent, as it should read on the document. */
  billingAddress: string;
  /** Tax identification number, printed on the invoice when a company has one. */
  tin: string;
  notes: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

export const CLIENT_LOCATION_STATUSES = ["active", "closed"] as const;
/** A branch is open for business or it has closed. Nothing is deleted, so the address survives. */
export type ClientLocationStatus = (typeof CLIENT_LOCATION_STATUSES)[number];

/**
 * A branch or office of a customer (CLI-01).
 *
 * Kept beside the client rather than as free text on it, because a corporate customer has several
 * — a head office that receives the bill and depots that the staff are picked up from — and the
 * question "which of their offices is this run for?" needs an answer that is one of a list.
 */
export interface ClientLocation {
  id: string;
  clientId: string;
  /** What the office calls it: "Head office", "Tema depot". */
  name: string;
  address: string;
  phone: string;
  /** The person at that branch, when it is not the same person as the client's contact. */
  contactName: string;
  status: ClientLocationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleCategory {
  id: string;
  name: string;
  /**
   * The licence classes that may drive this category (FLT-04). Empty means the office has not
   * classified it, and dispatch checks nothing — an empty cell must not ground the fleet.
   */
  licenceClasses: string[];
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
  /**
   * How long a quotation holds, in hours (RNT-04, D-117). It replaced whole days in schema 32: a
   * price quoted on a Friday morning and held "for seven days" runs out at a different hour from one
   * quoted on Friday afternoon, and a customer ringing on the last afternoon is entitled to be told
   * whether the price still stands. Stored in hours, printed in days until the remaining time is under
   * two days.
   */
  quotationValidityHours: number | null;
  driversAlwaysIncluded: boolean | null;
  paymentMethods: string[];
  requotePolicy: RequotePolicy | null;
  /**
   * The terms printed on every quotation (RNT-04, D-117). Free text the company writes, not a policy
   * this build invents: until it is set, quotations cannot be issued, and the screen says so.
   */
  quotationTerms: string;
  /**
   * The figure at or above which a quotation needs a second signature (RNT-04, D-121), in the billing
   * currency. Null means the company has not asked for one — and that is what the screens say, rather
   * than pretending every price is checked by two people.
   */
  quotationApprovalAbove: number | null;
  /**
   * The figure at or above which an extra charge added at completion needs a second signature
   * (RNT-07, D-123). Null is a real answer: the company has not asked for one on charges.
   */
  extraChargeApprovalAbove: number | null;
}

// Compliance document types (Q-16). Admin-defined, same pattern as VehicleCategory/Shift:
// no catalogue is assumed, the company names its own document types.
export const DOCUMENT_OWNER_TYPES = ["vehicle", "driver", "both"] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

export interface DocumentType {
  id: string;
  name: string;
  appliesTo: DocumentOwnerType;
  /**
   * When true, a vehicle or driver may not be assigned to work without a current copy of this
   * document (Q-16, D-76). Defaults to false: a company that has not said a paper is mandatory must
   * not be blocked by the system's guess.
   */
  required: boolean;
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
  /**
   * What one vehicle costs the company on a day it does not work (FLT-05, D-112): finance,
   * insurance, licensing, the driver on retainer. In the billing currency, per vehicle per day. No
   * default, because it is a business fact — until it is set the fleet dashboard counts idle days
   * and puts no money on them.
   */
  fleetStandingCostPerDay: number | null;
  // Days before expiry a document counts as "expiring soon". No default (Q-16): until
  // set, compliance reporting shows only already-expired documents, exactly like the
  // existing driver-licence check on the dashboard.
  documentReminderLeadDays: number | null;
  // The types of work a work order can carry (Q-34, D-78). The six below are the list the owner
  // approved, not a taxonomy invented here; the company may rename, remove or extend them.
  workTypes: string[];
  // What a recorded cost was for (Q-29, D-78). No values are assumed: until the company names
  // them, costs are recorded as "Uncategorised" and the report says so.
  costCategories: string[];
  maintenance: MaintenanceSettings;
  booking: BookingSettings;
}

/**
 * The two cut-offs a booking has (BKG-02, BKG-05, D-83). Both are null until management supplies
 * them, and both are in **minutes before departure** — the departure being the first stop's
 * scheduled time on the route.
 *
 * Null means "no cut-off configured", and the screens say exactly that rather than inventing a
 * deadline. A cut-off that nobody chose would refuse real bookings for a reason the office cannot
 * see in any document.
 */
export interface BookingSettings {
  requestCutoffMinutes: number | null;
  cancellationCutoffMinutes: number | null;
}

export function emptyBookingSettings(): BookingSettings {
  return { requestCutoffMinutes: null, cancellationCutoffMinutes: null };
}

/** The work types the owner approved in Q-34. Editable in Settings; nothing else is inferred. */
export const DEFAULT_WORK_TYPES = ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Other"] as const;

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
  /**
   * Q-43 (D-80). An overdue routine service is a **warning** by default: it shows on readiness and
   * on the vehicle list, and the work still goes out. Turning this on makes the same condition
   * refuse assignment, dispatch and start. A safety defect blocks either way — that is not a
   * setting, because a vehicle reported with a breakdown, accident or safety concern is already
   * taken out of service by the incident itself.
   */
  blockOnOverdueService: boolean;
}

export function emptyMaintenanceSettings(): MaintenanceSettings {
  return { schedules: [], blockOnOverdueService: false };
}

/**
 * The stages of a rental request (RNT-02, D-120), in the order work happens.
 *
 * The three triage states — submitted, under review, awaiting quotation — record that the office has
 * taken a request on and is checking it. They are optional: a quotation can be issued from any of
 * them, so a small request is never held up by a step nobody needed.
 *
 * `dispatched` is a hire that has left the yard, and it is the moment D-118 records as the departure.
 * There is no separate "in progress": one fact, one name.
 */
export const RENTAL_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "awaiting_quotation",
  "quoted",
  "accepted",
  "confirmed",
  "dispatched",
  "completed",
  "declined",
  "cancelled",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  awaiting_quotation: "Awaiting quotation",
  // What the customer is holding is a quotation that has been sent. The stored value keeps its old
  // name (`quoted`) so nothing has to be rewritten; the screen says what the document is.
  quoted: "Quotation sent",
  accepted: "Accepted, deposit due",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
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

/**
 * Who signed a price off (RNT-04, D-121).
 *
 * The record answers the two questions a dispute asks: was a second person involved, and who were
 * they. It copies the total that was approved, so a later revision cannot borrow this signature.
 */
/**
 * A second signature on a figure: who gave it, when, for how much, and anything they wrote beside it.
 *
 * One shape does three jobs — a quotation's sign-off (D-121), and an extra charge added at completion
 * (D-123) — because the question asked of all of them is the same, and the answer must be recorded the
 * same way: nobody signs their own figure, and the signature belongs to the amount it was given for.
 */
export interface Approval {
  at: string;
  byActorId: string | null;
  byName: string;
  note: string;
  /** The figure agreed, as it stood when the approval was given. */
  total: number;
}

/** A quotation's approval is an approval. Two names for one shape only where a screen reads better for it. */
export type QuoteApproval = Approval;

/**
 * A charge added when the hire comes back — fuel, a damaged seat, a waiting hour the office agreed on
 * the phone — and the second signature it may need (RNT-07, D-123).
 *
 * It carries its own reason: a customer being charged for something nobody explained is the first line
 * of a dispute. The charge is copied onto the final invoice as a line when the hire is completed, and
 * the signature is checked before that invoice can be issued.
 */
export interface ExtraCharge {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  /** Why the customer is being charged this. Required, and kept in the office's words. */
  reason: string;
  addedById: string | null;
  addedByName: string;
  addedAt: string;
  /** Null while nobody has signed it off. */
  approval: Approval | null;
}

export interface Quote {
  currencyCode: string;
  pricingBasis: PricingBasis;
  lines: QuoteLine[];
  /** The lines added up, before any discount and before tax. */
  subtotal: number;
  /** A reduction agreed before the document went out, with the reason written on it (D-121). */
  discountAmount: number;
  discountReason: string;
  /** Tax on the discounted subtotal, at the rates in force when the quotation was issued (D-121). */
  taxLines: TaxLine[];
  /** What the customer owes: `subtotal` less the discount, plus tax. */
  total: number;
  depositPercent: number;
  depositRequired: number;
  validUntil: string; // YYYY-MM-DD
  quotedAt: string;
  quotedBy: string;
  /** Who wrote the quotation, so a second signature can be told from the first (D-121). "" before. */
  quotedById: string;
  /** The second signature, or null while nobody has given one (D-121). */
  approval: QuoteApproval | null;
  /**
   * The quotation's own number, QUO-0001 (RNT-04, D-117), and which revision it is: 1 on the first
   * issue, 2 on the first renewal. A customer quoting a number back to the office names one document;
   * the revision says which version of it they were reading.
   */
  number: string;
  revision: number;
  /** The terms printed under the figures, as agreed when the quotation was issued (D-117). */
  terms: string;
  /** Whether the proposal includes a driver, decided when the quotation was issued. */
  driverIncluded: boolean;
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

/**
 * The customer saying yes to a quotation (RNT-05, D-116).
 *
 * Before this, "the customer agreed" existed only as a phone call: the office quoted, somebody said
 * yes, and the next thing on the record was the deposit. Who agreed, when, and to which figure were
 * not written down anywhere, so a dispute about the price had nothing to appeal to.
 *
 * The quotation itself is copied onto the acceptance rather than referenced, for the same reason an
 * invoice copies the buyer's details: a later requote must not silently inherit an agreement given to
 * a different figure. `quotedAt` is the identity of the quotation accepted — the office's own
 * timestamp — so a screen can say whether the yes still applies to what is on the record.
 */
export interface RentalAcceptance {
  /** When the customer said yes, ISO. */
  at: string;
  /** The account that recorded it: the customer's own contact, or the person who took the call. */
  byActorId: string | null;
  byName: string;
  /** Where it was given: in the customer's portal, or on the office's word from a phone call. */
  channel: "client_portal" | "office";
  /** The quotation accepted, by the office's own timestamp for it. */
  quotedAt: string;
  /** What they agreed to, as it stood: the total, the deposit and the currency. */
  total: number;
  depositRequired: number;
  currencyCode: string;
  /** Whatever they said with it. Optional, and never required to accept. */
  note: string;
}

/**
 * The hire as it actually happened (RNT-07, D-118).
 *
 * A completed rental used to carry the money and nothing about the run: the deposit said the office
 * had been paid, and the record could not say when the bus left, when it came back, how far it went,
 * whether it came back damaged or what the customer said afterwards. Those are the facts a repeat
 * customer is priced on and a damage claim turns on, and none of them belongs in a free-text note on
 * the request.
 *
 * Every field is nullable on purpose: an office that does not read an odometer must not have one
 * invented for it, and a hire recorded before this existed has no run at all rather than a made-up one.
 */
export interface RentalRun {
  /** When the vehicle actually left. Set when the hire starts; may be corrected at completion. */
  departedAt: string | null;
  /** When it actually came back. */
  returnedAt: string | null;
  /** Odometer read out at departure and at return, in whole kilometres, when somebody read it. */
  odometerStartKm: number | null;
  odometerEndKm: number | null;
  /** How far it actually went, and whether that came from the odometer or was typed in. */
  distanceKm: number | null;
  distanceSource: "odometer" | "entered" | null;
  /** What came back damaged, in the office's words. Blank when nothing was reported. */
  damageNotes: string;
  /** What the customer said afterwards, as the office wrote it down. */
  feedback: string;
  recordedBy: string;
  recordedAt: string;
}

/**
 * Where a rental request came from (RNT-01, D-119).
 *
 * A channel is a fact somebody chooses from a list, not a guess: the office knows whether the phone
 * rang or the customer walked in. An empty string is a request whose source nobody wrote down, and
 * the screens say exactly that rather than assuming the phone.
 */
export const REQUEST_SOURCES = ["phone", "walk_in", "email", "whatsapp", "website", "portal", "referral", "other"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/**
 * The journey the customer asked for (RNT-01, D-119).
 *
 * The pair to `RentalRun` (D-118): the plan is what was asked for, the run is what happened. Keeping
 * them apart is what lets a screen say "asked for 08:00, left 08:40" without either overwriting the
 * other, and it is why a request written before these fields existed carries `plan: null` — nothing
 * about its times, stops or origin was recorded, so nothing is claimed.
 */
export interface RentalPlan {
  /** Clock time on the start date, "HH:MM" in 24-hour form, or "" when nobody wrote one down. */
  departureTime: string;
  /** Clock time on the end date, or "" when the request says only how many days it needs. */
  returnTime: string;
  /** Intermediate stops between the pickup and the destination, in the order the vehicle calls. */
  stops: string[];
  luggage: string;
  specialNeeds: string;
  /** Who to ring on the day, when it is not the person who booked. */
  tripContactName: string;
  tripContactPhone: string;
  source: RequestSource | "";
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
  /** The customer's yes to a quotation, or null while nobody has given one (D-116). */
  acceptance: RentalAcceptance | null;
  /** What actually happened on the road, or null while nothing has been recorded (D-118). */
  run: RentalRun | null;
  /** The journey the customer asked for, or null for a request written before it was recorded (D-119). */
  plan: RentalPlan | null;
  assignedVehicleId: string | null;
  assignedDriverId: string | null;
  deposit: DepositPayment | null;
  finalInvoice: FinalInvoice | null;
  /** Charges added at completion, with their reasons and signatures (D-123). Empty for most hires. */
  extraCharges: ExtraCharge[];
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
  /**
   * How to find it (RTE-01): a landmark, a Ghana Post GPS address, and decimal coordinates.
   * All optional — blank means nobody has described this stop, which the screens say plainly
   * rather than filling with a guess.
   */
  landmark: string;
  digitalAddress: string;
  latitude: string;
  longitude: string;
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

// A correction to a recorded stop time or boarding outcome (D-74, Q-42).
//
// The record is never edited in place: a new entry says what changed, from what, by whom and why,
// and the trip's own fields are updated to the corrected value. The chain of entries is the evidence
// that the change was deliberate, so a report can show both the value and the fact that it moved.
export type TripCorrectionField = "stop_time" | "boarding_outcome";
export const TRIP_CORRECTION_FIELD_LABELS: Record<TripCorrectionField, string> = {
  stop_time: "Stop arrival time",
  boarding_outcome: "Boarding outcome",
};

export interface TripCorrection {
  id: string;
  field: TripCorrectionField;
  stopId: string;
  /** Set for a boarding-outcome correction, null for a stop time. */
  passengerId: string | null;
  previousValue: string | null;
  newValue: string;
  reason: string;
  correctedAt: string;
  correctedBy: string;
}

/**
 * A change to a route's roster that happened while a run was in progress (Q-48, D-79).
 *
 * The company has no notification channel, so nothing is pushed anywhere. The marker travels on
 * the run itself: the driver's next stop form opens with "what changed since you started", which
 * is a fact the system can show and cannot miss, unlike an SMS it never sent.
 */
export interface RosterChange {
  id: string;
  at: string;
  by: string;
  summary: string;
}

/**
 * Where a run came from (DSP-03, D-82).
 *
 * `schedule` — the route's operating days produced it, one per route per date, and that is still
 * guaranteed by a partial unique index. `adhoc` — a dispatcher created it by hand for a day the
 * schedule did not cover, or to replace a run that could not go out; it needs a written reason and
 * is allowed alongside the scheduled run for the same route and date.
 */
export const TRIP_ORIGINS = ["schedule", "adhoc"] as const;
export type TripOrigin = (typeof TRIP_ORIGINS)[number];
export const TRIP_ORIGIN_LABELS: Record<TripOrigin, string> = {
  schedule: "Scheduled",
  adhoc: "Ad hoc",
};

/**
 * A run that is late, said out loud while it is happening (DSP-04, D-105).
 *
 * The stop times already measure lateness after the fact; this is the different fact the office
 * needs at 07:20 — *this* run is *this* far behind, for *this* reason — so a dispatcher can answer
 * the phone without inventing a number, and the customer's own portal can say it.
 *
 * Append-only. A second entry is the delay getting worse, or the run recovering (`minutes: 0`);
 * nothing is edited in place, because the question a client asks afterwards is "what did you know,
 * and when", not "what is true now".
 */
export interface TripDelay {
  id: string;
  /** When it was recorded, ISO. */
  at: string;
  /** Minutes behind the timetable as reported. `0` means the run is back on time. */
  minutes: number;
  /** Why, in the words of whoever was there. Never empty. */
  reason: string;
  /** Who recorded it. A name, because the office has to be able to ring them back. */
  reportedBy: string;
}

export interface Trip {
  id: string;
  reference: string; // TR-0001
  routeId: string;
  serviceDate: string; // YYYY-MM-DD
  status: TripStatus;
  /** How this run came to exist. Older stored runs load as `schedule` (they were). */
  origin: TripOrigin;
  /** Why an ad hoc run was needed. Null on a scheduled run, required on an ad hoc one. */
  originReason: string | null;
  vehicleId: string | null;
  driverId: string | null;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  /** Set when the run was cancelled, including a run stopped after it had started (Q-47). */
  cancelledAt: string | null;
  cancelledBy: string | null;
  /** The incident that caused a mid-run cancellation, when one was recorded (D-75). */
  incidentId: string | null;
  stopLogs: StopLog[];
  boardings: BoardingRecord[];
  onTimeThresholdMinutes: number | null; // snapshot of the setting taken at completion
  /** Append-only: every entry is a correction that was applied, oldest first (D-74). */
  corrections: TripCorrection[];
  /** Append-only: delays reported while the run was out, oldest first (D-105). */
  delays: TripDelay[];
  /** Roster changes that happened while this run was in progress, oldest first (Q-48). */
  rosterChanges: RosterChange[];
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
// system invented. The category is one of the names the company configured in Settings, or
// blank for "Uncategorised" (Q-29, D-78).
export interface CostEntry {
  id: string;
  description: string;
  /** A name from `settings.costCategories`, or empty for "Uncategorised" (Q-29). */
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
  /** A name from `settings.workTypes` (Q-34). An order written before the list existed keeps its
   *  own text and is never silently rewritten. */
  workType: string;
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
  /** Who signed the vehicle back into service, and when. Required by brief MNT-02 and never inferred. */
  releasedBy: string | null;
  releasedAt: string | null;
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

/**
 * One person saying they have taken a paper's renewal on (FLT-03, D-110).
 *
 * A reminder in this program is a record, not a message: there is no mail or SMS provider
 * (Phase 2), so a "reminder" that leaves the building cannot be built honestly. What can be
 * recorded is the thing a reminder is for — somebody has seen the paper is running out, and
 * somebody is doing something about it. Append-only: a second acknowledgement supersedes the
 * first, so the record still shows who took it on and when they stopped.
 *
 * `expiryDate` is the date the person was looking at. If the paper is renewed the document's
 * expiry date moves, and this acknowledgement lapses with it rather than silencing a reminder
 * about a date nobody has dealt with.
 */
export interface DocumentReminder {
  id: string;
  documentId: string;
  /** The expiry date this acknowledgement was given against. */
  expiryDate: string;
  /** What is being done about it, in the person's own words. */
  note: string;
  /** When they expect the new paper, if they said. */
  expectedBy: string | null;
  acknowledgedBy: string;
  acknowledgedAt: string;
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

/**
 * A tax line captured at issue time, so a later rate change never rewrites an issued document.
 *
 * One shape serves the invoice and the quotation (RNT-04, D-121): a quotation that names a levy the
 * invoice later computes differently is exactly the argument this snapshot exists to prevent.
 */
export interface TaxLine {
  name: string;
  ratePercent: number;
  amount: number;
}

/** The invoice's name for it. Kept so the money documents did not have to be renamed. */
export type InvoiceTaxLine = TaxLine;

export interface Invoice {
  id: string;
  reference: string; // INV-2026-0001, from the database reference counter
  /** Rental invoices today. An invoice raised against a corporate agreement is not built yet (FIN-02). */
  kind: "rental";
  rentalId: string | null;
  clientId: string | null;
  customerName: string;
  /**
   * The buyer's billing details **as they were when the invoice was issued** (CUS-01). Copied, not
   * looked up: a customer who moves premises in July must not change the address printed on a
   * January invoice, exactly as a tax line is not recalculated later.
   */
  buyerAddress: string;
  buyerTin: string;
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

// ---- Credit notes (FIN-02, D-86) ----
//
// A credit note is the only way to take money *off* an invoice. An issued invoice is immutable: it
// cannot be edited down, and it cannot be voided once money has been recorded against it. When a
// service was not delivered, an amount was overcharged or a goodwill discount was agreed after the
// document went out, the office issues a credit note against that invoice. It keeps its own number,
// its own lines and its own reason, and it reduces what the invoice asks for.
//
// A credit note never moves money. Payments already recorded stay exactly as they are, because they
// are facts about money that arrived. If the credit takes the bill below what was paid, the difference
// is a **refund due** — stated plainly, never netted away silently (see `refundDue` in finance.ts).
export const CREDIT_NOTE_STATUSES = ["issued", "void"] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

export const CREDIT_NOTE_STATUS_LABELS: Record<CreditNoteStatus, string> = {
  issued: "Issued",
  void: "Void",
};

export interface CreditNote {
  id: string;
  reference: string; // CN-2026-0001
  invoiceId: string;
  /** Copied onto the credit note so it reads as a document on its own. */
  invoiceReference: string;
  clientId: string | null;
  customerName: string;
  currencyCode: string;
  lines: InvoiceLine[];
  /** The invoice's own tax rates, snapshotted here: a later rate change never rewrites a credit. */
  taxLines: InvoiceTaxLine[];
  /** Net of tax, in the invoice's currency. */
  subtotal: number;
  /** What this note takes off the invoice: subtotal plus the tax credited with it. */
  total: number;
  reason: string;
  issuedOn: string; // YYYY-MM-DD
  status: CreditNoteStatus;
  voidReason: string | null;
  voidedAt: string | null;
  createdBy: string;
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
 *
 * A payment can also be **cancelled** — the operator recorded it against the wrong invoice, or for
 * money that never arrived — with a reason, once (D-88). Cancelling is deliberately not a fourth
 * status on the verification ladder: the ladder answers "how far has this been checked?", and a
 * cancelled payment has not stopped being verified, it has stopped being true. The two facts are
 * kept apart so a cancelled payment cannot be un-cancelled by advancing it, and so a verification
 * step can never be mistaken for a cancellation.
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
  /** Why the payment was cancelled. Null while the payment stands. */
  voidReason: string | null;
  /** When it was cancelled. Null while the payment stands. */
  voidedAt: string | null;
}

export const REFUND_STATUSES = ["paid", "void"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  paid: "Paid back",
  void: "Cancelled",
};

/**
 * Money going back out to a customer (FIN-03, D-92).
 *
 * A credit note only ever *states* that money is owed back — it takes an amount off the bill, and
 * when the bill drops below what was received the difference becomes a refund due. Nothing in the
 * system used to record the day the office actually paid it: it was booked as a plain expense, which
 * lost the customer, the invoice and the reason, and made the month's cash-out look like spending on
 * the business.
 *
 * A refund is therefore its own numbered document, like a payment in reverse:
 *
 *   * it is raised against one invoice, and its ceiling is that invoice's `refundDue`
 *     (paid + credited − total, less refunds already made), checked in whole pesewas;
 *   * it does **not** change what the customer has paid. They paid what they paid; the office gave
 *     some of it back, and that is a separate fact;
 *   * it can be cancelled once, with a reason, if the transfer never left — the money is then owed
 *     back again, and the file still shows that the office tried.
 */
export interface Refund {
  id: string;
  reference: string; // REF-2026-0001
  invoiceId: string;
  /** Copied onto the refund so it reads on its own in a list. */
  invoiceReference: string;
  clientId: string | null;
  customerName: string;
  currencyCode: string;
  amount: number;
  /** How the money left the business: the same list of methods Settings holds for money coming in. */
  method: string;
  paidOn: string; // YYYY-MM-DD
  /** Bank reference, transfer id or receipt number, if the operator has one. */
  externalReference: string;
  /** Why the office paid money back. Required: a refund with no explanation is not auditable. */
  reason: string;
  status: RefundStatus;
  voidReason: string | null;
  voidedAt: string | null;
  recordedBy: string;
  recordedAt: string;
  updatedAt: string;
}

// ---- Contracts (brief 1B: CLI-02, D-95) ----
//
// A contract is the paper behind a corporate account: what was agreed, for which days and routes, at
// what price basis, and until when. Until now a client record said only that the company existed, so
// nothing in the system could answer "does this account still have an agreement?" — which is the
// question that decides whether a booking is the office's problem or a favour.
//
// The record is a transcription, not a calculation. Pricing model, billing frequency, payment terms and
// service-level targets are typed from the signed contract, because the system must not invent a rate
// and the company's real terms are not published anywhere it can read.
//
// Two decisions worth stating:
//   * **Expiry is computed, not stored.** A date passing is not an event a person records; storing
//     "expired" would need a nightly job and would be wrong between runs. `contractStateOf()` reports
//     "expired" from the end date, and every screen shows it as a status.
//   * **A contract is never rewritten once it is approved.** The terms of an agreed contract are what
//     was signed; a change is a new contract, and the history says which one it replaced. Until
//     approval, drafting and correction are ordinary edits.
export const CONTRACT_STATUSES = ["draft", "pending_approval", "active", "suspended", "terminated"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** What is shown to a person: the stored status, or "expired" when an active term has run out. */
export type ContractState = ContractStatus | "expired";

export const CONTRACT_STATUS_LABELS: Record<ContractState, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  active: "Active",
  suspended: "Suspended",
  terminated: "Terminated",
  expired: "Expired",
};

/** The services this system can actually deliver, so a contract cannot promise a third one. */
export const CONTRACT_SERVICE_TYPES = ["staff_transport", "bus_rental", "both"] as const;
export type ContractServiceType = (typeof CONTRACT_SERVICE_TYPES)[number];

export const CONTRACT_SERVICE_LABELS: Record<ContractServiceType, string> = {
  staff_transport: "Staff transport",
  bus_rental: "Bus rental",
  both: "Staff transport and bus rental",
};

/** One line of the record's own history: who moved it, when, from what, to what, and why. */
export interface ContractEvent {
  at: string;
  actor: string;
  from: ContractState;
  to: ContractState;
  note: string;
}

export interface Contract {
  id: string;
  reference: string; // CT-0001
  clientId: string;
  /** The client's name at the time, so a renamed account does not rewrite a signed document. */
  clientName: string;
  serviceType: ContractServiceType;
  startDate: string; // YYYY-MM-DD
  /** Null means open-ended: no renewal date has been agreed. */
  endDate: string | null;
  status: ContractStatus;
  /** The routes the contract covers. Empty means the contract names no routes. */
  routeIds: string[];
  /** Weekdays the service runs (0 = Sunday), as agreed. Empty means the contract says nothing. */
  weekdays: number[];
  /** Shifts covered, from `settings.shifts`, by id. Empty means every shift. */
  shiftIds: string[];
  /** The vehicle category the contract requires, or empty. */
  vehicleCategoryId: string;
  // Typed from the signed contract. Blank means the paper does not say, and is never filled in here.
  pricingModel: string;
  billingFrequency: string;
  paymentTerms: string;
  serviceLevelTargets: string;
  notes: string;
  /** The contract this one replaces, when a renegotiated agreement is entered as a new record. */
  replacesId: string | null;
  history: ContractEvent[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const EXPENSE_STATUSES = ["recorded", "void"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const RECEIPT_STATUSES = ["attached", "removed"] as const;
/** A receipt scan is either on file or it has been taken off, with a reason. Neither is deleted. */
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  attached: "On file",
  removed: "Removed",
};

/**
 * A scanned copy of one expense's receipt (Q-51, D-100).
 *
 * The file itself lives outside the database, in a folder on the same machine, because a database
 * backup that carries a thousand photographs is slow to move and a folder that carries none is not a
 * backup of the paper. This row is the index: which expense it belongs to, what the file is called on
 * disk, what kind it is, how big, its fingerprint, and who put it there.
 *
 * Nothing here is ever deleted. A scan that was wrong — the wrong receipt, a blurry photograph — is
 * **removed** with a reason and stays on the record with its file, because "why is there no scan on
 * this expense?" is a question an auditor asks a year later and a deleted row cannot answer it.
 */
export interface ReceiptFile {
  id: string;
  expenseId: string;
  /** The file inside the receipt folder. Generated by the server; never a name a person typed. */
  storedName: string;
  /** What the file was called when it arrived, for the reader: "Total filing 4 Aug.pdf". */
  originalName: string;
  /** Decided by looking at the bytes, not by trusting what the browser claimed. */
  mimeType: string;
  byteSize: number;
  /** SHA-256 of the bytes, so the same file can be recognised and a file can be checked later. */
  sha256: string;
  status: ReceiptStatus;
  removedReason: string | null;
  removedBy: string | null;
  removedAt: string | null;
  /** The scan that replaced this one, when a receipt was scanned again. */
  supersededById: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  recorded: "Recorded",
  void: "Void",
};

/**
 * Money the business spent on something that is not a repair: fuel, tolls, a permit, rent, a driver's
 * allowance (FIN-05, D-93).
 *
 * Until this existed, every recorded cost had to hang off an incident or a work order, so the only
 * costs the system could hold were maintenance costs. Fuel and tolls — usually the largest running
 * costs a transport business has — had nowhere to go, which made "what did this month cost?" quietly
 * mean "what did maintenance cost?".
 *
 * An expense is a record of a real payment, not a price the system worked out:
 *
 *   * it is numbered (`EXP-YYYY-NNNN`) so a receipt in a shoebox can be traced to a line;
 *   * it is filed by the day it was incurred, which is the day the money left;
 *   * `category` must be one of the names in Settings, or empty for "Uncategorised" — never invented;
 *   * it carries who was paid and the number on the paper receipt, plus whether the paper is actually
 *     held, because a cost nobody can produce a receipt for is a weaker fact and the report says so;
 *   * it can be voided once, with a reason — never edited, so the figure a report was built on stays
 *     the figure on the record.
 */
export interface Expense {
  id: string;
  reference: string; // EXP-2026-0001
  /** The day the money was spent. Reports file it here, not by when it was typed in. */
  incurredOn: string; // YYYY-MM-DD
  /** A name from `settings.costCategories`, or empty for "Uncategorised" (Q-29). */
  category: string;
  description: string;
  /** Who was paid: the filling station, the toll booth, the landlord. Optional. */
  payee: string;
  amount: number;
  currencyCode: string;
  /** How it was paid, from the configured methods, or empty when none were configured (D-93). */
  method: string;
  /** The number printed on the paper receipt or invoice, if there is one. */
  receiptReference: string;
  /** Whether the paper receipt is actually in the file. A receipt number without the paper is a claim. */
  receiptHeld: boolean;
  notes: string;
  status: ExpenseStatus;
  voidReason: string | null;
  voidedAt: string | null;
  recordedBy: string;
  recordedAt: string;
  updatedAt: string;
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
/**
 * A numbering series. Rentals, routes, trips, incidents and work orders are numbered continuously
 * and filed under the period `all`; invoices and payments restart each year (audit D-03).
 */
export const REFERENCE_SCOPES = ["rental", "quotation", "route", "trip", "incident", "workOrder", "contract", "invoice", "creditNote", "payment", "refund", "expense", "booking"] as const;
export type ReferenceScope = (typeof REFERENCE_SCOPES)[number];

export interface ReferenceCounter {
  scope: ReferenceScope;
  period: string; // YYYY for invoices and payments, "all" for the rest
  last: number;
}

// ---- Bookings (brief 1B: BKG-01..06, D-83) ----
//
// A booking is one named rider's seat on one named run. It is deliberately *not* a second roster:
// the standing roster is how a client's own staff travel every day, and a booking covers the seat
// that has to be named — a visitor, a new hire before the roster is updated, someone from another
// site. The two are counted together against the vehicle's seats, so a booking can never make a run
// over capacity.
export const BOOKING_TYPES = ["one_time", "recurring"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];
export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  one_time: "One journey",
  recurring: "Every operating day",
};

export const BOOKING_STATUSES = ["requested", "confirmed", "waitlisted", "offered", "rejected", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  waitlisted: "On the waiting list",
  offered: "Seat offered",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** One entry in a booking's own history — who changed it, when, and what they did (BKG-06). */
export interface BookingHistoryEntry {
  at: string;
  by: string;
  action: string;
  note: string;
}

export interface Booking {
  id: string;
  reference: string; // BK-0001
  passengerId: string;
  clientId: string;
  routeId: string;
  stopId: string | null;
  tripId: string;
  serviceDate: string;
  type: BookingType;
  status: BookingStatus;
  /** Why it was rejected, cancelled, or offered the seat. Empty when nothing was refused. */
  note: string;
  /** A recurring request made one booking per run; this is the group they belong to. */
  seriesId: string | null;
  /** Set while a cancelled seat has been offered to this waiter, and cleared when answered. */
  offeredAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  history: BookingHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export const SCHEMA_VERSION = 37;

/**
 * Every schema version this build can still read.
 *
 * A backup carries the version it was written at, and `migrate()` accepts anything in this list,
 * filling in the fields that arrived later. Adding a version here is part of bumping
 * `SCHEMA_VERSION`; forgetting it makes the application refuse its own backup, which is how the
 * "clean round-trip of its own backup" test caught this list going stale at 15.
 */
export const READABLE_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37] as const;

export interface Database {
  schemaVersion: typeof SCHEMA_VERSION;
  users: User[];
  vehicles: Vehicle[];
  drivers: Driver[];
  clients: Client[];
  clientLocations: ClientLocation[];
  rentals: Rental[];
  routes: BusRoute[];
  passengers: Passenger[];
  trips: Trip[];
  incidents: Incident[];
  workOrders: WorkOrder[];
  documents: ComplianceDocument[];
  documentReminders: DocumentReminder[];
  odometerReadings: OdometerReading[];
  invoices: Invoice[];
  creditNotes: CreditNote[];
  payments: Payment[];
  refunds: Refund[];
  expenses: Expense[];
  receipts: ReceiptFile[];
  bookings: Booking[];
  contracts: Contract[];
  referenceCounters: ReferenceCounter[];
  settings: Settings;
  audit: AuditEntry[];
}

export function emptyRentalSettings(): RentalSettings {
  return { pricingBasis: null, depositPercent: null, quotationValidityHours: null, driversAlwaysIncluded: null, paymentMethods: [], requotePolicy: null, quotationTerms: "", quotationApprovalAbove: null, extraChargeApprovalAbove: null };
}

export function emptyDatabase(): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    vehicles: [],
    drivers: [],
    clients: [],
    clientLocations: [],
    rentals: [],
    routes: [],
    passengers: [],
    trips: [],
    incidents: [],
    workOrders: [],
    documents: [],
    documentReminders: [],
    odometerReadings: [],
    invoices: [],
    creditNotes: [],
    payments: [],
    refunds: [],
    expenses: [],
    receipts: [],
    bookings: [],
    contracts: [],
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
      fleetStandingCostPerDay: null,
      workTypes: [...DEFAULT_WORK_TYPES],
      costCategories: [],
      maintenance: emptyMaintenanceSettings(),
      booking: emptyBookingSettings(),
    },
    audit: [],
  };
}

/**
 * A quotation from before schema 32, given the fields it never had — and no invented values.
 *
 * `number` stays empty and `revision` is 1, so `quotationIsNumbered` can tell the office this is a
 * price without a document behind it. The terms were never agreed, so they are blank; the driver
 * question is taken from the request only if the quotation was written after that field existed.
 */
function legacyQuote(quote: Quote): Quote {
  const raw = quote as Partial<Quote>;
  const taxLines = Array.isArray(raw.taxLines)
    ? raw.taxLines.filter((line): line is TaxLine => typeof line === "object" && line !== null && typeof line.name === "string")
    : [];
  const subtotal = typeof raw.subtotal === "number" ? raw.subtotal : 0;
  const discountAmount = typeof raw.discountAmount === "number" ? raw.discountAmount : 0;
  const taxTotal = taxLines.reduce((sum, line) => sum + (typeof line.amount === "number" ? line.amount : 0), 0);
  return {
    ...quote,
    number: typeof raw.number === "string" ? raw.number : "",
    revision: Number.isInteger(raw.revision) ? (raw.revision as number) : 1,
    terms: typeof raw.terms === "string" ? raw.terms : "",
    driverIncluded: raw.driverIncluded === true,
    // A quotation written before schema 36 carried no discount and no tax lines, so its total is its
    // subtotal: that is what the document said, and adding a levy nobody charged would be inventing
    // one (D-121).
    discountAmount,
    discountReason: typeof raw.discountReason === "string" ? raw.discountReason : "",
    taxLines,
    total: typeof raw.total === "number" ? raw.total : subtotal - discountAmount + taxTotal,
    // Nobody is recorded as having written or approved an older quotation, and a made-up name on a
    // signature is worse than an empty one.
    quotedById: typeof raw.quotedById === "string" ? raw.quotedById : "",
    approval: raw.approval && typeof raw.approval.at === "string" ? (raw.approval as QuoteApproval) : null,
  };
}

/**
 * A stored rental status, as this build names it.
 *
 * Only one word changed: `in_progress` became `dispatched` in schema 35, because a hire that has left
 * the yard is the same fact the trip board calls a dispatch. Anything unrecognised falls back to
 * `draft`, which is where an unpriced request belongs — a status this build cannot read would
 * otherwise let a hire with a vehicle against it disappear from every list.
 */
function rentalStatus(value: unknown): RentalStatus {
  if (value === "in_progress") return "dispatched";
  return (RENTAL_STATUSES as readonly unknown[]).includes(value) ? (value as RentalStatus) : "draft";
}

/**
 * The journey a request asked for, as it stands in a stored record.
 *
 * A request written before schema 34 has no `plan` at all, and this keeps it that way: the office may
 * well have known the departure time, but nothing here recorded it, and a blank-looking plan would say
 * "the customer asked for no stops, no luggage and no special needs" — a fact nobody stated (D-119).
 * A half-written plan (an object missing a key, a hand-edited backup) is filled in field by field.
 */
function readLegacyPlan(value: unknown): RentalPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<RentalPlan>;
  const text = (field: unknown) => (typeof field === "string" ? field : "");
  return {
    departureTime: text(raw.departureTime),
    returnTime: text(raw.returnTime),
    stops: Array.isArray(raw.stops) ? raw.stops.filter((stop): stop is string => typeof stop === "string") : [],
    luggage: text(raw.luggage),
    specialNeeds: text(raw.specialNeeds),
    tripContactName: text(raw.tripContactName),
    tripContactPhone: text(raw.tripContactPhone),
    source: REQUEST_SOURCES.includes(raw.source as RequestSource) ? (raw.source as RequestSource) : "",
  };
}

// Forward-compatible migration for data stored by earlier versions (schema 1 had no
// rentals and no rental settings). Returns null if the value is not a recognised DB.
export function migrate(value: unknown): Database | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!(READABLE_SCHEMA_VERSIONS as readonly number[]).includes(v.schemaVersion as number)) return null;
  if (!Array.isArray(v.users) || !Array.isArray(v.vehicles) || !Array.isArray(v.drivers) || !Array.isArray(v.clients) || !Array.isArray(v.audit)) return null;
  if (typeof v.settings !== "object" || v.settings === null) return null;
  const settings = v.settings as Record<string, unknown>;
  const legacyRental = (settings.rental as Partial<RentalSettings>) ?? {};
  // RNT-04 (D-117): validity moved from whole days to hours in schema 32. An older backup's days are
  // converted at 24 hours a day — the same price holding for the same length of time, not a rewrite.
  const legacyDays = (legacyRental as { quotationValidityDays?: number | null }).quotationValidityDays;
  const rental = {
    ...emptyRentalSettings(),
    ...legacyRental,
    quotationValidityHours:
      typeof legacyRental.quotationValidityHours === "number"
        ? legacyRental.quotationValidityHours
        : typeof legacyDays === "number"
          ? legacyDays * 24
          : null,
    // Terms are the company's own words. A backup written before them has none, and none is what it
    // gets: a quotation with invented conditions would bind a customer to something nobody wrote.
    quotationTerms: typeof legacyRental.quotationTerms === "string" ? legacyRental.quotationTerms : "",
    requotePolicy: legacyRental.requotePolicy ?? null,
  } as RentalSettings;
  return {
    schemaVersion: SCHEMA_VERSION,
    users: (v.users as User[]).map((u) => ({
      ...u,
      driverId: u.driverId ?? null,
      clientId: u.clientId ?? null,
      // A passenger account arrived in Phase 48; an older backup has none, and inventing a link
      // would hand somebody else's journeys to the wrong person.
      passengerId: u.passengerId ?? null,
      primaryContact: u.primaryContact === true,
    })),
    // The fleet facts arrived in schema 27. An older vehicle gains blanks and a null ownership,
    // which the register prints as "not recorded" rather than claiming it is owned (D-106).
    vehicles: Array.isArray(v.vehicles)
      ? (v.vehicles as Vehicle[]).map((vehicle) => ({
          ...vehicle,
          fuelType: typeof vehicle.fuelType === "string" ? vehicle.fuelType : "",
          ownership: VEHICLE_OWNERSHIPS.includes(vehicle.ownership as VehicleOwnership)
            ? (vehicle.ownership as VehicleOwnership)
            : null,
          ownerName: typeof vehicle.ownerName === "string" ? vehicle.ownerName : "",
          usualDriverId: typeof vehicle.usualDriverId === "string" && vehicle.usualDriverId !== "" ? vehicle.usualDriverId : null,
          // The photograph arrived in schema 28. A record without one keeps working and shows none.
          photo: vehicle.photo && typeof vehicle.photo.storedName === "string" ? vehicle.photo : null,
        }))
      : [],
    drivers: (v.drivers as Driver[]).map((driver) => ({
      ...driver,
      // FLT-04 arrived in schema 24. A licence class nobody wrote down is blank, not a guess, and
      // an empty list checks nothing rather than grounding every driver.
      licenceClasses: Array.isArray(driver.licenceClasses) ? driver.licenceClasses : [],
      qualifications: Array.isArray(driver.qualifications) ? driver.qualifications : [],
    })),
    clients: (v.clients as Client[]).map((client) => ({
      ...client,
      // CUS-01 arrived in schema 22. An older record has no code, no type and no billing details;
      // inventing "organisation" for every existing customer would be a fact nobody stated.
      reference: typeof client.reference === "string" ? client.reference : "",
      type: client.type === "individual" || client.type === "organisation" ? client.type : null,
      billingAddress: typeof client.billingAddress === "string" ? client.billingAddress : "",
      tin: typeof client.tin === "string" ? client.tin : "",
      notes: typeof client.notes === "string" ? client.notes : "",
      // CLI-01 arrived in schema 23. A certificate number the office never wrote down is blank,
      // not an invented one.
      registrationNumber: typeof client.registrationNumber === "string" ? client.registrationNumber : "",
      registeredOn: typeof client.registeredOn === "string" ? client.registeredOn : "",
    })),
    // Branches arrived in schema 23; an older backup has none, which is a fact about that backup.
    clientLocations: Array.isArray(v.clientLocations)
      ? (v.clientLocations as ClientLocation[]).map((location) => ({
          ...location,
          address: typeof location.address === "string" ? location.address : "",
          phone: typeof location.phone === "string" ? location.phone : "",
          contactName: typeof location.contactName === "string" ? location.contactName : "",
          status: location.status === "closed" ? "closed" : "active",
        }))
      : [],
    // An acceptance arrived in schema 31. A rental written before it has none — the office may have
    // been told yes on the phone, but nothing recorded it, and inventing an acceptance would be
    // putting words in a customer's mouth.
    rentals: Array.isArray(v.rentals)
      ? (v.rentals as Rental[]).map((rental) => ({
          ...rental,
          // A quotation written before numbering existed (schema 32) keeps its figures and gains no
          // number: the screen says it is unnumbered rather than printing a reference nobody issued.
          quote: rental.quote ? legacyQuote(rental.quote) : null,
          quoteHistory: (rental.quoteHistory ?? []).map(legacyQuote),
          // A hire written before the run was recorded (schema 33) has none. The office may well
          // know when the bus left and came back, but nothing here recorded it, and a plausible
          // timestamp would be a fact this program invented (D-118).
          run: rental.run && typeof rental.run.recordedAt === "string" ? rental.run : null,
          // The journey the customer asked for arrived in schema 34. A request written before it has
          // no plan: its times, stops, luggage and origin were never recorded, and filling them with
          // blanks dressed up as facts would read as "the customer asked for none" (D-119).
          plan: readLegacyPlan(rental.plan),
          // RNT-02 (D-120): a hire on the road was called "in progress" before schema 35. It is the
          // same fact as a trip that has been dispatched, so it takes that word — and the run's own
          // departure time is the moment it happened (D-118). No status is invented for a record that
          // has not reached it: a request written before the triage states existed sits in `draft`.
          status: rentalStatus(rental.status),
          acceptance:
            rental.acceptance && typeof rental.acceptance.at === "string" && typeof rental.acceptance.quotedAt === "string"
              ? rental.acceptance
              : null,
          // Charges added at completion arrived in schema 37. A hire completed before that was billed
          // for whatever it was billed for, and nothing here invents a charge nobody added (D-123).
          extraCharges: Array.isArray(rental.extraCharges)
            ? rental.extraCharges.filter((charge) => typeof charge?.description === "string")
            : [],
        }))
      : [],
    routes: Array.isArray(v.routes)
      ? (v.routes as BusRoute[]).map((route) => ({
          ...route,
          // RTE-01 arrived in schema 25. A stop written before it has no directions; the screen
          // says "no directions recorded" rather than inventing a landmark.
          stops: (route.stops ?? []).map((stop) => ({
            ...stop,
            landmark: typeof stop.landmark === "string" ? stop.landmark : "",
            digitalAddress: typeof stop.digitalAddress === "string" ? stop.digitalAddress : "",
            latitude: typeof stop.latitude === "string" ? stop.latitude : "",
            longitude: typeof stop.longitude === "string" ? stop.longitude : "",
          })),
        }))
      : [],
    passengers: Array.isArray(v.passengers) ? (v.passengers as Passenger[]) : [],
    trips: Array.isArray(v.trips)
      ? (v.trips as Trip[]).map((trip) => ({
          ...trip,
          startedAt: trip.startedAt ?? null,
          // Records written before corrections existed simply have none.
          corrections: Array.isArray(trip.corrections) ? trip.corrections : [],
          rosterChanges: Array.isArray(trip.rosterChanges) ? trip.rosterChanges : [],
          // Delays arrived in schema 26; a run written before it simply has none.
          delays: Array.isArray(trip.delays) ? trip.delays : [],
          origin: trip.origin === "adhoc" ? ("adhoc" as const) : ("schedule" as const),
          originReason: typeof trip.originReason === "string" && trip.originReason !== "" ? trip.originReason : null,
          // Likewise for a run stopped mid-way: older records only carry the reason.
          cancelledAt: trip.cancelledAt ?? null,
          cancelledBy: trip.cancelledBy ?? null,
          incidentId: trip.incidentId ?? null,
        }))
      : [],
    incidents: Array.isArray(v.incidents) ? (v.incidents as Incident[]) : [],
    workOrders: Array.isArray(v.workOrders)
      ? (v.workOrders as WorkOrder[]).map((order) => ({
          ...order,
          // Legacy records were never marked as a service; do not invent that decision.
          completedAt: order.completedAt ?? null,
          resetsServiceInterval: order.resetsServiceInterval ?? false,
          // Orders recorded before the release field existed were closed without one; do not
          // invent a releaser.
          releasedBy: order.releasedBy ?? null,
          releasedAt: order.releasedAt ?? null,
        }))
      : [],
    documents: Array.isArray(v.documents) ? (v.documents as ComplianceDocument[]) : [],
    // Renewal acknowledgements arrived in schema 29. A backup written before them has nobody
    // having taken any renewal on, which is exactly what the reminders should say.
    documentReminders: Array.isArray(v.documentReminders) ? (v.documentReminders as DocumentReminder[]) : [],
    odometerReadings: Array.isArray(v.odometerReadings) ? (v.odometerReadings as OdometerReading[]) : [],
    invoices: Array.isArray(v.invoices)
      ? (v.invoices as Invoice[]).map((invoice) => ({
          ...invoice,
          taxLines: invoice.taxLines ?? [],
          // Billing details on the document arrived in schema 22; an older invoice prints what it
          // always printed — the customer's name.
          buyerAddress: typeof invoice.buyerAddress === "string" ? invoice.buyerAddress : "",
          buyerTin: typeof invoice.buyerTin === "string" ? invoice.buyerTin : "",
        }))
      : [],
    // Credit notes arrived in schema 15; an older backup simply has none.
    creditNotes: Array.isArray(v.creditNotes) ? (v.creditNotes as CreditNote[]).map((note) => ({ ...note, taxLines: note.taxLines ?? [] })) : [],
    // Cancelling a payment arrived in schema 16; an older backup has no cancelled ones.
    payments: Array.isArray(v.payments)
      ? (v.payments as Payment[]).map((payment) => ({ ...payment, voidReason: payment.voidReason ?? null, voidedAt: payment.voidedAt ?? null }))
      : [],
    // Expenses that are not repairs arrived in schema 18; an older backup simply has none.
    expenses: Array.isArray(v.expenses) ? (v.expenses as Expense[]) : [],
    // Receipt scans arrived in schema 21. An older backup has none, and the files they index stay
    // where they are: a restore that silently dropped the index would orphan every scan on the disk.
    receipts: Array.isArray(v.receipts)
      ? (v.receipts as ReceiptFile[]).map((receipt) => ({
          ...receipt,
          status: receipt.status === "removed" ? ("removed" as const) : ("attached" as const),
          removedReason: receipt.removedReason ?? null,
          removedBy: receipt.removedBy ?? null,
          removedAt: receipt.removedAt ?? null,
          supersededById: receipt.supersededById ?? null,
        }))
      : [],
    // Refunds arrived in schema 17; an older backup simply has none.
    refunds: Array.isArray(v.refunds) ? (v.refunds as Refund[]) : [],
    // Bookings arrived in schema 14; an older backup simply has none.
    bookings: Array.isArray(v.bookings)
      ? (v.bookings as Booking[]).map((booking) => ({
          ...booking,
          note: typeof booking.note === "string" ? booking.note : "",
          seriesId: booking.seriesId ?? null,
          offeredAt: booking.offeredAt ?? null,
          cancelledAt: booking.cancelledAt ?? null,
          cancelledBy: booking.cancelledBy ?? null,
          history: Array.isArray(booking.history) ? booking.history : [],
        }))
      : [],
    // Contracts arrived in schema 19; an older backup simply has none.
    contracts: Array.isArray(v.contracts)
      ? (v.contracts as Contract[]).map((contract) => ({
          ...contract,
          endDate: contract.endDate ?? null,
          routeIds: Array.isArray(contract.routeIds) ? contract.routeIds : [],
          weekdays: Array.isArray(contract.weekdays) ? contract.weekdays : [],
          shiftIds: Array.isArray(contract.shiftIds) ? contract.shiftIds : [],
          vehicleCategoryId: contract.vehicleCategoryId ?? "",
          replacesId: contract.replacesId ?? null,
          history: Array.isArray(contract.history) ? contract.history : [],
        }))
      : [],
    // Counters arrive in schema 11. Older data had no invoices, so there is nothing to continue.
    referenceCounters: Array.isArray(v.referenceCounters) ? (v.referenceCounters as ReferenceCounter[]) : [],
    settings: {
      companyName: (settings.companyName as string | null) ?? null,
      currencyCode: (settings.currencyCode as string | null) ?? null,
      onTimeThresholdMinutes: (settings.onTimeThresholdMinutes as number | null) ?? null,
      // A category written before FLT-04 has no required classes, and therefore checks nothing.
      vehicleCategories: ((settings.vehicleCategories as VehicleCategory[]) ?? []).map((category) => ({
        ...category,
        licenceClasses: Array.isArray(category.licenceClasses) ? category.licenceClasses : [],
      })),
      shifts: (settings.shifts as Shift[]) ?? [],
      rental,
      // Records written before the flag existed are not required: the setting was never made.
      documentTypes: ((settings.documentTypes as DocumentType[]) ?? []).map((d) => ({ ...d, required: d.required === true })),
      documentReminderLeadDays: (settings.documentReminderLeadDays as number | null) ?? null,
      taxPosition: (settings.taxPosition as TaxPosition | null) ?? null,
      taxLines: (settings.taxLines as TaxLineSetting[]) ?? [],
      invoiceDueDays: (settings.invoiceDueDays as number | null) ?? null,
      // A backup written before FLT-05 has no standing cost, and therefore prices no idle day.
      fleetStandingCostPerDay: (settings.fleetStandingCostPerDay as number | null) ?? null,
      // Records written before the list existed keep the approved six rather than an empty list.
      workTypes: Array.isArray(settings.workTypes) ? (settings.workTypes as string[]) : [...DEFAULT_WORK_TYPES],
      costCategories: Array.isArray(settings.costCategories) ? (settings.costCategories as string[]) : [],
      // Stored settings keep the default (warning, not blocking) unless the flag was written as a
      // real `true`, so an older backup cannot start blocking dispatch by accident (Q-43, D-80).
      booking: { ...emptyBookingSettings(), ...((settings.booking as Partial<BookingSettings>) ?? {}) },
      maintenance: {
        ...emptyMaintenanceSettings(),
        ...((settings.maintenance as Partial<MaintenanceSettings>) ?? {}),
        blockOnOverdueService: (settings.maintenance as Partial<MaintenanceSettings> | undefined)?.blockOnOverdueService === true,
      },
    },
    audit: v.audit as Database["audit"],
  };
}
