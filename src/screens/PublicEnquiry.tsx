"use client";

// The public enquiry form (WEB-01).
//
// This screen is not part of the signed-in shell: it is rendered on its own route so it can be
// embedded in the company's existing website inside an <iframe>, and it holds no session, no
// database snapshot and no navigation into the application. It talks to one endpoint, which answers
// with a reference and a sentence and nothing else.
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Notice, Select, TextArea, TextInput } from "../ui/primitives";

type Category = { id: string; name: string };

/**
 * The message a framed form sends its host page, carrying its own height in pixels.
 *
 * A fixed-height iframe is the wrong shape for this form: on a phone it clips the button, on a
 * desktop it leaves a band of white under it, and the thank-you panel is shorter than the form it
 * replaces. The host page cannot measure inside the frame — only the frame can — so the frame says
 * how tall it is and the host sets the height. The payload is a number and nothing else: no field
 * value travels to the host page.
 */
export const EMBED_HEIGHT_MESSAGE = "richie-enquiry:height";

function useEmbedHeight(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || window.parent === window) return;

    const report = () => {
      const height = Math.ceil(Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0));
      if (height > 0) window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, "*");
    };

    report();
    // The form grows when an error appears, and shrinks when the thank-you panel replaces it.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", report);
      return () => window.removeEventListener("resize", report);
    }
    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [enabled]);
}

const blank = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  organization: "",
  purpose: "",
  pickupLocation: "",
  dropoffLocation: "",
  startDate: "",
  endDate: "",
  passengers: "12",
  vehicleCategoryId: "",
  notes: "",
};

