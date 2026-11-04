import { afterEach, describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/lib/domain/contracts";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { createMemoryLimiter } from "../concurrency";
import { draftImageUrls, MAX_VARIANTS, variantsFromListing } from "../page-input";
import { runProductStep } from "../runner";

import {
  DURABLE_STEP_ATTEMPTS,
  durableRetryDelayMs,
  gateHookToken,
  nextActionFor,
  resumeHookToken,
} from "./config";
import {
  createDurablePipeline,
  type DurableEngine,
  StaleDeploymentRunError,
  vercelWorkflowEngine,
} from "./pipeline";

const workflowApi = vi.hoisted(() => ({
  getHookByToken: vi.fn(),
  resumeHook: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
}));
vi.mock("workflow/api", () => ({
  getHookByToken: workflowApi.getHookByToken,
  resumeHook: workflowApi.resumeHook,
  getRun: () => ({ cancel: workflowApi.cancel }),
  start: vi.fn(),
}));

/** Just enough of a WorkspaceContext for code paths that only read the product. */
function fakeCtx(status = "sourcing"): WorkspaceContext {
  const row = { id: "p1", status };
  return {
    workspaceId: "w1",
    actor: { kind: "system", name: "test" },
    db: {
      workspaceId: "w1",
      getById: vi.fn(async () => row),
    },
  } as unknown as WorkspaceContext;
}

function fakeEngine(failResumes = 0) {
  let failures = failResumes;
  const engine: DurableEngine = {
    startRun: vi.fn(async () => ({ runId: "run_1" })),
    resume: vi.fn(async () => {
      if (failures-- > 0) throw new Error("Hook not found");
    }),
  };
  return engine;
}

describe("durable engine: what the run does next", () => {
  it("runs the step of a running status and waits at gates or after a failure", () => {
    expect(nextActionFor("w", "p", "analyzing")).toEqual({ kind: "run", step: "analyze" });
    expect(nextActionFor("w", "p", "sourcing")).toEqual({ kind: "run", step: "source" });
    expect(nextActionFor("w", "p", "building_page_and_videos")).toEqual({
      kind: "run",
      step: "build",
    });
    expect(nextActionFor("w", "p", "awaiting_supplier_choice")).toEqual({
      kind: "wait",
      why: "gate",
      token: gateHookToken("w", "p", "supplier_choice"),
    });
    expect(nextActionFor("w", "p", "ready_to_launch")).toMatchObject({
      kind: "wait",
      token: "tc:gate:w:p:launch",
    });
    expect(nextActionFor("w", "p", "failed")).toEqual({
      kind: "wait",
      why: "retry",
      token: resumeHookToken("w", "p"),
    });
    expect(nextActionFor("w", "p", "launched")).toEqual({ kind: "done", status: "launched" });
  });

  it("backs off from 30 s up to 10 min between engine attempts", () => {
    expect(durableRetryDelayMs(1)).toBe(30_000);
    expect(durableRetryDelayMs(2)).toBe(60_000);
    expect(durableRetryDelayMs(20)).toBe(600_000);
  });
});

describe("durable pipeline adapter", () => {
  it("wakes the run waiting at the gate with ids only", async () => {
    const engine = fakeEngine();
    const pipeline = createDurablePipeline(engine, { sleep: async () => undefined });
    const outcome = await pipeline.continueAfterGate(
      fakeCtx("sourcing"),
      "p1",
      "product_confirmation",
      "appr_1",
    );
    expect(engine.resume).toHaveBeenCalledWith("tc:gate:w1:p1:product_confirmation", {
      reason: "gate_approved",
      gate: "product_confirmation",
      approvalId: "appr_1",
    });
    expect(engine.startRun).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "queued", step: "source" });
  });

  it("retries the wake-up, then starts a new run when no hook is waiting", async () => {
    const sleep = vi.fn(async () => undefined);
    const late = fakeEngine(2);
    await createDurablePipeline(late, { sleep }).resumeStep(fakeCtx(), "p1", "source");
    expect(late.resume).toHaveBeenCalledTimes(3);
    expect(late.startRun).not.toHaveBeenCalled();

    const none = fakeEngine(99);
    await createDurablePipeline(none, { sleep }).restartAfterRejection(
      fakeCtx("analyzing"),
      "p1",
      "product_confirmation",
      "appr_2",
    );
    expect(none.resume).toHaveBeenCalledTimes(4);
    expect(none.startRun).toHaveBeenCalledWith("w1", "p1");
  });

  it("starts a run on the current deployment right away when the waiting run is older", async () => {
    const sleep = vi.fn(async () => undefined);
    const engine: DurableEngine = {
      startRun: vi.fn(async () => ({ runId: "run_new" })),
      resume: vi.fn(async () => {
        throw new StaleDeploymentRunError("run_old");
      }),
    };
    await createDurablePipeline(engine, { sleep }).resumeStep(fakeCtx(), "p1", "build");
    expect(engine.resume).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(engine.startRun).toHaveBeenCalledWith("w1", "p1");
  });

  it("does nothing for gates without a rejection path", async () => {
    const engine = fakeEngine();
    const out = await createDurablePipeline(engine).restartAfterRejection(
      fakeCtx("ready_to_launch"),
      "p1",
      "launch",
      "appr_3",
    );
    expect(out).toBeNull();
    expect(engine.resume).not.toHaveBeenCalled();
  });
});

