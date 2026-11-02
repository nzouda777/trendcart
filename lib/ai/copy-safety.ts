/**
 * Guards for generated product-page and ad copy (pure).
 *
 * TikTok ad policy and consumer-protection rules forbid fake social proof and
 * unverifiable claims. The copywriter prompt already forbids them; this is the
 * deterministic second line: `findUnsafeClaims` flags what slipped through so
 * the live copywriter can regenerate, and the mock is tested against it too.
 * `sanitizeDescriptionHtml` keeps only simple formatting tags for Shopify; it is
 * also meant for human edits, so it treats its input as hostile.
 */
import type { PageCopy } from "@/lib/domain/contracts";

export type UnsafeClaim = { rule: string; excerpt: string };

/* -------------------------------------------------------------------------- */
/* Claim rules                                                                */
/* -------------------------------------------------------------------------- */

/** Unicode-aware word edges (JS `\b` is ASCII-only, so it fails after "é"). */
const START = String.raw`(?<![\p{L}\p{N}_])`;
const END = String.raw`(?![\p{L}\p{N}_])`;

/**
 * A "big" count: 1,000 / 10 000 / 2500 / 50k / 1.5M / 1 million / 3 thousand.
 * Small numbers ("2-pack", "50 ml") and spec units ("10,000 mAh") never match on
 * their own: every rule using it also requires an audience or sales noun after it.
 */
const BIG_COUNT = String.raw`(?:\d{1,3}(?:[.,   ]\d{3})+|\d{4,}|\d+(?:[.,]\d+)?\s*(?:k|m|mio\.?|millions?|thousands?|mil|mille|milliers?|tausend|millionen))\s*\+?`;
const AUDIENCE = String.raw`(?:customers?|clients?|clientes|buyers?|users?|utilisateurs|utilisatrices|acheteurs|acheteuses|shoppers?|families|familles|fans|members?|membres|people|personnes|moms|mums|mamans|parents|households|owners|subscribers?|followers?|abonnés|kunden|käufer|nutzer|familien|compradores|usuarios|familias)`;
const SALES = String.raw`(?:orders|commandes|bestellungen|pedidos|units(?: sold)?|sold|vendus?|vendues?|verkauft|vendidos|ventes|sales)`;
const MOOD = String.raw`(?:(?:happy|satisfied|loyal|delighted|repeat|verified|heureux|ravis|satisfaits|zufriedene|felices|satisfechos)\s+)?`;
const SPELLED = String.raw`(?:tens of thousands|hundreds of thousands|thousands|millions|hundreds|des milliers|des millions|des centaines|tausende|millionen|miles|millones)`;
const EXPERTS = String.raw`(?:dermatologists?|doctors?|dentists?|pediatricians?|paediatricians?|physicians?|vets?|veterinarians?|experts?|pharmacists?|nutritionists?|dietitians?|chiropractors?|physiotherapists?|professionals?|scientists?|specialists?|dermatologues?|médecins|dentistes|pédiatres|pharmaciens|spécialistes|ärzten?|dermatologen|zahnärzten?|médicos|dermatólogos)`;

