// DSP-04, D-105: a run that is late, said out loud while it is happening.
//
// The stop times measure lateness after the fact; these are the rules for the different fact — what
// the office knows at 07:20, and who it is allowed to believe.
import { describe, expect, it } from "vitest";
import { DELAY_LIMITS, delayLine, delayNote, delaySummary, latestDelay, liveDelay, minutesLabel, readDelayInput, runningLate } from "./delays";
import { SCHEMA_VERSION, emptyDatabase, migrate, type Trip, type TripDelay } from "./types";

const at = "2026-06-01T07:20:00.000Z";

const delay = (minutes: number, reason = "Traffic at the Spintex junction"): TripDelay => ({
  id: `dl-${minutes}-${reason.length}`,
  at,
  minutes,
  reason,
  reportedBy: "Kojo Mensah",
});

const trip = (overrides: Partial<Trip> = {}): Trip =>
  ({
    id: "t1",
    reference: "TR-0001",
    routeId: "r1",
    serviceDate: "2026-06-01",
    status: "in_progress",
    origin: "schedule",
    originReason: null,
    vehicleId: "v1",
    driverId: "d1",
    dispatchedAt: at,
    startedAt: at,
    completedAt: null,
    cancelReason: null,
    cancelledAt: null,
    cancelledBy: null,
    incidentId: null,
    stopLogs: [],
    boardings: [],
    onTimeThresholdMinutes: 5,
    corrections: [],
    delays: [],
    rosterChanges: [],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }) as Trip;

describe("what counts as a usable delay report", () => {
  it("takes whole minutes and the reason, trimmed", () => {
    const read = readDelayInput({ minutes: " 20 ", reason: "  Traffic at the junction  " });
    expect(read.errors).toEqual({});
    expect(read.value).toBe(20);
    expect(read.reason).toBe("Traffic at the junction");
  });

  it("refuses an empty number rather than reading it as zero", () => {
    const read = readDelayInput({ minutes: "", reason: "Traffic" });
    expect(read.value).toBe(null);
    expect(read.errors.minutes).toMatch(/how many minutes/i);
  });

  it("refuses decimals and words", () => {
    expect(readDelayInput({ minutes: "12.5", reason: "Traffic" }).errors.minutes).toMatch(/whole minutes/i);
    expect(readDelayInput({ minutes: "twenty", reason: "Traffic" }).errors.minutes).toMatch(/whole minutes/i);
    expect(readDelayInput({ minutes: "-5", reason: "Traffic" }).errors.minutes).toMatch(/whole minutes/i);
  });

  it("refuses a delay longer than the ceiling, and says what to do instead", () => {
    const read = readDelayInput({ minutes: String(DELAY_LIMITS.maxMinutes + 1), reason: "Traffic" });
    expect(read.errors.minutes).toMatch(/cancel the run/i);
  });

  it("refuses '0' on a run nobody has reported late, and allows it once one has", () => {
    expect(readDelayInput({ minutes: "0", reason: "The road reopened" }).errors.minutes).toMatch(/back on time/i);
    const clearing = readDelayInput({ minutes: "0", reason: "The road reopened" }, true);
    expect(clearing.errors).toEqual({});
    expect(clearing.value).toBe(0);
  });

  it("requires a reason, and keeps it to a sentence", () => {
    expect(readDelayInput({ minutes: "20", reason: "   " }).errors.reason).toMatch(/what is holding the run up/i);
    const tooLong = readDelayInput({ minutes: "20", reason: "x".repeat(DELAY_LIMITS.reason + 1) });
    expect(tooLong.errors.reason).toMatch(new RegExp(String(DELAY_LIMITS.reason)));
  });

  it("reports every problem at once, so the form does not drip-feed them", () => {
    const read = readDelayInput({ minutes: "", reason: "" });
    expect(Object.keys(read.errors).sort()).toEqual(["minutes", "reason"]);
  });
});

describe("how a delay reads", () => {
  it("counts minutes in words, because '20 min' is read as a code", () => {
    expect(minutesLabel(0)).toBe("on time");
    expect(minutesLabel(1)).toBe("1 minute");
    expect(minutesLabel(20)).toBe("20 minutes");
    expect(minutesLabel(60)).toBe("1 hour");
    expect(minutesLabel(90)).toBe("1 hour 30 minutes");
    expect(minutesLabel(121)).toBe("2 hours 1 minute");
  });

  it("says who is late and why in one line", () => {
    expect(delayLine(delay(20))).toBe("20 minutes late — Traffic at the Spintex junction");
    expect(delayLine(delay(0, "The road reopened"))).toBe("back on time — The road reopened");
  });

  it("writes a full sentence for a client or a rider, who reads it on its own", () => {
    expect(delayNote(delay(20))).toBe(
      "This run is reported 20 minutes behind its timetable — Traffic at the Spintex junction.",
    );
    expect(delayNote(delay(0, "The road reopened"))).toBe(
      "A delay was reported on this run and has since cleared: The road reopened.",
    );
  });

  it("counts how many times the answer moved, because the first one was not the last", () => {
    expect(delaySummary(trip())).toBe("");
    expect(delaySummary(trip({ delays: [delay(20)] }))).toBe("20 minutes late — Traffic at the Spintex junction");
    expect(delaySummary(trip({ delays: [delay(20), delay(35, "One lane closed")] }))).toBe(
      "35 minutes late — One lane closed (2 reports)",
    );
  });
});

describe("which delay is the run under now", () => {
  it("is the most recent statement, not the first or the worst", () => {
    const subject = trip({ delays: [delay(40), delay(15, "Clearing")] });
    expect(liveDelay(subject)?.minutes).toBe(15);
    expect(latestDelay(subject)?.minutes).toBe(15);
  });

  it("is nothing once a later report says the run caught up", () => {
    expect(liveDelay(trip({ delays: [delay(20), delay(0, "The road reopened")] }))).toBe(null);
    // The history is still there: the run was late, and the client may ask why.
    expect(latestDelay(trip({ delays: [delay(20), delay(0, "The road reopened")] }))?.minutes).toBe(0);
  });

  it("is nothing on a run that has not left, or one that has finished", () => {
    expect(liveDelay(trip({ status: "planned", delays: [delay(20)] }))).toBe(null);
    expect(liveDelay(trip({ status: "dispatched", delays: [delay(20)] }))?.minutes).toBe(20);
    // A finished run is not late *now*: its lateness is in its stop times, which the report measures.
    expect(liveDelay(trip({ status: "completed", completedAt: at, delays: [delay(20)] }))).toBe(null);
    expect(liveDelay(trip({ status: "cancelled", delays: [delay(20)] }))).toBe(null);
  });

  it("lists the runs a supervisor has to answer for", () => {
    const late = trip({ id: "a", reference: "TR-0001", delays: [delay(20)] });
    const cleared = trip({ id: "b", reference: "TR-0002", delays: [delay(9), delay(0, "Cleared")] });
    const untouched = trip({ id: "c", reference: "TR-0003" });
    expect(runningLate([late, cleared, untouched]).map((t) => t.reference)).toEqual(["TR-0001"]);
  });
});

describe("a run written before delays existed", () => {
  it("gains an empty history rather than a broken record", () => {
    const old = { ...trip(), delays: undefined } as unknown as Trip;
    const migrated = migrate({ ...emptyDatabase(), schemaVersion: 25, trips: [old] });
    expect(migrated?.trips[0].delays).toEqual([]);
    expect(migrated?.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
