/*
 * Product app shell. app/(app)/layout.tsx renders <AppShell>; pages use
 * PageHeader and EmptyState. Navigation items live in ./nav.ts.
 */
export { AppShell } from "./app-shell";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { APP_NAV, type NavItem } from "./nav";
export { PageHeader } from "./page-header";
