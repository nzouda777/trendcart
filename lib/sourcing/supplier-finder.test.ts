/**
 * SupplierFinder: pure ranking helpers, SerpApi/Firecrawl mapping and the
 * live pipeline against a fake network (no real API is ever called).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ProxyAgent, type RequestInit } from "undici";

import {
  IntegrationError,
  supplierListingSchema,
  type SupplierListing,
} from "@/lib/domain/contracts";
import { resetDispatcherCache, type HttpFetch } from "@/lib/integrations/tiktok-data/http";
import { guardedDispatcher } from "@/lib/integrations/tiktok-data/net-guard";

import { createSupplierFinder } from ".";
import { createExclusionFilter, listingExclusionKey } from "./exclude";
import { listingExtractionJsonSchema, normalizeExtraction } from "./firecrawl";
import { createLiveSupplierFinder, toListing } from "./live";
import {
  canonicalListingUrl,
  cleanImageUrls,
  currencyFromDisplay,
  keywordScore,
  rankCandidates,
  shippingFromDelivery,
  type ListingCandidate,
} from "./ranking";

const KEYWORDS = ["sunset projection lamp", "sunset lamp", "led sunset light"];
const IMAGE = "https://p16-sign.tiktokcdn-us.com/cover-1.jpeg";
const SERP = "https://serpapi.test/search";
const FC = "https://firecrawl.test";

afterEach(() => resetDispatcherCache());

/* Pure helpers ------------------------------------------------------------ */

describe("canonicalListingUrl", () => {
  it.each([
    [
      "https://www.aliexpress.com/item/1005006123456789.html?spm=a2g0o&algo_pvid=x&sku_id=12",
      "https://www.aliexpress.com/item/1005006123456789.html",
    ],
    [
      "https://fr.aliexpress.com/item/1005006123456789.html?gatewayAdapt=glo2fra",
      "https://www.aliexpress.com/item/1005006123456789.html",
    ],
    [
      "https://www.amazon.com/Sunset-Lamp-Projector/dp/B0ABCDE123/ref=sr_1_3?keywords=x&qid=1",
      "https://www.amazon.com/dp/B0ABCDE123",
    ],
    [
      "https://www.ebay.com/itm/Sunset-lamp/123456789012?hash=item1",
      "https://www.ebay.com/itm/123456789012",
    ],
    [
      "https://www.temu.com/sunset-lamp-g-601099512345678.html?_x_sessn_id=abc",
      "https://www.temu.com/sunset-lamp-g-601099512345678.html",
    ],
    [
      "https://shop.example.com/products/lamp?utm_source=tt&variant=2",
      "https://shop.example.com/products/lamp?variant=2",
    ],
  ])("canonicalizes %s", (raw, expected) => {
    expect(canonicalListingUrl(raw)).toBe(expected);
  });

  it.each([
    "http://127.0.0.1/item.html",
    "https://localhost/x",
    "https://intranet.corp/x",
    "ftp://example.com/x",
    "https://user:pw@example.com/x",
    "not a url",
  ])("rejects %s", (raw) => {
    expect(canonicalListingUrl(raw)).toBeNull();
  });
});

describe("listing exclusion (GATE 2 'None of these')", () => {
  it("keys URLs by lowercase host and path, ignoring query, hash, trailing slash, scheme and www", () => {
    const key = "aliexpress.com/item/1005006123456789.html";
    for (const raw of [
      "https://www.aliexpress.com/item/1005006123456789.html",
      "https://WWW.AliExpress.com/item/1005006123456789.html/?spm=a2g0o#reviews",
      "http://aliexpress.com/item/1005006123456789.html",
      "  https://www.aliexpress.com/item/1005006123456789.html// ",
    ]) {
      expect(listingExclusionKey(raw), raw).toBe(key);
    }
    // Path case is kept (ids can be case-sensitive), other pages are distinct.
    expect(listingExclusionKey("https://www.amazon.com/dp/B0ABCDE123")).not.toBe(
      listingExclusionKey("https://www.amazon.com/dp/b0abcde123"),
    );
    expect(listingExclusionKey("not a url")).toBeNull();
    expect(listingExclusionKey("javascript:alert(1)")).toBeNull();
  });

  it("builds a filter that ignores junk entries", () => {
    const isExcluded = createExclusionFilter(["nope", "https://shop.example.com/products/lamp/"]);
    expect(isExcluded("https://shop.example.com/products/lamp?variant=2")).toBe(true);
    expect(isExcluded("https://shop.example.com/products/lamp-2")).toBe(false);
    expect(createExclusionFilter(undefined)("https://shop.example.com/x")).toBe(false);
  });
});

