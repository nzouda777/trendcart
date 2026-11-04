import { describe, expect, it } from "vitest";

import { MAX_IMAGES, MIN_PAGE_IMAGES, pageImageUrls } from "./page-input";

const ali = (n: number) => `https://ae01.alicdn.com/kf/S${n}.jpg_640x640.jpg_.webp`;
const full = (n: number) => `https://ae01.alicdn.com/kf/S${n}.jpg`;

describe("product page gallery", () => {
  it("uses every photo of the chosen supplier, at original size, without topping up", () => {
    const selected = Array.from({ length: 12 }, (_, i) => ali(i));
    const gallery = pageImageUrls({
      selected,
      referenceImageUrl: "https://cdn.example.com/ref.jpg",
      others: [{ images: ["https://other.example.com/1.jpg"], matchScore: 0.9 }],
    });
    expect(gallery).toHaveLength(MAX_IMAGES);
    expect(gallery[0]).toBe(full(0));
    expect(gallery).not.toContain("https://cdn.example.com/ref.jpg");
  });

  it("tops up a short gallery with the reference image, then close matches, best first", () => {
    const gallery = pageImageUrls({
      selected: [ali(1), "https://encrypted-tbn0.gstatic.com/shopping?q=1"],
      referenceImageUrl: "https://cdn.example.com/ref.jpg",
      others: [
        { images: ["https://far.example.com/1.jpg"], matchScore: 0.4 },
        {
          images: ["https://ok.example.com/1.jpg", "https://ok.example.com/2.jpg"],
          matchScore: 0.7,
        },
        {
          images: [
            "https://best.example.com/1.jpg",
            "https://best.example.com/2.jpg",
            "https://best.example.com/3.jpg",
          ],
          matchScore: 0.9,
        },
      ],
    });
    expect(gallery).toEqual([
      full(1),
      "https://cdn.example.com/ref.jpg",
      "https://best.example.com/1.jpg",
      "https://best.example.com/2.jpg",
      "https://best.example.com/3.jpg",
      "https://ok.example.com/1.jpg",
    ]);
    expect(gallery).toHaveLength(MIN_PAGE_IMAGES);
  });
});
