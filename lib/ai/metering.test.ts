import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { usageMonthly } from "@/lib/db/schema";
import { createTestDb, insertWorkspace } from "@/lib/db/testing";
import type { Database } from "@/lib/db/types";
import { IntegrationError, type AiUsage } from "@/lib/domain/contracts";
import { createScopedDb, type ScopedDb } from "@/lib/tenant/scoped-db";

import {
  assertAiBudget,
  DEFAULT_AI_MONTHLY_CAP_USD,
  getAiBudget,
  getAiMonthlyCapUsd,
  getMonthlyUsage,
  meteredCall,
  monthKey,
  recordAiUsage,
} from "./metering";
import { priceFor, tokenCostUsd } from "./pricing";

let db: Database;
let close: () => Promise<void>;
let a: ScopedDb;
let b: ScopedDb;

const OCT = () => new Date("2026-10-25T12:00:00Z");
const NOV = () => new Date("2026-11-01T00:00:01Z");
const use = (costUsd: number): AiUsage => ({
  provider: "google",
  model: "gemini-3.8-flash",
  costUsd,
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  a = createScopedDb(db, await insertWorkspace(db, "Meter A"));
  b = createScopedDb(db, await insertWorkspace(db, "Meter B"));
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(usageMonthly);
});

describe("cap configuration", () => {
  it("defaults and parses AI_MONTHLY_CAP_USD", () => {
    expect(getAiMonthlyCapUsd({})).toBe(DEFAULT_AI_MONTHLY_CAP_USD);
    expect(getAiMonthlyCapUsd({ AI_MONTHLY_CAP_USD: "120.5" })).toBe(120.5);
    expect(getAiMonthlyCapUsd({ AI_MONTHLY_CAP_USD: "0" })).toBe(0);
    expect(() => getAiMonthlyCapUsd({ AI_MONTHLY_CAP_USD: "-1" })).toThrow();
    expect(() => getAiMonthlyCapUsd({ AI_MONTHLY_CAP_USD: "lots" })).toThrow();
  });

  it("keys months in UTC", () => {
    expect(monthKey(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthKey(NOV())).toBe("2026-11");
  });
});

describe("recordAiUsage", () => {
  it("accumulates cost and calls per workspace and month", async () => {
    await recordAiUsage(a, [use(0.012), use(0.0031)], { now: OCT });
    await recordAiUsage(a, [use(0.5)], { now: OCT });
    await recordAiUsage(a, [use(1)], { now: NOV });
    await recordAiUsage(b, [use(2)], { now: OCT });

    expect(await getMonthlyUsage(a, OCT())).toEqual({
      month: "2026-10",
      aiCostUsd: 0.5151,
      apiCalls: 3,
    });
    expect(await getMonthlyUsage(a, NOV())).toEqual({
      month: "2026-11",
      aiCostUsd: 1,
      apiCalls: 1,
    });
    expect(await getMonthlyUsage(b, OCT())).toEqual({
      month: "2026-10",
      aiCostUsd: 2,
      apiCalls: 1,
    });
  });

  it("is safe under concurrent increments", async () => {
    await Promise.all(Array.from({ length: 10 }, () => recordAiUsage(a, [use(0.1)], { now: OCT })));
    expect(await getMonthlyUsage(a, OCT())).toEqual({
      month: "2026-10",
      aiCostUsd: 1,
      apiCalls: 10,
    });
  });

  it("ignores empty usage and rejects malformed entries", async () => {
    await expect(recordAiUsage(a, [], { now: OCT })).resolves.toMatchObject({ calls: 0 });
    expect(await a.count(usageMonthly)).toBe(0);
    await expect(recordAiUsage(a, [use(-1)], { now: OCT })).rejects.toThrow();
  });
});

describe("cap enforcement", () => {
  it("blocks calls once the cap is reached and reports remaining budget", async () => {
    await recordAiUsage(a, [use(4.5)], { now: OCT });
    await expect(getAiBudget(a, { capUsd: 5, now: OCT })).resolves.toMatchObject({
      remainingUsd: 0.5,
      exceeded: false,
    });

    await recordAiUsage(a, [use(0.5)], { now: OCT });
    const blocked = assertAiBudget(a, { capUsd: 5, now: OCT });
    await expect(blocked).rejects.toBeInstanceOf(IntegrationError);
    await expect(blocked).rejects.toMatchObject({ code: "quota_exceeded", retryable: false });

    // Other workspaces and the next month are unaffected.
    await expect(assertAiBudget(b, { capUsd: 5, now: OCT })).resolves.toMatchObject({
      exceeded: false,
    });
    await expect(assertAiBudget(a, { capUsd: 5, now: NOV })).resolves.toMatchObject({
      exceeded: false,
    });
  });

  it("meteredCall checks, calls, then records (even past the cap)", async () => {
    await recordAiUsage(a, [use(4.9)], { now: OCT });
    let calls = 0;
    const res = await meteredCall(
      a,
      { workspaceId: a.workspaceId },
      async () => {
        calls++;
        return { data: "ok", usage: [use(0.4)] };
      },
      { capUsd: 5, now: OCT },
    );
    expect(res).toMatchObject({ data: "ok", costUsd: 0.4 });
    expect((await getMonthlyUsage(a, OCT())).aiCostUsd).toBe(5.3);

    await expect(
      meteredCall(
        a,
        { workspaceId: a.workspaceId },
        async () => {
          calls++;
          return { data: "no", usage: [] };
        },
        { capUsd: 5, now: OCT },
      ),
    ).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(calls).toBe(1);
  });

  it("records nothing when the call fails", async () => {
    await expect(
      meteredCall(
        a,
        { workspaceId: a.workspaceId },
        async () => {
          throw new IntegrationError("google", "provider_error", "boom");
        },
        { capUsd: 5, now: OCT },
      ),
    ).rejects.toThrow("boom");
    expect(await a.count(usageMonthly)).toBe(0);
  });

  it("refuses a call context from another workspace", async () => {
    await expect(
      meteredCall(a, { workspaceId: b.workspaceId }, async () => ({ data: 1, usage: [] })),
    ).rejects.toThrow(/different workspaces/);
  });
});

describe("pricing", () => {
  it("applies the dated Gemini price change", () => {
    expect(priceFor("gemini-3.8-flash", new Date("2026-12-31T23:00:00Z")).inputPerMTok).toBe(0.75);
    expect(priceFor("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z")).inputPerMTok).toBe(1.5);
  });

  it("over-counts unknown models instead of under-counting", () => {
    expect(tokenCostUsd("some-new-model", { inputTokens: 1_000_000 })).toBe(10);
    expect(tokenCostUsd("claude-opus-5-5", { inputTokens: 2_000, outputTokens: 1_500 })).toBe(
      0.038,
    );
  });
});
