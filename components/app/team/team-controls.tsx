"use client";

import { MailPlusIcon, UserMinusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "../confirm-dialog";
import { FormError, FormSuccess, selectClass, TextField } from "../form-controls";
import { formatDate } from "../format";

/*
 * Team management through Better Auth's organization client. The server
 * re-checks the caller (owner) and validates roles in its hooks, which also
 * write the audit log.
 */

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

function errorText(error: { message?: string; statusText?: string } | null | undefined) {
  return error?.message || error?.statusText || "Something went wrong. Try again.";
}

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>("creative");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) return;
    setError(null);
    setSent(null);
    startTransition(async () => {
      const { error: failure } = await authClient.organization.inviteMember({
        email,
        role,
        organizationId: workspaceId,
        resend: true,
      });
      if (failure) {
        setError(errorText(failure));
        return;
      }
      form.reset();
      setSent(`Invitation sent to ${email}.`);
      window.dispatchEvent(new Event("tc:invitations-changed"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <TextField
          id="invite-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="off"
          required
          maxLength={254}
          disabled={pending}
        />
        <div className="grid content-start gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.currentTarget.value as Role)}
            disabled={pending}
            aria-describedby="invite-role-hint"
            className={selectClass}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id="invite-role-hint" className="-mt-2 text-xs text-muted-foreground">
        {ROLE_LABELS[role]}: {ROLE_DESCRIPTIONS[role]}
      </p>
      <FormError message={error} />
      <FormSuccess message={sent} />
      <div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          <MailPlusIcon aria-hidden="true" />
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}

export function MemberRoleSelect({
  memberId,
  name,
  role,
  workspaceId,
}: {
  memberId: string;
  name: string;
  role: Role;
  workspaceId: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Role>(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `role-${memberId}`;

  function change(next: Role) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const { error: failure } = await authClient.organization.updateMemberRole({
        memberId,
        role: next,
        organizationId: workspaceId,
      });
      if (failure) {
        setValue(previous);
        setError(errorText(failure));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="sr-only">
        Role of {name}
      </label>
      <select
        id={id}
        value={value}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => change(e.currentTarget.value as Role)}
        className={cn(selectClass, "h-8 w-40")}
      >
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RemoveMemberButton({
  memberId,
  name,
  workspaceId,
}: {
  memberId: string;
  name: string;
  workspaceId: string;
}) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" className="text-danger hover:text-danger">
          <UserMinusIcon aria-hidden="true" />
          <span className="sr-only">Remove {name}</span>
        </Button>
      }
      title={`Remove ${name}?`}
      description="They lose access to this workspace right away. Their past approvals stay in the audit log."
      confirmLabel="Remove member"
      pendingLabel="Removing…"
      destructive
      onConfirm={async () => {
        const { error } = await authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: workspaceId,
        });
        return error
          ? { ok: false, code: "forbidden", error: errorText(error) }
          : { ok: true, data: undefined };
      }}
      onSuccess={() => router.refresh()}
    />
  );
}

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date | string;
};

/** Pending invitations (owner only), loaded client-side from Better Auth. */
export function PendingInvitations({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: failure } = await authClient.organization.listInvitations({
      query: { organizationId: workspaceId },
    });
    if (failure) {
      setError(errorText(failure));
      setItems([]);
      return;
    }
    setError(null);
    setItems(((data ?? []) as Invitation[]).filter((i) => i.status === "pending"));
  }, [workspaceId]);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void load();
    };
    run();
    window.addEventListener("tc:invitations-changed", run);
    return () => {
      active = false;
      window.removeEventListener("tc:invitations-changed", run);
    };
  }, [load]);

  if (items === null) {
    return (
      <div aria-hidden="true" className="h-12 rounded-xl bg-surface-2 motion-safe:animate-pulse" />
    );
  }
  if (error) return <FormError message={error} />;
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No pending invitations.</p>;
  }
  return (
    <ul className="grid gap-2" aria-label="Pending invitations">
      {items.map((inv) => {
        const label = ROLE_LABELS[inv.role as Role] ?? inv.role;
        return (
          <li
            key={inv.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{inv.email}</p>
              <p className="text-xs text-muted-foreground">
                {label} · Expires {formatDate(new Date(inv.expiresAt).toISOString())}
              </p>
            </div>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  Cancel invitation<span className="sr-only"> for {inv.email}</span>
                </Button>
              }
              title={`Cancel the invitation for ${inv.email}?`}
              description="The invitation link stops working. You can invite them again later."
              confirmLabel="Cancel invitation"
              pendingLabel="Cancelling…"
              destructive
              onConfirm={async () => {
                const { error: failure } = await authClient.organization.cancelInvitation({
                  invitationId: inv.id,
                });
                return failure
                  ? { ok: false, code: "forbidden", error: errorText(failure) }
                  : { ok: true, data: undefined };
              }}
              onSuccess={() => void load()}
            />
          </li>
        );
      })}
    </ul>
  );
}
