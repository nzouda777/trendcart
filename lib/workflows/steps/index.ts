import type { ProductStep } from "@/lib/domain/state-machine";

import { analyzeStep } from "./analyze";
import { buildStep } from "./build";
import { prepareCampaignStep } from "./prepare-campaign";
import { sourceStep } from "./source";
import type { StepDefinition } from "./types";

export type { StepDefinition, StepEnv, StepResult } from "./types";

/**
 * Implemented steps. M1: "analyze"; M2: "source", "build" (page part);
 * M3: the videos part of "build" and "prepare_campaign". "launch" is not a
 * step handler: the launch service performs it after GATE 4.
 */
export const STEP_HANDLERS: Partial<Record<ProductStep, StepDefinition>> = {
  analyze: analyzeStep,
  source: sourceStep,
  build: buildStep,
  prepare_campaign: prepareCampaignStep,
};
