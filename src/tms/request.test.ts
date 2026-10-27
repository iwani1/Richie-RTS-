import { describe, expect, it } from "vitest";
import {
  MAX_STOPS,
  PLAN_NOTE_LIMIT,
  planHasDetails,
  plannedMinutes,
  planLine,
  readRequestDetails,
  sourceLabel,
  stopsLine,
  tripContactLine,
} from "./request";
import { humanDuration, readClock } from "./time";
import { migrate, SCHEMA_VERSION, type Rental, type RentalPlan } from "./types";

const DATES = { startDate: "2026-06-15", endDate: "2026-06-16" };
const read = (input: Parameters<typeof readRequestDetails>[0], dates = DATES, existing: RentalPlan | null = null) =>
  readRequestDetails(input, dates, existing);

describe("reading a clock time", () => {
  it("takes one digit for the hour and stores the padded form", () => {
    expect(readClock("8:00")).toBe("08:00");
    expect(readClock("08:30")).toBe("08:30");
    expect(readClock(" 17:05 ")).toBe("17:05");
    expect(readClock("0:00")).toBe("00:00");
    expect(readClock("23:59")).toBe("23:59");
  });

  it("refuses anything that is not a time rather than guessing", () => {
    expect(readClock("8")).toBeNull();
    expect(readClock("8.00")).toBeNull();
    expect(readClock("8h00")).toBeNull();
    expect(readClock("24:00")).toBeNull();
    expect(readClock("12:60")).toBeNull();
    expect(readClock("noon")).toBeNull();
  });

  it("says how long something took in the unit a person would use", () => {
    expect(humanDuration(45)).toBe("45 minutes");
    expect(humanDuration(1)).toBe("1 minute");
    expect(humanDuration(60)).toBe("1 hour");
    expect(humanDuration(570)).toBe("9 h 30 min");
    expect(humanDuration(2 * 1440)).toBe("2 days");
    expect(humanDuration(3 * 1440 + 60)).toBe("3 days 1 h");
    expect(humanDuration(-5)).toBeNull();
    expect(humanDuration(Number.NaN)).toBeNull();
  });
});

