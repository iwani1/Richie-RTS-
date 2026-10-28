import { useState, type FormEvent } from "react";
import { parseTags } from "../tms/driving";
import { setupProgress } from "../tms/setup";
import { useTms } from "../tms/useTms";
import type { Settings } from "../tms/types";
import { PRICING_BASES, PRICING_BASIS_LABELS, REQUOTE_POLICIES, TAX_POSITIONS, TAX_POSITION_LABELS } from "../tms/types";
import { Badge, Band, Button, Field, Notice, PageHeader, Select, TextArea, TextInput } from "../ui/primitives";

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
        note="Required before any vehicle can be registered. Categories in use by a vehicle cannot be removed. The licence classes are what dispatch holds a driver to: leave them empty and any licence may be signed to the vehicle."
        actions={editable ? <Button onClick={() => update({ vehicleCategories: [...draft.vehicleCategories, { id: "", name: "", licenceClasses: [] }] })}>Add category</Button> : undefined}
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
                {/* FLT-04: the classes a driver must hold to be signed to this kind of vehicle. */}
                <Field
                  label="Licence classes that may drive it"
                  hint="From the licences, such as C or D. Blank checks nothing."
                  error={errors[`vehicleCategories.${i}.licenceClasses`]}
                  className="flex-1"
                >
                  <TextInput
                    value={(cat.licenceClasses ?? []).join(", ")}
                    onChange={(e) =>
                      update({
                        vehicleCategories: draft.vehicleCategories.map((c, j) =>
                          j === i ? { ...c, licenceClasses: parseTags(e.target.value, { upper: true }) } : c,
                        ),
                      })
                    }
                    disabled={!editable}
                    invalid={!!errors[`vehicleCategories.${i}.licenceClasses`]}
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

      <Band label="Types of work"
        note="What a work order is for (OPEN_QUESTIONS Q-34). The six below are the list agreed with the owner; rename, remove or add to it. A work order raised under a name you later remove keeps its own wording."
        actions={editable ? <Button onClick={() => update({ workTypes: [...draft.workTypes, ""] })}>Add work type</Button> : undefined}
      >
        {draft.workTypes.length === 0 ? (
          <p className="text-xs text-stone-500">No work types configured. A work order cannot be raised until at least one exists.</p>
        ) : (
          <ul className="space-y-2">
            {draft.workTypes.map((name, i) => (
              <li key={`work-${i}`} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <Field label={`Work type ${i + 1}`} error={errors[`workTypes.${i}`]}>
                  <TextInput
                    value={name}
                    disabled={!editable}
                    invalid={!!errors[`workTypes.${i}`]}
                    onChange={(e) => update({ workTypes: draft.workTypes.map((value, j) => (j === i ? e.target.value : value)) })}
                  />
                </Field>
                {editable && (
                  <Button variant="danger" className="sm:mt-5" onClick={() => update({ workTypes: draft.workTypes.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {errors.workTypes && <Notice tone="error" className="mt-3">{errors.workTypes}</Notice>}
      </Band>

      <Band label="Cost categories"
        note="What a recorded cost was for (OPEN_QUESTIONS Q-29). Nothing is assumed: leave the list empty and costs are recorded as uncategorised. The financial report groups expenses by these names."
        actions={editable ? <Button onClick={() => update({ costCategories: [...draft.costCategories, ""] })}>Add cost category</Button> : undefined}
      >
        {draft.costCategories.length === 0 ? (
          <p className="text-xs text-stone-500">No cost categories configured. Costs can still be recorded, and are counted as uncategorised.</p>
        ) : (
          <ul className="space-y-2">
            {draft.costCategories.map((name, i) => (
              <li key={`cost-${i}`} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <Field label={`Cost category ${i + 1}`} error={errors[`costCategories.${i}`]}>
                  <TextInput
                    value={name}
                    disabled={!editable}
                    invalid={!!errors[`costCategories.${i}`]}
                    onChange={(e) => update({ costCategories: draft.costCategories.map((value, j) => (j === i ? e.target.value : value)) })}
                  />
                </Field>
                {editable && (
                  <Button variant="danger" className="sm:mt-5" onClick={() => update({ costCategories: draft.costCategories.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {errors.costCategories && <Notice tone="error" className="mt-3">{errors.costCategories}</Notice>}
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
          <Field
            label="Second signature above"
            hint={draft.currencyCode ? `In ${draft.currencyCode}. A quotation at or above this figure needs approving by somebody other than its author. Blank means no approval is required.` : "A quotation at or above this figure needs approving by somebody other than its author. Blank means no approval is required."}
            error={errors["rental.quotationApprovalAbove"]}
          >
            <TextInput
              type="number"
              min={0}
              step="0.01"
              value={draft.rental.quotationApprovalAbove ?? ""}
              onChange={(e) => update({ rental: { ...draft.rental, quotationApprovalAbove: e.target.value === "" ? null : Number(e.target.value) } })}
              disabled={!editable}
              placeholder="No approval required"
              invalid={!!errors["rental.quotationApprovalAbove"]}
            />
          </Field>
          <Field
            label="Second signature on extra charges above"
            hint={
              draft.currencyCode
                ? `In ${draft.currencyCode}. A charge added when a hire comes back (fuel, damage, waiting) at or above this figure needs approving by somebody other than the person who added it, before it can be billed. Blank means no approval is required for charges.`
                : "A charge added when a hire comes back at or above this figure needs approving by somebody other than the person who added it, before it can be billed. Blank means no approval is required for charges."
            }
            error={errors["rental.extraChargeApprovalAbove"]}
          >
            <TextInput
              type="number"
              min={0}
              step="0.01"
              value={draft.rental.extraChargeApprovalAbove ?? ""}
              onChange={(e) => update({ rental: { ...draft.rental, extraChargeApprovalAbove: e.target.value === "" ? null : Number(e.target.value) } })}
              disabled={!editable}
              placeholder="No approval required"
              invalid={!!errors["rental.extraChargeApprovalAbove"]}
            />
          </Field>
          <Field label="Quotation validity (hours)" hint="How long a price holds, counted from the minute the quotation is issued. 168 is one week." error={errors["rental.quotationValidityHours"]}>
            <TextInput type="number" min={24} max={8760} step={1} value={draft.rental.quotationValidityHours ?? ""} onChange={(e) => update({ rental: { ...draft.rental, quotationValidityHours: e.target.value === "" ? null : Number(e.target.value) } })} disabled={!editable} placeholder="Not set" invalid={!!errors["rental.quotationValidityHours"]} />
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
        {/* RNT-04, D-117: the conditions printed on every quotation. Written by the company, never
            supplied by the build — until they are written, a quotation cannot be issued. */}
        <div className="mt-4">
          <Field
            label="Quotation terms"
            hint="Printed on every quotation: what the price includes, the deposit, and what happens if the hire is cancelled. Required before a quotation can be issued."
            error={errors["rental.quotationTerms"]}
          >
            <TextArea
              value={draft.rental.quotationTerms}
              onChange={(e) => update({ rental: { ...draft.rental, quotationTerms: e.target.value } })}
              disabled={!editable}
              invalid={!!errors["rental.quotationTerms"]}
              rows={5}
            />
          </Field>
          {draft.rental.quotationTerms.trim() === "" && (
            <p className="mt-1 text-xs text-stone-600">No terms have been written, so quotations are blocked. Nothing is filled in for you.</p>
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
        note={'The company names its own document types; none is assumed. A type ticked "must be current to assign" stops a vehicle, driver or run being assigned while that paper is missing or has expired (Q-16).'}
        actions={editable ? <Button onClick={() => update({ documentTypes: [...draft.documentTypes, { id: "", name: "", appliesTo: "vehicle", required: false }] })}>Add document type</Button> : undefined}
      >
        {errors.documentTypes && <Notice tone="error" className="mb-3">{errors.documentTypes}</Notice>}
        {draft.documentTypes.length === 0 ? (
          <p className="text-xs text-stone-500">No document types configured. Document recording is blocked until at least one exists.</p>
        ) : (
          <ul className="space-y-2">
            {draft.documentTypes.map((docType, i) => {
              const inUse = db.documents.some((d) => d.documentTypeId === docType.id);
              return (
                <li key={docType.id || `new-${i}`} className="grid gap-2 sm:grid-cols-[1fr_160px_180px_auto] sm:items-start">
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
                  <Field label="Before assignment">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={docType.required === true}
                        disabled={!editable}
                        onChange={(e) => update({ documentTypes: draft.documentTypes.map((d, j) => (j === i ? { ...d, required: e.target.checked } : d)) })}
                      />
                      <span>Must be current to assign</span>
                    </label>
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
        <div className="mt-3 rounded-sm border border-stone-200 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.maintenance.blockOnOverdueService === true}
              disabled={!editable}
              onChange={(e) => update({ maintenance: { ...draft.maintenance, blockOnOverdueService: e.target.checked } })}
            />
            <span>
              <span className="font-medium">Block work on an overdue routine service</span>
              <span className="mt-1 block text-xs text-stone-600">
                Off by default. While it is off, a vehicle past its interval still goes out and the office is
                told in the message after assignment or dispatch. While it is on, that vehicle cannot be
                assigned, dispatched, started or hired until the service is recorded. A safety defect stops
                a vehicle either way: this switch is only about routine service (Q-43).
              </span>
            </span>
          </label>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          A service counts as &ldquo;done&rdquo; only when a work order is completed and marked as resetting the interval. The system never infers that from a repair.
        </p>
      </Band>

      <Band
        label="Fleet"
        note="What a vehicle costs the company on a day it does not work: finance, insurance, licensing, the driver on retainer. It prices the idle days on the fleet dashboard. There is no default — until it is set, that screen counts the idle days and puts no money on them (FLT-05, D-112)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Standing cost per vehicle per day"
            hint={`In ${draft.currencyCode ? `${draft.currencyCode}, ` : "the company's currency, "}to at most two decimals. Blank means the cost of an idle day is not known.`}
            error={errors.fleetStandingCostPerDay}
          >
            <TextInput
              type="number"
              min={0}
              step="0.01"
              value={draft.fleetStandingCostPerDay ?? ""}
              onChange={(e) => update({ fleetStandingCostPerDay: e.target.value === "" ? null : Number(e.target.value) })}
              disabled={!editable}
              placeholder="Not set"
              invalid={!!errors.fleetStandingCostPerDay}
            />
          </Field>
        </div>
      </Band>

      <Band
        label="Seat bookings"
        note="How late a seat can still be requested, and how late it can be cancelled, counted in minutes before the run's first stop departs. Both are blank until management sets them: with no cut-off, a booking is accepted right up to departure and nothing is refused for a deadline nobody chose (BKG-02, BKG-05, D-83)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Booking cut-off (minutes before departure)"
            hint="Blank means no cut-off. A request inside it is refused and the message says why."
            error={errors["booking.requestCutoffMinutes"]}
          >
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.booking.requestCutoffMinutes ?? ""}
              onChange={(e) =>
                update({ booking: { ...draft.booking, requestCutoffMinutes: e.target.value === "" ? null : Number(e.target.value) } })
              }
              disabled={!editable}
              placeholder="Not set"
              invalid={!!errors["booking.requestCutoffMinutes"]}
            />
          </Field>
          <Field
            label="Cancellation cut-off (minutes before departure)"
            hint="Blank means a booking can be cancelled at any time. Inside the cut-off the office has to cancel it."
            error={errors["booking.cancellationCutoffMinutes"]}
          >
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.booking.cancellationCutoffMinutes ?? ""}
              onChange={(e) =>
                update({ booking: { ...draft.booking, cancellationCutoffMinutes: e.target.value === "" ? null : Number(e.target.value) } })
              }
              disabled={!editable}
              placeholder="Not set"
              invalid={!!errors["booking.cancellationCutoffMinutes"]}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          A cut-off applies to booked seats, not to the standing roster. Neither setting changes the audit trail: every booking
          keeps its own history of who asked, who confirmed and who cancelled.
        </p>
      </Band>

      <Band label="Planned settings (not yet modelled)" note="These are open questions for management and will become settings in the phases that need them.">
        <ul className="grid gap-1 text-xs text-stone-600 sm:grid-cols-2">
          {["Refund rules", "VAT, levies and GRA e-VAT", "Retention periods", "Boarding-code policy", "Contract billing frequency and payment terms"].map((q) => (
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
