import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createAuth } from "@/lib/auth/server";
import { listUserWorkspaces } from "@/lib/tenant/context";
import { createScopedDb } from "@/lib/tenant/scoped-db";

import { brand, member, organization } from "./schema";
import { DEMO_PASSWORD, SEED_WORKSPACES, seed } from "./seed";
import { createTestDb } from "./testing";
import type { Database } from "./types";

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("seed", () => {
  it("creates 2 workspaces with every role, and is idempotent", async () => {
    const first = await seed(db);
    await seed(db);
    expect(first.workspaces).toBe(2);

    expect(await db.select().from(organization)).toHaveLength(2);
    for (const ws of SEED_WORKSPACES) {
      const roles = (await db.select().from(member).where(eq(member.organizationId, ws.id))).map(
        (m) => m.role,
      );
      expect(new Set(roles)).toEqual(new Set(["owner", "media_buyer", "creative", "viewer"]));
      expect(await createScopedDb(db, ws.id).count(brand)).toBe(ws.brands.length);
    }
    expect(await db.select().from(brand)).toHaveLength(first.brands);
  });

  it("seeded users can sign in with the demo password", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const auth = createAuth(db);
    const res = await auth.api.signInEmail({
      body: { email: "owner@northwind.test", password: DEMO_PASSWORD },
    });
    expect(res.user.email).toBe("owner@northwind.test");

    const workspaces = await listUserWorkspaces(db, res.user.id);
    expect(workspaces.map((w) => w.slug)).toEqual(["northwind-goods", "lumen-beauty"]);
  });
});