describe("matching helpers", () => {
  it("scores titles by keyword coverage", () => {
    expect(keywordScore("LED Sunset Projection Lamp USB 16 colors", KEYWORDS)).toBeGreaterThan(0.9);
    const partial = keywordScore("Rainbow projector night light", KEYWORDS);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(0.5);
    expect(keywordScore("Stainless steel water bottle", KEYWORDS)).toBe(0);
  });

  it("reads currencies from displayed prices", () => {
    expect(currencyFromDisplay("12,99 €", "FR", "USD")).toBe("EUR");
    expect(currencyFromDisplay("$12.99", "US", "EUR")).toBe("USD");
    expect(currencyFromDisplay("$12.99", "CA", "EUR")).toBe("CAD");
    expect(currencyFromDisplay("GBP 9.50", "GB", "EUR")).toBe("GBP");
    expect(currencyFromDisplay(null, "FR", "EUR")).toBe("EUR");
  });

  it("parses delivery lines", () => {
    expect(shippingFromDelivery("Free delivery", "USD")).toEqual({ amount: 0, currency: "USD" });
    expect(shippingFromDelivery("+$3.99 shipping", "USD")).toEqual({
      amount: 3.99,
      currency: "USD",
    });
    expect(shippingFromDelivery("Delivery by Tue", "USD")).toBeNull();
  });

  it("keeps https public images only, deduped", () => {
    expect(
      cleanImageUrls([
        "https://img.example.com/a.jpg",
        "https://img.example.com/a.jpg#x",
        "http://img.example.com/b.jpg",
        "https://10.0.0.1/c.jpg",
        "javascript:alert(1)",
        42,
      ]),
    ).toEqual(["https://img.example.com/a.jpg"]);
  });
});

const cand = (over: Partial<ListingCandidate>): ListingCandidate => ({
  url: "https://www.aliexpress.com/item/1005000000000001.html",
  host: "www.aliexpress.com",
  source: "aliexpress",
  title: "Sunset projection lamp",
  price: { amount: 5, currency: "USD" },
  shipping: null,
  images: [],
  origin: "lens",
  position: 1,
  extractable: true,
  ...over,
});

describe("rankCandidates", () => {
  it("drops content sites, dedupes by URL, ranks suppliers and relevant titles first, caps", () => {
    const ranked = rankCandidates(
      [
        cand({ url: "https://www.reddit.com/r/x", host: "www.reddit.com", position: 1 }),
        cand({
          url: "https://blog.example.com/lamp",
          host: "blog.example.com",
          source: "blog.example.com",
          title: "My room tour",
          position: 2,
          price: null,
        }),
        cand({ position: 3, price: null, images: ["https://img.example.com/1.jpg"] }),
        cand({ position: 5, images: [] }), // duplicate URL with a price: wins, takes the image
        cand({
          url: "https://www.amazon.com/dp/B0ABCDE123",
          host: "www.amazon.com",
          source: "amazon",
          position: 4,
        }),
        cand({
          url: "https://www.google.com/shopping/product/1",
          host: "www.google.com",
          extractable: false,
          price: null,
          origin: "shopping",
        }),
      ],
      KEYWORDS,
      2,
    );
    expect(ranked.map((c) => c.source)).toEqual(["aliexpress", "amazon"]);
    expect(ranked[0]).toMatchObject({
      position: 5,
      price: { amount: 5 },
      images: ["https://img.example.com/1.jpg"],
    });
  });
});

