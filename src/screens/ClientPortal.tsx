import { useMemo, useState, type FormEvent } from "react";
import type { RentalRequestInput } from "../tms/service";
import { clientAccount, type ClientAdjustmentRow, type ClientInvoiceState, type ClientInvoiceRow, type ClientPaymentRow } from "../tms/clientAccount";
import { formatAmount } from "../tms/money";
import { scopedView } from "../tms/scope";
import { contractStateOf } from "../tms/contracts";
import { delayNote, liveDelay } from "../tms/delays";
import {
  CONTRACT_SERVICE_LABELS,
  CONTRACT_STATUS_LABELS,
  DIRECTION_LABELS,
  RENTAL_STATUS_LABELS,
  TRIP_STATUS_LABELS,
  type BusRoute,
  type Passenger,
  type Rental,
  type RentalStatus,
} from "../tms/types";
import { stopDetailLine } from "../tms/stops";
import { useTms } from "../tms/useTms";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  Select,
  Stat,
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayList = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(" ");

const TRIP_TONE = {
  planned: "info",
  dispatched: "warning",
  in_progress: "warning",
  completed: "success",
  cancelled: "error",
} as const;

const RENTAL_TONE: Record<RentalStatus, "info" | "warning" | "success" | "neutral" | "error"> = {
  draft: "neutral",
  quoted: "info",
  confirmed: "success",
  in_progress: "warning",
  completed: "success",
  declined: "error",
  cancelled: "error",
};

const money = (currency: string | null, amount: number) => (currency ? `${currency} ${formatAmount(amount)}` : formatAmount(amount));

/** The colour is a second signal beside the words, never the only one. */
const INVOICE_STATE_TONE: Record<ClientInvoiceState, "success" | "warning" | "error" | "info" | "neutral"> = {
  "Awaiting payment": "warning",
  "Part paid": "info",
  Overdue: "error",
  "Part paid, overdue": "error",
  Settled: "success",
  "Refund due": "info",
};

