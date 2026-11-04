/**
 * M3 QA schema additions (migration 0006): advertiser currency on
 * tiktok_ad_connection (B1), one campaign per (product, ad account) (N3) and
 * campaign.stats_synced_at for the fair stats scan (S4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScopedDb, type ScopedDb } from "@/lib/tenant/scoped-db";

import { brand, campaign, product, tiktokAdConnection } from "./schema";
import { createTestDb, insertWorkspace } from "./testing";
import type { Database } from "./types";

let db: Database;
let close: () => Promise<void>;
let a: ScopedDb;
let b: ScopedDb;
let brandA: string;
let brandB: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = createScopedDb(db, await insertWorkspace(db, "Workspace A"));
  b = createScopedDb(db, await insertWorkspace(db, "Workspace B"));
  brandA = (await a.insert(brand, { name: "A", country: "FR", language: "fr" })).id;
  brandB = (await b.insert(brand, { name: "B", country: "FR", language: "fr" })).id;
});

afterAll(async () => {
  await close();
});

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (error) {
    return error;
  }
}

const adv = () => `adv-${crypto.randomUUID()}`;

describe("tiktok_ad_connection.currency", () => {
  it("is null by default (unknown) and stores an ISO 4217 code", async () => {
    const legacy = await a.insert(tiktokAdConnection, {
      brandId: brandA,
      advertiserId: adv(),
      name: "Legacy",
    });
    expect(legacy.currency).toBeNull();
    const eur = await a.insert(tiktokAdConnection, {
      brandId: brandA,
      advertiserId: adv(),
      name: "EUR",
      currency: "EUR",
    });
    expect((await a.getById(tiktokAdConnection, eur.id)).currency).toBe("EUR");
  });

  it.each(["eur", "EURO", "E1R", ""])("refuses %j", async (currency) => {
    expect(
      await failure(
        a.insert(tiktokAdConnection, { brandId: brandA, advertiserId: adv(), name: "x", currency }),
      ),
    ).not.toBeNull();
  });
});

describe("campaign uniqueness and stats_synced_at", () => {
  async function productAndAds(s: ScopedDb, brandId: string) {
    const p = await s.insert(product, {
      brandId,
      sourceType: "tiktok_video",
      sourceUrl: "https://www.tiktok.com/@a/video/1234567890123456789",
    });
    const ad = await s.insert(tiktokAdConnection, { brandId, advertiserId: adv(), name: "Ads" });
    return { productId: p.id, adConnectionId: ad.id };
  }

  it("allows one campaign per (workspace, product, ad account)", async () => {
    const refs = await productAndAds(a, brandA);
    const first = await a.insert(campaign, { ...refs, config: {} as never });
    expect(first.statsSyncedAt).toBeNull();
    expect(await failure(a.insert(campaign, { ...refs, config: {} as never }))).not.toBeNull();

    // Same product on another ad account is fine.
    const other = await a.insert(tiktokAdConnection, {
      brandId: brandA,
      advertiserId: adv(),
      name: "Other",
    });
    await a.insert(campaign, { ...refs, adConnectionId: other.id, config: {} as never });
    expect(await a.count(campaign)).toBe(2);
  });

  it("does not collide across workspaces", async () => {
    const refs = await productAndAds(b, brandB);
    await b.insert(campaign, { ...refs, config: {} as never });
    expect(await b.count(campaign)).toBe(1);
  });
});