describe("Firecrawl extraction normalization", () => {
  it("sends a JSON Schema with every field", () => {
    expect(listingExtractionJsonSchema).toMatchObject({ type: "object" });
    expect(Object.keys((listingExtractionJsonSchema as { properties: object }).properties)).toEqual(
      expect.arrayContaining([
        "price",
        "currency",
        "shippingCost",
        "deliveryDaysMin",
        "images",
        "variants",
      ]),
    );
  });

  it("bounds and cleans what the extractor returns", () => {
    const x = normalizeExtraction(
      {
        isProductPage: true,
        title: "  Sunset\nLamp  ",
        price: "6.49",
        currency: "usd",
        shippingCost: 0,
        deliveryDaysMin: 15,
        deliveryDaysMax: 8,
        images: ["https://ae01.alicdn.com/kf/a.jpg", "http://insecure/b.jpg"],
        variants: [
          { name: "Color", values: ["Red", "Red", "", "Rainbow"] },
          { name: "", values: ["x"] },
        ],
      },
      "EUR",
    )!;
    expect(x).toEqual({
      title: "Sunset Lamp",
      price: { amount: 6.49, currency: "USD" },
      shipping: { amount: 0, currency: "USD" },
      leadTimeDays: { min: 8, max: 15 },
      images: ["https://ae01.alicdn.com/kf/a.jpg"],
      variants: [{ name: "Color", values: ["Red", "Rainbow"] }],
    });
  });

  it("rejects non-product pages and absurd values", () => {
    expect(normalizeExtraction({ isProductPage: false, price: 5 }, "USD")).toBeNull();
    const x = normalizeExtraction(
      { price: 5_000_000, currency: "dollars", deliveryDaysMin: -1 },
      "EUR",
    )!;
    expect(x.price).toBeNull();
    expect(x.leadTimeDays).toBeNull();
  });
});

describe("toListing", () => {
  it("prefers extracted data and drops shipping in another currency", () => {
    const listing = toListing(cand({ shipping: { amount: 2, currency: "EUR" } }), null, KEYWORDS)!;
    expect(supplierListingSchema.parse(listing)).toEqual(listing);
    expect(listing.shipping).toBeNull();
    expect(toListing(cand({ price: null }), null, KEYWORDS)).toBeNull();
  });
});

/* Live pipeline against a fake network ----------------------------------- */

type Call = { url: URL; init?: RequestInit; body?: Record<string, unknown> };

function lensMatch(position: number, link: string, title: string, price?: number) {
  return {
    position,
    title,
    link,
    source: new URL(link).hostname,
    thumbnail: `https://encrypted-tbn0.gstatic.com/images?q=${position}`,
    image: `https://img.example.com/${position}.jpg`,
    ...(price !== undefined
      ? { price: { value: `$${price}*`, extracted_value: price, currency: "$" } }
      : {}),
  };
}

const LENS = {
  search_metadata: { status: "Success" },
  visual_matches: [
    lensMatch(1, "https://www.pinterest.com/pin/123/", "Sunset lamp aesthetic room"),
    lensMatch(
      2,
      "https://www.aliexpress.com/item/1005006123456789.html?spm=x",
      "LED Sunset Projection Lamp",
      5.12,
    ),
    lensMatch(
      3,
      "https://fr.aliexpress.com/item/1005006123456789.html",
      "Sunset lamp (duplicate)",
      5.3,
    ),
    lensMatch(
      4,
      "https://www.amazon.com/Sunset-Lamp/dp/B0ABCDE123/ref=x",
      "Sunset Lamp Projector 16 Colors",
      19.99,
    ),
    lensMatch(5, "http://169.254.169.254/latest/meta-data/", "Sunset lamp metadata"),
    lensMatch(6, "https://shop.example.com/products/sunset-lamp", "Sunset projection lamp"),
  ],
};

const SHOPPING = {
  shopping_results: [
    {
      position: 1,
      title: "Sunset Lamp LED Projector",
      product_link: "https://www.google.com/shopping/product/1?gl=us",
      source: "Walmart",
      price: "$14.97",
      extracted_price: 14.97,
      thumbnail: "https://encrypted-tbn0.gstatic.com/shopping?q=1",
      delivery: "Free delivery",
    },
  ],
};

function extraction(url: string) {
  if (url.includes("aliexpress")) {
    return {
      isProductPage: true,
      title: "LED Sunset Projection Lamp, 16 colors",
      price: 4.89,
      currency: "USD",
      shippingCost: 1.5,
      deliveryDaysMin: 8,
      deliveryDaysMax: 15,
      images: ["https://ae01.alicdn.com/kf/1.jpg", "https://ae01.alicdn.com/kf/2.jpg"],
      variants: [{ name: "Color", values: ["Sunset Red", "Rainbow"] }],
      inStock: true,
    };
  }
  if (url.includes("amazon")) {
    return {
      isProductPage: true,
      title: null,
      price: 19.99,
      currency: "USD",
      shippingCost: 0,
      images: [],
      variants: [],
    };
  }
  return { isProductPage: false };
}

