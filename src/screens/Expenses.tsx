// Money spent that is not a repair (FIN-05, D-93).
//
// Until this screen existed, every cost in the system had to hang off an incident or a work order, so
// the only spending it could hold was maintenance. Fuel, tolls, permits, rent and driver allowances —
// usually the largest running costs a transport business has — went onto paper and never reached a
// report. This screen is where they are entered, from the receipt, with the number on that receipt and
// whether the paper is actually in the file.
//
// Four habits:
//   * the figures are the records, added in whole pesewas; nothing is estimated and no rate is
//     invented;
//   * a category comes from the list in Settings or stays blank, and blank is shown as "Uncategorised"
//     rather than folded into another line (Q-29);
//   * an expense is never edited: a wrong one is voided with a reason and entered again, so a report
//     built on the old figure can still be explained;
//   * a receipt is a fact with two halves — the number on the paper, and whether the paper is held —
//     and the screen counts how much spending has no receipt number at all, because that is a weaker
//     fact and hiding it would flatter the month.
import { useMemo, useState, type FormEvent } from "react";
import { formatAmount, fromMinor, toMinor } from "../tms/money";
import type { CommandResult } from "../tms/service";
import type { Expense } from "../tms/types";
import { EXPENSE_STATUS_LABELS } from "../tms/types";
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
  SearchInput,
  Select,
  Stat,
  TableCard,
  TextArea,
  TextInput,
  formatDate,
  todayYmd,
} from "../ui/primitives";

const money = (currency: string | null, amount: number) => (currency ? `${currency} ${formatAmount(amount)}` : "Not configured");
const firstOfMonth = (today: string) => `${today.slice(0, 7)}-01`;
const UNCATEGORISED = "Uncategorised";

type CommandNotify = (flash: { tone: "success" | "error"; message: string }) => void;

