import { describe, expect, it } from "vitest";
import { nextSort, sortOf, sortRows, type SortableColumn } from "./tableSort";

// A register sorted by one column at a time. The rules that matter are the ones a reader would
// notice: the third click puts the list back, a second click reverses it, and two rows that tie
// never trade places.
interface Row {
  id: string;
  reference: string;
  total: number;
  entered: string;
}

const rows: Row[] = [
  { id: "a", reference: "INV-2026-0010", total: 1200, entered: "2026-03-02" },
  { id: "b", reference: "INV-2026-0009", total: 90, entered: "2026-03-01" },
  { id: "c", reference: "QUO-0002", total: 500, entered: "2026-02-27" },
  { id: "d", reference: "INV-2026-0010", total: 500, entered: "2026-03-01" },
];

const columns: SortableColumn<Row>[] = [
  { key: "reference", sortValue: (row) => row.reference },
  { key: "total", sortValue: (row) => row.total },
  { key: "entered", sortValue: (row) => row.entered },
  { key: "rendered" },
];

const order = (list: Row[]) => list.map((row) => row.id);

describe("what a click on a column header means", () => {
  it("sorts ascending first, reverses on the second click, and clears on the third", () => {
    const first = nextSort(null, "total");
    expect(first).toEqual({ key: "total", direction: "ascending" });
    const second = nextSort(first, "total");
    expect(second).toEqual({ key: "total", direction: "descending" });
    expect(nextSort(second, "total")).toBeNull();
  });

  it("starts a different column at ascending rather than carrying the direction over", () => {
    expect(nextSort({ key: "total", direction: "descending" }, "reference")).toEqual({ key: "reference", direction: "ascending" });
  });

  it("reports a column's state, and none for the rest", () => {
    const sort = { key: "total", direction: "descending" } as const;
    expect(sortOf(sort, "total")).toBe("descending");
    expect(sortOf(sort, "reference")).toBe("none");
    expect(sortOf(null, "total")).toBe("none");
  });
});

describe("sorting the rows", () => {
  it("leaves the screen's own order alone until a column is chosen", () => {
    expect(order(sortRows(rows, columns, null))).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts text in reading order, with digit runs compared by value", () => {
    const sorted = sortRows(rows, columns, { key: "reference", direction: "ascending" });
    // INV-2026-0009 before INV-2026-0010 before QUO-0002; the two INV-2026-0010 rows keep the
    // order the screen had them in.
    expect(order(sorted)).toEqual(["b", "a", "d", "c"]);
  });

  it("sorts numbers as numbers, not as text", () => {
    expect(order(sortRows(rows, columns, { key: "total", direction: "ascending" }))).toEqual(["b", "c", "d", "a"]);
    expect(order(sortRows(rows, columns, { key: "total", direction: "descending" }))).toEqual(["a", "c", "d", "b"]);
  });

  it("sorts dates, which are stored in a form that reads in order", () => {
    expect(order(sortRows(rows, columns, { key: "entered", direction: "ascending" }))).toEqual(["c", "b", "d", "a"]);
  });

  it("keeps rows that tie in the order they arrived", () => {
    const sorted = sortRows(rows, columns, { key: "total", direction: "ascending" });
    // 500 twice: "c" was before "d" on the screen, and stays before it.
    expect(order(sorted).slice(1, 3)).toEqual(["c", "d"]);
  });

  it("does nothing for a column that cannot be sorted, or a name no column has", () => {
    expect(order(sortRows(rows, columns, { key: "rendered", direction: "ascending" }))).toEqual(["a", "b", "c", "d"]);
    expect(order(sortRows(rows, columns, { key: "nonsense", direction: "ascending" }))).toEqual(["a", "b", "c", "d"]);
  });

  it("returns the rows themselves, not copies", () => {
    const sorted = sortRows(rows, columns, { key: "total", direction: "ascending" });
    expect(sorted[0]).toBe(rows[1]);
  });
});
