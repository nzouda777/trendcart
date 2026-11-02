"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { AUTH_PATHS } from "@/lib/auth/paths";

import { FormError } from "./form-parts";

export function AcceptInvite({
  invitationId,
  workspaceId,
}: {
  invitationId: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending("accept");
    setError(null);
    const { error: failure } = await authClient.organization.acceptInvitation({ invitationId });
    if (failure) {
      setPending(null);
      setError(failure.message ?? "Could not accept the invitation.");
      return;
    }
    await authClient.organization.setActive({ organizationId: workspaceId });
    router.push(AUTH_PATHS.home);
    router.refresh();
  }

  async function decline() {
    setPending("decline");
    setError(null);
    const { error: failure } = await authClient.organization.rejectInvitation({ invitationId });
    setPending(null);
    if (failure) {
      setError(failure.message ?? "Could not decline the invitation.");
      return;
    }
    router.push(AUTH_PATHS.home);
  }

  return (
    <div className="grid gap-3">
      <FormError message={error} />
      <Button
        size="xl"
        onClick={accept}
        disabled={pending !== null}
        aria-busy={pending === "accept"}
      >
        {pending === "accept" ? "Joining…" : "Accept and join"}
      </Button>
      <Button
        size="xl"
        variant="outline"
        onClick={decline}
        disabled={pending !== null}
        aria-busy={pending === "decline"}
      >
        Decline
      </Button>
    </div>
  );
}
