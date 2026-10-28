/**
 * The date and day formats the whole application writes in.
 *
 * These lived in `src/ui/primitives.tsx`, which is the layer being retired screen by screen. A
 * formatter is not a component, so it belongs here: the rebuilt screens import it from `@/lib/format`
 * and the not-yet-rebuilt ones keep importing it from primitives, which re-exports it unchanged.
 *
 * Nothing here invents a format: each helper delegates to the reader's own locale, so a Ghanaian desk
 * sees the same words it sees in its operating system.
 */

/** A stored timestamp, written the way a person reads it: "12 Oct 2026, 14:05". */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** A service date (`YYYY-MM-DD`) as a day, with no time attached to it. */
export const formatDate = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { dateStyle: "medium" });
};

/** Today in the storage format. The server decides what "today" means; this is for a screen's own
 *  comparison against a stored date, never for writing a record. */
export const todayYmd = () => new Date().toISOString().slice(0, 10);
