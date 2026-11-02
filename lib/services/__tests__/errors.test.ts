import { describe, expect, it } from "vitest";

import { ServiceError, toServiceFailure } from "../errors";

describe("toServiceFailure", () => {
  it("passes a ServiceError reason through to the failure", () => {
    const error = new ServiceError("invalid_state", "The page changed since you loaded it.", {
      reason: "copy_changed",
    });
    expect(error.reason).toBe("copy_changed");
    expect(error.status).toBe(422);
    expect(toServiceFailure(error)).toEqual({
      ok: false,
      code: "invalid_state",
      error: "The page changed since you loaded it.",
      reason: "copy_changed",
    });
  });

  it("omits reason when the ServiceError has none", () => {
    const error = new ServiceError("conflict", "Someone else changed it.");
    expect(error.reason).toBeUndefined();
    const failure = toServiceFailure(error);
    expect(failure).toEqual({ ok: false, code: "conflict", error: "Someone else changed it." });
    expect("reason" in failure).toBe(false);
  });
});
