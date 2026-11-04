/**
 * Deterministic merge of rule results from several reviewers (pure).
 *
 * For each ruleId the worst verdict wins (fail > warn > pass), whichever
 * source produced it, so the LLM can add findings but never clear one found
 * by the keyword screen. Rules keep the order of their first appearance.
 */
import type { ComplianceVerdict } from "@/lib/domain/contracts";

import type { ComplianceRule } from "./technical";

const RANK: Record<ComplianceVerdict, number> = { pass: 0, warn: 1, fail: 2 };

export type RuleSource = {
  /** Shown before each finding, e.g. "Keyword screen", "AI review". */
  label: string;
  rules: ComplianceRule[];
};

/** Max length of a merged reason (stored in video.compliance json). */
export const MAX_REASON_CHARS = 600;

const clip = (s: string) =>
  s.length > MAX_REASON_CHARS ? `${s.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : s;

export function mergeRuleResults(sources: RuleSource[]): ComplianceRule[] {
  type Entry = { rule: ComplianceRule; findings: { label: string; rule: ComplianceRule }[] };
  const byId = new Map<string, Entry>();

  for (const source of sources) {
    for (const rule of source.rules) {
      const entry = byId.get(rule.ruleId);
      if (!entry) {
        byId.set(rule.ruleId, { rule, findings: [{ label: source.label, rule }] });
        continue;
      }
      entry.findings.push({ label: source.label, rule });
    }
  }

  return [...byId.values()].map(({ rule, findings }) => {
    const worst = findings.reduce(
      (w, f) => (RANK[f.rule.verdict] > RANK[w] ? f.rule.verdict : w),
      "pass" as ComplianceVerdict,
    );
    if (findings.length === 1) return { ...rule, verdict: worst, reason: clip(rule.reason) };

    let reason: string;
    if (worst === "pass") {
      // Every source passed: the last source (the most detailed review) explains.
      reason = findings.at(-1)!.rule.reason;
    } else {
      // Every non-pass finding, worst first, with its source.
      reason = findings
        .filter((f) => f.rule.verdict !== "pass")
        .sort((a, b) => RANK[b.rule.verdict] - RANK[a.rule.verdict])
        .map((f) => `${f.label}: ${f.rule.reason}`)
        .join(" ");
    }
    return { ruleId: rule.ruleId, kind: rule.kind, verdict: worst, reason: clip(reason) };
  });
}
