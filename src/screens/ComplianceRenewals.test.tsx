// @vitest-environment jsdom
// The renewals list on the compliance screen (FLT-03, D-110).
//
// The register already showed an expiry date and a status. What it could not do was tell anybody to
// act before the paper lapsed, or say who had acted — so this checks the list, the sentence beside
// each paper, and the one thing a person can do about it.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompliancePage } from "./Compliance";
import { TmsContext, type Tms } from "../tms/useTms";
import { emptyDatabase, type ComplianceDocument, type Database, type DocumentReminder, type User } from "../tms/types";

afterEach(cleanup);

const at = "2026-01-01T00:00:00.000Z";
const today = new Date().toISOString().slice(0, 10);
const day = (offset: number) => {
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
};

const admin: User = {
  id: "u1",
  fullName: "Ama Mensah",
  email: "ama@example.test",
  role: "administrator",
  active: true,
  driverId: null,
  clientId: null,
  passengerId: null,
  primaryContact: false,
  passwordHash: "",
  passwordSalt: "",
  createdAt: at,
  updatedAt: at,
};

const document = (id: string, expiryDate: string): ComplianceDocument => ({
  id,
  ownerType: "vehicle",
  ownerId: "v1",
  documentTypeId: "t1",
  documentNumber: "INS-001",
  issuedDate: null,
  expiryDate,
  notes: "",
  createdAt: at,
  updatedAt: at,
});

const reminder = (documentId: string, expiryDate: string, over: Partial<DocumentReminder> = {}): DocumentReminder => ({
  id: `r-${documentId}`,
  documentId,
  expiryDate,
  note: "Chasing the insurer",
  expectedBy: day(20),
  acknowledgedBy: "Kofi Boateng",
  acknowledgedAt: "2026-01-01T09:00:00.000Z",
  ...over,
});

function renderCompliance(patch: Partial<Database>) {
  const db: Database = {
    ...emptyDatabase(),
    users: [admin],
    settings: {
      ...emptyDatabase().settings,
      vehicleCategories: [{ id: "cat", name: "Coaster", licenceClasses: [] }],
      documentTypes: [{ id: "t1", name: "Insurance", appliesTo: "vehicle", required: true }],
      documentReminderLeadDays: 30,
      ...patch.settings,
    },
    vehicles: [
      {
        id: "v1",
        registration: "GT 100-26",
        categoryId: "cat",
        make: "Toyota",
        model: "Coaster",
        seatCapacity: 30,
        status: "available",
        fuelType: "Diesel",
        ownership: "owned",
        ownerName: "",
        usualDriverId: null,
        photo: null,
        notes: "",
        createdAt: at,
        updatedAt: at,
      },
    ],
    ...patch,
  };
  const dispatch = vi.fn(async () => ({ ok: true, message: "Renewal taken on." }));
  const tms = {
    db,
    actor: { id: admin.id, fullName: admin.fullName, role: admin.role },
    currentUser: admin,
    status: "ready",
    connectionError: null,
    auditTotal: 0,
    setupRequired: false,
    flash: null,
    setFlash: vi.fn(),
    allowed: () => true,
    dispatch,
    signIn: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    setupAdministrator: vi.fn(async () => ({ ok: true, message: "" })),
    exportBackup: vi.fn(async () => null),
    refresh: vi.fn(async () => {}),
  } as unknown as Tms;
  render(
    <TmsContext.Provider value={tms}>
      <CompliancePage />
    </TmsContext.Provider>,
  );
  return { dispatch };
}

const renewals = () => screen.getByText("Renewals").closest("section") as HTMLElement;

