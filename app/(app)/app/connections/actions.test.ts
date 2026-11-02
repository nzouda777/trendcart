import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { IntegrationError } from "@/lib/domain/contracts";
import { ServiceError, toServiceFailure } from "@/lib/services/errors";

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

// runAction without a session: the service mocks below get a dummy context.
vi.mock("../_lib/action", () => ({
  runAction: async (fn: (ctx: unknown) => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn({}) };
    } catch (error) {
      return toServiceFailure(error);
    }
  },
}));

const services = vi.hoisted(() => ({
  listShopifyTemplates: vi.fn(),
  setShopifyTemplate: vi.fn(),
  clearBrandProxy: vi.fn(),
  disconnectConnection: vi.fn(),
  setBrandProxy: vi.fn(),
  toggleBrandProxy: vi.fn(),
}));
vi.mock("@/lib/services", () => services);

const { listTemplatesAction, setTemplateAction } = await import("./actions");
const { templateOptions } = await import("@/components/app/connections/template-form");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTemplatesAction", () => {
  it("returns the theme's templates for one connection without refreshing", async () => {
    const dto = { connectionId: "c1", suffixes: [null, "trendcart"], hasTrendcartTemplate: true };
    services.listShopifyTemplates.mockResolvedValue(dto);
    expect(await listTemplatesAction("c1")).toEqual({ ok: true, data: dto });
    expect(services.listShopifyTemplates).toHaveBeenCalledWith({}, "c1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns an integration failure so the form can fall back to free text", async () => {
    services.listShopifyTemplates.mockRejectedValue(
      new IntegrationError("shopify", "auth_expired", "Shopify is unavailable."),
    );
    const result = await listTemplatesAction("c1");
    expect(result).toMatchObject({ ok: false, code: "integration" });
    expect(!result.ok && result.error).toContain("Shopify is unavailable.");
  });

  it("returns a needs-reconnect refusal as a failure", async () => {
    services.listShopifyTemplates.mockRejectedValue(
      new ServiceError("precondition_failed", "Reconnect the store first."),
    );
    expect(await listTemplatesAction("c1")).toMatchObject({
      ok: false,
      code: "precondition_failed",
      error: "Reconnect the store first.",
    });
  });
});

describe("setTemplateAction", () => {
  it("saves the chosen suffix (or null for the default) and refreshes", async () => {
    services.setShopifyTemplate.mockResolvedValue({});
    expect(await setTemplateAction("c1", "trendcart")).toEqual({ ok: true, data: undefined });
    expect(services.setShopifyTemplate).toHaveBeenCalledWith(
      {},
      { connectionId: "c1", templateSuffix: "trendcart" },
    );
    await setTemplateAction("c1", null);
    expect(services.setShopifyTemplate).toHaveBeenLastCalledWith(
      {},
      { connectionId: "c1", templateSuffix: null },
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps the theme validation message and does not refresh", async () => {
    const message = 'The store\'s theme has no "product.missing" template.';
    services.setShopifyTemplate.mockRejectedValue(new ServiceError("invalid_input", message));
    expect(await setTemplateAction("c1", "missing")).toMatchObject({ ok: false, error: message });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses a role without connection:update", async () => {
    services.setShopifyTemplate.mockRejectedValue(new ForbiddenError());
    expect(await setTemplateAction("c1", null)).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("templateOptions", () => {
  it("lists the default first and marks trendcart as recommended", () => {
    expect(templateOptions([null, "alt", "trendcart"], null)).toEqual([
      { value: "", label: "Default product template" },
      { value: "alt", label: "alt" },
      { value: "trendcart", label: "trendcart (recommended)" },
    ]);
  });

  it("keeps a saved suffix that the live theme no longer has", () => {
    expect(templateOptions([null], "old")).toEqual([
      { value: "", label: "Default product template" },
      { value: "old", label: "old (not in the live theme)" },
    ]);
  });
});
