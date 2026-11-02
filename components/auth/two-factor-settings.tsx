"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

import { Field, FormError, FormNotice } from "./form-parts";

type Enrollment = { totpURI: string; secret: string | null; backupCodes: string[] };

function secretFrom(uri: string) {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Turn TOTP two-factor on (password → scan → confirm code) or off. */
export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const { data, error: failure } = await authClient.twoFactor.enable({
      password,
      method: "totp",
    });
    setPending(false);
    if (failure || !data || data.method !== "totp") {
      setError(failure?.message ?? "Could not start two-factor setup.");
      return;
    }
    setEnrollment({
      totpURI: data.totpURI,
      secret: secretFrom(data.totpURI),
      backupCodes: data.backupCodes,
    });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (failure) {
      setError(failure.message ?? "That code did not work. Try again.");
      return;
    }
    setEnrollment(null);
    setDone("Two-factor authentication is on.");
    router.refresh();
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (failure) {
      setError(failure.message ?? "Could not turn off two-factor.");
      return;
    }
    setDone("Two-factor authentication is off.");
    router.refresh();
  }

  if (enrollment) {
    return (
      <div className="grid gap-5">
        <ol className="grid list-decimal gap-3 pl-5 text-sm">
          <li>
            Add an account in your authenticator app with this setup key:
            <code className="mt-1.5 block rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm break-all select-all">
              {enrollment.secret ?? enrollment.totpURI}
            </code>
            <details className="mt-1.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Show the full otpauth link</summary>
              <code className="mt-1 block font-mono break-all select-all">
                {enrollment.totpURI}
              </code>
            </details>
          </li>
          <li>
            Save these backup codes somewhere safe. Each works once if you lose your device.
            <ul className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-background p-3 font-mono text-sm">
              {enrollment.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </li>
          <li>Enter the 6-digit code your app shows to finish.</li>
        </ol>
        <form onSubmit={confirm} className="grid gap-4">
          <Field
            id="code"
            name="code"
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
          />
          <FormError message={error} />
          <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
            {pending ? "Verifying…" : "Turn on two-factor"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {done ? <FormNotice>{done}</FormNotice> : null}
      <form onSubmit={enabled ? disable : start} className="grid gap-4">
        <Field
          id="password"
          name="password"
          type="password"
          label="Confirm your password"
          autoComplete="current-password"
          required
        />
        <FormError message={error} />
        <Button
          type="submit"
          size="lg"
          variant={enabled ? "outline" : "default"}
          disabled={pending}
          aria-busy={pending}
        >
          {enabled ? "Turn off two-factor" : "Set up two-factor"}
        </Button>
      </form>
    </div>
  );
}