// Client portal. Own-record scope: everything here comes from scopedView(), which
// confines this account to the one corporate client it is linked to.
export function ClientPortalPage() {
  const { db, actor, currentUser, allowed, dispatch, setFlash } = useTms();
  const view = useMemo(() => scopedView(db, actor), [db, actor]);
  const [requesting, setRequesting] = useState(false);

  const client = view.link.client;
  // D-105: the day's runs are the reason a client opens this page at 07:30 — and the reason it rings
  // the office when one of them is late. Sorted by the time the run leaves, not by reference.
  const today = todayYmd();
  const todayTrips = view.trips
    .filter((trip) => trip.serviceDate === today)
    .sort((a, b) => {
      const first = (id: string) => view.routes.find((route) => route.id === id)?.stops[0]?.scheduledTime ?? "";
      return first(a.routeId) === first(b.routeId) ? a.reference.localeCompare(b.reference) : first(a.routeId) < first(b.routeId) ? -1 : 1;
    });
  const stopName = (route: BusRoute, stopId: string | null) => route.stops.find((s) => s.id === stopId)?.name ?? "-";

  // CLI-03, D-114: the account as at today, built from the **narrowed** payload the same way every
  // other panel on this page is. The server has already removed what this account may not read; this
  // second narrowing is what keeps the two views in step, and is why the figures below cannot include
  // another customer's invoice even if one reached the browser. Nothing is recalculated here — the
  // balances are the shared rule the printed statement uses.
  const account = useMemo(
    () =>
      clientAccount(
        { ...db, invoices: view.invoices, payments: view.payments, creditNotes: view.creditNotes, refunds: view.refunds },
        today,
      ),
    [db, view, today],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Client"
        title={client?.name ?? currentUser?.fullName ?? "My account"}
        description="What you owe, your contracted routes, the staff on them, and your rental requests."
      />

      {!client && (
        <Notice tone="warning" title="Account not linked to a client">
          This account has the client contact role but is not linked to a client, so it can see no records.
          An administrator links accounts on the Users screen. Until then this page stays empty by design.
        </Notice>
      )}

      {client && (
        <>
          {/* CLI-03, D-114: what the customer owes. The agreement says what was promised; this says
              what it has cost so far and what is still open, which is the question a client contact
              is actually rung up to answer. */}
          <div className="mt-5">
            <Card
              title="Your account"
              description={`What you have been billed, what has been paid, and what is still owing as at ${formatDate(today)}.`}
            >
              {account.status === "no_invoices" && (
                <EmptyState
                  title="Nothing billed yet"
                  body="Bills for your hired vehicles appear here once the office issues them. Until then there is no balance to state."
                />
              )}
              {account.status === "mixed_currency" && (
                <Notice tone="warning" title="These invoices are in more than one currency">
                  {account.message}
                </Notice>
              )}
              {account.totals && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="Billed" value={money(account.currencyCode, account.totals.billed)} caption="Invoices issued to you." />
                    <Stat
                      label="Paid"
                      value={money(account.currencyCode, account.totals.received)}
                      caption={account.totals.credited > 0 ? `${money(account.currencyCode, account.totals.credited)} has been credited off.` : "Money received against those bills."}
                    />
                    <Stat
                      label="Balance due"
                      value={money(account.currencyCode, account.totals.outstanding)}
                      caption={account.totals.refunded > 0 ? `${money(account.currencyCode, account.totals.refunded)} has been paid back to you.` : "Billed less what came in and what was credited."}
                    />
                    <Stat
                      label="Overdue"
                      value={money(account.currencyCode, account.totals.overdue)}
                      caption={
                        account.totals.oldestDaysOverdue > 0
                          ? `The oldest is ${account.totals.oldestDaysOverdue} days past its due date.`
                          : "Nothing is past its due date."
                      }
                    />
                  </div>
                  {account.invoices.length > 0 && (
                    <div className="mt-4">
                      <DataTable
                        rows={account.invoices}
                        rowKey={(row: ClientInvoiceRow) => row.id}
                        emptyState={<EmptyState title="No invoices" body="" />}
                        columns={[
                          { key: "ref", header: "Invoice", render: (row: ClientInvoiceRow) => <span className="font-mono text-xs">{row.reference}</span> },
                          { key: "issued", header: "Issued", render: (row: ClientInvoiceRow) => <span className="text-xs">{formatDate(row.issuedOn)}</span> },
                          { key: "due", header: "Due", render: (row: ClientInvoiceRow) => <span className="text-xs">{formatDate(row.dueOn)}</span> },
                          { key: "total", header: "Billed", render: (row: ClientInvoiceRow) => money(row.currencyCode, row.total) },
                          { key: "paid", header: "Paid", render: (row: ClientInvoiceRow) => money(row.currencyCode, row.paid) },
                          { key: "credited", header: "Credited", render: (row: ClientInvoiceRow) => money(row.currencyCode, row.credited) },
                          { key: "balance", header: "Balance due", render: (row: ClientInvoiceRow) => <span className="font-medium">{money(row.currencyCode, row.outstanding)}</span> },
                          { key: "state", header: "State", render: (row: ClientInvoiceRow) => <Badge tone={INVOICE_STATE_TONE[row.state]}>{row.state}</Badge> },
                        ]}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          <div className="mt-5">
            <Card title="Payments received" description="Money the office has recorded against your invoices. A payment cancelled in error is not shown.">
              {account.payments.length === 0 ? (
                <EmptyState title="No payments recorded" body="When the office records money against your invoice, it appears here with its method and date." />
              ) : (
                <DataTable
                  rows={account.payments}
                  rowKey={(row: ClientPaymentRow) => row.id}
                  emptyState={<EmptyState title="No payments recorded" body="" />}
                  columns={[
                    { key: "date", header: "Date", render: (row: ClientPaymentRow) => <span className="text-xs">{formatDate(row.paidOn)}</span> },
                    { key: "ref", header: "Payment", render: (row: ClientPaymentRow) => <span className="font-mono text-xs">{row.reference}</span> },
                    { key: "against", header: "Against", render: (row: ClientPaymentRow) => <span className="font-mono text-xs">{row.invoiceReference}</span> },
                    { key: "method", header: "Method", render: (row: ClientPaymentRow) => row.method || <span className="text-stone-400">not recorded</span> },
                    { key: "amount", header: "Amount", render: (row: ClientPaymentRow) => <span className="font-medium">{money(row.currencyCode, row.amount)}</span> },
                  ]}
                />
              )}
            </Card>
          </div>

          <div className="mt-5">
            <Card title="Credited and paid back" description="Money taken off an invoice, and money returned to you, with the reason the office recorded.">
              {account.adjustments.length === 0 ? (
                <EmptyState title="Nothing credited" body="If part of a bill is not charged, or money is paid back to you, the credit note or refund appears here with its reason." />
              ) : (
                <DataTable
                  rows={account.adjustments}
                  rowKey={(row: ClientAdjustmentRow) => row.id}
                  emptyState={<EmptyState title="Nothing credited" body="" />}
                  columns={[
                    { key: "date", header: "Date", render: (row: ClientAdjustmentRow) => <span className="text-xs">{formatDate(row.date)}</span> },
                    {
                      key: "kind",
                      header: "Document",
                      render: (row: ClientAdjustmentRow) => (
                        <span>
                          <span className="font-mono text-xs">{row.reference}</span>{" "}
                          <span className="text-xs text-stone-600">{row.kind === "creditNote" ? "credit note" : "refund"}</span>
                        </span>
                      ),
                    },
                    { key: "against", header: "Against", render: (row: ClientAdjustmentRow) => <span className="font-mono text-xs">{row.invoiceReference}</span> },
                    { key: "amount", header: "Amount", render: (row: ClientAdjustmentRow) => <span className="font-medium">{money(row.currencyCode, row.amount)}</span> },
                    { key: "reason", header: "Why", render: (row: ClientAdjustmentRow) => row.reason },
                  ]}
                />
              )}
            </Card>
          </div>

          {/* CLI-03, D-95: the agreement itself, stated plainly — term, service and state, so the
              answer to "what did we agree, and until when?" does not need a phone call. */}
          <Card title="Your agreement" description="What Richie Transport Services has agreed with your organisation.">
            {view.contracts.length === 0 ? (
              <EmptyState title="No contract on file" body="Your account manager keeps the signed agreement. When it is entered here, its term and service appear in this space." />
            ) : (
              <ul className="space-y-3">
                {[...view.contracts]
                  .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
                  .map((contract) => {
                    const state = contractStateOf(contract, todayYmd());
                    return (
                      <li key={contract.id} className="rounded-sm border border-stone-200 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rts-mono text-xs font-semibold">{contract.reference}</span>
                          <Badge tone={state === "active" ? "success" : state === "draft" || state === "terminated" ? "neutral" : "warning"}>
                            {CONTRACT_STATUS_LABELS[state]}
                          </Badge>
                          <span className="text-xs text-stone-600">{CONTRACT_SERVICE_LABELS[contract.serviceType]}</span>
                        </div>
                        <p className="mt-1 text-sm text-stone-700">
                          {contract.endDate ? `${formatDate(contract.startDate)} to ${formatDate(contract.endDate)}` : `From ${formatDate(contract.startDate)}, open-ended`}
                        </p>
                      </li>
                    );
                  })}
              </ul>
            )}
          </Card>

          {/* D-105: what is happening today, including a delay the office has reported. The point of
              recording a delay is that the client reads it here instead of ringing to ask. */}
          <div className="mt-5">
            <Card title="Today's runs" description="The runs scheduled for your routes today, and any delay the office has reported on them.">
              {todayTrips.length === 0 ? (
                <EmptyState
                  title="Nothing scheduled for today"
                  body="Runs appear here on the day they are scheduled. If you expected one, ask your account manager whether the route operates today."
                />
              ) : (
                <ul className="space-y-2">
                  {todayTrips.map((trip) => {
                    const route = view.routes.find((candidate) => candidate.id === trip.routeId);
                    const late = liveDelay(trip);
                    return (
                      <li key={trip.id} className="rounded-sm border border-stone-200 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">{trip.reference}</span>
                          <span className="text-sm font-medium">{route?.name ?? "Route"}</span>
                          <span className="text-xs text-stone-500">leaves {route?.stops[0]?.scheduledTime ?? "—"}</span>
                          <Badge tone={TRIP_TONE[trip.status]}>{TRIP_STATUS_LABELS[trip.status]}</Badge>
                        </div>
                        {late && <p className="mt-1 text-sm text-stone-700">{delayNote(late)}</p>}
                        {trip.status === "cancelled" && trip.cancelReason && (
                          <p className="mt-1 text-sm text-stone-700">Cancelled: {trip.cancelReason}.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="mt-5">
          <Card title="Contracted routes" description="Routes Richie Transport Services runs for your organisation.">
            {view.routes.length === 0 ? (
              <EmptyState title="No routes yet" body="Routes agreed with your account manager appear here." />
            ) : (
              <ul className="space-y-3">
                {view.routes.map((route) => (
                  <li key={route.id} className="rounded-sm border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{route.reference}</span>
                      <span className="font-semibold">{route.name}</span>
                      <Badge tone="neutral">{DIRECTION_LABELS[route.direction]}</Badge>
                      <Badge tone={route.status === "active" ? "success" : route.status === "suspended" ? "warning" : "neutral"}>{route.status}</Badge>
                      <span className="text-xs text-stone-500">{dayList(route.weekdays)}</span>
                    </div>
                    <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {route.stops.map((stop, index) => (
                        <li key={stop.id} className="flex items-baseline gap-2 text-sm">
                          <span className="w-5 text-right font-mono text-xs text-stone-400">{index + 1}.</span>
                          <span className="flex-1">
                            {stop.name}
                            {/* RTE-01: the customer should recognise the place its staff are collected
                                from. Only the directions travel; coordinates are the office's business. */}
                            {stopDetailLine(stop) && <span className="block text-xs text-stone-600">{stopDetailLine(stop)}</span>}
                          </span>
                          <span className="font-mono text-xs text-stone-500">{stop.scheduledTime}</span>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          </div>

          <div className="mt-5">
            <Card title="Staff on these routes" description="Names and pickup stops only. Contact details are held by your account manager.">
              {view.passengers.length === 0 ? (
                <EmptyState title="No staff listed" body="Ask your account manager to add your employees to the roster." />
              ) : (
                <DataTable
                  rows={view.passengers}
                  rowKey={(p: Passenger) => p.id}
                  emptyState={<EmptyState title="No staff listed" body="" />}
                  columns={[
                    { key: "name", header: "Name", render: (p: Passenger) => <span className="font-medium">{p.fullName}</span> },
                    {
                      key: "route",
                      header: "Route",
                      render: (p: Passenger) => (p.routeId ? view.routes.find((r) => r.id === p.routeId)?.name ?? "-" : <span className="text-stone-400">not on a route</span>),
                    },
                    {
                      key: "stop",
                      header: "Pickup stop",
                      render: (p: Passenger) => (p.routeId ? stopName(view.routes.find((r) => r.id === p.routeId)!, p.stopId) : "-"),
                    },
                    { key: "status", header: "Status", render: (p: Passenger) => <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge> },
                  ]}
                />
              )}
            </Card>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">My rental requests</h2>
            {allowed("rentals:create") && <Button variant="primary" onClick={() => setRequesting(true)}>Request a vehicle</Button>}
          </div>
          <div className="mt-3">
            <DataTable
              rows={view.rentals}
              rowKey={(r: Rental) => r.id}
              emptyState={<EmptyState title="No rental requests" body="One-off vehicle hire requests appear here with their quotation status." />}
              columns={[
                { key: "ref", header: "Ref", render: (r: Rental) => <span className="font-mono text-xs">{r.reference}</span> },
                { key: "purpose", header: "Purpose", render: (r: Rental) => <span className="font-medium">{r.purpose}</span> },
                { key: "when", header: "Dates", render: (r: Rental) => <span className="text-xs">{formatDate(r.startDate)} – {formatDate(r.endDate)}</span> },
                { key: "pax", header: "Passengers", render: (r: Rental) => r.passengers },
                { key: "status", header: "Status", render: (r: Rental) => <Badge tone={RENTAL_TONE[r.status]}>{RENTAL_STATUS_LABELS[r.status]}</Badge> },
              ]}
            />
          </div>
        </>
      )}

      {requesting && client && (
        <RequestRental
          clientName={client.name}
          vehicleCategories={db.settings.vehicleCategories}
          onClose={() => setRequesting(false)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "create_rental", input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) setRequesting(false);
            return result.ok ? null : result.errors;
          }}
        />
      )}
    </div>
  );
}

function RequestRental({
  clientName,
  vehicleCategories,
  onClose,
  onSubmit,
}: {
  clientName: string;
  vehicleCategories: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (input: RentalRequestInput) => Record<string, string> | null | Promise<Record<string, string> | null>;
}) {
  const [values, setValues] = useState<RentalRequestInput>({
    clientId: null,
    customerName: clientName,
    customerPhone: "",
    customerEmail: "",
    purpose: "",
    pickupLocation: "",
    dropoffLocation: "",
    startDate: todayYmd(),
    endDate: todayYmd(),
    passengers: "",
    vehicleCategoryId: vehicleCategories[0]?.id ?? "",
    driverRequired: true,
    notes: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors((await onSubmit(values)) ?? {});
  };

  const blocked = vehicleCategories.length === 0;

  return (
    <Panel title="Request a vehicle" description="This raises a request. Richie Transport Services confirms availability and sends a quotation." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {blocked && (
          <Notice tone="warning" title="Not configured">
            Vehicle categories have not been configured yet, so a request cannot be raised. Please contact your account manager.
          </Notice>
        )}
        <Field label="Purpose of hire" error={errors.purpose}>
          <TextInput value={values.purpose} onChange={(e) => setValues({ ...values, purpose: e.target.value })} invalid={!!errors.purpose} autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pickup location" error={errors.pickupLocation}>
            <TextInput value={values.pickupLocation} onChange={(e) => setValues({ ...values, pickupLocation: e.target.value })} invalid={!!errors.pickupLocation} />
          </Field>
          <Field label="Drop-off location" error={errors.dropoffLocation}>
            <TextInput value={values.dropoffLocation} onChange={(e) => setValues({ ...values, dropoffLocation: e.target.value })} invalid={!!errors.dropoffLocation} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date" error={errors.startDate}>
            <TextInput type="date" value={values.startDate} onChange={(e) => setValues({ ...values, startDate: e.target.value })} invalid={!!errors.startDate} />
          </Field>
          <Field label="End date" error={errors.endDate}>
            <TextInput type="date" value={values.endDate} onChange={(e) => setValues({ ...values, endDate: e.target.value })} invalid={!!errors.endDate} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number of passengers" error={errors.passengers}>
            <TextInput value={values.passengers} onChange={(e) => setValues({ ...values, passengers: e.target.value })} inputMode="numeric" invalid={!!errors.passengers} />
          </Field>
          <Field label="Vehicle category" error={errors.vehicleCategoryId}>
            <Select value={values.vehicleCategoryId} onChange={(e) => setValues({ ...values, vehicleCategoryId: e.target.value })} invalid={!!errors.vehicleCategoryId} disabled={blocked}>
              <option value="">Select a category</option>
              {vehicleCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact phone" error={errors.customerPhone}>
            <TextInput value={values.customerPhone} onChange={(e) => setValues({ ...values, customerPhone: e.target.value })} inputMode="tel" invalid={!!errors.customerPhone} />
          </Field>
          <Field label="Contact email" error={errors.customerEmail}>
            <TextInput value={values.customerEmail} onChange={(e) => setValues({ ...values, customerEmail: e.target.value })} inputMode="email" invalid={!!errors.customerEmail} />
          </Field>
        </div>
        <Field label="Anything else we should know?" error={errors.notes}>
          <TextArea value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} invalid={!!errors.notes} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={blocked}>Send request</Button>
        </div>
      </form>
    </Panel>
  );
}
