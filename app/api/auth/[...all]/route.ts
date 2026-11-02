import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/session";

// The auth instance is built on the first request, so `next build` needs
// neither DATABASE_URL nor secrets.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
