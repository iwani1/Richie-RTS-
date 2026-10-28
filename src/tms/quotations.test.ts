// A quotation as a document (RNT-04, D-117).
//
// The rules proven here are the ones a customer and a dispute turn on: how long a price holds, to the
// minute; what a quotation is called; and that nothing about the terms is invented by this build.
import { describe, expect, it } from "vitest";
import {
  approvalIsCurrent,
  approvalLine,
  approvalProblem,
  approvalRequiredAt,
  QUOTATION_TERMS_LIMIT,
  quotationIsApproved,
  readQuoteFigures,
  type QuoteFigureInput,
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
  discountAmount: 0,
  discountReason: "",
  taxLines: [],
  total: 4000,
  depositPercent: 25,
  depositRequired: 1000,
  validUntil: "2026-06-15T09:00:00.000Z",
  quotedAt: "2026-06-08T09:00:00.000Z",
  quotedBy: "Finance",
  quotedById: "",
  approval: null,
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
        rental: { pricingBasis: "per_day", depositPercent: 20, quotationValidityDays: 7, driversAlwaysIncluded: null, paymentMethods: ["Cash"], requotePolicy: null, quotationApprovalAbove: null },
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
        discountAmount: 0,
        discountReason: "",
        taxLines: [],
        total: 2000,
        depositPercent: 20,
        depositRequired: 400,
        validUntil: "2026-06-15",
        quotedAt: "2026-06-08T10:00:00.000Z",
        quotedBy: "Finance",
        quotedById: "",
        approval: null,
      },
      quoteHistory: [],
      acceptance: null,
    run: null,
    plan: null,
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

describe("the figures under the lines (RNT-04, D-121)", () => {
  const figures = (overrides: Partial<QuoteFigureInput> = {}) =>
    readQuoteFigures({
      subtotal: 3000,
      discountAmount: "",
      discountReason: "",
      taxPosition: "not_registered",
      taxLines: [],
      depositPercent: 25,
      ...overrides,
    });

  it("adds nothing the company has not stated", () => {
    const { errors, figures: out } = figures();
    expect(errors).toEqual({});
    expect(out).toEqual({ discountAmount: 0, taxLines: [], total: 3000, depositRequired: 750 });
  });

  it("takes the reduction off the lines before charging tax on what is left", () => {
    const { errors, figures: out } = figures({
      discountAmount: "500",
      discountReason: "Repeat customer",
      taxPosition: "registered",
      taxLines: [{ name: "VAT", ratePercent: 15 }],
    });
    expect(errors).toEqual({});
    expect(out.discountAmount).toBe(500);
    // 2,500 at 15% is 375, so the customer pays 2,875 and the deposit is 25% of that, not of 3,000.
    expect(out.taxLines).toEqual([{ name: "VAT", ratePercent: 15, amount: 375 }]);
    expect(out.total).toBe(2875);
    expect(out.depositRequired).toBe(718.75);
  });

  it("pays a half-pesewa tie up, not down", () => {
    // 15% of 15.90 is 2.385 → 2.39; the total is 18.29 and 25% of that is 4.57 (4.5725 rounded).
    const { figures: out } = figures({ subtotal: 15.9, taxPosition: "registered", taxLines: [{ name: "VAT", ratePercent: 15 }] });
    expect(out.taxLines[0].amount).toBe(2.39);
    expect(out.total).toBe(18.29);
    expect(out.depositRequired).toBe(4.57);
  });

  it("refuses a reduction with no reason, and one bigger than the price", () => {
    expect(figures({ discountAmount: "100" }).errors.discountReason).toBe("Give a reason for the discount.");
    const tooBig = figures({ discountAmount: "3100", discountReason: "Goodwill" });
    expect(tooBig.errors.discountAmount).toBe("The discount is larger than the price, so the total would be negative.");
    // A discount exactly equal to the price is a free hire: the total is nought, not negative.
    const free = figures({ discountAmount: "3000", discountReason: "Goodwill" });
    expect(free.errors).toEqual({});
    expect(free.figures.total).toBe(0);
    expect(free.figures.depositRequired).toBe(0);
  });

  it("reads the discount as decimal text, exactly", () => {
    expect(figures({ discountAmount: "0.005", discountReason: "x" }).errors.discountAmount).toBe("Use at most two decimal places: amounts are in pesewas.");
    expect(figures({ discountAmount: "-50", discountReason: "x" }).errors.discountAmount).toBe("Enter the discount as an amount of 0 or more, or leave it blank.");
    expect(figures({ discountAmount: "lots", discountReason: "x" }).errors.discountAmount).toBe("Enter the discount as an amount of 0 or more, or leave it blank.");
  });

  it("charges no tax when the company is not registered, whatever the rate list says", () => {
    const { figures: out } = figures({ taxPosition: "not_registered", taxLines: [{ name: "VAT", ratePercent: 15 }] });
    expect(out.taxLines).toEqual([]);
    expect(out.total).toBe(3000);
  });

  it("charges no tax when nobody has stated the position at all", () => {
    const { figures: out } = figures({ taxPosition: null, taxLines: [{ name: "VAT", ratePercent: 15 }] });
    expect(out.taxLines).toEqual([]);
    expect(out.total).toBe(3000);
  });

  it("keeps several levies apart and adds each to the total", () => {
    const { figures: out } = figures({
      taxPosition: "registered",
      taxLines: [
        { name: "VAT", ratePercent: 15 },
        { name: "NHIL", ratePercent: 2.5 },
      ],
    });
    expect(out.taxLines.map((line) => line.amount)).toEqual([450, 75]);
    expect(out.total).toBe(3525);
  });
});

