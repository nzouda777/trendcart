import { ImageResponse } from "next/og";

import { getLogoIconSvg, LOGO_ICON } from "@/components/brand/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** 180×180 home-screen icon: solid green logo icon on plain black. */
export default function AppleIcon() {
  const iconSrc = `data:image/svg+xml,${encodeURIComponent(
    getLogoIconSvg({ size: 120, color: LOGO_ICON.colors.onDark }),
  )}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse, not the DOM */}
      <img src={iconSrc} width={120} height={120} alt="" />
    </div>,
    size,
  );
}
