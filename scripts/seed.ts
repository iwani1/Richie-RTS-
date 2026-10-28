/* eslint-disable @typescript-eslint/no-explicit-any -- the seed builds command envelopes from a
   data table. Every envelope is checked by the same `executeCommand` the app uses, which is the
   point of the script: validation happens on the real path, not in a second copy of it here. */
// Demonstration data for a presentation.
//
// Every record below is written through the ordinary command layer — `runCommand` → `loadDatabase`
// → `executeCommand` → `saveDatabase` — so references are allocated, cross-checks run, the audit
// log is written and the database's own constraints are enforced. Nothing is INSERTed straight into
// a table: a seed that bypasses the command layer can create records the app itself would refuse.
//
// The content is Ghanaian and fictional. Companies, people, phone numbers and TINs are invented for
// the demonstration; none of them describe a real business or a real person.
//
// Run:  npm run db:seed
// Undo: npm run db:reset (drops the data), then npm run db:migrate for an empty system again.
export {};

import { loadEnvFile } from "./env-loader";

loadEnvFile();

const { runCommand } = await import("../src/server/commands");
const { hashPassword } = await import("../src/server/password");
const { db: connection } = await import("../src/server/db");
const { loadDatabase } = await import("../src/server/repository");
type Database = Awaited<ReturnType<typeof loadDatabase>>;
type AnyCommand = Parameters<typeof runCommand>[0];

// ---------- dates ----------
// Ghana runs on GMT with no daylight saving, so the UTC calendar day is the business day.
const NOW = new Date();
function day(offset: number): string {
  const date = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
function at(offset: number, time = "08:00"): string {
  return `${day(offset)}T${time}:00.000Z`;
}

// ---------- the write path ----------
let state: Database;
let actorId: string;
let steps = 0;
const counts = new Map<string, number>();

async function run(command: AnyCommand, when?: string): Promise<Database> {
  const result = await runCommand(command, { userId: actorId, now: when });
  if (!result.ok) {
    throw new Error(`${command.type} failed (${result.status}): ${result.message} ${JSON.stringify(result.errors ?? {})}`);
  }
  state = result.database as Database;
  steps += 1;
  counts.set(command.type, (counts.get(command.type) ?? 0) + 1);
  return state;
}

async function runAs(userId: string, command: AnyCommand, when?: string): Promise<Database> {
  const result = await runCommand(command, { userId, now: when });
  if (!result.ok) {
    throw new Error(`${command.type} (as ${userId}) failed (${result.status}): ${result.message} ${JSON.stringify(result.errors ?? {})}`);
  }
  state = result.database as Database;
  steps += 1;
  counts.set(command.type, (counts.get(command.type) ?? 0) + 1);
  return state;
}

const byId = <T extends { id: string }>(rows: T[], id: string): T => {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`No record with id ${id}.`);
  return row;
};

// ---------- refuse to run over real records ----------
state = await loadDatabase(connection());
const occupied =
  state.vehicles.length + state.drivers.length + state.clients.length + state.rentals.length + state.trips.length + state.invoices.length;
if (occupied > 0) {
  console.error("\nThis database already holds records, so the demonstration data was not added.");
  console.error(`Found ${state.vehicles.length} vehicles, ${state.drivers.length} drivers, ${state.clients.length} clients, ` +
    `${state.trips.length} trips, ${state.rentals.length} rentals and ${state.invoices.length} invoices.`);
  console.error("\nTake a backup first (npm run db:backup), then either restore it afterwards or start from an empty");
  console.error("database: npm run db:reset && npm run db:migrate && npm run db:seed\n");
  process.exit(1);
}

// ---------- the account the data is written as ----------
const DEMO_PASSWORD = "Demo-Ghana-2026";
const credential = await hashPassword(DEMO_PASSWORD);
const existingAdmin = state.users.find((user) => user.role === "administrator");
const adminWasCreated = !existingAdmin;
if (existingAdmin) {
  actorId = existingAdmin.id;
  console.log(`Using the existing administrator ${existingAdmin.fullName} <${existingAdmin.email}> as the author of these records.`);
} else {
  // First-run setup is the one command that has no signed-in actor: it mints the first one.
  const setup = await runCommand(
    { type: "setup_administrator", input: { fullName: "Ama Serwaa Boateng", email: "ama.boateng@adinkratransit.com.gh" }, credential },
    { userId: null },
  );
  if (!setup.ok) throw new Error(`setup_administrator failed: ${setup.message}`);
  actorId = setup.database.users[0].id;
  state = setup.database as Database;
  console.log("Created the first administrator: ama.boateng@adinkratransit.com.gh");
}

// ============================================================
// 1. Settings — every business fact the company must supply.
// ============================================================
await run({
  type: "update_settings",
  input: {
    companyName: "Adinkra Transit Services Ltd",
    currencyCode: "GHS",
    onTimeThresholdMinutes: 10,
    vehicleCategories: [
      { id: "cat_exec", name: "Executive sedan", licenceClasses: ["C", "D"] },
      { id: "cat_bus", name: "Staff bus", licenceClasses: ["D"] },
      { id: "cat_mini", name: "Minibus", licenceClasses: ["C", "D"] },
      { id: "cat_pickup", name: "Pickup and utility", licenceClasses: ["C", "E"] },
    ],
    shifts: [
      { id: "shift_morning", name: "Morning shift", startTime: "05:30", endTime: "09:30" },
      { id: "shift_day", name: "Day shift", startTime: "08:00", endTime: "17:00" },
      { id: "shift_afternoon", name: "Afternoon shift", startTime: "13:00", endTime: "21:00" },
      { id: "shift_night", name: "Night shift", startTime: "21:00", endTime: "05:00" },
    ],
    rental: {
      pricingBasis: "per_day",
      depositPercent: 30,
      quotationValidityHours: 72,
      driversAlwaysIncluded: false,
      paymentMethods: ["Cash", "MTN MoMo", "Telecel Cash", "Bank transfer", "Cheque", "Card", "Fuel card"],
      requotePolicy: "revise_in_place",
      quotationTerms:
        "Prices are quoted in Ghana cedis and include the vehicle, fuel and a professional driver where one is requested. " +
        "The deposit confirms the booking and is deducted from the final invoice. Cancellations more than 48 hours before " +
        "pick-up are refunded in full less any bank charges; later cancellations keep the deposit. Waiting time beyond " +
        "30 minutes and trips outside Greater Accra are charged separately at the office's published rates. " +
        "Prices exclude VAT, NHIL and GETFund levy, which are shown on the invoice where applicable.",
      quotationApprovalAbove: 5000,
      extraChargeApprovalAbove: 1500,
    },
    documentTypes: [
      { id: "doc_roadworthy", name: "DVLA roadworthy certificate", appliesTo: "vehicle", required: true },
      { id: "doc_insurance", name: "Third-party insurance", appliesTo: "vehicle", required: true },
      { id: "doc_licence", name: "DVLA driving licence", appliesTo: "driver", required: true },
      { id: "doc_medical", name: "Medical fitness certificate", appliesTo: "driver", required: false },
      { id: "doc_ghanacard", name: "Ghana Card", appliesTo: "driver", required: false },
      { id: "doc_fire", name: "Fire extinguisher inspection", appliesTo: "vehicle", required: false },
    ],
    taxPosition: "registered",
    taxLines: [
      { id: "tax_vat", name: "VAT", ratePercent: 15 },
      { id: "tax_nhil", name: "NHIL", ratePercent: 2.5 },
      { id: "tax_getfund", name: "GETFund levy", ratePercent: 2.5 },
    ],
    invoiceDueDays: 30,
    fleetStandingCostPerDay: 145,
    documentReminderLeadDays: 30,
    workTypes: ["Service", "Repair", "Tyres", "Bodywork", "Inspection", "Air conditioning"],
    costCategories: ["Fuel", "Maintenance", "Tyres", "Tolls", "Permits and licensing", "Insurance", "Wages and allowances", "Car wash"],
    maintenance: {
      schedules: [
        { categoryId: "cat_exec", intervalKm: 10000, intervalDays: 180, remindLeadKm: 1000, remindLeadDays: 21 },
        { categoryId: "cat_bus", intervalKm: 15000, intervalDays: 120, remindLeadKm: 1500, remindLeadDays: 21 },
        { categoryId: "cat_mini", intervalKm: 10000, intervalDays: 120, remindLeadKm: 1000, remindLeadDays: 21 },
        { categoryId: "cat_pickup", intervalKm: 10000, intervalDays: 180, remindLeadKm: 1000, remindLeadDays: 21 },
      ],
      blockOnOverdueService: false,
    },
    booking: { requestCutoffMinutes: 120, cancellationCutoffMinutes: 60 },
  },
}, at(0, "06:30"));

