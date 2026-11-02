/**
 * M2 QA helpers: a recording wrapper around the mock Shopify adapter (which
 * store each call went to) and shortcuts to drive a product to GATE 2 / 3
 * through the real services in INTEGRATIONS_MODE=mock.
 *
 * Tests only. Never import from app code.
 */
import type { Integrations, ShopifyClient } from "@/lib/domain/contracts";
import {
  confirmProduct,
  getProductPipeline,
  importFromTikTok,
  selectSupplier,
} from "@/lib/services";
import type { ServiceDeps } from "@/lib/services";
import type { WorkspaceContext } from "@/lib/tenant/context";

import { mockDeps, type Tenant } from "./world";

export type ShopifyCall = { method: string; shopDomain: string | null; args: unknown[] };

/** Intercepts a ShopifyClient method: receives the bound original and the call arguments. */
export type ShopifyHooks = Partial<
  Record<
    keyof ShopifyClient,
    (original: (...a: unknown[]) => unknown, ...args: unknown[]) => unknown
  >
>;

/**
 * Same integrations, with `shopify` wrapped: every call is recorded with the
 * shop domain of its credentials. `hooks` can intercept a method (races).
 */
export function recordShopify(base: Integrations, hooks: ShopifyHooks = {}) {
  const calls: ShopifyCall[] = [];
  const shopify = new Proxy(base.shopify, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const name = String(prop);
      return (...args: unknown[]) => {
        const creds = args[0] as { shopDomain?: unknown } | undefined;
        calls.push({
          method: name,
          shopDomain: typeof creds?.shopDomain === "string" ? creds.shopDomain : null,
          args,
        });
        const original = (value as (...a: unknown[]) => unknown).bind(target);
        const hook = hooks[name as keyof ShopifyClient];
        return hook ? hook(original, ...args) : original(...args);
      };
    },
  });
  const integrations: Integrations = { ...base, shopify };
  return { integrations, calls };
}

/** Import a TikTok link and pass GATE 1: the inline mock pipeline stops at GATE 2. */
export async function toGate2(t: Tenant, url: string, deps: ServiceDeps) {
  const { product } = await importFromTikTok(t.creative, { url, brandId: t.brandId }, deps);
  await confirmProduct(t.creative, { productId: product.id }, deps);
  return getProductPipeline(t.viewer, product.id);
}

/** Import, GATE 1, GATE 2 on the best listing: the inline mock pipeline stops at GATE 3. */
export async function toGate3(
  t: Tenant,
  url: string,
  deps: ServiceDeps,
  actor: WorkspaceContext = t.creative,
) {
  const at2 = await toGate2(t, url, deps);
  return selectSupplier(
    actor,
    { productId: at2.id, supplierMatchId: at2.suppliers[0]!.id, acceptLowMargin: true },
    deps,
  );
}

/** A well-formed copy version, for calls refused before the version is compared. */
export const ANY_COPY_VERSION = "0000000000000000";

/** The page copy version a reviewer would have loaded (approvePage input). */
export async function copyVersionOf(ctx: WorkspaceContext, productId: string): Promise<string> {
  const version = (await getProductPipeline(ctx, productId)).pageCopyVersion;
  if (!version) throw new Error("This product has no page copy yet.");
  return version;
}

export { mockDeps };
