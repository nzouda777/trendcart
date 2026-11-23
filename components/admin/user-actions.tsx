"use client";

import {
  BadgeCheckIcon,
  BanIcon,
  EyeIcon,
  KeyRoundIcon,
  LogOutIcon,
  ShieldIcon,
  ShieldOffIcon,
  SmartphoneIcon,
  Trash2Icon,
} from "lucide-react";

import type { ActionResult } from "@/components/app/action-result";

import { ActionButton } from "./action-button";

type Fn = (userId: string) => Promise<ActionResult>;
type FnWith = (userId: string, value: string) => Promise<ActionResult>;

/** Every admin action on one user, each behind a confirmation. */
export function UserActions({
  user,
  isSelf,
  actions,
}: {
  user: {
    id: string;
    email: string;
    role: string | null;
    banned: boolean;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
  };
  isSelf: boolean;
  actions: {
    ban: FnWith;
    unban: Fn;
    revoke: Fn;
    password: FnWith;
    verify: Fn;
    disable2fa: Fn;
    setAdmin: (userId: string, isAdmin: boolean) => Promise<ActionResult>;
    remove: Fn;
    impersonate: Fn;
  };
}) {
  const isAdmin = user.role === "admin";
  return (
    <div className="flex flex-wrap gap-1.5">
      {!isSelf && !isAdmin ? (
        <ActionButton
          label="Impersonate"
          variant="ghost"
          icon={<EyeIcon aria-hidden="true" />}
          title={`Sign in as ${user.email}?`}
          description="You see the app as this user for up to 1 hour. It is recorded. Use “Stop impersonating” in the banner to come back."
          onConfirm={() => actions.impersonate(user.id)}
        />
      ) : null}
      {!isSelf ? (
        user.banned ? (
          <ActionButton
            label="Unban"
            variant="ghost"
            icon={<BanIcon aria-hidden="true" />}
            title={`Unban ${user.email}?`}
            description="The user can sign in again."
            onConfirm={() => actions.unban(user.id)}
          />
        ) : (
          <ActionButton
            label="Ban"
            variant="ghost"
            destructive
            icon={<BanIcon aria-hidden="true" />}
            title={`Ban ${user.email}?`}
            description="The user is signed out everywhere and cannot sign in until unbanned."
            input={{ label: "Reason", placeholder: "Optional" }}
            onConfirm={(v) => actions.ban(user.id, v)}
          />
        )
      ) : null}
      <ActionButton
        label="Sign out everywhere"
        variant="ghost"
        icon={<LogOutIcon aria-hidden="true" />}
        title={`End all sessions of ${user.email}?`}
        description="Every device is signed out."
        onConfirm={() => actions.revoke(user.id)}
      />
      <ActionButton
        label="Set password"
        variant="ghost"
        icon={<KeyRoundIcon aria-hidden="true" />}
        title={`Set a new password for ${user.email}?`}
        description="Share it securely. The user's sessions end."
        input={{ label: "New password (10+ characters)", type: "password", required: true }}
        onConfirm={(v) => actions.password(user.id, v)}
      />
      {!user.emailVerified ? (
        <ActionButton
          label="Mark email verified"
          variant="ghost"
          icon={<BadgeCheckIcon aria-hidden="true" />}
          title={`Mark ${user.email} as verified?`}
          description="Use it only when you confirmed the address another way."
          onConfirm={() => actions.verify(user.id)}
        />
      ) : null}
      {user.twoFactorEnabled ? (
        <ActionButton
          label="Reset 2FA"
          variant="ghost"
          icon={<SmartphoneIcon aria-hidden="true" />}
          title={`Turn off two-factor for ${user.email}?`}
          description="For a user who lost their authenticator. They can set it up again."
          onConfirm={() => actions.disable2fa(user.id)}
        />
      ) : null}
      {!isSelf ? (
        <ActionButton
          label={isAdmin ? "Remove admin" : "Make admin"}
          variant="ghost"
          destructive={!isAdmin}
          icon={isAdmin ? <ShieldOffIcon aria-hidden="true" /> : <ShieldIcon aria-hidden="true" />}
          title={
            isAdmin
              ? `Remove admin rights from ${user.email}?`
              : `Make ${user.email} a platform admin?`
          }
          description={
            isAdmin
              ? "They lose access to /admin."
              : "They get full access to /admin: every workspace, user, plan and payment setting."
          }
          onConfirm={() => actions.setAdmin(user.id, !isAdmin)}
        />
      ) : null}
      {!isSelf ? (
        <ActionButton
          label="Delete"
          variant="ghost"
          destructive
          icon={<Trash2Icon aria-hidden="true" />}
          title={`Delete ${user.email}?`}
          description="The account and its sessions are removed. Workspaces stay; if this user is the only owner, give another member the Owner role first."
          onConfirm={() => actions.remove(user.id)}
        />
      ) : null}
    </div>
  );
}
