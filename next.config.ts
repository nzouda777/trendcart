import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const isDev = process.env.NODE_ENV !== "production";

/*
 * Pragmatic CSP. Next.js streams RSC payloads and next-themes sets the theme
 * through inline <script>s, and nonces would force every page to render
 * dynamically (no static shell / PPR), so scripts allow 'unsafe-inline' from
 * our own origin only. The headers that matter most here are
 * frame-ancestors 'none' (no clickjacking of approval buttons), object-src
 * 'none', base-uri and form-action. Dev adds 'unsafe-eval' and ws: for HMR.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Product, supplier and TikTok thumbnails are remote https images.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Dev-only local database (DATABASE_URL=pglite:...): load PGlite from
  // node_modules at runtime instead of bundling its WASM. Production code
  // never references it (see lib/db/client.ts).
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Vercel Workflow: compiles "use workflow" / "use step" and serves /.well-known/workflow/*.
export default withWorkflow(nextConfig);
