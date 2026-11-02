import { ClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ServiceFailure } from "@/lib/services/errors";

/**
 * ConfirmDialog `errorAction` for rate-limited rebuilds (reject suppliers,
 * reject page, regenerate): retrying right away cannot work, so the confirm
 * button becomes a disabled "Try again later". Other failures keep the
 * normal retry.
 */
export function rebuildLimitAction(failure: ServiceFailure) {
  if (failure.code !== "rate_limited") return null;
  return (
    <Button size="lg" variant="outline" disabled>
      <ClockIcon aria-hidden="true" />
      Try again later
    </Button>
  );
}
