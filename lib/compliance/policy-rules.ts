/**
 * Keyword screen of caption and claims against TikTok ad policy categories
 * (pure, deterministic). The mock checker uses it as its "policy model"; the
 * live checker (M2) will run it as a fast pre-filter before the LLM check, so
 * an obvious violation never depends on a model call.
 *
 * Categories follow TikTok Advertising Policies: prohibited products,
 * restricted products, health/medical claims, misleading or exaggerated
 * claims, pricing claims, intellectual property, personal attributes.
 */
import type { ComplianceVerdict } from "@/lib/domain/contracts";

import type { ComplianceRule } from "./technical";

type PolicyRule = {
  ruleId: string;
  label: string;
  verdict: Exclude<ComplianceVerdict, "pass">;
  patterns: RegExp[];
  /** Also matched against the product category. */
  matchCategory?: boolean;
};

export const POLICY_RULES: PolicyRule[] = [
  {
    ruleId: "policy.prohibited_products",
    label: "prohibited product",
    verdict: "fail",
    matchCategory: true,
    patterns: [
      /\b(gun|firearm|ammo|ammunition|weapon|taser|stun gun|pepper spray|switchblade)s?\b/i,
      /\b(vape|e-?cig(arette)?|tobacco|nicotine|cigar(ette)?s?)\b/i,
      /\b(cbd|thc|cannabis|marijuana|kratom|drug paraphernalia)\b/i,
      /\b(sex toy|adult toy|lingerie|erotic)\b/i,
    ],
  },
  {
    ruleId: "policy.restricted_products",
    label: "restricted product category",
    verdict: "warn",
    matchCategory: true,
    patterns: [
      /\b(supplement|vitamin|gumm(y|ies)|protein powder|collagen)\b/i,
      /\b(weight[- ]?loss|slimming|fat burner|appetite)\b/i,
      /\b(alcohol|wine|beer|liquor)\b/i,
      /\b(contact lens(es)?|teeth whitening|hair growth|skin bleach(ing)?)\b/i,
    ],
  },
  {
    ruleId: "policy.health_claims",
    label: "medical or health claim",
    verdict: "fail",
    patterns: [
      /\b(cures?|heals?|treats?|prevents?)\b.{0,40}\b(pain|disease|anxiety|depression|insomnia|acne|cancer|diabetes|arthritis|infection)/i,
      /\b(lose|losing|drop)\s+\d+\s*(kg|lbs?|pounds|kilos)\b/i,
      /\b(burns? fat|detox(ify)?|boosts? (your )?immun(e|ity))\b/i,
      /\b(clinically|medically|doctor)[- ](proven|approved|recommended)\b/i,
      /\bfda[- ]approved\b/i,
    ],
  },
  {
    ruleId: "policy.misleading_claims",
    label: "absolute or exaggerated claim",
    verdict: "warn",
    patterns: [
      /\b100\s?%\s*(guaranteed|effective|results?|safe)\b/i,
      /\bguaranteed (results?|to work)\b/i,
      /\b(miracle|magic(al)? results?|instant results?|overnight results?)\b/i,
      /\b(best|#1|number one) in the world\b/i,
      /\brisk[- ]free\b/i,
    ],
  },
  {
    ruleId: "policy.pricing_claims",
    label: "pricing or free-offer claim",
    verdict: "warn",
    // "free" alone, not "BPA-free" / "hands-free" / "free shipping".
    patterns: [
      /(^|[^-\w])free\b(?!\s+(shipping|delivery|returns))/i,
      /\b\d{2}\s?% off\b/i,
      /\b(only|just) today\b/i,
      /\blast chance\b/i,
    ],
  },
  {
    ruleId: "policy.intellectual_property",
    label: "counterfeit or brand-infringing wording",
    verdict: "fail",
    patterns: [
      /\b(replica|counterfeit|knock-?off|fake (designer|brand))\b/i,
      /\b1:1 (copy|quality)\b/i,
    ],
  },
  {
    ruleId: "policy.personal_attributes",
    label: "targets personal attributes",
    verdict: "fail",
    patterns: [
      /\b(are|r) (you|u) (fat|overweight|ugly|bald|depressed|single)\b/i,
      /\btired of being (fat|ugly|bald|single)\b/i,
    ],
  },
];

export function screenPolicy(input: {
  caption: string;
  claims: string[];
  productCategory: string;
}): ComplianceRule[] {
  const text = [input.caption, ...input.claims].join("\n");
  return POLICY_RULES.map((rule) => {
    const haystacks = rule.matchCategory ? [text, input.productCategory] : [text];
    let hit: string | null = null;
    for (const h of haystacks) {
      for (const p of rule.patterns) {
        const m = h.match(p);
        if (m) {
          hit = m[0].trim();
          break;
        }
      }
      if (hit) break;
    }
    return hit
      ? {
          ruleId: rule.ruleId,
          kind: "policy" as const,
          verdict: rule.verdict,
          reason: `Possible ${rule.label}: "${hit}".`,
        }
      : {
          ruleId: rule.ruleId,
          kind: "policy" as const,
          verdict: "pass" as const,
          reason: `No ${rule.label} found.`,
        };
  });
}
