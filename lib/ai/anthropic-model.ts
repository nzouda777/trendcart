import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

import { IntegrationError } from "@/lib/domain/contracts";

export type AnthropicModelOptions = {
  apiKey?: string;
  /** Anthropic Console workspace (default ANTHROPIC_WORKSPACE_ID), for unscoped keys. */
  workspaceId?: string;
  fetch?: typeof globalThis.fetch;
};

/**
 * A Claude model from ANTHROPIC_API_KEY (read at call time, never cached
 * across deployments). Throws a non-retryable IntegrationError when unset.
 */
export function anthropicModel(
  modelId: string,
  options: AnthropicModelOptions = {},
): LanguageModel {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new IntegrationError("anthropic", "permission_denied", "ANTHROPIC_API_KEY is not set.", {
      retryable: false,
    });
  }
  // Keys not scoped to a Console workspace must name one in this header.
  const workspaceId = (options.workspaceId ?? process.env.ANTHROPIC_WORKSPACE_ID)?.trim();
  return createAnthropic({
    apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(workspaceId ? { headers: { "anthropic-workspace-id": workspaceId } } : {}),
  })(modelId);
}
