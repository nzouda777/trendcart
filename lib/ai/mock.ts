/**
 * Deterministic ProductAnalyzer and Copywriter mocks built on the shared
 * sample catalog. They report realistic AiUsage so metering and the monthly
 * cap behave in mock mode as they will live.
 */
import {
  analyzeHintSchema,
  analyzeInputSchema,
  pageCopySchema,
  productAnalysisSchema,
  templatePlanSchema,
  type Copywriter,
  type PageCopy,
  type ProductAnalysis,
  type ProductAnalyzer,
  type TemplatePlan,
  type ThemeSectionSpec,
} from "@/lib/domain/contracts";

import { DEFAULT_MODELS, tokenUsage } from "./pricing";
import {
  matchSampleProduct,
  pickSampleProduct,
  SAMPLE_PRODUCTS,
  sampleImageUrl,
  type SampleProduct,
} from "./sample-products";

/** Typical token counts measured for a ~30 s video and a page-copy call. */
export const MOCK_TOKENS = {
  videoAnalysis: { inputTokens: 9_800, outputTokens: 650 },
  pageAnalysis: { inputTokens: 7_200, outputTokens: 600 },
  copywriting: { inputTokens: 1_900, outputTokens: 1_700 },
};

const MOCK_USAGE_DATE = new Date("2026-10-01T00:00:00Z");

function productFromMediaUrl(mediaUrl: string): SampleProduct {
  try {
    const key = new URL(mediaUrl).searchParams.get("tc_mock");
    const found = SAMPLE_PRODUCTS.find((p) => p.key === key);
    if (found) return found;
  } catch {
    // fall through
  }
  return pickSampleProduct(mediaUrl);
}

/**
 * After a GATE 1 rejection, the next sample product (catalog order) whose
 * name was not rejected, so the demo visibly changes. Deterministic.
 */
