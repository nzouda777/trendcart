import { IntegrationError } from "@/lib/domain/contracts";

/** Live adapters scheduled for a later milestone fail loudly, never silently mock. */
export function notImplemented(provider: string, what: string, milestone = "M2"): IntegrationError {
  return new IntegrationError(
    provider,
    "provider_error",
    `${what} is not available in live mode yet (planned for ${milestone}). Use INTEGRATIONS_MODE=mock.`,
    { retryable: false },
  );
}
