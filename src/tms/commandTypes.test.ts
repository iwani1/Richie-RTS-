// The server's list of accepted commands against the modules that define them (D-89).
//
// Three commands were missing from that list when it lived inside the API route: two finance
// commands (issuing and voiding a credit note) and one busing command (creating an ad-hoc run). The
// service understood all three, the screens offered buttons for all three, and the route answered
// "Unknown command" — so the features could not be used in the deployed application at all, and no
// unit test noticed, because the tests call the service directly.
//
// These tests are the guard: every command a module exports must be a command the route accepts.
import { describe, expect, it } from "vitest";
import { BOOKING_COMMAND_TYPES } from "./bookings";
import { BUSING_COMMAND_TYPES } from "./busing";
import { COMMANDS_WITH_THEIR_OWN_ROUTE, KNOWN_COMMAND_TYPES } from "./commandTypes";
import { COMPLIANCE_COMMAND_TYPES } from "./compliance";
import { FINANCE_COMMAND_TYPES } from "./finance";
import { LOGISTICS_COMMAND_TYPES } from "./logistics";
import { MAINTENANCE_COMMAND_TYPES } from "./maintenance";

const MODULES: { name: string; types: readonly string[] }[] = [
  { name: "bookings", types: BOOKING_COMMAND_TYPES },
  { name: "busing", types: BUSING_COMMAND_TYPES },
  { name: "compliance", types: COMPLIANCE_COMMAND_TYPES },
  { name: "finance", types: FINANCE_COMMAND_TYPES },
  { name: "logistics", types: LOGISTICS_COMMAND_TYPES },
  { name: "maintenance", types: MAINTENANCE_COMMAND_TYPES },
];

const known = new Set<string>(KNOWN_COMMAND_TYPES);

describe("the commands the API route accepts", () => {
  for (const module of MODULES) {
    it(`covers every ${module.name} command`, () => {
      expect(module.types.filter((type) => !known.has(type))).toEqual([]);
    });
  }

  it("lists nothing twice", () => {
    // A duplicate is harmless to the Set, but it hides the fact that two commands were merged into
    // one name, which is exactly the kind of edit that loses a command.
    expect(KNOWN_COMMAND_TYPES.length).toBe(known.size);
  });

  it("keeps the three commands that the route had lost", () => {
    // Named individually as well as covered above: if a module's array is ever edited to drop one of
    // these, the module-level test would still pass while the feature disappeared again.
    expect(known.has("issue_credit_note")).toBe(true);
    expect(known.has("void_credit_note")).toBe(true);
    expect(known.has("create_adhoc_trip")).toBe(true);
  });

  it("accepts cancelling a payment", () => {
    expect(known.has("void_payment")).toBe(true);
  });

  it("never accepts a command that belongs to its own route", () => {
    // These bypass /api/commands on purpose (setup, restore, the person's own account, the public
    // enquiry form). Accepting them here would widen a route that was narrowed for a reason.
    for (const type of COMMANDS_WITH_THEIR_OWN_ROUTE) expect(known.has(type)).toBe(false);
  });
});
