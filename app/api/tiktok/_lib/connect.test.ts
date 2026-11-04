import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { OAuthStateError, openOAuthState, sealOAuthState } from "@/lib/auth/oauth-state";
import { createCipher } from "@/lib/crypto/cipher";
import { aadFor, decrypt } from "@/lib/crypto";
import { auditLog, brand, tiktokAdConnection, tiktokProfileConnection } from "@/lib/db/schema";
import { createTestDb, insertUser, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import type { Role } from "@/lib/domain/contracts";
import { createMockTikTokAdsClient, MOCK_ADS_AUTH_CODE } from "@/lib/integrations/tiktok-ads/mock";
import {
  createMockTikTokPostingClient,
  MOCK_LOGIN_AUTH_CODE,
} from "@/lib/integrations/tiktok-posting/mock";
import type { UserWorkspaceContext } from "@/lib/tenant/context";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { completeAdsConnection, completeProfileConnection } from "./connect";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const sealer = createCipher(randomBytes(32).toString("base64"));
const redirectUri = "http://localhost:3000/api/tiktok/login/callback";

let db: Database;
let close: () => Promise<void>;
let ws: string;
let otherWs: string;
let userId: string;
let brandId: string;

function ctxFor(role: Role, workspaceId = ws): UserWorkspaceContext {
  return {
    workspaceId,
    db: createScopedDb(db, workspaceId),
    actor: { kind: "user", userId, role, name: "Test", email: "t@example.test" },
  };
}

/** Simulates start route + TikTok redirect: seal on start, open with the returned state. */
function roundTrip(
  provider: "tiktok_ads" | "tiktok_login",
  input: { workspaceId?: string; userId?: string; brandId?: string } = {},
  tamper?: (state: string) => string,
) {
  const { state, sealed } = sealOAuthState(
    provider,
    {
      workspaceId: input.workspaceId ?? ws,
      userId: input.userId ?? userId,
      data: { brandId: input.brandId ?? brandId },
    },
    { sealer },
  );
  return openOAuthState(provider, sealed, tamper ? tamper(state) : state, { sealer });
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ws = await insertWorkspace(db, "TikTok WS");
  otherWs = await insertWorkspace(db, "Other WS");
  userId = await insertUser(db, "Media Buyer");
}, 240_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(brand); // cascades to connections
  brandId = (
    await createScopedDb(db, ws).insert(brand, { name: "B", country: "FR", language: "fr" })
  ).id;
});

