/* eslint-disable @typescript-eslint/no-explicit-any -- the bodies are JSON from this app's own
   endpoints. The script asserts the fields it needs one by one; modelling every response shape a
   second time in TypeScript would let the two drift without either being wrong. */
// Workflow C over HTTP, end to end, against a running server and a real database.
//
// This is the substitute for the brief's Playwright scenario (D-68): it drives the same endpoints a
// browser does — the session cookie, the CSRF check, the command envelope, the 4xx behaviour — but
// it does not render anything. The browser rendering is covered separately by the jsdom tests.
//
// Run local:  BASE_URL=http://localhost:3000 npm run e2e
// In CI:      the `e2e` job starts `next start` against a PostgreSQL service, then runs this file.
//
// It asserts, in order: health, an unauthenticated command is refused, first-run setup, sign-in,
// settings, the public enquiry form (WEB-01), a vehicle, a rental request, a quotation, the deposit, assignment, start, completion,
// an invoice with the configured tax, two payments that settle it, that the reload shows the same
// records, and that a cross-origin write is refused.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "admin@example.test";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-2026";

let cookie = "";
let checks = 0;

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function ok(condition: boolean, message: string): void {
  checks += 1;
  if (!condition) fail(message);
  console.log(`  ✓ ${message}`);
}

async function request(path: string, init: RequestInit = {}, expect?: number): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (expect !== undefined && response.status !== expect) {
    fail(`${init.method ?? "GET"} ${path} returned ${response.status}, expected ${expect}\n${text.slice(0, 800)}`);
  }
  return { status: response.status, body };
}

async function command(type: string, body: Record<string, unknown> = {}): Promise<any> {
  const { status, body: payload } = await request("/api/commands", { method: "POST", body: JSON.stringify({ type, ...body }) }, 200);
  if (status !== 200) fail(`${type} failed: ${JSON.stringify(payload)}`);
  return payload.database;
}

