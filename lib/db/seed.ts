/**
 * Demo data: 2 workspaces, each with brands and one member per role.
 * Idempotent (fixed ids, ON CONFLICT DO NOTHING). Run with `pnpm db:seed`.
 *
 * Every seeded user signs in with DEMO_PASSWORD. Emails use the reserved
 * `.test` domain, so nothing can ever be delivered.
 */
import { hashPassword } from "better-auth/crypto";

import type { Role } from "@/lib/domain/contracts";

import { account, brand, member, organization, user } from "./schema";
import type { Database } from "./types";

export const DEMO_PASSWORD = "trendcart-demo-2026";

type SeedWorkspace = {
  id: string;
  name: string;
  slug: string;
  members: { id: string; name: string; email: string; role: Role }[];
  brands: {
    id: string;
    name: string;
    country: string;
    language: string;
    currency: string;
    defaultTestBudget: number;
    minMargin: number;
  }[];
};

export const SEED_WORKSPACES: SeedWorkspace[] = [
  {
    id: "seed_ws_northwind",
    name: "Northwind Goods",
    slug: "northwind-goods",
    members: [
      {
        id: "seed_user_olivia",
        name: "Olivia Owner",
        email: "owner@northwind.test",
        role: "owner",
      },
      {
        id: "seed_user_milo",
        name: "Milo Buyer",
        email: "buyer@northwind.test",
        role: "media_buyer",
      },
      {
        id: "seed_user_cara",
        name: "Cara Creative",
        email: "creative@northwind.test",
        role: "creative",
      },
      { id: "seed_user_vic", name: "Vic Viewer", email: "viewer@northwind.test", role: "viewer" },
    ],
    brands: [
      {
        id: "seed_brand_northwind_home",
        name: "Northwind Home",
        country: "FR",
        language: "fr",
        currency: "EUR",
        defaultTestBudget: 50,
        minMargin: 0.35,
      },
      {
        id: "seed_brand_northwind_pets",
        name: "Northwind Pets",
        country: "US",
        language: "en",
        currency: "USD",
        defaultTestBudget: 75,
        minMargin: 0.4,
      },
    ],
  },
  {
    id: "seed_ws_lumen",
    name: "Lumen Beauty",
    slug: "lumen-beauty",
    members: [
      // Olivia owns both workspaces, to exercise the workspace switcher.
      {
        id: "seed_user_olivia",
        name: "Olivia Owner",
        email: "owner@northwind.test",
        role: "owner",
      },
      { id: "seed_user_ben", name: "Ben Buyer", email: "buyer@lumen.test", role: "media_buyer" },
      {
        id: "seed_user_iris",
        name: "Iris Creative",
        email: "creative@lumen.test",
        role: "creative",
      },
      { id: "seed_user_noah", name: "Noah Viewer", email: "viewer@lumen.test", role: "viewer" },
    ],
    brands: [
      {
        id: "seed_brand_lumen_skin",
        name: "Lumen Skin",
        country: "GB",
        language: "en",
        currency: "GBP",
        defaultTestBudget: 40,
        minMargin: 0.45,
      },
    ],
  },
];

export type SeedResult = { workspaces: number; users: number; members: number; brands: number };

export async function seed(db: Database): Promise<SeedResult> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  const users = new Map<string, { id: string; name: string; email: string }>();
  for (const ws of SEED_WORKSPACES) for (const m of ws.members) users.set(m.id, m);

  await db.transaction(async (tx) => {
    for (const u of users.values()) {
      await tx
        .insert(user)
        .values({ id: u.id, name: u.name, email: u.email, emailVerified: true })
        .onConflictDoNothing();
      await tx
        .insert(account)
        .values({
          id: `${u.id}_credential`,
          accountId: u.id,
          providerId: "credential",
          userId: u.id,
          password: passwordHash,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    for (const ws of SEED_WORKSPACES) {
      await tx
        .insert(organization)
        .values({ id: ws.id, name: ws.name, slug: ws.slug, createdAt: now })
        .onConflictDoNothing();

      for (const m of ws.members) {
        await tx
          .insert(member)
          .values({
            id: `${ws.id}_${m.id}`,
            organizationId: ws.id,
            userId: m.id,
            role: m.role,
            createdAt: now,
          })
          .onConflictDoNothing();
      }

      // Seeding writes the workspace id explicitly: it is the trusted creator
      // of these workspaces, not a request-scoped caller.
      await tx
        .insert(brand)
        .values(ws.brands.map((b) => ({ ...b, workspaceId: ws.id })))
        .onConflictDoNothing();
    }
  });

  return {
    workspaces: SEED_WORKSPACES.length,
    users: users.size,
    members: SEED_WORKSPACES.reduce((n, ws) => n + ws.members.length, 0),
    brands: SEED_WORKSPACES.reduce((n, ws) => n + ws.brands.length, 0),
  };
}
