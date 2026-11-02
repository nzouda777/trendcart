import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireRole } from "@/lib/auth/guards";
import { brand, member, shopifyConnection, tiktokProfileConnection } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";

import { createSystemContext } from "./context";
import { listWorkspaceMembers } from "./members";
import { createScopedDb } from "./scoped-db";
import {
  findShopifyConnectionsByShopDomain,
  getSystemContext,
  listDueTikTokProfileConnections,
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
