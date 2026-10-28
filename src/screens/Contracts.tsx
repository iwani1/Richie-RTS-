// Contracts: the paper behind a corporate account (brief CLI-02, D-95).
//
// The screen answers three questions in the order a person asks them:
//   1. which agreements are live, and which are about to run out (so a renewal is not discovered on the
//      last day);
//   2. what exactly was agreed with this client — term, service, routes, shifts and the signed pricing
//      and payment terms, transcribed rather than calculated;
//   3. what state is it in, and what may I do next.
//
// The rule the screen keeps visible: an approved contract's terms are frozen. Everything that changes
// after approval is a state move with a reason, and the history under the record shows each one with who
// made it and when. A renegotiated agreement is entered as a new contract that names the one it replaced
// — the edit button simply is not offered on an active record, rather than being offered and refused.
import { useState, type FormEvent } from "react";
import { contractStateOf, contractsDueForRenewal, isContractEditable } from "../tms/contracts";
import type { CommandResult } from "../tms/service";
import {
  CONTRACT_SERVICE_LABELS,
  CONTRACT_SERVICE_TYPES,
  CONTRACT_STATUS_LABELS,
  type Contract,
  type ContractServiceType,
  type ContractState,
  type ContractStatus,
} from "../tms/types";
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STATE_TONE: Record<ContractState, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  pending_approval: "info",
  draft: "neutral",
  suspended: "warning",
  expired: "warning",
  terminated: "neutral",
};

/** What the next step is called, from the record's own state. Null when there is nothing to do. */
function nextSteps(state: ContractState): { to: ContractStatus; label: string }[] {
  switch (state) {
    case "draft":
      return [{ to: "pending_approval", label: "Send for approval" }];
    case "pending_approval":
      return [
        { to: "active", label: "Approve and activate" },
        { to: "draft", label: "Send back to draft" },
      ];
    case "active":
      return [
        { to: "suspended", label: "Suspend" },
        { to: "terminated", label: "Terminate" },
      ];
    case "suspended":
      return [
        { to: "active", label: "Resume" },
        { to: "terminated", label: "Terminate" },
      ];
    case "expired":
      return [{ to: "terminated", label: "Close the record" }];
    case "terminated":
      return [];
  }
}

const term = (contract: Contract) =>
  contract.endDate ? `${formatDate(contract.startDate)} to ${formatDate(contract.endDate)}` : `From ${formatDate(contract.startDate)}, open-ended`;

