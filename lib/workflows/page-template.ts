/**
 * Which product template a page uses (pure).
 *
 * product.page_template is set at GATE 2 and changed at GATE 3. Products built
 * before it existed fall back to the GATE 2 choice, then the store default.
 */
import { pageTemplateChoiceSchema, type PageTemplateChoice } from "@/lib/domain/contracts";

import { effectiveTemplateSuffix, type SupplierChoicePayload } from "./gate-payloads";

export function resolvePageTemplate(
  row: { pageTemplate: PageTemplateChoice | null },
  choice: Pick<SupplierChoicePayload, "templateSuffix">,
  storeDefault: string | null,
): PageTemplateChoice {
  const parsed = row.pageTemplate ? pageTemplateChoiceSchema.safeParse(row.pageTemplate) : null;
  if (parsed?.success) return parsed.data;
  return {
    mode: "existing",
    suffix: effectiveTemplateSuffix(choice, storeDefault),
    withImages: false,
    generated: null,
  };
}

/** Template suffix set on the Shopify product: the generated one once written. */
export function draftTemplateSuffix(t: PageTemplateChoice): string | null {
  return t.mode === "generate" && t.generated ? t.generated.suffix : t.suffix;
}

export function templateLabel(suffix: string | null): string {
  return suffix === null ? "product.json" : `product.${suffix}.json`;
}
