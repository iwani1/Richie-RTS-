// Reminders for the papers that run out (FLT-03, D-110).
//
// The register already knew an expiry date, and already blocked a vehicle or a driver whose required
// paper had lapsed (Q-16, D-76). What it did not do was tell anybody *before* that happened, and it
// could not: a reminder sent by email or SMS needs a provider this program does not have.
//
// So a reminder here is a record, not a message. What it records is the thing a reminder is actually
// for — somebody has seen that a paper is running out, and somebody has taken on renewing it, with a
// date they expect the new one by. That is enough to answer the two questions an owner asks: "what is
// about to lapse?" and "who is dealing with it?".
//
// Three deliberate choices:
//
//   * **Due-ness is derived, exactly as the register's status is.** A paper is due when its expiry is
//     inside the configured lead time or already past; nothing is marked due by hand, so nothing can
//     be marked due that is not.
//   * **An acknowledgement belongs to an expiry date, not to a document.** When the paper is renewed
//     the expiry date moves, the old acknowledgement lapses, and the reminder comes back if the new
//     date is still inside the lead time. A renewal that was entered wrongly does not silence the
//     reminder it was meant to answer.
//   * **Nothing is ever deleted.** A superseded acknowledgement stays in the list; the newest one for
//     the current expiry date is the live one. The same rule as the delay reports (D-105) and the
//     receipt scans (D-100), and for the same reason: the question afterwards is "who said what".
import { daysUntil, documentStatus, type DocumentStatus } from "./compliance";
import type { ComplianceDocument, Database, DocumentReminder } from "./types";

export const REMINDER_LIMITS = {
  /** What is being done about it. Long enough for a sentence, short enough to read in a table. */
  note: 200,
} as const;

/** One paper that needs somebody's attention, with whatever has been said about it so far. */
export interface DueReminder {
  document: ComplianceDocument;
  status: Extract<DocumentStatus, "expired" | "expiring_soon">;
  /** Negative when the paper has already lapsed; null when the date cannot be read. */
  days: number | null;
  /** The live acknowledgement for this expiry date, or null when nobody has taken it on. */
  takenOn: DocumentReminder | null;
}

/**
 * The live acknowledgement for a document: the newest one given against the date it expires on.
 *
 * An acknowledgement of an older expiry date is history — the paper was renewed, or the date was
 * corrected — and it must not keep a reminder quiet about the date the register now shows.
 */
export function reminderFor(db: Database, document: ComplianceDocument): DocumentReminder | null {
  const live = db.documentReminders
    .filter((reminder) => reminder.documentId === document.id && reminder.expiryDate === document.expiryDate)
    .sort((a, b) => b.acknowledgedAt.localeCompare(a.acknowledgedAt));
  return live[0] ?? null;
}

/**
 * Every paper that needs attention today, soonest first.
 *
 * Expired papers come before expiring ones (`documentStatus` is the sort key through `days`), and
 * unreadable dates are left out entirely rather than counted as due: a date nobody can read is a
 * data problem the register already shows as "unknown".
 */
export function dueReminders(db: Database, leadDays: number | null, today: string): DueReminder[] {
  return db.documents
    .flatMap((document) => {
      const status = documentStatus(document.expiryDate, leadDays, today);
      if (status !== "expired" && status !== "expiring_soon") return [];
      return [{ document, status, days: daysUntil(document.expiryDate, today), takenOn: reminderFor(db, document) }];
    })
    .sort((a, b) => {
      // Lapsed first, then the nearest expiry; two papers on the same day keep a stable order by id.
      const left = a.days ?? 0;
      const right = b.days ?? 0;
      if (left !== right) return left - right;
      return a.document.id.localeCompare(b.document.id);
    });
}

export interface ReminderCounts {
  /** Papers inside the lead time or already past. */
  due: number;
  expired: number;
  expiringSoon: number;
  /** Due papers nobody has taken on yet — the number that should make somebody act. */
  untaken: number;
  takenOn: number;
}

export function reminderCounts(db: Database, leadDays: number | null, today: string): ReminderCounts {
  const due = dueReminders(db, leadDays, today);
  return {
    due: due.length,
    expired: due.filter((entry) => entry.status === "expired").length,
    expiringSoon: due.filter((entry) => entry.status === "expiring_soon").length,
    untaken: due.filter((entry) => entry.takenOn === null).length,
    takenOn: due.filter((entry) => entry.takenOn !== null).length,
  };
}

/** "expires today" / "in 12 days" / "3 days ago" — the same wording the register uses. */
export function reminderTiming(days: number | null): string {
  if (days === null) return "date unreadable";
  if (days === 0) return "expires today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${Math.abs(days)} day${days === -1 ? "" : "s"} ago`;
}

/** What the register says about an acknowledgement: who, when, what, and by when. */
export function reminderLine(reminder: DocumentReminder): string {
  const expected = reminder.expectedBy ? `; expected by ${reminder.expectedBy}` : "";
  return `Taken on by ${reminder.acknowledgedBy} on ${reminder.acknowledgedAt.slice(0, 10)}: ${reminder.note}${expected}`;
}
