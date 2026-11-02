/**
 * Roles and permissions: the single source of truth, shared by Better Auth
 * (server + client), the requireRole/requirePermission guards and the UI.
 *
 * Safe to import from client components (no secrets, no server code).
 *
 * Roles are a strict hierarchy: owner > media_buyer > creative > viewer.
 * Every role holds every permission of the roles below it.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

import { roleSchema, type Gate, type Role } from "@/lib/domain/contracts";

export type { Role };
export const ROLES = roleSchema.options;

/** Higher rank = more power. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  creative: 1,
  media_buyer: 2,
  owner: 3,
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  media_buyer: "Media buyer",
  creative: "Creative",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access, including members, billing, connections and deleting the workspace.",
  media_buyer: "Runs products end to end: every approval gate, campaigns, launches and budgets.",
  creative: "Imports products, picks suppliers, approves pages and videos, posts to TikTok.",
  viewer: "Read-only access to products, campaigns and stats.",
};

/**
 * Resources and actions. Better Auth's own organization statements
 * (organization, member, invitation, team, ac) are kept so its endpoints keep
 * enforcing invitations and member management.
 */
export const statements = {
  ...defaultStatements,
  workspace: ["read", "update", "delete"],
  brand: ["read", "create", "update", "delete"],
  /** Shopify stores, TikTok ad accounts and profiles, proxies. */
  connection: ["read", "create", "update", "delete"],
  product: ["read", "create", "update", "delete"],
  /** One action per approval gate (lib/domain/contracts gateSchema). */
  gate: ["product_confirmation", "supplier_choice", "content_approval", "launch"],
  /** Shopify product page (publish = set ACTIVE on the store). */
  page: ["read", "publish"],
  video: ["read", "approve", "publish"],
  campaign: ["read", "create", "update", "launch", "pause", "budget"],
  stats: ["read"],
  audit: ["read"],
  usage: ["read"],
} as const;

export type Statements = typeof statements;
export type Resource = Exclude<keyof Statements, keyof typeof defaultStatements>;
export type Action<R extends Resource> = Statements[R][number];

/** "resource:action", e.g. "campaign:launch". */
export type Permission = {
  [R in Resource]: `${R}:${Action<R>}`;
}[Resource];

type Grants = { [R in keyof Statements]?: readonly Statements[R][number][] };

const viewerGrants = {
  workspace: ["read"],
  brand: ["read"],
  connection: ["read"],
  product: ["read"],
  page: ["read"],
  video: ["read"],
  campaign: ["read"],
  stats: ["read"],
  ac: ["read"],
} satisfies Grants;

const creativeGrants = {
  ...viewerGrants,
  product: ["read", "create", "update"],
  gate: ["product_confirmation", "supplier_choice", "content_approval"],
  page: ["read", "publish"],
  video: ["read", "approve", "publish"],
} satisfies Grants;

const mediaBuyerGrants = {
  ...creativeGrants,
  brand: ["read", "update"],
  connection: ["read", "create", "update"],
  product: ["read", "create", "update", "delete"],
  gate: ["product_confirmation", "supplier_choice", "content_approval", "launch"],
  campaign: ["read", "create", "update", "launch", "pause", "budget"],
  audit: ["read"],
  usage: ["read"],
} satisfies Grants;

const ownerGrants = {
  ...ownerAc.statements,
  workspace: ["read", "update", "delete"],
  brand: ["read", "create", "update", "delete"],
  connection: ["read", "create", "update", "delete"],
  product: ["read", "create", "update", "delete"],
  gate: ["product_confirmation", "supplier_choice", "content_approval", "launch"],
  page: ["read", "publish"],
  video: ["read", "approve", "publish"],
  campaign: ["read", "create", "update", "launch", "pause", "budget"],
  stats: ["read"],
  audit: ["read"],
  usage: ["read"],
} satisfies Grants;

export const ROLE_GRANTS: Record<Role, Grants> = {
  viewer: viewerGrants,
  creative: creativeGrants,
  media_buyer: mediaBuyerGrants,
  owner: ownerGrants,
};

export const ac = createAccessControl(statements);

/** Better Auth roles (passed to organization() and organizationClient()). */
export const roles = {
  owner: ac.newRole(ownerGrants),
  media_buyer: ac.newRole(mediaBuyerGrants),
  creative: ac.newRole(creativeGrants),
  viewer: ac.newRole(viewerGrants),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Better Auth stores roles as a comma-separated string. We assign exactly
 * one, but be defensive: unknown values are ignored, the highest role wins.
 */
export function parseRole(raw: string | null | undefined): Role | null {
  if (!raw) return null;
  const found = raw
    .split(",")
    .map((r) => r.trim())
    .filter(isRole);
  if (found.length === 0) return null;
  return found.reduce((a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a));
}

/** True when `role` is `min` or above in the hierarchy. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Pure permission check, usable in UI to hide controls (never as the only check). */
export function can(role: Role, permission: Permission): boolean {
  const [resource, action] = permission.split(":") as [Resource, string];
  const granted = ROLE_GRANTS[role][resource] as readonly string[] | undefined;
  return granted?.includes(action) ?? false;
}

/** The permission that approves a given gate. */
export function gatePermission(gate: Gate): Permission {
  return `gate:${gate}`;
}
