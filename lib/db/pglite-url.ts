import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Local-development database URLs:
 *   pglite:./.data/dev  → PGlite persisted in that directory (relative to cwd)
 *   pglite:memory       → in-memory PGlite (lost on restart)
 * Returns the PGlite dataDir, or null when `url` is not a pglite: URL.
 */
export function parsePgliteUrl(url: string | undefined, cwd = process.cwd()): string | null {
  if (!url?.startsWith("pglite:")) return null;
  const target = url.slice("pglite:".length).trim();
  if (!target) throw new Error('DATABASE_URL "pglite:" needs a directory, e.g. pglite:./.data/dev');
  if (target === "memory" || target === "memory://") return "memory://";
  return path.resolve(cwd, target);
}

/** PGlite does not create parent directories; do it before opening. */
export function ensurePgliteDir(dataDir: string): string {
  if (dataDir !== "memory://") mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function assertPgliteAllowed(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error(
      "pglite: DATABASE_URLs are for local development only. Use Neon in production.",
    );
  }
}