describe("runner: deferred retryable failures (durable engine)", () => {
  it("keeps the product running and the job queued, for the engine to retry", async () => {
    const product = { id: "p1", status: "sourcing", brandId: "b1" };
    const jobs: Record<string, unknown>[] = [];
    const db = {
      workspaceId: "w1",
      getById: vi.fn(async () => product),
      findFirst: vi.fn(async () => jobs.find((j) => j.status !== "succeeded")),
      insert: vi.fn(async (_t: unknown, values: Record<string, unknown>) => {
        const row = { id: "j1", attempts: 0, aiCostUsd: 0, ...values };
        jobs.push(row);
        return row;
      }),
      update: vi.fn(async (_t: unknown, set: Record<string, unknown>) => {
        Object.assign(jobs[0]!, set);
        return [jobs[0]];
      }),
    };
    const ctx = { workspaceId: "w1", actor: { kind: "system", name: "t" }, db };
    const outcome = await runProductStep(ctx as unknown as WorkspaceContext, "p1", "source", {
      integrations: {} as never,
      limiter: createMemoryLimiter(),
      maxAttempts: 1,
      deferRetryable: true,
      handlers: {
        source: {
          step: "source",
          limit: "ai",
          run: async () => {
            throw new IntegrationError("serpapi", "rate_limited", "slow down");
          },
        },
      },
    });
    expect(outcome).toMatchObject({
      status: "deferred",
      error: "serpapi (rate_limited): slow down",
    });
    expect(jobs[0]).toMatchObject({ status: "queued", error: "serpapi (rate_limited): slow down" });
    expect(DURABLE_STEP_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe("Shopify draft variants and images", () => {
  it("builds one variant per option combination at the confirmed price", () => {
    const { options, variants } = variantsFromListing(
      [
        { name: "Color", values: ["Red", "Blue", "Red"] },
        { name: " size ", values: ["S", "M"] },
        { name: "color", values: ["Green"] }, // duplicate name
        { name: "Empty", values: [] },
      ],
      19.99,
      29.99,
    );
    expect(options).toEqual([
      { name: "Color", values: ["Red", "Blue"] },
      { name: "size", values: ["S", "M"] },
    ]);
    expect(variants).toHaveLength(4);
    expect(variants[0]).toEqual({
      optionValues: ["Red", "S"],
      price: 19.99,
      compareAtPrice: 29.99,
    });
  });

  it("falls back to a single default variant and caps the matrix", () => {
    expect(variantsFromListing([], 10, null)).toEqual({
      options: [],
      variants: [{ optionValues: [], price: 10, compareAtPrice: null }],
    });
    const big = variantsFromListing(
      [
        { name: "A", values: Array.from({ length: 20 }, (_, i) => `a${i}`) },
        { name: "B", values: Array.from({ length: 20 }, (_, i) => `b${i}`) },
      ],
      10,
      null,
    );
    expect(big.variants.length).toBeLessThanOrEqual(MAX_VARIANTS);
    expect(big.options[0]!.values).toHaveLength(20);
  });

  it("keeps https images only, deduplicated, at most 10", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://img.example/${i}.jpg`);
    expect(draftImageUrls(["http://x/1.jpg", "not a url", null], urls, [urls[0]])).toEqual(
      urls.slice(0, 10),
    );
  });
});

describe("vercelWorkflowEngine.resume: runs pinned to a deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("cancels a run from an older deployment instead of waking it", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_new");
    workflowApi.getHookByToken.mockResolvedValue({
      runId: "run_old",
      resumeContext: { deploymentId: "dpl_old", workflowName: "productWorkflow" },
    });
    await expect(vercelWorkflowEngine.resume("tok", { reason: "retry" })).rejects.toBeInstanceOf(
      StaleDeploymentRunError,
    );
    expect(workflowApi.cancel).toHaveBeenCalledOnce();
    expect(workflowApi.resumeHook).not.toHaveBeenCalled();
  });

  it("still asks for a new run when the old one cannot be cancelled", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_new");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    workflowApi.getHookByToken.mockResolvedValue({
      runId: "run_old",
      resumeContext: { deploymentId: "dpl_old", workflowName: "productWorkflow" },
    });
    workflowApi.cancel.mockRejectedValueOnce(new Error("already completed"));
    await expect(vercelWorkflowEngine.resume("tok", { reason: "retry" })).rejects.toBeInstanceOf(
      StaleDeploymentRunError,
    );
  });

  it("wakes a run of the current deployment", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_new");
    workflowApi.getHookByToken.mockResolvedValue({
      runId: "run_1",
      resumeContext: { deploymentId: "dpl_new", workflowName: "productWorkflow" },
    });
    await vercelWorkflowEngine.resume("tok", { reason: "retry" });
    expect(workflowApi.cancel).not.toHaveBeenCalled();
    expect(workflowApi.resumeHook).toHaveBeenCalledWith("tok", { reason: "retry" });
  });

  it("wakes the hook directly outside Vercel (no deployment id) or for a legacy hook", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
    await vercelWorkflowEngine.resume("tok", { reason: "retry" });
    expect(workflowApi.getHookByToken).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_new");
    workflowApi.getHookByToken.mockResolvedValue({ runId: "run_legacy" });
    await vercelWorkflowEngine.resume("tok", { reason: "retry" });
    expect(workflowApi.cancel).not.toHaveBeenCalled();
    expect(workflowApi.resumeHook).toHaveBeenCalledTimes(2);
  });
});
