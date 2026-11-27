import { describe, expect, it } from "vitest";

import {
  isPendingImageUrl,
  isUploadSourceUrl,
  signedImageUrl,
  sniffImageType,
  uploadSourceUrl,
  verifyImageSignature,
} from "./images";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe("sniffImageType", () => {
  it("detects JPEG, PNG, WebP and GIF from magic bytes", () => {
    expect(sniffImageType(JPEG)?.mimeType).toBe("image/jpeg");
    expect(sniffImageType(PNG)?.mimeType).toBe("image/png");
    expect(sniffImageType(WEBP)?.mimeType).toBe("image/webp");
    expect(sniffImageType(GIF)?.mimeType).toBe("image/gif");
  });

  it("refuses anything else, whatever its name or declared type", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("signed image URLs", () => {
  const secret = "test-secret";
  const now = Date.UTC(2026, 10, 25);

  function parts(url: string) {
    const u = new URL(url);
    return {
      imageId: decodeURIComponent(u.pathname.split("/").pop()!),
      exp: u.searchParams.get("exp"),
      sig: u.searchParams.get("sig"),
    };
  }

  it("round-trips and expires", () => {
    const url = signedImageUrl(
      { origin: "https://app.example.com/", imageId: "img-1" },
      { secret, now, ttlSec: 60 },
    );
    expect(url.startsWith("https://app.example.com/api/images/img-1?")).toBe(true);
    expect(verifyImageSignature(parts(url), { secret, now })).toBe(true);
    expect(verifyImageSignature(parts(url), { secret, now: now + 61_000 })).toBe(false);
  });

  it("refuses another id, another secret or a tampered expiry", () => {
    const url = signedImageUrl({ origin: "https://a.example", imageId: "img-1" }, { secret, now });
    const p = parts(url);
    expect(verifyImageSignature({ ...p, imageId: "img-2" }, { secret, now })).toBe(false);
    expect(verifyImageSignature(p, { secret: "other", now })).toBe(false);
    expect(verifyImageSignature({ ...p, exp: String(Number(p.exp) + 1) }, { secret, now })).toBe(
      false,
    );
    expect(verifyImageSignature({ ...p, sig: null }, { secret, now })).toBe(false);
  });

  it("recognises pending-image URLs and upload sources", () => {
    const url = signedImageUrl({ origin: "https://a.example", imageId: "x" }, { secret, now });
    expect(isPendingImageUrl(url)).toBe(true);
    expect(isPendingImageUrl("https://cdn.shopify.com/s/files/tcu-abc.jpg")).toBe(false);
    expect(isUploadSourceUrl(uploadSourceUrl("ab12"))).toBe(true);
    expect(isUploadSourceUrl("https://shop.example/p")).toBe(false);
  });
});
