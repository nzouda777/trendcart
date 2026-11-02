export * from "./auth";
export * from "./business";

import { authSchema } from "./auth";
import { businessEnums, businessTables } from "./business";

/** Full schema passed to drizzle() and drizzle-kit. */
export const schema = { ...authSchema, ...businessTables, ...businessEnums };
export type Schema = typeof schema;
