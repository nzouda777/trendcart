import { ChevronDown, ShieldCheck, UserPlus } from "lucide-react";

import { cn } from "@/lib/utils";

import { demoTeam, type TeamRole } from "./data";
import { MockupFrame } from "./mockup-frame";
import { PanelLabel } from "./primitives";
import { StatusBadge } from "./status";

const roleStyle: Record<TeamRole, string> = {
  Owner: "border-brand-border bg-brand-soft text-brand-text",
  Admin: "border-border-strong bg-surface-2 text-foreground",
  Editor: "border-border bg-surface-2 text-foreground",
  Viewer: "border-border bg-surface-2 text-muted-foreground",
};

export type TeamMockupProps = { className?: string };

/** Team members with roles and 2FA state. */
export function TeamMockup({ className }: TeamMockupProps) {
  return (
    <MockupFrame
      className={className}
      title="Team"
      label={`Team settings: ${demoTeam.length} sample members with Owner, Admin, Editor and Viewer roles, and two-factor authentication status.`}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel>Members · {demoTeam.length}</PanelLabel>
          <span className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-0.5 text-[10px] font-medium text-brand-foreground">
            <UserPlus className="size-3" /> Invite
          </span>
        </div>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {demoTeam.map((m) => (
            <li
              key={m.email}
              className="flex items-center gap-2.5 bg-surface-2/40 px-2.5 py-2 text-[11px] sm:text-xs"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold ring-1 ring-border">
                {m.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {m.email}
                </span>
              </span>
              {m.twoFa ? (
                <span className="hidden items-center gap-1 text-[10px] text-success sm:inline-flex">
                  <ShieldCheck className="size-3.5" /> 2FA
                </span>
              ) : (
                <StatusBadge tone="warning" className="hidden sm:inline-flex">
                  2FA off
                </StatusBadge>
              )}
              <span
                className={cn(
                  "inline-flex w-[4.5rem] shrink-0 items-center justify-between gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                  roleStyle[m.role],
                )}
              >
                {m.role}
                <ChevronDown className="size-3 opacity-60" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </MockupFrame>
  );
}
