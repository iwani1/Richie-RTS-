// Every command the browser is allowed to send, in one list (D-89).
//
// This list used to live inside the API route, beside the permission table. It had drifted: two
// finance commands and one busing command were missing from it, so the service understood them, the
// screens offered buttons for them, and the server answered "Unknown command" — the credit note
// form and the ad-hoc run button could never work in the deployed application. The unit tests did
// not notice because they call the service directly; only the route's own list stood between the
// screen and the database.
//
// Moving the list into a plain module means a test can compare it against each module's exported
// command types (`src/tms/commandTypes.test.ts`), so the next command that is added somewhere cannot
// quietly be missing here.
import type { Command } from "./service";

export const KNOWN_COMMAND_TYPES = [
  "record_sign_in",
  "update_settings",
  "create_vehicle", "update_vehicle", "transition_vehicle",
  "create_driver", "update_driver",
  "create_client", "update_client",
  "create_contract", "update_contract", "advance_contract",
  "create_rental", "update_rental", "quote_rental", "requote_rental", "confirm_rental",
  "assign_rental", "start_rental", "complete_rental", "decline_rental", "cancel_rental",
  "create_route", "update_route", "generate_trips", "dispatch_trip", "assign_trip",
  "start_trip", "complete_trip", "cancel_trip", "record_trip_stop", "correct_trip_record",
  "create_passenger", "update_passenger",
  "create_booking", "confirm_booking", "reject_booking", "cancel_booking",
  "create_incident", "update_incident", "advance_incident", "add_incident_cost", "remove_incident_cost",
  "create_work_order", "update_work_order", "advance_work_order", "add_work_order_cost", "remove_work_order_cost",
  "create_document", "update_document",
  "record_odometer", "void_odometer",
  "create_user", "update_user", "reset_user_password",
  "issue_rental_invoice", "void_invoice",
  "record_payment", "advance_payment", "void_payment",
  "issue_credit_note", "void_credit_note",
  "record_refund", "void_refund",
  "record_expense", "void_expense",
  "create_adhoc_trip",
  "record_backup_export",
  "import_records",
] as const;

export type KnownCommandType = (typeof KNOWN_COMMAND_TYPES)[number];

/**
 * Commands that deliberately have their own route instead of `/api/commands`.
 *
 * `setup_administrator` is reachable only from `/api/setup`, which refuses once an account exists.
 * `import_backup` is server-side only (scripts/restore.ts): a browser-supplied database would let
 * any signed-in user overwrite every table and every credential. The other three are the person's
 * own account and the public enquiry form, which have narrower routes of their own.
 */
export const COMMANDS_WITH_THEIR_OWN_ROUTE = [
  "setup_administrator",
  "import_backup",
  "update_profile",
  "change_own_password",
  "submit_enquiry",
] as const;

// The compiler holds this list to the service's own command union: a command added to `Command` and
// not added above (or to the withheld list) fails the type check, not a review.
type CoreCommandType = Command["type"];
type UnlistedCoreCommand = Exclude<CoreCommandType, KnownCommandType | (typeof COMMANDS_WITH_THEIR_OWN_ROUTE)[number]>;
/** A type alias cannot fail on its own; this constraint is what makes the next line an error. */
type AssertTrue<T extends true> = T;

/**
 * Fails the type check unless every core command type is listed above, or is one of the commands
 * with its own route. `UnlistedCoreCommand` is named in the error, so the fix is obvious.
 */
export type CoreCommandsAreAllListed = AssertTrue<UnlistedCoreCommand extends never ? true : false>;

const KNOWN = new Set<string>(KNOWN_COMMAND_TYPES);

export function isKnownCommandType(type: string): type is KnownCommandType {
  return KNOWN.has(type);
}
