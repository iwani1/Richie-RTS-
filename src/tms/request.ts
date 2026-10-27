// The journey a customer asked for (RNT-01, D-119).
//
// A rental request used to record the dates, the two places and the passenger count. Everything the
// desk actually wrote on the pad — "leaves half seven, picks up at Achimota, drops the last lot at
// Tema, twelve suitcases, one wheelchair, ring Ama on the day, they walked in off the street" — had
// nowhere to go, so a quotation was priced from half the facts and a driver rang the office to ask
// what the day looked like.
//
// The plan is the pair to the run (D-118). The plan is what was asked for; the run is what happened.
// Keeping them apart is what lets a screen say "asked for 08:00, left 08:40" without one of them
// overwriting the other.
//
// Three rules, each one a way a request gets misread:
//
//   * **A time is a time.** "8:00" is accepted and stored as "08:00"; "8", "8.0" and "noon" are
//     refused. A guessed clock time is a schedule nobody can argue with later.
//   * **A one-day hire cannot come back before it leaves.** On a same-day request the return time
//     must be after the departure time. It is a refusal, not a silent swap, because the office has
//     typed one of the two wrong and only they can say which.
//   * **Nothing is invented.** A blank field is blank: no stops, no luggage, no special needs, no
//     contact, no source. The screens say what was not recorded instead of implying none was needed.
//
// Nothing here prices anything. A stop or a suitcase may well cost money, but that is a decision
// somebody makes on the quotation, not a rule this module applies (D-119).
import { humanDuration, readClock } from "./time";
import { REQUEST_SOURCES, type Rental, type RentalPlan, type RequestSource } from "./types";

/** How many intermediate stops a request may carry before the notes are the better place. */
export const MAX_STOPS = 8;
/** How long one stop's name may be. */
export const STOP_LIMIT = 120;
/** How long the luggage or special-needs note may be. */
export const PLAN_NOTE_LIMIT = 300;
export const CONTACT_NAME_LIMIT = 120;
export const CONTACT_PHONE_LIMIT = 40;

/** The words a screen prints for a channel, and for a request whose channel nobody wrote down. */
export const SOURCE_LABELS: Record<RequestSource, string> = {
  phone: "Phone call",
  walk_in: "Walk-in at the desk",
  email: "Email",
  whatsapp: "WhatsApp",
  website: "Website form",
  portal: "Client portal",
  referral: "Referral",
  other: "Other",
};

/**
 * What the desk may send about the journey.
 *
 * Every field is optional text from a form. A field that is absent from an update keeps whatever the
 * record already held — the difference between "nobody mentioned the stops this time" and "the stops
 * are cancelled" is the whole point.
 */
export interface RentalPlanInput {
  departureTime?: string;
  returnTime?: string;
  /** One stop per line, in the order the vehicle calls. */
  stops?: string;
  luggage?: string;
  specialNeeds?: string;
  tripContactName?: string;
  tripContactPhone?: string;
  source?: string;
}

const EMPTY_PLAN: RentalPlan = {
  departureTime: "",
  returnTime: "",
  stops: [],
  luggage: "",
  specialNeeds: "",
  tripContactName: "",
  tripContactPhone: "",
  source: "",
};

/**
 * Read the journey out of a form, with the refusals the office can act on.
 *
 * `dates` is what the request already says about when it needs the vehicle, because the one ordering
 * rule a plan has is about a same-day hire. `existing` is the plan already on the record, so a
 * correction that leaves a field out of the form does not wipe what the office typed last time.
 */