describe("ads callback", () => {
  it("stores one active connection per granted advertiser, token encrypted at rest", async () => {
    const ctx = ctxFor("media_buyer");
    const client = createMockTikTokAdsClient();
    const result = await completeAdsConnection(ctx, {
      flow: roundTrip("tiktok_ads"),
      code: MOCK_ADS_AUTH_CODE,
      client,
    });
    expect(result.connections).toHaveLength(2);

    const rows = await ctx.db.select(tiktokAdConnection);
    expect(rows).toHaveLength(2);
    const { accessToken } = await client.exchangeAuthCode({ code: MOCK_ADS_AUTH_CODE });
    for (const row of rows) {
      expect(row).toMatchObject({ brandId, status: "active" });
      expect(row.accessTokenEnc).not.toContain(accessToken);
      expect(
        decrypt(row.accessTokenEnc!, {
          aad: aadFor("tiktok_ad_connection", row.id, "access_token"),
        }),
      ).toBe(accessToken);
      // Bound to its row: another row's AAD cannot open it.
      const other = rows.find((r) => r.id !== row.id)!;
      expect(() =>
        decrypt(row.accessTokenEnc!, {
          aad: aadFor("tiktok_ad_connection", other.id, "access_token"),
        }),
      ).toThrow();
    }

    const audits = await ctx.db.select(auditLog);
    expect(audits.map((a) => a.action)).toEqual(["connection.create", "connection.create"]);
    expect(JSON.stringify(audits)).not.toContain(accessToken);
  });

  it("reconnecting updates the same rows and audits an update", async () => {
    const ctx = ctxFor("owner");
    const client = createMockTikTokAdsClient();
    await completeAdsConnection(ctx, {
      flow: roundTrip("tiktok_ads"),
      code: MOCK_ADS_AUTH_CODE,
      client,
    });
    const again = await completeAdsConnection(ctx, {
      flow: roundTrip("tiktok_ads"),
      code: MOCK_ADS_AUTH_CODE,
      client,
    });
    expect(again.connections.every((c) => !c.created)).toBe(true);
    expect(await ctx.db.count(tiktokAdConnection)).toBe(2);
  });

  it("rejects a bad or tampered state", () => {
    expect(() => roundTrip("tiktok_ads", {}, (s) => `${s.slice(0, -1)}x`)).toThrow(OAuthStateError);
    expect(() => roundTrip("tiktok_ads", {}, () => "")).toThrow(OAuthStateError);
  });

  it("rejects a flow started in another workspace or by another user", async () => {
    const ctx = ctxFor("media_buyer");
    const client = createMockTikTokAdsClient();
    await expect(
      completeAdsConnection(ctx, {
        flow: roundTrip("tiktok_ads", { workspaceId: otherWs }),
        code: MOCK_ADS_AUTH_CODE,
        client,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError);
    await expect(
      completeAdsConnection(ctx, {
        flow: roundTrip("tiktok_ads", { userId: "someone-else" }),
        code: MOCK_ADS_AUTH_CODE,
        client,
      }),
    ).rejects.toBeInstanceOf(OAuthStateError);
    expect(await ctx.db.count(tiktokAdConnection)).toBe(0);
  });

  it("requires connection:create", async () => {
    await expect(
      completeAdsConnection(ctxFor("creative"), {
        flow: roundTrip("tiktok_ads"),
        code: MOCK_ADS_AUTH_CODE,
        client: createMockTikTokAdsClient(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("propagates a failed code exchange without writing anything", async () => {
    const ctx = ctxFor("media_buyer");
    await expect(
      completeAdsConnection(ctx, {
        flow: roundTrip("tiktok_ads"),
        code: "bad-code",
        client: createMockTikTokAdsClient(),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await ctx.db.count(tiktokAdConnection)).toBe(0);
    expect(await ctx.db.count(auditLog)).toBe(0);
  });

  it("passes each advertiser's currency to the save path and refuses one without (B1)", async () => {
    const ctx = ctxFor("media_buyer");
    const mock = createMockTikTokAdsClient();
    const seen: (string | undefined)[] = [];
    await completeAdsConnection(ctx, {
      flow: roundTrip("tiktok_ads"),
      code: MOCK_ADS_AUTH_CODE,
      client: {
        ...mock,
        listAdvertisers: async (input) => {
          const list = await mock.listAdvertisers(input);
          seen.push(...list.map((a) => a.currency));
          return list;
        },
      },
    });
    expect(seen.sort()).toEqual(["EUR", "USD"]);

    await db.delete(tiktokAdConnection);
    await db.delete(auditLog);
    await expect(
      completeAdsConnection(ctx, {
        flow: roundTrip("tiktok_ads"),
        code: MOCK_ADS_AUTH_CODE,
        client: {
          ...mock,
          listAdvertisers: async (input) =>
            (await mock.listAdvertisers(input)).map((a) => ({ ...a, currency: undefined })),
        },
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(await ctx.db.count(tiktokAdConnection)).toBe(0);
  });
});

describe("login kit callback", () => {
  it("stores the profile with encrypted tokens, expiry and private direct posting", async () => {
    const ctx = ctxFor("media_buyer");
    const now = () => new Date("2026-10-25T10:00:00.000Z");
    const client = createMockTikTokPostingClient({ now });
    const result = await completeProfileConnection(ctx, {
      flow: roundTrip("tiktok_login"),
      code: MOCK_LOGIN_AUTH_CODE,
      redirectUri,
      client,
    });
    const row = await ctx.db.getById(tiktokProfileConnection, result.id);
    const token = await client.exchangeAuthCode({ code: MOCK_LOGIN_AUTH_CODE, redirectUri });

    expect(row).toMatchObject({
      brandId,
      openId: token.openId,
      displayName: "Mock Creator",
      postingMode: "direct",
      status: "active",
    });
    expect(row.expiresAt?.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(row.accessTokenEnc).not.toContain(token.accessToken);
    expect(row.refreshTokenEnc).not.toContain(token.refreshToken);
    expect(
      decrypt(row.refreshTokenEnc!, {
        aad: aadFor("tiktok_profile_connection", row.id, "refresh_token"),
      }),
    ).toBe(token.refreshToken);
    // Access and refresh envelopes are not interchangeable.
    expect(() =>
      decrypt(row.accessTokenEnc!, {
        aad: aadFor("tiktok_profile_connection", row.id, "refresh_token"),
      }),
    ).toThrow();

    const [audit] = await ctx.db.select(auditLog, {
      where: (t) => eq(t.targetId, row.id),
    });
    expect(audit.action).toBe("connection.create");
  });

  it("rejects a state sealed for the ads flow", () => {
    const { state, sealed } = sealOAuthState(
      "tiktok_ads",
      { workspaceId: ws, userId, data: { brandId } },
      { sealer },
    );
    expect(() => openOAuthState("tiktok_login", sealed, state, { sealer })).toThrow(
      OAuthStateError,
    );
  });

  it("rejects a brand from another workspace", async () => {
    const foreign = await createScopedDb(db, otherWs).insert(brand, {
      name: "X",
      country: "FR",
      language: "fr",
    });
    await expect(
      completeProfileConnection(ctxFor("owner"), {
        flow: roundTrip("tiktok_login", { brandId: foreign.id }),
        code: MOCK_LOGIN_AUTH_CODE,
        redirectUri,
        client: createMockTikTokPostingClient(),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
