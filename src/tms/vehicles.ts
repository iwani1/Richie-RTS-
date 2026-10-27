// What the fleet register was missing about the vehicle itself (FLT-01, D-106).
//
// The register knew a registration, a category, a seat count and a status. It did not know what the
// bus runs on, whether it is ours, whose it is if it is not, or which driver habitually takes it out.
// Those four facts are what a dispatcher needs when a leased bus is withdrawn, when fuel is bought,
// or when the same driver keeps reporting the same fault.
//
// The module exists for the reasons every other domain module here does: the form, the register and
// the importer must agree about what is acceptable, and the screens must read the same fact the same
// way. It holds no rules about *when* a vehicle may be used — that is `assessResources` in
// `busing.ts` — only what is true about the vehicle.
//
// Two deliberate absences:
//
//   * **No fixed list of fuels.** "Diesel" and "Petrol" are the common answers, but a converted bus
//     reads "Petrol and LPG" and a workshop's word for it may be neither. A closed list would refuse
//     the truth; free text, capped and trimmed, records it.
//   * **No guess at ownership.** A record nobody has classified stays null and prints "not recorded".
//     Defaulting to `owned` would put a hired bus on the company's asset list.
import type { Database, Vehicle, VehicleOwnership } from "./types";
import { VEHICLE_OWNERSHIPS, VEHICLE_OWNERSHIP_LABELS } from "./types";

export const VEHICLE_DETAIL_LIMITS = {
  fuelType: 30,
  ownerName: 80,
} as const;

export interface VehicleDetailInput {
  fuelType?: string;
  /** `""` means "not recorded", which is stored as null rather than as a value. */
  ownership?: string;
  ownerName?: string;
  usualDriverId?: string;
}

export type VehicleDetailProblems = Record<string, string>;

export interface VehicleDetailValue {
  fuelType: string;
  ownership: VehicleOwnership | null;
  ownerName: string;
  usualDriverId: string | null;
}

/**
 * The ownership a person wrote, in the words people actually use.
 *
 * A spreadsheet cell says "Lease", the form says "Leased", and both mean the same thing. Only the
 * spellings below are accepted: anything else is refused by `readVehicleDetail` rather than guessed
 * at, because a wrong ownership puts a hired bus on the company's asset list.
 */
export function normaliseOwnership(text: string): string {
  const key = text.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  switch (key) {
    case "owned":
    case "own":
    case "ours":
      return "owned";
    case "leased":
    case "lease":
    case "hired":
    case "rented":
      return "leased";
    case "hire purchase":
    case "hirepurchase":
    case "hp":
    case "financed":
      return "hire_purchase";
    default:
      return text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }
}

/** A vehicle is "not ours" when it is leased or being paid off; those must name the owner. */
export function isThirdParty(ownership: VehicleOwnership | null): boolean {
  return ownership === "leased" || ownership === "hire_purchase";
}

/**
 * Reads the four facts, or says what is wrong with them.
 *
 * Nothing here compares the vehicle with other vehicles — a registration is the only field that must
 * be unique, and `validateVehicle` already checks it — so this needs no `excludeId`. The usual driver
 * has to exist on the register: a name typed into a box is not a driver, and a dangling id would
 * print "Unknown" on every screen that names it.
 */
export function readVehicleDetail(
  db: Database,
  input: VehicleDetailInput,
): { errors: VehicleDetailProblems; value: VehicleDetailValue } {
  const errors: VehicleDetailProblems = {};
  const fuelType = (input.fuelType ?? "").trim();
  const ownerName = (input.ownerName ?? "").trim();
  const rawOwnership = (input.ownership ?? "").trim();
  const usualDriverId = (input.usualDriverId ?? "").trim();

  if (fuelType.length > VEHICLE_DETAIL_LIMITS.fuelType)
    errors.fuelType = `Keep the fuel type to ${VEHICLE_DETAIL_LIMITS.fuelType} characters.`;

  let ownership: VehicleOwnership | null = null;
  if (rawOwnership) {
    if (!(VEHICLE_OWNERSHIPS as readonly string[]).includes(rawOwnership)) {
      errors.ownership = "Choose owned, leased or hire purchase.";
    } else {
      ownership = rawOwnership as VehicleOwnership;
    }
  }

  if (ownerName.length > VEHICLE_DETAIL_LIMITS.ownerName)
    errors.ownerName = `Keep the owner's name to ${VEHICLE_DETAIL_LIMITS.ownerName} characters.`;

  // Only checked once the ownership itself is valid: two messages about one box is noise.
  if (!errors.ownership) {
    if (isThirdParty(ownership) && !ownerName)
      errors.ownerName = `Say whose vehicle it is — a ${VEHICLE_OWNERSHIP_LABELS[ownership!].toLowerCase()} bus belongs to somebody.`;
    // A name on an owned vehicle is usually one left behind by a change of mind. Refusing it is
    // kinder than storing it where no screen will ever show it again.
    if (ownership === "owned" && ownerName)
      errors.ownerName = "This vehicle is recorded as ours, so it has no other owner. Clear the name, or change the ownership.";
  }

  if (usualDriverId) {
    const driver = db.drivers.find((candidate) => candidate.id === usualDriverId);
    if (!driver) errors.usualDriverId = "That driver is not on the register. Pick one from the list.";
    else if (driver.status === "inactive")
      errors.usualDriverId = `${driver.fullName} is inactive, so they cannot be a vehicle's usual driver.`;
  }

  return {
    errors,
    value: {
      fuelType,
      ownership,
      ownerName,
      usualDriverId: usualDriverId || null,
    },
  };
}

/** "Leased from Ama Transport" / "Owned" / "" when nobody has recorded it. */
export function ownershipLine(vehicle: Pick<Vehicle, "ownership" | "ownerName">): string {
  if (!vehicle.ownership) return "";
  const label = VEHICLE_OWNERSHIP_LABELS[vehicle.ownership];
  if (isThirdParty(vehicle.ownership) && vehicle.ownerName) return `${label} from ${vehicle.ownerName}`;
  return label;
}

/**
 * The register's own sentence about a vehicle: what it runs on and whose it is.
 *
 * One line, because it is printed inside a table cell. Blank parts are left out rather than filled
 * with placeholders — the column already has a header saying what the line is about.
 */
export function vehicleDetailLine(vehicle: Pick<Vehicle, "fuelType" | "ownership" | "ownerName">): string {
  return [vehicle.fuelType, ownershipLine(vehicle)].filter(Boolean).join(" · ");
}

/** The usual driver, or null when none is recorded or the driver has since left the register. */
export function usualDriverOf(db: Database, vehicle: Pick<Vehicle, "usualDriverId">): Database["drivers"][number] | null {
  if (!vehicle.usualDriverId) return null;
  return db.drivers.find((driver) => driver.id === vehicle.usualDriverId) ?? null;
}

/**
 * What the register cannot yet say about the fleet, counted rather than glossed.
 *
 * Same rule as the stop directions (D-104): a count of the gaps is more use than a screen that looks
 * complete. Missing fuel means fuel cannot be reported; missing ownership means the fleet's assets
 * cannot be told from the ones it is paying for.
 */
export function fleetDetailGaps(db: Database): { noFuelType: number; noOwnership: number; noUsualDriver: number; total: number } {
  const live = db.vehicles.filter((vehicle) => vehicle.status !== "retired");
  return {
    noFuelType: live.filter((vehicle) => !vehicle.fuelType.trim()).length,
    noOwnership: live.filter((vehicle) => !vehicle.ownership).length,
    noUsualDriver: live.filter((vehicle) => !vehicle.usualDriverId).length,
    total: live.length,
  };
}