// ============================================================
// 2. Staff accounts.
// ============================================================
const staff = [
  { fullName: "Nana Yaw Ofori", email: "nana.ofori@adinkratransit.com.gh", role: "operations" as const },
  { fullName: "Gifty Amoako", email: "gifty.amoako@adinkratransit.com.gh", role: "finance" as const },
];
for (const person of staff) {
  await run({ type: "create_user", input: { fullName: person.fullName, email: person.email, role: person.role, active: true }, credential });
}
const opsUserId = state.users.find((user) => user.email === "nana.ofori@adinkratransit.com.gh")!.id;
const financeUserId = state.users.find((user) => user.email === "gifty.amoako@adinkratransit.com.gh")!.id;

// ============================================================
// 3. Clients — the companies that buy the work, and a walk-in customer.
// ============================================================
const clientInputs = [
  {
    name: "Volta Star Mining Ltd",
    type: "organisation" as const,
    registrationNumber: "CS-4821309",
    registeredOn: "2011-04-18",
    contactName: "Ama Nyarko",
    contactPhone: "+233 24 555 0142",
    contactEmail: "ama.nyarko@voltastarmining.com.gh",
    billingAddress: "Plot 14, Tarkwa Main Road, Tarkwa, Western Region",
    tin: "C0012345678",
    notes: "Two shifts a day from Tarkwa township to the mine site. Invoice to the Tarkwa office.",
    status: "active" as const,
  },
  {
    name: "Accra Financial Centre Ltd",
    type: "organisation" as const,
    registrationNumber: "CS-7712044",
    registeredOn: "2015-09-02",
    contactName: "Nii Armah Tackie",
    contactPhone: "+233 30 274 9080",
    contactEmail: "facilities@accrafinancialcentre.com.gh",
    billingAddress: "8th Floor, Ridge Tower, Accra, Greater Accra",
    tin: "C0055512349",
    notes: "Executive car hire for visiting directors, plus the morning staff shuttle from Achimota.",
    status: "active" as const,
  },
  {
    name: "Tema Port Logistics Ltd",
    type: "organisation" as const,
    registrationNumber: "CS-3390021",
    registeredOn: "2017-01-27",
    contactName: "Efua Mensimah",
    contactPhone: "+233 20 880 3376",
    contactEmail: "efua.mensimah@temaportlogistics.com.gh",
    billingAddress: "Community 1, Tema, Greater Accra",
    tin: "C0099887766",
    notes: "Shift change runs to Gate 3 and the Free Zones enclave.",
    status: "active" as const,
  },
  {
    name: "Asante Health Partners Ltd",
    type: "organisation" as const,
    registrationNumber: "CS-5510992",
    registeredOn: "2013-11-11",
    contactName: "Dr. Kwabena Osei-Bonsu",
    contactPhone: "+233 32 202 7741",
    contactEmail: "admin@asantehealthpartners.com.gh",
    billingAddress: "Adum, Kumasi, Ashanti Region",
    tin: "C0044332211",
    notes: "Clinic run between Adum and Komfo Anokye is suspended while the contract is reviewed.",
    status: "active" as const,
  },
  {
    name: "Oguaa Education Trust",
    type: "organisation" as const,
    registrationNumber: "CS-6623410",
    registeredOn: "2019-06-14",
    contactName: "Comfort Aidoo",
    contactPhone: "+233 55 610 2298",
    contactEmail: "comfort.aidoo@oguaaeducation.org.gh",
    billingAddress: "Pedu Junction, Cape Coast, Central Region",
    tin: "C0077665544",
    notes: "Frequent weekend hires for school trips along the coast.",
    status: "active" as const,
  },
  {
    name: "Yaa Serwaa Addo",
    type: "individual" as const,
    contactName: "Yaa Serwaa Addo",
    contactPhone: "024 771 3390",
    contactEmail: "yaa.addo84@gmail.com",
    billingAddress: "East Legon, Accra, Greater Accra",
    tin: "",
    notes: "Walk-in customer; hires a saloon for family trips to Kumasi.",
    status: "active" as const,
  },
];
for (const input of clientInputs) {
  await run({ type: "create_client", input }, at(-40, "09:10"));
}

const client = (name: string) => {
  const row = state.clients.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`Client ${name} was not created.`);
  return row;
};
const volta = client("Volta Star Mining Ltd");
const afc = client("Accra Financial Centre Ltd");
const tema = client("Tema Port Logistics Ltd");
const asante = client("Asante Health Partners Ltd");
const oguaa = client("Oguaa Education Trust");
const walkIn = client("Yaa Serwaa Addo");

// Branches: the depot the staff are picked up from is not always the address that receives the bill.
const locations: [string, string, string, string, string][] = [
  [volta.id, "Tarkwa mine site office", "Volta Star mine site, Huni Valley, Western Region", "024 555 0142", "Isaac Bawa"],
  [volta.id, "Tarkwa township depot", "Community 4, Tarkwa, Western Region", "024 555 0188", "Salamatu Fuseini"],
  [afc.id, "Ridge head office", "Ridge Tower, Accra, Greater Accra", "030 274 9080", "Nii Armah Tackie"],
  [tema.id, "Tema Community 1 depot", "Community 1, Tema, Greater Accra", "020 880 3376", "Efua Mensimah"],
  [oguaa.id, "Pedu Junction campus", "Pedu Junction, Cape Coast, Central Region", "055 610 2298", "Comfort Aidoo"],
];
for (const [clientId, name, address, phone, contactName] of locations) {
  await run({ type: "create_client_location", input: { clientId, name, address, phone, contactName, status: "active" } }, at(-40, "09:20"));
}

// ============================================================
// 4. Drivers.
// ============================================================
const driverInputs = [
  { fullName: "Kwame Asare", phone: "+233 24 330 1188", licenceNumber: "DL-GT-482109", licenceExpiry: day(430), licenceClasses: "C, D", qualifications: "Defensive driving (DVLA), first aid", status: "active" as const },
  { fullName: "Yaw Boakye", phone: "024 615 7734", licenceNumber: "DL-GT-501274", licenceExpiry: day(268), licenceClasses: "D", qualifications: "Passenger service vehicle (PSV)", status: "active" as const },
  { fullName: "Kofi Danso", phone: "+233 20 447 9061", licenceNumber: "DL-AS-330812", licenceExpiry: day(19), licenceClasses: "C, D", qualifications: "Defensive driving (DVLA)", status: "active" as const },
  { fullName: "Abena Sarpong", phone: "055 318 4402", licenceNumber: "DL-GT-476620", licenceExpiry: day(512), licenceClasses: "C, D", qualifications: "Defensive driving (DVLA), customer care", status: "active" as const },
  { fullName: "Musah Abdulai", phone: "+233 27 902 1180", licenceNumber: "DL-WR-219477", licenceExpiry: day(96), licenceClasses: "D", qualifications: "PSV, first aid", status: "active" as const },
  { fullName: "Selorm Agbeko", phone: "024 118 6625", licenceNumber: "DL-GT-511903", licenceExpiry: day(340), licenceClasses: "C, E", qualifications: "Heavy goods vehicle", status: "active" as const },
  { fullName: "Esi Quansah", phone: "+233 54 771 0092", licenceNumber: "DL-GT-498731", licenceExpiry: day(203), licenceClasses: "C, D", qualifications: "Defensive driving (DVLA)", status: "active" as const },
  { fullName: "Ibrahim Fuseini", phone: "020 664 2210", licenceNumber: "DL-NR-180442", licenceExpiry: day(-12), licenceClasses: "D", qualifications: "PSV", status: "suspended" as const },
];
for (const input of driverInputs) {
  await run({ type: "create_driver", input }, at(-39, "10:00"));
}
const driver = (name: string) => {
  const row = state.drivers.find((candidate) => candidate.fullName === name);
  if (!row) throw new Error(`Driver ${name} was not created.`);
  return row;
};
const kwame = driver("Kwame Asare");
const yaw = driver("Yaw Boakye");
const kofi = driver("Kofi Danso");
const abena = driver("Abena Sarpong");
const musah = driver("Musah Abdulai");
const selorm = driver("Selorm Agbeko");
const esi = driver("Esi Quansah");

