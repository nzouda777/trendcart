/**
 * M1 security checks that need no database: schema invariants, import
 * boundaries, role checks on every exported service, redirect and SSRF
 * guards. `it.fails` marks a known open finding (docs/qa/milestone-1.md):
 * it turns red once the bug is fixed, so flip it to `it` then.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/paths";
import { authSchema, businessTables } from "@/lib/db/schema";
import * as businessModule from "@/lib/db/schema/business";
import type { Database } from "@/lib/db/types";
import type { Role } from "@/lib/domain/contracts";
import { fetch as undiciFetch } from "undici";
import { proxyKind } from "@/lib/integrations/tiktok-data/http";
import {
  BlockedAddressError,
  createGuardedAgent,
  findBlockedAddress,
  isPublicIp,
} from "@/lib/integrations/tiktok-data/net-guard";
import * as services from "@/lib/services";
import { proxyUrlSchema } from "@/lib/services/brands";
import { normalizeProductUrl } from "@/lib/sourcing/links";
import { createSystemContext, type WorkspaceContext } from "@/lib/tenant/context";
import { createScopedDb } from "@/lib/tenant/scoped-db";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");

/* -------------------------------------------------------------------------- */

describe("schema: tenancy invariants", () => {
  const business = (Object.values(businessModule) as unknown[]).filter((v): v is PgTable =>
    is(v, PgTable),
  );
  const businessSet = new Set<PgTable>(Object.values(businessTables) as PgTable[]);

  it("every table in the business schema is registered with scoped-db", () => {
    expect(business.length).toBeGreaterThan(10);
    for (const t of business) {
      expect(businessSet.has(t), `${getTableConfig(t).name} is not in businessTables`).toBe(true);
    }
  });

  it("every business table has a NOT NULL workspace_id referencing organization, and an index on it", () => {
    for (const t of businessSet) {
      const cfg = getTableConfig(t);
      const col = cfg.columns.find((c) => c.name === "workspace_id");
      expect(col, `${cfg.name}.workspace_id`).toBeDefined();
      expect(col!.notNull, `${cfg.name}.workspace_id NOT NULL`).toBe(true);
      const wsFk = cfg.foreignKeys.some((fk) => {
        const r = fk.reference();
        return (
          r.columns.length === 1 &&
          r.columns[0]!.name === "workspace_id" &&
          getTableConfig(r.foreignTable).name === "organization"
        );
      });
      expect(wsFk, `${cfg.name} → organization FK`).toBe(true);
      const indexed = cfg.indexes.some((i) =>
        i.config.columns.some((c) => "name" in c && c.name === "workspace_id"),
      );
      expect(indexed, `${cfg.name} workspace index`).toBe(true);
    }
  });

  it("every reference between business tables is a composite (workspace_id, id) FK", () => {
    for (const t of businessSet) {
      const cfg = getTableConfig(t);
      for (const fk of cfg.foreignKeys) {
        const r = fk.reference();
        if (!businessSet.has(r.foreignTable)) continue;
        const local = r.columns.map((c) => c.name);
        const foreign = r.foreignColumns.map((c) => c.name);
        expect(local[0], `${cfg.name} FK ${fk.getName()}`).toBe("workspace_id");
        expect(foreign[0], `${cfg.name} FK ${fk.getName()}`).toBe("workspace_id");
        expect(local.length).toBe(2);
      }
    }
  });

  it("business tables and auth tables do not overlap", () => {
    for (const t of Object.values(authSchema) as PgTable[]) expect(businessSet.has(t)).toBe(false);
  });

  it("secret columns are *_enc and nothing stores a media URL column", () => {
    const secretish = /(token|secret|password|spark|proxy_url)/;
    for (const t of businessSet) {
      const cfg = getTableConfig(t);
      for (const c of cfg.columns) {
        if (cfg.name === "proxy" && c.name === "url_enc") continue;
        // Token expiry timestamps are metadata, not secrets.
        if (c.name.endsWith("_expires_at")) continue;
        if (secretish.test(c.name)) {
          expect(c.name, `${cfg.name}.${c.name} should be encrypted (_enc)`).toMatch(/_enc$/);
        }
        expect(c.name).not.toMatch(/media_url|play_url|download_url/);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("import boundaries", () => {
  const appUi = [...walk(path.join(ROOT, "app", "(app)")), ...walk(path.join(ROOT, "components"))];
  const everything = [
    ...walk(path.join(ROOT, "app")),
    ...walk(path.join(ROOT, "components")),
    ...walk(path.join(ROOT, "lib")),
  ];

  it("app UI and components never import the raw db, adapters, crypto or system helpers", () => {
    const forbidden =
      /from\s+["']@\/lib\/(db\/client|integrations(\/|["'])|crypto|tenant\/system|tenant\/scoped-db|services\/internal|workflows|ai(\/|["'])|sourcing)/;
    const offenders = appUi.filter((f) => {
      // Type-only imports carry no runtime code.
      const runtime = read(f)
        .split("\n")
        .filter((l) => !/^\s*import\s+type\s/.test(l))
        .join("\n");
      return forbidden.test(runtime);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("only foundation layers import lib/db/client", () => {
    const allowed = /^lib\/(db|auth|tenant|audit)\//;
    const offenders = everything
      .filter((f) => /@\/lib\/db\/client|\.\/client["']/.test(read(f)))
      .map(rel)
      .filter((f) => !allowed.test(f));
    expect(offenders).toEqual([]);
  });

  it("client components only import client-safe lib modules", () => {
    const serverOnly =
      /from\s+["']@\/lib\/(db|crypto|integrations|services(?!\/types|\/errors)|tenant\/(?!actions)|auth\/(session|server|oauth-state|guards)|workflows|audit)/;
    const offenders = everything.filter((f) => {
      const src = read(f);
      if (!/^\s*["']use client["']/m.test(src.split("\n").slice(0, 3).join("\n"))) return false;
      return src
        .split("\n")
        .filter((l) => !/^\s*import\s+type\s/.test(l))
        .some((l) => serverOnly.test(l));
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('modules that touch secrets or the raw db are marked "server-only"', () => {
    const mustBeServerOnly = [
      "lib/db/client.ts",
      "lib/crypto/index.ts",
      "lib/crypto/cipher.ts",
      "lib/tenant/context.ts",
      "lib/auth/session.ts",
      "lib/auth/oauth-state.ts",
      "lib/tenant/system.ts",
      "lib/tenant/members.ts",
      "lib/integrations/index.ts",
      "lib/integrations/shopify/live.ts",
      "lib/integrations/shopify/install.ts",
      "lib/integrations/shopify/credentials.ts",
      "lib/integrations/tiktok-ads/live.ts",
      "lib/integrations/tiktok-posting/live.ts",
      "lib/services/index.ts",
      "lib/services/brands.ts",
      "lib/services/connections.ts",
      "lib/services/products.ts",
      "lib/services/internal/credentials.ts",
      "lib/workflows/call-context.ts",
      "app/api/tiktok/_lib/connect.ts",
      "app/api/cron/tiktok-token-refresh/refresh.ts",
    ];
    const missing = mustBeServerOnly.filter(
      (f) => !/^import ["']server-only["'];/m.test(read(path.join(ROOT, f))),
    );
    expect(missing).toEqual([]);
  });

  it('the live TikTok data adapter (reads the provider API key) is "server-only"', () => {
    // N1 fixed: lib/integrations/tiktok-data/live.ts imports "server-only".
    expect(read(path.join(ROOT, "lib/integrations/tiktok-data/live.ts"))).toMatch(
      /^import ["']server-only["'];/m,
    );
  });

  it("no NEXT_PUBLIC_ variable carries a secret", () => {
    const env = read(path.join(ROOT, ".env.example"));
    const publics = env.match(/^NEXT_PUBLIC_[A-Z_]+/gm) ?? [];
    expect(publics.filter((n) => /SECRET|KEY|TOKEN|PASSWORD|DSN/.test(n))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("role checks on every exported service", () => {
  // A db that must never be reached: the role check comes first.
  const untouchable = new Proxy(
    {},
    {
      get() {
        throw new Error("db reached before the role check");
      },
    },
  ) as unknown as Database;

  const system: WorkspaceContext = createSystemContext(untouchable, {
    workspaceId: "ws_test",
    name: "qa:system",
  });
  const asRole = (role: Role): WorkspaceContext => ({
    workspaceId: "ws_test",
    db: createScopedDb(untouchable, "ws_test"),
    actor: { kind: "user", userId: "u_test", role, name: "QA", email: "qa@example.test" },
  });

  const notServices = new Set(["connectionHealth", "toServiceFailure", "ServiceError"]);
  const fns = Object.entries(services).filter(
    ([name, v]) => typeof v === "function" && !notServices.has(name) && /^[a-z]/.test(name),
  ) as [string, (...args: unknown[]) => Promise<unknown>][];

  it("finds the M1 services", () => {
    expect(fns.map(([n]) => n).sort()).toEqual(
      expect.arrayContaining([
        "confirmProduct",
        "createBrand",
        "disconnectConnection",
        "importFromTikTok",
        "listProducts",
        "setBrandProxy",
      ]),
    );
  });

  it("system actors are refused by every service before any db access", async () => {
    for (const [name, fn] of fns) {
      const error = await Promise.resolve()
        .then(() => fn(system, "x", "x", {}))
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error, name).toBeInstanceOf(ForbiddenError);
    }
  });

  it("viewers are refused by every mutating service before any db access", async () => {
    const reads = new Set([
      "getBrand",
      "listBrands",
      "listConnections",
      "getProduct",
      "listProducts",
      "listMembers",
      "listShopifyTemplates",
      "getProductPipeline",
      "listSuppliers",
      "quoteSupplierChoice",
      // Workspace settings are readable by every member (AI models and caps).
      "getWorkspaceSettings",
    ]);
    // Usage is media buyer+ (cost data), so viewers are refused there too.
    for (const [name, fn] of fns.filter(([n]) => !reads.has(n))) {
      const error = await Promise.resolve()
        .then(() => fn(asRole("viewer"), "x", "x", {}))
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error, name).toBeInstanceOf(ForbiddenError);
    }
  });

  it("only owners can disconnect connections or delete brands", async () => {
    for (const role of ["viewer", "creative", "media_buyer"] as Role[]) {
      await expect(
        services.disconnectConnection(asRole(role), { kind: "shopify", connectionId: "c" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(services.deleteBrand(asRole(role), "b")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("creatives cannot change proxies or connections", async () => {
    const creative = asRole("creative");
    await expect(
      services.setBrandProxy(creative, "b", { url: "http://p.example:1" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      services.setShopifyTemplate(creative, { connectionId: "c", templateSuffix: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/* -------------------------------------------------------------------------- */

describe("open redirects (?next=)", () => {
  it("rejects absolute and protocol-relative targets", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad)).toBe("/app");
    }
    expect(safeNextPath("/app/products?x=1")).toBe("/app/products?x=1");
  });

  it("rejects targets that browsers normalise to another origin (tab / newline / backslash)", () => {
    // Fixed (S1): WHATWG URL parsing strips \t \n \r and treats "\" as "/";
    // safeNextPath now refuses control chars and backslashes.
    for (const bad of [
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\t\\evil.example",
    ]) {
      const resolved = new URL(safeNextPath(bad), "https://app.trendcart.test");
      expect(resolved.origin, JSON.stringify(bad)).toBe("https://app.trendcart.test");
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("SSRF guards on user-supplied URLs", () => {
  it("product links cannot target internal hosts, IP literals, credentials or odd ports", () => {
    for (const bad of [
      "http://localhost/admin",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/",
      "http://printer.local/",
      "http://intranet/",
      "https://user:pass@shop.example.com/p",
      "https://shop.example.com:8443/p",
      "file:///etc/passwd",
      "ftp://shop.example.com/p",
    ]) {
      expect(() => normalizeProductUrl(bad), bad).toThrow();
    }
    expect(normalizeProductUrl("https://Shop.Example.com/p?utm_source=tt&variant=2#x")).toBe(
      "https://shop.example.com/p?variant=2",
    );
  });

  it("hostnames that resolve to private IPs (DNS rebinding, *.nip.io) are blocked at connect time", async () => {
    // S3 fixed: direct fetches use an undici Agent whose connector vets every
    // resolved address (and IP literals), on every connection and redirect hop.
    const agent = createGuardedAgent((hostname, _options, callback) =>
      callback(null, [
        { address: hostname.startsWith("127.") ? "127.0.0.1" : "10.0.0.8", family: 4 },
      ]),
    );
    for (const url of [
      "http://127.0.0.1.nip.io/admin",
      "http://rebind.example.com/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      const error = await undiciFetch(url, { dispatcher: agent }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(findBlockedAddress(error), url).toBeInstanceOf(BlockedAddressError);
    }
    expect(isPublicIp("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIp("100.64.1.1")).toBe(false);
    expect(isPublicIp("fd00::1")).toBe(false);
  });

  it("the import service rejects internal product links before storing them", async () => {
    // S2 (fixed): importFromProductLink runs parseImportLink before any DB access.
    const reached = new Error("db reached");
    const db = new Proxy(
      {},
      {
        get() {
          throw reached;
        },
      },
    ) as unknown as Database;
    const owner: WorkspaceContext = {
      workspaceId: "ws",
      db: createScopedDb(db, "ws"),
      actor: { kind: "user", userId: "u", role: "owner", name: "QA", email: "qa@example.test" },
    };
    const error = await services
      .importFromProductLink(owner, { url: "http://localhost:3000/api/x", brandId: "b" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    expect(error).not.toBe(reached);
  });

  it("every proxy URL the brand settings accept can actually be used", () => {
    // S4 (fixed): settings accept exactly http, https and socks5 on public hosts,
    // a subset of what proxyKind() can dial.
    for (const url of [
      "http://u:p@proxy.example:8080",
      "https://proxy.example:8443",
      "socks5://u:p@proxy.example:1080",
    ]) {
      expect(proxyUrlSchema.safeParse(url).success, url).toBe(true);
      expect(() => proxyKind(url), url).not.toThrow();
    }
    for (const url of [
      "socks5h://proxy.example:1080",
      "http://localhost:8080",
      "http://10.0.0.5:3128",
      "socks5://127.0.0.1:1080",
    ]) {
      expect(proxyUrlSchema.safeParse(url).success, url).toBe(false);
    }
  });
});
