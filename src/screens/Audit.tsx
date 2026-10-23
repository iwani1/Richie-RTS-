import { useMemo, useState } from "react";
import { useTms } from "../tms/useTms";
import { DataTable, EmptyState, PageHeader, SearchInput, Select, TableCard, formatDateTime } from "../ui/primitives";

export function AuditPage() {
  const { db } = useTms();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");
  const entities = useMemo(() => Array.from(new Set(db.audit.map((a) => a.entity))).sort(), [db.audit]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.audit
      .filter((a) => entity === "all" || a.entity === entity)
      .filter((a) => !q || `${a.actorName} ${a.action} ${a.summary} ${a.entity}`.toLowerCase().includes(q));
  }, [db.audit, query, entity]);
  const rows = useMemo(() => matching.slice(0, 500), [matching]);

  return (
    <div>
      <PageHeader eyebrow="Governance" title="Audit log" description={`Append-only record of every change made through the service layer. ${db.audit.length} entries; the most recent 500 matching entries are shown.`} />
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
              {db.audit.length} recorded · append-only
            </p>
          </>
        }
      >
        <DataTable
        rows={rows}
        rowKey={(a) => a.id}
        emptyState={<EmptyState title="No audit entries" body="Changes will appear here as soon as they are made." />}
        columns={[
          { key: "at", header: "When", className: "whitespace-nowrap", render: (a) => <span className="rts-mono text-stone-600">{formatDateTime(a.at)}</span> },
          { key: "actor", header: "Actor", render: (a) => a.actorName },
          { key: "action", header: "Action", render: (a) => <code className="rts-code">{a.action}</code> },
          { key: "entity", header: "Record", render: (a) => <span className="text-stone-600">{a.entity}</span> },
          { key: "summary", header: "Summary", render: (a) => <span className="text-xs">{a.summary}</span> },
        ]}
        />
      </TableCard>
    </div>
  );
}
