import { describe, expect, it } from "vitest";
import {
  isVisitorSettingsCacheFresh,
  normalizeVisitorSettings,
} from "./visitorSettings.js";

describe("visitor settings projection", () => {
  it("normalizes the public visitor projection without dropping configured Wi-Fi", () => {
    expect(
      normalizeVisitorSettings({
        idleTimeoutMinutes: 8,
        wifi: {
          security: "wpa",
          ssid: "Visitor network",
          password: "visitor-pass",
          hidden: false,
          qrPayload: "WIFI:T:WPA;",
        },
      }),
    ).toEqual({
      idleTimeoutMinutes: 8,
      wifi: {
        security: "wpa",
        ssid: "Visitor network",
        password: "visitor-pass",
        hidden: false,
        qrPayload: "WIFI:T:WPA;",
      },
    });
  });

  it.each([
    [{ idleTimeoutMinutes: 0, wifi: null }],
    [{ idleTimeoutMinutes: 3, wifi: { ssid: "missing fields" } }],
    [null],
  ])("rejects an invalid public visitor projection: %j", (value) => {
    expect(() => normalizeVisitorSettings(value)).toThrow(
      "Invalid visitor settings response.",
    );
  });

  it("treats a cache entry at the TTL boundary as stale", () => {
    expect(isVisitorSettingsCacheFresh(1_000, 1_000 + 30_000, 30_000)).toBe(
      false,
    );
    expect(isVisitorSettingsCacheFresh(1_000, 1_000 + 29_999, 30_000)).toBe(
      true,
    );
  });
});