const RULES: { rule: string; re: RegExp }[] = [
  {
    rule: "reviews_or_ratings",
    re: /\b(\d(?:[.,]\d)?\s*(?:\/\s*5|out of 5|stars?|étoiles?|estrellas|sterne)|rated\s+\d|\d+\s*(?:reviews|avis|bewertungen|reseñas)|customer reviews|avis clients|testimonials?|témoignages?|5-star|5 étoiles|five[- ]stars?)\b/i,
  },
  {
    // Star glyphs: "4.9★", "★★★★★", "4,8 ⭐" (no \b: the glyphs are not word characters).
    rule: "reviews_or_ratings",
    re: /\d(?:[.,]\d+)?\s*(?:\/\s*5\s*)?[★⭐☆✩✪✭✮✯]|[★⭐☆✩✪✭✮✯]{2,}/u,
  },
  {
    rule: "customer_counts",
    re: /\b(?:over|more than|plus de|más de|über)?\s*\d[\d\s.,]*\s*(?:k|m|000)?\s*\+?\s*(?:happy |satisfied |clients? )?(?:customers|clients|buyers|users|orders|units sold|sold|vendus|commandes|kunden|verkauft)\b/i,
  },
  {
    // "10,000+ shoppers", "50k families", "1 million sold", "2.5M orders".
    rule: "customer_counts",
    re: new RegExp(
      String.raw`(?:^|[^\w.,])${BIG_COUNT}\s*${MOOD}(?:${AUDIENCE}|${SALES})${END}`,
      "iu",
    ),
  },
  {
    // "thousands of happy customers", "des milliers de clients", "loved by millions".
    rule: "customer_counts",
    re: new RegExp(
      String.raw`${START}(?:${SPELLED}\s+(?:of\s+|de\s+|d'|von\s+)?${MOOD}(?:${AUDIENCE}|${SALES})|(?:loved|trusted|used|chosen|adored|worn|aimée?s?|adoptée?s?|utilisée?s?)\s+(?:by|par|von|por)\s+(?:${SPELLED}|${BIG_COUNT}|many|so many|countless|de nombreux))${END}`,
      "iu",
    ),
  },
  {
    // Unverifiable endorsements: "trusted by ...", "recommended by experts".
    rule: "endorsements",
    re: new RegExp(
      String.raw`${START}(?:trusted by|approved by|endorsed by|recommended by|loved by (?:\p{L}+\s+)?(?:${AUDIENCE}|${EXPERTS})|plébiscitée?s? par|approuvée?s? par|recommandée?s? par|empfohlen von|recomendado por)${END}`,
      "iu",
    ),
  },
  {
    rule: "fake_popularity",
    re: /\b(everyone (?:is|'s) (?:talking|asking|buying|obsessed)|tout le monde (?:en )?parle|tout le monde l'adore|went viral|viral sensation|as seen on|vu sur tiktok|tiktok made me buy it|internet'?s favou?rite)\b/i,
  },
  {
    rule: "superlatives",
    re: /(#\s?1\b|\bnumber one\b|\bno\.\s?1\b|\bn°\s?1\b|\bnuméro 1\b|\bbest[- ]?sell(?:ing|er)\b|\bmeilleure? vente\b|\btop[- ]rated\b|\baward[- ]winning\b)/i,
  },
  {
    rule: "health_or_certification",
    re: /\b(clinically (?:proven|tested|shown|studied)|scientifically (?:proven|tested)|cliniquement (?:prouvé|testé)e?s?|dermatologi(?:st|cally) (?:tested|approved|recommended)|testée? dermatologiquement|fda[- ](?:approved|cleared)|ce certified|doctor[- ]recommended|recommandée? par les médecins|cures?|heals?|guérit|miracle|detox|weight loss|perte de poids|burns? fat)\b/i,
  },
  {
    // Expert or clinical endorsements: "dermatologist recommended", "vet-approved".
    rule: "health_or_certification",
    re: new RegExp(
      String.raw`${START}(?:${EXPERTS}[- ](?:recommended|approved|endorsed|tested|backed|certified|trusted|recommandée?s?|approuvée?s?|testée?s?|empfohlen|getestet|recomendados?|aprobados?)|scientifiquement prouvée?s?)${END}`,
      "iu",
    ),
  },
  {
    rule: "absolute_guarantees",
    re: /\b(100\s?%\s*(?:effective|safe|guaranteed|efficace|garanti)|guaranteed results?|résultats garantis|risk[- ]free|sans risque|lifetime warranty|garantie à vie|money[- ]back guarantee)\b/i,
  },
  {
    rule: "false_urgency",
    re: /\b(only \d+ left|limited stock|selling fast|almost sold out|ends (?:today|tonight)|last chance|plus que \d+|stock limité|dernière chance)\b/i,
  },
  {
    // Discounts: "50% off", "-30%", "save 20%", "half price", "BOGO".
    rule: "prices_or_discounts",
    re: new RegExp(
      String.raw`(?:\d+(?:[.,]\d+)?\s?%\s*(?:off|de (?:réduction|remise|rabais)|rabatt|de descuento|descuento)${END}|${START}save (?:up to )?\d+\s?%|(?:^|[\s(])[-−]\s?\d+(?:[.,]\d+)?\s?%|${START}(?:half[- ]price|moitié prix|buy one,? get one|bogo)${END}|${START}(?:économisez|sparen sie|ahorra) (?:jusqu'à )?\d)`,
      "iu",
    ),
  },
  {
    // Prices go stale: the page shows Shopify's price. "$19.99", "19,99 €", "25 USD".
    rule: "prices_or_discounts",
    re: new RegExp(
      String.raw`[$€£¥]\s?\d|${START}\d+(?:[.,]\d{1,2})?\s?(?:€|\$|£|usd|eur|gbp|cad|aud|dollars?|euros?)${END}`,
      "iu",
    ),
  },
  {
    // Links and contacts never belong in copy (support details live in the theme).
    rule: "urls_or_emails",
    re: /(\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.\S+|[\w.+-]+@[\w-]+\.[a-z]{2,})/i,
  },
  {
    // Bare domains, lowercase only so a missing space ("steel.It") is not a link.
    rule: "urls_or_emails",
    re: /\b[a-z0-9-]{2,}\.(?:com|net|org|io|shop|store|co|fr|de|es|eu|uk|app|ly)(?:\/\S*)?\b/,
  },
];

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ");

/** Every text field of the copy, as plain text, with a label for feedback. */
function copyTexts(copy: PageCopy): { field: string; text: string }[] {
  return [
    { field: "title", text: copy.title },
    { field: "descriptionHtml", text: stripTags(copy.descriptionHtml) },
    ...copy.highlights.map((text, i) => ({ field: `highlights[${i}]`, text })),
    ...copy.faq.flatMap((f, i) => [
      { field: `faq[${i}].question`, text: f.question },
      { field: `faq[${i}].answer`, text: f.answer },
    ]),
    { field: "guarantee", text: copy.guarantee },
    ...copy.adTexts.map((text, i) => ({ field: `adTexts[${i}]`, text })),
    ...(copy.seo
      ? [
          { field: "seo.title", text: copy.seo.title },
          { field: "seo.description", text: copy.seo.description },
        ]
      : []),
  ];
}

/** Flags fake social proof and unverifiable claims, one entry per field and rule. */
export function findUnsafeClaims(copy: PageCopy): (UnsafeClaim & { field: string })[] {
  const out: (UnsafeClaim & { field: string })[] = [];
  for (const { field, text } of copyTexts(copy)) {
    const seen = new Set<string>();
    for (const { rule, re } of RULES) {
      if (seen.has(rule)) continue; // several patterns share a rule name
      const m = text.match(re);
      if (m) {
        seen.add(rule);
        out.push({ field, rule, excerpt: m[0].trim().slice(0, 80) });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* HTML sanitizer                                                             */
/* -------------------------------------------------------------------------- */

const ALLOWED_TAGS = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "strong",
  "em",
  "b",
  "i",
  "br",
]);

/** Elements removed with their content. */
const DROP_BLOCK =
  /<(script|style|iframe|object|embed|template|noscript|svg|math|textarea|title|xmp|noembed|noframes)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_OPEN =
  /<\/?(script|style|iframe|object|embed|template|noscript|svg|math|textarea|title|xmp|noembed|noframes)\b[^>]*>/gi;

/**
 * One complete, well-formed tag at `lastIndex` (sticky): `<name attrs>`,
 * `</name>` or `<name/>`, where attributes are `name`, `name=value`,
 * `name="value"` or `name='value'`. Anything else is not a tag for us.
 */
const COMPLETE_TAG =
  /<(\/?)([a-z][a-z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/iy;

/**
 * Strict allowlist sanitizer for descriptions (AI output and human edits).
 *
 * - Comments and script/style/iframe/svg/math/... elements are removed with
 *   their content (repeated until stable, so `<scr<script>ipt>` cannot rebuild one).
 * - Every `<` is then examined: a complete allowed tag is re-emitted bare
 *   (`<p>`, `</li>`, `<br>`), with no attributes at all (so no on*, style,
 *   href or src, hence no javascript:/data: URLs); a complete tag of any other
 *   element is unwrapped (dropped, its text kept).
 * - Any other `<` (an unterminated tag such as `<img src=x onerror=... x=`, a
 *   stray `<`) is escaped to `&lt;`, and every `>` outside an emitted tag to `&gt;`.
 *
 * The output's only `<` characters therefore belong to bare allowed tags.
 */
export function sanitizeDescriptionHtml(html: string): string {
  let s = html;
  for (let i = 0; i < 10; i++) {
    const next = s
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(DROP_BLOCK, "")
      .replace(DROP_OPEN, "");
    if (next === s) break;
    s = next;
  }

  let out = "";
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    const text = lt === -1 ? s.slice(i) : s.slice(i, lt);
    out += text.replace(/>/g, "&gt;");
    if (lt === -1) break;

    COMPLETE_TAG.lastIndex = lt;
    const m = COMPLETE_TAG.exec(s);
    if (!m) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    if (ALLOWED_TAGS.has(tag)) {
      if (tag === "br") out += close ? "" : "<br>";
      else out += `<${close ? "/" : ""}${tag}>`;
    }
    i = lt + m[0].length;
  }
  return out.trim();
}
