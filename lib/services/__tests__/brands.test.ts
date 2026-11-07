import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { auditLog, brand, campaign, product, proxy, tiktokAdConnection } from "@/lib/db/schema";
import { createMockProxyChecker } from "@/lib/integrations/proxy-check/mock";
import { createScopedDb } from "@/lib/tenant/scoped-db";
import { buildCallContext } from "@/lib/workflows/call-context";

import {
  clearBrandProxy,
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  setBrandProxy,
  testBrandProxy,
  toggleBrandProxy,
  updateBrand,
} from "../brands";
import { ServiceError } from "../errors";

import { fakeIntegrations, newBrandInput, setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(brand);
});

const PROXY = "http://alice:s3cret@proxy.example.net:8080";

describe("brand permissions", () => {
  it("only owners create and delete; media buyers update; everyone reads", async () => {
    const { a } = env;
    for (const role of ["viewer", "creative", "media_buyer"] as const) {
      await expect(createBrand(a[role], newBrandInput())).rejects.toBeInstanceOf(ForbiddenError);
    }
    const created = await createBrand(a.owner, newBrandInput());

    for (const role of ["viewer", "creative", "media_buyer", "owner"] as const) {
      expect((await listBrands(a[role])).map((b) => b.id)).toEqual([created.id]);
      expect((await getBrand(a[role], created.id)).name).toBe("Acme");
    }

    for (const role of ["viewer", "creative"] as const) {
      await expect(updateBrand(a[role], created.id, { name: "X" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect((await updateBrand(a.media_buyer, created.id, { name: "Renamed" })).name).toBe(
      "Renamed",
    );

    for (const role of ["viewer", "creative", "media_buyer"] as const) {
      await expect(deleteBrand(a[role], created.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await deleteBrand(a.owner, created.id);
    expect(await listBrands(a.owner)).toEqual([]);
  });

  it("system actors cannot call services", async () => {
    await expect(listBrands(env.system(env.wsA))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("brand settings", () => {
  it("validates and stores settings, and audits create/update/budget changes", async () => {
    const created = await createBrand(env.a.owner, {
      ...newBrandInput(),
      defaultTestBudget: 50,
      minMargin: 0.3,
      pricingRule: { multiplier: 2.5, roundTo: 0.99 },
    });
    expect(created).toMatchObject({
      country: "FR",
      language: "fr",
      currency: "EUR",
      defaultTestBudget: 50,
      minMargin: 0.3,
      pricingRule: { multiplier: 2.5, roundTo: 0.99 },
      proxy: { configured: false },
    });

    await expect(createBrand(env.a.owner, { ...newBrandInput(), country: "fr" })).rejects.toThrow();
    await expect(createBrand(env.a.owner, { ...newBrandInput(), minMargin: 2 })).rejects.toThrow();
    await expect(updateBrand(env.a.owner, created.id, {})).rejects.toThrow();

    const updated = await updateBrand(env.a.media_buyer, created.id, {
      defaultTestBudget: 80,
      language: "en",
    });
    // Untouched settings keep their values (no defaults injected by the patch).
    expect(updated).toMatchObject({ currency: "EUR", country: "FR", language: "en" });
    const actions = (await env.a.owner.db.select(auditLog)).map((e) => e.action).sort();
    expect(actions).toEqual(["brand.create", "brand.update", "campaign.budget_change"]);
  });
});

describe("brand tenant isolation", () => {
  it("workspace B cannot see, change or delete workspace A brands", async () => {
    const created = await createBrand(env.a.owner, newBrandInput());
    const b = env.bOwner;
    expect(await listBrands(b)).toEqual([]);
    await expect(getBrand(b, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateBrand(b, created.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteBrand(b, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setBrandProxy(b, created.id, { url: PROXY })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(clearBrandProxy(b, created.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getBrand(env.a.owner, created.id)).name).toBe("Acme");
  });
});

describe("brand proxy", () => {
  it("encrypts the URL, shows only scheme and host, and audits without secrets", async () => {
    const created = await createBrand(env.a.owner, newBrandInput());
    await expect(setBrandProxy(env.a.creative, created.id, { url: PROXY })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Exactly http, https, socks5; public hosts only (QA S4).
    for (const bad of [
      "ftp://x.example",
      "socks5h://u:p@proxy.example.net:1080",
      "socks4://proxy.example.net:1080",
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "socks5://2130706433:1080",
      "http://10.1.2.3:3128",
      "http://172.20.0.5:3128",
      "http://192.168.1.10:3128",
      "http://100.64.0.1:3128",
      "http://169.254.169.254",
      "http://[::1]:8080",
      "http://[fd00::1]:8080",
      "http://[fe80::1]:8080",
      "http://proxy.internal:8080",
    ]) {
      await expect(
        setBrandProxy(env.a.media_buyer, created.id, { url: bad }),
        bad,
      ).rejects.toThrow();
    }
    for (const ok of [
      "https://u:p@proxy.example.net:443",
      "socks5://u:p@proxy.example.net:1080",
      "http://203.0.113.7:3128",
    ]) {
      await setBrandProxy(env.a.media_buyer, created.id, { url: ok });
    }
    await clearBrandProxy(env.a.media_buyer, created.id);
    await env.db.delete(auditLog);

    const dto = await setBrandProxy(env.a.media_buyer, created.id, { url: PROXY });
    expect(dto).toMatchObject({
      configured: true,
      enabled: true,
      display: "http://proxy.example.net:8080",
    });

    const [row] = await env.a.owner.db.select(proxy);
    expect(row.urlEnc).not.toContain("s3cret");
    expect(row.urlEnc.startsWith("tc1.")).toBe(true);

    const listed = await getBrand(env.a.viewer, created.id);
    expect(JSON.stringify(listed)).not.toContain("s3cret");
    expect(listed.proxy.display).toBe("http://proxy.example.net:8080");

    // Adapters get the decrypted URL only through the call context.
    const call = await buildCallContext(createScopedDb(env.db, env.wsA), created.id);
    expect(call.proxyUrl).toBe(PROXY);

    const off = await toggleBrandProxy(env.a.media_buyer, created.id, false);
    expect(off.enabled).toBe(false);
    expect((await buildCallContext(createScopedDb(env.db, env.wsA), created.id)).proxyUrl).toBe(
      undefined,
    );

    // Replacing keeps one row per brand.
    await setBrandProxy(env.a.media_buyer, created.id, { url: "socks5://proxy2.example.net:1080" });
    expect(await env.a.owner.db.count(proxy)).toBe(1);

    await clearBrandProxy(env.a.media_buyer, created.id);
    expect(await env.a.owner.db.count(proxy)).toBe(0);
    await expect(toggleBrandProxy(env.a.media_buyer, created.id, true)).rejects.toBeInstanceOf(
      ServiceError,
    );

    const audits = await env.a.owner.db.select(auditLog, {
      where: eq(auditLog.action, "proxy.update"),
    });
    expect(audits).toHaveLength(4);
    expect(JSON.stringify(audits)).not.toContain("s3cret");
  });
});

describe("deleteBrand", () => {
  it("refuses while products have campaigns or Shopify pages", async () => {
    const created = await createBrand(env.a.owner, newBrandInput());
    const db = env.a.owner.db;
    const p = await db.insert(product, {
      brandId: created.id,
      sourceType: "product_link",
      sourceUrl: "https://shop.example.com/p/1",
    });
    const ad = await db.insert(tiktokAdConnection, {
      brandId: created.id,
      advertiserId: "adv_1",
      name: "Ads",
    });
    await db.insert(campaign, {
      productId: p.id,
      adConnectionId: ad.id,
      config: {
        name: "c",
        objective: "TRAFFIC",
        budget: { mode: "daily", amount: 20, level: "campaign" },
        landingPageUrl: "https://shop.example.com/p/1",
        adGroups: [],
      },
    });
    await expect(deleteBrand(env.a.owner, created.id)).rejects.toMatchObject({
      code: "precondition_failed",
    });

    await db.delete(campaign, undefined);
    await deleteBrand(env.a.owner, created.id);
    expect(await db.count(product)).toBe(0);
  });
});

describe("proxy test", () => {
  const deps = { integrations: fakeIntegrations({ proxyChecker: createMockProxyChecker() }) };

  it("follows the brand proxy state: direct, proxied, then direct when disabled", async () => {
    const created = await createBrand(env.a.owner, newBrandInput());
    expect(await testBrandProxy(env.a.owner, created.id, deps)).toMatchObject({
      route: "direct",
      simulated: true,
    });

    await setBrandProxy(env.a.owner, created.id, { url: PROXY });
    const proxied = await testBrandProxy(env.a.media_buyer, created.id, deps);
    expect(proxied).toMatchObject({ route: "proxy", proxyKind: "http", simulated: true });
    expect(JSON.stringify(proxied)).not.toContain("s3cret");

    await toggleBrandProxy(env.a.owner, created.id, false);
    expect((await testBrandProxy(env.a.owner, created.id, deps)).route).toBe("direct");
  });

  it("is refused to viewers and creatives, and across workspaces", async () => {
    const created = await createBrand(env.a.owner, newBrandInput());
    for (const role of ["viewer", "creative"] as const) {
      await expect(testBrandProxy(env.a[role], created.id, deps)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(testBrandProxy(env.bOwner, created.id, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
