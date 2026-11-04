/*
 * Constants shared by the product server actions and their client components
 * ("use server" files may only export async functions).
 */

/** Marker in `fieldErrors.amount` when the ad platform adapter cannot change budgets yet. */
export const BUDGET_UNSUPPORTED = "unsupported";

/** Shown while the posting service cannot pass a commercial content disclosure to TikTok. */
export const DISCLOSURE_UNSUPPORTED =
  "Trendcart cannot send a commercial content disclosure to TikTok yet. If this post promotes a brand, product or service, post it from the TikTok app instead.";
