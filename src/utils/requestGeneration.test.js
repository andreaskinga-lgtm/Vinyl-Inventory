import { describe, expect, it } from "vitest";
import { createRequestGeneration } from "./requestGeneration.js";

describe("request generation", () => {
  it("invalidates responses captured before a public reset", () => {
    const generation = createRequestGeneration();
    const pending = generation.capture();

    generation.invalidate();

    expect(generation.isCurrent(pending)).toBe(false);
    expect(generation.isCurrent(generation.capture())).toBe(true);
  });
});
