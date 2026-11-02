import { ImageResponse } from "next/og";

import { getLogoIconSvg, LOGO_ICON } from "@/components/brand/logo";
import { siteConfig } from "@/config/site";

/**
 * Shared renderer for `app/opengraph-image.tsx` and `app/twitter-image.tsx`.
 * Private folder (`_seo`), never routed.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const OG_ALT = `${siteConfig.name} logo and the signature "${siteConfig.tagline}" in green on a black background.`;

/* Dark-theme tokens from app/globals.css (no CSS variables inside next/og). */
const BG = "#000000";
const TEXT = "#F5F5F5";
const MUTED = "#9A9A9A";
const GREEN = LOGO_ICON.colors.onDark;
const GRID = "rgba(245, 245, 245, 0.05)";

const STEPS = ["TikTok post", "Shopify page", "TikTok ad campaign"] as const;

function siteHost(): string {
  try {
    return new URL(siteConfig.url).host;
  } catch {
    return siteConfig.url;
  }
}

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" };

/**
 * Loads Geist (static TTF subset) from Google Fonts. Returns `undefined` on any
 * failure so `ImageResponse` falls back to its bundled Geist Regular.
 * `"use cache"`: with `cacheComponents`, an uncached fetch would make the
 * image routes dynamic; cached, they prerender at build time.
 */
async function loadGeist(text: string): Promise<OgFont[] | undefined> {
  "use cache";
  const load = async (weight: 400 | 600): Promise<OgFont> => {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Geist:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl)).text();
    const match = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
    if (!match) throw new Error("Geist font URL not found");
    const res = await fetch(match[1]);
    if (!res.ok) throw new Error(`Geist font fetch failed: ${res.status}`);
    return { name: "Geist", data: await res.arrayBuffer(), weight, style: "normal" };
  };
  try {
    return await Promise.all([load(400), load(600)]);
  } catch {
    return undefined;
  }
}

export async function renderOgImage(): Promise<ImageResponse> {
  const host = siteHost();
  const allText = [siteConfig.name, siteConfig.tagline, host, ...STEPS, "→"].join("");
  const fonts = await loadGeist(allText);
  const iconSrc = `data:image/svg+xml,${encodeURIComponent(getLogoIconSvg({ size: 112 }))}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
        backgroundColor: BG,
        color: TEXT,
        fontFamily: fonts ? "Geist" : undefined,
        padding: "72px 80px",
      }}
    >
      {/* Faint grid (hard 1px lines, same as the site's bg-grid) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          backgroundImage: `linear-gradient(${GRID} 1px, transparent 1px), linear-gradient(90deg, ${GRID} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />
      {/* Solid green accent bar along the bottom edge */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 10,
          display: "flex",
          backgroundColor: GREEN,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse, not the DOM */}
        <img src={iconSrc} width={112} height={112} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 600,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {siteConfig.name}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: "-0.035em",
            lineHeight: 1.05,
            color: GREEN,
            paddingBottom: 8,
          }}
        >
          {siteConfig.tagline}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: MUTED }}>
          {STEPS.map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {i > 0 ? <span style={{ color: GREEN }}>→</span> : null}
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 80,
          top: 108,
          display: "flex",
          fontSize: 26,
          color: MUTED,
        }}
      >
        {host}
      </div>
    </div>,
    { ...OG_SIZE, fonts },
  );
}
