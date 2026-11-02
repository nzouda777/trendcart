import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { writeAudit } from "@/lib/audit";
import { ForbiddenError, NoWorkspaceError, NotFoundError } from "@/lib/auth/errors";
import { requirePermission, requireRole } from "@/lib/auth/guards";
import { auditLog, brand, member, product, usageMonthly, user, video } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";

import { createSystemContext, createUserWorkspaceContext } from "./context";
import { createScopedDb, type ScopedDb } from "./scoped-db";

let db: Database;
let close: () => Promise<void>;
let wsA: string;
let wsB: string;
let a: ScopedDb;
let b: ScopedDb;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  wsA = await insertWorkspace(db, "Workspace A");
  wsB = await insertWorkspace(db, "Workspace B");
  a = createScopedDb(db, wsA);
  b = createScopedDb(db, wsB);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  // Raw db is fine in tests: start every case from empty business tables.
  await db.delete(auditLog);
  await db.delete(usageMonthly);
  await db.delete(brand); // cascades to products, videos, ...
});

const newBrand = (name: string) => ({ name, country: "FR", language: "fr" });

describe("scoped-db isolation", () => {
  it("workspace A cannot read workspace B rows", async () => {
    const brandA = await a.insert(brand, newBrand("A brand"));
    const brandB = await b.insert(brand, newBrand("B brand"));

    expect((await a.select(brand)).map((r) => r.id)).toEqual([brandA.id]);
    expect((await b.select(brand)).map((r) => r.id)).toEqual([brandB.id]);

    expect(await a.findById(brand, brandB.id)).toBeUndefined();
    await expect(a.getById(brand, brandB.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await a.findFirst(brand, eq(brand.id, brandB.id))).toBeUndefined();
    expect(await a.count(brand)).toBe(1);

    // Even an explicit filter on B's workspace id returns nothing from A.
    expect(await a.select(brand, { where: (t) => eq(t.workspaceId, wsB) })).toEqual([]);
  });

  it("workspace A cannot update or delete workspace B rows", async () => {
    const brandB = await b.insert(brand, newBrand("B brand"));

    expect(await a.update(brand, { name: "hijacked" }, eq(brand.id, brandB.id))).toEqual([]);
    expect(await a.delete(brand, eq(brand.id, brandB.id))).toEqual([]);
    // Unfiltered writes still only touch A.
    expect(await a.update(brand, { name: "all of A" }, undefined)).toEqual([]);
    expect(await a.delete(brand, undefined)).toEqual([]);

    const still = await b.getById(brand, brandB.id);
    expect(still.name).toBe("B brand");
  });

  it("forces the bound workspace id on insert, even if one is smuggled in", async () => {
    const smuggled = { ...newBrand("sneaky"), workspaceId: wsB } as ReturnType<typeof newBrand>;
    const row = await a.insert(brand, smuggled);
    expect(row.workspaceId).toBe(wsA);
    expect(await b.count(brand)).toBe(0);

    const many = await a.insertMany(brand, [
      { ...newBrand("one"), workspaceId: wsB } as ReturnType<typeof newBrand>,
      newBrand("two"),
    ]);
    expect(many.every((r) => r.workspaceId === wsA)).toBe(true);
  });

  it("never lets an update move a row to another workspace or change its id", async () => {
    const row = await a.insert(brand, newBrand("A brand"));
    const patch = { name: "renamed", workspaceId: wsB, id: "other" } as { name: string };
    const [updated] = await a.update(brand, patch, eq(brand.id, row.id));
    expect(updated.workspaceId).toBe(wsA);
    expect(updated.id).toBe(row.id);
    expect(updated.name).toBe("renamed");
  });

  it("blocks cross-workspace references at the database level", async () => {
    const brandB = await b.insert(brand, newBrand("B brand"));
    await expect(
      a.insert(product, {
        brandId: brandB.id,
        sourceType: "product_link",
        sourceUrl: "https://example.com/p",
      }),
    ).rejects.toThrow();

    const brandA = await a.insert(brand, newBrand("A brand"));
    const productA = await a.insert(product, {
      brandId: brandA.id,
      sourceType: "tiktok_video",
      sourceUrl: "https://www.tiktok.com/@x/video/1",
    });
    await expect(
      b.insert(video, {
        productId: productA.id,
        tiktokUrl: "https://www.tiktok.com/@x/video/2",
        origin: "user_supplied",
      }),
    ).rejects.toThrow();
  });

  it("upserts within the workspace only", async () => {
    await b.insert(usageMonthly, { month: "2026-10", aiCostUsd: 5, apiCalls: 50 });

    const first = await a.upsert(
      usageMonthly,
      { month: "2026-10", aiCostUsd: 1, apiCalls: 1 },
      { target: (t) => [t.month] },
    );
    const second = await a.upsert(
      usageMonthly,
      { month: "2026-10", aiCostUsd: 2, apiCalls: 3 },
      { target: (t) => [t.month] },
    );
    expect(second.id).toBe(first.id);
    expect(second.aiCostUsd).toBe(2);

    const [rowB] = await b.select(usageMonthly);
    expect(rowB.aiCostUsd).toBe(5);
    expect(rowB.apiCalls).toBe(50);
  });

  it("supports where callbacks, ordering, limit and offset", async () => {
    await a.insertMany(brand, [newBrand("c"), newBrand("a"), newBrand("b")]);
    const names = await a.select(brand, { orderBy: (t) => t.name, limit: 2, offset: 1 });
    expect(names.map((r) => r.name)).toEqual(["b", "c"]);
    const one = await a.select(brand, { where: (t) => eq(t.name, "a") });
    expect(one).toHaveLength(1);
  });

  it("keeps transactions scoped and rolls back on error", async () => {
    await expect(
      a.transaction(async (tx) => {
        expect(tx.workspaceId).toBe(wsA);
        await tx.insert(brand, newBrand("in tx"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await a.count(brand)).toBe(0);

    const id = await a.transaction(async (tx) => (await tx.insert(brand, newBrand("ok"))).id);
    expect((await a.getById(brand, id)).workspaceId).toBe(wsA);
  });

  it("refuses tables that are not workspace-scoped and empty workspace ids", async () => {
    // @ts-expect-error auth tables are not ScopedTables
    await expect(a.select(user)).rejects.toThrow(/not a registered business table/);
    // @ts-expect-error auth tables are not ScopedTables
    await expect(a.select(member)).rejects.toThrow();
    expect(() => createScopedDb(db, "")).toThrow(/workspace id is required/);
  });

  it("rejects empty updates instead of issuing a no-op", async () => {
    await expect(a.update(brand, {}, undefined)).rejects.toThrow(/empty update/);
  });
});

describe("workspace context, guards and audit", () => {
  it("builds a user context only for members, with their role", async () => {
    const userId = await insertUser(db, "Casey Creative");
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: wsA,
      userId,
      role: "creative",
      createdAt: new Date(),
    });

    const ctx = await createUserWorkspaceContext(db, { userId, workspaceId: wsA });
    expect(ctx.actor).toMatchObject({ kind: "user", role: "creative" });
    expect(ctx.db.workspaceId).toBe(wsA);

    await expect(
      createUserWorkspaceContext(db, { userId, workspaceId: wsB }),
    ).rejects.toBeInstanceOf(NoWorkspaceError);

    expect(() => requireRole(ctx, "creative")).not.toThrow();
    expect(() => requireRole(ctx, "viewer")).not.toThrow();
    expect(() => requireRole(ctx, "media_buyer")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "gate:content_approval")).not.toThrow();
    expect(() => requirePermission(ctx, "campaign:launch")).toThrow(ForbiddenError);
    expect(() => requirePermission(ctx, "video:publish", "campaign:budget")).toThrow(
      /campaign:budget/,
    );
  });

  it("system actors never pass role guards", () => {
    const sys = createSystemContext(db, { workspaceId: wsA, name: "workflow:test" });
    expect(() => requireRole(sys, "viewer")).toThrow(ForbiddenError);
    expect(() => requirePermission(sys, "product:read")).toThrow(ForbiddenError);
  });

  it("writes redacted audit entries into the caller's workspace only", async () => {
    const userId = await insertUser(db, "Morgan Owner");
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: wsA,
      userId,
      role: "owner",
      createdAt: new Date(),
    });
    const ctx = await createUserWorkspaceContext(db, {
      userId,
      workspaceId: wsA,
      request: { ipAddress: "203.0.113.7", userAgent: "vitest" },
    });

    await writeAudit(ctx, {
      action: "connection.create",
      targetType: "shopify_connection",
      targetId: "conn_1",
      metadata: {
        shopDomain: "demo.myshopify.com",
        accessToken: "shpat_secret",
        nested: { client_secret: "s", spark_code_enc: "x", budget: 50 },
      },
    });

    const [entry] = await ctx.db.select(auditLog);
    expect(entry).toMatchObject({
      workspaceId: wsA,
      actorUserId: userId,
      action: "connection.create",
      ipAddress: "203.0.113.7",
    });
    expect(entry.metadata).toEqual({
      shopDomain: "demo.myshopify.com",
      accessToken: "[redacted]",
      nested: { client_secret: "[redacted]", spark_code_enc: "[redacted]", budget: 50 },
    });
    expect(await b.count(auditLog)).toBe(0);

    await expect(
      // @ts-expect-error unknown actions are rejected
      writeAudit(ctx, { action: "something.else" }),
    ).rejects.toThrow();
  });
});
