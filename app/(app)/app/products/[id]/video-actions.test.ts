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
  addVideo: vi.fn(),
  approveVideo: vi.fn(),
  approveVideos: vi.fn(),
  publishToProfile: vi.fn(),
  refreshTikTokPosts: vi.fn(),
  rejectVideo: vi.fn(),
}));
vi.mock("@/lib/services", () => services);

const {
  addVideoAction,
  approveVideoAction,
  approveVideosAction,
  publishToProfileAction,
  refreshTikTokPostsAction,
  rejectVideoAction,
} = await import("./video-actions");
const { DISCLOSURE_UNSUPPORTED } = await import("@/components/app/product/action-markers");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveVideoAction", () => {
  it("approves one video and refreshes", async () => {
    services.approveVideo.mockResolvedValue({});
    expect(await approveVideoAction("p1", "v1")).toEqual({ ok: true, data: undefined });
    expect(services.approveVideo).toHaveBeenCalledWith({}, { productId: "p1", videoId: "v1" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the 'Shopify still processing' message and refreshes", async () => {
    const message = "Shopify is still processing this video. Approve it again in a minute.";
    services.approveVideo.mockRejectedValue(new ServiceError("invalid_state", message));
    const result = await approveVideoAction("p1", "v1");
    expect(result).toMatchObject({ ok: false, code: "invalid_state", error: message });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the compliance refusal message", async () => {
    const message =
      "This video breaks TikTok ad rules (see its compliance report). It cannot be used.";
    services.approveVideo.mockRejectedValue(new ServiceError("invalid_state", message));
    expect(await approveVideoAction("p1", "v1")).toMatchObject({ ok: false, error: message });
  });

  it("maps a busy upload slot and a forbidden role", async () => {
    services.approveVideo.mockRejectedValueOnce(new ServiceError("rate_limited", "busy"));
    expect(await approveVideoAction("p1", "v1")).toMatchObject({
      ok: false,
      code: "rate_limited",
      error: expect.stringMatching(/Try again in a moment/),
    });
    services.approveVideo.mockRejectedValueOnce(new ForbiddenError());
    expect(await approveVideoAction("p1", "v1")).toMatchObject({
      ok: false,
      code: "forbidden",
      error: expect.stringMatching(/Creative or higher/),
    });
  });
});

describe("rejectVideoAction", () => {
  it("trims the note and drops an empty one", async () => {
    services.rejectVideo.mockResolvedValue({});
    await rejectVideoAction("p1", "v1", { note: "  off-brand  " });
    expect(services.rejectVideo).toHaveBeenLastCalledWith(
      {},
      { productId: "p1", videoId: "v1", note: "off-brand" },
    );
    await rejectVideoAction("p1", "v1", { note: "   " });
    expect(services.rejectVideo).toHaveBeenLastCalledWith(
      {},
      { productId: "p1", videoId: "v1", note: undefined },
    );
  });
});

