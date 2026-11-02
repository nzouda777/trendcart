import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createAuth } from "@/lib/auth/server";

import { createDevPgliteDb, openDevDatabase } from "./dev-pglite";
import { devDbRegistry } from "./dev-registry";
import { assertPgliteAllowed, parsePgliteUrl } from "./pglite-url";
import { brand, organization } from "./schema";
import { seed } from "./seed";

const dir = mkdtempSync(path.join(tmpdir(), "tc-pglite-"));

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("pglite: DATABASE_URL (B2)", () => {
  it("parses directories and memory, and is refused in production", () => {
    expect(parsePgliteUrl("pglite:./.data/dev", "/repo")).toBe(path.resolve("/repo", ".data/dev"));
    expect(parsePgliteUrl("pglite:memory")).toBe("memory://");
    expect(parsePgliteUrl("postgres://x")).toBeNull();
    expect(parsePgliteUrl(undefined)).toBeNull();
    expect(() => parsePgliteUrl("pglite:")).toThrow();
    expect(() => assertPgliteAllowed({ NODE_ENV: "production" })).toThrow(/local development/);
    expect(() => assertPgliteAllowed({ VERCEL_ENV: "production" })).toThrow();
    expect(() => assertPgliteAllowed({ NODE_ENV: "development" })).not.toThrow();
  });

  it("migrates on first use (queries wait), persists, seeds and signs in", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { db, ready } = createDevPgliteDb(dir);
    // Issued immediately: must wait for the migrations instead of failing.
    expect(await db.select().from(organization)).toEqual([]);
    await ready;

    await seed(db);
    expect((await db.select().from(brand)).length).toBe(3);
    // Same process, same dir → same instance (hot reload safe), visible to getDb().
    expect(createDevPgliteDb(dir).db).toBe(db);
    await openDevDatabase(`pglite:${dir}`);
    expect(devDbRegistry().get(dir)?.db).toBe(db);

    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const res = await createAuth(db).api.signInEmail({
      body: { email: "owner@northwind.test", password: "trendcart-demo-2026" },
    });
    expect(res.user.email).toBe("owner@northwind.test");
    // Disk-backed initdb + migrations + seed + password hashing: slow on a loaded machine.
  }, 180_000);
});
