import { useMemo, useState, type FormEvent } from "react";
import type { ClientInput, DriverInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { CLIENT_STATUSES, CLIENT_TYPE_LABELS, CLIENT_TYPES, DRIVER_STATUSES, type Client, type ClientType, type Driver } from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, PageHeader, Panel, SearchInput, Select, TableCard, TextArea, TextInput, formatDate, todayYmd } from "../ui/primitives";
import { ImportPanel } from "../ui/ImportPanel";

type Errors = Record<string, string>;

// ---------------- Drivers ----------------

const emptyDriver = (): DriverInput => ({ fullName: "", phone: "", licenceNumber: "", licenceExpiry: "", status: "active" });
const driverToInput = (d: Driver): DriverInput => ({ fullName: d.fullName, phone: d.phone, licenceNumber: d.licenceNumber, licenceExpiry: d.licenceExpiry, status: d.status });

export function DriversPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; driver: Driver } | { mode: "import" } | null>(null);
  const [query, setQuery] = useState("");
  const today = todayYmd();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.drivers.filter((d) => !q || `${d.fullName} ${d.phone} ${d.licenceNumber}`.toLowerCase().includes(q)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [db.drivers, query]);

  const expiredCount = rows.filter((d) => d.licenceExpiry < today).length;

  const handle = async (input: DriverInput): Promise<Errors> => {
    if (!panel) return {};
    const result = panel.mode === "edit" ? await dispatch({ type: "update_driver", id: panel.driver.id, input }) : await dispatch({ type: "create_driver", input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setPanel(null);
    return result.ok ? {} : result.errors;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Drivers"
        description="Driver register with licence details. Driver assignment to trips arrives with the dispatch module."
        actions={
          allowed("drivers:create") ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPanel({ mode: "import" })}>Import CSV</Button>
              <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add driver</Button>
            </div>
          ) : undefined
        }
      />
      <TableCard
        title="Driver register"
        summary={
          expiredCount > 0
            ? `${rows.length} of ${db.drivers.length} shown · ${expiredCount} with an expired licence`
            : `${rows.length} of ${db.drivers.length} shown`
        }
        toolbar={
          <>
            <SearchInput placeholder="Search name, phone, licence" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search drivers" />
            <p className="rts-filter-bar-note" role="status">
              {db.drivers.filter((d) => d.status === "active").length} active · {db.drivers.filter((d) => d.status !== "active").length} inactive or suspended
            </p>
          </>
        }
      >
        <DataTable
        rows={rows}
        rowKey={(d) => d.id}
        emptyState={<EmptyState title={db.drivers.length ? "No drivers match" : "No drivers registered"} body="Add drivers with their licence number and expiry date." />}
        columns={[
          { key: "name", header: "Name", render: (d) => <span className="font-semibold text-stone-900">{d.fullName}</span> },
          { key: "phone", header: "Phone", render: (d) => d.phone },
          { key: "lic", header: "Licence", render: (d) => <span className="font-mono text-xs">{d.licenceNumber}</span> },
          {
            key: "exp",
            header: "Licence expiry",
            render: (d) => (
              <span className="flex items-center gap-2">
                {formatDate(d.licenceExpiry)}
                {d.licenceExpiry < today && <Badge tone="error">Expired</Badge>}
              </span>
            ),
          },
          { key: "status", header: "Status", render: (d) => <Badge tone={d.status === "active" ? "success" : d.status === "suspended" ? "warning" : "neutral"}>{d.status}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (d) => (allowed("drivers:update") ? <Button variant="ghost" onClick={() => setPanel({ mode: "edit", driver: d })}>Edit</Button> : null),
          },
        ]}
        />
      </TableCard>
      {panel && panel.mode === "import" && <ImportPanel kind="drivers" onClose={() => setPanel(null)} />}
      {panel && panel.mode !== "import" && (
          <DriverForm key={panel.mode === "edit" ? panel.driver.id : "create"} title={panel.mode === "edit" ? `Edit ${panel.driver.fullName}` : "Add driver"} initial={panel.mode === "edit" ? driverToInput(panel.driver) : emptyDriver()} onClose={() => setPanel(null)} onSubmit={handle} />
      )}
    </div>
  );
}

