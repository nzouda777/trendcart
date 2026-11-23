export * from "./auth";
export * from "./business";
export * from "./platform";

import { authSchema } from "./auth";
import { businessEnums, businessTables } from "./business";
import { platformTables } from "./platform";

/** Full schema passed to drizzle() and drizzle-kit. */
export const schema = { ...authSchema, ...businessTables, ...businessEnums, ...platformTables };
export type Schema = typeof schema;
