/**
 * Sample data for the product UI mockups.
 *
 * This is obviously fake demo data (fake store, fake products, fake handles),
 * not landing copy. No real customers, people or performance numbers.
 */

import type { StaticImageData } from "next/image";

import projectorLivingRoom from "@/public/samples/projector-living-room.jpg";
import projectorStudio from "@/public/samples/projector-studio.jpg";
import projectorTable from "@/public/samples/projector-table.jpg";

export const DEMO_STORE = "Demo Store";

/* -------------------------------------------------------------------------- */
/*  Sample photos (Unsplash License, credits in README)                        */
/* -------------------------------------------------------------------------- */

export type SamplePhoto = {
  src: StaticImageData;
  alt: string;
  /** CSS object-position used for tight / vertical crops (product stays in frame). */
  position: string;
};

export const samplePhotos = {
  studio: {
    src: projectorStudio,
    alt: "White mini projector on a black studio background",
    position: "50% 40%",
  },
  table: {
    src: projectorTable,
    alt: "White mini projector on a light wooden table",
    position: "58% 60%",
  },
  livingRoom: {
    src: projectorLivingRoom,
    alt: "White mini projector on a wooden stool in a living room",
    position: "52% 55%",
  },
} as const satisfies Record<string, SamplePhoto>;

export const demoTiktokUrl = "tiktok.com/@demo.creator/video/7301234567890";

/* -------------------------------------------------------------------------- */
/*  Product                                                                    */
/* -------------------------------------------------------------------------- */

export const demoProduct = {
  name: "Glow Mini Projector",
  category: "Home & Living · Projectors",
  sku: "GMP-0417",
  confidence: 94,
  sellingPoints: [
    "Fits in one hand, 1080p input",
    "Projects onto ceilings and walls",
    "USB-C powered, quiet fan",
  ],
  attributes: [
    { label: "Color", value: "Matte white" },
    { label: "Weight", value: "0.42 kg" },
    { label: "Mentions", value: "ceiling, bedroom, movie night" },
  ],
  /** Main photo + Shopify gallery (same product, three shots). */
  image: samplePhotos.studio,
  gallery: [samplePhotos.studio, samplePhotos.table, samplePhotos.livingRoom],
  /** Matches the photos: one color, editions don't change the look. */
  color: { label: "Matte White", swatch: "#ececea" },
  variants: [
    { id: "std", label: "Standard" },
    { id: "wifi", label: "Wi-Fi" },
    { id: "wifi-bt", label: "Wi-Fi + BT" },
  ],
  bundles: ["Single", "Bundle ×2"],
  price: 39.9,
  compareAtPrice: 59.9,
} as const;

/* -------------------------------------------------------------------------- */
/*  Suppliers & margin                                                         */
/* -------------------------------------------------------------------------- */

export type SupplierMatch = {
  id: string;
  name: string;
  cost: number;
  shipping: number;
  shipDays: string;
  match: number;
  /** Listing photo shown in the matches table. */
  image: SamplePhoto;
};

export const supplierMatches: SupplierMatch[] = [
  {
    id: "sup-a",
    image: samplePhotos.studio,
    name: "Supplier A · Sample Co.",
    cost: 9.8,
    shipping: 3.2,
    shipDays: "6–9 d",
    match: 97,
  },
  {
    id: "sup-b",
    image: samplePhotos.table,
    name: "Supplier B · Example Ltd",
    cost: 8.9,
    shipping: 5.4,
    shipDays: "9–14 d",
    match: 91,
  },
  {
    id: "sup-c",
    image: samplePhotos.livingRoom,
    name: "Supplier C · Demo Trade",
    cost: 11.5,
    shipping: 2.6,
    shipDays: "4–7 d",
    match: 88,
  },
];

/** Payment + platform fees used by the margin mock: 2.9% + $0.30. */
export const demoFees = { rate: 0.029, fixed: 0.3 } as const;

export type MarginBreakdown = {
  price: number;
  cost: number;
  shipping: number;
  fees: number;
  profit: number;
  marginPct: number;
};

