/**
 * Workspace-scoped data access. The ONLY way to read or write business tables.
 *
 * A ScopedDb is bound to one workspace id when it is created. Every method:
 * - accepts only tables registered in `businessTables` (auth tables and
 *   unknown tables throw);
 * - ANDs `workspace_id = <bound id>` into every WHERE (select, count, update,
 *   delete, upsert conflict target);
 * - forces `workspace_id` on every insert (callers cannot pass it: the type
 *   omits it and any runtime value is overwritten) and strips it from updates.
 *
 * There is no raw query escape hatch. Composite FKs (lib/db/schema) also stop
 * a row from referencing a parent in another workspace.
 *
 * Get one from the session with `getWorkspaceContext()` (lib/tenant/context).
 * `createScopedDb` is for lib/tenant, background workflows that already
 * loaded the workspace id from a trusted record, and tests.
 *
 * @example
 *   const { db } = await getWorkspaceContext();
 *   const rows = await db.select(product, { where: (p) => eq(p.status, "imported") });
 *   const brandRow = await db.insert(brand, { name: "Acme", country: "FR", language: "fr" });
 *   await db.update(product, { name: "New" }, (p) => eq(p.id, id));
 */
import { and, count as countFn, eq, type AnyColumn, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { businessTables } from "@/lib/db/schema";
import type { Database } from "@/lib/db/types";
import { NotFoundError } from "@/lib/auth/errors";

type BusinessTables = typeof businessTables;
export type ScopedTable = BusinessTables[keyof BusinessTables];
export type ScopedTableName = keyof BusinessTables;

export type Row<T extends ScopedTable> = T["$inferSelect"];
/** Insert shape: everything except workspaceId, which is injected. */
export type NewRow<T extends ScopedTable> = Omit<T["$inferInsert"], "workspaceId">;
/** Update shape: workspaceId and id can never change. */
export type Patch<T extends ScopedTable> = Partial<Omit<T["$inferInsert"], "workspaceId" | "id">>;

export type Where<T extends ScopedTable> = SQL | undefined | ((table: T) => SQL | undefined);
type OrderBy<T extends ScopedTable> =
  SQL | AnyColumn | (SQL | AnyColumn)[] | ((table: T) => SQL | AnyColumn | (SQL | AnyColumn)[]);

export type SelectOptions<T extends ScopedTable> = {
  where?: Where<T>;
  orderBy?: OrderBy<T>;
  limit?: number;
  offset?: number;
};

export type UpsertOptions<T extends ScopedTable> = {
  /** Unique columns, WITHOUT workspaceId (it is prepended automatically). */
  target: (table: T) => AnyPgColumn[];
  /** Columns to overwrite on conflict. Defaults to every provided value. */
  set?: Patch<T>;
};

export interface ScopedDb {
  readonly workspaceId: string;
  select<T extends ScopedTable>(table: T, options?: SelectOptions<T>): Promise<Row<T>[]>;
  findFirst<T extends ScopedTable>(
    table: T,
    where?: Where<T>,
    options?: Omit<SelectOptions<T>, "where" | "limit">,
  ): Promise<Row<T> | undefined>;
  findById<T extends ScopedTable>(table: T, id: string): Promise<Row<T> | undefined>;
  /** Like findById but throws NotFoundError (also for rows of other workspaces). */
  getById<T extends ScopedTable>(table: T, id: string): Promise<Row<T>>;
  count<T extends ScopedTable>(table: T, where?: Where<T>): Promise<number>;
  insert<T extends ScopedTable>(table: T, values: NewRow<T>): Promise<Row<T>>;
  insertMany<T extends ScopedTable>(table: T, values: NewRow<T>[]): Promise<Row<T>[]>;
  /** INSERT … ON CONFLICT (workspace_id, …target) DO UPDATE. */
  upsert<T extends ScopedTable>(
    table: T,
    values: NewRow<T>,
    options: UpsertOptions<T>,
  ): Promise<Row<T>>;
  /** `where` is required; pass `undefined` explicitly to touch every row of the workspace. */
  update<T extends ScopedTable>(table: T, set: Patch<T>, where: Where<T>): Promise<Row<T>[]>;
  delete<T extends ScopedTable>(table: T, where: Where<T>): Promise<Row<T>[]>;
  /** Runs `fn` in a transaction; the scoped handle stays bound to the same workspace. */
  transaction<R>(fn: (tx: ScopedDb) => Promise<R>): Promise<R>;
}

const registered = new Set<PgTable>(Object.values(businessTables) as PgTable[]);

type AnyScoped = ScopedTable & { workspaceId: AnyPgColumn; id: AnyPgColumn };

function assertScoped<T extends ScopedTable>(table: T): AnyScoped {
  if (!registered.has(table as unknown as PgTable)) {
    throw new Error("scoped-db: table is not a registered business table.");
  }
  return table as AnyScoped;
}

function resolveWhere<T extends ScopedTable>(table: T, where: Where<T>): SQL | undefined {
  return typeof where === "function" ? where(table) : where;
}

function scopedWhere<T extends ScopedTable>(table: T, workspaceId: string, where: Where<T>): SQL {
  const t = assertScoped(table);
  const user = resolveWhere(table, where);
  const scope = eq(t.workspaceId, workspaceId);
  return user ? (and(scope, user) as SQL) : scope;
}

function withoutKeys<V extends object>(values: V, keys: string[]): V {
  const copy = { ...values } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as V;
}

function stamp<T extends ScopedTable>(values: NewRow<T>, workspaceId: string) {
  // Overwrite whatever a caller may have smuggled in through a cast.
  return { ...withoutKeys(values, ["workspaceId"]), workspaceId } as T["$inferInsert"];
}

function assertWorkspaceId(workspaceId: string) {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error("scoped-db: a workspace id is required.");
  }
}

