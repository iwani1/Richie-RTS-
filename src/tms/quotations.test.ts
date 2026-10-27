// A quotation as a document (RNT-04, D-117).
//
// The rules proven here are the ones a customer and a dispute turn on: how long a price holds, to the
// minute; what a quotation is called; and that nothing about the terms is invented by this build.
import { describe, expect, it } from "vitest";
import {
  QUOTATION_TERMS_LIMIT,
  quotationHeading,
  quotationIsLive,
  quotationIsNumbered,
  termsProblem,
  validityEndsAt,
  validityLine,
  validityProblem,
} from "./quotations";
import { emptyDatabase, migrate, SCHEMA_VERSION, type Quote } from "./types";

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  currencyCode: "GHS",
  pricingBasis: "per_day",
  lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 2000 }],
  subtotal: 4000,
  depositPercent: 25,
  depositRequired: 1000,
  validUntil: "2026-06-15T09:00:00.000Z",
  quotedAt: "2026-06-08T09:00:00.000Z",
  quotedBy: "Finance",
  number: "QUO-0001",
  revision: 1,
  terms: "Prices are firm for the validity period.",
  driverIncluded: true,
  ...overrides,
});

describe("how long a price holds (RNT-04, D-117)", () => {
  it("counts from the minute it was issued, not from the end of a day", () => {
    expect(validityEndsAt("2026-06-08T16:50:00.000Z", 168)).toBe("2026-06-15T16:50:00.000Z");
    // A quote issued in the morning and one issued the same afternoon run out at different times; the
    // old whole-day rule could not say which.
    expect(validityEndsAt("2026-06-08T09:10:00.000Z", 168)).toBe("2026-06-15T09:10:00.000Z");
  });

  it("is live right up to the moment, and not one minute after", () => {
    const live = quote();
    expect(quotationIsLive(live, "2026-06-15T08:59:00.000Z")).toBe(true);
    expect(quotationIsLive(live, "2026-06-15T09:00:00.000Z")).toBe(true);
    expect(quotationIsLive(live, "2026-06-15T09:01:00.000Z")).toBe(false);
  });

  it("says how long it has left, in the largest unit that is honest", () => {
    const q = quote();
    expect(validityLine(q.validUntil, "2026-06-08T09:00:00.000Z")).toBe("Holds for 7 more days.");
    expect(validityLine(q.validUntil, "2026-06-14T12:00:00.000Z")).toBe("Holds for 21 more hours.");
    expect(validityLine(q.validUntil, "2026-06-15T08:30:00.000Z")).toBe("Holds for 30 more minutes.");
    expect(validityLine(q.validUntil, "2026-06-15T09:30:00.000Z")).toBe("This quotation has expired.");
  });

  it("never prints zero hours or a negative count beside a price", () => {
    const q = quote();
    // Ten seconds left is still one minute, not "0 more minutes".
    expect(validityLine(q.validUntil, "2026-06-15T08:59:50.000Z")).toBe("Holds for 1 more minute.");
    expect(validityLine(q.validUntil, "2026-06-16T09:00:00.000Z")).toBe("This quotation has expired.");
  });

  it("says what is wrong with a period somebody typed", () => {
    expect(validityProblem(null)).toMatch(/not set/);
    expect(validityProblem(23)).toMatch(/24 to 8760/);
    expect(validityProblem(8761)).toMatch(/24 to 8760/);
    expect(validityProblem(24.5)).toMatch(/whole number of hours/);
    expect(validityProblem(168)).toBeNull();
  });
});

describe("the number on the sheet (RNT-04, D-117)", () => {
  it("names the document and which version of it", () => {
    expect(quotationHeading(quote())).toBe("QUO-0001 (revision 1)");
    expect(quotationHeading(quote({ number: "QUO-0012", revision: 3 }))).toBe("QUO-0012 (revision 3)");
  });

  it("knows a quotation written before numbering existed, and does not invent a number for it", () => {
    expect(quotationIsNumbered(quote())).toBe(true);
    expect(quotationIsNumbered(quote({ number: "" }))).toBe(false);
  });
});

describe("the terms are the company's own words (RNT-04, D-117)", () => {
  it("refuses to issue a quotation nobody wrote conditions for", () => {
    expect(termsProblem("")).toMatch(/Quotation terms are not set/);
    expect(termsProblem("   \n  ")).toMatch(/Quotation terms are not set/);
    expect(termsProblem("x".repeat(QUOTATION_TERMS_LIMIT + 1))).toMatch(/too long/);
    expect(termsProblem("Prices are firm for the validity period.")).toBeNull();
  });
});

describe("older backups (schema 32)", () => {
  it("turns a validity kept in days into the same period in hours", () => {
    const legacy = {
      ...emptyDatabase(),
      schemaVersion: 31,
      settings: {
        ...emptyDatabase().settings,
        rental: { pricingBasis: "per_day", depositPercent: 20, quotationValidityDays: 7, driversAlwaysIncluded: null, paymentMethods: ["Cash"], requotePolicy: null },
      },
    };
    const migrated = migrate(legacy)!;
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    // Seven days is the same promise of time, not a rewritten one.
    expect(migrated.settings.rental.quotationValidityHours).toBe(168);
    // And no terms appeared from nowhere.
    expect(migrated.settings.rental.quotationTerms).toBe("");
  });

  it("keeps an old quotation's figures and marks it as having no document behind it", () => {
    const base = emptyDatabase();
    const legacyRental = {
      id: "r1",
      reference: "RR-0001",
      clientId: null,
      customerName: "Acme Ltd",
      customerPhone: "",
      customerEmail: "",
      purpose: "Shuttle",
      pickupLocation: "Accra",
      dropoffLocation: "Tema",
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      passengers: 10,
      vehicleCategoryId: "c1",
      driverRequired: true,
      notes: "",
      status: "quoted",
      quote: {
        currencyCode: "GHS",
        pricingBasis: "per_day",
        lines: [{ id: "l1", description: "Hire", quantity: 2, unitAmount: 1000 }],
        subtotal: 2000,
        depositPercent: 20,
        depositRequired: 400,
        validUntil: "2026-06-15",
        quotedAt: "2026-06-08T10:00:00.000Z",
        quotedBy: "Finance",
      },
      quoteHistory: [],
      acceptance: null,
    run: null,
      assignedVehicleId: null,
      assignedDriverId: null,
      deposit: null,
      finalInvoice: null,
      resolutionReason: null,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z",
    };
    const migrated = migrate({ ...base, schemaVersion: 31, rentals: [legacyRental] })!;
    const rental = migrated.rentals[0];
    expect(rental.quote?.subtotal).toBe(2000);
    expect(rental.quote?.number).toBe("");
    expect(rental.quote?.revision).toBe(1);
    expect(quotationIsNumbered(rental.quote!)).toBe(false);
    expect(rental.quote?.terms).toBe("");
    // The request said a driver was required; the quotation written before the field existed takes it.
    expect(rental.quote?.driverIncluded).toBe(false);
  });
});
