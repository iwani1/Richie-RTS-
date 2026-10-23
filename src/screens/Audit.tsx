import { useMemo, useState } from "react";
import { useTms } from "../tms/useTms";
import { DataTable, EmptyState, PageHeader, Select, TextInput, formatDateTime } from "../ui/primitives";

export function AuditPage() {
  const { db } = useTms();
  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("all");
  const entities = useMemo(() => Array.from(new Set(db.audit.map((a) => a.entity))).sort(), [db.audit]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.audit
      .filter((a) => entity === "all" || a.entity === entity)
      .filter((a) => !q || `${a.actorName} ${a.action} ${a.summary}`.toLowerCase().includes(q))
      .slice(0, 500);
  }, [db.audit, query, entity]);

  return (
    <div>
      <PageHeader eyebrow="Governance" title="Audit log" description={`Append-only record of every change made through the service layer. ${db.audit.length} entries; the most recent 500 matching entries are shown.`} />
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput className="max-w-xs" placeholder="Search actor, action or summary" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search audit log" />
        <Select className="max-w-[180px]" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by entity">
          <option value="all">All entities</option>
          {entities.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
      </div>
      <DataTable
        rows={rows}
        rowKey={(a) => a.id}
        emptyState={<EmptyState title="No audit entries" body="Changes will appear here as soon as they are made." />}
        columns={[
          { key: "at", header: "When", render: (a) => <span className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(a.at)}</span> },
          { key: "actor", header: "Actor", render: (a) => a.actorName },
          { key: "action", header: "Action", render: (a) => <code className="rounded-sm bg-stone-100 px-1 py-0.5 font-mono text-[11px]">{a.action}</code> },
          { key: "summary", header: "Summary", render: (a) => <span className="text-xs">{a.summary}</span> },
        ]}
      />
    </div>
  );
}
