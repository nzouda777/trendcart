import {
  complianceReportSchema,
  type ComplianceChecker,
  type IntegrationsMode,
} from "@/lib/domain/contracts";

import { createLiveComplianceChecker, type LiveComplianceOptions } from "./live";
import { screenPolicy } from "./policy-rules";
import { checkTechnical, overallVerdict } from "./technical";

export {
  checkAspectRatio,
  checkDuration,
  checkResolution,
  checkTechnical,
  overallVerdict,
  TECH_LIMITS,
} from "./technical";
export { POLICY_RULES, screenPolicy } from "./policy-rules";
export { POLICY_CATEGORIES, POLICY_CATEGORY_IDS, policyBriefText } from "./policy-brief";
export { mergeRuleResults, type RuleSource } from "./merge";
export {
  COMPLIANCE_BUDGET_MS,
  complianceInputSchema,
  createLiveComplianceChecker,
  type ComplianceCheckInput,
  type ComplianceInput,
  type LiveComplianceOptions,
} from "./live";

/** Deterministic checker: technical specs + keyword policy screen. No AI usage. */
export function createMockComplianceChecker(options: { now?: () => Date } = {}): ComplianceChecker {
  const now = options.now ?? (() => new Date());
  return {
    async check(_ctx, input) {
      const rules = [...checkTechnical(input), ...screenPolicy(input)];
      const data = complianceReportSchema.parse({
        overall: overallVerdict(rules),
        rules,
        checkedAt: now().toISOString(),
      });
      return { data, usage: [] };
    },
  };
}

/**
 * Registry factory (see lib/integrations/index.ts). Live: technical checks +
 * keyword screen + Gemini policy review (AI_COMPLIANCE_MODEL), worst verdict wins.
 */
export function createComplianceChecker(
  mode: IntegrationsMode,
  options?: LiveComplianceOptions,
): ComplianceChecker {
  return mode === "live" ? createLiveComplianceChecker(options) : createMockComplianceChecker();
}
