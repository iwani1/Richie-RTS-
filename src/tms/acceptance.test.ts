// The customer's yes to a quotation (RNT-05, D-116).
//
// Three things have to be true for the record to be worth having: it says *which* quotation was
// accepted, it says *who* said yes and *how*, and it cannot be quietly extended to a different figure
// by a later requote, or overwritten by pressing the button twice.
import { describe, expect, it } from "vitest";
import { ACCEPTANCE_NOTE_LIMIT, acceptanceIsCurrent, acceptanceLine, acceptanceStateOf, buildAcceptance, canAcceptQuotation } from "./acceptance";
import { SCHEMA_VERSION, emptyDatabase, migrate, type Quote, type Rental, type RentalAcceptance } from "./types";

const AT = "2026-06-10T09:00:00.000Z";
const TODAY = "2026-06-10";

const quote = (overrides: Partial<Quote> = {}): Quote => ({
  currencyCode: "GHS",
  pricingBasis: "per_day",
  lines: [{ id: "l1", description: "Two days hire", quantity: 2, unitAmount: 2000 }],
  subtotal: 4000,
  depositPercent: 20,
  depositRequired: 800,
  validUntil: "2026-06-20",
  quotedAt: "2026-06-08T10:00:00.000Z",
  quotedBy: "Finance",
  number: "QUO-0001",
  revision: 1,
  terms: "The price holds until the validity date.",
  driverIncluded: false,
  ...overrides,
});

const acceptance = (overrides: Partial<RentalAcceptance> = {}): RentalAcceptance => ({
  at: "2026-06-09T11:00:00.000Z",
  byActorId: "u-client",
  byName: "Ama Boateng",
  channel: "client_portal",
  quotedAt: "2026-06-08T10:00:00.000Z",
  total: 4000,
  depositRequired: 800,
  currencyCode: "GHS",
  note: "",
  ...overrides,
});

