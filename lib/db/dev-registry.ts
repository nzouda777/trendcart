import type { Database } from "./types";

/*
 * Process-global registry of dev PGlite databases, keyed by data dir.
 * Kept free of PGlite imports so lib/db/client.ts can read it synchronously;
 * lib/db/dev-pglite.ts (loaded with a dynamic import) fills it.
 */

export type DevDb = { db: Database; ready: Promise<void> };

const globalForPglite = globalThis as typeof globalThis & {
  __trendcartDevPglite?: Map<string, DevDb>;
};

export function devDbRegistry(): Map<string, DevDb> {
  return (globalForPglite.__trendcartDevPglite ??= new Map());
}
