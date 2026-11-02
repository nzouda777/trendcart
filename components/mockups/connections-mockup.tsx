import { Megaphone, Plus, Smartphone, Store } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { demoConnections, type ConnectionStatus } from "./data";
import { MockupFrame } from "./mockup-frame";
import { PanelLabel } from "./primitives";
import { StatusDot, type StatusTone } from "./status";

const statusTone: Record<ConnectionStatus, StatusTone> = {
  connected: "success",
  attention: "warning",
  error: "danger",
};

const statusText: Record<ConnectionStatus, string> = {
  connected: "Connected",
  // Same wording as the landing legend (`multiStore.statusLegend`).
  attention: "Needs attention",
  error: "Disconnected",
};

const statusColor: Record<ConnectionStatus, string> = {
  connected: "text-success",
  attention: "text-warning",
  error: "text-danger",
};

const groupIcon: Record<(typeof demoConnections)[number]["group"], ReactNode> = {
  "Shopify stores": <Store className="size-3" />,
  "TikTok profiles": <Smartphone className="size-3" />,
  "Ad accounts": <Megaphone className="size-3" />,
};

export type ConnectionsMockupProps = { className?: string };

/** Connections panel: stores, TikTok profiles and ad accounts with status dots. */
export function ConnectionsMockup({ className }: ConnectionsMockupProps) {
  const all = demoConnections.flatMap((g) => g.items);
  const counts = {
    connected: all.filter((c) => c.status === "connected").length,
    attention: all.filter((c) => c.status === "attention").length,
    error: all.filter((c) => c.status === "error").length,
  };

  return (
    <MockupFrame
      className={className}
      title="Connections"
      label={`Connections panel for Demo Store: Shopify stores, TikTok profiles and ad accounts. ${counts.connected} connected, ${counts.attention} needs attention, ${counts.error} disconnected.`}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {(Object.keys(counts) as ConnectionStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <StatusDot tone={statusTone[s]} />
                <span className="font-mono">{counts[s]}</span>
              </span>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Plus className="size-3" /> Connect
          </span>
        </div>

        {demoConnections.map((group) => (
          <div key={group.group}>
            <PanelLabel className="flex items-center gap-1.5">
              {groupIcon[group.group]} {group.group}
            </PanelLabel>
            <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {group.items.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center gap-2.5 bg-surface-2/40 px-2.5 py-1.5 text-[11px] sm:text-xs"
                >
                  <StatusDot tone={statusTone[item.status]} ring />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {item.meta}
                    </span>
                  </span>
                  <span
                    className={cn("shrink-0 text-[10px] font-medium", statusColor[item.status])}
                  >
                    {statusText[item.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </MockupFrame>
  );
}
