/**
 * copy-safety: claim rules (QA M2 S4) and the strict description sanitizer (QA M2 S2).
 */
import { describe, expect, it } from "vitest";

import type { PageCopy } from "@/lib/domain/contracts";

import { findUnsafeClaims, sanitizeDescriptionHtml } from "./copy-safety";

const BASE: PageCopy = {
  title: "Sunset Projection Lamp",
  descriptionHtml: "<p>A compact lamp that casts a warm sunset glow.</p>",
  highlights: ["16 colors", "USB powered", "180° rotation"],
  faq: [
    { question: "How is it powered?", answer: "By USB-C, cable included." },
    { question: "Does it get hot?", answer: "The LED stays cool to the touch." },
    { question: "What is in the box?", answer: "The lamp, a cable and a manual." },
  ],
  guarantee: "Returns accepted within 30 days of delivery.",
  adTexts: ["Turn any room golden in one click."],
};

const rulesFor = (text: string) =>
  findUnsafeClaims({ ...BASE, highlights: [text, "a", "b"] }).map((c) => c.rule);

describe("findUnsafeClaims: S4 phrasings", () => {
  it.each([
    ["4.9★ on average", "reviews_or_ratings"],
    ["★★★★★ loved it", "reviews_or_ratings"],
    ["Rated 4,8 ⭐ by buyers", "reviews_or_ratings"],
    ["Five-star comfort", "reviews_or_ratings"],
    ["Loved by 10,000+ shoppers", "customer_counts"],
    ["Join 25 000 happy families", "customer_counts"],
    ["Join thousands of happy customers", "customer_counts"],
    ["Des milliers de clients satisfaits", "customer_counts"],
    ["Loved by millions", "customer_counts"],
    ["Over 1 million sold", "customer_counts"],
    ["2.5M orders shipped", "customer_counts"],
    ["Plus de 3000 utilisateurs", "customer_counts"],
    ["Trusted by 50k families", "customer_counts"],
    ["Trusted by professionals", "endorsements"],
    ["Recommandé par les experts", "endorsements"],
    ["Dermatologist recommended", "health_or_certification"],
    ["Vet-approved formula", "health_or_certification"],
    ["Expert endorsed design", "health_or_certification"],
    ["Clinically shown to soothe", "health_or_certification"],
    ["Scientifically proven glow", "health_or_certification"],
    ["50% off today", "prices_or_discounts"],
    ["Now -30% on the bundle", "prices_or_discounts"],
    ["Save up to 40%", "prices_or_discounts"],
    ["Half-price this week", "prices_or_discounts"],
    ["Only $19.99", "prices_or_discounts"],
    ["Seulement 19,99 €", "prices_or_discounts"],
    ["Visit https://example.com/deal", "urls_or_emails"],
    ["See www.example.shop for more", "urls_or_emails"],
    ["Shop at sunsetlamp.com", "urls_or_emails"],
    ["Write to help@example.com", "urls_or_emails"],
  ])("flags %j as %s", (text, rule) => {
    expect(rulesFor(text)).toContain(rule);
  });

  it.each([
    "50 ml bottle",
    "10,000 mAh battery",
    "2-pack",
    "Pack of 3",
    "1000 lumens",
    "100% cotton cover",
    "Reduces glare by 30%",
    "Fits 2 people",
    "Serves 4 people",
    "Weighs 1.5 kg",
    "Made of stainless steel.It folds flat",
    "Charges in 2 hours, lasts 12 hours",
    "Works with 5V USB adapters",
    "Recommended for ages 3 and up",
    "3 m cable, 1200 x 800 mm",
    "Rated for 50,000 hours of use",
    "Compatible with iPhone 15 and Samsung S24",
  ])("does not flag the spec %j", (text) => {
    expect(rulesFor(text)).toEqual([]);
  });

  it("reports one entry per field and rule even when several patterns match", () => {
    const claims = findUnsafeClaims({
      ...BASE,
      highlights: ["4.9★ from 10,000 reviews, 5 stars", "a", "b"],
    });
    expect(claims.filter((c) => c.field === "highlights[0]").map((c) => c.rule)).toEqual([
      "reviews_or_ratings",
    ]);
  });

  it("keeps the baseline copy clean", () => {
    expect(findUnsafeClaims(BASE)).toEqual([]);
  });
});

describe("sanitizeDescriptionHtml: S2 strict allowlist", () => {
  const onlyAllowedTags = /<(?!\/?(?:p|ul|ol|li|h[234]|strong|em|b|i|br)>)/i;

  it.each([
    "<p>Nice</p><img src=x onerror=alert(document.domain) x=",
    "<p>Nice</p><svg onload=alert(1) x=",
    "<p>Nice</p><i onmouseover=alert(1) x=",
    "<p>Nice</p><b",
    "<p>Nice</p></p",
    '<p>Nice</p><a href="javascript:alert(1)',
    "<p>Nice<script>alert(1)",
    "<p>Nice<!-- <img src=x onerror=alert(1)>",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
    "<<script>script>alert(1)<</script>/script>",
    '<p title=">" onmouseover=alert(1)>x</p>',
    "<<img src=x onerror=alert(1)>>",
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    "<p/onmouseover=alert(1)>x</p>",
    "<img\nsrc=x\nonerror=alert(1)>",
    "<math><mi xlink:href=javascript:alert(1)>x</mi></math>",
  ])("leaves no tag but bare allowed ones in %j", (evil) => {
    const out = sanitizeDescriptionHtml(evil);
    expect(out, out).not.toMatch(onlyAllowedTags);
    expect(out, out).not.toMatch(/<[a-z]+\s/i);
  });

  it("escapes the unterminated tag as text", () => {
    expect(sanitizeDescriptionHtml("<p>Nice</p><img src=x onerror=alert(1) x=")).toBe(
      "<p>Nice</p>&lt;img src=x onerror=alert(1) x=",
    );
    expect(sanitizeDescriptionHtml("<p>1 < 2 and 3 > 2</p>")).toBe("<p>1 &lt; 2 and 3 &gt; 2</p>");
  });

  it("strips every attribute from allowed tags and unwraps the rest", () => {
    expect(
      sanitizeDescriptionHtml(
        '<P CLASS="x" onclick="steal()">Hi <a href="https://e.example">there</a><BR/></P>' +
          "<ul><li style='color:red'>ok</li></ul><div><h3 id=a>T</h3></div>",
      ),
    ).toBe("<p>Hi there<br></p><ul><li>ok</li></ul><h3>T</h3>");
  });

  it("is idempotent and handles large hostile input quickly", () => {
    const once = sanitizeDescriptionHtml("<p>a</p><img src=x onerror=alert(1) x=");
    expect(sanitizeDescriptionHtml(once)).toBe(once);
    const big = "<p a=" + "x a=".repeat(20_000) + "<".repeat(20_000);
    const t = Date.now();
    sanitizeDescriptionHtml(big);
    expect(Date.now() - t).toBeLessThan(1_000);
  });
});
