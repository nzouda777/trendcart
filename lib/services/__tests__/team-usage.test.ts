import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { recordAiUsage } from "@/lib/ai/metering";
import { listWorkspaceMembers } from "@/lib/tenant/members";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { listMembers, type MemberDirectory } from "../team";
import { getUsage, listUsage } from "../usage";

import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());

describe("listMembers", () => {
  // The real tenant helper, pointed at the test database.
  const directory: MemberDirectory = (ctx) => listWorkspaceMembers(ctx, env.db);

  it("lists the context workspace's members only and flags the caller", async () => {
    const members = await listMembers(env.a.viewer, { directory });
    expect(members.map((m) => m.role).sort()).toEqual([
      "creative",
      "media_buyer",
      "owner",
      "viewer",
    ]);
    expect(members.filter((m) => m.isCurrentUser).map((m) => m.userId)).toEqual([
      env.a.viewer.actor.userId,
    ]);
    expect(members.some((m) => m.userId === env.bOwner.actor.userId)).toBe(false);

    const inB = await listMembers(env.bOwner, { directory });
    expect(inB.map((m) => m.userId)).toEqual([env.bOwner.actor.userId]);
  });

  it("system actors are refused", async () => {
    const spy = vi.fn(directory);
    await expect(listMembers(env.system(env.wsA), { directory: spy })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("usage", () => {
  it("is media buyer+ only, per workspace, and increments atomically", async () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const dbA = createScopedDb(env.db, env.wsA);
    const at = { now: () => now };
    await recordAiUsage(dbA, [{ provider: "openai", model: "gpt", costUsd: 0.5 }], at);
    await recordAiUsage(
      dbA,
      [
        { provider: "anthropic", model: "claude", costUsd: 0.25 },
        { provider: "serpapi", model: "search", costUsd: 0.01 },
      ],
      at,
    );

    for (const role of ["viewer", "creative"] as const) {
      await expect(getUsage(env.a[role], "2026-10")).rejects.toBeInstanceOf(ForbiddenError);
    }
    const usage = await getUsage(env.a.media_buyer, "2026-10");
    expect(usage.month).toBe("2026-10");
    expect(usage.apiCalls).toBe(3);
    expect(usage.aiCostUsd).toBeCloseTo(0.76);

    expect(await getUsage(env.a.owner, "2026-09")).toEqual({
      month: "2026-09",
      aiCostUsd: 0,
      apiCalls: 0,
    });
    await expect(getUsage(env.a.owner, "2026-13")).rejects.toThrow();
    expect((await listUsage(env.a.owner)).map((u) => u.month)).toEqual(["2026-10"]);

    // Workspace B sees nothing of A.
    expect((await getUsage(env.bOwner, "2026-10")).apiCalls).toBe(0);
    expect(await listUsage(env.bOwner)).toEqual([]);
  });
});