export function ExpensesPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const today = todayYmd();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);

  const currency = db.settings.currencyCode;
  const reversed = from > to;

  // Voided expenses stay in the list — the number was issued and the figure was reported — but they
  // count for nothing in the totals, which is what voiding means (D-93).
  const inPeriod = useMemo(
    () => db.expenses.filter((expense) => expense.incurredOn >= from && expense.incurredOn <= to),
    [db.expenses, from, to],
  );
  const live = inPeriod.filter((expense) => expense.status !== "void");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inPeriod
      .filter((expense) => !category || (expense.category || UNCATEGORISED) === category)
      .filter(
        (expense) =>
          !needle ||
          [expense.reference, expense.description, expense.payee, expense.receiptReference, expense.category].some((field) =>
            field.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => (a.incurredOn === b.incurredOn ? a.reference.localeCompare(b.reference) : a.incurredOn < b.incurredOn ? -1 : 1));
  }, [inPeriod, query, category]);

  const totalMinor = live.reduce((sum, expense) => sum + toMinor(expense.amount), 0);
  const noReceipt = live.filter((expense) => !expense.receiptReference);
  const noReceiptMinor = noReceipt.reduce((sum, expense) => sum + toMinor(expense.amount), 0);

  // Grouped in whole pesewas and converted once, so a hundred receipts cannot land a pesewa out.
  const categoryGroups = new Map<string, { count: number; minor: number }>();
  for (const expense of live) {
    const key = expense.category || UNCATEGORISED;
    const current = categoryGroups.get(key) ?? { count: 0, minor: 0 };
    categoryGroups.set(key, { count: current.count + 1, minor: current.minor + toMinor(expense.amount) });
  }
  const byCategory = [...categoryGroups.entries()]
    .map(([name, group]) => ({ name, count: group.count, amount: fromMinor(group.minor) }))
    .sort((a, b) => (a.amount === b.amount ? a.name.localeCompare(b.name) : b.amount - a.amount));

  const biggest = byCategory[0] ?? null;
  const categories = [...new Set([...db.settings.costCategories, ...inPeriod.map((expense) => expense.category).filter(Boolean)])];

  const voidExpense = async (expense: Expense, reason: string) => {
    const result = await dispatch({ type: "void_expense", id: expense.id, reason });
    setFlash({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) setVoiding(null);
    return result;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Expenses"
        description="Money spent that is not a repair: fuel, tolls, permits, rent, allowances. Entered from the receipt, counted in the money report, and never edited — a wrong one is voided with a reason."
        actions={
          allowed("expenses:record") ? (
            <Button variant="primary" onClick={() => setRecording(true)} disabled={!currency}>
              Record an expense
            </Button>
          ) : undefined
        }
      />

      {!currency && (
        <Notice tone="warning" title="No company currency is configured" className="mb-4">
          An expense cannot be recorded until an administrator sets the company currency in Settings: an amount with no currency beside it cannot be added to
          anything.
        </Notice>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-md">
        <Field label="From">
          <TextInput type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="To" hint="Filed by the day the money was spent">
          <TextInput type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </Field>
      </div>

      {reversed ? (
        <Notice tone="error" title="The range is the wrong way round">
          The start date must be on or before the end date.
        </Notice>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Recorded in the period" value={money(currency, fromMinor(totalMinor))} caption={`${live.length} entr${live.length === 1 ? "y" : "ies"} in the period`} />
            <Stat
              label="Biggest category"
              value={biggest ? biggest.name : "Nothing yet"}
              caption={biggest ? `${money(currency, biggest.amount)} across ${biggest.count} entr${biggest.count === 1 ? "y" : "ies"}` : "no expense recorded in this period"}
            />
            <Stat
              label="No receipt number"
              value={noReceipt.length}
              caption={noReceipt.length === 0 ? "every entry names a receipt" : `${money(currency, fromMinor(noReceiptMinor))} of spending with no number on it`}
            />
            <Stat
              label="Receipt held"
              value={live.filter((expense) => expense.receiptHeld).length}
              caption={`of ${live.length} entr${live.length === 1 ? "y" : "ies"} — the paper is in the file`}
            />
          </div>

          <div className="space-y-4">
            <TableCard
              title="Expenses"
              summary={
                inPeriod.length === 0
                  ? "Nothing recorded in this period"
                  : `${visible.length} of ${inPeriod.length} entr${inPeriod.length === 1 ? "y" : "ies"} · voided entries are listed and count for nothing`
              }
              toolbar={
                <div className="flex flex-wrap gap-2">
                  <SearchInput placeholder="Find an expense" aria-label="Find an expense" value={query} onChange={(event) => setQuery(event.target.value)} />
                  <Select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="">Every category</option>
                    {categories.map((name) => (
                      <option key={name || UNCATEGORISED} value={name || UNCATEGORISED}>
                        {name || UNCATEGORISED}
                      </option>
                    ))}
                  </Select>
                </div>
              }
            >
              <DataTable
                rows={visible}
                rowKey={(expense) => expense.id}
                emptyState={
                  <EmptyState
                    title={inPeriod.length === 0 ? "No expenses recorded" : "No expense matches"}
                    body={
                      inPeriod.length === 0
                        ? "Fuel, tolls, permits and anything else paid out that is not a repair belongs here, entered from the receipt."
                        : "Clear the search or the category filter to see the whole period."
                    }
                  />
                }
                columns={[
                  { key: "ref", header: "Expense", render: (expense) => <span className="rts-mono text-xs font-semibold text-stone-900">{expense.reference}</span> },
                  { key: "date", header: "Spent", render: (expense) => formatDate(expense.incurredOn) },
                  { key: "category", header: "Category", render: (expense) => expense.category || <em className="rts-unset">Uncategorised</em> },
                  {
                    key: "description",
                    header: "What for",
                    render: (expense) => (
                      <span className="flex flex-col">
                        <span className="text-xs font-medium text-stone-800">{expense.description}</span>
                        {expense.payee && <span className="text-xs text-stone-600">paid to {expense.payee}</span>}
                        {expense.status === "void" && <span className="text-xs text-stone-600">Void: {expense.voidReason ?? "no reason recorded"}</span>}
                      </span>
                    ),
                  },
                  {
                    key: "receipt",
                    header: "Receipt",
                    render: (expense) =>
                      expense.receiptReference ? (
                        <span className="flex flex-col">
                          <span className="rts-mono text-xs">{expense.receiptReference}</span>
                          <span className="text-xs text-stone-600">{expense.receiptHeld ? "paper held" : "paper not held"}</span>
                        </span>
                      ) : (
                        <em className="rts-unset">no number</em>
                      ),
                  },
                  { key: "method", header: "Method", render: (expense) => expense.method || <em className="rts-unset">not recorded</em> },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right rts-mono",
                    render: (expense) =>
                      expense.status === "void" ? (
                        <span className="text-stone-500 line-through">{money(expense.currencyCode, expense.amount)}</span>
                      ) : (
                        money(expense.currencyCode, expense.amount)
                      ),
                  },
                  { key: "status", header: "Status", render: (expense) => <Badge tone={expense.status === "void" ? "neutral" : "info"}>{EXPENSE_STATUS_LABELS[expense.status]}</Badge> },
                  {
                    key: "actions",
                    header: "",
                    className: "text-right",
                    render: (expense) =>
                      allowed("expenses:void") && expense.status !== "void" ? (
                        <Button variant="ghost" onClick={() => setVoiding(expense)} aria-label={`Void ${expense.reference}`}>
                          Void
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </TableCard>

            <TableCard
              title="By category"
              summary="Categories come from the list in Settings. An entry with none is its own line, not folded into another."
            >
              <DataTable
                rows={byCategory}
                rowKey={(row) => row.name}
                emptyState={<EmptyState title="Nothing to group" body="No live expense in this period." />}
                columns={[
                  { key: "category", header: "Category", render: (row) => (row.name === UNCATEGORISED ? <em className="rts-unset">Uncategorised</em> : row.name) },
                  { key: "count", header: "Entries", className: "text-right rts-mono", render: (row) => row.count },
                  { key: "amount", header: "Amount", className: "text-right rts-mono", render: (row) => money(currency, row.amount) },
                ]}
              />
            </TableCard>

            <p className="text-xs text-stone-500">
              Costs recorded against an incident or a work order live in Staff logistics and are entered there. Both kinds are added into the money report's
              cost figure and into cost per trip, so the two screens cannot tell different stories. A scanned copy of a receipt is not yet stored: the register
              holds the number on the paper and whether the paper is held.
            </p>
          </div>
        </>
      )}

      {recording && (
        <RecordExpenseForm
          onClosed={() => setRecording(false)}
          onSubmit={async (input) => dispatch({ type: "record_expense", input })}
          notify={setFlash}
        />
      )}
      {voiding && (
        <VoidExpenseForm
          expense={voiding}
          onClosed={() => setVoiding(null)}
          onSubmit={(reason) => voidExpense(voiding, reason)}
          notify={setFlash}
        />
      )}
    </div>
  );
}

/** Recording spending from a receipt (FIN-05, D-93). */
function RecordExpenseForm({
  onSubmit,
  notify,
  onClosed,
}: {
  onClosed: () => void;
  onSubmit: (input: {
    incurredOn: string;
    category: string;
    description: string;
    payee: string;
    amount: string;
    method: string;
    receiptReference: string;
    receiptHeld: boolean;
    notes: string;
  }) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const { db } = useTms();
  const today = todayYmd();
  const [values, setValues] = useState({
    incurredOn: today,
    category: "",
    description: "",
    payee: "",
    amount: "",
    method: "",
    receiptReference: "",
    receiptHeld: false,
    notes: "",
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
    <Panel
      title="Record an expense"
      description="Entered from the receipt. It is written once: a wrong figure is voided with a reason and entered again, so a report built on the old one stays explainable."
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date the money was spent" error={errors.incurredOn}>
            <TextInput type="date" value={values.incurredOn} max={today} onChange={(event) => setValues({ ...values, incurredOn: event.target.value })} invalid={!!errors.incurredOn} />
          </Field>
          <Field label="Amount" error={errors.amount} hint={`In ${db.settings.currencyCode ?? "the company currency"}`}>
            <TextInput inputMode="decimal" value={values.amount} onChange={(event) => setValues({ ...values, amount: event.target.value })} invalid={!!errors.amount} />
          </Field>
        </div>
        <Field label="What the money was spent on" error={errors.description}>
          <TextInput value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} invalid={!!errors.description} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" error={errors.category} hint={db.settings.costCategories.length === 0 ? "No categories configured yet — it will be reported as uncategorised" : "From the list in Settings"}>
            <Select value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })} invalid={!!errors.category}>
              <option value="">Uncategorised</option>
              {db.settings.costCategories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Who was paid" error={errors.payee} hint="The filling station, the toll booth, the landlord">
            <TextInput value={values.payee} onChange={(event) => setValues({ ...values, payee: event.target.value })} invalid={!!errors.payee} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How it was paid" error={errors.method} hint="Optional here: the method list is the one in Settings">
            <Select value={values.method} onChange={(event) => setValues({ ...values, method: event.target.value })} invalid={!!errors.method}>
              <option value="">Not recorded</option>
              {db.settings.rental.paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Receipt number" error={errors.receiptReference} hint="The number printed on the paper">
            <TextInput value={values.receiptReference} onChange={(event) => setValues({ ...values, receiptReference: event.target.value })} invalid={!!errors.receiptReference} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={values.receiptHeld}
            onChange={(event) => setValues({ ...values, receiptHeld: event.target.checked })}
            aria-label="The paper receipt is held"
          />
          <span>The paper receipt is held in the file. Leave this unticked if it is not — a receipt number without the paper is a weaker fact, and the report says so.</span>
        </label>
        <Field label="Note (optional)" error={errors.notes}>
          <TextArea value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} invalid={!!errors.notes} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Cancel</Button>
          <Button type="submit" variant="primary">
            Record the expense
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Voiding a wrong expense, with a reason (D-93). The number and the figure stay on the record. */
function VoidExpenseForm({
  expense,
  onSubmit,
  notify,
  onClosed,
}: {
  expense: Expense;
  onClosed: () => void;
  onSubmit: (reason: string) => Promise<CommandResult>;
  notify: CommandNotify;
}) {
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await onSubmit(reason);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) onClosed();
    else setErrors(result.errors);
  };

  return (
    <Panel
      title={`Void ${expense.reference}`}
      description={`${money(expense.currencyCode, expense.amount)} stops counting in every report. The entry keeps its number and stays in the list with this reason, and the correct expense is entered as the next number.`}
      onClose={onClosed}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" hint="Kept on the record and in the audit trail" error={errors.reason}>
          <TextInput value={reason} onChange={(event) => setReason(event.target.value)} invalid={!!errors.reason} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClosed}>Keep the expense</Button>
          <Button type="submit" variant="danger">
            Void expense
          </Button>
        </div>
      </form>
    </Panel>
  );
}
