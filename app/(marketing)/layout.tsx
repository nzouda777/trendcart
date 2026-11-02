import type { ReactNode } from "react";

/**
 * Marketing route group layout. Kept thin on purpose: the landing page renders
 * its own chrome (AnnouncementBar, Navbar, Footer) per docs/agents/PLAN.md.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-1 flex-col">{children}</div>;
}
