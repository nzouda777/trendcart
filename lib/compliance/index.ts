import {
  complianceReportSchema,
  type ComplianceChecker,
  type IntegrationsMode,
} from "@/lib/domain/contracts";
import { notImplemented } from "@/lib/ai/not-implemented";

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

/** Registry factory (see lib/integrations/index.ts). Live LLM policy check lands in M2. */
export function createComplianceChecker(mode: IntegrationsMode): ComplianceChecker {
  if (mode === "mock") return createMockComplianceChecker();
  return {
    async check() {
      throw notImplemented("google", "Compliance check");
    },
  };
}
