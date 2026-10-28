// Sorting a register by one of its columns.
//
// The rule that matters here is where the order lives: in the screen, not inside the table. A table
// that sorted itself would leave the screen showing one order and an export writing another, and a
// file that disagrees with the screen it came from is worse than no sorting at all. So the screen
// holds the sort, hands the sorted rows to both the table and anything it downloads, and the table
// only draws the control and says which column is in play.
//
// One column at a time, three states: first click sorts ascending, the second descending, the third
// puts the screen back the way its own logic ordered it (newest first, most recent first, whatever
// the screen decided). A fourth state — "sorted by nothing" — would be indistinguishable from the
// third, so there is no fourth.
//
// The sort is not persisted. It is a way of looking at a list, not a preference: an office that
// reopens a register should see the list it always sees rather than somebody else's last click.
import { useState } from "react";

export type SortDirection = "ascending" | "descending";

export interface TableSort {
  key: string;
  direction: SortDirection;
}

/** What sorting needs to know about a column: its name and how to read one value from a row. */
export interface SortableColumn<T> {
  key: string;
  sortValue?: (row: T) => string | number;
}

/**
 * What the next click on a column header means.
 *
 * Nothing → ascending → descending → nothing, and clicking a different column starts again at
 * ascending rather than carrying the old direction across (a click on "Total" should not arrive
 * sorted backwards because "Customer" happened to be).
 */
export function nextSort(current: TableSort | null, key: string): TableSort | null {
  if (!current || current.key !== key) return { key, direction: "ascending" };
  if (current.direction === "ascending") return { key, direction: "descending" };
  return null;
}

/** The word a header carries for assistive technology, and the arrow it draws. */
export function sortOf(sort: TableSort | null | undefined, key: string): SortDirection | "none" {
  return sort && sort.key === key ? sort.direction : "none";
}

/**
 * The rows in the order the screen asked for.
 *
 * Numbers compare as numbers, everything else as text in the reader's own language with digit runs
 * compared by value — so `QUO-0002` sits before `QUO-0010` and `INV-2026-0009` before the tenth,
 * which plain string comparison would get right only because the numbers are padded. Equal values
 * keep the order the screen put them in, so a sort never shuffles rows the reader had no reason to
 * see move.
 */
export function sortRows<T>(rows: T[], columns: SortableColumn<T>[], sort: TableSort | null): T[] {
  if (!sort) return rows;
  const column = columns.find((candidate) => candidate.key === sort.key);
  if (!column?.sortValue) return rows;
  const read = column.sortValue;
  const sign = sort.direction === "descending" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const compared = compareValues(a.value, b.value);
      return compared === 0 ? a.index - b.index : compared * sign;
    })
    .map((entry) => entry.row);
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The state and the rows, for a screen that renders a sortable table.
 *
 * `columns` may be rebuilt on every render — it is only read, never remembered — so a screen can
 * keep writing its columns beside the JSX that uses them. The sort itself is cheap enough to apply
 * on each render: a register shows a few hundred rows, and a memo keyed on an array that is new
 * every time would not save the work anyway.
 */
export function useTableSort<T>(rows: T[], columns: SortableColumn<T>[]) {
  const [sort, setSort] = useState<TableSort | null>(null);
  const sorted = sort ? sortRows(rows, columns, sort) : rows;
  return { rows: sorted, sort, onSortChange: (next: TableSort | null) => setSort(next) };
}
