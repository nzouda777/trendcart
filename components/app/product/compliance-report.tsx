import { CircleAlertIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";

import type { ComplianceReport, ComplianceVerdict } from "@/lib/domain/contracts";
import { cn } from "@/lib/utils";

import { Pill } from "../badges";
import type { StatusTone } from "../product-status";
import { formatDateTime } from "../format";

export const VERDICT_META: Record<
  ComplianceVerdict,
  { label: string; tone: StatusTone; ruleLabel: string }
> = {
  pass: { label: "Meets ad rules", tone: "success", ruleLabel: "Pass" },
  warn: { label: "Check warnings", tone: "action", ruleLabel: "Warning" },
  fail: { label: "Breaks ad rules", tone: "danger", ruleLabel: "Fail" },
};

const ORDER: Record<ComplianceVerdict, number> = { fail: 0, warn: 1, pass: 2 };

function VerdictIcon({ verdict }: { verdict: ComplianceVerdict }) {
  const Icon =
    verdict === "pass" ? CircleCheckIcon : verdict === "warn" ? CircleAlertIcon : CircleXIcon;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "mt-0.5 size-4 shrink-0",
        verdict === "pass" && "text-brand-text",
        verdict === "warn" && "text-warning",
        verdict === "fail" && "text-danger",
      )}
    />
  );
}

/**
 * Overall verdict plus an expandable list of every rule with its verdict and
 * reason (failures first). Native <details>: keyboard and screen-reader
 * friendly without client code.
 */
export function ComplianceReportView({ report }: { report: ComplianceReport }) {
  const meta = VERDICT_META[report.overall];
  const rules = [...report.rules].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
  const flagged = rules.filter((r) => r.verdict !== "pass").length;
  return (
    <div className="grid gap-2">
      <Pill tone={meta.tone} className="w-fit">
        {meta.label}
      </Pill>
      <details className="group rounded-lg border border-border bg-surface text-xs">
        <summary className="cursor-pointer rounded-lg px-2.5 py-1.5 text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          {rules.length} rule{rules.length === 1 ? "" : "s"} checked
          {flagged > 0 ? `, ${flagged} flagged` : ""}
        </summary>
        <ul className="grid gap-2 border-t border-border px-2.5 py-2">
          {rules.map((r) => (
            <li key={r.ruleId} className="flex gap-2">
              <VerdictIcon verdict={r.verdict} />
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  <span className="sr-only">{VERDICT_META[r.verdict].ruleLabel}: </span>
                  {r.ruleId}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {r.kind === "technical" ? "Technical" : "Policy"}
                  </span>
                </p>
                <p className="text-pretty text-muted-foreground">{r.reason}</p>
              </div>
            </li>
          ))}
          <li className="text-muted-foreground">Checked {formatDateTime(report.checkedAt)}</li>
        </ul>
      </details>
    </div>
  );
}
