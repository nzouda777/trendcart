"use client";

import { useState, useTransition } from "react";

import { FormError, FormSuccess, TextField } from "@/components/app/form-controls";
import type { ActionResult } from "@/components/app/action-result";
import { Button } from "@/components/ui/button";

const MIN = 12;

/** Changes the signed-in admin's own password (current password required). */
export function ChangePasswordForm({
  onChange,
}: {
  onChange: (input: { currentPassword: string; newPassword: string }) => Promise<ActionResult>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < MIN) return setError(`Use at least ${MIN} characters.`);
    if (next !== repeat) return setError("The two new passwords differ.");
    start(async () => {
      const result = await onChange({ currentPassword: current, newPassword: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(true);
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4">
      <TextField
        id="pw-current"
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextField
        id="pw-new"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint={`At least ${MIN} characters. Your other sessions are signed out.`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <TextField
        id="pw-repeat"
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        required
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
      />
      <FormError message={error} />
      <FormSuccess message={done ? "Password changed." : null} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
