import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "../tms/service";
import { useTms } from "../tms/useTms";
import { Button, Field, Notice, TextInput } from "../ui/primitives";

function AuthFrame({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="rts-auth">
      <section className="rts-auth-poster" aria-label="Richie Transport Services">
        <div className="rts-auth-brand">
          <div className="rts-mark" aria-hidden="true">R</div>
          <div>
            <p className="rts-wordmark">
              Richie
              <span>TRANSPORT SERVICES · GHANA</span>
            </p>
          </div>
        </div>

        <div>
          <h2 className="rts-auth-headline">
            Run the fleet
            <br />
            <em>from one screen.</em>
          </h2>
          <p className="rts-auth-sub">
            Staff busing, vehicle hire and fleet logistics — from the request at the desk to the trip on the road,
            with every change attributed.
          </p>
        </div>

        <div className="rts-auth-meta">
          <span>STAFF BUSING</span>
          <span>BUS RENTALS</span>
          <span>STAFF LOGISTICS</span>
        </div>
      </section>

      <section className="rts-auth-side">
        <div className="rts-auth-card">
          <p className="rts-auth-eyebrow">{eyebrow}</p>
          <h1 className="rts-auth-title">{title}</h1>
          <p className="rts-auth-intro">{intro}</p>
          <div className="rts-auth-divider" aria-hidden="true" />
          {children}
          <p className="rts-auth-foot">
            Records are stored in PostgreSQL on this server, not in your browser. Every sign-in, change and
            export is written to an append-only audit log.
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
          <TextInput type="password" value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} invalid={!!errors.password} autoComplete="new-password" required />
        </Field>
        <Field label="Confirm password" error={errors.confirm}>
          <TextInput type="password" value={values.confirm} onChange={(e) => setValues({ ...values, confirm: e.target.value })} invalid={!!errors.confirm} autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" className="rts-btn--block py-2" disabled={busy}>
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
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Button type="submit" variant="primary" className="rts-btn--block py-2" disabled={busy}>
          {busy ? "Checking..." : "Sign in"}
        </Button>
        <p className="rts-auth-foot">Forgotten passwords are reset by an administrator from the Users screen. Self-service reset is not available.</p>
      </form>
    </AuthFrame>
  );
}
