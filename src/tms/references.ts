// Reference numbers: one allocator for every record that a person quotes out loud.
//
// A reference was once `prefix + (records.length + 1)`. That is wrong twice over. It collides when
// two commands run at the same moment — the length is the same for both, so both get the same
// number. And it goes backwards: delete a record (a backup import does), and the next record is
// handed a number that has already been printed on a quotation or an invoice (audit D-03).
//
// So numbers come from a counter, not from the size of a list:
//
//   * `referenceCounters` is part of the database snapshot, so the allocator is pure and testable,
//     and `saveDatabase` mirrors it into `reference_counter` inside the same transaction — under
//     the advisory lock `runCommand` takes, two commands cannot both read the same "last".
//   * The database refuses an update that lowers a series (trigger `reference_counter_no_rewind`), so
//     nothing in the application — an import, a hand-edited row — can walk a printed number back.
//     `npm run db:restore` is the one exception by design: it truncates and reloads, because a
//     restore is an explicit decision to return the whole installation to an earlier moment.
//   * If a counter is missing — a database written before this existed, or a restore that dropped
//     the table — the next number is taken from the highest reference already present, not from a
//     count. Recovering the series is then guaranteed rather than hoped for.
import type { Database, ReferenceCounter, ReferenceScope } from "./types";

/** Every numbering series in the application, and its shape. */
export const REFERENCE_SERIES: Record<ReferenceScope, { prefix: string; width: number; perYear: boolean }> = {
  // Rentals, routes, trips and work orders are numbered continuously: the reference is quoted in
  // conversation, and a year inside it earns nothing.
  rental: { prefix: "RR", width: 4, perYear: false },
  // A quotation is its own document now (RNT-04, D-117): the customer quotes this number back, and a
  // renewal keeps it, so the series is continuous and never restarts in January.
  quotation: { prefix: "QUO", width: 4, perYear: false },
  route: { prefix: "RT", width: 3, perYear: false },
  trip: { prefix: "TR", width: 4, perYear: false },
  incident: { prefix: "IN", width: 4, perYear: false },
  workOrder: { prefix: "WO", width: 4, perYear: false },
  // A contract is quoted on the phone and on the renewal letter, so it is continuous like a rental.
  contract: { prefix: "CT", width: 4, perYear: false },
  // A booking reference is quoted to the person travelling, so it stays short and continuous.
  booking: { prefix: "BK", width: 4, perYear: false },
  // Financial documents restart each year: INV-2026-0001 is what an accountant and a tax inspector
  // both expect to see.
  invoice: { prefix: "INV", width: 4, perYear: true },
  // A credit note is quoted to the same accountant as the invoice it corrects, so it restarts each
  // year alongside it, with a prefix that no one can mistake for an invoice.
  creditNote: { prefix: "CN", width: 4, perYear: true },
  payment: { prefix: "PAY", width: 4, perYear: true },
  // Money going back out gets its own series, so a refund receipt is never mistaken for a payment
  // received (D-92). It restarts each year with the other financial documents.
  refund: { prefix: "REF", width: 4, perYear: true },
  // Spending that is not a repair (D-93). Quoted against a receipt in the file, and restarted each
  // year with the other money documents.
  expense: { prefix: "EXP", width: 4, perYear: true },
};

/** The period a counter is filed under: the year for financial documents, `all` otherwise. */
export function seriesPeriod(scope: ReferenceScope, year: string): string {
  return REFERENCE_SERIES[scope].perYear ? year : "all";
}

/** Every reference already in use for a series, so a missing counter can be recovered. */
function existingReferences(db: Database, scope: ReferenceScope): string[] {
  switch (scope) {
    case "rental":
      return db.rentals.map((record) => record.reference);
    case "quotation":
      // Every quotation ever issued on every request, current and retained revisions alike, so a
      // counter that went missing cannot hand out a number that is already on a customer's sheet.
      return db.rentals.flatMap((rental) => [rental.quote, ...(rental.quoteHistory ?? [])])
        .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote))
        .map((quote) => quote.number)
        .filter((number) => typeof number === "string" && number !== "");
    case "route":
      return db.routes.map((record) => record.reference);
    case "trip":
      return db.trips.map((record) => record.reference);
    case "incident":
      return db.incidents.map((record) => record.reference);
    case "workOrder":
      return db.workOrders.map((record) => record.reference);
    case "invoice":
      return db.invoices.map((record) => record.reference);
    case "creditNote":
      return db.creditNotes.map((record) => record.reference);
    case "payment":
      return db.payments.map((record) => record.reference);
    case "refund":
      return db.refunds.map((record) => record.reference);
    case "expense":
      return db.expenses.map((record) => record.reference);
    case "contract":
      return db.contracts.map((record) => record.reference);
    case "booking":
      return db.bookings.map((record) => record.reference);
    default:
      // Exhaustive by type; this keeps a future scope from silently numbering from zero.
      return [];
  }
}

/**
 * The highest number this series has already reached, read back from the references themselves.
 *
 * Only used when no counter exists. Counts are not consulted on purpose: a count cannot tell a
 * full series with a hole in it from a fresh one.
 */
export function highestIssued(db: Database, scope: ReferenceScope, period: string): number {
  const { prefix, perYear } = REFERENCE_SERIES[scope];
  const pattern = perYear ? new RegExp(`^${prefix}-${period}-(\\d+)$`) : new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const reference of existingReferences(db, scope)) {
    const match = pattern.exec(reference);
    if (!match) continue;
    const issued = Number(match[1]);
    if (Number.isSafeInteger(issued) && issued > highest) highest = issued;
  }
  return highest;
}

/**
 * The next number in a series, and the counters with that fact recorded.
 *
 * Pure: the caller puts `counters` back on the snapshot it returns. That is what makes the
 * allocator testable without a database, and what lets a command that writes several records (trip
 * generation) allocate each number in turn.
 */
export function allocateReference(
  db: Database,
  scope: ReferenceScope,
  year: string,
): { reference: string; counters: ReferenceCounter[] } {
  const { prefix, width, perYear } = REFERENCE_SERIES[scope];
  const period = seriesPeriod(scope, year);
  const existing = db.referenceCounters.find((counter) => counter.scope === scope && counter.period === period);

  // A counter that lags behind the records (or does not exist at all) must not hand out a number
  // that is already printed, so the floor is whichever is higher.
  const floor = Math.max(existing?.last ?? 0, highestIssued(db, scope, period));
  const next = floor + 1;
  const counters = existing
    ? db.referenceCounters.map((counter) => (counter === existing ? { ...counter, last: next } : counter))
    : [...db.referenceCounters, { scope, period, last: next }];

  const number = String(next).padStart(width, "0");
  return { reference: perYear ? `${prefix}-${period}-${number}` : `${prefix}-${number}`, counters };
}

/** The shape a reference of this series must have today, for tests and for the importer's checks. */
export function referencePattern(scope: ReferenceScope, period: string): RegExp {
  const { prefix, width, perYear } = REFERENCE_SERIES[scope];
  const digits = `\\d{${width},}`;
  return perYear ? new RegExp(`^${prefix}-${period}-${digits}$`) : new RegExp(`^${prefix}-${digits}$`);
}
