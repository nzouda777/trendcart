"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { safeNextPath } from "@/lib/auth/paths";

import { Field, FormError } from "./form-parts";

/** Second sign-in step: a TOTP code, or a backup code. */
export function TwoFactorForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    setPending(true);
    setError(null);

    const { error: failure } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    setPending(false);

    if (failure) {
      setError(failure.message ?? "That code did not work. Try again.");
      return;
    }
    router.push(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {mode === "totp" ? (
        <Field
          key="totp"
          id="code"
          name="code"
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          hint="The 6-digit code from your authenticator app."
          required
          autoFocus
        />
      ) : (
        <Field
          key="backup"
          id="code"
          name="code"
          label="Backup code"
          autoComplete="one-time-code"
          hint="One of the backup codes you saved when you turned on two-factor."
          required
          autoFocus
        />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="trust" className="size-4 accent-[var(--brand)]" />
        Trust this device for 30 days
      </label>
      <FormError message={error} />
      <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
      <Button
        type="button"
        variant="link"
        onClick={() => {
          setMode(mode === "totp" ? "backup" : "totp");
          setError(null);
        }}
      >
        {mode === "totp" ? "Use a backup code instead" : "Use an authenticator code instead"}
      </Button>
    </form>
  );
}
