import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { IntegrationError } from "@/lib/domain/contracts";
import { ServiceError, toServiceFailure } from "@/lib/services/errors";

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

// runAction without a session: the service mocks below get a dummy context.
vi.mock("../../_lib/action", () => ({
  runAction: async (fn: (ctx: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn({}) };
    } catch (error) {
      return toServiceFailure(error);
    }
  },
}));

const services = vi.hoisted(() => ({
  launchCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
  updateCampaignBudget: vi.fn(),
}));
vi.mock("@/lib/services", () => services);

const {
  launchCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  updateCampaignBudgetAction,
} = await import("./campaign-actions");
const { BUDGET_UNSUPPORTED } = await import("@/components/app/product/action-markers");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("launchCampaignAction", () => {
  it("approves GATE 4 with the trimmed note and refreshes", async () => {
    services.launchCampaign.mockResolvedValue({});
    expect(await launchCampaignAction("p1", { note: "  go  " })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(services.launchCampaign).toHaveBeenCalledWith({}, { productId: "p1", note: "go" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the failed-launch message (paused again) and refreshes to show it", async () => {
    const message =
      "The launch failed (Advertiser balance too low.). The campaign was paused again: nothing is spending. Retry, then approve the launch again.";
    services.launchCampaign.mockRejectedValue(
      new ServiceError("invalid_state", message, { reason: "launch_failed_paused" }),
    );
    const result = await launchCampaignAction("p1", {});
    expect(result).toMatchObject({
      ok: false,
      code: "invalid_state",
      reason: "launch_failed_paused",
      error: message,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("never says nothing is spending when the re-pause failed", async () => {
    const message =
      "The launch failed, and Trendcart could not pause the campaign again: part of it may be spending. Pause it now (Pause campaign) or in TikTok Ads Manager.";
    services.launchCampaign.mockRejectedValue(
      new ServiceError("invalid_state", message, { reason: "launch_failed_not_paused" }),
    );
    const result = await launchCampaignAction("p1", {});
    expect(result).toMatchObject({ ok: false, reason: "launch_failed_not_paused" });
    expect(!result.ok && result.error).not.toMatch(/nothing is spending/);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains a raw TikTok failure without claiming nothing is spending", async () => {
    services.launchCampaign.mockRejectedValue(
      new IntegrationError("tiktok_ads", "permission_denied", "Advertiser balance too low."),
    );
    const result = await launchCampaignAction("p1", {});
    expect(result).toMatchObject({ ok: false, code: "integration" });
    expect(!result.ok && result.error).toMatch(/Check the campaign state/);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the in-flight message and refreshes", async () => {
    const message = "This campaign is being launched. Try again in a moment.";
    services.launchCampaign.mockRejectedValue(new ServiceError("invalid_state", message));
    expect(await launchCampaignAction("p1", {})).toMatchObject({ ok: false, error: message });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains a role refusal", async () => {
    services.launchCampaign.mockRejectedValue(new ForbiddenError());
    expect(await launchCampaignAction("p1", {})).toMatchObject({
      ok: false,
      code: "forbidden",
      error: expect.stringMatching(/Media buyer or the Owner/),
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("pause and resume", () => {
  it.each([
    ["pause", pauseCampaignAction, services.pauseCampaign],
    ["resume", resumeCampaignAction, services.resumeCampaign],
  ] as const)("%s calls its service and refreshes", async (_, action, service) => {
    service.mockResolvedValue({});
    expect(await action("p1")).toEqual({ ok: true, data: undefined });
    expect(service).toHaveBeenCalledWith({}, { productId: "p1" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the 'no launched campaign' message", async () => {
    services.pauseCampaign.mockRejectedValue(
      new ServiceError("invalid_state", "This product has no launched campaign."),
    );
    expect(await pauseCampaignAction("p1")).toMatchObject({
      error: "This product has no launched campaign.",
    });
  });
});

describe("updateCampaignBudgetAction", () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s without calling the service",
    async (amount) => {
      const result = await updateCampaignBudgetAction("p1", { amount });
      expect(result).toMatchObject({ ok: false, code: "invalid_input" });
      expect(services.updateCampaignBudget).not.toHaveBeenCalled();
    },
  );

  it("saves a new amount", async () => {
    services.updateCampaignBudget.mockResolvedValue({});
    expect(await updateCampaignBudgetAction("p1", { amount: 35 })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(services.updateCampaignBudget).toHaveBeenCalledWith({}, { productId: "p1", amount: 35 });
  });

  it("marks 'not supported yet' so the dialog shows it as unavailable", async () => {
    services.updateCampaignBudget.mockRejectedValue(
      new ServiceError("precondition_failed", "Changing the budget is not supported yet."),
    );
    const result = await updateCampaignBudgetAction("p1", { amount: 35 });
    expect(result).toMatchObject({
      ok: false,
      code: "precondition_failed",
      fieldErrors: { amount: [BUDGET_UNSUPPORTED] },
    });
    expect(!result.ok && result.error).toMatch(/TikTok Ads Manager/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps other precondition messages (cap, launch in flight) and does not mark them", async () => {
    const message = "The daily budget cannot be above 300 USD.";
    services.updateCampaignBudget.mockRejectedValue(
      new ServiceError("precondition_failed", message),
    );
    const result = await updateCampaignBudgetAction("p1", { amount: 301 });
    expect(result).toMatchObject({ ok: false, code: "precondition_failed", error: message });
    expect(!result.ok && result.fieldErrors?.amount).toBeFalsy();
  });
});