export function readRequestDetails(
  input: RentalPlanInput,
  dates: { startDate: string; endDate: string },
  existing: RentalPlan | null = null,
): { errors: Record<string, string>; plan: RentalPlan } {
  const errors: Record<string, string> = {};
  const current = existing ?? EMPTY_PLAN;
  const text = (value: string | undefined, kept: string) => (value === undefined ? kept : value.trim());

  const readTime = (value: string | undefined, kept: string, key: "departureTime" | "returnTime") => {
    const raw = text(value, kept);
    if (raw === "") return "";
    const parsed = readClock(raw);
    if (parsed === null) {
      errors[key] = "Enter the time as HH:MM, for example 08:30.";
      return "";
    }
    return parsed;
  };

  const departureTime = readTime(input.departureTime, current.departureTime, "departureTime");
  const returnTime = readTime(input.returnTime, current.returnTime, "returnTime");
  // A same-day hire that comes back before it leaves is one of the two times typed wrong. Counting a
  // return on a later date needs no check: the date already puts it afterwards.
  if (!errors.departureTime && !errors.returnTime && departureTime && returnTime && dates.startDate === dates.endDate && returnTime <= departureTime) {
    errors.returnTime = "On a one-day hire the vehicle cannot be back before it leaves. Change the return time, or the end date.";
  }

  const stops = input.stops === undefined
    ? current.stops
    : input.stops
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
        .filter(Boolean);
  if (stops.length > MAX_STOPS) errors.stops = `Keep the stops to ${MAX_STOPS} or fewer. Put the rest of the day in the notes.`;
  else if (stops.some((stop) => stop.length > STOP_LIMIT)) errors.stops = `Keep each stop to ${STOP_LIMIT} characters.`;

  const luggage = text(input.luggage, current.luggage);
  if (luggage.length > PLAN_NOTE_LIMIT) errors.luggage = `Keep the luggage note to ${PLAN_NOTE_LIMIT} characters.`;

  const specialNeeds = text(input.specialNeeds, current.specialNeeds);
  if (specialNeeds.length > PLAN_NOTE_LIMIT) errors.specialNeeds = `Keep the special needs note to ${PLAN_NOTE_LIMIT} characters.`;

  const tripContactName = text(input.tripContactName, current.tripContactName);
  if (tripContactName.length > CONTACT_NAME_LIMIT) errors.tripContactName = `Keep the name to ${CONTACT_NAME_LIMIT} characters.`;
  const tripContactPhone = text(input.tripContactPhone, current.tripContactPhone);
  const digits = tripContactPhone.replace(/[^0-9]/g, "");
  if (tripContactPhone.length > CONTACT_PHONE_LIMIT) errors.tripContactPhone = `Keep the phone number to ${CONTACT_PHONE_LIMIT} characters.`;
  else if (tripContactPhone && (digits.length < 7 || digits.length > 20)) errors.tripContactPhone = "Enter a phone number the office can ring on the day.";
  // A number with no name is a number nobody knows who to ask for on the morning of the hire.
  else if (tripContactPhone && !tripContactName) errors.tripContactName = "Say whose number this is, so the office knows who to ask for.";

  const rawSource = text(input.source, current.source);
  let source: RequestSource | "" = "";
  if (rawSource !== "") {
    if (REQUEST_SOURCES.includes(rawSource as RequestSource)) source = rawSource as RequestSource;
    else errors.source = "Choose where the request came from.";
  }

  return {
    errors,
    plan: { departureTime, returnTime, stops, luggage, specialNeeds, tripContactName, tripContactPhone, source },
  };
}

/** True when the request says anything at all about the journey beyond its dates and two places. */
export function planHasDetails(plan: RentalPlan | null): boolean {
  if (!plan) return false;
  return (
    plan.departureTime !== "" ||
    plan.returnTime !== "" ||
    plan.stops.length > 0 ||
    plan.luggage !== "" ||
    plan.specialNeeds !== "" ||
    plan.tripContactName !== "" ||
    plan.tripContactPhone !== "" ||
    plan.source !== ""
  );
}

/**
 * How long the hire was asked to be, in minutes, or null when the request does not say.
 *
 * Only the two clock times take part: a request that names no times still asks for a number of days,
 * and that count is printed separately rather than dressed up as hours nobody stated.
 */
export function plannedMinutes(rental: Rental): number | null {
  const plan = rental.plan;
  if (!plan || !plan.departureTime || !plan.returnTime) return null;
  const from = new Date(`${rental.startDate}T${plan.departureTime}:00`).getTime();
  const to = new Date(`${rental.endDate}T${plan.returnTime}:00`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 60_000);
}

const day = (ymd: string) => {
  const date = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(date.getTime()) ? ymd : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** One sentence for the request's times, including how long it was asked to be. */
export function planLine(rental: Rental): string {
  const plan = rental.plan;
  if (!plan) return "This request was written before the journey details were recorded, so its times, stops and origin are unknown.";
  const out = plan.departureTime;
  const back = plan.returnTime;
  if (!out && !back) return "No departure or return time was recorded for this request.";
  if (out && !back) return `Leaves at ${out} on ${day(rental.startDate)}; no return time was recorded.`;
  if (!out) return `Back at ${back} on ${day(rental.endDate)}; no departure time was recorded.`;
  const minutes = plannedMinutes(rental);
  const length = minutes === null ? null : humanDuration(minutes);
  const sentence =
    rental.startDate === rental.endDate
      ? `Leaves at ${out} and back at ${back} on ${day(rental.endDate)}`
      : `Leaves at ${out} on ${day(rental.startDate)} and back at ${back} on ${day(rental.endDate)}`;
  return `${sentence}${length ? ` — ${length}` : ""}.`;
}

/** Where the vehicle calls on the way, in the order the customer gave them. */
export function stopsLine(rental: Rental): string {
  const stops = rental.plan?.stops ?? [];
  if (stops.length === 0) return "No intermediate stops were recorded.";
  return `Calls at ${stops.join(", then ")}.`;
}

/** Who to ring on the morning of the hire, when it is not the person who booked. */
export function tripContactLine(rental: Rental): string {
  const name = rental.plan?.tripContactName ?? "";
  const phone = rental.plan?.tripContactPhone ?? "";
  if (!name && !phone) return "Nobody else was named for the day: the office rings the customer's own number.";
  if (name && phone) return `On the day, ring ${name} on ${phone}.`;
  if (phone) return `On the day, ring ${phone}.`;
  return `On the day, ask for ${name}.`;
}

/** How the request reached the office, as a word a screen can print. */
export function sourceLabel(source: RequestSource | ""): string {
  return source === "" ? "not recorded" : SOURCE_LABELS[source];
}
