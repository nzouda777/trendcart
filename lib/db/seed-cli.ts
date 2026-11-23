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

import { openDatabase } from "./cli-db";
import { DEMO_PASSWORD, SEED_WORKSPACES, seed } from "./seed";

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
