import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "../tms/service";
import { useTms } from "../tms/useTms";
import { Button, Field, Notice, PasswordInput, TextInput } from "../ui/primitives";

function AuthFrame({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* The brand half is a statement, not a form: it is the only screen in the product with room
          for one, and the light it carries is the accent at 10%, never a second colour. */}
      <section
        aria-label="Richie Transport Services"
        className="tms-aurora relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-11 lg:flex"
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-[11px] bg-primary text-[14px] font-bold text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
          >
            R
          </span>
          <div>
            <p className="text-[13px] font-semibold text-foreground">Richie</p>
            <p className="tms-mono text-[9.5px] text-dim">Transport Services · Ghana</p>
          </div>
        </div>

        <div className="relative">
          <h2 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] text-foreground">
            Run the fleet
            <br />
            <span className="text-primary">from one screen.</span>
          </h2>
          <p className="mt-4 max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
            Staff busing, vehicle hire and fleet logistics — from the request at the desk to the trip on the road,
            with every change attributed.
          </p>

          {/* A route drawn once, quietly: the thing the company actually sells. */}
          <svg aria-hidden="true" viewBox="0 0 320 80" className="mt-8 h-16 w-full max-w-sm" fill="none">
            <path d="M2 60 C 60 60, 70 18, 130 24 S 210 66, 250 44 S 300 22, 318 26" className="stroke-border" strokeWidth="1.5" strokeDasharray="1 5" />
            <path d="M2 60 C 60 60, 70 18, 130 24 S 210 66, 250 44 S 300 22, 318 26" className="stroke-primary/40" strokeWidth="1.5" strokeDasharray="44 400" strokeLinecap="round" />
            <circle cx="2" cy="60" r="3" className="fill-primary" />
            <circle cx="318" cy="26" r="3" className="fill-info" />
          </svg>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            {["Staff busing", "Bus rentals", "Staff logistics"].map((label) => (
              <span key={label} className="tms-mono text-[10px] text-dim">
                {label}
              </span>
            ))}
          </div>
        </div>

        <p className="tms-mono text-[10px] text-dim">
          Records live in PostgreSQL · every change is audit-logged
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-[10px] bg-primary text-[13px] font-bold text-primary-foreground"
            >
              R
            </span>
            <div>
              <p className="text-[13px] font-semibold text-foreground">Richie</p>
              <p className="tms-mono text-[9.5px] text-dim">Transport Services</p>
            </div>
          </div>

          <p className="tms-mono text-primary">{eyebrow}</p>
          <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{intro}</p>
          <div aria-hidden="true" className="mt-5 mb-5 h-px bg-divider" />
          {children}
          <p className="mt-6 border-t border-divider pt-4 text-[11.5px] leading-relaxed text-dim">
            Records are stored in PostgreSQL on this server, not in your browser. Every sign-in, change and export is
            written to an append-only audit log.
          </p>
        </div>
      </section>
    </div>
  );
}

export function SetupPage() {
  const { setupAdministrator } = useTms();
  const [values, setValues] = useState({ fullName: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (values.password !== values.confirm) {
      setErrors({ confirm: "Passwords do not match." });
      return;
    }
    setBusy(true);
    const result = await setupAdministrator(values.fullName, values.email, values.password);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      setMessage(result.message);
    }
  };

  return (
    <AuthFrame
      eyebrow="First run · no accounts"
      title="Create the first administrator"
      intro="No user accounts exist yet. This account will own system settings and user management. It is created once, here, and cannot be created again over the web."
    >
      <form onSubmit={submit} className="space-y-4">
        {message && <Notice tone="error">{message}</Notice>}
        <Field label="Full name" error={errors.fullName}>
          <TextInput value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} invalid={!!errors.fullName} autoComplete="name" required />
        </Field>
        <Field label="Email" error={errors.email}>
          <TextInput type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} invalid={!!errors.email} autoComplete="username" required />
        </Field>
        <Field label="Password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} error={errors.password}>
          <PasswordInput value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} invalid={!!errors.password} autoComplete="new-password" required />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <PasswordInput value={values.confirm} onChange={(e) => setValues({ ...values, confirm: e.target.value })} invalid={!!errors.confirm} autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" className="tms-sheen h-10 w-full" disabled={busy}>
          {busy ? "Creating account..." : "Create administrator"}
        </Button>
      </form>
    </AuthFrame>
  );
}

export function SignInPage() {
  const { signIn } = useTms();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  };

  return (
    <AuthFrame eyebrow="Access" title="Sign in" intro="Use the account an administrator created for you.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button type="submit" variant="primary" className="tms-sheen h-10 w-full" disabled={busy}>
          {busy ? "Checking..." : "Sign in"}
        </Button>
        <p className="text-[11.5px] leading-relaxed text-dim">Forgotten passwords are reset by an administrator from the Users screen. Self-service reset is not available.</p>
      </form>
    </AuthFrame>
  );
}
