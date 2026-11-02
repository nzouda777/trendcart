import "server-only";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import { devDbRegistry } from "./dev-registry";
import { assertPgliteAllowed, parsePgliteUrl } from "./pglite-url";
import { schema } from "./schema";
import type { Database } from "./types";

/*
 * Raw, unscoped database. Do NOT import this from pages, components or
 * services: use getWorkspaceContext() (lib/tenant) and its scoped `db`.
 *
 * Production: Neon serverless driver over WebSockets (Pool), not neon-http,
 * because Better Auth and our gate services need interactive transactions.
 *
 * Local development: DATABASE_URL=pglite:./.data/dev uses an embedded PGlite
 * database, opened (and migrated) by instrumentation.ts when `pnpm dev`
 * starts; this module only reads it from the dev registry, so PGlite is never
 * imported here and never reaches production bundles.
 */

let instance: Database | undefined;

export function getDb(): Database {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Use a Neon connection string, or pglite:./.data/dev for local development (see .env.example).",
    );
  }

  const dataDir = parsePgliteUrl(url);
  if (dataDir) {
    assertPgliteAllowed();
    const dev = devDbRegistry().get(dataDir);
    if (!dev) {
      throw new Error(
        "The local PGlite database is not open. It is opened by instrumentation.ts when `pnpm dev` starts: restart the dev server.",
      );
    }
    instance = dev.db;
    return instance;
  }

  instance = drizzle({
    client: new Pool({ connectionString: url }),
    schema,
  }) as unknown as Database;
  return instance;
}
