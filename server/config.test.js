import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig defaults and paths", () => {
  it.each([
    ["PORT", "port", 8080],
    ["DATA_DIR", "dataDir", "/srv/vinyl-inventory/data"],
    ["NODE_ENV", "nodeEnv", "development"],
    ["Discogs credentials", "discogsEnvironment", null],
  ])("uses the default for %s", (_name, property, expected) => {
    const config = loadConfig({ env: {}, cwd: "/srv/vinyl-inventory" });

    expect(config[property]).toEqual(expected);
  });

  it.each([
    ["/var/lib/vinyl-inventory", "/srv/app", "/var/lib/vinyl-inventory"],
    ["runtime-data", "/srv/app", "/srv/app/runtime-data"],
    ["./runtime-data", "/srv/app", "/srv/app/runtime-data"],
  ])("resolves DATA_DIR %s from cwd %s", (dataDir, cwd, expected) => {
    expect(loadConfig({ env: { DATA_DIR: dataDir }, cwd }).dataDir).toBe(
      expected,
    );
  });

  it("returns an immutable configuration and credential pair", () => {
    const config = loadConfig({
      env: { DISCOGS_USER: "user", DISCOGS_TOKEN: "token" },
      cwd: "/srv/app",
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.discogsEnvironment)).toBe(true);
  });
});

describe("loadConfig ports", () => {
  it.each([
    ["1", 1],
    ["8080", 8080],
    ["65535", 65535],
  ])("accepts PORT %s", (value, expected) => {
    expect(loadConfig({ env: { PORT: value }, cwd: "/srv/app" }).port).toBe(
      expected,
    );
  });

  it.each(["0", "65536", "1.5", "-1", "not-a-number", ""])(
    "rejects invalid PORT %s",
    (value) => {
      expect(() =>
        loadConfig({ env: { PORT: value }, cwd: "/srv/app" }),
      ).toThrow(/Invalid PORT: expected an integer from 1 through 65535/);
    },
  );
});

describe("loadConfig node environment", () => {
  it.each(["development", "test", "production"])(
    "accepts NODE_ENV %s",
    (value) => {
      expect(
        loadConfig({ env: { NODE_ENV: value }, cwd: "/srv/app" }).nodeEnv,
      ).toBe(value);
    },
  );

  it.each(["staging", ""])("rejects NODE_ENV %s", (value) => {
    expect(() =>
      loadConfig({ env: { NODE_ENV: value }, cwd: "/srv/app" }),
    ).toThrow(
      /Invalid NODE_ENV: expected development, test, or production/,
    );
  });
});

describe("loadConfig Discogs credentials", () => {
  it.each([
    [
      { DISCOGS_USER: "  discogs-user  ", DISCOGS_TOKEN: "\tsecret-token " },
      { username: "discogs-user", token: "secret-token" },
    ],
    [
      { DISCOGS_USER: "discogs-user", DISCOGS_TOKEN: "secret-token" },
      { username: "discogs-user", token: "secret-token" },
    ],
  ])("returns a complete trimmed pair", (env, expected) => {
    expect(loadConfig({ env, cwd: "/srv/app" }).discogsEnvironment).toEqual(
      expected,
    );
  });

  it.each([
    [
      "DISCOGS_USER without DISCOGS_TOKEN",
      { DISCOGS_USER: "discogs-user" },
      /Invalid DISCOGS_TOKEN: expected a complete credential pair/,
    ],
    [
      "DISCOGS_TOKEN without DISCOGS_USER",
      { DISCOGS_TOKEN: "secret-token" },
      /Invalid DISCOGS_USER: expected a complete credential pair/,
    ],
  ])("rejects %s", (_name, env, error) => {
    expect(() => loadConfig({ env, cwd: "/srv/app" })).toThrow(error);
  });
});
