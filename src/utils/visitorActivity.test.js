import { describe, expect, it } from "vitest";
import { isVisitorActivityEvent } from "./visitorActivity.js";

describe("visitor activity events", () => {
  it.each(["keydown", "input", "change"])(
    "counts %s from inside a dialog as visitor activity",
    (type) => {
      const dialogTarget = {
        closest: (selector) =>
          selector === ".record-modal, .sign-in-dialog, .discogs-import-modal"
            ? {}
            : null,
      };

      expect(isVisitorActivityEvent({ type, target: dialogTarget })).toBe(true);
    },
  );

  it("preserves scroll activity for the display timer", () => {
    expect(isVisitorActivityEvent({ type: "scroll", target: {} })).toBe(true);
  });

  it("ignores events whose target is the timer output", () => {
    expect(
      isVisitorActivityEvent({
        type: "click",
        target: {
          closest: (selector) =>
            selector === "[data-visitor-timer]" ? {} : null,
        },
      }),
    ).toBe(false);
  });

  it("ignores unsupported events", () => {
    expect(isVisitorActivityEvent({ type: "focus", target: null })).toBe(false);
  });
});
