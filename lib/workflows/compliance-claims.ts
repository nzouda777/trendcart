/**
 * What a video compliance report is made against (pure): the page copy ad
 * texts and highlights the video will run with, and their version. A report
 * whose stored `claimsVersion` differs from the current one is outdated.
 */
import type { PageCopy } from "@/lib/domain/contracts";

import { pageCopyVersion } from "./copy-version";

/** Ad texts and page highlights: what the video will run with. */
export function complianceClaims(copy: PageCopy | null): string[] {
  if (!copy) return [];
  return [...copy.adTexts, ...copy.highlights].map((s) => s.trim()).filter(Boolean);
}

export function claimsVersion(claims: readonly string[]): string {
  return pageCopyVersion({ claims })!;
}

/** True when the video's report was made against other claims than `copy`'s. */
export function isComplianceOutdated(
  report: unknown,
  metadata: Record<string, unknown> | null,
  copy: PageCopy | null,
): boolean {
  if (!report || !copy) return false;
  return metadata?.claimsVersion !== claimsVersion(complianceClaims(copy));
}
