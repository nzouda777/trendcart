import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ForbiddenError } from "@/lib/auth/errors";
import { getAiBudget } from "@/lib/ai/metering";
import { auditLog, workspaceSettings } from "@/lib/db/schema";
import { DEFAULT_ANALYSIS_TIMEOUT_SEC } from "@/lib/domain/settings";
import { createScopedDb } from "@/lib/tenant/scoped-db";
import { buildCallContext } from "@/lib/workflows/call-context";

import { getWorkspaceSettings, updateWorkspaceSettings } from "../settings";

import { setupTestEnv, type TestEnv } from "./helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
}, 240_000);
afterAll(async () => env.close());
beforeEach(async () => {
  await env.db.delete(auditLog);
  await env.db.delete(workspaceSettings);
});

describe("workspace settings", () => {
  it("defaults when nothing is saved", async () => {
    const s = await getWorkspaceSettings(env.a.viewer);
    expect(s.analysisTimeoutSec).toEqual({
      value: DEFAULT_ANALYSIS_TIMEOUT_SEC,
      isDefault: true,
      defaultValue: DEFAULT_ANALYSIS_TIMEOUT_SEC,
    });
    expect(s.analysisModel.isDefault).toBe(true);
    expect(s.updatedAt).toBeNull();
  });

  it("everyone reads, only owners change", async () => {
    for (const role of ["viewer", "creative", "media_buyer"] as const) {
      await expect(
        updateWorkspaceSettings(env.a[role], { analysisTimeoutSec: 120 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(getWorkspaceSettings(env.system(env.wsA))).rejects.toBeInstanceOf(ForbiddenError);
    const saved = await updateWorkspaceSettings(env.a.owner, {
      analysisModel: "gemini-3.5-flash-lite",
      copywritingModel: "claude-sonnet-5-5",
      aiMonthlyCapUsd: 12.5,
      analysisTimeoutSec: 120,
    });
    expect(saved.analysisModel).toMatchObject({ value: "gemini-3.5-flash-lite", isDefault: false });
    expect(saved.aiMonthlyCapUsd.value).toBe(12.5);
    expect(saved.copywritingTimeoutSec.isDefault).toBe(true);
    expect((await getWorkspaceSettings(env.a.viewer)).analysisTimeoutSec.value).toBe(120);
  });

  it("validates choices and limits", async () => {
    for (const bad of [
      { analysisModel: "gpt-4o" },
      { copywritingModel: "gemini-3.8-flash" },
      { analysisTimeoutSec: 10 },
      { copywritingTimeoutSec: 600 },
      { analysisTimeoutSec: 12.5 },
      { aiMonthlyCapUsd: -1 },
    ]) {
      await expect(updateWorkspaceSettings(env.a.owner, bad as never)).rejects.toBeInstanceOf(
        ZodError,
      );
    }
  });

  it("null resets a field, omitted fields stay, and changes are audited", async () => {
    await updateWorkspaceSettings(env.a.owner, { analysisTimeoutSec: 120, aiMonthlyCapUsd: 5 });
    const after = await updateWorkspaceSettings(env.a.owner, { analysisTimeoutSec: null });
    expect(after.analysisTimeoutSec.isDefault).toBe(true);
    expect(after.aiMonthlyCapUsd.value).toBe(5);

    // Saving the same values again writes no audit entry.
    await updateWorkspaceSettings(env.a.owner, { aiMonthlyCapUsd: 5 });

    const audits = await env.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "settings.update"));
    expect(audits).toHaveLength(2);
    const changes = audits.map((a) => (a.metadata as { changed: Record<string, unknown> }).changed);
    expect(changes).toContainEqual({ analysisTimeoutSec: { from: 120, to: null } });
    expect(changes).toContainEqual({
      analysisTimeoutSec: { from: null, to: 120 },
      aiMonthlyCapUsd: { from: null, to: 5 },
    });
  });

  it("is isolated per workspace", async () => {
    await updateWorkspaceSettings(env.a.owner, { analysisTimeoutSec: 90 });
    expect((await getWorkspaceSettings(env.bOwner)).analysisTimeoutSec.isDefault).toBe(true);
    await updateWorkspaceSettings(env.bOwner, { analysisTimeoutSec: 200 });
    expect((await getWorkspaceSettings(env.a.owner)).analysisTimeoutSec.value).toBe(90);
  });

  it("feeds the AI calls: call context and monthly budget", async () => {
    await updateWorkspaceSettings(env.a.owner, {
      analysisModel: "gemini-3.6-flash",
      analysisTimeoutSec: 100,
      aiMonthlyCapUsd: 0,
    });
    const dbA = createScopedDb(env.db, env.wsA);
    const call = await buildCallContext(dbA);
    expect(call.ai).toMatchObject({
      analysisModel: "gemini-3.6-flash",
      analysisTimeoutMs: 100_000,
    });

    const budget = await getAiBudget(dbA);
    expect(budget.capUsd).toBe(0);
    expect(budget.exceeded).toBe(true);
    // Workspace B keeps the env default.
    expect((await getAiBudget(createScopedDb(env.db, env.wsB))).capUsd).toBeGreaterThan(0);
  });
});