function fakeNetwork(
  opts: {
    lens?: () => Response;
    shopping?: () => Response;
    firecrawl?: (url: string) => Response;
  } = {},
) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ url, init, body });
    if (url.href.startsWith(SERP)) {
      const engine = url.searchParams.get("engine");
      if (engine === "google_lens") return opts.lens?.() ?? Response.json(LENS);
      if (engine === "google_shopping") return opts.shopping?.() ?? Response.json(SHOPPING);
    }
    if (url.href === `${FC}/v2/scrape`) {
      const target = String(body?.url);
      if (opts.firecrawl) return opts.firecrawl(target);
      return Response.json({
        success: true,
        data: { json: extraction(target), metadata: { statusCode: 200 } },
      });
    }
    return new Response("unexpected", { status: 500 });
  }) as unknown as HttpFetch;
  return { fetch, calls };
}

const finderFor = (net: ReturnType<typeof fakeNetwork>) =>
  createLiveSupplierFinder({
    fetch: net.fetch,
    serpApiKey: "serp-key",
    firecrawlApiKey: "fc-key",
    serpApiBaseUrl: SERP,
    firecrawlBaseUrl: FC,
  });

const ctx = { workspaceId: "ws_live" };

describe("live SupplierFinder", () => {
  it("finds, dedupes, extracts and ranks listings with usage per billed call", async () => {
    const net = fakeNetwork();
    const { data, usage } = await finderFor(net).find(ctx, {
      imageUrl: IMAGE,
      keywords: KEYWORDS,
      country: "us",
      currency: "usd",
      limit: 3,
    });

    for (const l of data) expect(supplierListingSchema.parse(l)).toEqual(l);
    expect(data.map((l) => l.url)).toEqual([
      "https://www.aliexpress.com/item/1005006123456789.html",
      "https://www.amazon.com/dp/B0ABCDE123",
    ]);
    expect(data[0]).toMatchObject({
      source: "aliexpress",
      title: "LED Sunset Projection Lamp, 16 colors",
      price: { amount: 4.89, currency: "USD" },
      shipping: { amount: 1.5, currency: "USD" },
      leadTimeDays: { min: 8, max: 15 },
      variants: [{ name: "Color", values: ["Sunset Red", "Rainbow"] }],
    });
    // Amazon: extractor returned no title, the search title is kept.
    expect(data[1]).toMatchObject({
      title: "Sunset Lamp Projector 16 Colors",
      shipping: { amount: 0 },
    });
    expect(data[0]!.matchScore).toBeGreaterThan(data[1]!.matchScore);

    // Lens ran with the image; three candidates survived (pinterest + metadata host dropped,
    // duplicate merged), so Shopping was not needed; the shop page was not a product page.
    const lens = net.calls.find((c) => c.url.searchParams.get("engine") === "google_lens")!;
    expect(lens.url.searchParams.get("url")).toBe(IMAGE);
    expect(lens.url.searchParams.get("country")).toBe("us");
    expect(lens.url.searchParams.get("api_key")).toBe("serp-key");
    expect(net.calls.some((c) => c.url.searchParams.get("engine") === "google_shopping")).toBe(
      false,
    );
    const scrapes = net.calls.filter((c) => c.url.href === `${FC}/v2/scrape`);
    expect(scrapes).toHaveLength(3);
    expect(scrapes[0]!.init?.headers).toMatchObject({ authorization: "Bearer fc-key" });
    expect(scrapes[0]!.body).toMatchObject({ formats: [{ type: "json" }], onlyMainContent: true });
    expect(scrapes.some((c) => String(c.body?.url).includes("169.254"))).toBe(false);

    expect(usage).toEqual([
      { provider: "serpapi", model: "google_lens", costUsd: 0.015 },
      ...Array(3).fill({ provider: "firecrawl", model: "scrape_json", costUsd: 0.00495 }),
    ]);
  });

  it("routes through the brand proxy, or the SSRF-guarded agent without one", async () => {
    const net = fakeNetwork();
    await finderFor(net).find(
      { ...ctx, proxyUrl: "http://user:pass@proxy.example:8080" },
      { imageUrl: IMAGE, keywords: KEYWORDS, country: "US", currency: "USD", limit: 1 },
    );
    expect(net.calls.every((c) => c.init?.dispatcher instanceof ProxyAgent)).toBe(true);

    const direct = fakeNetwork();
    await finderFor(direct).find(ctx, {
      imageUrl: null,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
      limit: 1,
    });
    expect(direct.calls.every((c) => c.init?.dispatcher === guardedDispatcher())).toBe(true);
  });

  it("uses Google Shopping without an image and keeps search data for unscrapable Google pages", async () => {
    const net = fakeNetwork();
    const { data, usage } = await finderFor(net).find(ctx, {
      imageUrl: null,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
    });
    const shopping = net.calls.find((c) => c.url.searchParams.get("engine") === "google_shopping")!;
    expect(shopping.url.searchParams.get("q")).toBe("sunset projection lamp");
    expect(shopping.url.searchParams.get("gl")).toBe("us");
    expect(data).toEqual([
      expect.objectContaining({
        source: "walmart",
        price: { amount: 14.97, currency: "USD" },
        shipping: { amount: 0, currency: "USD" },
      }),
    ]);
    expect(usage).toEqual([{ provider: "serpapi", model: "google_shopping", costUsd: 0.015 }]);
  });

  it("falls back to search data when a scrape fails, and bills only processed scrapes", async () => {
    const net = fakeNetwork({
      firecrawl: (url) =>
        url.includes("aliexpress")
          ? Response.json({ success: false, error: "rate limit" }, { status: 429 })
          : Response.json({ success: true, data: { json: null, metadata: { statusCode: 403 } } }),
    });
    const { data, usage } = await finderFor(net).find(ctx, {
      imageUrl: IMAGE,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
      limit: 3,
    });
    expect(data.map((l) => [l.source, l.price.amount])).toEqual([
      ["aliexpress", 5.12],
      ["amazon", 19.99],
    ]);
    // 429 is not billed; the two processed scrapes (target 403) are.
    expect(usage.filter((u) => u.provider === "firecrawl")).toHaveLength(2);
  });

  it("treats SerpApi 'no results' as empty and fails loudly on auth errors", async () => {
    const empty = fakeNetwork({
      lens: () => Response.json({ error: "Google hasn't returned any results for this query." }),
      shopping: () => Response.json({ shopping_results: [] }),
    });
    const res = await finderFor(empty).find(ctx, {
      imageUrl: IMAGE,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
    });
    expect(res.data).toEqual([]);
    expect(res.usage.map((u) => u.model)).toEqual(["google_lens", "google_shopping"]);

    const denied = fakeNetwork({
      lens: () => Response.json({ error: "Invalid API key." }, { status: 401 }),
    });
    await expect(
      finderFor(denied).find(ctx, {
        imageUrl: IMAGE,
        keywords: KEYWORDS,
        country: "US",
        currency: "USD",
      }),
    ).rejects.toMatchObject({ provider: "serpapi", code: "permission_denied", retryable: false });
  });

  it("keeps Lens results when Shopping fails, and tries Shopping when Lens is down", async () => {
    const lensDown = fakeNetwork({ lens: () => new Response("oops", { status: 503 }) });
    const res = await finderFor(lensDown).find(ctx, {
      imageUrl: IMAGE,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
    });
    expect(res.data.map((l) => l.source)).toEqual(["walmart"]);

    const bothDown = fakeNetwork({
      lens: () => new Response("oops", { status: 503 }),
      shopping: () => new Response("oops", { status: 503 }),
    });
    await expect(
      finderFor(bothDown).find(ctx, {
        imageUrl: IMAGE,
        keywords: KEYWORDS,
        country: "US",
        currency: "USD",
      }),
    ).rejects.toMatchObject({ code: "provider_error", retryable: true });
  });

  it("ignores a non-public reference image and validates input", async () => {
    const net = fakeNetwork();
    await finderFor(net).find(ctx, {
      imageUrl: "https://192.168.1.10/cover.jpg",
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
      limit: 1,
    });
    expect(net.calls.some((c) => c.url.searchParams.get("engine") === "google_lens")).toBe(false);
    await expect(
      finderFor(net).find(ctx, { imageUrl: null, keywords: [], country: "US", currency: "USD" }),
    ).rejects.toThrow();
  });

  it("never returns, nor scrapes, a listing excluded at GATE 2", async () => {
    const net = fakeNetwork();
    const { data } = await finderFor(net).find(ctx, {
      imageUrl: IMAGE,
      keywords: KEYWORDS,
      country: "US",
      currency: "USD",
      limit: 3,
      // Differently written forms of the two listings returned without exclusions.
      excludeUrls: [
        "https://WWW.aliexpress.com/item/1005006123456789.html/?spm=abc#x",
        "http://www.amazon.com/dp/B0ABCDE123/",
      ],
    });
    expect(data.map((l) => l.source)).toEqual(["walmart"]);
    const scraped = net.calls
      .filter((c) => c.url.href === `${FC}/v2/scrape`)
      .map((c) => String(c.body?.url));
    expect(scraped.some((u) => u.includes("aliexpress") || u.includes("amazon"))).toBe(false);
    // Excluded candidates freed their slots, so Google Shopping topped up.
    expect(net.calls.some((c) => c.url.searchParams.get("engine") === "google_shopping")).toBe(
      true,
    );
  });

  it("refuses to run without API keys (and never calls the network)", async () => {
    const net = fakeNetwork();
    const prev = process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_KEY;
    try {
      const finder = createLiveSupplierFinder({ fetch: net.fetch, firecrawlApiKey: "k" });
      await expect(
        finder.find(ctx, { imageUrl: null, keywords: KEYWORDS, country: "US", currency: "USD" }),
      ).rejects.toBeInstanceOf(IntegrationError);
      expect(net.calls).toHaveLength(0);
    } finally {
      if (prev !== undefined) process.env.SERPAPI_KEY = prev;
    }
  });
});

