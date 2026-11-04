import { IntegrationError, type IntegrationErrorCode } from "@/lib/domain/contracts";

export const PROVIDER = "shopify";

export function shopifyError(
  code: IntegrationErrorCode,
  message: string,
  options?: { cause?: unknown; retryable?: boolean },
): IntegrationError {
  return new IntegrationError(PROVIDER, code, message, options);
}

/**
 * Thrown by live methods scheduled for a later milestone. It is an
 * IntegrationError (code "provider_error") that is never retryable, so a
 * workflow fails fast instead of retrying.
 */
export class ShopifyNotImplementedError extends IntegrationError {
  readonly notImplemented = true;
  readonly method: string;

  constructor(method: string) {
    super(PROVIDER, "provider_error", `Shopify live ${method} is not implemented yet (M2).`, {
      retryable: false,
    });
    this.name = "ShopifyNotImplementedError";
    this.method = method;
  }
}

/**
 * attachVideoFromUrl: the video is attached but Shopify has not finished
 * processing it within the call's polling budget. Retryable: calling again
 * with the same idempotency key resumes polling (no second upload). The
 * contract has no pending state (ShopifyMediaRef.status is READY | FAILED).
 */
export class ShopifyMediaProcessingError extends IntegrationError {
  readonly mediaId: string;
  readonly mediaStatus: string;

  constructor(mediaId: string, mediaStatus: string) {
    super(
      PROVIDER,
      "provider_error",
      `Shopify is still processing the video (${mediaStatus}). Try again shortly.`,
      { retryable: true },
    );
    this.name = "ShopifyMediaProcessingError";
    this.mediaId = mediaId;
    this.mediaStatus = mediaStatus;
  }
}

export function isShopifyMediaProcessing(error: unknown): error is ShopifyMediaProcessingError {
  return error instanceof ShopifyMediaProcessingError;
}

export function isShopifyNotImplemented(error: unknown): error is ShopifyNotImplementedError {
  return error instanceof ShopifyNotImplementedError;
}

/** Maps an Admin API / OAuth HTTP status to an integration error code. */
export function codeForStatus(status: number): IntegrationErrorCode {
  if (status === 401) return "auth_expired";
  if (status === 402 || status === 403 || status === 423) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_input";
  return "provider_error";
}
