// What actually happened on the hire (RNT-07, D-118).
//
// A completed rental used to record the money and nothing else: the office could say what it had
// billed and not when the bus left, when it came back, how far it went, whether it came back damaged,
// or what the customer said afterwards. Those four questions are what a repeat price is built on and
// what a damage claim is argued from.
//
// The rules here are about not overstating what is known:
//
//   * **A time can be typed** — the office completes a hire the next morning, as often as not — but a
//     return before a departure is a mistake to show, never a number to quietly swap.
//   * **A distance is either read or typed, and it says which.** Two odometer readings give a
//     distance the vehicle itself supports; a typed figure is what somebody remembers. Both are
//     useful and they are not the same fact, so `distanceSource` travels with the number and the
//     screen prints the difference.
//   * **Nothing is invented.** No odometer, no distance, no damage note where nobody recorded one,
//     and an older hire with no run at all stays that way.
import type { Database, Invoice, Rental, RentalRun } from "./types";
import { invoiceBalance } from "./creditNotes";
import { formatAmount } from "./money";

/** How much of the report fields may hold. Long enough for the truth, short enough to read. */
export const RUN_NOTE_LIMIT = 1000;

/** The largest distance or odometer a hire can plausibly record, in km. Beyond this it is a typo. */
export const RUN_KM_MAX = 1_000_000;

/** What the completion form sends, all as text because that is what a person types. */
export interface RunInput {
  departedAt?: string;
  returnedAt?: string;
  odometerStartKm?: string;
  odometerEndKm?: string;
  distanceKm?: string;
  damageNotes?: string;
  feedback?: string;
}

export interface RunProblems {
  [field: string]: string;
}

const trim = (value: string | undefined) => (value ?? "").trim();

/**
 * A time from a form or an API call, as an ISO instant.
 *
 * `datetime-local` sends `2026-06-10T08:05` with no zone; Ghana is UTC+0 and keeps no daylight
 * saving, so that wall clock is the instant. Anything unreadable returns null and the caller says so.
 */
