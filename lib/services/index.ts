/**
 * Business actions. Every function takes the caller's WorkspaceContext first
 * (getWorkspaceContext() in actions, requireWorkspacePage() in pages), checks
 * the role, validates input with zod and returns secret-free DTOs.
 *
 * Errors: AccessError (401/403/404), ZodError, ServiceError,
 * InvalidTransitionError. Server actions can use `toServiceFailure(error)`.
 *
 * Internal helpers for workflows and OAuth routes (no role check) live in
 * lib/services/internal and are not re-exported here.
 */
import "server-only";

export {
  clearBrandProxy,
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  setBrandProxy,
  toggleBrandProxy,
  updateBrand,
  type BrandPatchInput,
  type BrandSettingsInput,
} from "./brands";
export {
  connectionHealth,
  disconnectConnection,
  listConnections,
  listShopifyTemplates,
  saveTikTokAdConnections,
  saveTikTokProfileConnection,
  setShopifyTemplate,
} from "./connections";
export type { ServiceDeps } from "./deps";
export {
  ServiceError,
  toServiceFailure,
  type ServiceErrorReason,
  type ServiceFailure,
} from "./errors";
export {
  confirmProduct,
  deleteProduct,
  getProduct,
  importFromProductLink,
  importFromTikTok,
  listProducts,
  rejectProduct,
  retryStep,
  type DeleteProductResult,
  type ListProductsInput,
} from "./products";
export {
  approvePage,
  getProductPipeline,
  goBackOneStep,
  listSuppliers,
  quoteSupplierChoice,
  regeneratePageCopy,
  rejectPage,
  rejectSuppliers,
  selectSupplier,
  updatePageCopy,
} from "./pipeline";
export { listMembers, type MemberDirectory } from "./team";
export type * from "./types";
export { getUsage, listUsage } from "./usage";
export {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  type WorkspaceSettingsDTO,
} from "./settings";