describe("the second signature on a price (RNT-04, D-121)", () => {
  const approved = (overrides: Partial<Quote> = {}): Quote => ({
    ...quote(),
    approval: { at: "2026-06-09T09:00:00.000Z", byActorId: "u2", byName: "Ops", note: "", total: 4000 },
    ...overrides,
  });

  it("asks for a signature only at or above the figure the company set", () => {
    expect(approvalRequiredAt(4000, 5000)).toBe(false);
    expect(approvalRequiredAt(5000, 5000)).toBe(true);
    expect(approvalRequiredAt(5000.01, 5000)).toBe(true);
    // No figure set means nobody has asked: the program does not invent a policy.
    expect(approvalRequiredAt(1_000_000, null)).toBe(false);
  });

  it("does not let the author sign their own price off", () => {
    const mine = quote({ quotedById: "u1", quotedBy: "Finance" });
    expect(approvalProblem(mine, "u1", "Finance")).toBe(
      "The person who wrote this quotation cannot also approve it. Somebody else has to sign it off.",
    );
    expect(approvalProblem(mine, "u2", "Ops")).toBeNull();
  });

  it("falls back to the name for a quotation written before the author's account was recorded", () => {
    const old = quote({ quotedById: "", quotedBy: "Finance" });
    expect(approvalProblem(old, "u9", "Finance")).toMatch(/cannot also approve it/);
    expect(approvalProblem(old, "u9", "Ops")).toBeNull();
  });

  it("refuses a second signature on the same figure, and names the first", () => {
    expect(approvalProblem(approved(), "u9", "Admin")).toBe("This quotation was already approved by Ops on 2026-06-09.");
    expect(quotationIsApproved(approved())).toBe(true);
    expect(approvalIsCurrent(approved())).toBe(true);
  });

  it("says when a signature belongs to a different figure", () => {
    const renewed = approved({ total: 4600 });
    expect(approvalIsCurrent(renewed)).toBe(false);
    expect(approvalLine(renewed, 5000)).toMatch(/was for GHS 4000\.00, which is not the figure on this revision/);
    // …and it may be given again, by somebody other than the author.
    expect(approvalProblem(renewed, "u9", "Admin")).toBeNull();
  });

  it("prints whether a signature is needed, given, or not asked for at all", () => {
    expect(approvalLine(quote(), null)).toBe("No approval is required: the company has not set a figure that needs one.");
    expect(approvalLine(quote(), 5000)).toBeNull();
    expect(approvalLine({ ...quote(), total: 6000 }, 5000)).toBe("A second signature is required: this price is at or above GHS 5000.00.");
    expect(approvalLine(approved({ approval: { at: "2026-06-09T09:00:00.000Z", byActorId: "u2", byName: "Ops", note: "Checked the rate.", total: 4000 } }), 5000)).toBe(
      'Approved by Ops on 2026-06-09. "Checked the rate."',
    );
  });
});

describe("a quotation written before the figures existed (schema 36)", () => {
  it("keeps what it said: its total is its subtotal, and nobody is named as its author", () => {
    const legacy = { ...quote(), discountAmount: undefined, discountReason: undefined, taxLines: undefined, total: undefined, quotedById: undefined, approval: undefined };
    const base = {
      schemaVersion: 35,
      users: [],
      vehicles: [],
      drivers: [],
      clients: [],
      audit: [],
      settings: {},
      invoices: [],
      payments: [],
    };
    const rental = {
      id: "r1",
      reference: "RR-0001",
      clientId: null,
      customerName: "Acme Ltd",
      customerPhone: "",
      customerEmail: "",
      purpose: "",
      pickupLocation: "Accra",
      dropoffLocation: "Tema",
      startDate: "2026-06-10",
      endDate: "2026-06-11",
      passengers: 4,
      vehicleCategoryId: "cat",
      driverRequired: false,
      notes: "",
      status: "quoted",
      quote: legacy,
      quoteHistory: [],
      acceptance: null,
      run: null,
      plan: null,
      assignedVehicleId: null,
      assignedDriverId: null,
      deposit: null,
      finalInvoice: null,
      resolutionReason: null,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z",
    };
    const migrated = migrate({ ...base, schemaVersion: 35, rentals: [rental] })!;
    const stored = migrated.rentals[0].quote!;
    expect(stored.subtotal).toBe(4000);
    expect(stored.total).toBe(4000);
    expect(stored.discountAmount).toBe(0);
    expect(stored.taxLines).toEqual([]);
    expect(stored.quotedById).toBe("");
    expect(stored.approval).toBeNull();
    expect(SCHEMA_VERSION).toBe(36);
  });
});
