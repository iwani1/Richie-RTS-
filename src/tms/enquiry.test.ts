// WEB-01: the public enquiry command, tested in the domain layer where it lives.
//
// Two things are being proved here, and they are different in kind:
//   1. the shape of what a stranger can create — a draft request and nothing else;
//   2. that no field arrives unvalidated, because this is the only command an unauthenticated
//      caller can reach.
import { describe, expect, it } from "vitest";
import { execute, type Actor, type Credential } from "./service";
import { emptyDatabase, type Database } from "./types";

const cred: Credential = { passwordHash: "a".repeat(64), passwordSalt: "b".repeat(32) };
const NOW = "2026-06-01T08:00:00.000Z";

function world(): Database {
  const created = execute(
    emptyDatabase(),
    null,
    { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred },
    NOW,
  );
  if (!created.ok) throw new Error(created.message);
  const admin: Actor = { id: created.db.users[0].id, fullName: "Admin", role: "administrator" };
  const configured = execute(
    created.db,
    admin,
    {
      type: "update_settings",
      input: {
        ...created.db.settings,
        companyName: "Richie Transport Services",
        currencyCode: "GHS",
        vehicleCategories: [{ id: "", name: "Coaster", licenceClasses: [] }],
        rental: {
          ...created.db.settings.rental, pricingBasis: "per_day", depositPercent: 20, paymentMethods: ["Cash"] },
      },
    },
    NOW,
  );
  if (!configured.ok) throw new Error(configured.message);
  return configured.db;
}

const valid = (db: Database) => ({
  customerName: "Akosua Boateng",
  customerPhone: "+233 24 123 4567",
  customerEmail: "akosua@example.test",
  organization: "Boateng Weddings",
  purpose: "Wedding party transport",
  pickupLocation: "East Legon",
  dropoffLocation: "Aburi",
  startDate: "2026-07-01",
  endDate: "2026-07-02",
  passengers: "18",
  vehicleCategoryId: db.settings.vehicleCategories[0]?.id ?? "",
  notes: "Two stops on the way back.",
});

describe("public enquiry", () => {
  it("records a draft request, attributed to the form rather than to a person", () => {
    const db = world();
    const result = execute(db, null, { type: "submit_enquiry", input: valid(db) }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rental = result.db.rentals[0];
    expect(result.db.rentals).toHaveLength(1);
    // A draft: no quote, no vehicle, no deposit, no invoice. The office still has to do the work.
    expect(rental.status).toBe("draft");
    expect(rental.quote).toBeNull();
    expect(rental.assignedVehicleId).toBeNull();
    expect(rental.deposit).toBeNull();
    expect(rental.finalInvoice).toBeNull();
    expect(rental.clientId).toBeNull();
    expect(rental).toMatchObject({ customerName: "Akosua Boateng", startDate: "2026-07-01", passengers: 18 });
    // The provenance is in the record, so nobody mistakes it for something taken at the desk.
    expect(rental.notes).toContain("public enquiry form");
    expect(rental.notes).toContain("Boateng Weddings");
    expect(rental.notes).toContain("Two stops on the way back.");

    const entry = result.db.audit[0];
    expect(entry.action).toBe("rentals:enquiry");
    expect(entry.actorId).toBeNull();
    expect(entry.actorName).toBe("System");
    expect(entry.summary).toMatch(/^Website enquiry RR-0001 from Akosua Boateng\.$/);
    // The reference is in the sentence the enquirer is shown.
    expect(result.message).toContain(rental.reference);
  });

  it("accepts an enquirer with no email address and no organisation", () => {
    const db = world();
    const input = { ...valid(db), customerEmail: "", organization: "" };
    const result = execute(db, null, { type: "submit_enquiry", input }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.rentals[0].customerEmail).toBe("");
      expect(result.db.rentals[0].notes).not.toContain("Organisation:");
    }
  });

  it("refuses a start date in the past, because a stranger cannot backdate a request", () => {
    const db = world();
    const result = execute(db, null, { type: "submit_enquiry", input: { ...valid(db), startDate: "2026-05-01", endDate: "2026-05-02" } }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.startDate).toMatch(/today onwards/);
  });

  it("rejects every field the office would have caught at the desk", () => {
    const db = world();
    const result = execute(
      db,
      null,
      {
        type: "submit_enquiry",
        input: {
          ...valid(db),
          customerName: "",
          customerPhone: "call me",
          customerEmail: "not-an-email",
          startDate: "2026-02-30",
          endDate: "2026-07-01",
          passengers: "0",
          vehicleCategoryId: "made-up",
        },
      },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["customerEmail", "customerName", "customerPhone", "passengers", "startDate", "vehicleCategoryId"].sort(),
    );
    expect(result.errors.passengers).toMatch(/whole number/);
    expect(result.errors.vehicleCategoryId).toMatch(/not offered/);
  });

  it("caps the free-text fields rather than storing whatever arrives", () => {
    const db = world();
    const result = execute(
      db,
      null,
      { type: "submit_enquiry", input: { ...valid(db), customerName: "A".repeat(121), purpose: "p".repeat(301), notes: "n".repeat(1001) } },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.customerName).toMatch(/120/);
      expect(result.errors.purpose).toMatch(/300/);
      expect(result.errors.notes).toMatch(/1000/);
    }
  });

  it("says so plainly when the company has not configured a vehicle type yet", () => {
    const created = execute(
      emptyDatabase(),
      null,
      { type: "setup_administrator", input: { fullName: "Admin", email: "admin@example.test" }, credential: cred },
      NOW,
    );
    if (!created.ok) throw new Error(created.message);
    // No category exists, so the input cannot name one: `valid()` would read an empty list.
    const result = execute(
      created.db,
      null,
      { type: "submit_enquiry", input: { ...valid(created.db), vehicleCategoryId: "" } },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not open yet/);
  });

  it("takes no authority from a signed-in actor: the same shape, whoever sends it", () => {
    const db = world();
    const admin: Actor = { id: db.users[0].id, fullName: "Admin", role: "administrator" };
    const asAdmin = execute(db, admin, { type: "submit_enquiry", input: valid(db) }, NOW);
    expect(asAdmin.ok).toBe(true);
    if (!asAdmin.ok) return;
    // Recorded against the person who was signed in, and still only a draft.
    expect(asAdmin.db.rentals[0].status).toBe("draft");
    expect(asAdmin.db.audit[0].actorName).toBe("Admin");
  });
});