const rental = (overrides: Partial<Rental> = {}): Rental => ({
  id: "r1",
  reference: "RR-0001",
  clientId: "c1",
  customerName: "Acme Ltd",
  customerPhone: "",
  customerEmail: "",
  purpose: "Staff shuttle",
  pickupLocation: "Accra",
  dropoffLocation: "Tema",
  startDate: "2026-06-15",
  endDate: "2026-06-16",
  passengers: 4,
  vehicleCategoryId: "cat",
  driverRequired: true,
  notes: "",
  status: "quoted",
  quote: quote(),
  quoteHistory: [],
  acceptance: null,
    run: null,
    plan: null,
  assignedVehicleId: null,
  assignedDriverId: null,
  deposit: null,
  finalInvoice: null,
  resolutionReason: null,
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

describe("recording a customer's acceptance", () => {
  it("can be accepted while the quotation is live and nobody has answered it", () => {
    expect(canAcceptQuotation(rental(), TODAY)).toEqual({});
    expect(acceptanceStateOf(rental(), TODAY)).toBe("none");
    expect(acceptanceLine(rental(), TODAY)).toBe("");
  });

  it("cannot be accepted before there is a quotation to accept", () => {
    const draft = rental({ status: "draft", quote: null });
    expect(canAcceptQuotation(draft, TODAY).status).toBe("No quotation has been issued yet, so there is nothing to accept.");
    expect(canAcceptQuotation(draft, TODAY).quote).toBe("There is no quotation on this rental to accept.");
    expect(acceptanceStateOf(draft, TODAY)).toBe("none");
  });

  it("cannot be accepted once the price has lapsed, and says the date", () => {
    const lapsed = rental({ quote: quote({ validUntil: "2026-06-01" }) });
    expect(canAcceptQuotation(lapsed, TODAY).quote).toBe("The quotation expired on 2026-06-01. Issue a new one before the customer accepts.");
    expect(acceptanceStateOf(lapsed, TODAY)).toBe("expired");
    expect(acceptanceLine(lapsed, TODAY)).toMatch(/validity date has passed, so it cannot be accepted/);
  });

  it("cannot be accepted twice on the same quotation, and names who said yes first", () => {
    const accepted = rental({ acceptance: acceptance() });
    expect(canAcceptQuotation(accepted, TODAY).acceptance).toBe("This quotation was already accepted on 2026-06-09 by Ama Boateng.");
    expect(acceptanceStateOf(accepted, TODAY)).toBe("current");
  });

  it("cannot be accepted on a rental already agreed, under way, or closed", () => {
    for (const status of ["confirmed", "completed", "declined", "cancelled"] as const) {
      expect(canAcceptQuotation(rental({ status }), TODAY).status).toBeTruthy();
    }
    expect(canAcceptQuotation(rental({ status: "dispatched" }), TODAY).status).toMatch(/already agreed and is under way/);
    // A hire the customer has already agreed to waits on the deposit, not on another yes (D-120).
    expect(canAcceptQuotation(rental({ status: "accepted" }), TODAY).acceptance).toMatch(/already agreed to this quotation/);
  });

  it("keeps a yes to the figure it was given to when the quotation is replaced", () => {
    // The office requoted after the customer agreed: the acceptance is on record, and it is stale.
    const requoted = rental({
      quote: quote({ quotedAt: "2026-06-12T09:00:00.000Z", subtotal: 4600, depositRequired: 920 }),
      quoteHistory: [quote()],
      acceptance: acceptance(),
    });
    expect(acceptanceIsCurrent(requoted)).toBe(false);
    expect(acceptanceStateOf(requoted, TODAY)).toBe("superseded");
    expect(acceptanceLine(requoted, TODAY)).toBe(
      "Ama Boateng accepted the quotation of GHS 4000.00 on 2026-06-09 (in the customer portal), but the quotation has been replaced since. The figure on record now is different.",
    );
    // And it can be accepted again — the customer has not agreed to the new figure yet.
    expect(canAcceptQuotation(requoted, TODAY)).toEqual({});
  });

  it("states who accepted and how, in one sentence the office can read out", () => {
    expect(acceptanceLine(rental({ acceptance: acceptance() }), TODAY)).toBe(
      "Ama Boateng accepted the quotation of GHS 4000.00 on 2026-06-09 (in the customer portal).",
    );
    expect(acceptanceLine(rental({ acceptance: acceptance({ channel: "office", byName: "Finance Officer" }) }), TODAY)).toBe(
      "Finance Officer accepted the quotation of GHS 4000.00 on 2026-06-09 (by phone, recorded by the office).",
    );
  });

  it("copies the quotation's own figures, so the record cannot be typed wrong", () => {
    const record = buildAcceptance(rental(), { actorId: "u1", name: "Ama Boateng", channel: "client_portal" }, "  Agreed on the phone  ", AT);
    expect(record).toEqual({
      at: AT,
      byActorId: "u1",
      byName: "Ama Boateng",
      channel: "client_portal",
      quotedAt: "2026-06-08T10:00:00.000Z",
      total: 4000,
      depositRequired: 800,
      currencyCode: "GHS",
      note: "Agreed on the phone",
    });
    // A yes is not a paragraph: the note is kept short rather than refused.
    const long = buildAcceptance(rental(), { actorId: null, name: "Finance", channel: "office" }, "x".repeat(500), AT);
    expect(long.note).toHaveLength(ACCEPTANCE_NOTE_LIMIT);
  });
});

describe("older records (schema 31)", () => {
  it("loads a rental written before acceptance existed with none, rather than an invented yes", () => {
    const old = { ...rental(), acceptance: undefined } as unknown as Rental;
    const migrated = migrate({ ...emptyDatabase(), schemaVersion: 30, rentals: [old] });
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated!.rentals[0].acceptance).toBeNull();
  });

  it("keeps an acceptance that is really there", () => {
    const migrated = migrate({ ...emptyDatabase(), schemaVersion: 31, rentals: [rental({ acceptance: acceptance() })] });
    expect(migrated!.rentals[0].acceptance?.byName).toBe("Ama Boateng");
  });

  it("drops a half-written acceptance rather than printing a name with no date", () => {
    const broken = { ...rental(), acceptance: { byName: "Ama" } } as unknown as Rental;
    expect(migrate({ ...emptyDatabase(), schemaVersion: 30, rentals: [broken] })!.rentals[0].acceptance).toBeNull();
  });
});
