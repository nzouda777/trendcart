import { describe, expect, it } from "vitest";

import {
  IntegrationError,
  type TikTokDataProvider,
  type VideoCandidate,
} from "@/lib/domain/contracts";
import { candidateVideoFields } from "@/lib/media/candidates";

import { createMockTikTokDataProvider } from "./mock";
import {
  buildRelatedSearchQueries,
  durationFitScore,
  engagementScore,
  findRelatedVideos,
  rankRelatedCandidates,
  recencyScore,
  relevanceScore,
} from "./related";

const NOW = new Date("2026-11-04T00:00:00Z");
const analysis = {
  productName: "LED Sunset Projection Lamp",
  keywords: ["sunset projection lamp", "sunset lamp", "Sunset Lamp", "rgb lamp", "lamp"],
};

let seq = 0;
function cand(over: Partial<VideoCandidate> & { id?: string; user?: string } = {}): VideoCandidate {
  const id = over.id ?? `74000000000000${String(++seq).padStart(5, "0")}`;
  const user = over.user ?? `creator${seq}`;
  return {
    tiktokUrl: `https://www.tiktok.com/@${user}/video/${id}`,
    tiktokVideoId: id,
    author: { username: user },
    caption: over.caption ?? "golden hour #sunsetlamp",
    thumbnailUrl: "https://p16-sign.tiktokcdn-us.com/cover.jpeg",
    stats: over.stats ?? { views: 100_000, likes: 8_000, comments: 300, shares: 500 },
    durationSec: over.durationSec ?? 20,
    postedAt: over.postedAt ?? "2026-10-01T00:00:00.000Z",
  };
}

describe("buildRelatedSearchQueries", () => {
  it("keeps keyword order, dedupes case and word order, prefers multi-word queries", () => {
    expect(buildRelatedSearchQueries(analysis)).toEqual([
      "sunset projection lamp",
      "sunset lamp",
      "rgb lamp",
    ]);
    expect(buildRelatedSearchQueries(analysis, { max: 10 })).toEqual([
      "sunset projection lamp",
      "sunset lamp",
      "rgb lamp",
      "LED Sunset Projection Lamp",
      "lamp",
    ]);
  });

  it("strips hashtags and punctuation and skips empty keywords", () => {
    expect(
      buildRelatedSearchQueries({
        productName: "Mini Fan",
        keywords: ["#neck fan!!", "  ", "#fyp"],
      }),
    ).toEqual(["neck fan", "Mini Fan"]);
  });
});

describe("scores", () => {
  it("relevance rewards caption matches (also glued hashtags) and multi-query hits", () => {
    const none = relevanceScore("my morning routine", analysis, 1);
    const tag = relevanceScore("vibes #sunsetprojectionlamp", analysis, 1);
    const twice = relevanceScore("vibes #sunsetprojectionlamp", analysis, 3);
    expect(none).toBeCloseTo(0.3, 5);
    expect(tag).toBeGreaterThan(0.7);
    expect(twice).toBeGreaterThan(tag);
    expect(twice).toBeLessThanOrEqual(1);
  });

  it("engagement blends rate and reach; zero views is 0", () => {
    expect(engagementScore({ views: 0, likes: 5, comments: 0, shares: 0 })).toBe(0);
    const low = engagementScore({ views: 1_000_000, likes: 5_000, comments: 0, shares: 0 });
    const high = engagementScore({
      views: 1_000_000,
      likes: 80_000,
      comments: 2_000,
      shares: 4_000,
    });
    expect(high).toBeGreaterThan(low);
  });

  it("recency halves every half-life and is neutral when unknown", () => {
    expect(recencyScore(undefined, NOW)).toBe(0.3);
    expect(recencyScore("2026-11-04T00:00:00Z", NOW)).toBe(1);
    expect(recencyScore("2026-07-07T00:00:00Z", NOW, 120)).toBeCloseTo(0.5, 2);
  });

  it.each([
    [3, 0],
    [7, 0.7],
    [30, 1],
    [75, 0.7],
    [120, 0.4],
    [400, 0.15],
    [601, 0],
  ])("duration fit %ss -> %s", (sec, score) => {
    expect(durationFitScore(sec)).toBe(score);
  });
});

