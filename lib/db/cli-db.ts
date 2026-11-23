/**
 * Database connection for terminal scripts (`pnpm db:seed`, `pnpm admin:create`):
 * Neon (pooled) or a local PGlite directory (migrations applied here).
 */
import path from "node:path";

import { assertPgliteAllowed, ensurePgliteDir, parsePgliteUrl } from "./pglite-url";
import type { Database } from "./types";

export async function openDatabase(
  url: string,
): Promise<{ db: Database; close: () => Promise<void> }> {
  const dataDir = parsePgliteUrl(url);
  if (dataDir) {
    assertPgliteAllowed();
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { schema } = await import("./schema");
    const client = new PGlite(ensurePgliteDir(dataDir));
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "lib", "db", "migrations") });
    return { db: db as unknown as Database, close: () => client.close() };
  }

  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const { schema } = await import("./schema");
  const pool = new Pool({ connectionString: url });
  return { db: drizzle({ client: pool, schema }) as unknown as Database, close: () => pool.end() };
}
