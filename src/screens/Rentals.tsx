import { useMemo, useState, type FormEvent } from "react";
import { formatAmount, fromMinor, lineAmount, linesTotalFromText, percentOf, toMinor } from "../tms/money";
import { readQuoteFigures } from "../tms/quotations";
import { rentalQuotingReady, type AssignmentInput, type CompleteRentalInput, type DepositInput, type QuoteInput, type QuoteLineInput, type RentalRequestInput } from "../tms/service";
import { balanceLine, damageLine, distanceLine, rentalBalance, runLine, toLocalInput } from "../tms/run";
import { acceptanceLine, acceptanceStateOf, canAcceptQuotation } from "../tms/acceptance";
import { approvalLine, approvalProblem, approvalRequiredAt, approvalIsCurrent, quotationHeading, quotationIsNumbered, validityLine } from "../tms/quotations";
import { MAX_STOPS, planLine, SOURCE_LABELS, sourceLabel, stopsLine, tripContactLine } from "../tms/request";
import { awaitingPrice, canEditRequest, isActiveRental, nextTriageStep, TRIAGE_ACTIONS } from "../tms/rentalWorkflow";
import { readinessReport } from "../tms/maintenance";
import { useTms } from "../tms/useTms";
import { PRICING_BASIS_LABELS, RENTAL_STATUS_LABELS, RENTAL_STATUSES, REQUEST_SOURCES, type Rental, type RentalStatus } from "../tms/types";
import { CopyButton } from "../ui/CopyButton";
import { Badge, Button, Card, DataTable, EmptyState, Field, Notice, PageHeader, Panel, SearchInput, Select, TableCard, TextArea, TextInput, formatDate, formatDateTime, todayYmd } from "../ui/primitives";
import type { Route } from "../routes";

type Errors = Record<string, string>;

const statusTone: Record<RentalStatus, "neutral" | "info" | "success" | "warning" | "error"> = {
  draft: "neutral",
  submitted: "neutral",
  under_review: "info",
  awaiting_quotation: "info",
  quoted: "info",
  // Agreed and unpaid: the office's next move is a phone call about money, so it reads as a warning
  // rather than as success. Nothing is green until the deposit is in.
  accepted: "warning",
  confirmed: "success",
  dispatched: "warning",
  completed: "success",
  declined: "error",
  cancelled: "error",
};

function money(amount: number, currency: string | null) {
  // The pesewa is settled by money.ts, so what is written here is what was stored (audit D-04).
  if (!currency) return formatAmount(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(fromMinor(toMinor(amount)));
  } catch {
    return `${currency} ${formatAmount(amount)}`;
  }
}

const emptyRequest = (): RentalRequestInput => ({
  clientId: null,
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate: "",
  endDate: "",
  passengers: "",
  vehicleCategoryId: "",
  driverRequired: false,
  notes: "",
  // The journey the customer asked for (RNT-01, D-119). Blank until somebody types it; the source
  // stays blank until the desk says how the request arrived.
  departureTime: "",
  returnTime: "",
  stops: "",
  luggage: "",
  specialNeeds: "",
  tripContactName: "",
  tripContactPhone: "",
  source: "",
});

const toRequestInput = (r: Rental): RentalRequestInput => ({
  clientId: r.clientId,
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  customerEmail: r.customerEmail,
  purpose: r.purpose,
  pickupLocation: r.pickupLocation,
  dropoffLocation: r.dropoffLocation,
  startDate: r.startDate,
  endDate: r.endDate,
  passengers: String(r.passengers),
  vehicleCategoryId: r.vehicleCategoryId,
  driverRequired: r.driverRequired,
  notes: r.notes,
  departureTime: r.plan?.departureTime ?? "",
  returnTime: r.plan?.returnTime ?? "",
  stops: (r.plan?.stops ?? []).join("\n"),
  luggage: r.plan?.luggage ?? "",
  specialNeeds: r.plan?.specialNeeds ?? "",
  tripContactName: r.plan?.tripContactName ?? "",
  tripContactPhone: r.plan?.tripContactPhone ?? "",
  source: r.plan?.source ?? "",
});

export function RentalsPage({ navigate }: { navigate: (route: Route) => void }) {
  const { db, allowed, dispatch, setFlash } = useTms();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RentalStatus>("all");

  const categoryName = (id: string) => db.settings.vehicleCategories.find((c) => c.id === id)?.name ?? "Unknown";
  const selected = selectedId ? db.rentals.find((r) => r.id === selectedId) ?? null : null;
  const blocked = db.settings.vehicleCategories.length === 0;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.rentals
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => !q || `${r.reference} ${r.customerName} ${categoryName(r.vehicleCategoryId)}`.toLowerCase().includes(q))
      .sort((a, b) => b.reference.localeCompare(a.reference));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.rentals, query, statusFilter]);

  if (selected) {
    return <RentalDetail rental={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Bus rentals"
        title="Rental requests"
        description="The full flow: request, quotation, deposit, resource assignment, trip and final billing."
        actions={allowed("rentals:create") ? <Button variant="primary" disabled={blocked} title={blocked ? "Add vehicle categories in Settings first" : undefined} onClick={() => setCreating(true)}>New request</Button> : undefined}
      />

      {blocked && (
        <Notice tone="warning" title="Rental requests are blocked" className="mb-4">
          No vehicle categories are configured. {allowed("settings:update") ? <button type="button" className="underline" onClick={() => navigate("settings")}>Add categories in Settings</button> : "Ask an administrator to add categories in Settings"} first.
        </Notice>
      )}

      <TableCard
        title="Rental requests"
        summary={`${rows.length} of ${db.rentals.length} shown · ${db.rentals.filter((r) => awaitingPrice(r.status)).length} to price`}
        toolbar={
          <>
            <SearchInput placeholder="Search reference, customer, category" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search rentals" />
            <Select className="max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | RentalStatus)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{RENTAL_STATUS_LABELS[s]}</option>)}
            </Select>
            <p className="rts-filter-bar-note" role="status">
              {db.rentals.filter((r) => r.status === "dispatched").length} on the road · {db.rentals.filter((r) => r.status === "completed").length} completed
            </p>
          </>
        }
      >
        <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        emptyState={<EmptyState title={db.rentals.length ? "No rentals match" : "No rental requests yet"} body="Create a request to begin the quotation and booking flow." />}
        columns={[
          { key: "ref", header: "Reference", render: (r) => <span className="font-mono text-xs font-semibold text-stone-900">{r.reference}</span> },
          { key: "cust", header: "Customer", render: (r) => <span className="font-semibold text-stone-900">{r.customerName}</span> },
          { key: "cat", header: "Category", render: (r) => categoryName(r.vehicleCategoryId) },
          { key: "dates", header: "Dates", render: (r) => <span className="whitespace-nowrap text-xs">{formatDate(r.startDate)} - {formatDate(r.endDate)}</span> },
          { key: "value", header: "Quote", className: "rts-num", render: (r) => (r.quote ? money(r.quote.subtotal, r.quote.currencyCode) : <span className="text-stone-400">-</span>) },
          { key: "status", header: "Status", render: (r) => <Badge tone={statusTone[r.status]}>{RENTAL_STATUS_LABELS[r.status]}</Badge> },
          { key: "actions", header: "", className: "text-right", render: (r) => <Button variant="ghost" onClick={() => setSelectedId(r.id)}>Open</Button> },
        ]}
        />
      </TableCard>

      {creating && (
        <RequestForm
          title="New rental request"
          initial={emptyRequest()}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            const result = await dispatch({ type: "create_rental", input });
            setFlash({ tone: result.ok ? "success" : "error", message: result.message });
            if (result.ok) {
              setCreating(false);
              const created = result.db.rentals[result.db.rentals.length - 1];
              setSelectedId(created.id);
              return {};
            }
            return result.errors;
          }}
        />
      )}
    </div>
  );
}

