import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, type UserInput } from "../tms/service";
import { useTms } from "../tms/useTms";
import { ROLES, ROLE_LABELS, type User } from "../tms/types";
import { ROLE_PERMISSIONS } from "../tms/permissions";
import { Badge, Band, Button, DataTable, EmptyState, Field, Notice, PageHeader, Panel, PasswordInput, Select, TableCard, TextInput, formatDateTime } from "../ui/primitives";

type Errors = Record<string, string>;
type PanelState = { mode: "create" } | { mode: "edit"; user: User } | { mode: "reset"; user: User } | null;

export function UsersPage() {
  const { db, actor, allowed, dispatch, setFlash, exportBackup } = useTms();
  const [panel, setPanel] = useState<PanelState>(null);

  const download = async () => {
    // The export is recorded in the audit log first: data leaving the system is a permissioned
    // event, and the server decides whether this role may do it. The file is the redacted
    // snapshot, so it contains no password hashes.
    const json = await exportBackup();
    if (!json) {
      setFlash({ tone: "error", message: "The export was refused. Check your permissions and sign in again." });
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `richie-tms-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFlash({ tone: "success", message: "Export downloaded and recorded in the audit log. It contains personal data but no credentials - store it securely." });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Users and roles"
        description="Accounts are created by administrators. Permissions are fixed per role (see Role permissions below)."
        actions={allowed("users:create") ? <Button variant="primary" onClick={() => setPanel({ mode: "create" })}>Add user</Button> : undefined}
      />

      <TableCard
        title="Accounts"
        summary={`${db.users.length} account${db.users.length === 1 ? "" : "s"} · ${db.users.filter((u) => u.active).length} active · ${db.users.filter((u) => u.role === "administrator").length} administrator${db.users.filter((u) => u.role === "administrator").length === 1 ? "" : "s"}`}
      >
      <DataTable
        rows={[...db.users].sort((a, b) => a.fullName.localeCompare(b.fullName))}
        rowKey={(u) => u.id}
        emptyState={<EmptyState title="No users" body="This should not happen after setup." />}
        columns={[
          { key: "name", header: "Name", render: (u) => <span className="font-semibold text-foreground">{u.fullName}{u.id === actor?.id && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(you)</span>}</span> },
          { key: "email", header: "Email", render: (u) => u.email },
          { key: "role", header: "Role", render: (u) => ROLE_LABELS[u.role] },
          {
            key: "record",
            header: "Acts for",
            render: (u) => {
              if (u.role === "driver") {
                const driver = db.drivers.find((d) => d.id === u.driverId);
                return driver ? driver.fullName : <span className="text-dim">-</span>;
              }
              if (u.role === "client_contact") {
                const client = db.clients.find((c) => c.id === u.clientId);
                if (!client) return <span className="text-dim">-</span>;
                return (
                  <span className="flex flex-wrap items-center gap-1">
                    {client.name}
                    {u.primaryContact && <Badge tone="info">Primary</Badge>}
                    {u.primaryContact && !u.active && <span className="text-[11px] text-muted-foreground">(inactive - ring someone else)</span>}
                  </span>
                );
              }
              if (u.role === "passenger") {
                // A rider account is one employee, not a company: the name alone is the answer.
                const rider = db.passengers.find((p) => p.id === u.passengerId);
                if (!rider) return <span className="text-dim">-</span>;
                const client = db.clients.find((c) => c.id === rider.clientId);
                return (
                  <span>
                    {rider.fullName}
                    <span className="block text-[11px] text-muted-foreground">{client ? `${client.name} · ${rider.employeeRef}` : rider.employeeRef}</span>
                  </span>
                );
              }
              return <span className="text-dim">Whole company</span>;
            },
          },
          { key: "status", header: "Status", render: (u) => <Badge tone={u.active ? "success" : "neutral"}>{u.active ? "Active" : "Inactive"}</Badge> },
          { key: "created", header: "Created", render: (u) => <span className="text-xs text-muted-foreground">{formatDateTime(u.createdAt)}</span> },
          {
            key: "actions",
            header: "",
            className: "text-right",
            render: (u) =>
              allowed("users:update") ? (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => setPanel({ mode: "edit", user: u })}>Edit</Button>
                  <Button variant="ghost" onClick={() => setPanel({ mode: "reset", user: u })}>Reset password</Button>
                </div>
              ) : null,
          },
        ]}
      />
      </TableCard>

      <Band label="Role permissions" note="resource:action strings enforced by the service layer. All Phase 1A permissions are company-scoped.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-1 pr-3">Role</th><th className="py-1">Permissions</th></tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {ROLES.map((role) => (
                <tr key={role}>
                  <td className="py-2 pr-3 align-top font-semibold text-foreground">{ROLE_LABELS[role]}</td>
                  <td className="py-2 text-muted-foreground">
                    {ROLE_PERMISSIONS[role].length ? (
                      <span className="flex flex-wrap gap-1">{ROLE_PERMISSIONS[role].map((p) => <code key={p} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px]">{p}</code>)}</span>
                    ) : (
                      <span className="italic text-dim">No master-data permissions in Phase 1A; record-scoped features planned.</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Band>

      {allowed("backup:export") && (
        <Band
          label="Data export"
          note="Downloads a redacted JSON copy of every record (no password hashes) and records the export in the audit log. Restoring is a server operation: run `npm run db:restore -- <file>` on the host that runs the application, because a browser must not be able to overwrite a shared database."
        >
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void download()}>Download export (JSON)</Button>
          </div>
        </Band>
      )}

      {panel?.mode === "create" && (
        <UserForm
          title="Add user"
          initial={{ fullName: "", email: "", role: "operations", active: true, primaryContact: false }}
          withPassword
          onClose={() => setPanel(null)}
          onSubmit={async (input, password) => {
            // The password travels once, over the same-origin HTTPS connection, and the server
            // hashes it with Argon2id. Nothing here can mint a credential.
            const result = await dispatch({ type: "create_user", input, password });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel?.mode === "edit" && (
        <UserForm
          key={panel.user.id}
          currentUserId={panel.user.id}
          title={`Edit ${panel.user.fullName}`}
          initial={{ fullName: panel.user.fullName, email: panel.user.email, role: panel.user.role, active: panel.user.active, driverId: panel.user.driverId, clientId: panel.user.clientId, passengerId: panel.user.passengerId, primaryContact: panel.user.primaryContact }}
          onClose={() => setPanel(null)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "update_user", id: panel.user.id, input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
      {panel?.mode === "reset" && (
        <ResetForm
          user={panel.user}
          onClose={() => setPanel(null)}
          onSubmit={async (password) => {
            const result = await dispatch({ type: "reset_user_password", id: panel.user.id, password });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setPanel(null);
            return result.ok ? {} : result.errors;
          }}
        />
      )}
    </div>
  );
}

function UserForm({ title, initial, currentUserId, withPassword, onClose, onSubmit }: { title: string; initial: UserInput; currentUserId?: string; withPassword?: boolean; onClose: () => void; onSubmit: (input: UserInput, password: string) => Promise<Errors> }) {
  const { db } = useTms();
  const [values, setValues] = useState<UserInput>({ driverId: null, clientId: null, passengerId: null, ...initial });
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<UserInput>) => setValues({ ...values, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors(await onSubmit(values, password));
    setBusy(false);
  };
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" error={errors.fullName}><TextInput value={values.fullName} onChange={(e) => set({ fullName: e.target.value })} invalid={!!errors.fullName} autoFocus /></Field>
        <Field label="Email" error={errors.email}><TextInput type="email" value={values.email} onChange={(e) => set({ email: e.target.value })} invalid={!!errors.email} autoComplete="off" /></Field>
        <Field label="Role" error={errors.role}>
          <Select
            value={values.role}
            onChange={(e) => set({ role: e.target.value as UserInput["role"], driverId: null, clientId: null, passengerId: null, primaryContact: false })}
            invalid={!!errors.role}
          >
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        {values.role === "driver" && (
          <Field label="Linked driver record" hint="Own-record scope: this account sees only this driver's runs and incidents." error={errors.driverId}>
            <Select value={values.driverId ?? ""} onChange={(e) => set({ driverId: e.target.value })} invalid={!!errors.driverId}>
              <option value="">Select a driver</option>
              {db.drivers
                .filter((d) => d.id === values.driverId || !db.users.some((u) => u.driverId === d.id))
                .map((d) => <option key={d.id} value={d.id}>{d.fullName} · {d.licenceNumber}</option>)}
            </Select>
          </Field>
        )}
        {values.role === "client_contact" && (
          <>
            <Field label="Linked client" hint="Own-record scope: this account sees only this client's routes, roster and rental requests." error={errors.clientId}>
              <Select value={values.clientId ?? ""} onChange={(e) => set({ clientId: e.target.value })} invalid={!!errors.clientId}>
                <option value="">Select a client</option>
                {db.clients
                  .map((c) => {
                    // A client often has an operations contact and an accounts contact; each gets
                    // its own login rather than sharing one password (Q-38, D-77).
                    const others = db.users.filter((u) => u.clientId === c.id && u.role === "client_contact" && u.id !== currentUserId);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}{others.length ? ` (${others.length} contact account${others.length === 1 ? "" : "s"})` : ""}
                      </option>
                    );
                  })}
              </Select>
            </Field>
            {/* Not wrapped in Field: Field renders a <label>, and a label inside a label gives the
                checkbox a name nobody can predict. */}
            <div className="block">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.primaryContact === true}
                  disabled={!values.clientId}
                  onChange={(e) => set({ primaryContact: e.target.checked })}
                />
                <span>Primary contact for the linked client</span>
              </label>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {values.clientId
                  ? "The person we ring first about this client's bookings. Marking this account primary takes the mark off any other contact account for the same client."
                  : "Pick a client first."}
              </span>
              {errors.primaryContact && <span className="mt-1 block text-[11px] font-medium text-destructive" role="alert">{errors.primaryContact}</span>}
            </div>
          </>
        )}
        {values.role === "passenger" && (
          <Field
            label="Linked rider record"
            hint="Own-record scope: this account sees only this rider's own journeys, seats and booking references."
            error={errors.passengerId}
          >
            <Select value={values.passengerId ?? ""} onChange={(e) => set({ passengerId: e.target.value })} invalid={!!errors.passengerId}>
              <option value="">Select a rider</option>
              {db.passengers
                .filter((p) => p.id === values.passengerId || !db.users.some((u) => u.passengerId === p.id))
                .map((p) => {
                  const client = db.clients.find((c) => c.id === p.clientId);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.fullName} · {p.employeeRef}{client ? ` · ${client.name}` : ""}
                    </option>
                  );
                })}
            </Select>
          </Field>
        )}
        <Field label="Account status" error={errors.active}>
          <Select value={values.active ? "active" : "inactive"} onChange={(e) => set({ active: e.target.value === "active" })} invalid={!!errors.active}>
            <option value="active">Active</option>
            <option value="inactive">Inactive (cannot sign in)</option>
          </Select>
        </Field>
        {withPassword && (
          <Field label="Initial password" hint={`At least ${PASSWORD_MIN_LENGTH} characters. Share it securely; it is not stored in plain text.`} error={errors.password}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} autoComplete="new-password" />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving..." : "Save user"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function ResetForm({ user, onClose, onSubmit }: { user: User; onClose: () => void; onSubmit: (password: string) => Promise<Errors> }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  return (
    <Panel title={`Reset password: ${user.fullName}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) return setErrors({ confirm: "Passwords do not match." });
          setBusy(true);
          setErrors(await onSubmit(password));
          setBusy(false);
        }}
        className="space-y-4"
      >
        <Notice tone="info">Saving a new password ends every session this user has open. They will be asked to sign in again.</Notice>
        <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} error={errors.password}><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></Field>
        <Field label="Confirm" error={errors.confirm}><PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving..." : "Reset password"}</Button>
        </div>
      </form>
    </Panel>
  );
}