describe("reading the journey a customer asked for (RNT-01)", () => {
  it("records nothing when nobody wrote anything", () => {
    const { errors, plan } = read({});
    expect(errors).toEqual({});
    expect(plan).toEqual({
      departureTime: "",
      returnTime: "",
      stops: [],
      luggage: "",
      specialNeeds: "",
      tripContactName: "",
      tripContactPhone: "",
      source: "",
    });
    expect(planHasDetails(plan)).toBe(false);
  });

  it("stores a typed time in the form the record keeps", () => {
    const { errors, plan } = read({ departureTime: "7:30", returnTime: "18:00" });
    expect(errors).toEqual({});
    expect(plan.departureTime).toBe("07:30");
    expect(plan.returnTime).toBe("18:00");
    expect(planHasDetails(plan)).toBe(true);
  });

  it("refuses a time it cannot read, and makes the field blank rather than half-typed", () => {
    const { errors, plan } = read({ departureTime: "half seven" });
    expect(errors.departureTime).toBe("Enter the time as HH:MM, for example 08:30.");
    expect(plan.departureTime).toBe("");
  });

  it("refuses a one-day hire that comes back before it leaves", () => {
    const { errors, plan } = read({ departureTime: "17:00", returnTime: "08:00" }, { startDate: "2026-06-15", endDate: "2026-06-15" });
    expect(errors.returnTime).toBe("On a one-day hire the vehicle cannot be back before it leaves. Change the return time, or the end date.");
    // Not swapped behind the office's back: the two times stay as typed.
    expect(plan).toMatchObject({ departureTime: "17:00", returnTime: "08:00" });
  });

  it("allows a return at any hour when the hire ends on a later day", () => {
    const { errors } = read({ departureTime: "17:00", returnTime: "08:00" }, { startDate: "2026-06-15", endDate: "2026-06-16" });
    expect(errors).toEqual({});
  });

  it("keeps the stops in the order the vehicle calls, one per line", () => {
    const { errors, plan } = read({ stops: "Achimota\n  Nsawam  \n\n- Suhum" });
    expect(errors).toEqual({});
    expect(plan.stops).toEqual(["Achimota", "Nsawam", "Suhum"]);
  });

  it(`refuses more than ${MAX_STOPS} stops, and says where the rest goes`, () => {
    const many = Array.from({ length: MAX_STOPS + 1 }, (_, i) => `Stop ${i + 1}`).join("\n");
    const { errors, plan } = read({ stops: many });
    expect(errors.stops).toBe(`Keep the stops to ${MAX_STOPS} or fewer. Put the rest of the day in the notes.`);
    expect(plan.stops).toHaveLength(MAX_STOPS + 1);
  });

  it("refuses a stop, a luggage note or a special need that is too long", () => {
    expect(read({ stops: "x".repeat(121) }).errors.stops).toBe("Keep each stop to 120 characters.");
    expect(read({ luggage: "x".repeat(PLAN_NOTE_LIMIT + 1) }).errors.luggage).toBe(`Keep the luggage note to ${PLAN_NOTE_LIMIT} characters.`);
    expect(read({ specialNeeds: "x".repeat(PLAN_NOTE_LIMIT + 1) }).errors.specialNeeds).toBe(`Keep the special needs note to ${PLAN_NOTE_LIMIT} characters.`);
  });

  it("wants a name beside a number, because nobody knows who to ask for otherwise", () => {
    expect(read({ tripContactPhone: "024 000 0000" }).errors.tripContactName).toBe("Say whose number this is, so the office knows who to ask for.");
    const named = read({ tripContactName: "Ama Mensah", tripContactPhone: "024 000 0000" });
    expect(named.errors).toEqual({});
    expect(named.plan).toMatchObject({ tripContactName: "Ama Mensah", tripContactPhone: "024 000 0000" });
  });

  it("refuses a number too short or too long to ring", () => {
    expect(read({ tripContactName: "Ama", tripContactPhone: "024" }).errors.tripContactPhone).toBe("Enter a phone number the office can ring on the day.");
    expect(read({ tripContactName: "Ama", tripContactPhone: "1".repeat(21) }).errors.tripContactPhone).toBe("Enter a phone number the office can ring on the day.");
    // A name on its own is fine: "ask for the gate man" is how some customers describe it.
    expect(read({ tripContactName: "Ama" }).errors).toEqual({});
  });

  it("records where the request came from, and refuses a channel it does not know", () => {
    expect(read({ source: "phone" }).plan.source).toBe("phone");
    expect(read({ source: "" }).plan.source).toBe("");
    expect(read({ source: "carrier pigeon" }).errors.source).toBe("Choose where the request came from.");
  });

  it("keeps what a correction leaves out of the form", () => {
    const existing: RentalPlan = {
      departureTime: "08:00",
      returnTime: "",
      stops: ["Achimota"],
      luggage: "Twelve suitcases",
      specialNeeds: "",
      tripContactName: "Ama",
      tripContactPhone: "",
      source: "phone",
    };
    // The office corrects the purpose, and the form does not send the journey at all.
    const kept = read({}, DATES, existing);
    expect(kept.errors).toEqual({});
    expect(kept.plan).toEqual(existing);
    // A field that is sent replaces what was there; the rest still survives.
    const changed = read({ luggage: "", stops: "Nsawam" }, DATES, existing);
    expect(changed.plan).toMatchObject({ departureTime: "08:00", stops: ["Nsawam"], luggage: "", specialNeeds: "" });
  });
});

