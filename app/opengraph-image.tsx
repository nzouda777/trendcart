import { OG_ALT, OG_SIZE, renderOgImage } from "./_seo/og-image";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderOgImage();
}
