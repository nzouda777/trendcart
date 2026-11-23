import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "@/lib/db/client";

import { listPublishedPlans, type PublicPlan } from "./plans";

/** Cache tag of the landing page pricing (admin plan / settings changes update it). */
export const PRICING_TAG = "pricing";

/**
 * Published plans for the landing page, cached (cacheComponents) and tagged
 * so admin changes show at once. Empty when the database is unreachable
 * (e.g. a build without DATABASE_URL): the page then shows no plan rather
 * than invented ones.
 */
export async function getPublicPricing(): Promise<PublicPlan[]> {
  "use cache";
  cacheTag(PRICING_TAG);
  cacheLife("hours");
  if (!process.env.DATABASE_URL) return [];
  try {
    return await listPublishedPlans(getDb());
  } catch (error) {
    console.error("[pricing] could not load the published plans", error);
    return [];
  }
}
