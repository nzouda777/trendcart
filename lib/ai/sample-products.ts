/**
 * Deterministic sample catalog shared by every mock in lib/integrations/tiktok-data,
 * lib/ai, lib/sourcing and lib/compliance, so a mock import flows end to end
 * with consistent data (same product from video to listings to page copy).
 *
 * Images are seeded placeholders (picsum.photos) so the UI renders something
 * real-looking; the sample video is a CC0 clip from MDN.
 */
export type SampleProduct = {
  key: string;
  productName: string;
  category: string;
  description: string;
  features: string[];
  sellingPoints: string[];
  keywords: string[];
  bestFrameSec: number;
  /** Supplier unit price range in USD. */
  unitCostUsd: [number, number];
  variants: { name: string; values: string[] }[];
  /** Captions used by the mock TikTok videos of this product. */
  captions: string[];
};

export const SAMPLE_PRODUCTS: SampleProduct[] = [
  {
    key: "sunset-lamp",
    productName: "LED Sunset Projection Lamp",
    category: "Home & Living > Lighting",
    description:
      "A compact USB lamp that projects a warm sunset-style halo onto walls, with a rotating head and several color modes.",
    features: [
      "180° rotating head",
      "16 color modes with remote",
      "USB-C powered, 5 V",
      "Aluminium body, 25 cm tall",
    ],
    sellingPoints: [
      "Instant golden-hour mood for any room",
      "Popular for photos and videos at home",
      "Low power draw, runs from a laptop or power bank",
    ],
    keywords: [
      "sunset lamp",
      "sunset projection lamp",
      "led sunset light",
      "rainbow projector lamp",
    ],
    bestFrameSec: 3.5,
    unitCostUsd: [4.2, 7.9],
    variants: [{ name: "Color", values: ["Sunset Red", "Rainbow", "16 Colors + Remote"] }],
    captions: [
      "This lamp changed my room vibe completely #sunsetlamp #roomdecor",
      "Golden hour, every hour. #tiktokmademebuyit #homedecor",
      "Rating viral home gadgets: the sunset lamp #gadgets",
    ],
  },
  {
    key: "portable-blender",
    productName: "Portable USB Rechargeable Blender",
    category: "Kitchen > Small Appliances",
    description:
      "A 380 ml cordless blender bottle with six stainless-steel blades for smoothies and protein shakes on the go.",
    features: [
      "380 ml BPA-free bottle",
      "6 stainless-steel blades",
      "USB-C charging, about 12 blends per charge",
      "Magnetic safety switch",
    ],
    sellingPoints: [
      "Fresh smoothies at the gym, office or on a trip",
      "Rinse-and-go cleaning in seconds",
      "Fits most car cup holders",
    ],
    keywords: [
      "portable blender",
      "usb blender bottle",
      "mini smoothie blender",
      "rechargeable blender",
    ],
    bestFrameSec: 6,
    unitCostUsd: [6.5, 11.4],
    variants: [
      { name: "Color", values: ["White", "Pink", "Sage Green", "Black"] },
      { name: "Size", values: ["380 ml", "600 ml"] },
    ],
    captions: [
      "Smoothie in 30 seconds, anywhere #portableblender #gymtok",
      "Best thing I bought this month #kitchengadgets #tiktokmademebuyit",
    ],
  },
  {
    key: "magnetic-phone-mount",
    productName: "Magnetic Car Phone Mount",
    category: "Automotive > Interior Accessories",
    description:
      "A low-profile magnetic phone holder that clips onto air vents and holds phones securely with N52 magnets.",
    features: [
      "N52 neodymium magnets",
      "360° ball joint",
      "Vent clip and dashboard adhesive base included",
      "Works with MagSafe-compatible cases",
    ],
    sellingPoints: [
      "One-hand mounting while you drive",
      "Holds steady on bumpy roads",
      "Minimal look that does not block the vent",
    ],
    keywords: [
      "magnetic phone mount",
      "car phone holder magnetic",
      "magsafe car mount",
      "vent phone holder",
    ],
    bestFrameSec: 2,
    unitCostUsd: [2.1, 4.8],
    variants: [{ name: "Mount type", values: ["Vent clip", "Dashboard"] }],
    captions: [
      "Car setup upgrade, under a minute #carhacks #caraccessories",
      "Finally a phone mount that does not fall off #cartok",
    ],
  },
  {
    key: "silicone-utensils",
    productName: "Silicone Kitchen Utensil Set (12 pcs)",
    category: "Kitchen > Utensils",
    description:
      "A 12-piece heat-resistant silicone utensil set with wooden handles and a matching holder.",
    features: [
      "Food-grade silicone heads, heat resistant to 230 °C",
      "Beech wood handles",
      "Holder included",
      "Non-scratch on non-stick pans",
    ],
    sellingPoints: [
      "Protects non-stick pans",
      "Matching set that looks good on the counter",
      "Easy to clean, dishwasher-safe heads",
    ],
    keywords: [
      "silicone utensil set",
      "kitchen utensils wooden handle",
      "silicone cooking set",
      "kitchen tool set",
    ],
    bestFrameSec: 4.5,
    unitCostUsd: [7.8, 13.5],
    variants: [{ name: "Color", values: ["Cream", "Grey", "Black", "Sage"] }],
    captions: [
      "Kitchen glow up #kitchenrestock #asmr",
      "Restocking my utensils #cleantok #kitchen",
    ],
  },
];

/** FNV-1a 32-bit: small, stable hash for deterministic mock picks. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable pseudo-random number in [0, 1) derived from a seed string. */
export function seeded(seed: string): number {
  return fnv1a(seed) / 0x1_0000_0000;
}

export function pickSampleProduct(seed: string): SampleProduct {
  return SAMPLE_PRODUCTS[fnv1a(seed) % SAMPLE_PRODUCTS.length]!;
}

/** Finds the sample product a set of keywords most likely refers to. */
export function matchSampleProduct(text: string): SampleProduct {
  const haystack = text.toLowerCase();
  let best: SampleProduct | undefined;
  let bestScore = 0;
  for (const p of SAMPLE_PRODUCTS) {
    const score = [...p.keywords, p.productName]
      .flatMap((k) => k.toLowerCase().split(/\s+/))
      .filter((w) => w.length > 3 && haystack.includes(w)).length;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best ?? pickSampleProduct(text);
}

export const sampleImageUrl = (seed: string, width = 800, height = 800) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;

/** CC0 sample clip, used as the mock "fresh media URL". */
export const SAMPLE_VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
