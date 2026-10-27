// Reminders for the papers that run out (FLT-03, D-110).
//
// The rules under test are the ones that decide whether a reminder is worth having: is it due because
// of the date rather than because somebody said so, does an acknowledgement lapse when the paper is
// renewed, and can a paper be taken on that nobody has to think about yet.
import { describe, expect, it } from "vitest";
import { dueReminders, reminderCounts, reminderFor, reminderLine, reminderTiming } from "./documentReminders";
import { emptyDatabase, type ComplianceDocument, type Database, type DocumentReminder } from "./types";

const TODAY = "2026-06-01";
const at = "2026-06-01T08:00:00.000Z";

const document = (id: string, expiryDate: string, overrides: Partial<ComplianceDocument> = {}): ComplianceDocument => ({
  id,
  ownerType: "vehicle",
  ownerId: "v1",
  documentTypeId: "t1",
  documentNumber: "INS-1",
  issuedDate: null,
  expiryDate,
  notes: "",
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

const acknowledgement = (documentId: string, expiryDate: string, overrides: Partial<DocumentReminder> = {}): DocumentReminder => ({
  id: `r-${documentId}-${expiryDate}`,
  documentId,
  expiryDate,
  note: "Chasing the insurer",
  expectedBy: "2026-06-10",
  acknowledgedBy: "Ama Mensah",
  acknowledgedAt: at,
  ...overrides,
});

function build(documents: ComplianceDocument[], reminders: DocumentReminder[] = [], leadDays: number | null = 30): Database {
  return { ...emptyDatabase(), documents, documentReminders: reminders, settings: { ...emptyDatabase().settings, documentReminderLeadDays: leadDays } };
}

describe("what is due, and why", () => {
  it("counts a lapsed paper and one inside the lead time, and leaves the rest alone", () => {
    const db = build([document("a", "2026-05-20"), document("b", "2026-06-20"), document("c", "2026-12-01")]);
    const due = dueReminders(db, 30, TODAY);
    expect(due.map((entry) => entry.document.id)).toEqual(["a", "b"]);
    expect(due[0].status).toBe("expired");
    expect(due[0].days).toBe(-12);
    expect(due[1].status).toBe("expiring_soon");
    expect(due[1].days).toBe(19);
  });

  it("treats the last day of the lead time as due, and the day after as not", () => {
    const db = build([document("edge", "2026-07-01"), document("past", "2026-07-02")], [], 30);
    expect(dueReminders(db, 30, TODAY).map((entry) => entry.document.id)).toEqual(["edge"]);
  });

  it("with no lead time set, only a paper that has actually lapsed is due", () => {
    const db = build([document("a", "2026-05-31"), document("b", "2026-06-02")], [], null);
    expect(dueReminders(db, null, TODAY).map((entry) => entry.document.id)).toEqual(["a"]);
  });

  it("leaves out a paper whose date nobody can read, rather than calling it due", () => {
    const db = build([document("broken", "not-a-date"), document("a", "2026-05-31")]);
    expect(dueReminders(db, 30, TODAY).map((entry) => entry.document.id)).toEqual(["a"]);
  });

  it("puts the lapsed first, then the nearest expiry", () => {
    const db = build([document("later", "2026-06-25"), document("lapsed", "2026-04-01"), document("soon", "2026-06-03")]);
    expect(dueReminders(db, 30, TODAY).map((entry) => entry.document.id)).toEqual(["lapsed", "soon", "later"]);
  });
});

describe("an acknowledgement belongs to an expiry date", () => {
  it("is live while the date has not moved, and lapses when the paper is renewed", () => {
    const renewed = document("a", "2027-05-20");
    const db = build([renewed], [acknowledgement("a", "2026-05-20")]);
    expect(reminderFor(db, renewed)).toBe(null);

    const unchanged = document("a", "2026-05-20");
    expect(reminderFor(build([unchanged], [acknowledgement("a", "2026-05-20")]), unchanged)?.acknowledgedBy).toBe("Ama Mensah");
  });

  it("keeps the newest when two people have taken the same paper on", () => {
    const doc = document("a", "2026-05-20");
    const db = build(
      [doc],
      [
        acknowledgement("a", "2026-05-20", { id: "older", acknowledgedBy: "Ama Mensah", acknowledgedAt: "2026-05-01T08:00:00.000Z" }),
        acknowledgement("a", "2026-05-20", { id: "newer", acknowledgedBy: "Kofi Boateng", acknowledgedAt: "2026-05-20T08:00:00.000Z" }),
      ],
    );
    expect(reminderFor(db, doc)?.id).toBe("newer");
  });

  it("says who, when, what, and by when — in one line the register can print", () => {
    expect(reminderLine(acknowledgement("a", "2026-05-20"))).toBe(
      "Taken on by Ama Mensah on 2026-06-01: Chasing the insurer; expected by 2026-06-10",
    );
    expect(reminderLine(acknowledgement("a", "2026-05-20", { expectedBy: null }))).toBe("Taken on by Ama Mensah on 2026-06-01: Chasing the insurer");
  });
});

describe("counting what needs somebody's attention", () => {
  it("separates the papers nobody has taken on from the ones somebody has", () => {
    const db = build(
      [document("a", "2026-05-20"), document("b", "2026-06-10"), document("c", "2027-01-01")],
      [acknowledgement("b", "2026-06-10")],
    );
    expect(reminderCounts(db, 30, TODAY)).toEqual({ due: 2, expired: 1, expiringSoon: 1, untaken: 1, takenOn: 1 });
  });

  it("counts nothing when the register is empty", () => {
    expect(reminderCounts(build([]), 30, TODAY)).toEqual({ due: 0, expired: 0, expiringSoon: 0, untaken: 0, takenOn: 0 });
  });
});

describe("how the timing reads", () => {
  it("says it the way a person would", () => {
    expect(reminderTiming(0)).toBe("expires today");
    expect(reminderTiming(1)).toBe("in 1 day");
    expect(reminderTiming(12)).toBe("in 12 days");
    expect(reminderTiming(-1)).toBe("1 day ago");
    expect(reminderTiming(-20)).toBe("20 days ago");
    expect(reminderTiming(null)).toBe("date unreadable");
  });
});
