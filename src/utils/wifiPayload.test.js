import { describe, expect, it } from "vitest";
import {
  buildWifiQrPayload,
  normalizeWifiSettings,
} from "./wifiPayload.js";

describe("buildWifiQrPayload", () => {
  it("builds the standard WPA payload", () => {
    expect(
      buildWifiQrPayload({
        security: "wpa",
        ssid: "Example network",
        password: "example passphrase",
        hidden: false,
      }),
    ).toBe(
      "WIFI:T:WPA;S:Example network;P:example passphrase;H:false;;",
    );
  });

  it("uses the nopass security marker for an open network", () => {
    expect(
      buildWifiQrPayload({
        security: "open",
        ssid: "Guest",
        password: "",
        hidden: false,
      }),
    ).toBe("WIFI:T:nopass;S:Guest;P:;H:false;;");
  });

  it("marks a hidden WPA network in the payload", () => {
    expect(
      buildWifiQrPayload({
        security: "wpa",
        ssid: "Hidden network",
        password: "hiddenpass",
        hidden: true,
      }),
    ).toBe("WIFI:T:WPA;S:Hidden network;P:hiddenpass;H:true;;");
  });

  it("escapes every reserved field character", () => {
    const ssid = String.raw`A\B;C,D:E"F`;
    const password = String.raw`p\;,:\"word`;

    expect(
      buildWifiQrPayload({
        security: "wpa",
        ssid,
        password,
        hidden: true,
      }),
    ).toBe(
      String.raw`WIFI:T:WPA;S:A\\B\;C\,D\:E\"F;P:p\\\;\,\:\\\"word;H:true;;`,
    );
  });

  it("accepts SSIDs up to 32 UTF-8 bytes and rejects longer ones", () => {
    const atByteLimit = {
      security: "open",
      ssid: "é".repeat(16),
      password: "",
      hidden: false,
    };

    expect(normalizeWifiSettings(atByteLimit)).toEqual(atByteLimit);
    expect(() =>
      normalizeWifiSettings({
        ...atByteLimit,
        ssid: "é".repeat(17),
      }),
    ).toThrow(/SSID.*1.*32.*bytes/i);
  });

  it("accepts a 64-character hexadecimal WPA key but rejects other 64-character values", () => {
    const key = "0123456789abcdef".repeat(4);
    const valid = {
      security: "wpa",
      ssid: "Key network",
      password: key,
      hidden: false,
    };

    expect(normalizeWifiSettings(valid)).toEqual(valid);
    expect(() =>
      normalizeWifiSettings({
        ...valid,
        password: "g".repeat(64),
      }),
    ).toThrow(/8-63.*64.*hexadecimal/i);
  });
});