function DriverForm({ initial, title, onClose, onSubmit }: { initial: DriverInput; title: string; onClose: () => void; onSubmit: (input: DriverInput) => Errors | Promise<Errors> }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<DriverInput>) => setValues({ ...values, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(await onSubmit(values));
  };
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" error={errors.fullName}><TextInput value={values.fullName} onChange={(e) => set({ fullName: e.target.value })} invalid={!!errors.fullName} autoFocus /></Field>
        <Field label="Phone" error={errors.phone}><TextInput value={values.phone} onChange={(e) => set({ phone: e.target.value })} invalid={!!errors.phone} inputMode="tel" /></Field>
        <Field label="Licence number" error={errors.licenceNumber}><TextInput value={values.licenceNumber} onChange={(e) => set({ licenceNumber: e.target.value })} invalid={!!errors.licenceNumber} /></Field>
        <Field label="Licence expiry" error={errors.licenceExpiry}><TextInput type="date" value={values.licenceExpiry} onChange={(e) => set({ licenceExpiry: e.target.value })} invalid={!!errors.licenceExpiry} /></Field>
        <Field label="Status" error={errors.status}>
          <Select value={values.status} onChange={(e) => set({ status: e.target.value as DriverInput["status"] })}>
            {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save driver</Button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------- Clients ----------------

const emptyClient = (): ClientInput => ({
  reference: "",
  name: "",
  type: null,
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  billingAddress: "",
  tin: "",
  notes: "",
  status: "active",
});
const clientToInput = (c: Client): ClientInput => ({
  reference: c.reference,
  name: c.name,
  type: c.type,
  contactName: c.contactName,
  contactPhone: c.contactPhone,
  contactEmail: c.contactEmail,
  billingAddress: c.billingAddress,
  tin: c.tin,
  notes: c.notes,
  status: c.status,
});

export function ClientsPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | { mode: "import" } | { mode: "history"; client: Client } | null>(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.clients
      .filter((c) => !q || `${c.reference} ${c.name} ${c.contactName} ${c.contactEmail} ${c.tin}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.clients, query]);

  const handle = async (input: ClientInput): Promise<Errors> => {
    if (!panel) return {};
    const result = panel.mode === "edit" ? await dispatch({ type: "update_client", id: panel.client.id, input }) : await dispatch({ type: "create_client", input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setPanel(null);
    return result.ok ? {} : result.errors;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Corporate clients"
        description="Organisations served by staff busing and bus rentals. Routes, agreements and billing attach to these records; the agreement itself is drafted on the Contracts screen."
        actions={
          allowed("clients:create") ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setPanel({ mode: "import" })}>Import CSV</Button>
              <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add client</Button>
            </div>
          ) : undefined
        }
      />
      <TableCard
        title="Client register"
        summary={`${rows.length} of ${db.clients.length} shown · ${db.clients.filter((c) => c.status === "active").length} active`}
        toolbar={
          <SearchInput placeholder="Search client or contact" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search clients" />
        }
      >
        <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        emptyState={<EmptyState title={db.clients.length ? "No clients match" : "No clients yet"} body="Add the organisations you transport staff for or hire vehicles to." />}
        columns={[
          {
            key: "name",
            header: "Client",
            render: (c) => (
              <span className="flex flex-col">
                <span className="font-semibold text-stone-900">{c.name}</span>
                <span className="text-xs text-stone-600">
                  {c.reference ? <span className="rts-mono">{c.reference}</span> : <em className="rts-unset">no code</em>}
                  {" · "}
                  {c.type ? CLIENT_TYPE_LABELS[c.type] : <em className="rts-unset">type not recorded</em>}
                </span>
              </span>
            ),
          },
          {
            key: "contact",
            header: "Contact",
            render: (c) => {
              const accounts = db.users.filter((u) => u.clientId === c.id && u.role === "client_contact");
              const primary = accounts.find((u) => u.primaryContact);
              return (
                <div>
                  {c.contactName || <span className="text-stone-400">-</span>}
                  {accounts.length > 0 && (
                    <div className="text-[11px] text-stone-500">
                      {accounts.length} contact account{accounts.length === 1 ? "" : "s"}
                      {primary ? ` · ${primary.fullName} is primary` : " · none marked primary"}
                    </div>
                  )}
                </div>
              );
            },
          },
          { key: "phone", header: "Phone", render: (c) => c.contactPhone || <span className="text-stone-400">-</span> },
          { key: "email", header: "Email", render: (c) => c.contactEmail || <span className="text-stone-400">-</span> },
          {
            key: "billing",
            header: "Billing",
            render: (c) =>
              c.billingAddress || c.tin ? (
                <span className="flex flex-col text-xs">
                  {c.billingAddress && <span className="text-stone-700">{c.billingAddress}</span>}
                  {c.tin ? <span className="rts-mono text-stone-600">TIN {c.tin}</span> : <em className="rts-unset">no tax number</em>}
                </span>
              ) : (
                <em className="rts-unset">not recorded</em>
              ),
          },
          { key: "status", header: "Status", render: (c) => <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (c) => (
              <span className="flex justify-end gap-1">
                <Button variant="ghost" onClick={() => setPanel({ mode: "history", client: c })} aria-label={`History of ${c.name}`}>
                  History
                </Button>
                {allowed("clients:update") ? <Button variant="ghost" onClick={() => setPanel({ mode: "edit", client: c })}>Edit</Button> : null}
              </span>
            ),
          },
        ]}
        />
      </TableCard>
      {panel && panel.mode === "import" && <ImportPanel kind="clients" onClose={() => setPanel(null)} />}
      {panel && panel.mode === "history" && <ClientHistory client={panel.client} onClose={() => setPanel(null)} />}
      {panel && panel.mode !== "import" && (
          <ClientForm key={panel.mode === "edit" ? panel.client.id : "create"} title={panel.mode === "edit" ? `Edit ${panel.client.name}` : "Add client"} initial={panel.mode === "edit" ? clientToInput(panel.client) : emptyClient()} onClose={() => setPanel(null)} onSubmit={handle} />
      )}
    </div>
  );
}

function ClientForm({ initial, title, onClose, onSubmit }: { initial: ClientInput; title: string; onClose: () => void; onSubmit: (input: ClientInput) => Errors | Promise<Errors> }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<ClientInput>) => setValues({ ...values, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(await onSubmit(values));
  };
  return (
    <Panel
      title={title}
      description="The billing details here are what an invoice prints. They are copied onto the invoice when it is issued, so editing them later never rewrites a document that has already gone out."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name" error={errors.name}>
            <TextInput value={values.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Customer code" hint="The code you already use for them. Optional." error={errors.reference}>
            <TextInput value={values.reference} onChange={(e) => set({ reference: e.target.value })} invalid={!!errors.reference} />
          </Field>
        </div>
        <Field label="Customer is" error={errors.type} hint="Left unrecorded, the register says so rather than assuming a company.">
          <Select value={values.type ?? ""} onChange={(e) => set({ type: (e.target.value || null) as ClientType | null })} aria-label="Customer is">
            <option value="">Not recorded</option>
            {CLIENT_TYPES.map((option) => (
              <option key={option} value={option}>{CLIENT_TYPE_LABELS[option]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Contact person"><TextInput value={values.contactName} onChange={(e) => set({ contactName: e.target.value })} /></Field>
        <Field label="Contact phone"><TextInput value={values.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} inputMode="tel" /></Field>
        <Field label="Contact email" error={errors.contactEmail}><TextInput type="email" value={values.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} invalid={!!errors.contactEmail} /></Field>
        <Field label="Billing address" hint="Printed on invoices as typed." error={errors.billingAddress}>
          <TextArea value={values.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} invalid={!!errors.billingAddress} />
        </Field>
        <Field label="Tax identification number" hint="Optional. Printed on invoices when a company has one." error={errors.tin}>
          <TextInput value={values.tin} onChange={(e) => set({ tin: e.target.value })} invalid={!!errors.tin} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <TextArea value={values.notes} onChange={(e) => set({ notes: e.target.value })} invalid={!!errors.notes} />
        </Field>
        <Field label="Status" error={errors.status}>
          <Select value={values.status} onChange={(e) => set({ status: e.target.value as ClientInput["status"] })}>
            {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save client</Button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * A customer's history, read from the audit log (CUS-01).
 *
 * The register has no separate history table, and it should not: every change to a client already
 * writes an audit entry with the person and the minute. Showing them here means the answer to "who
 * changed this customer's billing address?" is on the record itself rather than in a screen nobody
 * thinks to open. It is read-only, and it says so.
 */
function ClientHistory({ client, onClose }: { client: Client; onClose: () => void }) {
  const { db } = useTms();
  const entries = db.audit.filter((entry) => entry.entity === "client" && entry.entityId === client.id);

  return (
    <Panel title={`History of ${client.name}`} description="Every change recorded against this customer, newest first. Read-only: history is written by the change itself." onClose={onClose}>
      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" body="This customer was added before the audit trail reached this screen, or has not been changed since." />
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-b border-stone-200 pb-3 last:border-0 last:pb-0">
              <p className="text-xs text-stone-600">
                <span className="rts-mono">{formatDate(entry.at.slice(0, 10))}</span> · {entry.actorName}
              </p>
              <p className="text-sm text-stone-800">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="flex justify-end pt-4">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Panel>
  );
}