export function ContractsPage() {
  const { db, allowed } = useTms();
  const today = todayYmd();
  const [filter, setFilter] = useState<"" | ContractState>("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const rows = db.contracts
    .map((contract) => ({ contract, state: contractStateOf(contract, today) }))
    .filter((row) => !filter || row.state === filter)
    .sort((a, b) => (a.contract.startDate < b.contract.startDate ? 1 : a.contract.startDate > b.contract.startDate ? -1 : a.contract.reference.localeCompare(b.contract.reference)));

  const live = db.contracts.filter((contract) => contractStateOf(contract, today) === "active");
  const awaiting = db.contracts.filter((contract) => contract.status === "pending_approval");
  const renewals = contractsDueForRenewal(db, today);
  const suspended = db.contracts.filter((contract) => contractStateOf(contract, today) === "suspended");
  const selected = db.contracts.find((contract) => contract.id === open) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Clients"
        title="Contracts"
        description="What was agreed with each corporate client: the term, the service, the routes in scope, and the signed pricing and payment terms. An approved contract is not edited — a renegotiated agreement is a new numbered contract that names the one it replaced."
        actions={
          allowed("contracts:create") ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New contract
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active" value={live.length} caption={live.length === 1 ? "agreement in force" : "agreements in force"} />
        <Stat
          label="Ending soon"
          value={renewals.length}
          caption={
            db.settings.documentReminderLeadDays === null
              ? "Set a reminder lead time in Settings to be warned before an end date"
              : `ending within ${db.settings.documentReminderLeadDays} days`
          }
        />
        <Stat label="Awaiting approval" value={awaiting.length} caption="sent for approval, not yet in force" />
        <Stat label="Suspended" value={suspended.length} caption="in force on paper, paused in practice" />
      </div>

      {db.settings.documentReminderLeadDays === null && (
        <Notice tone="info" title="No renewal warning is configured" className="mb-4">
          Settings holds the reminder lead time. Until it is set, this screen names every end date but
          warns about none, rather than inventing a window.
        </Notice>
      )}

      {renewals.length > 0 && (
        <Notice tone="warning" title="Renewals due" className="mb-4">
          {renewals.map((contract) => `${contract.reference} (${contract.clientName}) ends ${contract.endDate}`).join("; ")}.
        </Notice>
      )}

      <TableCard
        title="Agreements"
        summary={`${rows.length} of ${db.contracts.length} contract${db.contracts.length === 1 ? "" : "s"}`}
        toolbar={
          <Select aria-label="Filter by state" value={filter} onChange={(event) => setFilter(event.target.value as "" | ContractState)}>
            <option value="">Every state</option>
            {(Object.keys(CONTRACT_STATUS_LABELS) as ContractState[]).map((state) => (
              <option key={state} value={state}>
                {CONTRACT_STATUS_LABELS[state]}
              </option>
            ))}
          </Select>
        }
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.contract.id}
          emptyState={
            <EmptyState
              title={db.contracts.length === 0 ? "No contracts on file" : "No contract in this state"}
              body={
                db.contracts.length === 0
                  ? "A contract records what was agreed with a client: the term, the service and the terms. Enter the first one from the signed paper."
                  : "Clear the filter to see every contract."
              }
            />
          }
          columns={[
            { key: "ref", header: "Contract", render: (row) => <span className="tms-num text-xs font-semibold text-foreground">{row.contract.reference}</span> },
            {
              key: "client",
              header: "Client",
              render: (row) => (
                <span className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">{row.contract.clientName}</span>
                  <span className="text-xs text-muted-foreground">{CONTRACT_SERVICE_LABELS[row.contract.serviceType]}</span>
                </span>
              ),
            },
            { key: "term", header: "Term", render: (row) => term(row.contract) },
            { key: "routes", header: "Routes", className: "text-right", render: (row) => (row.contract.routeIds.length === 0 ? "—" : row.contract.routeIds.length) },
            { key: "state", header: "State", render: (row) => <Badge tone={STATE_TONE[row.state]}>{CONTRACT_STATUS_LABELS[row.state]}</Badge> },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (row) => (
                <Button variant="ghost" onClick={() => setOpen(row.contract.id)} aria-label={`Open ${row.contract.reference}`}>
                  Open
                </Button>
              ),
            },
          ]}
        />
      </TableCard>

      <p className="mt-4 text-xs text-muted-foreground">
        Expiry is worked out from the end date rather than stored, because a date passing is not something a person records. A client
        whose contract has ended or been suspended keeps its history; the booking rules refuse a new seat on a date the agreement does not
        cover, and say which contract is in the way.
      </p>

      {creating && <ContractForm onClosed={() => setCreating(false)} />}
      {editing && <ContractForm contract={editing} onClosed={() => setEditing(null)} />}
      {selected && (
        <ContractDetail
          contract={selected}
          onClosed={() => setOpen(null)}
          onEdit={() => {
            setEditing(selected);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** Drafting or correcting a contract. Offered only while it is a draft or awaiting approval. */
function ContractForm({ contract, onClosed }: { contract?: Contract; onClosed: () => void }) {
  const { db, dispatch, setFlash } = useTms();
  const [values, setValues] = useState({
    clientId: contract?.clientId ?? "",
    serviceType: (contract?.serviceType ?? "staff_transport") as ContractServiceType,
    startDate: contract?.startDate ?? todayYmd(),
    endDate: contract?.endDate ?? "",
    vehicleCategoryId: contract?.vehicleCategoryId ?? "",
    pricingModel: contract?.pricingModel ?? "",
    billingFrequency: contract?.billingFrequency ?? "",
    paymentTerms: contract?.paymentTerms ?? "",
    serviceLevelTargets: contract?.serviceLevelTargets ?? "",
    notes: contract?.notes ?? "",
  });
  const [routeIds, setRouteIds] = useState<string[]>(contract?.routeIds ?? []);
  const [weekdays, setWeekdays] = useState<number[]>(contract?.weekdays ?? []);
  const [shiftIds, setShiftIds] = useState<string[]>(contract?.shiftIds ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clientRoutes = db.routes.filter((route) => route.clientId === values.clientId);
  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = { ...values, endDate: values.endDate, routeIds, weekdays, shiftIds };
    const result: CommandResult = contract
      ? await dispatch({ type: "update_contract", id: contract.id, input })
      : await dispatch({ type: "create_contract", input });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={contract ? `Correct ${contract.reference}` : "New contract"}
      description="Transcribe the signed contract. Nothing here is calculated: the pricing model, billing frequency, payment terms and service-level targets are typed exactly as they appear on the paper, and may be left blank if the paper does not say."
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client" error={errors.clientId}>
            <Select value={values.clientId} onChange={(event) => {
                setValues({ ...values, clientId: event.target.value });
                // Route checkboxes belong to the chosen client, so a client change clears them.
                setRouteIds([]);
              }} invalid={!!errors.clientId}>
              <option value="">Choose a client</option>
              {db.clients.filter((client) => client.status === "active").map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service covered" error={errors.serviceType}>
            <Select value={values.serviceType} onChange={(event) => setValues({ ...values, serviceType: event.target.value as ContractServiceType })} invalid={!!errors.serviceType}>
              {CONTRACT_SERVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CONTRACT_SERVICE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" error={errors.startDate}>
            <TextInput type="date" value={values.startDate} onChange={(event) => setValues({ ...values, startDate: event.target.value })} invalid={!!errors.startDate} />
          </Field>
          <Field label="Ends (leave blank if open-ended)" error={errors.endDate}>
            <TextInput type="date" value={values.endDate} min={values.startDate} onChange={(event) => setValues({ ...values, endDate: event.target.value })} invalid={!!errors.endDate} />
          </Field>
        </div>

        <Field label="Routes in scope" error={errors.routeIds} hint={values.clientId ? undefined : "Choose the client first"}>
          {clientRoutes.length === 0 ? (
            <p className="text-xs text-muted-foreground">This client has no routes yet. A contract may still be entered; the routes can be added when they exist.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {clientRoutes.map((route) => (
                <label key={route.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={routeIds.includes(route.id)} onChange={() => toggle(routeIds, route.id, setRouteIds)} />
                  <span>
                    {route.reference} {route.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service days" error={errors.weekdays} hint="Leave every box clear if the contract does not name days">
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((name, index) => (
                <label key={name} className="flex items-center gap-1 text-xs text-foreground">
                  <input type="checkbox" checked={weekdays.includes(index)} onChange={() => toggle(weekdays, index, setWeekdays)} />
                  <span>{name.slice(0, 3)}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Shifts covered" error={errors.shiftIds} hint={db.settings.shifts.length === 0 ? "No shifts are configured in Settings" : "From the shifts in Settings"}>
            {db.settings.shifts.length === 0 ? (
              <p className="text-xs text-muted-foreground">None configured. The contract can be entered without them.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {db.settings.shifts.map((shift) => (
                  <label key={shift.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={shiftIds.includes(shift.id)} onChange={() => toggle(shiftIds, shift.id, setShiftIds)} />
                    <span>{shift.name}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
        </div>

        <Field label="Vehicle category required" error={errors.vehicleCategoryId} hint="Optional: leave blank when the contract does not name one">
          <Select value={values.vehicleCategoryId} onChange={(event) => setValues({ ...values, vehicleCategoryId: event.target.value })} invalid={!!errors.vehicleCategoryId}>
            <option value="">Not specified</option>
            {db.settings.vehicleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pricing model" error={errors.pricingModel} hint="As written on the contract">
            <TextInput value={values.pricingModel} onChange={(event) => setValues({ ...values, pricingModel: event.target.value })} invalid={!!errors.pricingModel} />
          </Field>
          <Field label="Billing frequency" error={errors.billingFrequency} hint="As written on the contract">
            <TextInput value={values.billingFrequency} onChange={(event) => setValues({ ...values, billingFrequency: event.target.value })} invalid={!!errors.billingFrequency} />
          </Field>
        </div>

        <Field label="Payment terms" error={errors.paymentTerms}>
          <TextInput value={values.paymentTerms} onChange={(event) => setValues({ ...values, paymentTerms: event.target.value })} invalid={!!errors.paymentTerms} />
        </Field>
        <Field label="Service-level targets (where agreed)" error={errors.serviceLevelTargets}>
          <TextArea value={values.serviceLevelTargets} onChange={(event) => setValues({ ...values, serviceLevelTargets: event.target.value })} invalid={!!errors.serviceLevelTargets} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <TextArea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} invalid={!!errors.notes} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            {contract ? "Save the contract" : "Draft the contract"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** The record itself: what was agreed, its state, what may happen next, and its history. */
function ContractDetail({ contract, onClosed, onEdit }: { contract: Contract; onClosed: () => void; onEdit: () => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  const today = todayYmd();
  const state = contractStateOf(contract, today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const steps = nextSteps(state);

  const clients = new Map(db.clients.map((client) => [client.id, client.name]));
  const routes = new Map(db.routes.map((route) => [route.id, `${route.reference} ${route.name}`]));
  const shifts = new Map(db.settings.shifts.map((shift) => [shift.id, shift.name]));

  const move = async (to: ContractStatus, label: string) => {
    const needsReason = to === "suspended" || to === "terminated" || (to === "draft" && contract.status === "pending_approval");
    if (needsReason && !reason.trim()) {
      setError(`Say why the contract is being ${label.toLowerCase()}, so the next reader knows.`);
      return;
    }
    const result = await dispatch({ type: "advance_contract", id: contract.id, to, reason: reason.trim() });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) {
      setReason("");
      setError(null);
    } else {
      setError(result.message);
    }
  };

  return (
    <Panel title={`${contract.reference} — ${contract.clientName}`} description={term(contract)} onClose={onClosed}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[state]}>{CONTRACT_STATUS_LABELS[state]}</Badge>
          <span className="text-xs text-muted-foreground">{CONTRACT_SERVICE_LABELS[contract.serviceType]}</span>
          {contract.replacesId && <span className="text-xs text-muted-foreground">Replaces {db.contracts.find((entry) => entry.id === contract.replacesId)?.reference ?? "an earlier contract"}</span>}
        </div>

        {state === "expired" && (
          <Notice tone="warning" title="The term has ended">
            Bookings on or after {contract.endDate} are refused under this contract. A renewal is a new contract; this record stays as it was signed.
          </Notice>
        )}
        {state === "suspended" && (
          <Notice tone="warning" title="Suspended">
            The record is in force on paper but paused in practice, so new bookings under it are refused. Resume it when the reason no longer applies.
          </Notice>
        )}

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Detail label="Client" value={clients.get(contract.clientId) ?? contract.clientName} />
          <Detail label="Starts" value={formatDate(contract.startDate)} />
          <Detail label="Ends" value={contract.endDate ? formatDate(contract.endDate) : "Open-ended"} />
          <Detail label="Pricing model" value={contract.pricingModel || "Not stated on the contract"} />
          <Detail label="Billing frequency" value={contract.billingFrequency || "Not stated on the contract"} />
          <Detail label="Payment terms" value={contract.paymentTerms || "Not stated on the contract"} />
          <Detail label="Vehicle category" value={db.settings.vehicleCategories.find((category) => category.id === contract.vehicleCategoryId)?.name ?? "Not specified"} />
          <Detail label="Service days" value={contract.weekdays.length === 0 ? "Not stated on the contract" : contract.weekdays.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ")} />
          <Detail label="Shifts" value={contract.shiftIds.length === 0 ? "Every shift, or not stated" : contract.shiftIds.map((id) => shifts.get(id) ?? id).join(", ")} />
          <Detail label="Routes" value={contract.routeIds.length === 0 ? "No routes named" : contract.routeIds.map((id) => routes.get(id) ?? id).join(", ")} />
        </dl>

        {contract.serviceLevelTargets && (
          <div>
            <p className="tms-mono text-dim">Service-level targets</p>
            <p className="whitespace-pre-line text-sm text-foreground">{contract.serviceLevelTargets}</p>
          </div>
        )}
        {contract.notes && (
          <div>
            <p className="tms-mono text-dim">Notes</p>
            <p className="whitespace-pre-line text-sm text-foreground">{contract.notes}</p>
          </div>
        )}

        {steps.length > 0 && allowed("contracts:advance") && (
          <div className="rounded-md border border-border p-3">
            <p className="tms-mono text-dim">What happens next</p>
            <TextInput
              placeholder="Reason (required to suspend, terminate or send back)"
              aria-label="Reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
            {error && (
              <p className="text-[12px] text-danger mt-2" role="alert">
                {error}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {steps.map((step) => (
                <Button key={step.to} variant={step.to === "terminated" ? "danger" : "secondary"} onClick={() => void move(step.to, step.label)}>
                  {step.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {isContractEditable(contract) && allowed("contracts:update") && (
          <Button onClick={onEdit}>Correct the terms</Button>
        )}

        <div>
          <p className="tms-mono text-dim">History</p>
          <ol className="space-y-2">
            {contract.history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="text-xs text-foreground">
                <span className="tms-num">{new Date(event.at).toLocaleString()}</span> · {event.actor} · {CONTRACT_STATUS_LABELS[event.from]} → {CONTRACT_STATUS_LABELS[event.to]}
                {event.note && <span className="text-muted-foreground"> — {event.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="tms-mono text-dim">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
