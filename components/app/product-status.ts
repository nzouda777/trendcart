import { ROLE_LABELS, ROLES, can, gatePermission, type Role } from "@/lib/auth/permissions";
import type { Gate, ProductStatus } from "@/lib/domain/contracts";

export type StatusTone = "neutral" | "running" | "action" | "success" | "danger";

export const PRODUCT_STATUS_META: Record<ProductStatus, { label: string; tone: StatusTone }> = {
  imported: { label: "Imported", tone: "neutral" },
  analyzing: { label: "Analyzing", tone: "running" },
  awaiting_product_confirmation: { label: "Confirm product", tone: "action" },
  sourcing: { label: "Finding suppliers", tone: "running" },
  awaiting_supplier_choice: { label: "Choose supplier", tone: "action" },
  building_page_and_videos: { label: "Building page and videos", tone: "running" },
  awaiting_content_approval: { label: "Approve content", tone: "action" },
  preparing_campaign: { label: "Preparing campaign", tone: "running" },
  ready_to_launch: { label: "Ready to launch", tone: "action" },
  launched: { label: "Launched", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const GATE_META: Record<Gate, { number: number; label: string; action: string }> = {
  product_confirmation: { number: 1, label: "Product confirmation", action: "Confirm the product" },
  supplier_choice: {
    number: 2,
    label: "Supplier and price",
    action: "Choose a supplier and price",
  },
  content_approval: { number: 3, label: "Page and videos", action: "Approve the page and videos" },
  launch: { number: 4, label: "Launch", action: "Approve and launch the campaign" },
};

export const GATE_ORDER: Gate[] = [
  "product_confirmation",
  "supplier_choice",
  "content_approval",
  "launch",
];

/** Lowest role that can approve a gate, as a label ("Creative or higher"). */
export function whoApproves(gate: Gate): string {
  const lowest = [...ROLES].reverse().find((r: Role) => can(r, gatePermission(gate)));
  if (!lowest) return "Nobody";
  return lowest === "owner" ? ROLE_LABELS.owner : `${ROLE_LABELS[lowest]} or higher`;
}

export const STEP_LABELS: Record<string, string> = {
  analyze: "AI product analysis",
  source: "Supplier search",
  build: "Page and videos",
  prepare_campaign: "Campaign preparation",
  launch: "Launch",
};
