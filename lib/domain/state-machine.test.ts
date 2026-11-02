import { describe, expect, it } from "vitest";

import { gateSchema, productStatusSchema, type Gate, type ProductStatus } from "./contracts";
import {
  canTransition,
  GATES,
  gateForStatus,
  gateParts,
  InvalidTransitionError,
  isRunningStatus,
  isTerminalStatus,
  missingGateParts,
  PRODUCT_FLOW,
  productStepSchema,
  progressOf,
  rejectionTarget,
  stepForStatus,
  STEPS,
  transition,
  type ApprovalEvidence,
  type ProductEvent,
} from "./state-machine";

const PRODUCT = "prod_1";

const approval = (gate: Gate, overrides: Partial<ApprovalEvidence> = {}): ApprovalEvidence => ({
  id: "appr_1",
  productId: PRODUCT,
  gate,
  decision: "approved",
  userId: "user_1",
  // The approval that completes a multi-part gate lists every part.
  parts: gateParts(gate),
  ...overrides,
});

const approve = (gate: Gate, overrides?: Partial<ApprovalEvidence>): ProductEvent => ({
  type: "gate_approved",
  productId: PRODUCT,
  approval: approval(gate, overrides),
});

const ALL_STATUSES = productStatusSchema.options;

describe("product state machine: happy path", () => {
  it("walks the whole flow from imported to launched", () => {
    const events: ProductEvent[] = [
      { type: "start" },
      { type: "step_succeeded", step: "analyze" },
      approve("product_confirmation"),
      { type: "step_succeeded", step: "source" },
      approve("supplier_choice"),
      { type: "step_succeeded", step: "build" },
      approve("content_approval"),
      { type: "step_succeeded", step: "prepare_campaign" },
      approve("launch"),
    ];
    const visited: ProductStatus[] = ["imported"];
    for (const event of events) visited.push(transition(visited.at(-1)!, event));
    expect(visited).toEqual(PRODUCT_FLOW);
  });
});

describe("gates", () => {
  it("only advance with a recorded approval for the current gate", () => {
    for (const gate of gateSchema.options) {
      const { from, to } = GATES[gate];
      expect(transition(from, approve(gate))).toBe(to);

      // Wrong gate for this status
      for (const other of gateSchema.options.filter((g) => g !== gate)) {
        expect(canTransition(from, approve(other))).toBe(false);
      }
      // A rejection never advances
      expect(() => transition(from, approve(gate, { decision: "rejected" }))).toThrow(
        /not an approval/,
      );
      // Approval of another product
      expect(() => transition(from, approve(gate, { productId: "other" }))).toThrow(
        /another product/,
      );
      // No recorded approval id / user
      expect(canTransition(from, approve(gate, { id: "" }))).toBe(false);
      expect(canTransition(from, approve(gate, { userId: "" }))).toBe(false);
    }
  });

  it("cannot leave a gate through any other event", () => {
    for (const gate of gateSchema.options) {
      const { from } = GATES[gate];
      expect(canTransition(from, { type: "start" })).toBe(false);
      expect(canTransition(from, { type: "retry", step: "analyze" })).toBe(false);
      for (const step of productStepSchema.options) {
        expect(canTransition(from, { type: "step_succeeded", step })).toBe(false);
        // Only the launch step may fail while ready_to_launch.
        expect(canTransition(from, { type: "step_failed", step, error: "x" })).toBe(
          from === "ready_to_launch" && step === "launch",
        );
      }
    }
  });

  it("cannot skip ahead: approving a gate from any other status fails", () => {
    for (const gate of gateSchema.options) {
      for (const status of ALL_STATUSES.filter((s) => s !== GATES[gate].from)) {
        expect(canTransition(status, approve(gate))).toBe(false);
      }
    }
  });
});

describe("steps, failures and retry", () => {
  it("every running step can fail, and retry re-enters it", () => {
    for (const step of productStepSchema.options) {
      const { running, retryTo } = STEPS[step];
      expect(transition(running, { type: "step_failed", step, error: "boom" })).toBe("failed");
      expect(transition("failed", { type: "retry", step })).toBe(retryTo);
    }
  });

  it("a failed launch goes back to ready_to_launch and needs a new GATE 4 approval", () => {
    const failed = transition("ready_to_launch", {
      type: "step_failed",
      step: "launch",
      error: "TikTok said no",
    });
    const back = transition(failed, { type: "retry", step: "launch" });
    expect(back).toBe("ready_to_launch");
    expect(gateForStatus(back)).toBe("launch");
  });

  it("launch never completes through step_succeeded", () => {
    expect(() => transition("ready_to_launch", { type: "step_succeeded", step: "launch" })).toThrow(
      InvalidTransitionError,
    );
  });

  it("a step can only succeed or fail while it runs", () => {
    for (const step of productStepSchema.options.filter((s) => s !== "launch")) {
      for (const status of ALL_STATUSES.filter((s) => s !== STEPS[step].running)) {
        expect(canTransition(status, { type: "step_succeeded", step })).toBe(false);
        expect(canTransition(status, { type: "step_failed", step, error: "x" })).toBe(false);
      }
    }
  });

  it("retry only applies to failed products; start only to imported ones", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, { type: "retry", step: "analyze" })).toBe(status === "failed");
      expect(canTransition(status, { type: "start" })).toBe(status === "imported");
    }
  });

  it("launched is terminal", () => {
    expect(isTerminalStatus("launched")).toBe(true);
    const events: ProductEvent[] = [
      { type: "start" },
      { type: "retry", step: "launch" },
      ...productStepSchema.options.map((step) => ({
        type: "step_failed" as const,
        step,
        error: "",
      })),
      ...gateSchema.options.map((g) => approve(g)),
    ];
    for (const event of events) expect(canTransition("launched", event)).toBe(false);
  });

  it("throws a descriptive InvalidTransitionError", () => {
    try {
      transition("imported", approve("launch"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).from).toBe("imported");
      expect((error as InvalidTransitionError).event).toBe("gate_approved");
    }
  });
});

