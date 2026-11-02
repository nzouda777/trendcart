/**
 * Test helper: an in-memory Postgres (PGlite) with every migration applied.
 * Tests only; never import from app code.
 *
 *   const { db, close } = await createTestDb();
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { organization, schema, user } from "./schema";
import type { Database } from "./types";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "lib", "db", "migrations");

export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => client.close() };
}

/** Inserts a bare workspace (organization row) and returns its id. */
export async function insertWorkspace(db: Database, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(organization).values({
    id,
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 6)}`,
    createdAt: new Date(),
  });
  return id;
}

export async function insertUser(db: Database, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(user).values({
    id,
    name,
    email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${id.slice(0, 6)}@example.test`,
    emailVerified: true,
  });
  return id;
}