describe("what a request's journey says on screen (RNT-01)", () => {
  const rental = (plan: RentalPlan | null, startDate = "2026-06-15", endDate = "2026-06-16"): Rental =>
    ({ plan, startDate, endDate }) as Rental;

  const plan = (overrides: Partial<RentalPlan> = {}): RentalPlan => ({
    departureTime: "",
    returnTime: "",
    stops: [],
    luggage: "",
    specialNeeds: "",
    tripContactName: "",
    tripContactPhone: "",
    source: "",
    ...overrides,
  });

  it("counts the time asked for from the two clock times", () => {
    expect(plannedMinutes(rental(plan({ departureTime: "08:00", returnTime: "17:30" }), "2026-06-15", "2026-06-15"))).toBe(570);
    expect(plannedMinutes(rental(plan({ departureTime: "08:00", returnTime: "17:30" })))).toBe(2010);
    expect(plannedMinutes(rental(plan({ departureTime: "08:00" })))).toBeNull();
    expect(plannedMinutes(rental(null))).toBeNull();
  });

  it("says when it leaves and comes back, and how long that is", () => {
    expect(planLine(rental(plan({ departureTime: "08:00", returnTime: "17:30" }), "2026-06-15", "2026-06-15"))).toBe(
      "Leaves at 08:00 and back at 17:30 on 15 Jun — 9 h 30 min.",
    );
    expect(planLine(rental(plan({ departureTime: "08:00", returnTime: "17:30" })))).toBe(
      "Leaves at 08:00 on 15 Jun and back at 17:30 on 16 Jun — 33 h 30 min.",
    );
  });

  it("says which half of the day is missing rather than inventing the other", () => {
    expect(planLine(rental(plan({ departureTime: "08:00" })))).toBe("Leaves at 08:00 on 15 Jun; no return time was recorded.");
    expect(planLine(rental(plan({ returnTime: "17:30" })))).toBe("Back at 17:30 on 16 Jun; no departure time was recorded.");
    expect(planLine(rental(plan()))).toBe("No departure or return time was recorded for this request.");
  });

  it("says plainly when the request predates the journey fields", () => {
    expect(planLine(rental(null))).toBe(
      "This request was written before the journey details were recorded, so its times, stops and origin are unknown.",
    );
    expect(stopsLine(rental(null))).toBe("No intermediate stops were recorded.");
    expect(tripContactLine(rental(null))).toBe("Nobody else was named for the day: the office rings the customer's own number.");
  });

  it("lists the stops in order, and says when there are none", () => {
    expect(stopsLine(rental(plan({ stops: ["Achimota", "Nsawam"] })))).toBe("Calls at Achimota, then Nsawam.");
    expect(stopsLine(rental(plan()))).toBe("No intermediate stops were recorded.");
  });

  it("names who to ring on the day", () => {
    expect(tripContactLine(rental(plan({ tripContactName: "Ama Mensah", tripContactPhone: "024 000 0000" })))).toBe("On the day, ring Ama Mensah on 024 000 0000.");
    expect(tripContactLine(rental(plan({ tripContactPhone: "024 000 0000" })))).toBe("On the day, ring 024 000 0000.");
    expect(tripContactLine(rental(plan({ tripContactName: "Ama Mensah" })))).toBe("On the day, ask for Ama Mensah.");
  });

  it("has a word for where the request came from, including nowhere recorded", () => {
    expect(sourceLabel("phone")).toBe("Phone call");
    expect(sourceLabel("walk_in")).toBe("Walk-in at the desk");
    expect(sourceLabel("")).toBe("not recorded");
  });
});

describe("a backup written before the journey was recorded (schema 34)", () => {
  const stored = (rental: Record<string, unknown>) => ({
    schemaVersion: 33,
    users: [{ id: "u1", fullName: "Ada", email: "ada@example.test", role: "administrator", active: true, passwordHash: "x", passwordSalt: "y", driverId: null, clientId: null, passengerId: null, primaryContact: false, createdAt: "2026-01-01T00:00:00.000Z" }],
    vehicles: [],
    drivers: [],
    clients: [],
    audit: [],
    settings: {},
    rentals: [rental],
    invoices: [],
    payments: [],
  });

  const base = {
    id: "r1",
    reference: "RR-0001",
    clientId: null,
    customerName: "Acme Ltd",
    customerPhone: "",
    customerEmail: "",
    purpose: "",
    pickupLocation: "Accra",
    dropoffLocation: "Tema",
    startDate: "2026-06-15",
    endDate: "2026-06-16",
    passengers: 4,
    vehicleCategoryId: "cat",
    driverRequired: false,
    notes: "",
    status: "draft",
    quote: null,
    quoteHistory: [],
    acceptance: null,
    run: null,
    assignedVehicleId: null,
    assignedDriverId: null,
    deposit: null,
    finalInvoice: null,
    resolutionReason: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  it("loads it with no plan at all, rather than a plan full of blanks", () => {
    const migrated = migrate(stored(base));
    expect(migrated).not.toBeNull();
    expect(migrated!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated!.rentals[0].plan).toBeNull();
  });

  it("fills in a half-written plan field by field", () => {
    const migrated = migrate(stored({ ...base, plan: { departureTime: "07:15", stops: ["Koforidua", 7], source: "carrier pigeon" } }));
    expect(migrated!.rentals[0].plan).toEqual({
      departureTime: "07:15",
      returnTime: "",
      stops: ["Koforidua"],
      luggage: "",
      specialNeeds: "",
      tripContactName: "",
      tripContactPhone: "",
      source: "",
    });
  });

  it("keeps a complete plan exactly as it was written", () => {
    const plan: RentalPlan = {
      departureTime: "07:15",
      returnTime: "18:45",
      stops: ["Koforidua"],
      luggage: "Two boxes",
      specialNeeds: "Wheelchair ramp",
      tripContactName: "Ama",
      tripContactPhone: "024 000 0000",
      source: "whatsapp",
    };
    expect(migrate(stored({ ...base, plan }))!.rentals[0].plan).toEqual(plan);
  });
});
