/**
 * TikTok ad policy brief for the LLM review (pure data, no I/O).
 *
 * Summarised from TikTok's official Advertising Policies, Business Help
 * Center (checked 2026-11-04):
 * - Industry entry index: https://ads.tiktok.com/help/article/tiktok-advertising-policies-industry-entry
 * - Dangerous Products or Services (updated April 2025):
 *   https://ads.tiktok.com/help/article/tiktok-ads-policy-dangerous-products-or-services
 * - Weight Management and Body Image (updated May 2026, "Weight Loss and
 *   Muscle Gain" July 2026): https://ads.tiktok.com/help/article/tiktok-ads-policy-weight-management
 * - Misleading and false content:
 *   https://ads.tiktok.com/help/article/tiktok-ads-policy-misleading-and-false-content
 * - Healthcare and Pharmaceuticals (updated December 2025) and the regional
 *   Ad Policy Handbooks (North America, CIS, METAP):
 *   https://ads.tiktok.com/help/article/tiktok-ads-policy-healthcare-pharmaceuticals
 * - 2026 change log: https://ads.tiktok.com/help/article/tiktok-ad-policy-change-log-2026
 *
 * TikTok changes these often: re-check the change log when editing, and keep
 * the rule ids stable (they are stored in video.compliance json).
 */

export type PolicyCategory = {
  ruleId: string;
  title: string;
  /** What the reviewer model checks, in TikTok's terms. */
  guidance: string;
};

/**
 * Categories the LLM rates one by one. The first ids match the keyword screen
 * (POLICY_RULES) so the two results merge per rule; the last two are only
 * judged by the model.
 */
export const POLICY_CATEGORIES: readonly PolicyCategory[] = [
  {
    ruleId: "policy.prohibited_products",
    title: "Prohibited products",
    guidance:
      "FAIL for: guns, gun parts, ammunition (incl. BB and paintball guns), explosives and fireworks, batons, nunchucks, tasers, pepper spray and other self-defense weapons; police or military uniforms and gear; tobacco, nicotine, e-cigarettes, vapes and smoking paraphernalia (lighters only without smoking references); illegal, recreational or prescription drugs and drug paraphernalia (prescription drugs only in US/CA with regulator approval, 18+); CBD/THC; sexual products and sexually suggestive content. Ordinary tools sharing a word (massage gun, glue gun, water gun toy) are NOT weapons.",
  },
  {
    ruleId: "policy.restricted_products",
    title: "Restricted products (market and age dependent)",
    guidance:
      "WARN when allowed only with conditions: food supplements, vitamins, meal replacements and weight-management products (18+ targeting; allowed in US/CA, Europe incl. FR/DE/IT/ES/GB, SEA and Oceania, MEA, subject to local licensing); medical devices, OTC health products, contact lenses, contraceptives (regulator approval such as FDA / Health Canada, 18+); cosmetics only without medical claims; alcohol (market-specific, 18+ or legal drinking age); culinary and utility knives (may be allowed; general knife ads 18+ only in AT, BE, BG, CZ, DK, FI, FR, DE, GR, HU, IE, IL, IT, LU, NL, NO, PL, PT, RO, ES, SE, CH, GB). FAIL when the product category is not allowed at all in one of the target countries. Say which targeting or approval is required.",
  },
  {
    ruleId: "policy.health_claims",
    title: "Medical and health claims",
    guidance:
      "FAIL for claims that a product cures, heals, treats or prevents a disease or medical condition, unsubstantiated performance claims for health products, 'clinically proven', 'doctor recommended', 'FDA approved' without evidence, detox or immunity claims, and cures for incurable diseases.",
  },
  {
    ruleId: "policy.weight_body_image",
    title: "Weight management and body image",
    guidance:
      "FAIL for: exaggerated or harmful weight-loss or muscle-gain claims; unrealistic results; claims the product alone (without diet or exercise) causes weight loss or muscle gain; suggesting results are easy or guaranteed; promoting disordered eating or an unhealthy relationship with food; shaming bodies, suggesting an ideal or 'perfect' body, or claiming that looking a certain way makes people more desirable, successful, happy or popular.",
  },
  {
    ruleId: "policy.before_after",
    title: "Before-and-after comparisons",
    guidance:
      "FAIL for before-and-after or product-effect comparisons that give a false or distorted impression or show impossible or exaggerated results (e.g. wrinkles disappearing, instant slimming). WARN for a plausible before/after (e.g. cleaning, organising) that still needs evidence or a clear disclaimer. PASS when there is none.",
  },
  {
    ruleId: "policy.misleading_claims",
    title: "Misleading, false or exaggerated claims",
    guidance:
      "WARN or FAIL for promises or exaggerations of a product's effect ('get slim legs right away'), absolute terms about time, region or brand ('best in the world', '#1'), guaranteed results, comparative claims without evidence or disclaimer, negative judgments of competitors, clickbait, fake buttons or pop-ups, and false endorsements or use of a public figure's likeness. FAIL when the claim is clearly false or impossible.",
  },
  {
    ruleId: "policy.pricing_claims",
    title: "Prices, discounts and offers",
    guidance:
      "WARN for prices, discounts, 'free' offers or deadlines in the ad: they must match the landing page exactly and carry their terms; inconsistent or missing terms are rejected. FAIL for obviously false offers.",
  },
  {
    ruleId: "policy.intellectual_property",
    title: "Intellectual property",
    guidance:
      "FAIL for counterfeits, replicas, '1:1' copies, or third-party logos, brands, characters or copyrighted content used without authorisation. WARN when a third-party brand is visible or named and authorisation is unknown.",
  },
  {
    ruleId: "policy.personal_attributes",
    title: "Personal attributes",
    guidance:
      "FAIL when the ad implies knowledge of, or targets, a viewer's personal attributes (body, weight, health, age, ethnicity, religion, sexual orientation, financial status, relationship status), e.g. 'Are you overweight?'.",
  },
  {
    ruleId: "policy.offensive_content",
    title: "Offensive, dangerous or unsafe content",
    guidance:
      "FAIL for discrimination, harassment, bullying, violence or dangerous activities shown as safe, shocking or graphic imagery, suicide or self-harm, sexualised content, minors in unsafe situations or promoting restricted products to minors.",
  },
  {
    ruleId: "policy.edited_media",
    title: "Edited and AI-generated media",
    guidance:
      "Only judge when the video is provided. WARN when footage looks significantly edited or AI-generated (e.g. synthetic people or product effects) without a visible AIGC label or disclaimer; FAIL when it fakes product results. PASS otherwise or when only text is available.",
  },
] as const;

export const POLICY_CATEGORY_IDS = POLICY_CATEGORIES.map((c) => c.ruleId) as [string, ...string[]];

/** The brief as prompt text. */
export function policyBriefText(categories: readonly PolicyCategory[] = POLICY_CATEGORIES): string {
  return categories.map((c) => `- ${c.ruleId} (${c.title}): ${c.guidance}`).join("\n");
}
