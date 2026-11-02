/**
 * Technical checks against TikTok in-feed ad video specs (pure).
 *
 * TikTok Ads Manager accepts 9:16, 1:1 and 16:9 videos; 9:16 is the native
 * in-feed format. Minimum resolution 540×960 (vertical), 640×640 (square),
 * 960×540 (horizontal); 720p or more recommended. Duration 5 s to 10 min is
 * accepted; 9 to 60 s is what TikTok recommends for in-feed ads.
 */
import type { ComplianceReport, ComplianceVerdict } from "@/lib/domain/contracts";

export type ComplianceRule = ComplianceReport["rules"][number];

export const TECH_LIMITS = {
  minDurationSec: 5,
  maxDurationSec: 600,
  recommendedMaxDurationSec: 60,
  minShortSidePx: 540,
  minSquarePx: 640,
  recommendedShortSidePx: 720,
  ratioTolerance: 0.03,
} as const;

const RATIOS = [
  { label: "9:16", value: 9 / 16, verdict: "pass" as const },
  { label: "1:1", value: 1, verdict: "warn" as const },
  { label: "16:9", value: 16 / 9, verdict: "warn" as const },
];

export function checkDuration(durationSec: number): ComplianceRule {
  const d = Math.round(durationSec * 10) / 10;
  if (!Number.isFinite(durationSec) || durationSec < TECH_LIMITS.minDurationSec) {
    return {
      ruleId: "tech.duration",
      kind: "technical",
      verdict: "fail",
      reason: `Video is ${d}s; TikTok ads need at least ${TECH_LIMITS.minDurationSec}s.`,
    };
  }
  if (durationSec > TECH_LIMITS.maxDurationSec) {
    return {
      ruleId: "tech.duration",
      kind: "technical",
      verdict: "fail",
      reason: `Video is ${d}s; TikTok ads accept at most 10 minutes.`,
    };
  }
  if (durationSec > TECH_LIMITS.recommendedMaxDurationSec) {
    return {
      ruleId: "tech.duration",
      kind: "technical",
      verdict: "warn",
      reason: `Video is ${d}s; in-feed ads perform best between 9 and 60 seconds.`,
    };
  }
  return {
    ruleId: "tech.duration",
    kind: "technical",
    verdict: "pass",
    reason: `Duration ${d}s is within TikTok ad limits.`,
  };
}

export function aspectLabel(width: number, height: number): string | null {
  const ratio = width / height;
  const match = RATIOS.find(
    (r) => Math.abs(ratio - r.value) / r.value <= TECH_LIMITS.ratioTolerance,
  );
  return match?.label ?? null;
}

export function checkAspectRatio(width: number, height: number): ComplianceRule {
  const ratio = width / height;
  const match = RATIOS.find(
    (r) => Math.abs(ratio - r.value) / r.value <= TECH_LIMITS.ratioTolerance,
  );
  if (!match) {
    return {
      ruleId: "tech.aspect_ratio",
      kind: "technical",
      verdict: "fail",
      reason: `Aspect ratio ${width}×${height} is not supported; use 9:16, 1:1 or 16:9.`,
    };
  }
  if (match.verdict === "warn") {
    return {
      ruleId: "tech.aspect_ratio",
      kind: "technical",
      verdict: "warn",
      reason: `${match.label} is accepted, but 9:16 is the native in-feed format.`,
    };
  }
  return {
    ruleId: "tech.aspect_ratio",
    kind: "technical",
    verdict: "pass",
    reason: "Vertical 9:16 video.",
  };
}

export function checkResolution(width: number, height: number): ComplianceRule {
  const short = Math.min(width, height);
  const square = aspectLabel(width, height) === "1:1";
  const min = square ? TECH_LIMITS.minSquarePx : TECH_LIMITS.minShortSidePx;
  if (short < min) {
    return {
      ruleId: "tech.resolution",
      kind: "technical",
      verdict: "fail",
      reason: `${width}×${height} is below the ${square ? "640×640" : "540×960"} minimum.`,
    };
  }
  if (short < TECH_LIMITS.recommendedShortSidePx) {
    return {
      ruleId: "tech.resolution",
      kind: "technical",
      verdict: "warn",
      reason: `${width}×${height} is accepted; 720p or higher is recommended.`,
    };
  }
  return {
    ruleId: "tech.resolution",
    kind: "technical",
    verdict: "pass",
    reason: `${width}×${height} meets TikTok's resolution guidance.`,
  };
}

export function checkTechnical(input: {
  durationSec: number;
  width: number;
  height: number;
}): ComplianceRule[] {
  return [
    checkDuration(input.durationSec),
    checkAspectRatio(input.width, input.height),
    checkResolution(input.width, input.height),
  ];
}

const RANK: Record<ComplianceVerdict, number> = { pass: 0, warn: 1, fail: 2 };

export function overallVerdict(rules: { verdict: ComplianceVerdict }[]): ComplianceVerdict {
  return rules.reduce<ComplianceVerdict>(
    (worst, r) => (RANK[r.verdict] > RANK[worst] ? r.verdict : worst),
    "pass",
  );
}