function RentalDetail({ rental, onBack }: { rental: Rental; onBack: () => void }) {
  const { db, allowed, dispatch, setFlash, actor } = useTms();
  const [panel, setPanel] = useState<"edit" | "quote" | "requote" | "accept" | "approve" | "confirm" | "assign" | "complete" | "decline" | "cancel" | null>(null);
  // D-116: the note the office writes when a customer agreed by phone. Held here so one panel does
  // not need a second component for a single field.
  const [acceptNote, setAcceptNote] = useState("");
  const [approveNote, setApproveNote] = useState("");

  const categoryName = db.settings.vehicleCategories.find((c) => c.id === rental.vehicleCategoryId)?.name ?? "Unknown";
  const vehicle = db.vehicles.find((v) => v.id === rental.assignedVehicleId);
  const driver = db.drivers.find((d) => d.id === rental.assignedDriverId);
  const client = db.clients.find((c) => c.id === rental.clientId);
  const quoteMissing = rentalQuotingReady(db.settings);
  // D-117: a quotation is a moment, not a day — it stops holding at the hour it was issued plus the
  // configured period, so the check compares instants.
  const nowIso = new Date().toISOString();
  const expired = rental.quote ? new Date(rental.quote.validUntil).getTime() < new Date(nowIso).getTime() : false;
  const needsDriver = rental.driverRequired || db.settings.rental.driversAlwaysIncluded === true;

  const run = async (pending: ReturnType<typeof dispatch>): Promise<Errors> => {
    const result = await pending;
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setPanel(null);
    return result.ok ? {} : result.errors;
  };

  const actions: React.ReactNode[] = [];
  // A request is corrected, moved along and priced only while nobody has a price in front of the
  // customer (D-120). The triage states are optional, so the quotation button is offered in all of
  // them: a small request never waits for a step nobody needed.
  if (canEditRequest(rental.status)) {
    if (allowed("rentals:update")) actions.push(<Button key="edit" onClick={() => setPanel("edit")}>Edit request</Button>);
    const next = nextTriageStep(rental.status);
    if (next && allowed("rentals:update")) {
      actions.push(
        <Button key="advance" onClick={() => run(dispatch({ type: "advance_rental", id: rental.id, to: next }))}>
          {TRIAGE_ACTIONS[next] ?? RENTAL_STATUS_LABELS[next]}
        </Button>,
      );
    }
    if (allowed("rentals:quote")) actions.push(<Button key="quote" variant="primary" onClick={() => setPanel("quote")}>Issue quotation</Button>);
  }
  // A price that needs a second signature, offered to somebody who is allowed to give one and is not
  // the person who wrote it (D-121). The service refuses it again; this is the screen's half of the rule.
  if (rental.quote && (rental.status === "quoted" || rental.status === "accepted") && allowed("rentals:approve")) {
    const needsSignature =
      approvalRequiredAt(rental.quote.total, db.settings.rental.quotationApprovalAbove) && !approvalIsCurrent(rental.quote);
    if (needsSignature && approvalProblem(rental.quote, actor?.id ?? null, actor?.fullName ?? "") === null && !expired) {
      actions.push(<Button key="approve" onClick={() => { setApproveNote(""); setPanel("approve"); }}>Approve quotation</Button>);
    }
  }
  if (rental.status === "quoted" || rental.status === "accepted") {
    if (expired && db.settings.rental.requotePolicy === "revise_in_place" && allowed("rentals:quote"))
      actions.push(<Button key="requote" variant="primary" onClick={() => setPanel("requote")}>Renew quotation</Button>);
    // RNT-05, D-116: most customers agree on the phone, so the office can write the yes down. The
    // button appears only when the quotation can actually be accepted — unless the customer has
    // already accepted it, in which case there is nothing left to record.
    const acceptanceProblems = canAcceptQuotation(rental, nowIso, db.settings.rental.quotationApprovalAbove);
    if (allowed("rentals:accept") && Object.keys(acceptanceProblems).length === 0)
      actions.push(<Button key="accept" onClick={() => { setAcceptNote(""); setPanel("accept"); }}>Record customer acceptance</Button>);
    if (allowed("rentals:confirm")) actions.push(<Button key="confirm" variant="primary" disabled={expired} title={expired ? "Quotation expired" : undefined} onClick={() => setPanel("confirm")}>Record deposit & confirm</Button>);
    if (allowed("rentals:quote")) actions.push(<Button key="decline" variant="danger" onClick={() => setPanel("decline")}>Decline</Button>);
  }
  if (rental.status === "confirmed") {
    if (allowed("rentals:dispatch")) actions.push(<Button key="assign" onClick={() => setPanel("assign")}>{rental.assignedVehicleId ? "Reassign" : "Assign resources"}</Button>);
    // Dispatch is the moment the vehicle leaves, which is also the departure D-118 records on the run.
    if (allowed("rentals:dispatch")) actions.push(<Button key="start" variant="primary" disabled={!rental.assignedVehicleId || (needsDriver && !rental.assignedDriverId)} onClick={() => run(dispatch({ type: "start_rental", id: rental.id }))}>Dispatch vehicle</Button>);
  }
  if (rental.status === "dispatched") {
    if (allowed("rentals:dispatch")) actions.push(<Button key="assign" onClick={() => setPanel("assign")}>Reassign</Button>);
    if (allowed("rentals:complete")) actions.push(<Button key="complete" variant="primary" onClick={() => setPanel("complete")}>Complete & bill</Button>);
  }
  if (allowed("rentals:cancel") && ["draft", "submitted", "under_review", "awaiting_quotation", "quoted", "accepted", "confirmed", "dispatched"].includes(rental.status)) {
    actions.push(<Button key="cancel" variant="danger" onClick={() => setPanel("cancel")}>Cancel</Button>);
  }

  // The strip follows the work, not the table: the triage states share one step, because to the office
  // they are one thing ("we are working on it") until there is a price to send (D-120).
  const steps: { key: string; label: string; statuses: RentalStatus[] }[] = [
    { key: "request", label: "Request", statuses: ["draft", "submitted", "under_review", "awaiting_quotation"] },
    { key: "quoted", label: "Quotation sent", statuses: ["quoted"] },
    { key: "accepted", label: "Accepted", statuses: ["accepted"] },
    { key: "confirmed", label: "Confirmed", statuses: ["confirmed"] },
    { key: "dispatched", label: "Dispatched", statuses: ["dispatched"] },
    { key: "completed", label: "Completed", statuses: ["completed"] },
  ];
  const currentIndex = steps.findIndex((step) => step.statuses.includes(rental.status));

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-xs font-semibold text-stone-500 hover:text-stone-800">&larr; Back to rentals</button>
      <PageHeader
        eyebrow={`Rental ${rental.reference}`}
        title={rental.customerName}
        description={`${categoryName} · ${formatDate(rental.startDate)} - ${formatDate(rental.endDate)} · ${rental.passengers} passenger(s)`}
        actions={<div className="flex flex-wrap gap-2"><CopyButton value={rental.reference} what="rental reference" />{actions}</div>}
      />

      {rental.status === "declined" || rental.status === "cancelled" ? (
        <Notice tone="error" title={`This rental was ${RENTAL_STATUS_LABELS[rental.status].toLowerCase()}`} className="mb-4">{rental.resolutionReason}</Notice>
      ) : (
        <ol className="rts-steps" aria-label="Rental progress">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className={`rts-step${i < currentIndex ? " is-done" : ""}${i === currentIndex ? " is-current" : ""}`}
              aria-current={i === currentIndex ? "step" : undefined}
            >
              <span className="rts-step-index" aria-hidden="true">{i < currentIndex ? "\u2713" : i + 1}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}

      {canEditRequest(rental.status) && quoteMissing.length > 0 && (
        <Notice tone="warning" title="Quotation is blocked" className="mb-4">An administrator must set: {quoteMissing.join(", ")} (Settings &rarr; Bus rentals).</Notice>
      )}
      {expired && (rental.status === "quoted" || rental.status === "accepted") && (
        <Notice tone="warning" title="Quotation expired" className="mb-4">
          {db.settings.rental.requotePolicy === null
            ? "The validity date has passed. Management must set the expired-quotation policy in Settings before this request can be renewed."
            : db.settings.rental.requotePolicy === "new_request"
              ? "The validity date has passed. Company policy requires cancelling this request and raising a new one. The expired quote remains in the record."
              : "The validity date has passed. Company policy allows a new revision on this request; the old quote will remain in its history."}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Request details">
          <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
            <dt className="text-stone-500">Customer</dt><dd className="text-stone-800">{rental.customerName}</dd>
            {client && <><dt className="text-stone-500">Linked client</dt><dd className="text-stone-800">{client.name}</dd></>}
            <dt className="text-stone-500">Phone</dt><dd className="text-stone-800">{rental.customerPhone || "-"}</dd>
            <dt className="text-stone-500">Email</dt><dd className="text-stone-800">{rental.customerEmail || "-"}</dd>
            <dt className="text-stone-500">Purpose</dt><dd className="text-stone-800">{rental.purpose || "-"}</dd>
            <dt className="text-stone-500">Pickup</dt><dd className="text-stone-800">{rental.pickupLocation || "-"}</dd>
            <dt className="text-stone-500">Drop-off</dt><dd className="text-stone-800">{rental.dropoffLocation || "-"}</dd>
            <dt className="text-stone-500">Driver</dt><dd className="text-stone-800">{needsDriver ? "Required" : "Not required"}</dd>
            <dt className="text-stone-500">Journey</dt><dd className="text-stone-800">{planLine(rental)}</dd>
            <dt className="text-stone-500">Stops</dt><dd className="text-stone-800">{stopsLine(rental)}</dd>
            {rental.plan && rental.plan.luggage !== "" && <><dt className="text-stone-500">Luggage</dt><dd className="text-stone-800">{rental.plan.luggage}</dd></>}
            {rental.plan && rental.plan.specialNeeds !== "" && <><dt className="text-stone-500">Special needs</dt><dd className="text-stone-800">{rental.plan.specialNeeds}</dd></>}
            <dt className="text-stone-500">On the day</dt><dd className="text-stone-800">{tripContactLine(rental)}</dd>
            <dt className="text-stone-500">Came in by</dt><dd className="text-stone-800">{sourceLabel(rental.plan?.source ?? "")}</dd>
            {rental.notes && <><dt className="text-stone-500">Notes</dt><dd className="text-stone-800">{rental.notes}</dd></>}
          </dl>
        </Card>

        <Card title="Quotation">
          {rental.quote ? (
            <div className="text-sm">
              {/* D-117: the document a customer can name. The number is copied rather than read out
                  loud over a bad line, and the revision says which version of the price it is. */}
              {quotationIsNumbered(rental.quote) ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-stone-200 pb-2">
                  <span className="font-mono text-sm font-semibold">{quotationHeading(rental.quote)}</span>
                  <CopyButton value={rental.quote.number} what="quotation number" />
                  <span className={`text-xs ${expired ? "text-red-700" : "text-stone-600"}`}>{validityLine(rental.quote.validUntil, nowIso)}</span>
                </div>
              ) : (
                <Notice tone="warning" title="This quotation has no number" className="mb-3">
                  It was issued before quotations were numbered, so it cannot be given to a customer as a document. Issue a new
                  quotation on a new request, or wait for this one to expire and renew it.
                </Notice>
              )}
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wider text-stone-500"><tr><th className="pb-1">Description</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Unit</th><th className="pb-1 text-right">Line</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {rental.quote.lines.map((l) => (
                    <tr key={l.id}><td className="py-1 pr-2">{l.description}</td><td className="py-1 text-right">{l.quantity}</td><td className="py-1 text-right">{money(l.unitAmount, rental.quote!.currencyCode)}</td><td className="py-1 text-right">{money(lineAmount(l.quantity, l.unitAmount), rental.quote!.currencyCode)}</td></tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 space-y-1 border-t border-stone-200 pt-2 text-sm">
                <div className="flex justify-between"><dt className="text-stone-500">Pricing basis</dt><dd>{PRICING_BASIS_LABELS[rental.quote.pricingBasis]}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Lines</dt><dd>{money(rental.quote.subtotal, rental.quote.currencyCode)}</dd></div>
                {/* D-121: the reduction and the levy, named on the document rather than folded into a
                    total the customer cannot check. */}
                {rental.quote.discountAmount > 0 && (
                  <div className="flex justify-between"><dt className="text-stone-500">Less discount{rental.quote.discountReason ? `: ${rental.quote.discountReason}` : ""}</dt><dd>-{money(rental.quote.discountAmount, rental.quote.currencyCode)}</dd></div>
                )}
                {rental.quote.taxLines.map((line) => (
                  <div key={line.name} className="flex justify-between"><dt className="text-stone-500">{line.name} at {line.ratePercent}%</dt><dd>{money(line.amount, rental.quote!.currencyCode)}</dd></div>
                ))}
                <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(rental.quote.total, rental.quote.currencyCode)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Deposit ({rental.quote.depositPercent}%)</dt><dd>{money(rental.quote.depositRequired, rental.quote.currencyCode)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Driver included</dt><dd>{rental.quote.driverIncluded ? "Yes" : "No"}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Valid until</dt><dd className={expired ? "text-red-700" : ""}>{formatDateTime(rental.quote.validUntil)}</dd></div>
              </dl>
              {/* D-116: the customer's own answer, in their own record — and a warning when the
                  quotation has moved on since they gave it. */}
              {rental.acceptance && (
                <p className={`mt-2 text-xs ${acceptanceStateOf(rental, nowIso) === "current" ? "text-stone-700" : "text-amber-800"}`}>
                  {acceptanceLine(rental, nowIso)}
                  {rental.acceptance.note && <span className="block text-stone-600">&ldquo;{rental.acceptance.note}&rdquo;</span>}
                </p>
              )}
              {/* The conditions the customer agreed to, kept with the quotation they were printed on. */}
              {rental.quote.terms && (
                <div className="mt-3 border-t border-stone-200 pt-2">
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Terms</h3>
                  <p className="whitespace-pre-line text-xs text-stone-700">{rental.quote.terms}</p>
                </div>
              )}
              {/* D-121: the second signature, in the office's words — including when nobody has asked
                  for one, which is a different statement from "approved". */}
              {approvalLine(rental.quote, db.settings.rental.quotationApprovalAbove) && (
                <p className={`mt-2 text-xs ${approvalIsCurrent(rental.quote) ? "text-stone-700" : "text-amber-800"}`}>
                  {approvalLine(rental.quote, db.settings.rental.quotationApprovalAbove)}
                </p>
              )}
              {rental.quoteHistory.length > 0 && (
                <div className="mt-4 border-t border-stone-200 pt-3">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Previous quotations retained</h3>
                  <ol className="space-y-2">
                    {rental.quoteHistory.map((previous, index) => (
                      <li key={`${previous.quotedAt}-${index}`} className="rounded-sm bg-stone-50 px-3 py-2">
                        <div className="flex justify-between gap-2 text-xs"><span className="font-semibold">{quotationIsNumbered(previous) ? `Revision ${previous.revision}` : "Unnumbered"}</span><span>{money(previous.subtotal, previous.currencyCode)}</span></div>
                        <p className="mt-0.5 text-[10px] text-stone-500">Quoted {formatDate(previous.quotedAt.slice(0, 10))} by {previous.quotedBy} · valid until {formatDateTime(previous.validUntil)}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-500">No quotation issued yet.</p>
          )}
        </Card>

        {rental.deposit && (
          <Card title="Deposit">
            <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-stone-500">Amount</dt><dd className="font-semibold text-stone-800">{money(rental.deposit.amount, rental.quote?.currencyCode ?? null)}</dd>
              <dt className="text-stone-500">Method</dt><dd className="text-stone-800">{rental.deposit.method}</dd>
              <dt className="text-stone-500">Reference</dt><dd className="text-stone-800">{rental.deposit.reference || "-"}</dd>
            </dl>
          </Card>
        )}

        {(rental.assignedVehicleId || isActiveRental(rental.status)) && (
          <Card title="Assigned resources">
            <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
              <dt className="text-stone-500">Vehicle</dt><dd className="text-stone-800">{vehicle ? `${vehicle.registration}` : <span className="text-stone-400">Not assigned</span>}</dd>
              <dt className="text-stone-500">Driver</dt><dd className="text-stone-800">{driver ? driver.fullName : <span className="text-stone-400">{needsDriver ? "Required - not assigned" : "Not required"}</span>}</dd>
            </dl>
          </Card>
        )}

        {/* D-118: what actually happened on the road, beside what it cost. The journey is not a
            field of the money, and a hire with nothing recorded says so rather than showing blanks. */}
        {(rental.run || rental.status === "completed" || rental.status === "dispatched") && (
          <Card title="What happened" className="lg:col-span-2">
            <p className="text-sm text-stone-800">{runLine(rental.run)}</p>
            <dl className="mt-3 grid grid-cols-[170px_1fr] gap-y-2 text-sm">
              <dt className="text-stone-500">Distance</dt>
              <dd className="text-stone-800">{rental.run ? distanceLine(rental.run) : null}{!rental.run?.distanceKm ? <span className="text-stone-400">Not recorded</span> : null}</dd>
              <dt className="text-stone-500">Odometer</dt>
              <dd className="text-stone-800">
                {rental.run && (rental.run.odometerStartKm !== null || rental.run.odometerEndKm !== null) ? (
                  `${rental.run.odometerStartKm !== null ? `${rental.run.odometerStartKm.toLocaleString("en-GB")} km` : "not read"} at departure · ${rental.run.odometerEndKm !== null ? `${rental.run.odometerEndKm.toLocaleString("en-GB")} km` : "not read"} at return`
                ) : (
                  <span className="text-stone-400">No odometer reading was taken</span>
                )}
              </dd>
              <dt className="text-stone-500">Damage</dt>
              <dd className={rental.run?.damageNotes ? "text-amber-800" : "text-stone-800"}>{damageLine(rental.run)}</dd>
              {rental.run && rental.run.feedback && <><dt className="text-stone-500">What the customer said</dt><dd className="text-stone-800">{rental.run.feedback}</dd></>}
              <dt className="text-stone-500">Money</dt>
              <dd className="text-stone-800">{balanceLine(rentalBalance(db, rental)) ?? <span className="text-stone-400">No invoice has been raised for this hire yet</span>}</dd>
              {rental.run && <><dt className="text-stone-500">Recorded by</dt><dd className="text-stone-800">{rental.run.recordedBy || "—"} · {formatDateTime(rental.run.recordedAt)}</dd></>}
            </dl>
          </Card>
        )}

        {rental.finalInvoice && (
          <Card title="Final invoice" className="lg:col-span-2">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-stone-500"><tr><th className="pb-1">Description</th><th className="pb-1 text-right">Qty</th><th className="pb-1 text-right">Unit</th><th className="pb-1 text-right">Line</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {rental.finalInvoice.lines.map((l) => (
                  <tr key={l.id}><td className="py-1 pr-2">{l.description}</td><td className="py-1 text-right">{l.quantity}</td><td className="py-1 text-right">{money(l.unitAmount, rental.finalInvoice!.currencyCode)}</td><td className="py-1 text-right">{money(lineAmount(l.quantity, l.unitAmount), rental.finalInvoice!.currencyCode)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold"><span>Total billed</span><span>{money(rental.finalInvoice.total, rental.finalInvoice.currencyCode)}</span></div>
            {rental.deposit && <p className="mt-1 text-right text-xs text-stone-500">Deposit received: {money(rental.deposit.amount, rental.finalInvoice.currencyCode)} · Balance: {money(rental.finalInvoice.total - rental.deposit.amount, rental.finalInvoice.currencyCode)}</p>}
          </Card>
        )}
      </div>

      {panel === "edit" && <RequestForm title={`Edit ${rental.reference}`} initial={toRequestInput(rental)} onClose={() => setPanel(null)} onSubmit={(input) => run(dispatch({ type: "update_rental", id: rental.id, input }))} />}
      {panel === "quote" && <QuoteForm title={`Quote ${rental.reference}`} depositPercent={db.settings.rental.depositPercent} currency={db.settings.currencyCode} taxPosition={db.settings.taxPosition} taxLines={db.settings.taxLines} onClose={() => setPanel(null)} onSubmit={(input) => run(dispatch({ type: "quote_rental", id: rental.id, input }))} />}
      {panel === "requote" && <QuoteForm title={`Renew quotation ${rental.reference}`} requoteMode depositPercent={db.settings.rental.depositPercent} currency={db.settings.currencyCode} taxPosition={db.settings.taxPosition} taxLines={db.settings.taxLines} initialLines={rental.quote?.lines.map((line) => ({ id: line.id, description: line.description, quantity: String(line.quantity), unitAmount: String(line.unitAmount) }))} onClose={() => setPanel(null)} onSubmit={(input) => run(dispatch({ type: "requote_rental", id: rental.id, input }))} />}
      {panel === "complete" && (
        <CompleteForm
          rental={rental}
          currency={rental.quote?.currencyCode ?? db.settings.currencyCode}
          onClose={() => setPanel(null)}
          onSubmit={(input) => run(dispatch({ type: "complete_rental", id: rental.id, input }))}
        />
      )}
      {panel === "accept" && (
        <Panel
          title={`Record acceptance of ${rental.reference}`}
          description="Write down a yes the customer gave by phone. It records what they agreed to and when; the deposit is a separate step."
          onClose={() => setPanel(null)}
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
              <dt className="text-stone-500">Customer</dt>
              <dd className="text-stone-800">{rental.customerName}</dd>
              <dt className="text-stone-500">Quoted</dt>
              <dd className="font-semibold text-stone-900">{money(rental.quote?.subtotal ?? 0, rental.quote?.currencyCode ?? null)}</dd>
              <dt className="text-stone-500">Held until</dt>
              <dd className="text-stone-800">{rental.quote ? formatDateTime(rental.quote.validUntil) : "—"}</dd>
            </dl>
            <Field label="What they said (optional)" hint="For example: agreed on the phone with the transport officer, or the pickup time they asked for.">
              <TextArea value={acceptNote} onChange={(event) => setAcceptNote(event.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setPanel(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void run(dispatch({ type: "accept_quotation", id: rental.id, note: acceptNote }))}>
                Record acceptance
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {panel === "approve" && (
        <Panel title={`Approve quotation ${rental.quote?.number ?? ""}`} description="A second signature on this price. It is recorded with your name and the figure you approved, and it does not change anything else." onClose={() => setPanel(null)}>
          <div className="space-y-4">
            <p className="text-sm text-stone-800">
              {rental.quote ? `${money(rental.quote.total, rental.quote.currencyCode)} for ${rental.reference}, quoted by ${rental.quote.quotedBy}.` : ""}
            </p>
            <Field label="Note (optional)" hint="Why it was approved, if there is anything worth saying at the time.">
              <TextArea value={approveNote} onChange={(event) => setApproveNote(event.target.value)} rows={3} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPanel(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => void run(dispatch({ type: "approve_quotation", id: rental.id, note: approveNote }))}>Approve quotation</Button>
            </div>
          </div>
        </Panel>
      )}
      {panel === "confirm" && <ConfirmForm reference={rental.reference} depositRequired={rental.quote?.depositRequired ?? 0} currency={rental.quote?.currencyCode ?? null} methods={db.settings.rental.paymentMethods} onClose={() => setPanel(null)} onSubmit={(input) => run(dispatch({ type: "confirm_rental", id: rental.id, input }))} />}
      {panel === "assign" && <AssignForm rental={rental} needsDriver={needsDriver} onClose={() => setPanel(null)} onSubmit={(input) => run(dispatch({ type: "assign_rental", id: rental.id, input }))} />}
      {(panel === "decline" || panel === "cancel") && <ReasonForm title={panel === "decline" ? `Decline ${rental.reference}` : `Cancel ${rental.reference}`} onClose={() => setPanel(null)} onSubmit={(reason) => run(dispatch(panel === "decline" ? { type: "decline_rental", id: rental.id, reason } : { type: "cancel_rental", id: rental.id, reason }))} />}
    </div>
  );
}

function RequestForm({ initial, title, onClose, onSubmit }: { initial: RentalRequestInput; title: string; onClose: () => void; onSubmit: (input: RentalRequestInput) => Errors | Promise<Errors> }) {
  const { db } = useTms();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = (patch: Partial<RentalRequestInput>) => setValues({ ...values, ...patch });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(await onSubmit(values));
  };
  const driversAlways = db.settings.rental.driversAlwaysIncluded === true;
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Link to corporate client (optional)">
          <Select value={values.clientId ?? ""} onChange={(e) => { const c = db.clients.find((x) => x.id === e.target.value); set({ clientId: e.target.value || null, customerName: c ? c.name : values.customerName }); }}>
            <option value="">Individual / ad-hoc</option>
            {db.clients.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Customer / organisation name" error={errors.customerName}><TextInput value={values.customerName} onChange={(e) => set({ customerName: e.target.value })} invalid={!!errors.customerName} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><TextInput value={values.customerPhone} onChange={(e) => set({ customerPhone: e.target.value })} inputMode="tel" /></Field>
          <Field label="Email" error={errors.customerEmail}><TextInput type="email" value={values.customerEmail} onChange={(e) => set({ customerEmail: e.target.value })} invalid={!!errors.customerEmail} /></Field>
        </div>
        <Field label="Vehicle category" error={errors.vehicleCategoryId}>
          <Select value={values.vehicleCategoryId} onChange={(e) => set({ vehicleCategoryId: e.target.value })} invalid={!!errors.vehicleCategoryId}>
            <option value="">Select a category</option>
            {db.settings.vehicleCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" error={errors.startDate}><TextInput type="date" value={values.startDate} onChange={(e) => set({ startDate: e.target.value })} invalid={!!errors.startDate} /></Field>
          <Field label="End date" error={errors.endDate}><TextInput type="date" value={values.endDate} onChange={(e) => set({ endDate: e.target.value })} invalid={!!errors.endDate} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Passengers" error={errors.passengers}><TextInput type="number" min={1} step={1} value={values.passengers} onChange={(e) => set({ passengers: e.target.value })} invalid={!!errors.passengers} /></Field>
          <Field label="Driver required">
            <Select value={driversAlways ? "yes" : values.driverRequired ? "yes" : "no"} disabled={driversAlways} onChange={(e) => set({ driverRequired: e.target.value === "yes" })}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pickup location"><TextInput value={values.pickupLocation} onChange={(e) => set({ pickupLocation: e.target.value })} /></Field>
          <Field label="Drop-off location"><TextInput value={values.dropoffLocation} onChange={(e) => set({ dropoffLocation: e.target.value })} /></Field>
        </div>
        <Field label="Purpose"><TextInput value={values.purpose} onChange={(e) => set({ purpose: e.target.value })} /></Field>
        <fieldset className="space-y-3 rounded-sm border border-stone-200 p-3">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500">The journey asked for</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Departure time" hint="Leave blank if nobody said." error={errors.departureTime}>
              <TextInput type="time" value={values.departureTime ?? ""} onChange={(e) => set({ departureTime: e.target.value })} invalid={!!errors.departureTime} />
            </Field>
            <Field label="Return time" error={errors.returnTime}>
              <TextInput type="time" value={values.returnTime ?? ""} onChange={(e) => set({ returnTime: e.target.value })} invalid={!!errors.returnTime} />
            </Field>
          </div>
          <Field label="Stops on the way" hint={`One per line, in the order the vehicle calls. Up to ${MAX_STOPS}.`} error={errors.stops}>
            <TextArea rows={3} value={values.stops ?? ""} onChange={(e) => set({ stops: e.target.value })} invalid={!!errors.stops} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Luggage" hint="Suitcases, boxes, equipment." error={errors.luggage}>
              <TextInput value={values.luggage ?? ""} onChange={(e) => set({ luggage: e.target.value })} invalid={!!errors.luggage} />
            </Field>
            <Field label="Special needs" hint="Anything the vehicle must carry or allow for." error={errors.specialNeeds}>
              <TextInput value={values.specialNeeds ?? ""} onChange={(e) => set({ specialNeeds: e.target.value })} invalid={!!errors.specialNeeds} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Who to ring on the day" hint="Leave blank to use the customer's own number." error={errors.tripContactName}>
              <TextInput value={values.tripContactName ?? ""} onChange={(e) => set({ tripContactName: e.target.value })} invalid={!!errors.tripContactName} />
            </Field>
            <Field label="Their phone" error={errors.tripContactPhone}>
              <TextInput inputMode="tel" value={values.tripContactPhone ?? ""} onChange={(e) => set({ tripContactPhone: e.target.value })} invalid={!!errors.tripContactPhone} />
            </Field>
          </div>
          <Field label="How did this request arrive?" error={errors.source}>
            <Select value={values.source ?? ""} onChange={(e) => set({ source: e.target.value })} invalid={!!errors.source}>
              <option value="">Not recorded</option>
              {REQUEST_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source]}</option>)}
            </Select>
          </Field>
        </fieldset>
        <Field label="Notes"><TextArea value={values.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Save request</Button></div>
      </form>
    </Panel>
  );
}

function LineItemsEditor({ lines, setLines, errors, currency }: { lines: QuoteLineInput[]; setLines: (l: QuoteLineInput[]) => void; errors: Errors; currency: string | null }) {
  // The same total the command will store, counting only the lines that are finished (money.ts).
  const subtotal = linesTotalFromText(lines);
  return (
    <div>
      <div className="space-y-3">
        {lines.map((line, i) => (
          <div key={i} className="rounded-sm border border-stone-200 p-2">
            <Field label={`Line ${i + 1} description`} error={errors[`lines.${i}.description`]}><TextInput value={line.description} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))} invalid={!!errors[`lines.${i}.description`]} /></Field>
            <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-start gap-2">
              <Field label="Qty" error={errors[`lines.${i}.quantity`]}><TextInput type="number" min={0} step="any" value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} invalid={!!errors[`lines.${i}.quantity`]} /></Field>
              <Field label="Unit amount" error={errors[`lines.${i}.unitAmount`]}><TextInput type="number" min={0} step="0.01" value={line.unitAmount} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, unitAmount: e.target.value } : l)))} invalid={!!errors[`lines.${i}.unitAmount`]} /></Field>
              <Button variant="danger" className="mt-5" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>Remove</Button>
            </div>
          </div>
        ))}
      </div>
      {errors.lines && <p className="mt-2 text-[11px] font-medium text-red-700">{errors.lines}</p>}
      <div className="mt-3 flex items-center justify-between">
        <Button onClick={() => setLines([...lines, { description: "", quantity: "1", unitAmount: "" }])}>Add line</Button>
        <span className="text-sm font-semibold">Subtotal: {money(subtotal, currency)}</span>
      </div>
    </div>
  );
}

/**
 * Completing a hire (RNT-07, D-118).
 *
 * The money and the journey are recorded together, because they are the same moment for the office:
 * the bus is back, here are the charges, and here is the mileage it came back with. The journey fields
 * are all optional and the form says so — nothing is pre-filled with a figure nobody measured, apart
 * from the departure time already on the record and the return time, which is now.
 */
function CompleteForm({
  rental,
  currency,
  onClose,
  onSubmit,
}: {
  rental: Rental;
  currency: string | null;
  onClose: () => void;
  onSubmit: (input: CompleteRentalInput) => Errors | Promise<Errors>;
}) {
  const [lines, setLines] = useState<QuoteLineInput[]>(
    rental.quote?.lines.length
      ? rental.quote.lines.map((l) => ({ id: l.id, description: l.description, quantity: String(l.quantity), unitAmount: String(l.unitAmount) }))
      : [{ description: "", quantity: "1", unitAmount: "" }],
  );
  const [run, setRun] = useState({
    departedAt: toLocalInput(rental.run?.departedAt ?? null),
    returnedAt: toLocalInput(new Date().toISOString()),
    odometerStartKm: rental.run && rental.run.odometerStartKm !== null ? String(rental.run.odometerStartKm) : "",
    odometerEndKm: "",
    distanceKm: "",
    damageNotes: rental.run?.damageNotes ?? "",
    feedback: rental.run?.feedback ?? "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const set = (field: keyof typeof run) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setRun({ ...run, [field]: event.target.value });

  return (
    <Panel
      title={`Complete ${rental.reference}`}
      description="Final charges and what happened on the road. The charges are pre-filled from the quotation; the journey is recorded only where somebody knows it."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors((await onSubmit({ lines, ...run })) ?? {});
        }}
        className="space-y-4"
      >
        <LineItemsEditor lines={lines} setLines={setLines} errors={errors} currency={currency} />
        <div className="border-t border-stone-200 pt-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">The journey</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Left the yard" error={errors.departedAt} hint="Recorded when the hire started; correct it if the vehicle left at another time.">
              <TextInput type="datetime-local" value={run.departedAt} onChange={set("departedAt")} invalid={!!errors.departedAt} />
            </Field>
            <Field label="Came back" error={errors.returnedAt} hint="Defaults to now, which is when the office is recording it.">
              <TextInput type="datetime-local" value={run.returnedAt} onChange={set("returnedAt")} invalid={!!errors.returnedAt} />
            </Field>
            <Field label="Odometer at departure (km)" error={errors.odometerStartKm} hint="Leave blank if nobody read it.">
              <TextInput type="number" min={0} step="0.1" value={run.odometerStartKm} onChange={set("odometerStartKm")} invalid={!!errors.odometerStartKm} placeholder="Not read" />
            </Field>
            <Field label="Odometer at return (km)" error={errors.odometerEndKm} hint="With the reading at departure, this gives the distance the vehicle itself recorded.">
              <TextInput type="number" min={0} step="0.1" value={run.odometerEndKm} onChange={set("odometerEndKm")} invalid={!!errors.odometerEndKm} placeholder="Not read" />
            </Field>
            <Field label="Distance travelled (km)" error={errors.distanceKm} hint="Only if no odometer readings: the figure is then marked as entered by the office, not measured.">
              <TextInput type="number" min={0} step="0.1" value={run.distanceKm} onChange={set("distanceKm")} invalid={!!errors.distanceKm} placeholder="Not recorded" />
            </Field>
            <Field label="Customer's feedback (optional)" error={errors.feedback} hint="What they said afterwards, in their words or yours.">
              <TextArea value={run.feedback} onChange={set("feedback")} invalid={!!errors.feedback} rows={2} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Damage or anything wrong with the vehicle (optional)" error={errors.damageNotes} hint="Blank means nothing was reported. This is a record, not a work order.">
              <TextArea value={run.damageNotes} onChange={set("damageNotes")} invalid={!!errors.damageNotes} rows={2} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Complete rental</Button>
        </div>
      </form>
    </Panel>
  );
}

function QuoteForm({
  title,
  depositPercent,
  currency,
  requoteMode,
  initialLines,
  taxPosition,
  taxLines,
  onClose,
  onSubmit,
}: {
  title: string;
  depositPercent?: number | null;
  currency: string | null;
  requoteMode?: boolean;
  initialLines?: QuoteLineInput[];
  /** The company's tax position and rates, so the preview is the figure the quotation will carry. */
  taxPosition: "registered" | "not_registered" | null;
  taxLines: { name: string; ratePercent: number }[];
  onClose: () => void;
  onSubmit: (input: QuoteInput) => Errors | Promise<Errors>;
}) {
  const [lines, setLines] = useState<QuoteLineInput[]>(initialLines && initialLines.length ? initialLines : [{ description: "", quantity: "1", unitAmount: "" }]);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const subtotal = linesTotalFromText(lines);
  // The same arithmetic the command runs (quotations.ts), so what the office sees here is what the
  // customer will read on the document — including the tax the quotation will carry (D-121).
  const preview = readQuoteFigures({
    subtotal,
    discountAmount,
    discountReason,
    taxPosition: taxPosition ?? null,
    taxLines,
    depositPercent: depositPercent ?? 0,
  });
  return (
    <Panel title={title} description={requoteMode ? "Update the line items for a new validity period. The prior quotation will be retained in history." : "Enter the quotation line items. Rates are entered here, not assumed by the system."} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors((await onSubmit({ lines, discountAmount, discountReason })) ?? {});
        }}
        className="space-y-4"
      >
        {requoteMode && <Notice tone="warning">This creates a new quotation revision; the prior amounts, deposit requirement and expiry date remain in the history. Any approval has to be given again, because the figure has changed.</Notice>}
        <LineItemsEditor lines={lines} setLines={setLines} errors={errors} currency={currency} />
        <div className="rounded-sm border border-stone-200 p-3">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Reduction</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Discount (optional)" hint={currency ? `In ${currency}` : "Set the currency in Settings"} error={errors.discountAmount}>
              <TextInput inputMode="decimal" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} invalid={!!errors.discountAmount} />
            </Field>
            {discountAmount.trim() !== "" && (
              <Field label="Reason for the discount" error={errors.discountReason}>
                <TextInput value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} invalid={!!errors.discountReason} />
              </Field>
            )}
          </div>
        </div>
        <dl className="space-y-1 border-t border-stone-200 pt-2 text-sm">
          <div className="flex justify-between"><dt className="text-stone-500">Lines</dt><dd>{money(subtotal, currency)}</dd></div>
          {preview.figures.discountAmount > 0 && (
            <div className="flex justify-between"><dt className="text-stone-500">Less discount</dt><dd>-{money(preview.figures.discountAmount, currency)}</dd></div>
          )}
          {preview.figures.taxLines.map((line) => (
            <div key={line.name} className="flex justify-between"><dt className="text-stone-500">{line.name} at {line.ratePercent}%</dt><dd>{money(line.amount, currency)}</dd></div>
          ))}
          <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(preview.figures.total, currency)}</dd></div>
          {depositPercent !== null && depositPercent !== undefined && (
            <div className="flex justify-between"><dt className="text-stone-500">Deposit at {depositPercent}%</dt><dd>{money(percentOf(preview.figures.total, depositPercent), currency)}</dd></div>
          )}
        </dl>
        {taxPosition !== "registered" && (
          <p className="text-xs text-stone-600">No tax is added to this quotation: the company is not recorded as VAT registered.</p>
        )}
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">{requoteMode ? "Issue revised quotation" : "Issue quotation"}</Button></div>
      </form>
    </Panel>
  );
}

