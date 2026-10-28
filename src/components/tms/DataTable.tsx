"use client";

import { useState } from "react";
import {
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, TableSkeleton } from "./States";

/**
 * The table's feature set, declared once. TanStack v9 stitches features in explicitly, so the set a
 * table has is visible at the top of the file rather than implied by a row-model option somewhere
 * in a component: core rows, and client-side sorting with two string comparators.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

/** The column type every screen uses, so no screen has to name the feature set. */
export type TmsColumn<T extends RowData> = ColumnDef<typeof features, T, unknown>;

export type DataTableState = "ready" | "loading" | "error";

/**
 * The register every list screen uses.
 *
 * A table is a control surface, not a picture of one: the header stays put while the body scrolls,
 * a row under the pointer is the row being read, and the three states a query can be in — ready,
 * loading, failed — are part of the component so no screen can forget one. Sorting is handled by
 * TanStack; a column that sets `enableSorting: false` simply is not sortable.
 *
 * `limit` caps how many rows are drawn **after** sorting, not before: a log that shows its first
 * five hundred entries unsorted would claim to be "oldest first" while hiding the oldest it was
 * asked for. The screen says how many it is showing; this component only obeys.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  state = "ready",
  errorMessage = "The request failed before any rows arrived.",
  onRetry,
  toolbar,
  emptyTitle = "Nothing to show yet",
  emptyBody = "Rows appear here as soon as there is something to list.",
  emptyAction,
  maxHeight = "26rem",
  caption,
  initialSorting = [],
  limit,
  className,
}: {
  columns: TmsColumn<T>[];
  data: T[];
  state?: DataTableState;
  errorMessage?: string;
  onRetry?: () => void;
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: React.ReactNode;
  maxHeight?: string;
  /** Spoken before the column headers, so a reader knows what the table is. */
  caption?: string;
  initialSorting?: SortingState;
  /** Draw at most this many rows, taken from the sorted order. The screen reports the total. */
  limit?: number;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const table = useTable({
    features,
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-2.5">{toolbar}</div>}

      {state === "error" ? (
        <ErrorState title="The rows did not load" body={errorMessage} onRetry={onRetry} />
      ) : state === "loading" ? (
        <TableSkeleton rows={5} columns={columns.length} />
      ) : data.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} action={emptyAction} />
      ) : (
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight }}>
          <table className="w-full border-collapse text-left">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead className="sticky top-0 z-10 bg-card">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="border-b border-border">
                  {group.headers.map((header) => {
                    const sortable = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : sortable ? "none" : undefined}
                        className="tms-mono h-9 bg-card px-4 text-left font-medium text-muted-foreground first:pl-4"
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="group inline-flex items-center gap-1 rounded-sm py-1 uppercase hover:text-foreground focus-visible:outline-none"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon
                              className={cn("size-3 shrink-0", sorted ? "text-foreground" : "text-dim opacity-0 group-hover:opacity-100")}
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {(limit === undefined ? table.getRowModel().rows : table.getRowModel().rows.slice(0, limit)).map((row) => (
                <tr key={row.id} className="border-b border-divider transition-colors last:border-b-0 hover:bg-row-hover">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle text-[13px] text-muted-foreground first:pl-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A mono footer line: how many rows are shown, and what the list is sorted by. */
export function TableFoot({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider px-4 py-2.5">
      <span className="tms-mono text-dim">{left}</span>
      {right && <span className="tms-mono text-dim">{right}</span>}
    </div>
  );
}

/** A small, consistent refresh control for a card header. */
export function RefreshButton({ onClick, busy }: { onClick: () => void; busy?: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="text-muted-foreground hover:text-foreground" aria-label="Refresh">
      <RotateCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
      Refresh
    </Button>
  );
}
