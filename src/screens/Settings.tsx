import { useState, type FormEvent } from "react";
import { setupProgress } from "../tms/setup";
import { useTms } from "../tms/useTms";
import type { Settings } from "../tms/types";
import { PRICING_BASES, PRICING_BASIS_LABELS, REQUOTE_POLICIES, TAX_POSITIONS, TAX_POSITION_LABELS } from "../tms/types";
import { Badge, Band, Button, Field, Notice, PageHeader, Select, TextInput } from "../ui/primitives";

export function SettingsPage() {
  const { db, allowed, dispatch, setFlash } = useTms();
  const editable = allowed("settings:update");
  const [draft, setDraft] = useState<Settings>(() => structuredClone(db.settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const update = (patch: Partial<Settings>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await dispatch({ type: "update_settings", input: draft });
    if (result.ok) {
      setErrors({});
      setDirty(false);
      setDraft(structuredClone(result.db.settings));
      setFlash({ tone: "success", message: result.message });
    } else {
      setErrors(result.errors);
      setFlash({ tone: "error", message: result.message });
    }
  };

  const usedCategoryIds = new Set(db.vehicles.map((v) => v.categoryId));
  // The same checklist the dashboard uses, read against the saved settings (not the draft), so a
  // half-typed form never tells management a rule is in place.
  const setup = setupProgress(db.settings);

  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Business rules supplied by management. Fields left empty remain unknown; features that depend on them stay blocked rather than guessing."
        actions={
          editable ? (
            <Button type="submit" variant="primary" disabled={!dirty}>
              Save settings
            </Button>
          ) : undefined
        }
      />

      {!editable && <Notice tone="info">You can view settings but only administrators can change them.</Notice>}

      <section className="rts-band" aria-labelledby="rules-heading">
        <div className="rts-band-label">
          <div className="rts-head-text">
            <h2 id="rules-heading" className="rts-band-title">Rules to supply</h2>
            <p className="rts-band-note">Straight from the saved record. A rule counts only once it is stored.</p>
          </div>
          <span className={setup.complete ? "rts-stamp" : "rts-stamp rts-stamp--warn"}>
            {setup.done} of {setup.items.length} set
          </span>
        </div>
        <div className="rts-band-body">
          <div className="rts-progress" role="img" aria-label={`${setup.done} of ${setup.items.length} rules supplied`}>
            <span className="rts-progress-fill" style={{ width: `${setup.percent}%` }} />
          </div>
          <p className="rts-progress-caption">
            {setup.complete
              ? "Every rule this build needs is stored."
              : `${setup.outstanding} rule${setup.outstanding === 1 ? "" : "s"} still missing — dependent features stay blocked until they are supplied.`}
          </p>
          <ul className="rts-rules">
            {setup.items.map((item) => (
              <li key={item.key} className="rts-rule">
                <span className="rts-rule-label">
                  {item.label}
                  <span className="rts-rule-consequence">{item.consequence}</span>
                </span>
                <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Set" : "Not set"}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Band label="Company" note="Shown on screens and, later, on quotations and invoices.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" error={errors.companyName}>
            <TextInput value={draft.companyName ?? ""} onChange={(e) => update({ companyName: e.target.value || null })} disabled={!editable} placeholder="Not set" />
          </Field>
          <Field label="Billing currency (ISO 4217)" hint="Ghana's national currency code is GHS; confirm the company's billing currency." error={errors.currencyCode}>
            <TextInput value={draft.currencyCode ?? ""} onChange={(e) => update({ currencyCode: e.target.value.toUpperCase() || null })} disabled={!editable} placeholder="Not set" maxLength={3} />
          </Field>
        </div>
      </Band>

      <Band label="Operations" note="Used by trip planning and KPI calculations in later phases.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="On-time threshold (minutes late still counted on time)" error={errors.onTimeThresholdMinutes}>
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.onTimeThresholdMinutes ?? ""}
              onChange={(e) => update({ onTimeThresholdMinutes: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!editable}
              placeholder="Not set"
            />
          </Field>
        </div>
      </Band>

      <Band label="Vehicle categories"
        note="Required before any vehicle can be registered. Categories in use by a vehicle cannot be removed."
        actions={editable ? <Button onClick={() => update({ vehicleCategories: [...draft.vehicleCategories, { id: "", name: "" }] })}>Add category</Button> : undefined}
      >
        {errors.vehicleCategories && <Notice tone="error" className="mb-3">{errors.vehicleCategories}</Notice>}
        {draft.vehicleCategories.length === 0 ? (
          <p className="text-xs text-stone-500">No categories configured. Vehicle registration is blocked until at least one exists.</p>
        ) : (
          <ul className="space-y-2">
            {draft.vehicleCategories.map((cat, i) => (
              <li key={cat.id || `new-${i}`} className="flex items-start gap-2">
                <Field label={`Category ${i + 1}`} error={errors[`vehicleCategories.${i}`]} className="flex-1">
                  <TextInput
                    value={cat.name}
                    onChange={(e) => update({ vehicleCategories: draft.vehicleCategories.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)) })}
                    disabled={!editable}
                    invalid={!!errors[`vehicleCategories.${i}`]}
                  />
                </Field>
                {editable && (
                  <Button
                    variant="danger"
                    className="mt-5"
                    disabled={usedCategoryIds.has(cat.id)}
                    title={usedCategoryIds.has(cat.id) ? "In use by a vehicle" : "Remove"}
                    onClick={() => update({ vehicleCategories: draft.vehicleCategories.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Band>

      <Band label="Shifts"
        note="Staff-busing shift names and times. Required before recurring routes can be scheduled (next phase)."
        actions={editable ? <Button onClick={() => update({ shifts: [...draft.shifts, { id: "", name: "", startTime: "", endTime: "" }] })}>Add shift</Button> : undefined}
      >
        {draft.shifts.length === 0 ? (
          <p className="text-xs text-stone-500">No shifts configured.</p>
        ) : (
          <ul className="space-y-3">
            {draft.shifts.map((shift, i) => (
              <li key={shift.id || `new-${i}`} className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto] sm:items-start">
                <Field label="Shift name" error={errors[`shifts.${i}`]}>
                  <TextInput value={shift.name} onChange={(e) => update({ shifts: draft.shifts.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)) })} disabled={!editable} invalid={!!errors[`shifts.${i}`]} />
                </Field>
                <Field label="Start">
                  <TextInput type="time" value={shift.startTime} onChange={(e) => update({ shifts: draft.shifts.map((s, j) => (j === i ? { ...s, startTime: e.target.value } : s)) })} disabled={!editable} />
                </Field>
                <Field label="End">
                  <TextInput type="time" value={shift.endTime} onChange={(e) => update({ shifts: draft.shifts.map((s, j) => (j === i ? { ...s, endTime: e.target.value } : s)) })} disabled={!editable} />
                </Field>
                {editable && (
                  <Button variant="danger" className="sm:mt-5" onClick={() => update({ shifts: draft.shifts.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Band>

      <Band label="Bus rentals" note="Required before a quotation can be issued. No values are assumed; quoting stays blocked until these are set (OPEN_QUESTIONS Q-07, Q-08, Q-09, Q-11, Q-15).">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pricing basis" hint="How rental charges are calculated. Rates themselves are entered per quotation." error={errors["rental.pricingBasis"]}>
            <Select value={draft.rental.pricingBasis ?? ""} onChange={(e) => update({ rental: { ...draft.rental, pricingBasis: (e.target.value || null) as typeof draft.rental.pricingBasis } })} disabled={!editable} invalid={!!errors["rental.pricingBasis"]}>
              <option value="">Not set</option>
              {PRICING_BASES.map((b) => <option key={b} value={b}>{PRICING_BASIS_LABELS[b]}</option>)}
            </Select>
          </Field>
          <Field label="Expired quotation policy" hint="Must be set before an expired quotation can be renewed. No default." error={errors["rental.requotePolicy"]}>
            <Select
              value={draft.rental.requotePolicy ?? ""}
              onChange={(e) => update({ rental: { ...draft.rental, requotePolicy: (e.target.value || null) as typeof draft.rental.requotePolicy } })}
              disabled={!editable}
              invalid={!!errors["rental.requotePolicy"]}
            >
              <option value="">Not set</option>
              <option value={REQUOTE_POLICIES[0]}>Revise the same request and retain quote history</option>
              <option value={REQUOTE_POLICIES[1]}>Cancel and raise a new request</option>
            </Select>
          </Field>
          <Field label="Deposit (% of quotation)" error={errors["rental.depositPercent"]}>
            <TextInput type="number" min={0} max={100} step="0.01" value={draft.rental.depositPercent ?? ""} onChange={(e) => update({ rental: { ...draft.rental, depositPercent: e.target.value === "" ? null : Number(e.target.value) } })} disabled={!editable} placeholder="Not set" invalid={!!errors["rental.depositPercent"]} />
          </Field>
          <Field label="Quotation validity (days)" error={errors["rental.quotationValidityDays"]}>
            <TextInput type="number" min={1} step={1} value={draft.rental.quotationValidityDays ?? ""} onChange={(e) => update({ rental: { ...draft.rental, quotationValidityDays: e.target.value === "" ? null : Number(e.target.value) } })} disabled={!editable} placeholder="Not set" invalid={!!errors["rental.quotationValidityDays"]} />
          </Field>
          <Field label="Are drivers always included?" hint="If not set, each request chooses whether a driver is required.">
            <Select value={draft.rental.driversAlwaysIncluded === null ? "" : draft.rental.driversAlwaysIncluded ? "yes" : "no"} onChange={(e) => update({ rental: { ...draft.rental, driversAlwaysIncluded: e.target.value === "" ? null : e.target.value === "yes" } })} disabled={!editable}>
              <option value="">Not set</option>
              <option value="yes">Yes - always include a driver</option>
              <option value="no">No - per request</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Payment methods</span>
            {editable && <Button onClick={() => update({ rental: { ...draft.rental, paymentMethods: [...draft.rental.paymentMethods, ""] } })}>Add method</Button>}
          </div>
          {errors["rental.paymentMethods"] && <Notice tone="error" className="mb-2">{errors["rental.paymentMethods"]}</Notice>}
          {draft.rental.paymentMethods.length === 0 ? (
            <p className="text-xs text-stone-500">None configured. Deposit recording is blocked until at least one method exists.</p>
          ) : (
            <ul className="space-y-2">
              {draft.rental.paymentMethods.map((method, i) => (
                <li key={i} className="flex items-center gap-2">
                  <TextInput value={method} onChange={(e) => update({ rental: { ...draft.rental, paymentMethods: draft.rental.paymentMethods.map((m, j) => (j === i ? e.target.value : m)) } })} disabled={!editable} placeholder="e.g. Bank transfer, Mobile money" />
                  {editable && <Button variant="danger" onClick={() => update({ rental: { ...draft.rental, paymentMethods: draft.rental.paymentMethods.filter((_, j) => j !== i) } })}>Remove</Button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Band>

      <Band
        label="Invoicing"
        note="Required before an invoice can be issued. The tax position and payment terms are never assumed: a legal document cannot carry a guessed rate or a guessed due date (brief 9, FIN-02)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tax position" hint="Determines whether invoices carry tax lines at all." error={errors.taxPosition}>
            <Select
              value={draft.taxPosition ?? ""}
              onChange={(e) => update({ taxPosition: (e.target.value || null) as typeof draft.taxPosition })}
              disabled={!editable}
              invalid={!!errors.taxPosition}
            >
              <option value="">Not set</option>
              {TAX_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {TAX_POSITION_LABELS[position]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment terms (days from issue)" hint="The due date on an invoice. No default." error={errors.invoiceDueDays}>
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.invoiceDueDays ?? ""}
              onChange={(e) => update({ invoiceDueDays: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!editable}
              placeholder="Not set"
              invalid={!!errors.invoiceDueDays}
            />
          </Field>
        </div>
        {draft.taxPosition === "registered" && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Tax lines</span>
              {editable && (
                <Button onClick={() => update({ taxLines: [...draft.taxLines, { id: "", name: "", ratePercent: 0 }] })}>
                  Add tax line
                </Button>
              )}
            </div>
            {errors.taxLines && <Notice tone="error" className="mb-2">{errors.taxLines}</Notice>}
            {draft.taxLines.length === 0 ? (
              <p className="text-xs text-stone-500">
                None configured. Invoices cannot be issued while the company is marked VAT registered without at least one line.
              </p>
            ) : (
              <ul className="space-y-2">
                {draft.taxLines.map((line, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <TextInput
                      value={line.name}
                      onChange={(e) =>
                        update({ taxLines: draft.taxLines.map((candidate, i) => (i === index ? { ...candidate, name: e.target.value } : candidate)) })
                      }
                      disabled={!editable}
                      placeholder="e.g. VAT"
                      aria-label={`Tax line ${index + 1} name`}
                      invalid={!!errors[`taxLines.${index}`]}
                    />
                    <TextInput
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={line.ratePercent}
                      onChange={(e) =>
                        update({
                          taxLines: draft.taxLines.map((candidate, i) =>
                            i === index ? { ...candidate, ratePercent: e.target.value === "" ? 0 : Number(e.target.value) } : candidate,
                          ),
                        })
                      }
                      disabled={!editable}
                      placeholder="Rate %"
                      aria-label={`Tax line ${index + 1} rate percent`}
                      className="max-w-[120px]"
                      invalid={!!errors[`taxLines.${index}`]}
                    />
                    {editable && (
                      <Button variant="danger" onClick={() => update({ taxLines: draft.taxLines.filter((_, i) => i !== index) })}>
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Band>

      <Band label="Compliance document types"
        note="Required before any vehicle or driver document can be recorded (OPEN_QUESTIONS Q-16). The company names its own document types; none is assumed."
        actions={editable ? <Button onClick={() => update({ documentTypes: [...draft.documentTypes, { id: "", name: "", appliesTo: "vehicle" }] })}>Add document type</Button> : undefined}
      >
        {errors.documentTypes && <Notice tone="error" className="mb-3">{errors.documentTypes}</Notice>}
        {draft.documentTypes.length === 0 ? (
          <p className="text-xs text-stone-500">No document types configured. Document recording is blocked until at least one exists.</p>
        ) : (
          <ul className="space-y-2">
            {draft.documentTypes.map((docType, i) => {
              const inUse = db.documents.some((d) => d.documentTypeId === docType.id);
              return (
                <li key={docType.id || `new-${i}`} className="grid gap-2 sm:grid-cols-[1fr_160px_auto] sm:items-start">
                  <Field label={`Document type ${i + 1}`} error={errors[`documentTypes.${i}`]}>
                    <TextInput
                      value={docType.name}
                      onChange={(e) => update({ documentTypes: draft.documentTypes.map((d, j) => (j === i ? { ...d, name: e.target.value } : d)) })}
                      disabled={!editable}
                      invalid={!!errors[`documentTypes.${i}`]}
                      placeholder="e.g. Insurance, Roadworthy certificate"
                    />
                  </Field>
                  <Field label="Applies to">
                    <Select
                      value={docType.appliesTo}
                      onChange={(e) => update({ documentTypes: draft.documentTypes.map((d, j) => (j === i ? { ...d, appliesTo: e.target.value as typeof d.appliesTo } : d)) })}
                      disabled={!editable}
                    >
                      <option value="vehicle">Vehicles</option>
                      <option value="driver">Drivers</option>
                      <option value="both">Both</option>
                    </Select>
                  </Field>
                  {editable && (
                    <Button
                      variant="danger"
                      className="sm:mt-5"
                      disabled={inUse}
                      title={inUse ? "In use by a recorded document" : "Remove"}
                      onClick={() => update({ documentTypes: draft.documentTypes.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 max-w-xs">
          <Field
            label="Reminder lead time (days before expiry)"
            hint="Until set, compliance status shows only documents that have already expired - no 'expiring soon' warning."
            error={errors.documentReminderLeadDays}
          >
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.documentReminderLeadDays ?? ""}
              onChange={(e) => update({ documentReminderLeadDays: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!editable}
              placeholder="Not set"
              invalid={!!errors.documentReminderLeadDays}
            />
          </Field>
        </div>
      </Band>

      <Band label="Service schedules"
        note="Service intervals per vehicle category. Leave a field blank to say that basis is not used; add no schedule at all to say it is unknown. Nothing is scheduled by default (OPEN_QUESTIONS Q-17, Q-37)."
        actions={
          editable && draft.vehicleCategories.filter((c) => c.id && !draft.maintenance.schedules.some((s) => s.categoryId === c.id)).length > 0 ? (
            <Button
              onClick={async () => {
                const next = draft.vehicleCategories.find((c) => c.id && !draft.maintenance.schedules.some((s) => s.categoryId === c.id));
                if (next) update({ maintenance: { ...draft.maintenance, schedules: [...draft.maintenance.schedules, { categoryId: next.id, intervalKm: null, intervalDays: null, remindLeadKm: null, remindLeadDays: null }] } });
              }}
            >
              Add schedule
            </Button>
          ) : undefined
        }
      >
        {draft.maintenance.schedules.length === 0 ? (
          <p className="text-xs text-stone-500">
            {draft.vehicleCategories.length === 0
              ? "Add a vehicle category first, then schedule it here."
              : "No schedules configured. Fleet readiness reports this as not configured rather than estimating intervals."}
          </p>
        ) : (
          <ul className="space-y-3">
            {draft.maintenance.schedules.map((schedule, index) => (
              <li key={schedule.categoryId} className="grid gap-2 rounded-sm border border-stone-200 p-3 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]">
                <Field label="Category">
                  <Select value={schedule.categoryId} disabled>
                    {draft.vehicleCategories.filter((c) => c.id === schedule.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Interval (km)" hint="blank = not used" error={errors[`maintenance.schedules.${index}`]}>
                  <TextInput type="number" min={0} step={1} value={schedule.intervalKm ?? ""} disabled={!editable} invalid={!!errors[`maintenance.schedules.${index}`]} onChange={(e) => update({ maintenance: { ...draft.maintenance, schedules: draft.maintenance.schedules.map((s, i) => i === index ? { ...s, intervalKm: e.target.value === "" ? null : Number(e.target.value) } : s) } })} />
                </Field>
                <Field label="Interval (days)" hint="blank = not used">
                  <TextInput type="number" min={0} step={1} value={schedule.intervalDays ?? ""} disabled={!editable} onChange={(e) => update({ maintenance: { ...draft.maintenance, schedules: draft.maintenance.schedules.map((s, i) => i === index ? { ...s, intervalDays: e.target.value === "" ? null : Number(e.target.value) } : s) } })} />
                </Field>
                <Field label="Warn lead (km)" hint="blank = no warning">
                  <TextInput type="number" min={0} step={1} value={schedule.remindLeadKm ?? ""} disabled={!editable} onChange={(e) => update({ maintenance: { ...draft.maintenance, schedules: draft.maintenance.schedules.map((s, i) => i === index ? { ...s, remindLeadKm: e.target.value === "" ? null : Number(e.target.value) } : s) } })} />
                </Field>
                <Field label="Warn lead (days)" hint="blank = no warning">
                  <TextInput type="number" min={0} step={1} value={schedule.remindLeadDays ?? ""} disabled={!editable} onChange={(e) => update({ maintenance: { ...draft.maintenance, schedules: draft.maintenance.schedules.map((s, i) => i === index ? { ...s, remindLeadDays: e.target.value === "" ? null : Number(e.target.value) } : s) } })} />
                </Field>
                {editable && (
                  <Button variant="danger" className="mt-5" onClick={() => update({ maintenance: { ...draft.maintenance, schedules: draft.maintenance.schedules.filter((_, i) => i !== index) } })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-stone-500">
          A service counts as &ldquo;done&rdquo; only when a work order is completed and marked as resetting the interval. The system never infers that from a repair.
        </p>
      </Band>

      <Band label="Planned settings (not yet modelled)" note="These are open questions for management and will become settings in the phases that need them.">
        <ul className="grid gap-1 text-xs text-stone-600 sm:grid-cols-2">
          {["Cancellation windows and refund rules", "VAT, levies and GRA e-VAT", "Retention periods", "Boarding-code policy", "Contract billing frequency and payment terms"].map((q) => (
            <li key={q} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-stone-400" />
              {q}
            </li>
          ))}
        </ul>
      </Band>

      {editable && dirty && <Notice tone="warning">You have unsaved changes.</Notice>}
    </form>
  );
}
