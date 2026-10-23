import { useMemo, useState, type FormEvent } from "react";
import type { ClientInput, DriverInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { CLIENT_STATUSES, DRIVER_STATUSES, type Client, type Driver } from "../tms/types";
import { Badge, Button, DataTable, EmptyState, Field, PageHeader, Panel, Select, TextInput, formatDate, todayYmd } from "../ui/primitives";

type Errors = Record<string, string>;

// ---------------- Drivers ----------------

const emptyDriver = (): DriverInput => ({ fullName: "", phone: "", licenceNumber: "", licenceExpiry: "", status: "active" });
const driverToInput = (d: Driver): DriverInput => ({ fullName: d.fullName, phone: d.phone, licenceNumber: d.licenceNumber, licenceExpiry: d.licenceExpiry, status: d.status });

export function DriversPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; driver: Driver } | null>(null);
  const [query, setQuery] = useState("");
  const today = todayYmd();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.drivers.filter((d) => !q || `${d.fullName} ${d.phone} ${d.licenceNumber}`.toLowerCase().includes(q)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [db.drivers, query]);

  const handle = (input: DriverInput): Errors => {
    if (!panel) return {};
    const result = panel.mode === "edit" ? dispatch({ type: "update_driver", id: panel.driver.id, input }) : dispatch({ type: "create_driver", input });
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
        actions={allowed("drivers:create") ? <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add driver</Button> : undefined}
      />
      <div className="mb-3">
        <TextInput className="max-w-xs" placeholder="Search name, phone, licence" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search drivers" />
      </div>
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
      {panel && (
        <DriverForm key={panel.mode === "edit" ? panel.driver.id : "create"} title={panel.mode === "edit" ? `Edit ${panel.driver.fullName}` : "Add driver"} initial={panel.mode === "edit" ? driverToInput(panel.driver) : emptyDriver()} onClose={() => setPanel(null)} onSubmit={handle} />
      )}
    </div>
  );
}

function DriverForm({ initial, title, onClose, onSubmit }: { initial: DriverInput; title: string; onClose: () => void; onSubmit: (input: DriverInput) => Errors }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<DriverInput>) => setValues({ ...values, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors(onSubmit(values));
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

const emptyClient = (): ClientInput => ({ name: "", contactName: "", contactPhone: "", contactEmail: "", status: "active" });
const clientToInput = (c: Client): ClientInput => ({ name: c.name, contactName: c.contactName, contactPhone: c.contactPhone, contactEmail: c.contactEmail, status: c.status });

export function ClientsPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | null>(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.clients.filter((c) => !q || `${c.name} ${c.contactName} ${c.contactEmail}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [db.clients, query]);

  const handle = (input: ClientInput): Errors => {
    if (!panel) return {};
    const result = panel.mode === "edit" ? dispatch({ type: "update_client", id: panel.client.id, input }) : dispatch({ type: "create_client", input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setPanel(null);
    return result.ok ? {} : result.errors;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Master data"
        title="Corporate clients"
        description="Organisations served by staff busing and bus rentals. Contracts, routes and billing attach to these records in later phases."
        actions={allowed("clients:create") ? <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add client</Button> : undefined}
      />
      <div className="mb-3">
        <TextInput className="max-w-xs" placeholder="Search client or contact" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search clients" />
      </div>
      <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        emptyState={<EmptyState title={db.clients.length ? "No clients match" : "No clients yet"} body="Add the organisations you transport staff for or hire vehicles to." />}
        columns={[
          { key: "name", header: "Client", render: (c) => <span className="font-semibold text-stone-900">{c.name}</span> },
          { key: "contact", header: "Contact", render: (c) => c.contactName || <span className="text-stone-400">-</span> },
          { key: "phone", header: "Phone", render: (c) => c.contactPhone || <span className="text-stone-400">-</span> },
          { key: "email", header: "Email", render: (c) => c.contactEmail || <span className="text-stone-400">-</span> },
          { key: "status", header: "Status", render: (c) => <Badge tone={c.status === "active" ? "success" : "neutral"}>{c.status}</Badge> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (c) => (allowed("clients:update") ? <Button variant="ghost" onClick={() => setPanel({ mode: "edit", client: c })}>Edit</Button> : null),
          },
        ]}
      />
      {panel && (
        <ClientForm key={panel.mode === "edit" ? panel.client.id : "create"} title={panel.mode === "edit" ? `Edit ${panel.client.name}` : "Add client"} initial={panel.mode === "edit" ? clientToInput(panel.client) : emptyClient()} onClose={() => setPanel(null)} onSubmit={handle} />
      )}
    </div>
  );
}

function ClientForm({ initial, title, onClose, onSubmit }: { initial: ClientInput; title: string; onClose: () => void; onSubmit: (input: ClientInput) => Errors }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<ClientInput>) => setValues({ ...values, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors(onSubmit(values));
  };
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client name" error={errors.name}><TextInput value={values.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors.name} autoFocus /></Field>
        <Field label="Contact person"><TextInput value={values.contactName} onChange={(e) => set({ contactName: e.target.value })} /></Field>
        <Field label="Contact phone"><TextInput value={values.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} inputMode="tel" /></Field>
        <Field label="Contact email" error={errors.contactEmail}><TextInput type="email" value={values.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} invalid={!!errors.contactEmail} /></Field>
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
