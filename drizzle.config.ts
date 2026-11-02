import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

import { ensurePgliteDir, parsePgliteUrl } from "./lib/db/pglite-url";

// drizzle-kit does not read Next's env files; load .env.local when present.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL ?? "";
const pgliteDir = parsePgliteUrl(url);

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  // Only needed by migrate/push/studio; `generate` works offline.
  // DATABASE_URL=pglite:./.data/dev targets the local PGlite directory.
  ...(pgliteDir
    ? { driver: "pglite" as const, dbCredentials: { url: ensurePgliteDir(pgliteDir) } }
    : { dbCredentials: { url } }),
  strict: true,
  verbose: true,
});