export function readInstant(value: string | undefined): string | null {
  const text = trim(value);
  if (!text) return null;
  const parsed = new Date(text.length === 16 ? `${text}:00Z` : text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** `2026-06-10T08:05` for a `datetime-local` field, from an ISO instant. */
export function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

function readKm(value: string | undefined, field: string, problems: RunProblems): number | null {
  const text = trim(value);
  if (!text) return null;
  if (!/^\d+(\.\d)?$/.test(text)) {
    problems[field] = "Whole kilometres, or one decimal place at most.";
    return null;
  }
  const km = Number(text);
  if (km <= 0) {
    problems[field] = "Must be more than 0.";
    return null;
  }
  if (km > RUN_KM_MAX) {
    problems[field] = "That reading looks wrong. Check the figure.";
    return null;
  }
  return km;
}

/**
 * The run to record, or the reasons it cannot be recorded.
 *
 * `startedAt` is the departure already on the record (set when the hire started), so a completed hire
 * that never had one typed in still keeps the moment it was started.
 */
export interface RunKnown {
  /** When the hire started, already on the record. */
  startedAt: string | null;
  /** The odometer reading taken at departure, if one was taken. */
  odometerStartKm: number | null;
}

export function readRun(
  input: RunInput,
  known: RunKnown,
  now: string,
): { problems: RunProblems; run: RentalRun | null } {
  const problems: RunProblems = {};
  const departedAt = readInstant(input.departedAt) ?? known.startedAt;
  if (trim(input.departedAt) && !readInstant(input.departedAt)) {
    problems.departedAt = "Enter the date and time the vehicle left.";
  }
  // The return defaults to the moment of completion: pressing "complete" is the office saying it is
  // back, and a hire cannot be completed while it is still out.
  const returnedAt = trim(input.returnedAt) ? readInstant(input.returnedAt) : now;
  if (trim(input.returnedAt) && !returnedAt) {
    problems.returnedAt = "Enter the date and time the vehicle came back.";
  }
  if (departedAt && returnedAt && new Date(returnedAt).getTime() < new Date(departedAt).getTime()) {
    problems.returnedAt = "The vehicle cannot come back before it left.";
  }

  // The reading at departure may already be on the record from the moment the hire started; a form
  // that leaves it blank is not saying "no reading", it is saying "the one we took still stands".
  const odometerStartKm = trim(input.odometerStartKm) ? readKm(input.odometerStartKm, "odometerStartKm", problems) : known.odometerStartKm;
  const odometerEndKm = readKm(input.odometerEndKm, "odometerEndKm", problems);
  const typed = readKm(input.distanceKm, "distanceKm", problems);

  let distanceKm: number | null = typed;
  let distanceSource: RentalRun["distanceSource"] = typed === null ? null : "entered";
  if (odometerStartKm !== null && odometerEndKm !== null) {
    if (odometerEndKm < odometerStartKm) {
      problems.odometerEndKm = "The closing reading is lower than the reading at departure. Check both.";
    } else {
      const measured = Math.round((odometerEndKm - odometerStartKm) * 10) / 10;
      if (typed !== null && typed !== measured) {
        // Two answers to one question: refuse rather than pick one behind the office's back.
        problems.distanceKm = `The odometer readings give ${measured} km. Remove the typed distance, or correct a reading.`;
      } else {
        distanceKm = measured;
        distanceSource = "odometer";
      }
    }
  } else if (odometerEndKm !== null && odometerStartKm === null) {
    // A closing reading on its own measures nothing, and the office should know that rather than
    // read the absence as "no distance travelled".
    problems.odometerStartKm = "Enter the reading at departure too, or leave both blank and type the distance.";
  }

  if (trim(input.damageNotes).length > RUN_NOTE_LIMIT) problems.damageNotes = `Keep the damage note under ${RUN_NOTE_LIMIT} characters.`;
  if (trim(input.feedback).length > RUN_NOTE_LIMIT) problems.feedback = `Keep the feedback under ${RUN_NOTE_LIMIT} characters.`;

  const nothing = !departedAt && !returnedAt && odometerStartKm === null && odometerEndKm === null && distanceKm === null && !trim(input.damageNotes) && !trim(input.feedback);
  if (Object.keys(problems).length) return { problems, run: null };
  if (nothing) return { problems, run: null };

  return {
    problems,
    run: {
      departedAt: departedAt ?? null,
      returnedAt: returnedAt ?? null,
      odometerStartKm,
      odometerEndKm,
      distanceKm,
      distanceSource,
      damageNotes: trim(input.damageNotes),
      feedback: trim(input.feedback),
      recordedBy: "",
      recordedAt: now,
    },
  };
}

/** How long the vehicle was actually out, in the largest unit that is honest, or null. */
export function runDuration(run: RentalRun): string | null {
  if (!run.departedAt || !run.returnedAt) return null;
  const minutes = Math.round((new Date(run.returnedAt).getTime() - new Date(run.departedAt).getTime()) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} h ${rest} min`;
  const days = Math.floor(hours / 24);
  const leftover = hours % 24;
  return leftover === 0 ? `${days} day${days === 1 ? "" : "s"}` : `${days} days ${leftover} h`;
}

/** The distance line a screen prints, naming where the figure came from. */
export function distanceLine(run: RentalRun): string | null {
  if (run.distanceKm === null) return null;
  const km = `${run.distanceKm.toLocaleString("en-GB")} km`;
  if (run.distanceSource === "odometer") return `${km} (from the odometer)`;
  if (run.distanceSource === "entered") return `${km} (entered by the office, not from an odometer reading)`;
  return km;
}

/** One sentence for the record's heading: when it left, when it came back, and for how long. */
export function runLine(run: RentalRun | null): string {
  if (!run) return "Nothing is recorded about this hire's journey: no departure, no return, no distance.";
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const left = run.departedAt ? `Left ${when(run.departedAt)}` : "Departure not recorded";
  const back = run.returnedAt ? `back ${when(run.returnedAt)}` : "not yet back";
  const duration = runDuration(run);
  return `${left}, ${back}${duration ? ` — ${duration} on the road` : ""}.`;
}

/** What came back damaged, in the office's words, or a plain statement that nothing was. */
export function damageLine(run: RentalRun | null): string {
  if (!run) return "No damage was recorded with this hire.";
  return run.damageNotes ? run.damageNotes : "Nothing was reported damaged when the vehicle came back.";
}

export interface RentalBalance {
  invoice: Invoice | null;
  total: number;
  paid: number;
  credited: number;
  outstanding: number;
  currencyCode: string;
}

/**
 * What the hire cost and what is still owed on it.
 *
 * The figure comes from the invoice raised for this rental and the payments against it, through the
 * one balance rule (D-86), so it cannot disagree with the invoice the customer is holding. A hire with
 * no invoice yet says so rather than showing a zero — nought owed and nothing billed are different.
 */
export function rentalBalance(db: Database, rental: Rental): RentalBalance | null {
  const invoice = db.invoices.find((candidate) => candidate.rentalId === rental.id && candidate.status !== "void");
  if (!invoice) return null;
  const balance = invoiceBalance(db, invoice);
  return {
    invoice,
    total: balance.total,
    paid: balance.paid,
    credited: balance.credited,
    outstanding: balance.outstanding,
    currencyCode: invoice.currencyCode,
  };
}

/** The money sentence for a completed hire, or null while nothing has been billed. */
export function balanceLine(balance: RentalBalance | null): string | null {
  if (!balance) return null;
  const money = (amount: number) => `${balance.currencyCode} ${formatAmount(amount)}`;
  if (balance.outstanding <= 0) return `Invoice ${balance.invoice!.reference} is settled: ${money(balance.total)} billed, nothing outstanding.`;
  return `Invoice ${balance.invoice!.reference}: ${money(balance.total)} billed, ${money(balance.outstanding)} still outstanding.`;
}
