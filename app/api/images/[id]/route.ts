import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";

import { getWorkspaceContext } from "@/lib/auth/session";
import { verifyImageSignature } from "@/lib/media/images";
import { readPendingImage } from "@/lib/services";
import { readSignedPendingImage } from "@/lib/tenant/system";

/*
 * GET /api/images/:id — an uploaded image still waiting for Shopify.
 *
 *   ?exp&sig  signed, expiring URL (lib/media/images): no session. Used by
 *             SerpApi's reverse image search and the AI analyzer.
 *   otherwise the session's workspace must own the image (previews in the app).
 *
 * 404 once the image reached Shopify (its row is deleted) or for any refusal,
 * so the route never confirms that an id exists.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = request.nextUrl.searchParams;
  const notFound = () => new NextResponse(null, { status: 404 });

  try {
    if (search.has("sig")) {
      if (!verifyImageSignature({ imageId: id, exp: search.get("exp"), sig: search.get("sig") })) {
        return notFound();
      }
      const row = await readSignedPendingImage(id);
      if (!row) return notFound();
      return imageResponse(row.mimeType, Buffer.from(row.dataBase64, "base64"), "public");
    }
    const ctx = await getWorkspaceContext();
    const image = await readPendingImage(ctx, id);
    return imageResponse(image.mimeType, image.bytes, "private");
  } catch (error) {
    // Let Next's prerender bailout / redirect() / notFound() through.
    unstable_rethrow(error);
    return notFound();
  }
}

function imageResponse(mimeType: string, bytes: Buffer, cache: "public" | "private") {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.byteLength),
      // Short: the image disappears once it is on Shopify.
      "Cache-Control": `${cache}, max-age=300`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