function ConfirmForm({ reference, depositRequired, currency, methods, onClose, onSubmit }: { reference: string; depositRequired: number; currency: string | null; methods: string[]; onClose: () => void; onSubmit: (input: DepositInput) => Errors | Promise<Errors> }) {
  const [values, setValues] = useState<DepositInput>({ amount: depositRequired ? String(depositRequired) : "", method: methods[0] ?? "", reference: "" });
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Panel title={`Confirm ${reference}`} description={`Record the deposit to confirm the booking. Minimum deposit: ${money(depositRequired, currency)}.`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors(await onSubmit(values)); }} className="space-y-4">
        <Field label="Deposit amount received" error={errors.amount}><TextInput type="number" min={0} step="0.01" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} invalid={!!errors.amount} autoFocus /></Field>
        <Field label="Payment method" error={errors.method}>
          <Select value={values.method} onChange={(e) => setValues({ ...values, method: e.target.value })} invalid={!!errors.method}>
            <option value="">Select a method</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
        <Field label="Payment reference (optional)"><TextInput value={values.reference} onChange={(e) => setValues({ ...values, reference: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Confirm booking</Button></div>
      </form>
    </Panel>
  );
}

function AssignForm({ rental, needsDriver, onClose, onSubmit }: { rental: Rental; needsDriver: boolean; onClose: () => void; onSubmit: (input: AssignmentInput) => Errors | Promise<Errors> }) {
  const { db } = useTms();
  const [values, setValues] = useState<AssignmentInput>({ vehicleId: rental.assignedVehicleId ?? "", driverId: rental.assignedDriverId ?? "" });
  const [errors, setErrors] = useState<Errors>({});
  const vehicles = db.vehicles.filter((v) => v.categoryId === rental.vehicleCategoryId && v.status !== "retired" && v.status !== "out_of_service");
  const drivers = db.drivers.filter((d) => d.status === "active");
  // Q-43: said in the list itself, before the vehicle is chosen.
  const overdue = new Set(readinessReport(db, todayYmd()).vehicles.filter((v) => v.status === "overdue").map((v) => v.vehicleId));
  return (
    <Panel title={`Assign resources: ${rental.reference}`} description={`Matching category only. ${formatDate(rental.startDate)} - ${formatDate(rental.endDate)}.`} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors(await onSubmit(values)); }} className="space-y-4">
        <Field label="Vehicle" error={errors.vehicleId}>
          <Select value={values.vehicleId} onChange={(e) => setValues({ ...values, vehicleId: e.target.value })} invalid={!!errors.vehicleId}>
            <option value="">Select a vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration} ({v.seatCapacity} seats, {v.status}){overdue.has(v.id) ? " - service overdue" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {vehicles.length === 0 && <Notice tone="warning">No available vehicles match the requested category.</Notice>}
        <Field label={`Driver${needsDriver ? "" : " (optional)"}`} error={errors.driverId}>
          <Select value={values.driverId} onChange={(e) => setValues({ ...values, driverId: e.target.value })} invalid={!!errors.driverId}>
            <option value="">{needsDriver ? "Select a driver" : "No driver"}</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select>
        </Field>
        <Notice tone="info">The system blocks assigning a vehicle or driver already booked on overlapping dates.</Notice>
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Save assignment</Button></div>
      </form>
    </Panel>
  );
}

function ReasonForm({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (reason: string) => Errors | Promise<Errors> }) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  return (
    <Panel title={title} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); setErrors((await onSubmit(reason)) ?? {}); }} className="space-y-4">
        <Field label="Reason" hint="Recorded in the audit log." error={errors.reason}><TextArea value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason} autoFocus /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Close</Button><Button type="submit" variant="danger">Confirm</Button></div>
      </form>
    </Panel>
  );
}
