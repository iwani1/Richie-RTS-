// Branches, and the agreement line on a customer's row (CLI-01, D-102).
//
// A corporate customer is not one address. This suite is about the list of places it does have, and
// about the one-line answer the register gives to "is there an agreement with them?" — which is read
// from the contracts rather than stored on the customer, so it cannot go stale.
import { describe, expect, it } from "vitest";

import { clientAgreementLine, validateClientLocation } from "./clients";
import { emptyDatabase, type ClientLocation, type Contract, type Database } from "./types";

const NOW = "2026-10-26T09:00:00.000Z";

function world(): Database {
  return {
    ...emptyDatabase(),
    clients: [
      {
        id: "c1",
        reference: "NST-001",
        name: "Northstar Foods",
        type: "organisation",
        registrationNumber: "",
        registeredOn: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        billingAddress: "",
        tin: "",
        notes: "",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "c2",
        reference: "",
        name: "Harbour Logistics",
        type: null,
        registrationNumber: "",
        registeredOn: "",
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        billingAddress: "",
        tin: "",
        notes: "",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

const branch = (id: string, clientId: string, name: string, extra: Partial<ClientLocation> = {}): ClientLocation => ({
  id,
  clientId,
  name,
  address: "",
  phone: "",
  contactName: "",
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

describe("the branches of a customer (CLI-01)", () => {
  it("records where a branch is and who to ask for there", () => {
    const { errors, value } = validateClientLocation(world(), {
      clientId: "c1",
      name: "  Tema depot ",
      address: " Harbour Road, Gate 3 ",
      phone: " 0244000111 ",
      contactName: "Yaw Mensah",
    });

    expect(errors).toEqual({});
    expect(value).toMatchObject({
      clientId: "c1",
      name: "Tema depot",
      address: "Harbour Road, Gate 3",
      phone: "0244000111",
      contactName: "Yaw Mensah",
      // A branch nobody has closed is open, and the form does not have to say so.
      status: "active",
    });
  });

  it("refuses a second branch with the same name under the same customer, whatever the spacing", () => {
    const db = { ...world(), clientLocations: [branch("l1", "c1", "Tema depot")] };

    const clash = validateClientLocation(db, { clientId: "c1", name: "tema   DEPOT" });
    expect(clash.errors.name).toBe("This customer already has a branch with this name.");

    // The same name under a different customer is a different place, and is allowed.
    const other = validateClientLocation(db, { clientId: "c2", name: "Tema depot" });
    expect(other.errors).toEqual({});
  });

  it("lets a branch be saved under its own name, and renamed to a name nobody else has", () => {
    const db = { ...world(), clientLocations: [branch("l1", "c1", "Tema depot"), branch("l2", "c1", "Head office")] };

    // Saving the unchanged record is not a clash with itself.
    expect(validateClientLocation(db, { clientId: "c1", name: "Tema depot" }, "l1").errors).toEqual({});
    // Nor is keeping its own name while moving the address.
    expect(validateClientLocation(db, { clientId: "c1", name: "Tema depot", address: "New road" }, "l1").errors).toEqual({});
    // But adopting the other branch's name is refused.
    expect(validateClientLocation(db, { clientId: "c1", name: "Head office" }, "l1").errors.name).toBe(
      "This customer already has a branch with this name.",
    );
  });

  it("will not attach a branch to a customer that does not exist", () => {
    const { errors } = validateClientLocation(world(), { clientId: "nobody", name: "Depot" });
    expect(errors.clientId).toBe("Choose the customer this branch belongs to.");
  });

  it("refuses a nameless branch and an address that is not an address", () => {
    const nameless = validateClientLocation(world(), { clientId: "c1", name: "  " });
    expect(nameless.errors.name).toBe('Give the branch a name, such as "Tema depot".');

    const long = validateClientLocation(world(), { clientId: "c1", name: "Depot", address: "x".repeat(301) });
    expect(long.errors.address).toBe("Keep the address to 300 characters.");

    const many = validateClientLocation(
      { ...world(), clientLocations: Array.from({ length: 40 }, (_, i) => branch(`l${i}`, "c1", `Depot ${i}`)) },
      { clientId: "c1", name: "Depot 41" },
    );
    expect(many.errors.clientId).toBe("This customer already has 40 branches. Close one before adding another.");
  });

  it("keeps a closed branch, with its address, rather than deleting it", () => {
    const { errors, value } = validateClientLocation(world(), {
      clientId: "c1",
      name: "Tema depot",
      address: "Harbour Road",
      status: "closed",
    });
    expect(errors).toEqual({});
    expect(value.status).toBe("closed");
    // A closed branch is not what stops a new branch on the customer, but nothing is thrown away.
    expect(value.address).toBe("Harbour Road");
  });
});

describe("the agreement line on a customer's row (CLI-01)", () => {
  const contract = (overrides: Partial<Contract> = {}): Contract =>
    ({
      id: "ct1",
      reference: "CT-0001",
      clientId: "c1",
      clientName: "Northstar Foods",
      serviceType: "staff_transport",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "active",
      routeIds: [],
      weekdays: [],
      shiftIds: [],
      vehicleCategoryId: "",
      pricingModel: "",
      billingFrequency: "",
      paymentTerms: "",
      notes: "",
      createdBy: "u1",
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    }) as Contract;

  const today = "2026-10-26";

  it("says so plainly when there is no agreement", () => {
    expect(clientAgreementLine("c1", [], today)).toBe("no agreement on file");
  });

  it("names the agreement that is running, with the day it runs to", () => {
    expect(clientAgreementLine("c1", [contract()], today)).toBe("CT-0001 active to 2026-12-31");
  });

  it("calls an agreement that has run out expired rather than active", () => {
    expect(clientAgreementLine("c1", [contract({ endDate: "2026-06-30" })], today)).toBe("CT-0001 expired to 2026-06-30");
  });

  it("prefers the agreement in force over one that has ended", () => {
    const ended = contract({ id: "old", reference: "CT-0000", endDate: "2025-12-31" });
    const running = contract({ id: "now", reference: "CT-0002" });
    // Both orders give the same answer: the line never depends on which row came first.
    expect(clientAgreementLine("c1", [ended, running], today)).toBe("CT-0002 active to 2026-12-31");
    expect(clientAgreementLine("c1", [running, ended], today)).toBe("CT-0002 active to 2026-12-31");
  });

  it("says an agreement with no end date is open-ended", () => {
    expect(clientAgreementLine("c1", [contract({ endDate: null })], today)).toBe("CT-0001 active, open-ended");
  });

  it("shows another customer's agreement only when it belongs to them", () => {
    expect(clientAgreementLine("c2", [contract()], today)).toBe("no agreement on file");
  });
});
