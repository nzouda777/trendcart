import {
  Building2Icon,
  DownloadIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  PackageIcon,
  PlugIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hide the item from roles without this permission (UI only; pages re-check). */
  permission?: Permission;
};

/**
 * Sidebar navigation. app-ui owns the pages behind these links and may
 * add, rename or reorder items here.
 */
export const APP_NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/app/import", label: "Import", icon: DownloadIcon, permission: "product:create" },
  { href: "/app/products", label: "Products", icon: PackageIcon, permission: "product:read" },
  // M3: { href: "/app/campaigns", label: "Campaigns", icon: MegaphoneIcon, permission: "campaign:read" },
  { href: "/app/brands", label: "Brands", icon: Building2Icon, permission: "brand:read" },
  { href: "/app/connections", label: "Connections", icon: PlugIcon, permission: "connection:read" },
  { href: "/app/team", label: "Team", icon: UsersIcon, permission: "workspace:read" },
  { href: "/app/usage", label: "Usage", icon: GaugeIcon, permission: "usage:read" },
];

export function isNavActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  // A parent href must not light up on a more specific sibling (e.g. "/app/brands/new").
  const exactOnly = APP_NAV.some((i) => i.href !== href && i.href.startsWith(`${href}/`));
  return pathname === href || (!exactOnly && pathname.startsWith(`${href}/`));
}