const today = new Date().toISOString().slice(0, 10);
// Unique per run, so the script can be pointed at a development database that already has records
// as well as at the empty one CI provides.
const stamp = Date.now().toString().slice(-6);
const registration = `GT ${stamp.slice(0, 4)}-26`;
const customer = `E2E Customer ${stamp}`;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log(`Workflow C over HTTP against ${BASE}`);

  // 1. The server is up and can reach its database.
  const health = await request("/api/health", {}, 200);
  ok(health.body?.ok === true, "GET /api/health reports healthy");

  // 2. Nothing is readable or writable before signing in.
  const anonymous = await request("/api/commands", { method: "POST", body: JSON.stringify({ type: "record_sign_in" }) }, 401);
  ok(anonymous.body?.ok === false, "an unauthenticated command is refused with 401");

  // 3. First run, or an installation that already has its administrator.
  const setup = await request("/api/setup", {
    method: "POST",
    body: JSON.stringify({ fullName: "E2E Administrator", email: EMAIL, password: PASSWORD }),
  });
  if (setup.status === 201) {
    ok(setup.body?.ok === true, "first-run setup created the administrator and signed in");
  } else if (setup.status === 409) {
    await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }, 200);
    ok(true, "installation already set up; signed in as the administrator");
  } else {
    fail(`POST /api/setup returned ${setup.status}: ${JSON.stringify(setup.body)}`);
  }

  const session = await request("/api/session", {}, 200);
  ok(session.body?.user?.role === "administrator", "the session reports the administrator role");
  ok(session.body?.setupRequired === false, "the installation no longer needs setup");

  // 4. Configure the settings a rental needs. Nothing is defaulted by the application.
  const settings = session.body.database.settings;
  // Additive on purpose: against a development database that already has vehicles, replacing the
  // category list would be refused (a category in use cannot be removed).
  const categories = settings.vehicleCategories.some((category: any) => category.name === "Coaster")
    ? settings.vehicleCategories
    : [...settings.vehicleCategories, { id: "", name: "Coaster" }];
  const paymentMethods = Array.from(new Set([...(settings.rental.paymentMethods ?? []), "Cash", "Bank transfer"]));
  await command("update_settings", {
    input: {
      ...settings,
      companyName: settings.companyName ?? "Richie Transport Services",
      currencyCode: "GHS",
      vehicleCategories: categories,
      rental: {
        ...settings.rental,
        pricingBasis: "per_day",
        depositPercent: 20,
        // RNT-04, D-117: the price holds for a fortnight, and the company writes its own terms.
        quotationValidityHours: 336,
        quotationTerms: "Prices are firm for the validity period.",
        paymentMethods,
      },
      taxPosition: "registered",
      taxLines: settings.taxLines.length ? settings.taxLines : [{ id: "", name: "VAT", ratePercent: 15 }],
      invoiceDueDays: 14,
    },
  });
  let db = await request("/api/session", {}, 200).then((r) => r.body.database);
  ok(db.settings.currencyCode === "GHS" && db.settings.taxPosition === "registered", "settings saved through the API");

  // 4b. WEB-01: a stranger can open the public form and send an enquiry, and gets nothing back
  //     but a reference. Sent with no cookie and from the website's own origin, which is the
  //     situation the embeddable form is built for.
  const publicForm = await request("/api/enquiry", { headers: { cookie: "" } }, 200);
  ok(
    typeof publicForm.body?.token === "string" && Array.isArray(publicForm.body?.categories),
    "GET /api/enquiry hands out a form token and the vehicle types",
  );
  ok(
    Object.keys(publicForm.body ?? {}).sort().join(",") === "categories,ok,open,token",
    "the public form endpoint exposes no records and no counts",
  );
  const categoryId = db.settings.vehicleCategories[0].id;
  const enquiryName = `Enquiry ${stamp}`;
  const enquiry = await request(
    "/api/enquiry",
    {
      method: "POST",
      headers: { cookie: "", origin: "https://richietransport.example" },
      body: JSON.stringify({
        token: publicForm.body.token,
        customerName: enquiryName,
        customerPhone: "+233 24 555 0100",
        customerEmail: "",
        organization: "",
        purpose: "Staff outing",
        pickupLocation: "Osu",
        dropoffLocation: "Ada",
        startDate: inDays(21),
        endDate: inDays(22),
        passengers: "24",
        vehicleCategoryId: categoryId,
        notes: "",
      }),
    },
    400,
  );
  // The token was issued milliseconds ago, so the time-trap refuses it — which is the point: a
  // script that fetches a token and posts in the same breath is not a person.
  ok(/open too long|finished loading/.test(String(enquiry.body?.message)), "a token used too fast is refused");

  // Wait until that same token is unmistakably a few seconds old, then send the real enquiry with
  // it: one token, refused at zero seconds and accepted at five, which is the whole mechanism.
  await new Promise((resolve) => setTimeout(resolve, 4_500));
  const submitted = await request(
    "/api/enquiry",
    {
      method: "POST",
      headers: { cookie: "", origin: "https://richietransport.example" },
      body: JSON.stringify({
        token: publicForm.body.token,
        customerName: enquiryName,
        customerPhone: "+233 24 555 0100",
        customerEmail: "",
        organization: "",
        purpose: "Staff outing",
        pickupLocation: "Osu",
        dropoffLocation: "Ada",
        startDate: inDays(21),
        endDate: inDays(22),
        passengers: "24",
        vehicleCategoryId: categoryId,
        notes: "Two pickups.",
      }),
    },
    200,
  );
  ok(
    Object.keys(submitted.body ?? {}).sort().join(",") === "message,ok,reference" &&
      /^RR-\d{4,}$/.test(String(submitted.body?.reference)),
    `an anonymous enquiry is accepted and answered with ${submitted.body?.reference} and nothing else`,
  );
  const hostile = await request(
    "/api/enquiry",
    { method: "POST", headers: { cookie: "" }, body: JSON.stringify({ token: "forged.0000", customerName: enquiryName }) },
    400,
  );
  ok(hostile.body?.ok === false, "an enquiry with no usable token is refused");

  const withEnquiry = await request("/api/session", {}, 200).then((r) => r.body.database);
  const enquiryRental = withEnquiry.rentals.find((rental: any) => rental.reference === submitted.body.reference);
  ok(
    enquiryRental?.status === "draft" && /public enquiry form/i.test(enquiryRental?.notes ?? ""),
    "the enquiry reaches the office as a draft, marked as having come from the website",
  );
  ok(
    withEnquiry.audit.some((entry: any) => entry.action === "rentals:enquiry" && entry.entityId === enquiryRental?.id),
    "the enquiry is in the audit log",
  );

  // 4c. The page itself, and the one header that makes it embeddable.
  const embedPage = await fetch(`${BASE}/enquiry?embed=1`);
  const embedHtml = await embedPage.text();
  ok(embedPage.status === 200 && embedHtml.includes("Request a vehicle"), "the public enquiry page renders");
  ok(
    !embedPage.headers.get("x-frame-options") && /frame-ancestors \*/.test(embedPage.headers.get("content-security-policy") ?? ""),
    "the enquiry page may be framed by the company's own website",
  );
  const shell = await fetch(`${BASE}/`);
  ok(shell.headers.get("x-frame-options") === "DENY", "the application itself still refuses to be framed");

  // 5. A vehicle in the configured category.
  db = await command("create_vehicle", {
    input: { registration, categoryId: db.settings.vehicleCategories[0].id, make: "Toyota", model: "Coaster", seatCapacity: "30", notes: "" },
  });
  const vehicle = db.vehicles.find((candidate: any) => candidate.registration === registration);
  ok(Boolean(vehicle), "vehicle created");
  const vehicleId = vehicle.id;

  // 6. A rental request from a customer who rang in.
  db = await command("create_rental", {
    input: {
      clientId: null,
      customerName: customer,
      customerPhone: "0244000000",
      customerEmail: "ops@acme.test",
      purpose: "Staff retreat",
      pickupLocation: "Accra",
      dropoffLocation: "Kumasi",
      startDate: today,
      endDate: inDays(2),
      passengers: "12",
      vehicleCategoryId: db.settings.vehicleCategories[0].id,
      driverRequired: false,
      notes: "",
    },
  });
  const rental = db.rentals.find((candidate: any) => candidate.customerName === customer);
  ok(Boolean(rental), "rental request created");
  const rentalId = rental.id;
  ok(rental.status === "draft", "rental request is recorded as a Draft");

  // 7. Quotation: 2 days at 1,500 = 3,000 with a 20% deposit required.
  const byRental = (database: any) => database.rentals.find((candidate: any) => candidate.id === rentalId);
  db = await command("quote_rental", { id: rentalId, input: { lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }] } });
  ok(byRental(db).quote?.subtotal === 3000, "quotation subtotal is GHS 3,000");
  ok(byRental(db).quote?.depositRequired === 600, "deposit required is 20% (GHS 600)");
  // RNT-04, D-117: the quotation is a numbered document with its own terms and an hour it stops holding.
  ok(/^QUO-\d{4,}$/.test(byRental(db).quote?.number ?? ""), `quotation numbered ${byRental(db).quote?.number}`);
  ok(byRental(db).quote?.revision === 1, "first issue is revision 1");
  ok(byRental(db).quote?.terms === "Prices are firm for the validity period.", "the company's terms are on the quotation");
  ok(
    byRental(db).quote?.validUntil === new Date(new Date(byRental(db).quote.quotedAt).getTime() + 336 * 3_600_000).toISOString(),
    "the price holds for exactly 336 hours from the minute it was quoted",
  );

  // 8. The deposit is taken and the rental confirmed.
  db = await command("confirm_rental", { id: rentalId, input: { amount: "600", method: "Cash", reference: "DEP-1" } });
  ok(byRental(db).status === "confirmed", "rental confirmed after the deposit");

  // 9-11. Assignment, start and completion.
  db = await command("assign_rental", { id: rentalId, input: { vehicleId, driverId: "" } });
  ok(byRental(db).assignedVehicleId === vehicleId, "vehicle assigned");
  // RNT-07, D-118: the odometer read out as it leaves, which is what makes the distance a measurement.
  db = await command("start_rental", { id: rentalId, odometerKm: "48000" });
  ok(byRental(db).status === "in_progress", "rental started");
  db = await command("complete_rental", {
    id: rentalId,
    input: {
      lines: [{ description: "Two days hire", quantity: "2", unitAmount: "1500" }],
      odometerEndKm: "48120",
      damageNotes: "Nothing reported.",
      feedback: "On time; the customer will book again.",
    },
  });
  ok(byRental(db).status === "completed", "rental completed");
  ok(byRental(db).run?.distanceKm === 120, `the hire records ${byRental(db).run?.distanceKm} km from the odometer`);
  ok(byRental(db).run?.distanceSource === "odometer", "the distance is marked as measured, not typed");
  ok(byRental(db).run?.departedAt && byRental(db).run?.returnedAt, "the hire records when it left and came back");
  ok(byRental(db).run?.feedback === "On time; the customer will book again.", "the customer's words are kept with the hire");

  // 12. Invoice: 3,000 plus 15% VAT = 3,450, due in 14 days.
  db = await command("issue_rental_invoice", {
    input: { rentalId, issuedOn: today, discountAmount: "", discountReason: "", notes: "Thank you" },
  });
  const invoice = db.invoices.find((candidate: any) => candidate.rentalId === rentalId);
  ok(Boolean(invoice), "invoice issued for the rental");
  ok(new RegExp(`^INV-${today.slice(0, 4)}-\\d{4,}$`).test(invoice.reference), `invoice numbered ${invoice.reference}`);
  ok(invoice.total === 3450, "invoice total is GHS 3,450 (3,000 + 15% VAT)");
  ok(invoice.dueOn === inDays(14), `invoice due on ${invoice.dueOn}`);

  // 13. Two payments settle it.
  const byInvoice = (database: any) => database.invoices.find((candidate: any) => candidate.id === invoice.id);
  db = await command("record_payment", {
    input: { invoiceId: invoice.id, amount: "1000", method: "Cash", paidOn: today, externalReference: `RCPT-${stamp}`, note: "" },
  });
  ok(byInvoice(db).status === "part_paid", "a part payment shows as part paid");
  db = await command("record_payment", {
    input: { invoiceId: invoice.id, amount: "2450", method: "Bank transfer", paidOn: today, externalReference: `SLIP-${stamp}`, note: "" },
  });
  ok(byInvoice(db).status === "paid" && byInvoice(db).amountPaid === 3450, "the invoice is paid in full");

  // 14. What a fresh page load sees.
  const reloaded = await request("/api/session", {}, 200).then((r) => r.body.database);
  ok(reloaded.rentals.find((r: any) => r.id === rentalId)?.status === "completed", "after a reload the rental is still completed");
  ok(reloaded.invoices.find((i: any) => i.id === invoice.id)?.status === "paid", "after a reload the invoice is still paid");
  const payments = reloaded.payments.filter((p: any) => p.invoiceId === invoice.id);
  ok(
    payments.length === 2 && payments.every((p: any) => new RegExp(`^PAY-${today.slice(0, 4)}-\\d{4,}$`).test(p.reference)),
    `both payments were stored with their own numbers (${payments.map((p: any) => p.reference).join(", ")})`,
  );

  // 15. AUTH-05: the account can read its own record and sign-in history, and a wrong current
  //     password is refused without changing anything.
  const profile = await request("/api/profile", {}, 200);
  ok(profile.body?.user?.email === EMAIL, "GET /api/profile returns the signed-in account");
  ok(Array.isArray(profile.body?.signIns) && profile.body.signIns.length >= 1, "the sign-in history has this session in it");
  const wrongPassword = await request(
    "/api/profile",
    { method: "POST", body: JSON.stringify({ action: "password", currentPassword: "not-the-password", newPassword: "another-password-2026" }) },
    400,
  );
  ok(Boolean(wrongPassword.body?.errors?.currentPassword), "a wrong current password is refused");
  await request(
    "/api/profile",
    { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ action: "details", fullName: "X", email: "x@example.test" }) },
    403,
  );
  ok(true, "a cross-origin profile write is refused with 403");

  // 16. A write from another origin is refused, not silently accepted.
  const crossSite = await request(
    "/api/commands",
    { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ type: "record_sign_in" }) },
    403,
  );
  ok(crossSite.body?.ok === false, "a cross-origin write is refused with 403");

  console.log(`\n✓ Workflow C passed over HTTP (${checks} checks).`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
