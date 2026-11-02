"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/components/app/action-result";
import {
  clearBrandProxy,
  disconnectConnection,
  listShopifyTemplates,
  setBrandProxy,
  setShopifyTemplate,
  toggleBrandProxy,
} from "@/lib/services";
import type { ConnectionKind, ShopifyTemplatesDTO } from "@/lib/services/types";

import { runAction } from "../_lib/action";

/*
 * Connection actions. Results never carry secrets: the services return
 * DTOs without tokens, and the proxy URL is only ever sent in, not back.
 */

function done<T>(result: ActionResult<T>): ActionResult<undefined> {
  if (!result.ok) return result;
  refresh();
  return { ok: true, data: undefined };
}

export async function disconnectAction(kind: ConnectionKind, connectionId: string) {
  return done(await runAction((ctx) => disconnectConnection(ctx, { kind, connectionId })));
}

/**
 * Product templates of the store's live theme, for the template picker. Calls
 * Shopify each time, so the UI calls it only when someone opens the picker of
 * one connection (never per row on render). A failure (expired connection,
 * Shopify error) is returned so the UI can fall back to a free-text suffix.
 */
export async function listTemplatesAction(
  connectionId: string,
): Promise<ActionResult<ShopifyTemplatesDTO>> {
  return runAction((ctx) => listShopifyTemplates(ctx, connectionId));
}

export async function setTemplateAction(connectionId: string, templateSuffix: string | null) {
  return done(await runAction((ctx) => setShopifyTemplate(ctx, { connectionId, templateSuffix })));
}

export async function setProxyAction(brandId: string, url: string) {
  return done(await runAction((ctx) => setBrandProxy(ctx, brandId, { url, enabled: true })));
}

export async function toggleProxyAction(brandId: string, enabled: boolean) {
  return done(await runAction((ctx) => toggleBrandProxy(ctx, brandId, enabled)));
}

export async function clearProxyAction(brandId: string) {
  return done(await runAction((ctx) => clearBrandProxy(ctx, brandId)));
}
