import { beforeEach, describe, expect, it, vi } from "vitest";

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
  approvePage: vi.fn(),
  regeneratePageCopy: vi.fn(),
  rejectPage: vi.fn(),
  rejectSuppliers: vi.fn(),
  updatePageCopy: vi.fn(),
}));
vi.mock("@/lib/services", () => services);

const { approvePageAction, regeneratePageCopyAction, rejectPageAction, updatePageCopyAction } =
  await import("./actions");

const VERSION = "0123456789abcdef";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approvePageAction", () => {
  it("sends the rendered copy version to approvePage", async () => {
    services.approvePage.mockResolvedValue({});
    const result = await approvePageAction("p1", { copyVersion: VERSION, note: "  ok  " });
    expect(result).toEqual({ ok: true, data: undefined });
    expect(services.approvePage).toHaveBeenCalledWith(
      {},
      { productId: "p1", copyVersion: VERSION, note: "ok" },
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(["", "0123", "0123456789ABCDEF", "0123456789abcdeg"])(
    "refuses a malformed copy version %j without calling the service",
    async (copyVersion) => {
      const result = await approvePageAction("p1", { copyVersion });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.fieldErrors?.copyVersion).toBeTruthy();
      expect(services.approvePage).not.toHaveBeenCalled();
    },
  );

  it("maps a stale version to a reload prompt and does not refresh the route", async () => {
    services.approvePage.mockRejectedValue(
      new ServiceError("invalid_state", "Any wording.", { reason: "copy_changed" }),
    );
    const result = await approvePageAction("p1", { copyVersion: VERSION });
    expect(result).toMatchObject({
      ok: false,
      code: "invalid_state",
      reason: "copy_changed",
      fieldErrors: { copyVersion: ["stale"] },
    });
    expect(!result.ok && result.error).toContain("Reload");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not treat the stale-copy wording without the reason as stale", async () => {
    services.approvePage.mockRejectedValue(
      new ServiceError("invalid_state", "The page changed since you loaded it."),
    );
    const result = await approvePageAction("p1", { copyVersion: VERSION });
    expect(!result.ok && result.fieldErrors).toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("retries a stuck publish with the same copy version (service takes the claim over)", async () => {
    services.approvePage.mockResolvedValue({});
    const result = await approvePageAction("p1", { copyVersion: VERSION });
    expect(result.ok).toBe(true);
    expect(services.approvePage).toHaveBeenCalledWith(
      {},
      { productId: "p1", copyVersion: VERSION, note: undefined },
    );
  });

  it("keeps other state messages and refreshes", async () => {
    services.approvePage.mockRejectedValue(
      new ServiceError("invalid_state", "The page is being published. Try again in a moment."),
    );
    const result = await approvePageAction("p1", { copyVersion: VERSION });
    expect(result).toMatchObject({
      ok: false,
      error: "The page is being published. Try again in a moment.",
    });
    expect(!result.ok && result.fieldErrors).toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("rebuild rate limits", () => {
  it.each([
    ["regenerate", () => regeneratePageCopyAction("p1"), services.regeneratePageCopy],
    ["reject page", () => rejectPageAction("p1", {}), services.rejectPage],
  ] as const)("%s shows a calm limit message", async (_, run, service) => {
    service.mockRejectedValue(new ServiceError("rate_limited", "limit"));
    const result = await run();
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
    expect(!result.ok && result.error).toMatch(/^Too many rebuilds for now/);
  });
});

describe("updatePageCopyAction", () => {
  it("returns the new copy version", async () => {
    services.updatePageCopy.mockResolvedValue({
      pageCopyVersion: "fedcba9876543210",
      shopify: { previewUrl: "https://shop.example/preview" },
    });
    const result = await updatePageCopyAction("p1", { title: "New" });
    expect(result).toEqual({
      ok: true,
      data: { previewUrl: "https://shop.example/preview", copyVersion: "fedcba9876543210" },
    });
  });

  it("keeps the copy-safety message for the inline form error", async () => {
    const message =
      "The copy makes claims that are not allowed (title: superlative). Remove them and save again.";
    services.updatePageCopy.mockRejectedValue(new ServiceError("invalid_input", message));
    const result = await updatePageCopyAction("p1", { title: "Best ever" });
    expect(result).toMatchObject({ ok: false, code: "invalid_input", error: message });
  });
});
