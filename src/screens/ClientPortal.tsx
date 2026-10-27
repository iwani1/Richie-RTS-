import { useMemo, useState, type FormEvent } from "react";
import type { RentalRequestInput } from "../tms/service";
import { scopedView } from "../tms/scope";
import { contractStateOf } from "../tms/contracts";
import {
  CONTRACT_SERVICE_LABELS,
  CONTRACT_STATUS_LABELS,
  DIRECTION_LABELS,
  RENTAL_STATUS_LABELS,
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
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayList = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(" ");

const RENTAL_TONE: Record<RentalStatus, "info" | "warning" | "success" | "neutral" | "error"> = {
  draft: "neutral",
  quoted: "info",
  confirmed: "success",
  in_progress: "warning",
  completed: "success",
  declined: "error",
  cancelled: "error",
};

// Client portal. Own-record scope: everything here comes from scopedView(), which
// confines this account to the one corporate client it is linked to.
export function ClientPortalPage() {
  const { db, actor, currentUser, allowed, dispatch, setFlash } = useTms();
  const view = useMemo(() => scopedView(db, actor), [db, actor]);
  const [requesting, setRequesting] = useState(false);

  const client = view.link.client;
  const stopName = (route: BusRoute, stopId: string | null) => route.stops.find((s) => s.id === stopId)?.name ?? "-";

  return (
    <div>
      <PageHeader
        eyebrow="Client"
        title={client?.name ?? currentUser?.fullName ?? "My account"}
        description="Your contracted routes, the staff on them, and your rental requests."
      />

      {!client && (
        <Notice tone="warning" title="Account not linked to a client">
          This account has the client contact role but is not linked to a client, so it can see no records.
          An administrator links accounts on the Users screen. Until then this page stays empty by design.
        </Notice>
      )}

      {client && (
        <>
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
