/*
 * Time bounds of the hourly stats sync, shared by live and mock (and by the
 * stats cron, which must budget its own run with them).
 */

/**
 * Wall-clock budget of one getHourlyStats call (one campaign): rate-limit
 * waits, requests and retries included. A live call that runs out fails
 * retryably (TimeBudgetError). The cron should stop starting campaigns once
 * less than this is left of its own budget.
 */
export const STATS_CALL_BUDGET_MS = 30_000;

/** Longest window getHourlyStats accepts in one call (bounds its report calls). */
export const STATS_MAX_WINDOW_HOURS = 72;