describe("addVideoAction", () => {
  it("refuses an empty link without calling the service", async () => {
    const result = await addVideoAction("p1", { url: "   " });
    expect(result).toMatchObject({ ok: false, fieldErrors: { url: expect.any(Array) } });
    expect(services.addVideo).not.toHaveBeenCalled();
  });

  it("sends the trimmed link", async () => {
    services.addVideo.mockResolvedValue({});
    const url = "https://www.tiktok.com/@a/video/1234567890123456789";
    expect(await addVideoAction("p1", { url: ` ${url} ` })).toEqual({ ok: true, data: undefined });
    expect(services.addVideo).toHaveBeenCalledWith({}, { productId: "p1", url });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("maps a schema refusal of the link to a field error", async () => {
    const { z } = await import("zod");
    services.addVideo.mockImplementation(() => {
      z.object({ url: z.string().regex(/^never$/) }).parse({ url: "x" });
    });
    const result = await addVideoAction("p1", { url: "https://example.com" });
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    expect(!result.ok && result.fieldErrors?.url?.[0]).toMatch(/TikTok video/);
  });

  it("keeps the 'not found or private' message and a calm rate limit", async () => {
    services.addVideo.mockRejectedValueOnce(
      new ServiceError("invalid_input", "This TikTok video could not be found or is private."),
    );
    expect(await addVideoAction("p1", { url: "https://vm.tiktok.com/x" })).toMatchObject({
      error: "This TikTok video could not be found or is private.",
    });
    services.addVideo.mockRejectedValueOnce(new ServiceError("rate_limited", "x"));
    expect(await addVideoAction("p1", { url: "https://vm.tiktok.com/x" })).toMatchObject({
      code: "rate_limited",
      error: expect.stringMatching(/try again later/),
    });
  });
});

describe("approveVideosAction", () => {
  it("passes the chosen ad account", async () => {
    services.approveVideos.mockResolvedValue({});
    expect(await approveVideosAction("p1", { adConnectionId: "ad1", note: "" })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(services.approveVideos).toHaveBeenCalledWith(
      {},
      { productId: "p1", adConnectionId: "ad1", note: undefined },
    );
  });

  it("keeps the precondition message (no approved video, no account)", async () => {
    services.approveVideos.mockRejectedValue(
      new ServiceError("precondition_failed", "Approve at least one video first."),
    );
    expect(await approveVideosAction("p1", {})).toMatchObject({
      ok: false,
      code: "precondition_failed",
      error: "Approve at least one video first.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

const POST = {
  videoId: "v1",
  profileConnectionId: "pr1",
  caption: "  Find of the week  ",
  privacyLevel: "SELF_ONLY" as const,
  disclosure: { enabled: false, yourBrand: false, brandedContent: false },
};

describe("publishToProfileAction", () => {
  it("publishes with the chosen privacy level and trimmed caption", async () => {
    services.publishToProfile.mockResolvedValue({});
    expect(await publishToProfileAction(POST)).toEqual({ ok: true, data: undefined });
    expect(services.publishToProfile).toHaveBeenCalledWith(
      {},
      {
        videoId: "v1",
        profileConnectionId: "pr1",
        caption: "Find of the week",
        privacyLevel: "SELF_ONLY",
      },
    );
  });

  it("requires an explicit privacy level (no default)", async () => {
    const result = await publishToProfileAction({
      ...POST,
      privacyLevel: undefined as unknown as "SELF_ONLY",
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    expect(!result.ok && result.fieldErrors?.privacyLevel).toBeTruthy();
    expect(services.publishToProfile).not.toHaveBeenCalled();
  });

  it("refuses an empty caption", async () => {
    const result = await publishToProfileAction({ ...POST, caption: "  " });
    expect(!result.ok && result.fieldErrors?.caption).toBeTruthy();
    expect(services.publishToProfile).not.toHaveBeenCalled();
  });

  it("never publishes a disclosed post unlabelled", async () => {
    const result = await publishToProfileAction({
      ...POST,
      disclosure: { enabled: true, yourBrand: true, brandedContent: false },
    });
    expect(result).toMatchObject({
      ok: false,
      code: "precondition_failed",
      error: DISCLOSURE_UNSUPPORTED,
    });
    expect(services.publishToProfile).not.toHaveBeenCalled();
  });

  it("requires a disclosure type and refuses private branded content", async () => {
    expect(
      await publishToProfileAction({
        ...POST,
        disclosure: { enabled: true, yourBrand: false, brandedContent: false },
      }),
    ).toMatchObject({ ok: false, fieldErrors: { disclosure: ["required"] } });
    expect(
      await publishToProfileAction({
        ...POST,
        disclosure: { enabled: true, yourBrand: false, brandedContent: true },
      }),
    ).toMatchObject({ ok: false, fieldErrors: { privacyLevel: ["branded_content_private"] } });
  });

  it("returns a TikTok failure and refreshes so the failed post shows", async () => {
    services.publishToProfile.mockRejectedValue(
      new IntegrationError("tiktok_posting", "rate_limited", "Too many posts."),
    );
    const result = await publishToProfileAction(POST);
    expect(result).toMatchObject({ ok: false, code: "integration" });
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("refreshTikTokPostsAction", () => {
  it("polls the product's posts and refreshes", async () => {
    services.refreshTikTokPosts.mockResolvedValue({});
    expect(await refreshTikTokPostsAction("p1")).toEqual({ ok: true, data: undefined });
    expect(services.refreshTikTokPosts).toHaveBeenCalledWith({}, { productId: "p1" });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