export function skipRejected(
  product: SampleProduct,
  rejectedNames: string[] | undefined,
): SampleProduct {
  const rejected = new Set(
    (rejectedNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (rejected.size === 0) return product;
  const start = SAMPLE_PRODUCTS.indexOf(product);
  for (let i = 1; i <= SAMPLE_PRODUCTS.length; i++) {
    const next = SAMPLE_PRODUCTS[(start + i) % SAMPLE_PRODUCTS.length]!;
    if (!rejected.has(next.productName.toLowerCase())) return next;
  }
  return product;
}

export function createMockProductAnalyzer(): ProductAnalyzer {
  return {
    async analyze(_ctx, raw) {
      const input = analyzeInputSchema.parse(raw);
      const hint = raw.hint ? analyzeHintSchema.parse(raw.hint) : undefined;
      const isVideo = input.source === "tiktok_video";
      const first = isVideo ? productFromMediaUrl(input.mediaUrl) : matchSampleProduct(input.url);
      const product = skipRejected(first, hint?.rejectedProductNames);
      const retried = product !== first;
      const data: ProductAnalysis = productAnalysisSchema.parse({
        productName: product.productName,
        category: product.category,
        description: product.description,
        features: product.features,
        sellingPoints: product.sellingPoints,
        keywords: product.keywords,
        bestFrameSec: isVideo ? product.bestFrameSec : null,
        referenceImageUrl: isVideo
          ? (input.thumbnailUrl ?? sampleImageUrl(`${product.key}-ref`))
          : sampleImageUrl(`${product.key}-ref`),
        confidence: retried ? 0.74 : isVideo ? 0.91 : 0.86,
      });
      const tokens = isVideo ? MOCK_TOKENS.videoAnalysis : MOCK_TOKENS.pageAnalysis;
      return {
        data,
        usage: [tokenUsage("google", DEFAULT_MODELS.productAnalysis, tokens, MOCK_USAGE_DATE)],
      };
    },
  };
}

type CopyStrings = {
  intro: (name: string, brand: string) => string;
  why: string;
  specs: string;
  faq: (name: string) => { question: string; answer: string }[];
  guarantee: (brand: string) => string;
  ad: (name: string, point: string) => string[];
  seo: (name: string, point: string) => { title: string; description: string };
};

const STRINGS: Record<"en" | "fr", CopyStrings> = {
  en: {
    intro: (name, brand) => `Meet the ${name}, picked by ${brand} for everyday use.`,
    why: "Why you'll love it",
    specs: "Details",
    faq: (name) => [
      {
        question: "How long does shipping take?",
        answer: "Orders ship within 1 to 3 business days. Delivery times are shown at checkout.",
      },
      {
        question: `What is included with the ${name}?`,
        answer: "Everything shown in the product photos for the variant you choose.",
      },
      {
        question: "Can I return it?",
        answer:
          "Yes, returns follow the store's return policy. Contact our support team and we will guide you.",
      },
    ],
    guarantee: (brand) =>
      `Shop with confidence: if something is wrong with your order, ${brand} support will help you under our return policy.`,
    ad: (name, point) => [`${name}: ${point}`.slice(0, 100), `Discover the ${name}.`.slice(0, 100)],
    seo: (name, point) => ({
      title: name.slice(0, 70),
      description: `${name}. ${point}`.slice(0, 155),
    }),
  },
  fr: {
    intro: (name, brand) => `Découvrez ${name}, sélectionné par ${brand} pour le quotidien.`,
    why: "Pourquoi vous allez l'adorer",
    specs: "Caractéristiques",
    faq: (name) => [
      {
        question: "Quels sont les délais de livraison ?",
        answer:
          "Les commandes sont expédiées sous 1 à 3 jours ouvrés. Les délais sont indiqués au paiement.",
      },
      {
        question: `Que contient ${name} ?`,
        answer: "Tout ce qui apparaît sur les photos de la variante choisie.",
      },
      {
        question: "Puis-je le retourner ?",
        answer:
          "Oui, les retours suivent la politique de retour de la boutique. Contactez notre service client.",
      },
    ],
    guarantee: (brand) =>
      `Achetez en confiance : en cas de problème avec votre commande, le service client ${brand} vous accompagne selon notre politique de retour.`,
    ad: (name, point) => [`${name} : ${point}`.slice(0, 100), `Découvrez ${name}.`.slice(0, 100)],
    seo: (name, point) => ({
      title: name.slice(0, 70),
      description: `${name}. ${point}`.slice(0, 155),
    }),
  },
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Deterministic template plan: up to 5 of the theme's sections, in catalog
 * order, plus up to 3 buy box blocks; every setting filled from the copy
 * (highlights, FAQ, guarantee), buttons back to the product, the first color
 * scheme, product photos when images are allowed.
 */
function mockTemplatePlan(input: Parameters<Copywriter["designTemplate"]>[1]): TemplatePlan {
  const { copy, sections, mainSection, colorSchemes, withImages, imageUrls } = input;
  const texts = [copy.title, ...copy.highlights, copy.guarantee];
  let n = 0;
  let image = 0;
  const fill = (settings: ThemeSectionSpec["settings"], i: number) =>
    settings.flatMap((s) => {
      if (s.type === "select" || s.type === "radio")
        return s.options?.[0] ? [{ id: s.id, value: s.options[0] }] : [];
      if (s.type === "checkbox" || s.type === "range" || s.type === "number") return [];
      if (s.type === "url") return [{ id: s.id, value: "product" }];
      if (s.type === "color_scheme")
        return colorSchemes[0]
          ? [{ id: s.id, value: colorSchemes[i % colorSchemes.length]!.id }]
          : [];
      if (s.type === "image_picker")
        return withImages && imageUrls.length
          ? [{ id: s.id, value: `image:${image++ % imageUrls.length}` }]
          : [];
      const faq = copy.faq[i % copy.faq.length]!;
      const value =
        s.type === "richtext" || s.type === "textarea"
          ? s.id.includes("content")
            ? faq.answer
            : texts[n++ % texts.length]!
          : s.id.includes("heading") && settings.some((x) => x.id.includes("content"))
            ? faq.question
            : texts[n++ % texts.length]!;
      return [{ id: s.id, value }];
    });
  const usable = sections.filter((x) => withImages || !x.hasMediaSettings);
  return templatePlanSchema.parse({
    mainBlocks: (mainSection?.blocks ?? []).slice(0, 3).map((b, i) => ({
      type: b.type,
      position: i === 0 ? "after_price" : "after_buy_buttons",
      settings: fill(b.settings, i),
    })),
    sections: usable.slice(0, 5).map((section, si) => ({
      type: section.type,
      purpose: `Mock: ${section.name}`,
      settings: fill(section.settings, si),
      blocks: section.blocks
        .filter((b) => b.settings.length > 0)
        .flatMap((b) =>
          Array.from({ length: Math.min(3, b.limit ?? 3) }, (_, i) => ({
            type: b.type,
            settings: fill(b.settings, i),
          })),
        )
        .slice(0, Math.min(section.maxBlocks ?? 6, 6)),
    })),
  });
}

export function createMockCopywriter(): Copywriter {
  return {
    async designTemplate(_ctx, input) {
      return {
        data: mockTemplatePlan(input),
        usage: [
          tokenUsage(
            "anthropic",
            DEFAULT_MODELS.copywriting,
            MOCK_TOKENS.copywriting,
            MOCK_USAGE_DATE,
          ),
        ],
      };
    },

    async writePage(_ctx, input) {
      const s = input.language === "fr" ? STRINGS.fr : STRINGS.en;
      const a = input.analysis;
      const brand = input.brandName.trim() || "our team";
      const name = a.productName;
      const points = (a.sellingPoints.length ? a.sellingPoints : a.features).slice(0, 6);
      const highlights = [...points, ...a.features].slice(
        0,
        Math.max(3, Math.min(6, points.length)),
      );
      while (highlights.length < 3) highlights.push(a.category);

      const descriptionHtml = [
        `<p>${escapeHtml(s.intro(name, brand))} ${escapeHtml(a.description)}</p>`,
        `<h3>${s.why}</h3>`,
        `<ul>${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`,
        a.features.length
          ? `<h3>${s.specs}</h3><ul>${a.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
          : "",
      ].join("");

      const data: PageCopy = pageCopySchema.parse({
        title: name.slice(0, 255),
        descriptionHtml,
        highlights,
        faq: s.faq(name),
        guarantee: s.guarantee(brand),
        adTexts: s.ad(name, points[0] ?? a.category),
        seo: s.seo(name, points[0] ?? a.category),
        ...(input.template?.slots.length
          ? {
              templateFields: input.template.slots.map((slot) => ({
                namespace: slot.namespace,
                key: slot.key,
                type: slot.type,
                label: slot.name.slice(0, 255) || slot.key,
                value:
                  slot.type === "list.single_line_text_field"
                    ? highlights.join("\n")
                    : slot.type === "single_line_text_field"
                      ? (points[0] ?? name).slice(0, 255)
                      : `${a.description}`.slice(0, 2000) || name,
              })),
            }
          : {}),
      });
      return {
        data,
        usage: [
          tokenUsage(
            "anthropic",
            DEFAULT_MODELS.copywriting,
            MOCK_TOKENS.copywriting,
            MOCK_USAGE_DATE,
          ),
        ],
      };
    },
  };
}
