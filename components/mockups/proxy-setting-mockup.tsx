import { Globe, Network } from "lucide-react";

import { cn } from "@/lib/utils";

import { demoProxies } from "./data";
import { MockupFrame } from "./mockup-frame";
import { PanelLabel } from "./primitives";
import { StatusBadge } from "./status";

function FakeSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-brand" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "absolute size-3 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

export type ProxySettingMockupProps = { className?: string };

/** Optional proxy per brand. */
export function ProxySettingMockup({ className }: ProxySettingMockupProps) {
  const active = demoProxies.filter((p) => p.enabled).length;
  return (
    <MockupFrame
      className={className}
      title="Proxy"
      label={`Per-brand proxy settings: ${active} of ${demoProxies.length} brands route their activity through their own proxy, the other uses a direct connection.`}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <PanelLabel className="flex items-center gap-1.5">
            <Network className="size-3" /> Proxy per brand
          </PanelLabel>
          <span className="font-mono text-[10px] text-muted-foreground">Optional</span>
        </div>
        <ul className="space-y-1.5">
          {demoProxies.map((p) => (
            <li
              key={p.brand}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/40 px-2.5 py-2 text-[11px] sm:text-xs"
            >
              <Globe
                className={cn(
                  "size-3.5 shrink-0",
                  p.enabled ? "text-brand-text" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.brand}</span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {p.enabled ? p.endpoint : "Direct connection"}
                </span>
              </span>
              {p.enabled ? (
                <StatusBadge tone="success" className="hidden sm:inline-flex">
                  {p.region}
                </StatusBadge>
              ) : null}
              <FakeSwitch on={p.enabled} />
            </li>
          ))}
        </ul>
      </div>
    </MockupFrame>
  );
}
