import { describe, expect, it } from "vitest";
import {
  createVisitorTimer,
  getVisitorTimerSnapshot,
  normalizeVisitorTimeoutMinutes,
  resetVisitorTimer,
} from "./visitorTimer.js";

describe("visitor timer", () => {
  it("normalizes the configured whole-minute range with a safe default", () => {
    expect(normalizeVisitorTimeoutMinutes(1)).toBe(1);
    expect(normalizeVisitorTimeoutMinutes(30)).toBe(30);
    expect(normalizeVisitorTimeoutMinutes(0)).toBe(3);
    expect(normalizeVisitorTimeoutMinutes(3.5)).toBe(3);
    expect(normalizeVisitorTimeoutMinutes(31)).toBe(3);
  });

  it("expires after the configured duration and resets from visitor activity", () => {
    const started = createVisitorTimer({ timeoutMinutes: 1, now: 10_000 });
    expect(getVisitorTimerSnapshot(started, 10_000)).toMatchObject({
      remainingSeconds: 60,
      expired: false,
      isWarning: false,
    });
    expect(getVisitorTimerSnapshot(started, 70_000)).toMatchObject({
      remainingSeconds: 0,
      expired: true,
    });

    const reset = resetVisitorTimer(started, { now: 70_000 });
    expect(reset.startedAt).toBe(70_000);
    expect(reset.expiresAt).toBe(130_000);
  });

  it("reports a visible countdown during the final ten seconds", () => {
    const timer = createVisitorTimer({ timeoutMinutes: 1, now: 0 });

    expect(getVisitorTimerSnapshot(timer, 50_000)).toMatchObject({
      remainingSeconds: 10,
      isWarning: true,
      countdownSeconds: 10,
    });
    expect(getVisitorTimerSnapshot(timer, 59_001)).toMatchObject({
      remainingSeconds: 1,
      isWarning: true,
      countdownSeconds: 1,
    });
    expect(getVisitorTimerSnapshot(timer, 60_000)).toMatchObject({
      remainingSeconds: 0,
      isWarning: false,
      countdownSeconds: 0,
      expired: true,
    });
  });
});
