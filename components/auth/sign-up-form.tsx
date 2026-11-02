"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { AUTH_PATHS, safeNextPath } from "@/lib/auth/paths";

import { Field, FormError, FormNotice } from "./form-parts";

const MIN_PASSWORD = 10;

export function SignUpForm({ mockEmail }: { mockEmail: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    // After verification, invited users go back to their invite; others to the app.
    const next = safeNextPath(
      new URLSearchParams(window.location.search).get("next"),
      AUTH_PATHS.home,
    );

    setPending(true);
    setError(null);
    const { error: failure } = await authClient.signUp.email({
      name: String(form.get("name") ?? "").trim(),
      email,
      password,
      callbackURL: next,
    });
    setPending(false);

    if (failure) {
      setError(failure.message ?? "Could not create your account.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <FormNotice>
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1 text-muted-foreground">
          We sent a verification link to {sentTo}. Open it to activate your account.
          {mockEmail ? " Mock mode: the link is printed in the server console." : null}
        </p>
      </FormNotice>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field id="name" name="name" label="Full name" autoComplete="name" required autoFocus />
      <Field
        id="email"
        name="email"
        type="email"
        label="Work email"
        autoComplete="email"
        required
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={`At least ${MIN_PASSWORD} characters.`}
        required
      />
      <FormError message={error} />
      <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
