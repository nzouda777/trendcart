"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { safeNextPath } from "@/lib/auth/paths";

import { Field, FormError, FormNotice } from "./form-parts";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    setPending(true);
    setError(null);
    setNotice(null);

    const { data, error: failure } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      callbackURL: next,
    });
    setPending(false);

    if (failure) {
      if (failure.status === 403) {
        setNotice("Verify your email first. We just sent you a new verification link.");
      } else {
        setError(failure.message ?? "Could not sign in. Check your email and password.");
      }
      return;
    }
    // With 2FA on, the client plugin redirects to the code page instead.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        autoFocus
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <FormError message={error} />
      {notice ? <FormNotice>{notice}</FormNotice> : null}
      <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
