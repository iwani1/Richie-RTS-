import { useMemo, useState } from "react";
import { useTms } from "../tms/useTms";
import { DataTable, EmptyState, PageHeader, SearchInput, Select, TableCard, formatDateTime, type Column } from "../ui/primitives";
import { useTableSort } from "../ui/tableSort";
import type { AuditEntry } from "../tms/types";

export function AuditPage() {
  const { db, auditTotal } = useTms();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");
  const entities = useMemo(() => Array.from(new Set(db.audit.map((a) => a.entity))).sort(), [db.audit]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.audit
      .filter((a) => entity === "all" || a.entity === entity)
      .filter((a) => !q || `${a.actorName} ${a.action} ${a.summary} ${a.entity}`.toLowerCase().includes(q));
  }, [db.audit, query, entity]);
  // The log is read newest-first, which is the order the service appends it in, so the screen does
  // not re-sort until somebody asks. When they do, the sort is applied to every match and the 500-row
  // window is taken afterwards — sorting only the visible page would claim "oldest first" while
  // hiding the older entries it was supposed to bring to the top.
  const auditColumns: Column<AuditEntry>[] = [
    { key: "at", header: "When", className: "whitespace-nowrap", sortValue: (a) => a.at, render: (a) => <span className="rts-mono text-muted-foreground">{formatDateTime(a.at)}</span> },
    { key: "actor", header: "Actor", sortValue: (a) => a.actorName, render: (a) => a.actorName },
    { key: "action", header: "Action", sortValue: (a) => a.action, render: (a) => <code className="rts-code">{a.action}</code> },
    { key: "entity", header: "Record", sortValue: (a) => a.entity, render: (a) => <span className="text-muted-foreground">{a.entity}</span> },
    { key: "summary", header: "Summary", sortValue: (a) => a.summary, render: (a) => <span className="text-xs">{a.summary}</span> },
  ];
  const { rows: sorted, sort, onSortChange } = useTableSort(matching, auditColumns);
  const rows = sorted.slice(0, 500);

  return (
    <div>
      <PageHeader eyebrow="Governance" title="Audit log" description={`Append-only record of every change made through the service layer. ${auditTotal} entries; the most recent ${db.audit.length} are loaded, and up to 500 matches are shown.`} />
      <TableCard
        title="Change log"
        summary={`Showing ${rows.length} of ${matching.length} matching ${matching.length === 1 ? "entry" : "entries"}${matching.length > rows.length ? " — narrow the search to see earlier ones" : ""}`}
        toolbar={
          <>
            <SearchInput placeholder="Search actor, action or summary" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search audit log" />
            <Select className="max-w-[180px]" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by entity">
              <option value="all">All entities</option>
              {entities.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>
            <p className="rts-filter-bar-note" role="status">
              {auditTotal} recorded · append-only
            </p>
          </>
        }
      >
        <DataTable
        rows={rows}
        rowKey={(a) => a.id}
        emptyState={<EmptyState title="No audit entries" body="Changes will appear here as soon as they are made." />}
        columns={auditColumns}
        sort={sort}
        onSortChange={onSortChange}
        />
      </TableCard>
    </div>
  );
}
