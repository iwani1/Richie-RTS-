import { useMemo, useState, type FormEvent } from "react";
import type { CommandResult } from "../tms/service";
import { daysUntil, documentStatus, type CreateDocumentInput, type DocumentStatus, type UpdateDocumentInput } from "../tms/compliance";
import { dueReminders, reminderCounts, reminderLine, reminderTiming } from "../tms/documentReminders";
import type { ComplianceDocument } from "../tms/types";
import { useTms } from "../tms/useTms";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  Select,
  Stat,
  TableCard,
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

type StatusFilter = "all" | DocumentStatus;
type OwnerFilter = "all" | "vehicle" | "driver";

const STATUS_LABEL: Record<DocumentStatus, string> = {
  expired: "Expired",
  expiring_soon: "Expiring soon",
  valid: "Valid",
  unknown: "Unknown",
};
const STATUS_TONE: Record<DocumentStatus, "error" | "warning" | "success" | "neutral"> = {
  expired: "error",
  expiring_soon: "warning",
  valid: "success",
  unknown: "neutral",
};

export function CompliancePage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const today = todayYmd();
  const leadDays = db.settings.documentReminderLeadDays;
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [panel, setPanel] = useState<
    { mode: "create" } | { mode: "edit"; doc: ComplianceDocument } | { mode: "renew"; doc: ComplianceDocument } | null
  >(null);
  // FLT-03, D-110: the papers that are running out, soonest first, and who has taken each one on.
  const renewals = dueReminders(db, leadDays, today);
  const renewalCounts = reminderCounts(db, leadDays, today);

  const ownerName = (doc: ComplianceDocument) =>
    doc.ownerType === "vehicle" ? db.vehicles.find((v) => v.id === doc.ownerId)?.registration ?? "Unknown vehicle" : db.drivers.find((d) => d.id === doc.ownerId)?.fullName ?? "Unknown driver";
  const typeName = (doc: ComplianceDocument) => db.settings.documentTypes.find((t) => t.id === doc.documentTypeId)?.name ?? "Unknown type";

  const rows = useMemo(
    () =>
      db.documents
        .map((doc) => ({ doc, status: documentStatus(doc.expiryDate, leadDays, today) }))
        .filter((r) => ownerFilter === "all" || r.doc.ownerType === ownerFilter)
        .filter((r) => statusFilter === "all" || r.status === statusFilter)
        .sort((a, b) => (a.doc.expiryDate < b.doc.expiryDate ? -1 : a.doc.expiryDate > b.doc.expiryDate ? 1 : 0)),
    [db.documents, leadDays, today, ownerFilter, statusFilter],
  );

  const counts = useMemo(() => {
    const all = db.documents.map((doc) => documentStatus(doc.expiryDate, leadDays, today));
    return {
      expired: all.filter((s) => s === "expired").length,
      expiringSoon: all.filter((s) => s === "expiring_soon").length,
      valid: all.filter((s) => s === "valid").length,
      total: all.length,
    };
  }, [db.documents, leadDays, today]);

  const typesConfigured = db.settings.documentTypes.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Fleet compliance"
        title="Vehicle & driver documents"
        description="Insurance, roadworthy certificates and other paperwork the company tracks. Status is as of today; records are evidence, not a prediction."
      />

      {!typesConfigured && (
        <Notice tone="warning" title="Not configured" className="mb-4">
          No document types exist yet. An administrator must add at least one in Settings before any document can be recorded (OPEN_QUESTIONS Q-16).
        </Notice>
      )}
      {typesConfigured && leadDays === null && (
        <Notice tone="info" className="mb-4">
          No reminder lead time is set, so only already-expired documents are flagged below. Set one in Settings to also see documents expiring soon.
        </Notice>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Expired" value={counts.expired} caption="as of today" />
        <Stat label="Expiring soon" value={leadDays === null ? "Not configured" : counts.expiringSoon} caption={leadDays === null ? "set a lead time in Settings" : `within ${leadDays} day(s)`} />
        <Stat label="Valid" value={counts.valid} caption="as of today" />
        <Stat label="Total recorded" value={counts.total} caption="vehicle and driver documents" />
      </div>

      {typesConfigured && (
        <TableCard
          title="Renewals"
          summary={
            renewals.length === 0
              ? "Nothing is running out"
              : `${renewalCounts.due} due · ${renewalCounts.expired} lapsed · ${renewalCounts.untaken} nobody has taken on`
          }
          actions={
            leadDays === null ? (
              <span className="rts-filter-bar-note">No lead time set: only lapsed papers appear here</span>
            ) : (
              <span className="rts-filter-bar-note">{`Within ${leadDays} day${leadDays === 1 ? "" : "s"}, as set in Settings`}</span>
            )
          }
        >
          {/* A reminder here is a record, not a message (D-110): nobody can email from this program,
              so the register keeps what a reminder is for — who has seen it, and what they are doing. */}
          <DataTable
            rows={renewals}
            rowKey={(entry) => entry.document.id}
            emptyState={
              <EmptyState
                title={db.documents.length ? "Nothing is running out" : "No documents recorded"}
                body={
                  db.documents.length
                    ? "Every paper on the register is either in date beyond the reminder lead time, or there is no lead time set and nothing has lapsed."
                    : "Record a document and its expiry date; the papers that need renewing will appear here."
                }
              />
            }
            columns={[
              {
                key: "paper",
                header: "Paper",
                render: (entry) => (
                  <span className="block">
                    <span className="font-medium">{typeName(entry.document)}</span>
                    <span className="block text-xs text-muted-foreground">{ownerName(entry.document)}</span>
                  </span>
                ),
              },
              {
                key: "expiry",
                header: "Expires",
                render: (entry) => (
                  <span className="block">
                    <span className={entry.status === "expired" ? "text-red-700" : undefined}>{formatDate(entry.document.expiryDate)}</span>
                    <span className="block text-xs text-muted-foreground">{reminderTiming(entry.days)}</span>
                  </span>
                ),
              },
              {
                key: "taken",
                header: "Taken on",
                render: (entry) =>
                  entry.takenOn ? (
                    <span className="text-xs text-muted-foreground">{reminderLine(entry.takenOn)}</span>
                  ) : (
                    <span className="text-xs rts-unset">Nobody has taken it on</span>
                  ),
              },
              {
                key: "action",
                header: "",
                className: "text-right",
                render: (entry) =>
                  allowed("documents:update") ? (
                    <Button variant={entry.takenOn ? "ghost" : "primary"} onClick={() => setPanel({ mode: "renew", doc: entry.document })}>
                      {entry.takenOn ? "Update" : "Take it on"}
                    </Button>
                  ) : null,
              },
            ]}
          />
        </TableCard>
      )}

      <TableCard
        title="Document register"
        summary={`${rows.length} of ${counts.total} shown · ${counts.expired} expired · ${counts.valid} valid`}
        actions={
          allowed("documents:create") ? (
            <Button variant="primary" disabled={!typesConfigured} onClick={() => setPanel({ mode: "create" })}>
              Record a document
            </Button>
          ) : undefined
        }
        toolbar={
          <>
            <Select className="max-w-[160px]" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value as OwnerFilter)} aria-label="Filter by owner type">
              <option value="all">All owners</option>
              <option value="vehicle">Vehicles</option>
              <option value="driver">Drivers</option>
            </Select>
            <Select className="max-w-[180px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option value="expired">Expired</option>
              <option value="expiring_soon">Expiring soon</option>
              <option value="valid">Valid</option>
            </Select>
            <p className="rts-filter-bar-note" role="status">
              {leadDays === null ? "No reminder lead time set" : `Expiring soon means within ${leadDays} day${leadDays === 1 ? "" : "s"}`}
            </p>
          </>
        }
      >
      <DataTable
        rows={rows}
        rowKey={(r) => r.doc.id}
        emptyState={<EmptyState title={db.documents.length ? "No documents match" : "No documents recorded"} body="Document records for vehicles and drivers will appear here once added." />}
        columns={[
          { key: "owner", header: "Owner", render: (r) => <span className="font-medium">{ownerName(r.doc)}</span> },
          { key: "type", header: "Document type", render: (r) => typeName(r.doc) },
          { key: "number", header: "Number", render: (r) => (r.doc.documentNumber || <span className="text-dim">-</span>) },
          { key: "issued", header: "Issued", render: (r) => (r.doc.issuedDate ? formatDate(r.doc.issuedDate) : <span className="text-dim">-</span>) },
          { key: "expiry", header: "Expires", render: (r) => formatDate(r.doc.expiryDate) },
          {
            key: "days",
            header: "Timing",
            render: (r) => {
              const days = daysUntil(r.doc.expiryDate, today);
              if (days === null) return <span className="text-muted-foreground">unreadable date</span>;
              const label = days === 0 ? "expires today" : days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`;
              return <span className={`rts-mono ${days < 0 ? "text-red-700" : "text-muted-foreground"}`}>{label}</span>;
            },
          },
          { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (r) => (allowed("documents:update") ? <Button variant="ghost" onClick={() => setPanel({ mode: "edit", doc: r.doc })}>Edit</Button> : null),
          },
        ]}
        />
      </TableCard>

      {panel?.mode === "create" && <CreateDocumentForm onClose={() => setPanel(null)} onSubmit={async (input) => dispatch({ type: "create_document", input })} notify={setFlash} onClosed={() => setPanel(null)} />}
      {panel?.mode === "renew" && (
        <TakeOnRenewalForm
          doc={panel.doc}
          paperName={typeName(panel.doc)}
          ownerName={ownerName(panel.doc)}
          onSubmit={async (input) => dispatch({ type: "acknowledge_document_reminder", input })}
          notify={setFlash}
          onClosed={() => setPanel(null)}
        />
      )}
      {panel?.mode === "edit" && (
        <EditDocumentForm
          doc={panel.doc}
          ownerName={ownerName(panel.doc)}
          typeName={typeName(panel.doc)}
          onSubmit={async (input) => dispatch({ type: "update_document", id: panel.doc.id, input })}
          notify={setFlash}
          onClosed={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function CreateDocumentForm({
  onSubmit,
  notify,
  onClosed,
}: {
  onClose: () => void;
  onSubmit: (input: CreateDocumentInput) => Promise<CommandResult>;
  notify: ReturnType<typeof useTms>["setFlash"];
  onClosed: () => void;
}) {
  const { db } = useTms();
  const [values, setValues] = useState<CreateDocumentInput>({
    ownerType: "vehicle",
    ownerId: "",
    documentTypeId: "",
    documentNumber: "",
    issuedDate: "",
    expiryDate: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const applicableTypes = db.settings.documentTypes.filter((t) => t.appliesTo === "both" || t.appliesTo === values.ownerType);
  const owners = values.ownerType === "vehicle" ? db.vehicles : db.drivers;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(values);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel title="Record a document" description="Owner and document type cannot be changed once recorded. Edit the record later only to update its number, dates or notes." onClose={onClosed}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Owner type" error={errors.ownerType}>
          <Select value={values.ownerType} onChange={(e) => setValues({ ...values, ownerType: e.target.value as "vehicle" | "driver", ownerId: "", documentTypeId: "" })} invalid={!!errors.ownerType}>
            <option value="vehicle">Vehicle</option>
            <option value="driver">Driver</option>
          </Select>
        </Field>
        <Field label={values.ownerType === "vehicle" ? "Vehicle" : "Driver"} error={errors.ownerId}>
          <Select value={values.ownerId} onChange={(e) => setValues({ ...values, ownerId: e.target.value })} invalid={!!errors.ownerId}>
            <option value="">Select {values.ownerType === "vehicle" ? "a vehicle" : "a driver"}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {"registration" in o ? o.registration : o.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Document type" error={errors.documentTypeId} hint={applicableTypes.length === 0 ? `No document types apply to ${values.ownerType}s yet.` : undefined}>
          <Select value={values.documentTypeId} onChange={(e) => setValues({ ...values, documentTypeId: e.target.value })} invalid={!!errors.documentTypeId}>
            <option value="">Select a document type</option>
            {applicableTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        {applicableTypes.find((t) => t.id === values.documentTypeId)?.required && (
          <p className="text-xs text-muted-foreground">
            The company requires this document: a {values.ownerType} cannot be assigned while it is missing or has expired on the day of the work. A record entered today with a past expiry date will not clear that block.
          </p>
        )}
        <Field label="Document number (optional)" error={errors.documentNumber}>
          <TextInput value={values.documentNumber} onChange={(e) => setValues({ ...values, documentNumber: e.target.value })} invalid={!!errors.documentNumber} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issued date (optional)" error={errors.issuedDate}>
            <TextInput type="date" value={values.issuedDate} onChange={(e) => setValues({ ...values, issuedDate: e.target.value })} invalid={!!errors.issuedDate} />
          </Field>
          <Field label="Expiry date" error={errors.expiryDate}>
            <TextInput type="date" value={values.expiryDate} onChange={(e) => setValues({ ...values, expiryDate: e.target.value })} invalid={!!errors.expiryDate} />
          </Field>
        </div>
        <Field label="Notes (optional)" error={errors.notes}>
          <TextArea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} invalid={!!errors.notes} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">Record document</Button>
        </div>
      </form>
    </Panel>
  );
}

function EditDocumentForm({
  doc,
  ownerName,
  typeName,
  onSubmit,
  notify,
  onClosed,
}: {
  doc: ComplianceDocument;
  ownerName: string;
  typeName: string;
  onSubmit: (input: UpdateDocumentInput) => Promise<CommandResult>;
  notify: ReturnType<typeof useTms>["setFlash"];
  onClosed: () => void;
}) {
  const [values, setValues] = useState<UpdateDocumentInput>({
    documentNumber: doc.documentNumber,
    issuedDate: doc.issuedDate ?? "",
    expiryDate: doc.expiryDate,
    notes: doc.notes,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(values);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel title={`Edit document: ${typeName}`} description={`${ownerName}. Owner and document type are fixed; only the record details can change.`} onClose={onClosed}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Document number (optional)" error={errors.documentNumber}>
          <TextInput value={values.documentNumber} onChange={(e) => setValues({ ...values, documentNumber: e.target.value })} invalid={!!errors.documentNumber} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Issued date (optional)" error={errors.issuedDate}>
            <TextInput type="date" value={values.issuedDate} onChange={(e) => setValues({ ...values, issuedDate: e.target.value })} invalid={!!errors.issuedDate} />
          </Field>
          <Field label="Expiry date" error={errors.expiryDate}>
            <TextInput type="date" value={values.expiryDate} onChange={(e) => setValues({ ...values, expiryDate: e.target.value })} invalid={!!errors.expiryDate} />
          </Field>
        </div>
        <Field label="Notes (optional)" error={errors.notes}>
          <TextArea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} invalid={!!errors.notes} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">Save changes</Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Somebody taking a paper's renewal on (FLT-03, D-110).
 *
 * Two fields, because a reminder is only worth recording if it says what is being done and when it
 * is expected. Both are written into the audit log with the person's name, and the register shows the
 * line beside the paper until the expiry date changes — a renewal that is recorded replaces it.
 */
function TakeOnRenewalForm({
  doc,
  paperName,
  ownerName,
  onSubmit,
  notify,
  onClosed,
}: {
  doc: ComplianceDocument;
  paperName: string;
  ownerName: string;
  onSubmit: (input: { documentId: string; note: string; expectedBy: string }) => Promise<CommandResult>;
  notify: ReturnType<typeof useTms>["setFlash"];
  onClosed: () => void;
}) {
  const [note, setNote] = useState("");
  const [expectedBy, setExpectedBy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit({ documentId: doc.id, note, expectedBy });
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Take on the renewal: ${paperName}`}
      description={`${ownerName} — expires ${formatDate(doc.expiryDate)}. This program cannot send an email or a text message, so a reminder here is a record of who has seen the paper is running out and what they are doing about it.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="What is being done?" hint="Recorded with your name. " error={errors.note}>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} invalid={!!errors.note} autoFocus />
        </Field>
        <Field
          label="Expected by"
          hint="Optional. The date you expect the new paper; the register shows it beside the paper."
          error={errors.expectedBy}
        >
          <TextInput type="date" value={expectedBy} onChange={(e) => setExpectedBy(e.target.value)} invalid={!!errors.expectedBy} />
        </Field>
        {errors.documentId && <Notice tone="warning">{errors.documentId}</Notice>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Take it on
          </Button>
        </div>
      </form>
    </Panel>
  );
}