export function computeMargin(price: number, cost: number, shipping: number): MarginBreakdown {
  const fees = round2(price * demoFees.rate + demoFees.fixed);
  const profit = round2(price - cost - shipping - fees);
  const marginPct = price > 0 ? Math.round((profit / price) * 1000) / 10 : 0;
  return { price, cost, shipping, fees, profit, marginPct };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

/** Selected supplier for the pipeline / how-it-works mocks. */
export const selectedSupplier = supplierMatches[0];
export const selectedMargin = computeMargin(
  demoProduct.price,
  selectedSupplier.cost,
  selectedSupplier.shipping,
);

/* -------------------------------------------------------------------------- */
/*  Videos                                                                     */
/* -------------------------------------------------------------------------- */

export type CheckState = "pass" | "warn" | "fail";

export type DemoVideo = {
  id: string;
  handle: string;
  duration: string;
  /** Poster frame (vertical object-cover crop of a sample photo). */
  poster: SamplePhoto;
  checks: { format: CheckState; length: CheckState; claims: CheckState };
  note?: string;
};

export const demoVideos: DemoVideo[] = [
  {
    id: "vid-01",
    handle: "@demo.creator",
    duration: "0:21",
    poster: samplePhotos.livingRoom,
    checks: { format: "pass", length: "pass", claims: "pass" },
  },
  {
    id: "vid-02",
    handle: "@sample.home",
    duration: "0:34",
    poster: samplePhotos.table,
    checks: { format: "pass", length: "pass", claims: "warn" },
    note: "“Best projector ever” needs review",
  },
  {
    id: "vid-03",
    handle: "@test.reviews",
    duration: "1:12",
    poster: samplePhotos.studio,
    checks: { format: "pass", length: "warn", claims: "pass" },
  },
];

/* -------------------------------------------------------------------------- */
/*  Campaign                                                                   */
/* -------------------------------------------------------------------------- */

export const demoCampaign = {
  name: "GMP · Launch test",
  objective: "Website conversions",
  budget: "$50 / day",
  adGroups: [
    {
      name: "Broad · US · 18–34",
      ads: ["Ad 1 · vid-01", "Ad 2 · vid-03"],
    },
    {
      name: "Interest · Home decor",
      ads: ["Ad 3 · vid-01"],
    },
  ],
  checklist: [
    { label: "Product page approved", done: true },
    { label: "Videos approved (2)", done: true },
    { label: "Pixel & events connected", done: true },
    { label: "Budget & schedule set", done: true },
  ],
} as const;

/* -------------------------------------------------------------------------- */
/*  Posting                                                                    */
/* -------------------------------------------------------------------------- */

export const demoProfiles = [
  { id: "p1", handle: "@demostore.home", slot: "Tue · 18:30", status: "Scheduled" as const },
  { id: "p2", handle: "@demostore.deals", slot: "Wed · 12:00", status: "Scheduled" as const },
  { id: "p3", handle: "@sample.brand", slot: "—", status: "Draft" as const },
];

/* -------------------------------------------------------------------------- */
/*  Multi-store                                                                */
/* -------------------------------------------------------------------------- */

export type ConnectionStatus = "connected" | "attention" | "error";

/** Avatar colors use doses of the brand green and neutral greys only. */
export const demoBrands = [
  {
    id: "b1",
    name: "Demo Store",
    initials: "DS",
    stores: 2,
    color: "bg-brand text-brand-foreground",
  },
  {
    id: "b2",
    name: "Sample Home Co.",
    initials: "SH",
    stores: 1,
    color: "border border-brand-border bg-brand-soft text-brand-text",
  },
  {
    id: "b3",
    name: "Example Outdoors",
    initials: "EO",
    stores: 3,
    color: "bg-foreground text-background",
  },
] as const;

export const demoConnections: {
  group: "Shopify stores" | "TikTok profiles" | "Ad accounts";
  items: { name: string; meta: string; status: ConnectionStatus }[];
}[] = [
  {
    group: "Shopify stores",
    items: [
      { name: "demo-store.myshopify.com", meta: "Online Store 2.0", status: "connected" },
      { name: "demo-store-eu.myshopify.com", meta: "Online Store 2.0", status: "connected" },
    ],
  },
  {
    group: "TikTok profiles",
    items: [
      { name: "@demostore.home", meta: "Posting enabled", status: "connected" },
      { name: "@demostore.deals", meta: "Re-authorize soon", status: "attention" },
    ],
  },
  {
    group: "Ad accounts",
    items: [
      { name: "Demo Ads · US", meta: "ID 7000 0000 0001", status: "connected" },
      { name: "Demo Ads · EU", meta: "Token expired", status: "error" },
    ],
  },
];

export const demoProxies = [
  { brand: "Demo Store", enabled: true, endpoint: "proxy-us.example.net:8080", region: "US" },
  { brand: "Sample Home Co.", enabled: false, endpoint: "Not set", region: "—" },
  { brand: "Example Outdoors", enabled: true, endpoint: "proxy-eu.example.net:3128", region: "EU" },
] as const;

export type TeamRole = "Owner" | "Admin" | "Editor" | "Viewer";

export const demoTeam: {
  name: string;
  email: string;
  initials: string;
  role: TeamRole;
  twoFa: boolean;
}[] = [
  { name: "Alex Demo", email: "alex@demo.store", initials: "AD", role: "Owner", twoFa: true },
  { name: "Sam Sample", email: "sam@demo.store", initials: "SS", role: "Admin", twoFa: true },
  { name: "Robin Test", email: "robin@demo.store", initials: "RT", role: "Editor", twoFa: true },
  { name: "Jo Example", email: "jo@demo.store", initials: "JE", role: "Viewer", twoFa: false },
];
