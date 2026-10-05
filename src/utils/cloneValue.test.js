import { describe, expect, it } from "vitest";
import { cloneValue } from "./cloneValue.js";

describe("cloneValue", () => {
  it("returns nullish values unchanged", () => {
    expect(cloneValue(undefined)).toBeUndefined();
    expect(cloneValue(null)).toBeNull();
  });

  it("creates an independent JSON-compatible copy", () => {
    const source = { nested: { values: ["one"] } };
    const copy = cloneValue(source);

    copy.nested.values.push("two");

    expect(copy).toEqual({ nested: { values: ["one", "two"] } });
    expect(source).toEqual({ nested: { values: ["one"] } });
  });
});