describe("mock SupplierFinder", () => {
  it("is deterministic, contract-valid, sorted and metered like live", async () => {
    const finder = createSupplierFinder("mock");
    const input = { imageUrl: IMAGE, keywords: KEYWORDS, country: "FR", currency: "EUR", limit: 3 };
    const a = await finder.find(ctx, input);
    expect(await finder.find(ctx, input)).toEqual(a);
    expect(a.data).toHaveLength(3);
    a.data.forEach((l: SupplierListing) => expect(supplierListingSchema.parse(l)).toEqual(l));
    const scores = a.data.map((l) => l.matchScore);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    expect(a.usage.map((u) => u.model)).toEqual([
      "google_lens",
      "scrape_json",
      "scrape_json",
      "scrape_json",
    ]);
    const noImage = await finder.find(ctx, { ...input, imageUrl: null });
    expect(noImage.usage[0]!.model).toBe("google_shopping");
  });

  it("never returns an excluded listing and offers new ones instead", async () => {
    const finder = createSupplierFinder("mock");
    const input = { imageUrl: IMAGE, keywords: KEYWORDS, country: "US", currency: "USD", limit: 3 };
    const first = await finder.find(ctx, input);
    const rejected = first.data.map((l) => l.url);

    const next = await finder.find(ctx, {
      ...input,
      // Tracking params, fragment, trailing slash and host case do not matter.
      excludeUrls: rejected.map(
        (u) => `${u.replace("https://www.", "https://WWW.")}/?utm_source=x#top`,
      ),
    });
    expect(next.data).toHaveLength(3);
    expect(next.data.some((l) => rejected.includes(l.url))).toBe(false);
    next.data.forEach((l) => expect(supplierListingSchema.parse(l)).toEqual(l));
    expect(next.usage.filter((u) => u.provider === "firecrawl")).toHaveLength(3);
    expect(await finder.find(ctx, { ...input, excludeUrls: rejected })).toEqual(
      await finder.find(ctx, { ...input, excludeUrls: rejected }),
    );

    // Everything rejected: a shorter (possibly empty) list, never a repeat.
    const all = [...rejected, ...next.data.map((l) => l.url)];
    const third = await finder.find(ctx, { ...input, excludeUrls: all });
    expect(third.data.some((l) => all.includes(l.url))).toBe(false);
  });
});
