import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireRole } from "@/lib/auth/guards";
import {
  brand,
  campaign,
  member,
  product,
  shopifyConnection,
  tiktokAdConnection,
  tiktokProfileConnection,
} from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";

import { createSystemContext } from "./context";
import { listWorkspaceMembers } from "./members";
import { createScopedDb } from "./scoped-db";
import {
  findShopifyConnectionsByShopDomain,
  getSystemContext,
  listDueTikTokProfileConnections,
  listLaunchedCampaigns,
  markCampaignStatsSynced,
} from "./system";

let db: Database;
let close: () => Promise<void>;
let wsA: string;
let wsB: string;

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-26T12:00:00Z");

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  wsA = await insertWorkspace(db, "A");
  wsB = await insertWorkspace(db, "B");
});

afterAll(async () => {
  await close();
});

async function brandIn(ws: string) {
  return (await createScopedDb(db, ws).insert(brand, { name: "b", country: "FR", language: "fr" }))
    .id;
}

describe("getSystemContext", () => {
  it("builds a system context bound to the workspace", async () => {
    const ctx = getSystemContext(wsA, "webhook:test", db);
    expect(ctx.workspaceId).toBe(wsA);
    expect(ctx.db.workspaceId).toBe(wsA);
    expect(ctx.actor).toEqual({ kind: "system", name: "webhook:test" });
    expect(() => requireRole(ctx, "viewer")).toThrow();
  });
});

describe("findShopifyConnectionsByShopDomain", () => {
  it("returns ids across workspaces for the shop only", async () => {
    const a = createScopedDb(db, wsA);
    const b = createScopedDb(db, wsB);
    const ca = await a.insert(shopifyConnection, {
      brandId: await brandIn(wsA),
      shopDomain: "demo.myshopify.com",
      accessTokenEnc: "tc1.secret",
    });
    const cb = await b.insert(shopifyConnection, {
      brandId: await brandIn(wsB),
      shopDomain: "demo.myshopify.com",
    });
    await a.insert(shopifyConnection, {
      brandId: await brandIn(wsA),
      shopDomain: "other.myshopify.com",
    });

    const refs = await findShopifyConnectionsByShopDomain(" Demo.myshopify.com ", db);
    expect(refs).toHaveLength(2);
    expect(refs).toEqual(
      expect.arrayContaining([
        { workspaceId: wsA, connectionId: ca.id },
        { workspaceId: wsB, connectionId: cb.id },
      ]),
    );
    // Ids only: no token or other columns leak.
    for (const ref of refs)
      expect(Object.keys(ref).sort()).toEqual(["connectionId", "workspaceId"]);
    expect(await findShopifyConnectionsByShopDomain("missing.myshopify.com", db)).toEqual([]);
    expect(await findShopifyConnectionsByShopDomain("  ", db)).toEqual([]);
  });
});

describe("listDueTikTokProfileConnections", () => {
  it("lists active rows with a refresh token expiring before the date, soonest first", async () => {
    const a = createScopedDb(db, wsA);
    const b = createScopedDb(db, wsB);
    const bA = await brandIn(wsA);
    const bB = await brandIn(wsB);
    const base = { displayName: "p", refreshTokenEnc: "tc1.rt", status: "active" as const };

    const soon = await b.insert(tiktokProfileConnection, {
      ...base,
      brandId: bB,
      openId: "soon",
      expiresAt: new Date(now.getTime() + HOUR),
    });
    const sooner = await a.insert(tiktokProfileConnection, {
      ...base,
      brandId: bA,
      openId: "sooner",
      expiresAt: new Date(now.getTime() - HOUR),
    });
    const unknown = await a.insert(tiktokProfileConnection, {
      ...base,
      brandId: bA,
      openId: "unknown",
      expiresAt: null,
    });
    // Not due: later expiry, inactive, or no refresh token.
    await a.insert(tiktokProfileConnection, {
      ...base,
      brandId: bA,
      openId: "later",
      expiresAt: new Date(now.getTime() + 48 * HOUR),
    });
    await a.insert(tiktokProfileConnection, {
      ...base,
      brandId: bA,
      openId: "reauth",
      status: "needs_reauth",
      expiresAt: new Date(now.getTime() - HOUR),
    });
    await b.insert(tiktokProfileConnection, {
      ...base,
      brandId: bB,
      openId: "no-refresh",
      refreshTokenEnc: null,
      expiresAt: new Date(now.getTime() - HOUR),
    });

    const before = new Date(now.getTime() + 6 * HOUR);
    const due = await listDueTikTokProfileConnections({ before, limit: 100 }, db);
    expect(due.map((d) => d.connectionId).slice(0, 2)).toEqual([sooner.id, soon.id]);
    expect(due).toHaveLength(3);
    expect(due).toContainEqual({ workspaceId: wsA, connectionId: unknown.id });
    expect(due).toContainEqual({ workspaceId: wsB, connectionId: soon.id });

    expect(await listDueTikTokProfileConnections({ before, limit: 1 }, db)).toEqual([
      { workspaceId: wsA, connectionId: sooner.id },
    ]);
    expect(await listDueTikTokProfileConnections({ before, limit: 0 }, db)).toEqual([]);
  });
});

describe("listWorkspaceMembers", () => {
  it("lists only the context workspace's members", async () => {
    const owner = await insertUser(db, "Olivia Owner");
    const viewer = await insertUser(db, "Vic Viewer");
    const outsider = await insertUser(db, "Other");
    const add = (organizationId: string, userId: string, role: string, at: number) =>
      db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        role,
        createdAt: new Date(at),
      });
    await add(wsA, owner, "owner", 1);
    await add(wsA, viewer, "viewer", 2);
    await add(wsB, outsider, "creative", 3);
    await add(wsA, outsider, "admin", 4); // unknown role: ignored

    const members = await listWorkspaceMembers(
      createSystemContext(db, { workspaceId: wsA, name: "t" }),
      db,
    );
    expect(members.map((m) => [m.userId, m.role])).toEqual([
      [owner, "owner"],
      [viewer, "viewer"],
    ]);
    expect(members[0]).toMatchObject({ name: "Olivia Owner", email: expect.any(String) });
  });
});

