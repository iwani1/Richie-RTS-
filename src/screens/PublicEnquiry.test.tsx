// @vitest-environment jsdom
// WEB-01 screen: the form a stranger sees. What matters here is that it never claims a booking, that
// a rejection is readable, and that the success panel shows the reference the office will ask for.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_HEIGHT_MESSAGE, PublicEnquiry } from "./PublicEnquiry";

const categories = [{ id: "cat-1", name: "Coaster" }, { id: "cat-2", name: "Sprinter" }];

type Reply = { status: number; body: unknown };

function stubFetch(postReply: Reply) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (!init || init.method !== "POST") {
      return { ok: true, json: async () => ({ ok: true, token: "token-abc", categories, open: true }) };
    }
    return { ok: postReply.status < 400, json: async () => postReply.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** The form is loaded when the vehicle types have arrived. */
async function ready() {
  render(<PublicEnquiry />);
  await waitFor(() => expect(screen.getByRole("option", { name: "Coaster" })).toBeTruthy());
}

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { parent?: unknown }).parent;
});

describe("public enquiry form", () => {
  it("loads the vehicle types and says plainly that nothing is booked by sending it", async () => {
    stubFetch({ status: 200, body: { ok: true, message: "Thank you.", reference: "RR-0007" } });
    await ready();
    expect(screen.getByRole("heading", { name: "Request a vehicle" })).toBeTruthy();
    expect(screen.getByText(/this form does not book anything and takes no payment/i)).toBeTruthy();
  });

  it("sends the token it was given, and shows the reference back", async () => {
    const calls = stubFetch({
      status: 200,
      body: { ok: true, message: "Thank you. Your request is recorded as RR-0007.", reference: "RR-0007" },
    });
    await ready();
    fill(/^Your name/, "Akosua Boateng");
    fill(/^Phone number/, "+233 24 123 4567");
    fill(/^Vehicle type/, "cat-1");
    fill(/^First day/, "2026-07-01");
    fill(/^Last day/, "2026-07-02");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(screen.getByText("RR-0007")).toBeTruthy());
    expect(screen.getByRole("heading", { name: /the office will call you/i })).toBeTruthy();
    const sent = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ token: "token-abc", customerName: "Akosua Boateng" });
  });

  it("shows a field error where the office's own form would show it", async () => {
    stubFetch({
      status: 400,
      body: {
        ok: false,
        message: "Please correct the highlighted fields.",
        errors: { customerPhone: "A phone number is needed so the office can call you back." },
      },
    });
    await ready();
    fill(/^Your name/, "Akosua Boateng");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(screen.getByText(/phone number is needed/i)).toBeTruthy());
    // The alert region carries the message, and the field carries aria-invalid for a screen reader.
    expect(screen.getByLabelText(/^Phone number/).getAttribute("aria-invalid")).toBe("true");
    // Two alerts: the field error and the summary. Both are announced, which is the intent.
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("reports a throttled submission without pretending it was received", async () => {
    stubFetch({ status: 429, body: { ok: false, message: "That is a lot of requests from this connection." } });
    await ready();
    fill(/^Your name/, "Akosua Boateng");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.getByText(/a lot of requests/i)).toBeTruthy());
    expect(screen.queryByRole("heading", { name: /the office will call you/i })).toBeNull();
  });

  it("does not send before the form has a token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicEnquiry />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(screen.getByText(/has not finished loading/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1); // the GET only
  });
});

describe("framed on the company website", () => {
  it("tells the host page how tall it is, and sends nothing else", async () => {
    stubFetch({ status: 200, body: { ok: true, message: "Thank you.", reference: "RR-0007" } });
    const postMessage = vi.fn();
    // jsdom has no layout, so the document reports 0 high. The point of the case is the transport:
    // a message of the right type carrying a pixel height and no field values.
    Object.defineProperty(window, "parent", { value: { postMessage }, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 641, configurable: true });

    render(<PublicEnquiry embedded />);
    await waitFor(() => expect(postMessage).toHaveBeenCalled());

    const [message] = postMessage.mock.calls[0];
    expect(message).toEqual({ type: EMBED_HEIGHT_MESSAGE, height: 641 });
    expect(EMBED_HEIGHT_MESSAGE).toBe("richie-enquiry:height");
  });

  it("stays quiet when the page was not asked to be framed", async () => {
    stubFetch({ status: 200, body: { ok: true, message: "Thank you.", reference: "RR-0007" } });
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", { value: { postMessage }, configurable: true });

    render(<PublicEnquiry />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Coaster" })).toBeTruthy());
    expect(postMessage).not.toHaveBeenCalled();
  });
});
