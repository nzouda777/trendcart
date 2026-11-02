import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { devDbRegistry, type DevDb } from "./dev-registry";
import { assertPgliteAllowed, ensurePgliteDir, parsePgliteUrl } from "./pglite-url";
import { schema } from "./schema";
import type { Database } from "./types";

/*
 * Development-only database: PGlite (embedded Postgres in WASM), persisted in
 * a local directory. Never part of production bundles: it is only reached
 * through a dynamic import from instrumentation.ts (dev, DATABASE_URL
 * starting with "pglite:"), from the seed CLI and from tests.
 *
 * Migrations run automatically on open; queries issued before they finish
 * wait for them. PGlite is single-process, so stop `pnpm dev` before running
 * `pnpm db:migrate` / `pnpm db:seed` against the same directory.
 */

const GATED = new Set<PropertyKey>(["query", "exec", "transaction", "sql"]);

/** One instance per data dir per process (survives dev hot reloads). */
export function createDevPgliteDb(dataDir: string): DevDb {
  const registry = devDbRegistry();
  const existing = registry.get(dataDir);
  if (existing) return existing;

  const raw = new PGlite(ensurePgliteDir(dataDir));
  const ready = migrate(drizzle({ client: raw }), {
    migrationsFolder: path.join(process.cwd(), "lib", "db", "migrations"),
  }).catch((error: unknown) => {
    console.error("[db] PGlite migrations failed", error);
    throw error;
  });

  // App queries wait until the migrations above are applied.
  const gated = new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (!GATED.has(prop)) return (value as (...a: unknown[]) => unknown).bind(target);
      return async (...args: unknown[]) => {
        await ready;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  const entry: DevDb = {
    db: drizzle({ client: gated, schema }) as unknown as Database,
    ready,
  };
  registry.set(dataDir, entry);
  return entry;
}

/** Called once at dev server start (instrumentation.ts). */
export async function openDevDatabase(url: string): Promise<void> {
  const dataDir = parsePgliteUrl(url);
  if (!dataDir) return;
  assertPgliteAllowed();
  const { ready } = createDevPgliteDb(dataDir);
  await ready;
  console.info(`[db] Local PGlite database ready at ${dataDir}`);
}