describe("listLaunchedCampaigns", () => {
  async function campaignIn(
    ws: string,
    values: {
      status: "draft" | "creating" | "paused" | "active" | "failed";
      launchedAt?: Date;
      updatedAt?: Date;
    },
  ) {
    const s = createScopedDb(db, ws);
    const brandId = await brandIn(ws);
    const p = await s.insert(product, {
      brandId,
      sourceType: "tiktok_video",
      sourceUrl: "https://www.tiktok.com/@a/video/1234567890123456789",
    });
    const ad = await s.insert(tiktokAdConnection, {
      brandId,
      advertiserId: `adv-${crypto.randomUUID()}`,
      name: "Ads",
    });
    return (
      await s.insert(campaign, {
        productId: p.id,
        adConnectionId: ad.id,
        config: {} as never,
        ...values,
      })
    ).id;
  }

  it("returns active and recently paused launched campaigns across workspaces, ids only", async () => {
    const active = await campaignIn(wsA, {
      status: "active",
      launchedAt: new Date(now.getTime() - 5 * HOUR),
    });
    const recentPaused = await campaignIn(wsB, {
      status: "paused",
      launchedAt: new Date(now.getTime() - 10 * HOUR),
      updatedAt: new Date(now.getTime() - 2 * HOUR),
    });
    await campaignIn(wsA, {
      status: "paused",
      launchedAt: new Date(now.getTime() - 100 * HOUR),
      updatedAt: new Date(now.getTime() - 72 * HOUR),
    });
    await campaignIn(wsA, { status: "paused" }); // never launched
    await campaignIn(wsB, { status: "draft" });

    const refs = await listLaunchedCampaigns({ limit: 50, now }, db);
    expect(refs).toEqual([
      { workspaceId: wsB, campaignId: recentPaused },
      { workspaceId: wsA, campaignId: active },
    ]);
    for (const ref of refs) expect(Object.keys(ref).sort()).toEqual(["campaignId", "workspaceId"]);
    expect(await listLaunchedCampaigns({ limit: 1, now }, db)).toHaveLength(1);
    expect(await listLaunchedCampaigns({ limit: 0, now }, db)).toEqual([]);
  });

  it("orders never synced first, then least recently synced, then oldest launch", async () => {
    for (const ws of [wsA, wsB]) await createScopedDb(db, ws).delete(campaign, undefined);
    const launched = (h: number) => new Date(now.getTime() - h * HOUR);
    const syncedLongAgo = await campaignIn(wsA, { status: "active", launchedAt: launched(50) });
    const syncedRecently = await campaignIn(wsB, { status: "active", launchedAt: launched(60) });
    const neverNewer = await campaignIn(wsA, { status: "active", launchedAt: launched(1) });
    const neverOlder = await campaignIn(wsB, { status: "active", launchedAt: launched(2) });
    await markCampaignStatsSynced(getSystemContext(wsA, "t", db), syncedLongAgo, launched(3));
    await markCampaignStatsSynced(getSystemContext(wsB, "t", db), syncedRecently, launched(1));

    const refs = await listLaunchedCampaigns({ limit: 50, now }, db);
    expect(refs.map((r) => r.campaignId)).toEqual([
      neverOlder,
      neverNewer,
      syncedLongAgo,
      syncedRecently,
    ]);
  });

  it("rotates through every campaign when the batch is smaller than the backlog", async () => {
    for (const ws of [wsA, wsB]) await createScopedDb(db, ws).delete(campaign, undefined);
    const all = new Set<string>();
    for (let i = 0; i < 5; i++) {
      all.add(
        await campaignIn(i % 2 ? wsA : wsB, {
          status: "active",
          launchedAt: new Date(now.getTime() - (10 - i) * HOUR),
        }),
      );
    }
    const seen = new Set<string>();
    for (let run = 0; run < 3; run++) {
      const at = new Date(now.getTime() + run * HOUR);
      for (const ref of await listLaunchedCampaigns({ limit: 2, now: at }, db)) {
        seen.add(ref.campaignId);
        await markCampaignStatsSynced(getSystemContext(ref.workspaceId, "t", db), ref.campaignId, at);
      }
    }
    expect(seen).toEqual(all);
  });

  it("markCampaignStatsSynced keeps updated_at and stays in its workspace", async () => {
    const pausedAt = new Date(now.getTime() - 2 * HOUR);
    const id = await campaignIn(wsA, {
      status: "paused",
      launchedAt: new Date(now.getTime() - 10 * HOUR),
      updatedAt: pausedAt,
    });
    const syncedAt = new Date(now.getTime() - HOUR);
    // Another workspace cannot stamp it.
    await markCampaignStatsSynced(getSystemContext(wsB, "t", db), id, syncedAt);
    expect((await createScopedDb(db, wsA).getById(campaign, id)).statsSyncedAt).toBeNull();

    await markCampaignStatsSynced(getSystemContext(wsA, "t", db), id, syncedAt);
    const row = await createScopedDb(db, wsA).getById(campaign, id);
    expect(row.statsSyncedAt).toEqual(syncedAt);
    // The 48 h paused window still counts from the pause, not from the sync.
    expect(row.updatedAt).toEqual(pausedAt);
  });
});