// ============================================================
// 5. The fleet.
// ============================================================
const vehicleInputs = [
  { registration: "GT 4521-24", categoryId: "cat_exec", make: "Toyota", model: "Camry", seatCapacity: "4", fuelType: "Petrol", ownership: "owned", usualDriverId: kwame.id, notes: "Director car. Kept at the Ridge yard." },
  { registration: "GT 8834-23", categoryId: "cat_bus", make: "Toyota", model: "Coaster", seatCapacity: "33", fuelType: "Diesel", ownership: "owned", usualDriverId: yaw.id, notes: "Main mine shuttle bus." },
  { registration: "GE 1207-25", categoryId: "cat_mini", make: "Toyota", model: "Hiace", seatCapacity: "15", fuelType: "Diesel", ownership: "owned", usualDriverId: kofi.id, notes: "Ridge staff shuttle." },
  { registration: "AS 3391-22", categoryId: "cat_bus", make: "Mercedes-Benz", model: "Sprinter", seatCapacity: "22", fuelType: "Diesel", ownership: "owned", usualDriverId: musah.id, notes: "Kumasi and Cape Coast runs." },
  { registration: "GT 7745-21", categoryId: "cat_pickup", make: "Toyota", model: "Hilux", seatCapacity: "5", fuelType: "Diesel", ownership: "owned", notes: "Yard runabout and recovery vehicle." },
  { registration: "WR 2210-24", categoryId: "cat_mini", make: "Nissan", model: "Urvan", seatCapacity: "15", fuelType: "Diesel", ownership: "leased", ownerName: "Tarkwa Fleet Leasing Ltd", usualDriverId: esi.id, notes: "Leased for the Tema port contract." },
  { registration: "GT 6098-25", categoryId: "cat_exec", make: "Hyundai", model: "Staria", seatCapacity: "7", fuelType: "Diesel", ownership: "owned", usualDriverId: abena.id, notes: "Executive van for airport transfers." },
  { registration: "GT 5512-20", categoryId: "cat_bus", make: "Kia", model: "Grandbird", seatCapacity: "45", fuelType: "Diesel", ownership: "owned", notes: "Large bus; off the road for gearbox repair." },
];
for (const input of vehicleInputs) {
  await run({ type: "create_vehicle", input }, at(-38, "11:00"));
}
const vehicle = (registration: string) => {
  const row = state.vehicles.find((candidate) => candidate.registration === registration);
  if (!row) throw new Error(`Vehicle ${registration} was not created.`);
  return row;
};
const camry = vehicle("GT 4521-24");
const coaster = vehicle("GT 8834-23");
const hiace = vehicle("GE 1207-25");
const sprinter = vehicle("AS 3391-22");
const hilux = vehicle("GT 7745-21");
const urvan = vehicle("WR 2210-24");
const staria = vehicle("GT 6098-25");
const grandbird = vehicle("GT 5512-20");