describe("helpers", () => {
  it("maps statuses to gates and steps", () => {
    expect(gateForStatus("awaiting_product_confirmation")).toBe("product_confirmation");
    expect(gateForStatus("awaiting_supplier_choice")).toBe("supplier_choice");
    expect(gateForStatus("awaiting_content_approval")).toBe("content_approval");
    expect(gateForStatus("ready_to_launch")).toBe("launch");
    expect(gateForStatus("analyzing")).toBeNull();

    expect(stepForStatus("analyzing")).toBe("analyze");
    expect(stepForStatus("sourcing")).toBe("source");
    expect(stepForStatus("building_page_and_videos")).toBe("build");
    expect(stepForStatus("preparing_campaign")).toBe("prepare_campaign");
    expect(stepForStatus("ready_to_launch")).toBeNull();
    expect(isRunningStatus("analyzing")).toBe(true);
    expect(isRunningStatus("failed")).toBe(false);
  });

  it("reports progress along the happy path", () => {
    expect(progressOf("imported")).toBe(0);
    expect(progressOf("launched")).toBe(1);
    expect(progressOf("failed")).toBeNull();
  });
});

describe("gate rejections", () => {
  const reject = (gate: Gate, overrides?: Partial<ApprovalEvidence>): ProductEvent => ({
    type: "gate_rejected",
    productId: PRODUCT,
    approval: approval(gate, { decision: "rejected", ...overrides }),
  });

  it("GATE 1 rejection sends the product back to analysis", () => {
    expect(transition("awaiting_product_confirmation", reject("product_confirmation"))).toBe(
      "analyzing",
    );
    expect(rejectionTarget("product_confirmation")).toEqual({ to: "analyzing", step: "analyze" });
    // ...and the re-analysis can succeed again, back at GATE 1.
    expect(transition("analyzing", { type: "step_succeeded", step: "analyze" })).toBe(
      "awaiting_product_confirmation",
    );
  });

  it("needs the recorded rejection, for this gate and product", () => {
    const from = "awaiting_product_confirmation";
    expect(() =>
      transition(from, reject("product_confirmation", { decision: "approved" })),
    ).toThrow(/not a rejection/);
    expect(() => transition(from, reject("product_confirmation", { productId: "x" }))).toThrow(
      /another product/,
    );
    expect(canTransition(from, reject("product_confirmation", { id: "" }))).toBe(false);
    expect(canTransition(from, reject("product_confirmation", { userId: "" }))).toBe(false);
    expect(canTransition(from, reject("supplier_choice"))).toBe(false);
    for (const status of ALL_STATUSES.filter((s) => s !== from)) {
      expect(canTransition(status, reject("product_confirmation")), status).toBe(false);
    }
  });

  it("GATE 2 rejection searches suppliers again", () => {
    expect(rejectionTarget("supplier_choice")).toEqual({ to: "sourcing", step: "source" });
    expect(transition("awaiting_supplier_choice", reject("supplier_choice"))).toBe("sourcing");
    expect(transition("sourcing", { type: "step_succeeded", step: "source" })).toBe(
      "awaiting_supplier_choice",
    );
  });

  it("GATE 3 rejection rebuilds the page, back to GATE 3", () => {
    expect(rejectionTarget("content_approval")).toEqual({
      to: "building_page_and_videos",
      step: "build",
    });
    expect(transition("awaiting_content_approval", reject("content_approval"))).toBe(
      "building_page_and_videos",
    );
    expect(transition("building_page_and_videos", { type: "step_succeeded", step: "build" })).toBe(
      "awaiting_content_approval",
    );
  });

  it("GATE 4 does not accept rejections", () => {
    expect(rejectionTarget("launch")).toBeNull();
    expect(() => transition(GATES.launch.from, reject("launch"))).toThrow(/not supported yet/);
  });
});

describe("gate parts (GATE 3: page, then videos)", () => {
  const from = "awaiting_content_approval";

  it("lists the parts of each gate", () => {
    expect(gateParts("content_approval")).toEqual(["page", "videos"]);
    expect(gateParts("supplier_choice")).toEqual([]);
    expect(missingGateParts("content_approval", ["page"])).toEqual(["videos"]);
    expect(missingGateParts("content_approval", ["videos", "page"])).toEqual([]);
  });

  it("does not move the product until every part is approved", () => {
    expect(canTransition(from, approve("content_approval", { parts: [] }))).toBe(false);
    expect(canTransition(from, approve("content_approval", { parts: undefined }))).toBe(false);
    expect(() => transition(from, approve("content_approval", { parts: ["page"] }))).toThrow(
      /parts not approved yet: videos/,
    );
    expect(transition(from, approve("content_approval", { parts: ["page", "videos"] }))).toBe(
      "preparing_campaign",
    );
  });

  it("single-decision gates ignore parts", () => {
    expect(
      transition("awaiting_supplier_choice", approve("supplier_choice", { parts: undefined })),
    ).toBe("building_page_and_videos");
  });
});