/* Drizzle's builder generics do not survive a union of tables; the public
 * signatures above carry the real types, so the internals use `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function createScopedDb(db: Database, workspaceId: string): ScopedDb {
  assertWorkspaceId(workspaceId);
  const d = db as any;

  const select: ScopedDb["select"] = async (table, options = {}) => {
    let q = d
      .select()
      .from(table)
      .where(scopedWhere(table, workspaceId, options.where));
    if (options.orderBy) {
      const order =
        typeof options.orderBy === "function" ? options.orderBy(table) : options.orderBy;
      q = q.orderBy(...(Array.isArray(order) ? order : [order]));
    }
    if (options.limit !== undefined) q = q.limit(options.limit);
    if (options.offset !== undefined) q = q.offset(options.offset);
    return q;
  };

  const scoped: ScopedDb = {
    workspaceId,

    select,

    async findFirst(table, where, options) {
      const rows = await select(table, { ...options, where, limit: 1 });
      return rows[0];
    },

    async findById(table, id) {
      const t = assertScoped(table);
      const rows = await select(table, { where: eq(t.id, id), limit: 1 });
      return rows[0];
    },

    async getById(table, id) {
      const row = await scoped.findById(table, id);
      if (!row) throw new NotFoundError();
      return row;
    },

    async count(table, where) {
      const rows = await d
        .select({ value: countFn() })
        .from(table)
        .where(scopedWhere(table, workspaceId, where));
      return Number(rows[0]?.value ?? 0);
    },

    async insert(table, values) {
      assertScoped(table);
      const rows = await d.insert(table).values(stamp(values, workspaceId)).returning();
      return rows[0];
    },

    async insertMany(table, values) {
      assertScoped(table);
      if (values.length === 0) return [];
      return d
        .insert(table)
        .values(values.map((v) => stamp(v, workspaceId)))
        .returning();
    },

    async upsert(table, values, options) {
      const t = assertScoped(table);
      const stamped = stamp(values, workspaceId);
      const set = withoutKeys(options.set ?? (values as Patch<typeof table>), [
        "workspaceId",
        "id",
      ]);
      const rows = await d
        .insert(table)
        .values(stamped)
        .onConflictDoUpdate({
          target: [t.workspaceId, ...options.target(table)],
          set,
          // Belt and braces: never update a row of another workspace.
          setWhere: eq(t.workspaceId, workspaceId),
        })
        .returning();
      return rows[0];
    },

    async update(table, set, where) {
      assertScoped(table);
      const patch = withoutKeys(set, ["workspaceId", "id"]);
      if (Object.keys(patch).length === 0) throw new Error("scoped-db: empty update.");
      return d
        .update(table)
        .set(patch)
        .where(scopedWhere(table, workspaceId, where))
        .returning();
    },

    async delete(table, where) {
      assertScoped(table);
      return d
        .delete(table)
        .where(scopedWhere(table, workspaceId, where))
        .returning();
    },

    async transaction(fn) {
      return d.transaction((tx: Database) => fn(createScopedDb(tx, workspaceId)));
    },
  };

  return Object.freeze(scoped);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
