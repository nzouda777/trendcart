"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { BrandProxyDTO } from "@/lib/services/types";

import type { ActionResult } from "../action-result";
import { ConfirmDialog } from "../confirm-dialog";
import { FormError, FormSuccess, TextField } from "../form-controls";

/**
 * Brand proxy. The full URL (with credentials) is write-only: it is typed in,
 * sent to the server, encrypted there, and only "scheme://host:port" comes back.
 */
export function ProxyPanel({
  proxy,
  canEdit,
  onSet,
  onToggle,
  onClear,
}: {
  proxy: BrandProxyDTO;
  canEdit: boolean;
  onSet: (url: string) => Promise<ActionResult>;
  onToggle: (enabled: boolean) => Promise<ActionResult>;
  onClear: () => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(!proxy.configured);

  function run(fn: () => Promise<ActionResult>, success: string, after?: () => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.fieldErrors?.url?.[0] ?? result.error);
        return;
      }
      setNotice(success);
      after?.();
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const url = String(new FormData(form).get("url") ?? "").trim();
    if (!url) return;
    run(
      () => onSet(url),
      "Proxy saved.",
      () => {
        form.reset();
        setEditing(false);
      },
    );
  }

  return (
    <div className="grid gap-4">
      {proxy.configured ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Proxy host</p>
            <p className="truncate font-mono text-sm">
              {proxy.display ?? "Stored (host unreadable, replace it)"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="proxy-enabled" className="text-sm">
              {proxy.enabled ? "Enabled" : "Disabled"}
            </label>
            <Switch
              id="proxy-enabled"
              checked={proxy.enabled}
              disabled={!canEdit || pending}
              onCheckedChange={(on) =>
                run(() => onToggle(on), on ? "Proxy enabled." : "Proxy disabled.")
              }
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No proxy. Requests for this brand go out directly.
        </p>
      )}

      {canEdit && editing ? (
        <form onSubmit={submit} className="grid gap-3">
          <TextField
            id="proxy-url"
            name="url"
            label={proxy.configured ? "New proxy URL" : "Proxy URL"}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://user:password@host:port"
            required
            maxLength={2048}
            disabled={pending}
            hint="http, https or socks5. Stored encrypted; only the host is shown afterwards."
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
              {pending ? "Saving…" : "Save proxy"}
            </Button>
            {proxy.configured ? (
              <Button type="button" variant="ghost" size="lg" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {canEdit && proxy.configured && !editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => setEditing(true)} disabled={pending}>
            Replace proxy
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="lg" className="text-danger hover:text-danger">
                Remove proxy
              </Button>
            }
            title="Remove the proxy?"
            description="The stored proxy URL is deleted. Requests for this brand will go out directly."
            confirmLabel="Remove proxy"
            pendingLabel="Removing…"
            destructive
            onConfirm={onClear}
            onSuccess={() => {
              setNotice("Proxy removed.");
              setEditing(true);
            }}
          />
        </div>
      ) : null}

      <FormError message={error} />
      <FormSuccess message={notice} />
    </div>
  );
}