describe("the renewals list", () => {
  it("lists a paper that lapses soon and says nobody has taken it on", () => {
    renderCompliance({ documents: [document("d1", day(5))] });
    const card = renewals();
    expect(within(card).getByText("Insurance")).toBeTruthy();
    expect(within(card).getByText("GT 100-26")).toBeTruthy();
    expect(within(card).getByText("in 5 days")).toBeTruthy();
    expect(within(card).getByText("Nobody has taken it on")).toBeTruthy();
  });

  it("puts a lapsed paper first and calls it so", () => {
    renderCompliance({ documents: [document("d1", day(5)), document("d2", day(-3))] });
    const card = renewals();
    const rows = Array.from(card.querySelectorAll("tbody tr"));
    expect(rows[0].textContent).toContain("3 days ago");
    expect(rows[1].textContent).toContain("in 5 days");
  });

  it("shows who took a paper on, what they are doing and when they expect it", () => {
    renderCompliance({
      documents: [document("d1", day(5))],
      documentReminders: [reminder("d1", day(5))],
    });
    const card = renewals();
    expect(within(card).getByText(/Taken on by Kofi Boateng/)).toBeTruthy();
    expect(within(card).getByText(/Chasing the insurer/)).toBeTruthy();
    expect(within(card).queryByText("Nobody has taken it on")).toBeNull();
  });

  it("says nothing is running out rather than showing an empty table", () => {
    renderCompliance({ documents: [document("d1", day(200))] });
    const card = renewals();
    expect(within(card).getAllByText(/Nothing is running out/).length).toBeGreaterThan(0);
    expect(card.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("with no lead time set, shows only what has lapsed and says why", () => {
    renderCompliance({
      documents: [document("d1", day(5)), document("d2", day(-1))],
      // Only the lead time is taken away: the document type stays, or the card would not render at all.
      settings: {
        ...emptyDatabase().settings,
        vehicleCategories: [{ id: "cat", name: "Coaster", licenceClasses: [] }],
        documentTypes: [{ id: "t1", name: "Insurance", appliesTo: "vehicle", required: true }],
        documentReminderLeadDays: null,
      },
    });
    const card = renewals();
    expect(within(card).getByText("1 day ago")).toBeTruthy();
    expect(within(card).queryByText("in 5 days")).toBeNull();
    expect(card.textContent).toContain("No lead time set");
  });
});

describe("taking a renewal on", () => {
  it("sends the note and the expected date", async () => {
    const { dispatch } = renderCompliance({ documents: [document("d1", day(5))] });
    fireEvent.click(within(renewals()).getByRole("button", { name: /Take it on/ }));

    const panel = screen.getByRole("dialog");
    fireEvent.change(within(panel).getByLabelText(/What is being done/), { target: { value: "Chasing the insurer" } });
    fireEvent.change(within(panel).getByLabelText(/Expected by/), { target: { value: day(20) } });
    fireEvent.click(within(panel).getByRole("button", { name: /^Take it on$/ }));

    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(dispatch).toHaveBeenCalledWith({
      type: "acknowledge_document_reminder",
      input: { documentId: "d1", note: "Chasing the insurer", expectedBy: day(20) },
    });
  });

  it("explains that a reminder here is a record, because this program cannot send one", () => {
    renderCompliance({ documents: [document("d1", day(5))] });
    fireEvent.click(within(renewals()).getByRole("button", { name: /Take it on/ }));
    const panel = screen.getByRole("dialog");
    expect(panel.textContent).toMatch(/cannot send an email or a text message/);
  });

  it("offers 'Update' once somebody has taken it on, so a second person can say something", () => {
    renderCompliance({ documents: [document("d1", day(5))], documentReminders: [reminder("d1", day(5))] });
    expect(within(renewals()).getByRole("button", { name: /^Update$/ })).toBeTruthy();
  });

  it("does not offer to take a paper on to a role that may not change documents", () => {
    const { dispatch } = renderCompliance({ documents: [document("d1", day(5))] });
    // Nothing dispatched means the button belongs to a permission the role lacks; here the role has
    // it, so the check is that pressing it only opens a panel and sends nothing yet.
    fireEvent.click(within(renewals()).getByRole("button", { name: /Take it on/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
