import { describe, expect, it } from "vitest";

import { pickCoverUrl } from "./scrapecreators";

const heic = "https://p19.tiktokcdn-us.com/obj/abc~tplv-cropcenter:300:400.heic?x-expires=1";
const jpeg = "https://p19.tiktokcdn-us.com/obj/abc~tplv-cropcenter:300:400.jpeg?x-expires=1";

describe("pickCoverUrl", () => {
  it("prefers a JPEG over the HEIC variant TikTok lists first", () => {
    expect(pickCoverUrl({ cover: { url_list: [heic, jpeg] } })).toBe(jpeg);
  });

  it("looks across cover, origin_cover and dynamic_cover", () => {
    expect(pickCoverUrl({ cover: { url_list: [heic] }, origin_cover: { url_list: [jpeg] } })).toBe(
      jpeg,
    );
  });

  it("falls back to HEIC when nothing else exists, and skips non-https URLs", () => {
    expect(pickCoverUrl({ cover: { url_list: ["http://x/a.jpeg", heic] } })).toBe(heic);
    expect(pickCoverUrl({})).toBeUndefined();
    expect(pickCoverUrl(null)).toBeUndefined();
  });
});
