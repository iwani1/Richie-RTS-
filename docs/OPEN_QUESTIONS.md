# Open questions for management

Nothing below has been assumed. Where a question maps to a setting, the setting exists with **no default** and dependent features stay blocked until it is filled in.

| # | Question | Blocks | Modelled as |
|---|----------|--------|-------------|
| Q-01 | Hosting target: does it support Node.js, PostgreSQL (with `btree_gist`), background workers, WebSockets? | Production persistence (see DECISIONS D-01) | Not modelled; build environment is static-only |
| Q-02 | Official company name as it should appear on documents | Quotations, invoices | `settings.companyName` |
| Q-03 | Billing currency (Ghana's national currency is GHS; confirm) | Pricing, invoicing | `settings.currencyCode` |
| Q-04 | Vehicle categories used commercially (e.g. by seat band or type) | Vehicle registration (blocked until set) | `settings.vehicleCategories` |
| Q-05 | Shift names and times for staff busing | Route scheduling (Phase 1B) | `settings.shifts` |
| Q-06 | On-time threshold (minutes after scheduled time still counted on time) | RPT-01 on-time KPI | `settings.onTimeThresholdMinutes` |
| Q-07 | Rental pricing basis (per day / per km / per trip / mixed) | Quotations | `settings.rental.pricingBasis` (no default); mixed not yet supported |
| Q-08 | Deposit amount or percentage for rentals | Booking confirmation | `settings.rental.depositPercent` (no default) |
| Q-09 | Quotation validity period | Quotation expiry | `settings.rental.quotationValidityDays` (no default) |
| Q-10 | Cancellation windows and refund rules | Cancellations, credit notes | Not yet modelled (cancel captures a reason only; no refund calc) |
| Q-11 | Are drivers always included in rentals? | Rental resource assignment | `settings.rental.driversAlwaysIncluded` (no default; per-request fallback) |
| Q-12 | Who approves quotations and additional charges? | Approval workflow | Not yet modelled |
| Q-13 | Contract billing frequency and payment terms | Contract invoicing | Not yet modelled |
| Q-14 | VAT, levies (NHIL, GETFund, COVID-19 levy) and GRA e-VAT obligations | Tax lines on invoices | Not yet modelled |
| Q-15 | Payment methods in use (bank transfer, mobile money, cash, cheque) | Payment recording | `settings.rental.paymentMethods` (no default; admin-defined list) |
| Q-23 | Rental final billing: is the deposit deducted from the final invoice, or separate? The UI shows deposit and balance but does not post a payment ledger. | Invoicing/payments | Not yet modelled |
| Q-24 | Should an expired quotation be re-issuable in place, or must a new request be raised? | Quotation lifecycle | Administrator selects `settings.rental.requotePolicy` with no default; renewal is blocked until chosen. The value in force when renewal is requested decides. |
| Q-25 | On-time rule: is the on-time judgement made per stop or for the whole trip, and do early arrivals count as on time? The build uses per stop, early counts as on time (a proposal). | RPT-01 on-time rate | Threshold snapshot on each trip; rule in `busing.ts` |
| Q-26 | Does every staff busing trip need a driver as a business rule? The build requires one at dispatch. | Dispatch | Enforced in `assessResources` |
| Q-27 | Should route stop times come from shift definitions (`settings.shifts`), or be entered per route? The build enters them per route and links an optional shift. | Route scheduling | `RouteStop.scheduledTime`; `RouteInput.shiftId` |
| Q-28 | Who maintains each client's passenger roster, in what format, and how often is it updated? | Passenger data accuracy | Not modelled (manual entry only) |
| Q-29 | Definitions and inputs for RPT-02 (fleet utilisation) and RPT-03 (cost per trip), and the cost categories to be recorded. | RPT-02, RPT-03 | Not configured |
| Q-30 | Can a passenger ride more than one route (for example different days or directions)? The build allows one. | Passenger model | `Passenger.routeId` single value |
| Q-31 | When a route is suspended, what happens to its planned trips: cancel them, hold them, or keep them? The build blocks dispatch and keeps the trips planned. | Route status | `dispatch_trip` route check |
| Q-32 | Lawful basis and employee notice for recording passenger identity, pickup stop and boarding outcomes. | Data protection | DATA_PROTECTION.md section 2 |
| Q-33 | Who may report a breakdown? Drivers are the obvious source, but the driver role has no access in this build (no own-record scope yet). Should drivers report incidents directly? | Breakdown response | `driver` role has no incident permissions |
| Q-34 | What causes of breakdown or maintenance are there? No cause/fault taxonomy is configured, so incidents and work orders use free-text type and description. | Incident and maintenance reporting | `IncidentInput.type`, `WorkOrderInput.workType` |
| Q-35 | Should finance see incident descriptions? Recording breakdown costs needs finance to open the incident, but descriptions may name drivers or describe an accident. | Data minimisation | `incidents:read` granted to `finance` |
| Q-36 | Who reviews and closes a work order, and is an independent cost review required? The build lets the closing user record the review note. | Maintenance governance | `advance_work_order` `to: "closed"` |
| Q-37 | Are vehicle checks or service intervals due by date or odometer? | Fleet maintenance | **Partly answered in Phase 8:** both bases (km and/or days) are now configurable per vehicle category in `settings.maintenance.schedules` with no default; odometer readings are hand-recorded (`odometerReadings`). Still open: the actual interval/lead values, whether reminders should be sent externally, and whether an overdue service should block dispatch (Q-43). |
| Q-38 | Can one corporate client have several contact accounts? This build allows exactly one, so a second contact is refused rather than silently sharing a login. | Client portal | `validateUser` client_contact link |
| Q-39 | Should a driver see the passenger list for its run, and how much of it? The portal shows name and pickup stop only, hiding phone and employee reference. | Data minimisation | `scopedView` driver branch, ClientPortal roster columns |
| Q-40 | Who may change which record a driver account is linked to, and what happens to that account when the driver leaves? No offboarding flow exists. | Access management | `User.driverId` on the Users screen |
| Q-41 | Who records boarding outcomes — the driver at the door, or operations afterwards? | Boarding accuracy | Driver and operations can record per stop; driver scope is own run only (Phase 10) |
| Q-42 | How should a wrong stop time or boarding outcome be corrected after it is saved, or after a run is completed? | Trip records | Progressive entries and completed trips are immutable; no correction workflow until policy is set |
| Q-16 | Document types to track per vehicle/driver and reminder lead times | Compliance reminders | **Partly answered in Phase 6:** the company names its own document types in Settings (`settings.documentTypes`, applies to vehicle/driver/both) and sets `settings.documentReminderLeadDays` with no default. Still open: the reminder lead time value itself, which document types are *mandatory* before a vehicle may work, and whether a reminder should be sent (no notification provider configured). |
| Q-17 | Service intervals (km / days) per vehicle category | Maintenance scheduling | Administrator-configured schedules per category (`settings.maintenance.schedules`); every field has no default (D-30) |
| Q-18 | Data retention periods for personal data (Act 843) | Retention jobs | Not yet modelled |
| Q-19 | Boarding-code policy for staff busing passengers | Boarding module | Not yet modelled |
| Q-20 | Are bookings allowed under expired or suspended contracts? | Booking validation | Not yet modelled |
| Q-21 | Which roles exist in the company and who holds them (admin, dispatch, finance, drivers, client contacts)? Current matrix is a proposal in `PERMISSIONS.md`. | User provisioning | `ROLE_PERMISSIONS` |
| Q-22 | Phase 1A scope confirmation: the Phase 1A prompt was not in the uploaded files; this slice was scoped as foundation + master data. | Phase 1B planning | - |
| Q-43 | Should an overdue service block vehicle assignment or trip dispatch? | Dispatch gate for maintenance | Readiness reports and warns only; dispatch is not blocked (D-33) |
| Q-44 | Which work orders count as a service: always an operator decision, or should certain work types apply automatically? | Service interval anchoring | Operator ticks it per work order; never inferred (D-31). Work type is free text (Q-34) |
| Q-45 | Where should the odometer come from: hand entry, a fuel/telematics provider, or the workshop? | Odometer accuracy and effort | Hand-recorded readings only; no feed configured (D-32) |
| Q-47 | What should operations do if a trip has started but cannot be completed (breakdown, safety event, driver unable to continue)? | In-progress trip resolution | In-progress trips cannot be cancelled from the board; report an incident, with no abort/reassign policy implemented |
| Q-46 | Should a renewed quote use the current pricing basis, deposit percentage and validity period, or retain the values that applied to the expired quote? | Quote renewal terms | Current configured values apply to a new revision; prior values remain in the revision history (D-35). Confirm this policy. |
| Q-48 | Should the driver be explicitly notified when operations changes the roster mid-run (new rider, removal, stop move)? | Driver awareness | No notification channel exists; the driver sees the current roster on the next stop form. Pushing an alert needs a provider (as with other notifications). |