// ============================================================
// 6. Compliance papers — current, one expiring soon and one already expired.
// ============================================================
const papers: { ownerType: "vehicle" | "driver"; ownerId: string; documentTypeId: string; documentNumber: string; issuedDate: string; expiryDate: string; notes: string }[] = [
  { ownerType: "vehicle", ownerId: camry.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-GT-24-118402", issuedDate: day(-160), expiryDate: day(205), notes: "DVLA Accra." },
  { ownerType: "vehicle", ownerId: camry.id, documentTypeId: "doc_insurance", documentNumber: "SIC/CM/2026/77410", issuedDate: day(-220), expiryDate: day(145), notes: "SIC comprehensive cover." },
  { ownerType: "vehicle", ownerId: coaster.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-GT-23-990117", issuedDate: day(-300), expiryDate: day(65), notes: "" },
  { ownerType: "vehicle", ownerId: coaster.id, documentTypeId: "doc_insurance", documentNumber: "VANGUARD/BUS/2026/1204", issuedDate: day(-300), expiryDate: day(65), notes: "" },
  { ownerType: "vehicle", ownerId: hiace.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-GE-25-204418", issuedDate: day(-201), expiryDate: day(12), notes: "Renewal booked at DVLA Tema." },
  { ownerType: "vehicle", ownerId: hiace.id, documentTypeId: "doc_insurance", documentNumber: "STAR/CM/2026/33119", issuedDate: day(-201), expiryDate: day(164), notes: "" },
  { ownerType: "vehicle", ownerId: sprinter.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-AS-22-556201", issuedDate: day(-100), expiryDate: day(265), notes: "" },
  { ownerType: "vehicle", ownerId: sprinter.id, documentTypeId: "doc_insurance", documentNumber: "ENTERPRISE/CM/2026/88120", issuedDate: day(-100), expiryDate: day(265), notes: "" },
  { ownerType: "vehicle", ownerId: urvan.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-WR-24-771902", issuedDate: day(-250), expiryDate: day(115), notes: "" },
  { ownerType: "vehicle", ownerId: urvan.id, documentTypeId: "doc_insurance", documentNumber: "VANGUARD/CM/2026/44190", issuedDate: day(-250), expiryDate: day(115), notes: "" },
  { ownerType: "vehicle", ownerId: staria.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-GT-25-338127", issuedDate: day(-90), expiryDate: day(275), notes: "" },
  { ownerType: "vehicle", ownerId: staria.id, documentTypeId: "doc_insurance", documentNumber: "SIC/CM/2026/90211", issuedDate: day(-90), expiryDate: day(275), notes: "" },
  // The bus in the workshop: its roadworthy ran out while it was off the road. That is exactly the
  // condition the readiness screen exists to show, and it is not hidden here.
  { ownerType: "vehicle", ownerId: grandbird.id, documentTypeId: "doc_roadworthy", documentNumber: "RW-GT-20-112907", issuedDate: day(-400), expiryDate: day(-14), notes: "Expired while the bus was in the workshop." },
  { ownerType: "vehicle", ownerId: grandbird.id, documentTypeId: "doc_insurance", documentNumber: "ENTERPRISE/CM/2026/12908", issuedDate: day(-400), expiryDate: day(-14), notes: "" },
  { ownerType: "driver", ownerId: kwame.id, documentTypeId: "doc_licence", documentNumber: kwame.licenceNumber, issuedDate: day(-900), expiryDate: day(430), notes: "" },
  { ownerType: "driver", ownerId: yaw.id, documentTypeId: "doc_licence", documentNumber: yaw.licenceNumber, issuedDate: day(-800), expiryDate: day(268), notes: "" },
  { ownerType: "driver", ownerId: kofi.id, documentTypeId: "doc_licence", documentNumber: kofi.licenceNumber, issuedDate: day(-1000), expiryDate: day(19), notes: "Renewal appointment at DVLA on the 12th." },
  { ownerType: "driver", ownerId: abena.id, documentTypeId: "doc_licence", documentNumber: abena.licenceNumber, issuedDate: day(-600), expiryDate: day(512), notes: "" },
  { ownerType: "driver", ownerId: musah.id, documentTypeId: "doc_licence", documentNumber: musah.licenceNumber, issuedDate: day(-900), expiryDate: day(96), notes: "" },
  { ownerType: "driver", ownerId: esi.id, documentTypeId: "doc_licence", documentNumber: esi.licenceNumber, issuedDate: day(-700), expiryDate: day(203), notes: "" },
  { ownerType: "driver", ownerId: selorm.id, documentTypeId: "doc_licence", documentNumber: selorm.licenceNumber, issuedDate: day(-500), expiryDate: day(340), notes: "" },
  { ownerType: "driver", ownerId: kwame.id, documentTypeId: "doc_medical", documentNumber: "MED-ACC-2026-5512", issuedDate: day(-140), expiryDate: day(225), notes: "Ridge Medical Centre." },
  { ownerType: "driver", ownerId: yaw.id, documentTypeId: "doc_ghanacard", documentNumber: "GHA-721048773-4", issuedDate: day(-1200), expiryDate: day(1400), notes: "" },
];
for (const input of papers) {
  await run({ type: "create_document", input: { ...input, notes: input.notes } }, at(-37, "09:00"));
}

// ============================================================
// 7. Routes.
// ============================================================
await run({
  type: "create_route",
  input: {
    name: "Tarkwa township to Volta Star mine site",
    clientId: volta.id,
    direction: "to_work",
    shiftId: "shift_morning",
    vehicleCategoryId: "cat_bus",
    weekdays: [1, 2, 3, 4, 5, 6],
    startDate: day(-60),
    endDate: "",
    stops: [
      { name: "Tarkwa Community 4", scheduledTime: "05:40" },
      { name: "Tamso Junction", scheduledTime: "06:00" },
      { name: "Huni Valley Gate", scheduledTime: "06:25" },
      { name: "Volta Star mine site", scheduledTime: "06:50" },
    ],
    status: "active",
  },
}, at(-36, "10:00"));
await run({
  type: "create_route",
  input: {
    name: "Volta Star mine site to Tarkwa township",
    clientId: volta.id,
    direction: "to_home",
    shiftId: "shift_afternoon",
    vehicleCategoryId: "cat_bus",
    weekdays: [1, 2, 3, 4, 5, 6],
    startDate: day(-60),
    endDate: "",
    stops: [
      { name: "Volta Star mine site", scheduledTime: "16:10" },
      { name: "Huni Valley Gate", scheduledTime: "16:35" },
      { name: "Tamso Junction", scheduledTime: "17:00" },
      { name: "Tarkwa Community 4", scheduledTime: "17:20" },
    ],
    status: "active",
  },
}, at(-36, "10:05"));
await run({
  type: "create_route",
  input: {
    name: "Achimota to Ridge staff shuttle",
    clientId: afc.id,
    direction: "to_work",
    shiftId: "shift_day",
    vehicleCategoryId: "cat_mini",
    weekdays: [1, 2, 3, 4, 5],
    startDate: day(-45),
    endDate: "",
    stops: [
      { name: "Achimota Retail Centre", scheduledTime: "06:10" },
      { name: "Lapaz", scheduledTime: "06:30" },
      { name: "Kwame Nkrumah Circle", scheduledTime: "06:50" },
      { name: "Ridge Tower", scheduledTime: "07:15" },
    ],
    status: "active",
  },
}, at(-36, "10:10"));
await run({
  type: "create_route",
  input: {
    name: "Tema Community 11 to the port",
    clientId: tema.id,
    direction: "to_work",
    shiftId: "shift_afternoon",
    vehicleCategoryId: "cat_mini",
    weekdays: [1, 2, 3, 4, 5],
    startDate: day(-30),
    endDate: "",
    stops: [
      { name: "Tema Community 11", scheduledTime: "13:30" },
      { name: "Tema Community 1 Market", scheduledTime: "13:50" },
      { name: "Tema Free Zones", scheduledTime: "14:10" },
      { name: "Tema Port Gate 3", scheduledTime: "14:30" },
    ],
    status: "active",
  },
}, at(-36, "10:15"));
await run({
  type: "create_route",
  input: {
    name: "Adum to Komfo Anokye clinic run",
    clientId: asante.id,
    direction: "to_work",
    shiftId: "shift_day",
    vehicleCategoryId: "cat_mini",
    weekdays: [1, 3, 5],
    startDate: day(-90),
    endDate: "",
    stops: [
      { name: "Adum", scheduledTime: "07:00" },
      { name: "Kejetia", scheduledTime: "07:15" },
      { name: "Komfo Anokye", scheduledTime: "07:35" },
    ],
    status: "suspended",
  },
}, at(-36, "10:20"));

const route = (name: string) => {
  const row = state.routes.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`Route ${name} was not created.`);
  return row;
};
const rMine = route("Tarkwa township to Volta Star mine site");
const rMineHome = route("Volta Star mine site to Tarkwa township");
const rRidge = route("Achimota to Ridge staff shuttle");
const rPort = route("Tema Community 11 to the port");
const rClinic = route("Adum to Komfo Anokye clinic run");

// ============================================================
// 8. Contracts — one per client that runs a shuttle.
// ============================================================
const contracts: { clientId: string; serviceType: "staff_transport"; routeIds: string[]; shiftIds: string[]; weekdays: number[]; vehicleCategoryId: string; pricingModel: string; billingFrequency: string; paymentTerms: string; serviceLevelTargets: string; notes: string }[] = [
  {
    clientId: volta.id,
    serviceType: "staff_transport",
    routeIds: [rMine.id, rMineHome.id],
    shiftIds: ["shift_morning", "shift_afternoon"],
    weekdays: [1, 2, 3, 4, 5, 6],
    vehicleCategoryId: "cat_bus",
    pricingModel: "Fixed monthly rate per bus, GHS 42,000 for the two runs",
    billingFrequency: "Monthly in arrears",
    paymentTerms: "30 days from invoice",
    serviceLevelTargets: "Departure within 5 minutes of schedule; 98% of runs completed",
    notes: "Signed at the Tarkwa office. Renews annually on 1 January.",
  },
  {
    clientId: afc.id,
    serviceType: "staff_transport",
    routeIds: [rRidge.id],
    shiftIds: ["shift_day"],
    weekdays: [1, 2, 3, 4, 5],
    vehicleCategoryId: "cat_mini",
    pricingModel: "Per trip, GHS 480 per run",
    billingFrequency: "Monthly in arrears",
    paymentTerms: "14 days from invoice",
    serviceLevelTargets: "Departure within 5 minutes of schedule",
    notes: "Billing goes to the facilities manager at Ridge Tower.",
  },
  {
    clientId: tema.id,
    serviceType: "staff_transport",
    routeIds: [rPort.id],
    shiftIds: ["shift_afternoon"],
    weekdays: [1, 2, 3, 4, 5],
    vehicleCategoryId: "cat_mini",
    pricingModel: "Per trip, GHS 520 per run",
    billingFrequency: "Fortnightly",
    paymentTerms: "7 days from invoice",
    serviceLevelTargets: "Arrive at Gate 3 before the 14:30 shift change",
    notes: "Gate access passes held at the depot.",
  },
  {
    clientId: asante.id,
    serviceType: "staff_transport",
    routeIds: [rClinic.id],
    shiftIds: ["shift_day"],
    weekdays: [1, 3, 5],
    vehicleCategoryId: "cat_mini",
    pricingModel: "Per trip, GHS 390 per run",
    billingFrequency: "Monthly in arrears",
    paymentTerms: "30 days from invoice",
    serviceLevelTargets: "Departure within 5 minutes of schedule",
    notes: "Contract under review: the clinic run is suspended until the new terms are agreed.",
  },
];
for (const contract of contracts) {
  await run({
    type: "create_contract",
    input: { ...contract, startDate: day(-30), endDate: day(120) },
  }, at(-30, "12:00"));
  // A contract signed on paper still has to be approved in the system before it covers work:
  // draft → pending approval → active, the same two steps the office takes.
  const created = state.contracts.find((candidate) => candidate.clientId === contract.clientId && candidate.status === "draft")!;
  if (contract.clientId === asante.id) {
    await run({ type: "advance_contract", id: created.id, to: "pending_approval", reason: "Signed by the client; sent for approval." }, at(-30, "12:05"));
    await run({ type: "advance_contract", id: created.id, to: "active", reason: "Approved by the operations manager." }, at(-30, "12:10"));
    await run({ type: "advance_contract", id: created.id, to: "suspended", reason: "Client is renegotiating the rate for the clinic run." }, at(-20, "12:00"));
  } else {
    await run({ type: "advance_contract", id: created.id, to: "pending_approval", reason: "Signed by the client; sent for approval." }, at(-30, "12:05"));
    await run({ type: "advance_contract", id: created.id, to: "active", reason: "Approved by the operations manager." }, at(-30, "12:10"));
  }
}

// ============================================================
// 9. The riders.
// ============================================================
// A rider on a route's roster already has a seat on every run of that route (BKG-01): the roster is
// the seat. Booking is for the staff who are not on a roster — the person who needs a lift once.
const riders: { fullName: string; employeeRef: string; phone: string; clientId: string; routeId: string; stopName: string; status: "active" | "inactive" }[] = [
  { fullName: "Akosua Mensah", employeeRef: "VSM-0142", phone: "+233 24 418 7720", clientId: volta.id, routeId: rMine.id, stopName: "Tamso Junction", status: "active" },
  { fullName: "Kwabena Nkrumah", employeeRef: "VSM-0177", phone: "020 664 2318", clientId: volta.id, routeId: rMine.id, stopName: "Tarkwa Community 4", status: "active" },
  { fullName: "Abena Owusu", employeeRef: "VSM-0203", phone: "055 701 4490", clientId: volta.id, routeId: rMine.id, stopName: "Huni Valley Gate", status: "active" },
  { fullName: "Yaw Antwi", employeeRef: "VSM-0221", phone: "027 330 5512", clientId: volta.id, routeId: rMine.id, stopName: "Tamso Junction", status: "active" },
  { fullName: "Salamatu Fuseini", employeeRef: "VSM-0250", phone: "+233 24 555 0188", clientId: volta.id, routeId: rMineHome.id, stopName: "Volta Star mine site", status: "active" },
  { fullName: "Isaac Bawa", employeeRef: "VSM-0264", phone: "024 555 0142", clientId: volta.id, routeId: rMineHome.id, stopName: "Volta Star mine site", status: "active" },
  { fullName: "Naa Adjei", employeeRef: "AFC-3301", phone: "+233 24 990 4471", clientId: afc.id, routeId: rRidge.id, stopName: "Achimota Retail Centre", status: "active" },
  { fullName: "Ekow Yankey", employeeRef: "AFC-3355", phone: "020 771 2204", clientId: afc.id, routeId: rRidge.id, stopName: "Lapaz", status: "active" },
  { fullName: "Gifty Amponsah", employeeRef: "AFC-3402", phone: "055 448 9910", clientId: afc.id, routeId: rRidge.id, stopName: "Kwame Nkrumah Circle", status: "active" },
  { fullName: "Kojo Boadu", employeeRef: "AFC-3419", phone: "027 118 3376", clientId: afc.id, routeId: rRidge.id, stopName: "Achimota Retail Centre", status: "active" },
  { fullName: "Kofi Agbeko", employeeRef: "TPL-0440", phone: "+233 20 337 9012", clientId: tema.id, routeId: rPort.id, stopName: "Tema Community 11", status: "active" },
  { fullName: "Adjoa Serwaa", employeeRef: "TPL-0451", phone: "024 559 1180", clientId: tema.id, routeId: rPort.id, stopName: "Tema Community 1 Market", status: "active" },
  { fullName: "Ibrahim Tetteh", employeeRef: "TPL-0462", phone: "055 220 7745", clientId: tema.id, routeId: rPort.id, stopName: "Tema Free Zones", status: "active" },
  { fullName: "Comfort Adusei", employeeRef: "AHP-1120", phone: "020 118 4420", clientId: asante.id, routeId: rClinic.id, stopName: "Adum", status: "active" },
  { fullName: "Michael Osei", employeeRef: "AHP-1145", phone: "024 990 3371", clientId: asante.id, routeId: rClinic.id, stopName: "Kejetia", status: "active" },
  // Not on a roster: these three book a seat when they need one.
  { fullName: "Kwesi Ofori", employeeRef: "AFC-3520", phone: "020 447 1180", clientId: afc.id, routeId: "", stopName: "", status: "active" },
  { fullName: "Efua Darko", employeeRef: "VSM-0288", phone: "024 660 4471", clientId: volta.id, routeId: "", stopName: "", status: "active" },
  { fullName: "Nii Lante Lamptey", employeeRef: "TPL-0481", phone: "055 902 3312", clientId: tema.id, routeId: "", stopName: "", status: "active" },
];
for (const rider of riders) {
  const routeRow = rider.routeId ? byId(state.routes, rider.routeId) : null;
  const stop = routeRow ? routeRow.stops.find((candidate) => candidate.name === rider.stopName) : null;
  if (routeRow && !stop) throw new Error(`Stop ${rider.stopName} is not on ${routeRow.name}.`);
  await run({
    type: "create_passenger",
    input: {
      fullName: rider.fullName,
      employeeRef: rider.employeeRef,
      phone: rider.phone,
      clientId: rider.clientId,
      routeId: rider.routeId,
      stopId: stop ? stop.id : "",
      status: rider.status,
    },
  }, at(-30, "13:00"));
}
const riderByName = (name: string) => {
  const row = state.passengers.find((candidate) => candidate.fullName === name);
  if (!row) throw new Error(`Rider ${name} was not created.`);
  return row;
};

// ============================================================
// 10. Trips: a fortnight of history and a week ahead.
// ============================================================
for (const active of [rMine, rMineHome, rRidge, rPort]) {
  await run({ type: "generate_trips", routeId: active.id, fromDate: day(-14), toDate: day(10) }, at(-14, "05:00"));
}

const tripOn = (routeId: string, date: string) => {
  const row = state.trips.find((candidate) => candidate.routeId === routeId && candidate.serviceDate === date);
  if (!row) throw new Error(`No trip for ${routeId} on ${date}.`);
  return row;
};

/**
 * The nearest service date for a route, walking forwards or backwards. A route runs on the days the
 * client agreed, so a date picked by hand can land on a Sunday with no run at all; this finds the
 * run the demonstration can talk about.
 */
const serviceDate = (routeId: string, fromOffset: number, direction: 1 | -1): string => {
  for (let i = 0; i <= 7; i += 1) {
    const date = day(fromOffset + i * direction);
    if (state.trips.some((trip) => trip.routeId === routeId && trip.serviceDate === date)) return date;
  }
  throw new Error(`No trip for ${routeId} within a week of ${day(fromOffset)}.`);
};

// A completed morning run on the mine route, with real boardings (one rider did not turn up).
// A run that has already left is completed with its full record: the progressive, stop-by-stop form
// is for a bus that is on the road right now.
const minePastDate = serviceDate(rMine.id, -6, -1);
const minePast = tripOn(rMine.id, minePastDate);
await run({ type: "assign_trip", id: minePast.id, input: { vehicleId: coaster.id, driverId: yaw.id } }, at(-6, "05:10"));
await run({ type: "dispatch_trip", id: minePast.id }, at(-6, "05:30"));
await run({
  type: "complete_trip",
  id: minePast.id,
  input: {
    stopTimes: [
      { stopId: rMine.stops[0].id, actualTime: "05:44" },
      { stopId: rMine.stops[1].id, actualTime: "06:09" },
      { stopId: rMine.stops[2].id, actualTime: "06:34" },
      { stopId: rMine.stops[3].id, actualTime: "07:02" },
    ],
    boardings: [
      { passengerId: riderByName("Akosua Mensah").id, outcome: "boarded" },
      { passengerId: riderByName("Kwabena Nkrumah").id, outcome: "boarded" },
      { passengerId: riderByName("Abena Owusu").id, outcome: "boarded" },
      { passengerId: riderByName("Yaw Antwi").id, outcome: "no_show" },
    ],
  },
}, at(-6, "07:05"));

// A completed Ridge shuttle and a completed port run, so the on-time figures are not a single day.
const ridgePastDate = serviceDate(rRidge.id, -4, -1);
const ridgePast = tripOn(rRidge.id, ridgePastDate);
await run({ type: "assign_trip", id: ridgePast.id, input: { vehicleId: hiace.id, driverId: kofi.id } }, at(-4, "05:50"));
await run({ type: "dispatch_trip", id: ridgePast.id }, at(-4, "06:05"));
await run({
  type: "complete_trip",
  id: ridgePast.id,
  input: {
    stopTimes: [
      { stopId: rRidge.stops[0].id, actualTime: "06:12" },
      { stopId: rRidge.stops[1].id, actualTime: "06:33" },
      { stopId: rRidge.stops[2].id, actualTime: "06:58" },
      { stopId: rRidge.stops[3].id, actualTime: "07:20" },
    ],
    boardings: [
      { passengerId: riderByName("Naa Adjei").id, outcome: "boarded" },
      { passengerId: riderByName("Ekow Yankey").id, outcome: "boarded" },
      { passengerId: riderByName("Gifty Amponsah").id, outcome: "boarded" },
      { passengerId: riderByName("Kojo Boadu").id, outcome: "boarded" },
    ],
  },
}, at(-4, "07:25"));

const portPastDate = serviceDate(rPort.id, -3, -1);
const portPast = tripOn(rPort.id, portPastDate);
await run({ type: "assign_trip", id: portPast.id, input: { vehicleId: urvan.id, driverId: esi.id } }, at(-3, "13:00"));
await run({ type: "dispatch_trip", id: portPast.id }, at(-3, "13:20"));
await run({
  type: "complete_trip",
  id: portPast.id,
  input: {
    stopTimes: [
      { stopId: rPort.stops[0].id, actualTime: "13:38" },
      { stopId: rPort.stops[1].id, actualTime: "14:01" },
      { stopId: rPort.stops[2].id, actualTime: "14:19" },
      { stopId: rPort.stops[3].id, actualTime: "14:41" },
    ],
    boardings: [
      { passengerId: riderByName("Kofi Agbeko").id, outcome: "boarded" },
      { passengerId: riderByName("Adjoa Serwaa").id, outcome: "boarded" },
      { passengerId: riderByName("Ibrahim Tetteh").id, outcome: "no_show" },
    ],
  },
}, at(-3, "14:45"));

// Today only gets a run on the road when the route actually operates today.
const mineToday = state.trips.find((trip) => trip.routeId === rMine.id && trip.serviceDate === day(0));
if (mineToday) {
  await run({ type: "assign_trip", id: mineToday.id, input: { vehicleId: coaster.id, driverId: yaw.id } }, at(0, "04:50"));
  await run({ type: "dispatch_trip", id: mineToday.id }, at(0, "05:15"));
  await run({ type: "start_trip", id: mineToday.id }, at(0, "05:38"));
  await run({
    type: "record_trip_stop",
    id: mineToday.id,
    input: {
      stopId: rMine.stops[0].id,
      actualTime: "05:43",
      boardings: [{ passengerId: riderByName("Kwabena Nkrumah").id, outcome: "boarded" }],
    },
  }, at(0, "05:44"));
  await run({ type: "record_trip_delay", id: mineToday.id, input: { minutes: 9, reason: "Loader blocking the Tamso junction while timber was offloaded." } }, at(0, "06:02"));
}

// The next Ridge run is on the board with its bus and driver already allocated.
const ridgeNextDate = serviceDate(rRidge.id, 1, 1);
const ridgeNext = tripOn(rRidge.id, ridgeNextDate);
await run({ type: "assign_trip", id: ridgeNext.id, input: { vehicleId: hiace.id, driverId: kofi.id } }, at(0, "12:00"));
await run({ type: "dispatch_trip", id: ridgeNext.id }, at(0, "12:05"));

// ============================================================
// 11. Bookings: seats sold on runs that have not left yet.
// ============================================================
const bookSeat = async (name: string, routeRow: { id: string }, date: string, type: "one_time" | "recurring", note: string, when: string) => {
  const person = riderByName(name);
  await run({
    type: "create_booking",
    input: {
      passengerId: person.id,
      routeId: routeRow.id,
      serviceDate: date,
      toDate: type === "recurring" ? date : "",
      type,
      note,
    },
  }, when);
  return state.bookings.find((booking) => booking.passengerId === person.id && booking.serviceDate === date)!;
};

// Five seats sold on runs that have not left: three confirmed, two still requested. A seat can only
// be counted once a bus is on the run, so tomorrow's mine and port runs are allocated first.
const ridgeNextRun = serviceDate(rRidge.id, 1, 1);
const mineNextRun = serviceDate(rMine.id, 1, 1);
const portNextRun = serviceDate(rPort.id, 1, 1);
await run({ type: "assign_trip", id: tripOn(rMine.id, mineNextRun).id, input: { vehicleId: coaster.id, driverId: yaw.id } }, at(0, "08:40"));
await run({ type: "assign_trip", id: tripOn(rPort.id, portNextRun).id, input: { vehicleId: urvan.id, driverId: esi.id } }, at(0, "08:45"));
for (const offset of [2, 3]) {
  const later = serviceDate(rRidge.id, offset, 1);
  await run({ type: "assign_trip", id: tripOn(rRidge.id, later).id, input: { vehicleId: hiace.id, driverId: kofi.id } }, at(0, "08:50"));
}
const ridgeBookingA = await bookSeat("Kwesi Ofori", rRidge, ridgeNextRun, "one_time", "In from the Kumasi office for two days of meetings.", at(0, "09:00"));
await run({ type: "confirm_booking", id: ridgeBookingA.id }, at(0, "09:10"));
await bookSeat("Efua Darko", rMine, mineNextRun, "one_time", "Site audit at Huni Valley; travelling with the mine shuttle.", at(0, "09:20"));
const ridgeBookingC = await bookSeat("Kwesi Ofori", rRidge, serviceDate(rRidge.id, 2, 1), "one_time", "Second day at Ridge Tower.", at(0, "09:30"));
await run({ type: "confirm_booking", id: ridgeBookingC.id }, at(0, "09:40"));
const portBooking = await bookSeat("Nii Lante Lamptey", rPort, portNextRun, "one_time", "Covering the early shift at Gate 3.", at(0, "10:00"));
await run({ type: "confirm_booking", id: portBooking.id }, at(0, "10:05"));
await bookSeat("Kwesi Ofori", rRidge, serviceDate(rRidge.id, 3, 1), "one_time", "Third morning at Ridge Tower.", at(0, "10:15"));

// ============================================================
// 12. Rentals — every stage of the workflow is represented.
// ============================================================
type RentalSeed = { reference: string };
const rentals: RentalSeed[] = [];

/** The deposit the quotation itself asks for, so the figure is the system's and not a guess. */
const depositFor = (rentalId: string): string => {
  const row = state.rentals.find((candidate) => candidate.id === rentalId);
  const deposit = row?.quote?.depositRequired;
  if (deposit === undefined) throw new Error(`Rental ${rentalId} has no quotation to take a deposit against.`);
  return deposit.toFixed(2);
};

const request = async (input: any, when: string) => {
  await run({ type: "create_rental", input }, when);
  const created = state.rentals[state.rentals.length - 1];
  rentals.push({ reference: created.reference });
  return created;
};

// (a) A completed hire for Accra Financial Centre: requested, quoted, agreed, deposit taken, run,
// completed and invoiced, paid in two instalments.
const hireA = await request({
  clientId: afc.id,
  customerName: "Nii Armah Tackie",
  customerPhone: "+233 30 274 9080",
  customerEmail: "facilities@accrafinancialcentre.com.gh",
  purpose: "Airport pick-up and three days of meetings for a visiting group director.",
  pickupLocation: "Kotoka International Airport, Terminal 3",
  dropoffLocation: "Ridge Tower, Accra",
  startDate: day(-8),
  endDate: day(-5),
  passengers: "2",
  vehicleCategoryId: "cat_exec",
  driverRequired: true,
  notes: "Director travels with an assistant. Water and a phone charger in the car, please.",
}, at(-9, "09:06"));
await run({
  type: "quote_rental",
  id: hireA.id,
  input: {
    lines: [
      { description: "Executive sedan with driver, 3 days", quantity: "3", unitAmount: "950.00" },
      { description: "Airport meet-and-greet and parking", quantity: "1", unitAmount: "180.00" },
    ],
    discountAmount: "0",
    discountReason: "",
  },
}, at(-9, "11:20"));
await run({ type: "accept_quotation", id: hireA.id, note: "Accepted by telephone by Nii Armah Tackie; written confirmation by email the same morning." }, at(-8, "08:10"));
await run({ type: "confirm_rental", id: hireA.id, input: { amount: depositFor(hireA.id), method: "Bank transfer", reference: "GCB/TRF/882014" } }, at(-8, "10:35"));
await run({ type: "assign_rental", id: hireA.id, input: { vehicleId: camry.id, driverId: kwame.id } }, at(-8, "12:00"));
await run({ type: "start_rental", id: hireA.id, odometerKm: "48210" }, at(-8, "13:15"));
await run({
  type: "complete_rental",
  id: hireA.id,
  input: {
    lines: [
      { description: "Executive sedan with driver, 3 days", quantity: "3", unitAmount: "950.00" },
      { description: "Airport meet-and-greet and parking", quantity: "1", unitAmount: "180.00" },
    ],
    departedAt: day(-8),
    returnedAt: day(-5),
    odometerStartKm: "48210",
    odometerEndKm: "48592",
    distanceKm: "382",
    damageNotes: "",
    feedback: "The director asked for the same driver next time.",
  },
}, at(-5, "17:40"));

// (b) A large hire above the approval threshold: quoted, signed off by a second person, agreed and
// dispatched (still out) with a minibus and driver.
const hireB = await request({
  clientId: oguaa.id,
  customerName: "Comfort Aidoo",
  customerPhone: "+233 55 610 2298",
  customerEmail: "comfort.aidoo@oguaaeducation.org.gh",
  purpose: "Six-day school trip from Cape Coast to Mole National Park and back.",
  pickupLocation: "Pedu Junction, Cape Coast",
  dropoffLocation: "Pedu Junction, Cape Coast",
  startDate: day(-1),
  endDate: day(5),
  passengers: "18",
  vehicleCategoryId: "cat_bus",
  driverRequired: true,
  notes: "Two teachers travelling with sixteen students. Stops at Elmina and Tamale on the way north.",
}, at(-6, "08:40"));
await run({
  type: "quote_rental",
  id: hireB.id,
  input: {
    lines: [
      { description: "Staff bus with driver, 6 days, Cape Coast - Mole - Cape Coast", quantity: "6", unitAmount: "1400.00" },
      { description: "Driver overnight allowance", quantity: "6", unitAmount: "220.00" },
    ],
  },
}, at(-6, "10:05"));
await runAs(opsUserId, { type: "approve_quotation", id: hireB.id, note: "Rate agreed with the trust; checked against the fuel and allowance budget for the trip." }, at(-6, "11:00"));
await run({ type: "accept_quotation", id: hireB.id, note: "Comfort Aidoo confirmed by email on behalf of the trust." }, at(-5, "09:30"));
await run({ type: "confirm_rental", id: hireB.id, input: { amount: depositFor(hireB.id), method: "MTN MoMo", reference: "MP260214.1420.A88213" } }, at(-5, "10:15"));
await run({ type: "assign_rental", id: hireB.id, input: { vehicleId: sprinter.id, driverId: musah.id } }, at(-2, "15:00"));
await run({ type: "start_rental", id: hireB.id, odometerKm: "96240" }, at(-1, "05:50"));

// (c) A quotation out with the customer, not yet accepted.
const hireC = await request({
  clientId: tema.id,
  customerName: "Efua Mensimah",
  customerPhone: "+233 20 880 3376",
  customerEmail: "efua.mensimah@temaportlogistics.com.gh",
  purpose: "Two days of executive transfers for a shipping line delegation.",
  pickupLocation: "Kotoka International Airport, Terminal 3",
  dropoffLocation: "Tema Community 1",
  startDate: day(4),
  endDate: day(5),
  passengers: "3",
  vehicleCategoryId: "cat_exec",
  driverRequired: true,
  notes: "The delegation arrives on the 06:20 flight.",
}, at(-2, "14:20"));
await run({
  type: "quote_rental",
  id: hireC.id,
  input: {
    lines: [
      { description: "Executive van with driver, 2 days", quantity: "2", unitAmount: "1150.00" },
      { description: "Airport transfers, four trips", quantity: "4", unitAmount: "160.00" },
    ],
  },
}, at(-2, "16:00"));

// (d) A walk-in request that the office has taken on but not yet priced.
await request({
  clientId: walkIn.id,
  customerName: "Yaa Serwaa Addo",
  customerPhone: "024 771 3390",
  customerEmail: "yaa.addo84@gmail.com",
  purpose: "Family trip to Kumasi for a funeral, returning the next evening.",
  pickupLocation: "East Legon, Accra",
  dropoffLocation: "East Legon, Accra",
  startDate: day(6),
  endDate: day(7),
  passengers: "5",
  vehicleCategoryId: "cat_exec",
  driverRequired: false,
  notes: "Customer will drive; asked whether a second driver can be added.",
}, at(0, "07:45"));

// (e) A completed hire that was billed, part-paid, part-credited and partly refunded.
const hireE = await request({
  clientId: volta.id,
  customerName: "Ama Nyarko",
  customerPhone: "+233 24 555 0142",
  customerEmail: "ama.nyarko@voltastarmining.com.gh",
  purpose: "Site visit for the regional director and two engineers.",
  pickupLocation: "Tarkwa township depot",
  dropoffLocation: "Tarkwa township depot",
  startDate: day(-14),
  endDate: day(-11),
  passengers: "3",
  vehicleCategoryId: "cat_exec",
  driverRequired: true,
  notes: "One extra day was cancelled after the first day.",
}, at(-15, "08:00"));
await run({
  type: "quote_rental",
  id: hireE.id,
  input: {
    lines: [{ description: "Executive sedan with driver, 4 days", quantity: "4", unitAmount: "900.00" }],
  },
}, at(-15, "09:30"));
await run({ type: "accept_quotation", id: hireE.id, note: "Accepted by the site administrator at Tarkwa." }, at(-15, "11:00"));
await run({ type: "confirm_rental", id: hireE.id, input: { amount: depositFor(hireE.id), method: "Bank transfer", reference: "ECOBANK/TRF/441902" } }, at(-14, "12:00"));
await run({ type: "assign_rental", id: hireE.id, input: { vehicleId: staria.id, driverId: abena.id } }, at(-14, "13:00"));
await run({ type: "start_rental", id: hireE.id, odometerKm: "22180" }, at(-14, "14:00"));
await run({
  type: "complete_rental",
  id: hireE.id,
  input: {
    lines: [{ description: "Executive sedan with driver, 3 days (one day released)", quantity: "3", unitAmount: "900.00" }],
    departedAt: day(-14),
    returnedAt: day(-11),
    odometerStartKm: "22180",
    odometerEndKm: "22640",
    distanceKm: "460",
    damageNotes: "",
    feedback: "",
  },
}, at(-11, "18:20"));

// ============================================================
// 13. The money: invoices, payments, a credit note and a refund.
// ============================================================
await run({ type: "issue_rental_invoice", input: { rentalId: hireA.id, issuedOn: day(-4), discountAmount: "", discountReason: "", notes: "Payable within 30 days to Adinkra Transit Services Ltd, GCB Bank, Ridge branch." } }, at(-4, "09:00"));
const invoiceA = state.invoices.find((invoice) => invoice.rentalId === hireA.id)!;
const halfA = (invoiceA.total / 2).toFixed(2);
await run({ type: "record_payment", input: { invoiceId: invoiceA.id, amount: halfA, method: "Bank transfer", paidOn: day(-3), externalReference: "GCB/TRF/884016", note: "First instalment per the facilities manager." } }, at(-3, "10:00"));
const paymentFirst = state.payments[state.payments.length - 1];
await run({ type: "advance_payment", id: paymentFirst.id, to: "verified" }, at(-2, "09:30"));
await run({ type: "advance_payment", id: paymentFirst.id, to: "reconciled" }, at(-1, "16:00"));
const outstandingA = (invoiceA.total - invoiceA.amountPaid - Number(halfA)).toFixed(2);
await run({ type: "record_payment", input: { invoiceId: invoiceA.id, amount: outstandingA, method: "Cheque", paidOn: day(0), externalReference: "CHQ 004482 GCB", note: "Balance paid on collection of the signed invoice." } }, at(0, "11:00"));
const paymentSecond = state.payments[state.payments.length - 1];
await runAs(financeUserId, { type: "advance_payment", id: paymentSecond.id, to: "verified" }, at(0, "11:30"));

await run({ type: "issue_rental_invoice", input: { rentalId: hireE.id, issuedOn: day(-10), discountAmount: "", discountReason: "", notes: "Site visit, Tarkwa." } }, at(-10, "09:00"));
const invoiceE = state.invoices.find((invoice) => invoice.rentalId === hireE.id)!;
await run({ type: "record_payment", input: { invoiceId: invoiceE.id, amount: invoiceE.total.toFixed(2), method: "Bank transfer", paidOn: day(-8), externalReference: "ECOBANK/TRF/442110", note: "Paid in full against the invoice as issued." } }, at(-8, "10:20"));
await run({ type: "issue_credit_note", input: { invoiceId: invoiceE.id, issuedOn: day(-6), amount: "900.00", description: "One day of hire released at the customer's request", reason: "The regional director's site visit finished a day early." } }, at(-6, "11:00"));
await run({ type: "record_refund", input: { invoiceId: invoiceE.id, amount: "900.00", method: "Bank transfer", paidOn: day(-5), externalReference: "ECOBANK/OUT/778201", reason: "Returning the value of the released day, which the customer had already paid for." } }, at(-5, "15:40"));

// ============================================================
// 14. Costs.
// ============================================================
const expenses: { incurredOn: string; category: string; description: string; payee: string; amount: string; method: string; receiptReference: string; receiptHeld: boolean; notes: string }[] = [
  { incurredOn: day(-12), category: "Fuel", description: "Diesel, 220 litres", payee: "GOIL Tarkwa", amount: "3520.00", method: "Fuel card", receiptReference: "GOIL/TW/77120", receiptHeld: true, notes: "Coaster, two weeks of mine runs." },
  { incurredOn: day(-11), category: "Fuel", description: "Petrol, 60 litres", payee: "Shell Ridge", amount: "1080.00", method: "Fuel card", receiptReference: "SHL/RD/44201", receiptHeld: true, notes: "Camry, airport transfers." },
  { incurredOn: day(-9), category: "Maintenance", description: "Gearbox overhaul on GT 5512-20", payee: "Kofi Auto Works, Abossey Okai", amount: "9800.00", method: "Bank transfer", receiptReference: "KAW/INV/2210", receiptHeld: true, notes: "Workshop invoice paid in full." },
  { incurredOn: day(-8), category: "Tyres", description: "Four 195R15 tyres and fitting", payee: "Tyres Plus, Achimota", amount: "4600.00", method: "MTN MoMo", receiptReference: "MO/8821334", receiptHeld: true, notes: "Hiace." },
  { incurredOn: day(-7), category: "Tolls", description: "Tema Motorway and Accra-Tema tolls", payee: "Ghana Highways Authority", amount: "240.00", method: "Cash", receiptReference: "", receiptHeld: false, notes: "Toll receipts not returned by the driver." },
  { incurredOn: day(-5), category: "Permits and licensing", description: "Roadworthy renewal, GE 1207-25", payee: "DVLA Tema", amount: "410.00", method: "Cash", receiptReference: "DVLA/RW/7712", receiptHeld: true, notes: "Certificate to be filed on return." },
  { incurredOn: day(-3), category: "Insurance", description: "Third-party renewal, WR 2210-24", payee: "Vanguard Assurance", amount: "2150.00", method: "Bank transfer", receiptReference: "VAN/CM/44190", receiptHeld: true, notes: "Leased vehicle, charged to the Tema contract." },
  { incurredOn: day(-2), category: "Wages and allowances", description: "Driver overnight allowance, Mole trip", payee: "Musah Abdulai", amount: "440.00", method: "MTN MoMo", receiptReference: "MO/8890031", receiptHeld: true, notes: "Two nights, paid on the road." },
  { incurredOn: day(-1), category: "Car wash", description: "Weekly wash, six vehicles", payee: "Clean Ride, Circle", amount: "180.00", method: "Cash", receiptReference: "", receiptHeld: false, notes: "" },
];
for (const expense of expenses) {
  await run({ type: "record_expense", input: expense }, at(-2, "12:00"));
}

// ============================================================
// 15. Incidents and workshop orders.
// ============================================================
// A breakdown that has been through the whole timeline and is closed.
await run({
  type: "create_incident",
  input: {
    type: "breakdown",
    severity: "high",
    vehicleId: grandbird.id,
    tripId: "",
    reportedDate: day(-13),
    description: "Gearbox slipped out of third on the Tema road and the bus would not hold speed. Driver stopped at Ashaiman and called the office.",
    assignedTo: "Kofi Auto Works, Abossey Okai",
    takeVehicleOutOfService: true,
  },
}, at(-13, "15:20"));
const gearboxIncident = state.incidents[state.incidents.length - 1];
await run({ type: "advance_incident", id: gearboxIncident.id, input: { to: "acknowledged", note: "Office called the driver back and arranged recovery to the workshop.", assignedTo: "Kofi Auto Works, Abossey Okai", resolutionNote: "", vehicleRestoredTo: "unchanged" } }, at(-13, "16:10"));
await run({ type: "advance_incident", id: gearboxIncident.id, input: { to: "responding", note: "Recovery truck collected the bus at 18:40.", assignedTo: "Kofi Auto Works, Abossey Okai", resolutionNote: "", vehicleRestoredTo: "unchanged" } }, at(-13, "19:00"));
await run({
  type: "create_work_order",
  input: {
    vehicleId: grandbird.id,
    title: "Gearbox overhaul",
    workType: "Repair",
    workshop: "Kofi Auto Works, Abossey Okai",
    description: "Strip and rebuild the gearbox; replace third gear synchro and the input shaft bearing.",
    reportedOdometer: "318450",
    plannedDate: day(-12),
    incidentId: gearboxIncident.id,
    resetsServiceInterval: false,
  },
}, at(-12, "08:30"));
const gearboxOrder = state.workOrders[state.workOrders.length - 1];
await run({ type: "advance_work_order", id: gearboxOrder.id, input: { to: "in_progress", note: "Workshop started the strip-down.", costsConfirmedComplete: false, vehicleRestoredTo: "unchanged" } }, at(-10, "09:00"));
await run({ type: "add_work_order_cost", id: gearboxOrder.id, input: { description: "Gearbox rebuild parts and labour", category: "Maintenance", amount: "9800.00", incurredDate: day(-9) } }, at(-9, "16:30"));
await run({ type: "add_work_order_cost", id: gearboxOrder.id, input: { description: "Recovery truck, Ashaiman to Abossey Okai", category: "Maintenance", amount: "650.00", incurredDate: day(-13) } }, at(-9, "16:35"));
await run({ type: "advance_work_order", id: gearboxOrder.id, input: { to: "completed", note: "Road-tested on the Spintex road; gears select cleanly.", costsConfirmedComplete: true, vehicleRestoredTo: "available" } }, at(-8, "17:00"));
await run({ type: "advance_work_order", id: gearboxOrder.id, input: { to: "closed", note: "Invoice checked against the two costs recorded; nothing outstanding.", costsConfirmedComplete: true, vehicleRestoredTo: "unchanged" } }, at(-2, "09:30"));
await run({ type: "advance_incident", id: gearboxIncident.id, input: { to: "resolved", note: "Gearbox rebuilt and the bus road-tested. Roadworthy has since lapsed and is being renewed.", assignedTo: "Kofi Auto Works, Abossey Okai", resolutionNote: "Gearbox overhaul completed; bus back at the yard.", vehicleRestoredTo: "unchanged" } }, at(-2, "10:00"));
await run({ type: "advance_incident", id: gearboxIncident.id, input: { to: "closed", note: "Costs reconciled against the workshop invoice.", assignedTo: "", resolutionNote: "Closed after the invoice was checked.", vehicleRestoredTo: "unchanged" } }, at(-1, "09:00"));

// A tyre incident that is still open, with a work order booked in for tomorrow.
await run({
  type: "create_incident",
  input: {
    type: "damage",
    severity: "medium",
    vehicleId: urvan.id,
    tripId: "",
    reportedDate: day(-1),
    description: "Rear nearside tyre cut on a pothole at Ashaiman; the spare was fitted at the roadside.",
    assignedTo: "Esi Quansah",
    takeVehicleOutOfService: false,
  },
}, at(-1, "18:10"));
const tyreIncident = state.incidents[state.incidents.length - 1];
await run({ type: "advance_incident", id: tyreIncident.id, input: { to: "acknowledged", note: "Driver reported by phone; spare fitted and the van continued.", assignedTo: "Esi Quansah", resolutionNote: "", vehicleRestoredTo: "unchanged" } }, at(-1, "18:45"));
await run({
  type: "create_work_order",
  input: {
    vehicleId: urvan.id,
    title: "Replace rear nearside tyre",
    workType: "Tyres",
    workshop: "Tyres Plus, Achimota",
    description: "Fit one 195R15 tyre and check the alignment on the rear axle.",
    reportedOdometer: "87420",
    plannedDate: day(1),
    incidentId: tyreIncident.id,
    resetsServiceInterval: false,
  },
}, at(0, "08:15"));

// ============================================================
// 16. Odometer readings.
// ============================================================
const readings: [string, string, string, string][] = [
  [coaster.id, "318920", day(-2), "Weekly yard check by the operations desk."],
  [hiace.id, "142180", day(-2), "Weekly yard check."],
  [camry.id, "48592", day(-5), "Read at the end of the Ridge hire."],
  [sprinter.id, "96510", day(-1), "Read at departure for the Mole trip."],
  [urvan.id, "87420", day(-1), "Reported by the driver with the tyre damage."],
  [staria.id, "22640", day(-11), "Read at the end of the Tarkwa hire."],
  [grandbird.id, "318450", day(-13), "Read when the bus was recovered to the workshop."],
  [hilux.id, "64110", day(-2), "Weekly yard check; the pickup is used for errands and recovery."],
];
for (const [vehicleId, readingKm, readingDate, note] of readings) {
  await run({ type: "record_odometer", input: { vehicleId, readingKm, readingDate, note } }, at(-1, "07:30"));
}

// ============================================================
// 17. The public enquiry form, as a visitor would leave it.
// ============================================================
const enquiries = [
  {
    customerName: "Kwesi Amankwah",
    customerPhone: "+233 27 441 2288",
    customerEmail: "kwesi.amankwah@akwabagroup.com.gh",
    organization: "Akwaba Hospitality Group",
    purpose: "Airport transfers for a conference of twelve delegates over three days.",
    pickupLocation: "Kotoka International Airport, Terminal 3",
    dropoffLocation: "Kempinski Hotel, Accra",
    startDate: day(12),
    endDate: day(14),
    passengers: "12",
    vehicleCategoryId: "cat_mini",
    notes: "Delegates arrive on two flights. Please quote with a driver.",
  },
  {
    customerName: "Adwoa Bediako",
    customerPhone: "024 335 9081",
    customerEmail: "adwoa.bediako@yahoo.com",
    organization: "",
    purpose: "Wedding party transport from Madina to Aburi and back.",
    pickupLocation: "Madina Market, Accra",
    dropoffLocation: "Aburi Botanical Gardens",
    startDate: day(21),
    endDate: day(21),
    passengers: "24",
    vehicleCategoryId: "cat_bus",
    notes: "Two buses if possible; the bridal party is twenty-four people.",
  },
];
for (const enquiry of enquiries) {
  await run({ type: "submit_enquiry", input: enquiry }, at(-1, "16:35"));
}

// ============================================================
// 18. Portal accounts, so the customer and driver screens have something to show.
// ============================================================
const aka = riderByName("Akosua Mensah");
await run({
  type: "create_user",
  input: { fullName: aka.fullName, email: "akosua.mensah@voltastarmining.com.gh", role: "passenger", active: true, passengerId: aka.id },
  credential,
}, at(0, "12:00"));
await run({
  type: "create_user",
  input: { fullName: "Ama Nyarko", email: "ama.nyarko@voltastarmining.com.gh", role: "client_contact", active: true, clientId: volta.id, primaryContact: true },
  credential,
}, at(0, "12:05"));
await run({
  type: "create_user",
  input: { fullName: yaw.fullName, email: "yaw.boakye@adinkratransit.com.gh", role: "driver", active: true, driverId: yaw.id },
  credential,
}, at(0, "12:10"));

// ============================================================
// Summary.
// ============================================================
state = await loadDatabase(connection());
const table: [string, number][] = [
  ["Users", state.users.length],
  ["Clients", state.clients.length],
  ["Client branches", state.clientLocations.length],
  ["Contracts", state.contracts.length],
  ["Vehicles", state.vehicles.length],
  ["Drivers", state.drivers.length],
  ["Documents", state.documents.length],
  ["Routes", state.routes.length],
  ["Riders", state.passengers.length],
  ["Trips", state.trips.length],
  ["Bookings", state.bookings.length],
  ["Rental requests", state.rentals.length],
  ["Invoices", state.invoices.length],
  ["Payments", state.payments.length],
  ["Credit notes", state.creditNotes.length],
  ["Refunds", state.refunds.length],
  ["Expenses", state.expenses.length],
  ["Incidents", state.incidents.length],
  ["Work orders", state.workOrders.length],
  ["Odometer readings", state.odometerReadings.length],
  ["Audit entries", state.audit.length],
];
const width = Math.max(...table.map(([label]) => label.length));
console.log(`\nDemonstration data added in ${steps} commands.\n`);
for (const [label, value] of table) console.log(`  ${label.padEnd(width)}  ${String(value).padStart(4)}`);
console.log("\nAccounts created by this script all use the same password:");
console.log(`\n  ${DEMO_PASSWORD}\n`);
const demoAccounts: [string, string][] = [
  ...(adminWasCreated ? ([["ama.boateng@adinkratransit.com.gh", "administrator"]] as [string, string][]) : []),
  ["nana.ofori@adinkratransit.com.gh", "operations"],
  ["gifty.amoako@adinkratransit.com.gh", "finance"],
  ["yaw.boakye@adinkratransit.com.gh", "driver"],
  ["ama.nyarko@voltastarmining.com.gh", "client contact"],
  ["akosua.mensah@voltastarmining.com.gh", "passenger"],
];
for (const [email, role] of demoAccounts) console.log(`  ${email.padEnd(38)} ${role}`);
if (!adminWasCreated) console.log("\n  The administrator already on this database keeps its own password.");
console.log("\nAll names, companies, phone numbers and TINs are invented for the demonstration.\n");
process.exit(0);