describe("rankRelatedCandidates", () => {
  it("drops the imported video, excluded ids and unusable durations; dedupes across queries", () => {
    const imported = cand({ id: "7400000000000000001" });
    const kept = cand({ id: "7400000000000000002" });
    const known = cand({ id: "7400000000000000003" });
    const tooShort = cand({ id: "7400000000000000004", durationSec: 3 });
    const ranked = rankRelatedCandidates(
      [
        { query: "sunset lamp", candidates: [imported, kept, known, tooShort] },
        { query: "rgb lamp", candidates: [kept] },
      ],
      {
        analysis,
        imported: { tiktokUrl: imported.tiktokUrl },
        excludeVideoIds: [known.tiktokVideoId],
        now: NOW,
      },
    );
    expect(ranked.map((r) => r.candidate.tiktokVideoId)).toEqual([kept.tiktokVideoId]);
    expect(ranked[0]!.matchedQueries).toEqual(["sunset lamp", "rgb lamp"]);
  });

  it("ranks relevant, engaging, recent, ad-length videos first and is deterministic", () => {
    const best = cand({
      caption: "sunset projection lamp in my room",
      postedAt: "2026-10-30T00:00:00Z",
    });
    const offTopic = cand({ caption: "outfit check", postedAt: "2026-10-30T00:00:00Z" });
    const old = cand({ caption: "sunset projection lamp", postedAt: "2024-01-01T00:00:00Z" });
    const long = cand({
      caption: "sunset projection lamp",
      durationSec: 300,
      postedAt: "2026-10-30T00:00:00Z",
    });
    const input = [{ query: "sunset lamp", candidates: [offTopic, long, old, best] }];
    const ranked = rankRelatedCandidates(input, { analysis, now: NOW });
    expect(ranked[0]!.candidate.tiktokVideoId).toBe(best.tiktokVideoId);
    expect(ranked.at(-1)!.candidate.tiktokVideoId).toBe(offTopic.tiktokVideoId);
    expect(ranked.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);
    expect(rankRelatedCandidates(input, { analysis, now: NOW })).toEqual(ranked);
  });

  it("caps videos per creator, applies the limit and minRelevance", () => {
    const same = [1, 2, 3].map(() => cand({ user: "same.creator" }));
    const other = cand({ user: "other", caption: "nothing related" });
    const ranked = rankRelatedCandidates([{ query: "q", candidates: [...same, other] }], {
      analysis,
      now: NOW,
      maxPerAuthor: 2,
    });
    expect(ranked.filter((r) => r.candidate.author.username === "same.creator")).toHaveLength(2);
    expect(
      rankRelatedCandidates([{ query: "q", candidates: [...same, other] }], {
        analysis,
        now: NOW,
        limit: 1,
      }),
    ).toHaveLength(1);
    expect(
      rankRelatedCandidates([{ query: "q", candidates: [other] }], {
        analysis,
        now: NOW,
        minRelevance: 0.5,
      }),
    ).toEqual([]);
  });

  it("never carries a provider media URL into the candidate or its stored fields", () => {
    const resolved = {
      ...cand(),
      mediaUrl: "https://v16.tiktokcdn.com/x.mp4",
      width: 1080,
      height: 1920,
    };
    const [r] = rankRelatedCandidates([{ query: "q", candidates: [resolved] }], {
      analysis,
      now: NOW,
    });
    expect(r!.candidate).not.toHaveProperty("mediaUrl");
    expect(JSON.stringify(candidateVideoFields(r!.candidate))).not.toContain("tiktokcdn.com/x.mp4");
  });
});

describe("findRelatedVideos", () => {
  const ctx = { workspaceId: "ws" };

  it("works end to end on the mock provider", async () => {
    const provider = createMockTikTokDataProvider({ now: () => NOW });
    const imported = await provider.resolveVideo(
      ctx,
      "https://www.tiktok.com/@a/video/7412345678901234567",
    );
    const res = await findRelatedVideos(provider, ctx, {
      analysis,
      imported,
      country: "FR",
      limit: 5,
      now: NOW,
    });
    expect(res.queries.length).toBeGreaterThan(0);
    expect(res.failedQueries).toEqual([]);
    expect(res.ranked.length).toBeGreaterThan(0);
    expect(res.ranked.length).toBeLessThanOrEqual(5);
    expect(res.ranked.some((r) => r.candidate.tiktokVideoId === imported.tiktokVideoId)).toBe(
      false,
    );
    expect(new Set(res.ranked.map((r) => r.candidate.tiktokVideoId)).size).toBe(res.ranked.length);
  });

  it("tolerates one failed query, stops on rate limits, throws when all fail", async () => {
    const calls: string[] = [];
    const flaky: Pick<TikTokDataProvider, "searchVideos"> = {
      async searchVideos(_ctx, { query }) {
        calls.push(query);
        if (query === "sunset lamp")
          throw new IntegrationError("tiktok-data", "provider_error", "boom");
        return [cand({ caption: query })];
      },
    };
    const ok = await findRelatedVideos(flaky, ctx, { analysis, now: NOW });
    expect(ok.failedQueries).toEqual([{ query: "sunset lamp", code: "provider_error" }]);
    expect(ok.ranked.length).toBe(2);

    calls.length = 0;
    const limited: Pick<TikTokDataProvider, "searchVideos"> = {
      async searchVideos() {
        calls.push("x");
        throw new IntegrationError("tiktok-data", "rate_limited", "slow down");
      },
    };
    await expect(findRelatedVideos(limited, ctx, { analysis })).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toHaveLength(1);
  });
});
