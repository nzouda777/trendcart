/** Trimmed ScrapeCreators payloads (shape from docs.scrapecreators.com), for tests only. */
export const SC_VIDEO_ID = "7463250363559218474";
export const SC_EXPIRES = 1_793_000_000;

export function scAweme(id = SC_VIDEO_ID, overrides: Record<string, unknown> = {}) {
  return {
    aweme_id: id,
    desc: "This lamp changed my room #sunsetlamp",
    create_time: 1_737_673_396,
    author: { unique_id: "homefinds.daily", nickname: "Home Finds Daily" },
    statistics: { play_count: 355_687, digg_count: 44_855, comment_count: 270, share_count: 3_100 },
    video: {
      duration: 15_480,
      height: 1024,
      has_watermark: true,
      cover: {
        url_list: [
          `https://p16-sign.tiktokcdn-us.com/obj/cover-${id}.jpeg?x-expires=${SC_EXPIRES}`,
        ],
      },
      download_addr: {
        url_list: [`https://v16.tiktokcdn-us.com/wm-${id}.mp4?x-expires=${SC_EXPIRES}`],
        width: 576,
        height: 1024,
      },
      download_no_watermark_addr: {
        url_list: [
          `https://v16.tiktokcdn-us.com/nwm-${id}.mp4?x-expires=${SC_EXPIRES}&x-signature=abc`,
        ],
        width: 1080,
        height: 1920,
      },
      bit_rate: [
        {
          bit_rate: 800_000,
          play_addr: {
            url_list: [`https://v16.tiktokcdn-us.com/low-${id}.mp4`],
            width: 540,
            height: 960,
          },
        },
      ],
    },
    ...overrides,
  };
}

export const scVideoResponse = { success: true, credits_remaining: 99, aweme_detail: scAweme() };

export const scSearchResponse = (ids: string[], cursor: number, hasMore = true) => ({
  success: true,
  cursor,
  has_more: hasMore,
  search_item_list: ids.map((id) => ({ aweme_info: scAweme(id) })),
});
