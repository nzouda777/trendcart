import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { aadFor, decrypt, encrypt } from "@/lib/crypto";
import { auditLog, brand, tiktokProfileConnection } from "@/lib/db/schema";
import { createTestDb, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import { IntegrationError } from "@/lib/domain/contracts";
import { createMockTikTokPostingClient } from "@/lib/integrations/tiktok-posting/mock";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { isAuthorizedCron, refreshProfileTokens } from "./refresh";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const NOW = new Date("2026-10-25T10:00:00.000Z");
const now = () => NOW;
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

let db: Database;
let close: () => Promise<void>;
let wsA: string;
let wsB: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  wsA = await insertWorkspace(db, "A");
  wsB = await insertWorkspace(db, "B");
}, 240_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(brand);
});

async function insertProfile(
  workspaceId: string,
  opts: { refreshToken: string; expiresAt: Date | null; status?: "active" | "needs_reauth" },
) {
  const scoped = createScopedDb(db, workspaceId);
  const b = await scoped.insert(brand, { name: "B", country: "FR", language: "fr" });
  const id = crypto.randomUUID();
  return scoped.insert(tiktokProfileConnection, {
    id,
    brandId: b.id,
    openId: `open-${id}`,
    displayName: "P",
    accessTokenEnc: encrypt("old-access", {
      aad: aadFor("tiktok_profile_connection", id, "access_token"),
    }),
    refreshTokenEnc: encrypt(opts.refreshToken, {
      aad: aadFor("tiktok_profile_connection", id, "refresh_token"),
    }),
    expiresAt: opts.expiresAt,
    status: opts.status ?? "active",
  });
}

describe("cron auth", () => {
  it("accepts only the exact bearer secret and fails closed when unset", () => {
    expect(isAuthorizedCron("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedCron("Bearer wrong", "s3cret")).toBe(false);
    expect(isAuthorizedCron("s3cret", "s3cret")).toBe(false);
    expect(isAuthorizedCron(null, "s3cret")).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});

describe("profile token refresh", () => {
  it("refreshes due tokens across workspaces and rotates both tokens", async () => {
    const dueA = await insertProfile(wsA, { refreshToken: "mock-refresh-a", expiresAt: hours(1) });
    const dueB = await insertProfile(wsB, { refreshToken: "mock-refresh-b", expiresAt: hours(-2) });
    const fresh = await insertProfile(wsA, {
      refreshToken: "mock-refresh-c",
      expiresAt: hours(20),
    });

    const client = createMockTikTokPostingClient({ now });
    const summary = await refreshProfileTokens({ db, client, now });
    expect(summary).toMatchObject({ scanned: 2, refreshed: 2, revoked: 0, failed: 0 });

    const a = await createScopedDb(db, wsA).getById(tiktokProfileConnection, dueA.id);
    expect(a.expiresAt?.toISOString()).toBe(hours(24).toISOString());
    const newRefresh = decrypt(a.refreshTokenEnc!, {
      aad: aadFor("tiktok_profile_connection", a.id, "refresh_token"),
    });
    expect(newRefresh).not.toBe("mock-refresh-a");
    expect(
      decrypt(a.accessTokenEnc!, {
        aad: aadFor("tiktok_profile_connection", a.id, "access_token"),
      }),
    ).not.toBe("old-access");

    const b = await createScopedDb(db, wsB).getById(tiktokProfileConnection, dueB.id);
    expect(b.status).toBe("active");
    const untouched = await createScopedDb(db, wsA).getById(tiktokProfileConnection, fresh.id);
    expect(untouched.refreshTokenEnc).toBe(fresh.refreshTokenEnc);

    // Idempotent: nothing is due any more.
    expect((await refreshProfileTokens({ db, client, now })).scanned).toBe(0);
  });

  it("marks revoked grants needs_reauth with an audit entry, in the row's workspace", async () => {
    const row = await insertProfile(wsB, { refreshToken: "revoked-x", expiresAt: hours(2) });
    const summary = await refreshProfileTokens({
      db,
      client: createMockTikTokPostingClient({ now }),
      now,
    });
    expect(summary).toMatchObject({ revoked: 1, refreshed: 0 });

    const scopedB = createScopedDb(db, wsB);
    expect((await scopedB.getById(tiktokProfileConnection, row.id)).status).toBe("needs_reauth");
    const [audit] = await scopedB.select(auditLog);
    expect(audit).toMatchObject({ action: "connection.update", targetId: row.id });
    expect(audit.metadata).toMatchObject({
      status: "needs_reauth",
      system: "cron:tiktok-token-refresh",
    });
    expect(await createScopedDb(db, wsA).count(auditLog)).toBe(0);

    // needs_reauth rows are not retried.
    expect(
      (await refreshProfileTokens({ db, client: createMockTikTokPostingClient(), now })).scanned,
    ).toBe(0);
  });

  it("leaves rows untouched on transient errors", async () => {
    const row = await insertProfile(wsA, { refreshToken: "mock-refresh-t", expiresAt: hours(1) });
    const client = createMockTikTokPostingClient({ now });
    client.refreshToken = vi.fn(async () => {
      throw new IntegrationError("tiktok_posting", "provider_error", "502");
    });
    const summary = await refreshProfileTokens({ db, client, now });
    expect(summary).toMatchObject({ failed: 1, refreshed: 0, revoked: 0 });
    const after = await createScopedDb(db, wsA).getById(tiktokProfileConnection, row.id);
    expect(after).toMatchObject({ status: "active", refreshTokenEnc: row.refreshTokenEnc });
  });

  it("skips a row whose lock is held by another run", async () => {
    await insertProfile(wsA, { refreshToken: "mock-refresh-l", expiresAt: hours(1) });
    const client = createMockTikTokPostingClient({ now });
    const spy = vi.spyOn(client, "refreshToken");
    const summary = await refreshProfileTokens({
      db,
      client,
      now,
      limiter: { take: async () => {}, withLock: async () => null },
    });
    expect(summary).toMatchObject({ scanned: 1, skipped: 1 });
    expect(spy).not.toHaveBeenCalled();
  });
});
