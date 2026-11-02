/**
 * `pnpm db:seed`: seeds the database at DATABASE_URL with demo data.
 *
 * - Neon: run `pnpm db:migrate` first.
 * - pglite:<dir>: migrations are applied here; stop `pnpm dev` first
 *   (PGlite is single-process).
 *
 * Refuses to run in production.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { assertPgliteAllowed, ensurePgliteDir, parsePgliteUrl } from "./pglite-url";
import { DEMO_PASSWORD, SEED_WORKSPACES, seed } from "./seed";
import type { Database } from "./types";

async function openDatabase(url: string): Promise<{ db: Database; close: () => Promise<void> }> {
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

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to seed demo data in production.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");

  const { db, close } = await openDatabase(url);
  try {
    const result = await seed(db);
    console.info(`Seeded ${JSON.stringify(result)}`);
    console.info(`\nDemo accounts (password: ${DEMO_PASSWORD}):`);
    for (const ws of SEED_WORKSPACES) {
      console.info(`  ${ws.name}`);
      for (const m of ws.members) console.info(`    ${m.role.padEnd(11)} ${m.email}`);
    }
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
