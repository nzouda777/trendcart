import { BanIcon, CreditCardIcon } from "lucide-react";
import Link from "next/link";

import { AUTH_PATHS } from "@/lib/auth/paths";

/** Shown instead of an app page when the workspace has no access (no plan, or suspended). */
export function BillingWall({
  suspended,
  reason,
  isOwner,
}: {
  suspended: boolean;
  reason?: string | null;
  isOwner: boolean;
}) {
  const Icon = suspended ? BanIcon : CreditCardIcon;
  return (
    <div className="mx-auto mt-10 grid max-w-lg justify-items-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-text">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h1 className="text-xl font-semibold">
        {suspended ? "This workspace is suspended" : "Choose a plan to continue"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {suspended
          ? `Trendcart support suspended this workspace${reason ? `: ${reason}` : ""}. Contact support to restore it.`
          : isOwner
            ? "This workspace has no active subscription. Pick a plan or start a free trial to use Trendcart."
            : "This workspace has no active subscription. Ask the workspace owner to choose a plan."}
      </p>
      {!suspended ? (
        <Link
          href={AUTH_PATHS.billing}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-brand-hover"
        >
          {isOwner ? "See plans" : "See billing"}
        </Link>
      ) : null}
    </div>
  );
}
