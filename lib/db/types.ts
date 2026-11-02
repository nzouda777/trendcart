import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Schema } from "./schema";

/**
 * Any Drizzle Postgres database built with our schema: Neon in the app,
 * PGlite in tests. Only lib/db, lib/tenant, lib/auth and lib/audit may hold
 * one; everything else receives a ScopedDb.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;
