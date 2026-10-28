"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTms } from "../tms/useTms";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/tms/PageHeader";
import { Panel } from "@/components/tms/Panel";
import { DataTable, TableFoot, type TmsColumn } from "@/components/tms/DataTable";
import { FilterNote, FilterSelect, SearchField } from "@/components/tms/FilterBar";
import { Button } from "@/components/ui/button";
import type { AuditEntry } from "../tms/types";

/** How many matches the table draws at once, whatever the search finds. */
const WINDOW = 500;

/** A command name reads as a reference, not as prose: mono, on its own chip, one line. */
function CommandName({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-foreground">
      {children}
    </code>
  );
}

/**
 * The audit log.
 *
 * An append-only record of every change made through the service layer — written by the database,
 * never by this screen, which only reads and narrows. The counts in the header are the ones the
 * server sent: how many entries exist, and how many of them were loaded into this snapshot. Both
 * are printed, because a screen that showed "1,204 entries" beside a table of 200 would be
 * describing a window as if it were the whole log.
 *
 * The 500-row window is applied **after** sorting (the table does that), so "oldest first" brings
 * the oldest match to the top instead of sorting the newest 500 and calling it oldest.
 */
export function AuditPage() {
  const { db, auditTotal, refresh } = useTms();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");
  const [busy, setBusy] = useState(false);

  const entities = useMemo(() => Array.from(new Set(db.audit.map((entry) => entry.entity))).sort(), [db.audit]);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return db.audit
      .filter((entry) => entity === "all" || entry.entity === entity)
      .filter((entry) => !needle || `${entry.actorName} ${entry.action} ${entry.summary} ${entry.entity}`.toLowerCase().includes(needle));
  }, [db.audit, entity, query]);

  const columns = useMemo<TmsColumn<AuditEntry>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: ({ row }) => <span className="tms-mono whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.at)}</span>,
      },
      {
        accessorKey: "actorName",
        header: "Actor",
        cell: ({ row }) => <span className="text-foreground">{row.original.actorName}</span>,
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => <CommandName>{row.original.action}</CommandName>,
      },
      {
        accessorKey: "entity",
        header: "Record",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.entity}</span>,
      },
      {
        accessorKey: "summary",
        header: "Summary",
        enableSorting: false,
        cell: ({ row }) => <span className="text-[12.5px] text-muted-foreground">{row.original.summary}</span>,
      },
    ],
    [],
  );

  const shown = Math.min(WINDOW, matching.length);
  const filtered = matching.length !== db.audit.length;

  const reload = async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const figures = [
    { label: "Recorded", value: auditTotal, caption: "Every entry the database holds. Append-only: nothing can be edited or deleted." },
    { label: "Loaded", value: db.audit.length, caption: "The most recent entries carried by this snapshot." },
    { label: filtered ? "Matching" : "In view", value: matching.length, caption: filtered ? "Narrowed by the search and the record filter." : "Nothing is filtered out." },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Governance"
        title="Audit log"
        subtitle="Append-only record of every change made through the service layer. Nothing on this screen writes, edits or deletes — it reads what the database added and narrows it."
        actions={
          <Button variant="outline" size="sm" className="tms-press h-9 gap-1.5 rounded-control" onClick={reload} disabled={busy}>
            <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
            {busy ? "Reloading" : "Reload"}
          </Button>
        }
      />

      <dl aria-label="What this log covers" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {figures.map((figure, index) => (
          <div key={figure.label} className="tms-surface tms-lift tms-stagger animate-fade-up p-4" style={{ ["--stagger" as string]: index }}>
            <dt className="tms-mono text-muted-foreground">{figure.label}</dt>
            <dd className="mt-2 text-[26px] leading-none font-semibold tracking-[-0.03em] text-foreground tabular-nums">
              {figure.value.toLocaleString()}
            </dd>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{figure.caption}</p>
          </div>
        ))}
      </dl>

      <Panel
        kicker="Change log"
        title="Every change, newest first"
        description="Sorted by the time the database wrote it. Press a column heading to read the log another way; the 500-row window is taken after the sort, so the oldest match comes first."
      >
        <DataTable
          columns={columns}
          data={matching}
          limit={WINDOW}
          caption="Audit log: when, who, which command, which record, and what changed"
          maxHeight="30rem"
          emptyTitle={filtered ? "Nothing matches that" : "No audit entries"}
          emptyBody={
            filtered
              ? "No entry matches this search and record together. Clear one of them to widen the view."
              : "Changes will appear here as soon as they are made."
          }
          toolbar={
            <>
              <SearchField label="Search audit log" placeholder="Search actor, action or summary" value={query} onChange={setQuery} />
              <FilterSelect label="Filter by entity" value={entity} onChange={setEntity} className="max-w-[180px]">
                <option value="all">All records</option>
                {entities.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </FilterSelect>
              <FilterNote>
                {auditTotal.toLocaleString()} recorded · append-only
              </FilterNote>
            </>
          }
        />
        <TableFoot
          left={`Showing ${shown.toLocaleString()} of ${matching.length.toLocaleString()} matching ${matching.length === 1 ? "entry" : "entries"}${matching.length > shown ? " — narrow the search to see earlier ones" : ""}`}
          right={`${db.audit.length.toLocaleString()} in this snapshot`}
        />
      </Panel>
    </div>
  );
}
