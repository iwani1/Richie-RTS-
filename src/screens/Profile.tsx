// AUTH-05: the signed-in person's own account.
//
// Two rules shape this screen. It only ever touches the caller's own record (the endpoint takes no
// id), and it says plainly what it cannot do: this installation keeps no address or device for a
// sign-in, so the history below answers "when did this account sign in", not "from where".
import { useEffect, useState, type FormEvent } from "react";
import { useTms } from "../tms/useTms";
import { Button, Field, Notice, PasswordInput, TextInput } from "../ui/primitives";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/tms/PageHeader";
import { Panel } from "@/components/tms/Panel";

interface SignIn {
  at: string;
}

export function ProfilePage() {
  const { currentUser, db, refresh, setFlash } = useTms();
  const [signIns, setSignIns] = useState<SignIn[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { ok?: boolean; signIns?: SignIn[]; message?: string } | null;
        if (cancelled) return;
        if (!response.ok || !body?.ok) {
          setHistoryError(body?.message ?? "Your sign-in history could not be read.");
          return;
        }
        setSignIns(body.signIns ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistoryError("Your sign-in history could not be read. The server did not answer.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const roleLabel = currentUser ? currentUser.role.replace("_", " ") : "";

  return (
    <div>
      <PageHeader
        kicker="My account"
        title="Your details and sign-in history"
        subtitle="Change your own name, email address and password. Another person's details are changed in Users, which needs an administrator."
        className="mb-4"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Your details" description="Your email address is how you sign in and how the company reaches you." bodyClassName="px-4 pb-4">
          <DetailsForm
            key={`${currentUser?.id ?? "none"}:${currentUser?.fullName ?? ""}:${currentUser?.email ?? ""}`}
            fullName={currentUser?.fullName ?? ""}
            email={currentUser?.email ?? ""}
            roleLabel={roleLabel}
            onSaved={refresh}
          />
        </Panel>

        <Panel title="Change your password" description="You need your current password. Other devices signed in to this account are signed out when it changes." bodyClassName="px-4 pb-4">
          <PasswordForm onChanged={() => setFlash({ tone: "success", message: "Your password was changed. Other devices will need to sign in again." })} />
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Recent sign-ins"
          description="The last ten times this account signed in. Recorded as part of the audit trail, which is append-only."
          bodyClassName="px-4 pb-4"
        >
          {historyError && <Notice tone="warning">{historyError}</Notice>}
          {!historyError && signIns === null && <p className="text-sm text-muted-foreground">Reading your sign-in history…</p>}
          {!historyError && signIns !== null && signIns.length === 0 && (
            <p className="text-sm text-muted-foreground">No sign-ins recorded yet. The first one is written the next time you sign in.</p>
          )}
          {!historyError && signIns !== null && signIns.length > 0 && (
            <>
              <ol className="divide-y divide-divider">
                {signIns.map((entry) => (
                  <li key={entry.at} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                    <span className="tms-mono text-foreground">{formatDateTime(entry.at)}</span>
                    <span className="text-xs text-muted-foreground">{entry.at === signIns[0].at ? "most recent" : ""}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                {db.users.length === 1
                  ? "Only account on this installation."
                  : "Address and device are not recorded, so a sign-in you do not recognise should be reported to an administrator rather than investigated here."}
              </p>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

function DetailsForm({
  fullName,
  email,
  roleLabel,
  onSaved,
}: {
  fullName: string;
  email: string;
  roleLabel: string;
  onSaved: () => Promise<void>;
}) {
  const { setFlash } = useTms();
  const [values, setValues] = useState({ fullName, email });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "details", ...values }),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; errors?: Record<string, string> } | null;
    setBusy(false);
    if (!response.ok || !body?.ok) {
      setErrors(body?.errors ?? {});
      setFlash({ tone: "error", message: body?.message ?? "Your details could not be saved." });
      return;
    }
    setErrors({});
    setFlash({ tone: "success", message: body.message ?? "Your profile was updated." });
    await onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Full name" error={errors.fullName}>
        <TextInput value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} invalid={!!errors.fullName} autoComplete="name" />
      </Field>
      <Field label="Email address" hint="Used to sign in." error={errors.email}>
        <TextInput type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} invalid={!!errors.email} autoComplete="email" />
      </Field>
      <Field label="Role" hint="Only an administrator can change this.">
        <p className="tms-mono text-foreground capitalize">{roleLabel}</p>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ onChanged }: { onChanged: () => void }) {
  const { setFlash } = useTms();
  const [values, setValues] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.newPassword !== values.confirm) {
      setErrors({ confirm: "The two new passwords do not match." });
      return;
    }
    setBusy(true);
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "password", currentPassword: values.currentPassword, newPassword: values.newPassword }),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; errors?: Record<string, string> } | null;
    setBusy(false);
    if (!response.ok || !body?.ok) {
      setErrors(body?.errors ?? {});
      setFlash({ tone: "error", message: body?.message ?? "Your password could not be changed." });
      return;
    }
    setValues({ currentPassword: "", newPassword: "", confirm: "" });
    setErrors({});
    onChanged();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Current password" error={errors.currentPassword}>
        <PasswordInput value={values.currentPassword} onChange={(e) => setValues({ ...values, currentPassword: e.target.value })} invalid={!!errors.currentPassword} autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 10 characters." error={errors.newPassword ?? errors.password}>
        <PasswordInput value={values.newPassword} onChange={(e) => setValues({ ...values, newPassword: e.target.value })} invalid={!!(errors.newPassword ?? errors.password)} autoComplete="new-password" />
      </Field>
      <Field label="Repeat the new password" error={errors.confirm}>
        <PasswordInput value={values.confirm} onChange={(e) => setValues({ ...values, confirm: e.target.value })} invalid={!!errors.confirm} autoComplete="new-password" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