export function PublicEnquiry({ embedded = false }: { embedded?: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [values, setValues] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(true);
  useEmbedHeight(embedded);
  // The honeypot. It is not in `values` on purpose: a person never touches it, and a bot that fills
  // every input it finds fills this one too.
  const [honeypot, setHoneypot] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/enquiry", { headers: { accept: "application/json" } })
      .then((response) => response.json() as Promise<{ ok?: boolean; token?: string; categories?: Category[] }>)
      .then((body) => {
        if (!live) return;
        setToken(body.token ?? null);
        setCategories(body.categories ?? []);
      })
      .catch(() => {
        if (live) setMessage("The form could not be loaded. Please check your connection and reload the page.");
      })
      .finally(() => {
        if (live) setOpening(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setErrors({});
    if (!token) {
      setMessage("The form has not finished loading. Reload the page and try again.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, token, website: honeypot }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        message?: string;
        reference?: string | null;
        errors?: Record<string, string>;
      };
      if (response.ok && body.ok) {
        setReference(body.reference ?? null);
        setMessage(body.message ?? "Thank you. The office will be in touch.");
      } else {
        setErrors(body.errors ?? {});
        setMessage(body.message ?? "The request was not sent. Please try again.");
      }
    } catch {
      setMessage("The request was not sent: the connection failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Two frames for one page. Embedded, it is a block inside the company's own website: no border, no
  // card, no page padding, because the host page already has those. Opened directly, it is a page and
  // needs to look like one. The difference is the wrapper's classes and nothing else, so a rule cannot
  // drift away from the markup that relies on it.
  const shell = embedded
    ? "flex justify-center bg-background py-1"
    : "flex min-h-dvh justify-center bg-background px-4 py-12 sm:px-6";
  const card = embedded
    ? "w-full max-w-[640px] px-1 pb-2"
    : "w-full max-w-[640px] self-start rounded-card border border-border bg-card p-6 shadow-card sm:p-8";

  if (reference) {
    return (
      <div className={shell}>
        <div className={card}>
          <p className="tms-mono mb-2 text-primary">Request received</p>
          <h1 className="mb-2.5 text-[clamp(1.5rem,3.4vw,1.875rem)] leading-[1.14] font-semibold tracking-[-0.03em] text-foreground">
            Thank you — the office will call you.
          </h1>
          <p className="mb-5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Your request is recorded as <strong className="tms-num font-semibold text-foreground">{reference}</strong>. Nothing is
            booked yet: the office will telephone the number you gave to confirm the vehicle, the dates and the price.
          </p>
          <Notice tone="info">
            If your plans change before the office calls, telephone them with this reference and they will update or
            cancel the request.
          </Notice>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className={card}>
        <header className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary text-[15px] font-bold text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
          >
            R
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] leading-tight font-semibold tracking-[-0.01em] text-foreground">Richie</p>
            <p className="tms-mono mt-0.5 text-[10px] text-dim">Transport services · Ghana</p>
          </div>
        </header>

        <h1 className="mb-2.5 text-[clamp(1.5rem,3.4vw,1.875rem)] leading-[1.14] font-semibold tracking-[-0.03em] text-foreground">
          Request a vehicle
        </h1>
        <p className="mb-5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Tell us when you need a vehicle and where it is going. The office will call you back to confirm availability
          and the price — this form does not book anything and takes no payment.
        </p>

        {message && (
          <Notice tone="error" className="mt-4">
            {message}
          </Notice>
        )}

        <form className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2" onSubmit={submit} noValidate>
          <Field label="Your name" error={errors.customerName}>
            <TextInput
              value={values.customerName}
              onChange={set("customerName")}
              invalid={!!errors.customerName}
              autoComplete="name"
              maxLength={120}
              required
            />
          </Field>

          <Field label="Phone number" hint="The office calls this number to confirm." error={errors.customerPhone}>
            <TextInput
              type="tel"
              value={values.customerPhone}
              onChange={set("customerPhone")}
              invalid={!!errors.customerPhone}
              autoComplete="tel"
              inputMode="tel"
              maxLength={40}
              required
            />
          </Field>

          <Field label="Email" hint="Optional." error={errors.customerEmail}>
            <TextInput
              type="email"
              value={values.customerEmail}
              onChange={set("customerEmail")}
              invalid={!!errors.customerEmail}
              autoComplete="email"
              maxLength={200}
            />
          </Field>

          <Field label="Organisation" hint="Optional." error={errors.organization}>
            <TextInput value={values.organization} onChange={set("organization")} invalid={!!errors.organization} maxLength={160} />
          </Field>

          <Field label="Vehicle type" error={errors.vehicleCategoryId}>
            <Select value={values.vehicleCategoryId} onChange={set("vehicleCategoryId")} invalid={!!errors.vehicleCategoryId} required>
              <option value="">{opening ? "Loading the vehicle types..." : "Choose a vehicle type"}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Passengers" error={errors.passengers}>
            <TextInput
              type="number"
              min={1}
              max={100}
              value={values.passengers}
              onChange={set("passengers")}
              invalid={!!errors.passengers}
              inputMode="numeric"
              required
            />
          </Field>

          <Field label="First day" error={errors.startDate}>
            <TextInput type="date" value={values.startDate} onChange={set("startDate")} invalid={!!errors.startDate} required />
          </Field>

          <Field label="Last day" error={errors.endDate}>
            <TextInput type="date" value={values.endDate} onChange={set("endDate")} invalid={!!errors.endDate} required />
          </Field>

          <Field label="Pickup point" hint="Optional." error={errors.pickupLocation} className="sm:col-span-2">
            <TextInput value={values.pickupLocation} onChange={set("pickupLocation")} invalid={!!errors.pickupLocation} maxLength={160} />
          </Field>

          <Field label="Destination" hint="Optional." error={errors.dropoffLocation} className="sm:col-span-2">
            <TextInput value={values.dropoffLocation} onChange={set("dropoffLocation")} invalid={!!errors.dropoffLocation} maxLength={160} />
          </Field>

          <Field label="What is the vehicle for?" hint="Optional." error={errors.purpose} className="sm:col-span-2">
            <TextInput value={values.purpose} onChange={set("purpose")} invalid={!!errors.purpose} maxLength={300} />
          </Field>

          <Field label="Anything else the office should know?" hint="Optional." error={errors.notes} className="sm:col-span-2">
            <TextArea value={values.notes} onChange={set("notes")} invalid={!!errors.notes} maxLength={1000} rows={3} />
          </Field>

          {/* Off-screen rather than hidden: `display: none` is a signal to a form-filling script that
              the field is not worth completing. Hidden from people and from assistive technology;
              only a script fills it in. */}
          <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
            <label>
              Website
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy || opening}>
              {busy ? "Sending..." : "Send request"}
            </Button>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Sent straight to the office. Nothing is stored in this browser.
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
