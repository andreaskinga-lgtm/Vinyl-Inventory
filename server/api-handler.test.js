import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import {
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  createAuthService,
  createPasswordVerifier,
  serializeClearedSessionCookie,
} from "./auth.js";
import { createApiHandler } from "./api-handler.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-api-handler-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRequest({
  method = "GET",
  url,
  body = "",
  headers = {},
  socket,
  protocol,
}) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;
  request.headers = headers;
  request.socket = socket ?? { encrypted: false };
  if (protocol) {
    request.protocol = protocol;
  }

  queueMicrotask(() => {
    if (["POST", "PUT", "PATCH"].includes(method)) {
      request.emit("data", body);
      request.emit("end");
    }
  });

  return request;
}

function createResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function responseJson(response) {
  return JSON.parse(response.body);
}

const ADMIN_PASSWORD = "correct horse battery staple";

function createClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(milliseconds) {
      current += milliseconds;
    },
  };
}

function createFetchResponse({ ok = true, status = 200, json, text }) {
  return {
    ok,
    status,
    json,
    text,
  };
}

async function request(handler, options) {
  const headers = { ...options.headers };
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(options.method) &&
    options.includeOrigin !== false &&
    !Object.hasOwn(headers, "origin") &&
    !Object.hasOwn(headers, "referer")
  ) {
    headers.host ??= "localhost";
    headers.origin = `http://${headers.host}`;
  }
  const response = createResponse();
  await handler(createRequest({ ...options, headers }), response, () => {
    throw new Error("unexpected next");
  });
  return response;
}

async function loginCookie(handler) {
  const response = await request(handler, {
    method: "POST",
    url: "/api/auth/login",
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  expect(response.status).toBe(200);
  return response.headers["Set-Cookie"].split(";")[0];
}

async function createAuthenticatedHandler(options) {
  let randomValue = 0;
  const auth = createAuthService({
    credential: createPasswordVerifier(ADMIN_PASSWORD),
    randomBytes: () =>
      Buffer.from(`session-randomness-${randomValue++}`),
  });
  const handler = createApiHandler({ ...options, auth });
  return { handler, cookie: await loginCookie(handler) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("createApiHandler", () => {
  it("reports an unconfigured administrator session without exposing a credential", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      url: "/api/auth/session",
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      configured: false,
      authenticated: false,
    });
    expect(response.body).not.toContain("ADMIN_PASSWORD");
  });

  it("rejects a genre-options mutation without an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/genre-options",
      body: JSON.stringify({ genres: [], subGenres: [] }),
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
  });

  it("rejects a Discogs credential read without an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      url: "/api/discogs-config",
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
  });

  it("rejects a Discogs credential removal without an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      method: "DELETE",
      url: "/api/discogs-config",
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
  });

  it("returns default Site Settings to an authenticated administrator", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 3,
      },
      wifi: null,
    });
  });

  it("serves the narrow default visitor projection without authentication", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      url: "/api/visitor-settings",
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      idleTimeoutMinutes: 3,
      wifi: null,
    });
  });

  it("saves a validated Visitor Display section through its authenticated endpoint", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const saveResponse = await request(handler, {
      method: "PUT",
      url: "/api/site-settings/visitor-display",
      headers: { cookie },
      body: JSON.stringify({ idleTimeoutMinutes: 12 }),
    });
    const readResponse = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });

    expect(saveResponse.status).toBe(200);
    expect(responseJson(saveResponse)).toEqual({ ok: true });
    expect(responseJson(readResponse)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 12,
      },
      wifi: null,
    });
  });

  it("preserves unrelated Site Settings keys during section writes", async () => {
    const dataDir = await createTemporaryDirectory();
    await writeFile(
      path.join(dataDir, "siteSettings.json"),
      JSON.stringify({
        schemaVersion: 1,
        visitorDisplay: {
          idleTimeoutMinutes: 3,
        },
        wifi: null,
        futurePrivateSetting: "keep this value",
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "PUT",
      url: "/api/site-settings/visitor-display",
      headers: { cookie },
      body: JSON.stringify({ idleTimeoutMinutes: 8 }),
    });
    const settingsResponse = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(responseJson(settingsResponse)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 8,
      },
      wifi: null,
      futurePrivateSetting: "keep this value",
    });
  });

  it("preserves concurrent Visitor Display and Wi-Fi section saves", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });
    const headers = { cookie };

    const [displayResponse, wifiResponse] = await Promise.all([
      request(handler, {
        method: "PUT",
        url: "/api/site-settings/visitor-display",
        headers,
        body: JSON.stringify({ idleTimeoutMinutes: 11 }),
      }),
      request(handler, {
        method: "PUT",
        url: "/api/site-settings/wifi",
        headers,
        body: JSON.stringify({
          security: "open",
          ssid: "Visitor network",
          password: "",
          hidden: false,
        }),
      }),
    ]);
    const settingsResponse = await request(handler, {
      url: "/api/site-settings",
      headers,
    });

    expect(displayResponse.status).toBe(200);
    expect(wifiResponse.status).toBe(200);
    expect(responseJson(settingsResponse)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 11,
      },
      wifi: {
        security: "open",
        ssid: "Visitor network",
        password: "",
        hidden: false,
      },
    });
  });

  it("saves Visitor Wi-Fi and builds the public handoff projection", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });
    const wifi = {
      security: "wpa",
      ssid: "Example network",
      password: "example passphrase",
      hidden: false,
    };

    const saveResponse = await request(handler, {
      method: "PUT",
      url: "/api/site-settings/wifi",
      headers: { cookie },
      body: JSON.stringify(wifi),
    });
    const settingsResponse = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });
    const visitorResponse = await request(handler, {
      url: "/api/visitor-settings",
    });

    expect(saveResponse.status).toBe(200);
    expect(responseJson(saveResponse)).toEqual({ ok: true });
    expect(responseJson(settingsResponse)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 3,
      },
      wifi,
    });
    expect(responseJson(visitorResponse)).toEqual({
      idleTimeoutMinutes: 3,
      wifi: {
        ...wifi,
        qrPayload:
          "WIFI:T:WPA;S:Example network;P:example passphrase;H:false;;",
      },
    });
  });

  it("does not leak future private Site Settings keys through the visitor projection", async () => {
    const dataDir = await createTemporaryDirectory();
    await writeFile(
      path.join(dataDir, "siteSettings.json"),
      JSON.stringify({
        schemaVersion: 1,
        visitorDisplay: {
          idleTimeoutMinutes: 9,
        },
        wifi: {
          security: "open",
          ssid: "Visitor network",
          password: "",
          hidden: true,
        },
        futurePrivateSetting: "do not expose this value",
      }),
    );
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      url: "/api/visitor-settings",
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      idleTimeoutMinutes: 9,
      wifi: {
        security: "open",
        ssid: "Visitor network",
        password: "",
        hidden: true,
        qrPayload: "WIFI:T:nopass;S:Visitor network;P:;H:true;;",
      },
    });
    expect(response.body).not.toContain("futurePrivateSetting");
    expect(response.body).not.toContain("do not expose this value");
    expect(response.body).not.toContain("schemaVersion");
  });

  it("removes Visitor Wi-Fi while preserving Visitor Display settings", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    await request(handler, {
      method: "PUT",
      url: "/api/site-settings/visitor-display",
      headers: { cookie },
      body: JSON.stringify({ idleTimeoutMinutes: 14 }),
    });
    await request(handler, {
      method: "PUT",
      url: "/api/site-settings/wifi",
      headers: { cookie },
      body: JSON.stringify({
        security: "open",
        ssid: "Visitor network",
        password: "",
        hidden: false,
      }),
    });

    const deleteResponse = await request(handler, {
      method: "DELETE",
      url: "/api/site-settings/wifi",
      headers: { cookie },
    });
    const settingsResponse = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });
    const visitorResponse = await request(handler, {
      url: "/api/visitor-settings",
    });

    expect(deleteResponse.status).toBe(200);
    expect(responseJson(deleteResponse)).toEqual({ ok: true });
    expect(responseJson(settingsResponse)).toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 14,
      },
      wifi: null,
    });
    expect(responseJson(visitorResponse)).toEqual({
      idleTimeoutMinutes: 14,
      wifi: null,
    });
  });

  it.each([
    ["/api/site-settings", "GET"],
    [
      "/api/site-settings/visitor-display",
      "PUT",
      JSON.stringify({ idleTimeoutMinutes: 5 }),
    ],
    [
      "/api/site-settings/wifi",
      "PUT",
      JSON.stringify({
        security: "open",
        ssid: "Visitor network",
        password: "",
        hidden: false,
      }),
    ],
    ["/api/site-settings/wifi", "DELETE"],
  ])(
    "rejects unauthenticated Site Settings access: %s %s",
    async (url, method, body = "") => {
      const dataDir = await createTemporaryDirectory();
      const handler = createApiHandler({ dataDir });

      const response = await request(handler, { url, method, body });

      expect(response.status).toBe(401);
      expect(responseJson(response)).toEqual({
        error: "Administrator authentication required",
      });
    },
  );

  it("rejects cross-origin Site Settings mutations before writing", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "PUT",
      url: "/api/site-settings/visitor-display",
      headers: {
        cookie,
        host: "localhost",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ idleTimeoutMinutes: 20 }),
    });
    const settingsResponse = await request(handler, {
      url: "/api/site-settings",
      headers: { cookie },
    });

    expect(response.status).toBe(403);
    expect(responseJson(response)).toEqual({ error: "Forbidden" });
    expect(responseJson(settingsResponse).visitorDisplay).toEqual({
      idleTimeoutMinutes: 3,
    });
  });

  it.each([
    ["malformed JSON", '{"idleTimeoutMinutes":', "Malformed JSON body"],
    [
      "a fractional timeout",
      JSON.stringify({ idleTimeoutMinutes: 3.5 }),
      "visitorDisplay.idleTimeoutMinutes must be a whole number from 1 through 30",
    ],
    [
      "an out-of-range timeout",
      JSON.stringify({ idleTimeoutMinutes: 31 }),
      "visitorDisplay.idleTimeoutMinutes must be a whole number from 1 through 30",
    ],
  ])(
    "rejects %s for the Visitor Display section",
    async (_name, body, error) => {
      const dataDir = await createTemporaryDirectory();
      const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

      const response = await request(handler, {
        method: "PUT",
        url: "/api/site-settings/visitor-display",
        headers: { cookie },
        body,
      });

      expect(response.status).toBe(400);
      expect(responseJson(response)).toEqual({ error });
    },
  );

  it.each([
    [
      "an unsupported security mode",
      JSON.stringify({
        security: "wep",
        ssid: "Visitor network",
        password: "password",
        hidden: false,
      }),
      'wifi.security must be "wpa" or "open"',
    ],
    [
      "an open network password",
      JSON.stringify({
        security: "open",
        ssid: "Visitor network",
        password: "not-empty",
        hidden: false,
      }),
      "wifi.password must be empty for an open network",
    ],
    [
      "a short WPA passphrase",
      JSON.stringify({
        security: "wpa",
        ssid: "Visitor network",
        password: "short",
        hidden: false,
      }),
      "wifi.password must be an 8-63 character passphrase or a 64-character hexadecimal key",
    ],
  ])("rejects %s for the Visitor Wi-Fi section", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "PUT",
      url: "/api/site-settings/wifi",
      headers: { cookie },
      body,
    });

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it("rejects a Discogs collection sync without an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn();
    const handler = createApiHandler({ dataDir, fetch });

    const response = await request(handler, {
      url: "/api/discogs/collection",
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/api/discogs/search?artist=A&title=B",
    "/api/discogs/release?id=123",
  ])("proxies a public Discogs metadata request without an administrator session: %s", async (url) => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        text: async () => JSON.stringify({ tracklist: [{ title: "Track" }] }),
      }),
    );
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, { url });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      tracklist: [{ title: "Track" }],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a records mutation without an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/records",
      body: JSON.stringify({ records: [] }),
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
  });

  it("rejects authenticated cross-origin state-changing requests before writing", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier(ADMIN_PASSWORD),
      randomBytes: () => Buffer.from("records-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const cookie = await loginCookie(handler);

    const response = await request(handler, {
      method: "POST",
      url: "/api/records",
      headers: {
        cookie,
        host: "localhost",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ records: [{ id: "must-not-save" }] }),
    });
    const readResponse = await request(handler, {
      url: "/api/records",
    });

    expect(response.status).toBe(403);
    expect(responseJson(response)).toEqual({ error: "Forbidden" });
    expect(responseJson(readResponse)).toEqual({ records: [] });
  });

  it("allows an authenticated same-origin browser mutation", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/records",
      headers: {
        cookie,
        host: "localhost",
        origin: "http://localhost",
      },
      body: JSON.stringify({ records: [{ id: "same-origin" }] }),
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });
  });

  it("rejects authenticated mutations when no origin metadata is supplied", async () => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/records",
      headers: { cookie },
      includeOrigin: false,
      body: JSON.stringify({ records: [{ id: "non-browser" }] }),
    });
    const readResponse = await request(handler, {
      url: "/api/records",
    });

    expect(response.status).toBe(403);
    expect(responseJson(response)).toEqual({ error: "Forbidden" });
    expect(responseJson(readResponse)).toEqual({ records: [] });
  });

  it("rejects an expired administrator session for a protected mutation", async () => {
    const dataDir = await createTemporaryDirectory();
    const clock = createClock();
    const auth = createAuthService({
      credential: createPasswordVerifier(ADMIN_PASSWORD),
      clock: clock.now,
      randomBytes: () => Buffer.from("records-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const cookie = await loginCookie(handler);
    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS);

    const response = await request(handler, {
      method: "POST",
      url: "/api/records",
      headers: { cookie },
      body: JSON.stringify({ records: [{ id: "expired" }] }),
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Administrator authentication required",
    });
  });

  it("reports unconfigured administrator access without taking public reads offline", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });

    const loginResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "any submitted password" }),
    });
    const recordsResponse = await request(handler, {
      url: "/api/records",
    });

    expect(loginResponse.status).toBe(409);
    expect(responseJson(loginResponse)).toEqual({
      error: "Administrator access is not configured",
    });
    expect(recordsResponse.status).toBe(200);
    expect(responseJson(recordsResponse)).toEqual({ records: [] });
  });

  it("logs in with the configured administrator password and sets a session cookie", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });

    const response = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ authenticated: true });
    const cookie = response.headers["Set-Cookie"];
    expect(cookie).toMatch(
      /^vinyl_admin_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/$/,
    );
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });

  it("reports an authenticated session when its opaque cookie is presented", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const loginResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });

    const sessionResponse = await request(handler, {
      url: "/api/auth/session",
      headers: { cookie: loginResponse.headers["Set-Cookie"].split(";")[0] },
    });

    expect(sessionResponse.status).toBe(200);
    expect(responseJson(sessionResponse)).toEqual({
      configured: true,
      authenticated: true,
    });
  });

  it("refreshes session activity on authenticated status checks and reports idle expiry", async () => {
    const dataDir = await createTemporaryDirectory();
    const clock = createClock();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const loginResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    const headers = {
      cookie: loginResponse.headers["Set-Cookie"].split(";")[0],
    };

    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS - 1);
    const refreshedResponse = await request(handler, {
      url: "/api/auth/session",
      headers,
    });
    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS);
    const expiredResponse = await request(handler, {
      url: "/api/auth/session",
      headers,
    });

    expect(responseJson(refreshedResponse)).toEqual({
      configured: true,
      authenticated: true,
    });
    expect(responseJson(expiredResponse)).toEqual({
      configured: true,
      authenticated: false,
    });
  });

  it("logs out, clears the browser-session cookie, and revokes the session", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const loginResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    const cookie = loginResponse.headers["Set-Cookie"].split(";")[0];

    const logoutResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    const sessionResponse = await request(handler, {
      url: "/api/auth/session",
      headers: { cookie },
    });

    expect(logoutResponse.status).toBe(200);
    expect(responseJson(logoutResponse)).toEqual({ authenticated: false });
    expect(logoutResponse.headers["Set-Cookie"]).toBe(
      serializeClearedSessionCookie(),
    );
    expect(responseJson(sessionResponse)).toEqual({
      configured: true,
      authenticated: false,
    });
  });

  it("rejects cross-origin logout for an authenticated administrator session", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier(ADMIN_PASSWORD),
      randomBytes: () => Buffer.from("logout-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const cookie = await loginCookie(handler);

    const response = await request(handler, {
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie,
        host: "localhost",
        origin: "https://evil.example",
      },
    });
    const sessionResponse = await request(handler, {
      url: "/api/auth/session",
      headers: { cookie },
    });

    expect(response.status).toBe(403);
    expect(responseJson(response)).toEqual({ error: "Forbidden" });
    expect(response.headers["Set-Cookie"]).toBeUndefined();
    expect(responseJson(sessionResponse)).toEqual({
      configured: true,
      authenticated: true,
    });
  });

  it("returns the same JSON unauthorized response for an incorrect password", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
    });
    const handler = createApiHandler({ dataDir, auth });

    const response = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "wrong password" }),
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Invalid administrator password",
    });
  });

  it.each([
    ["missing password", JSON.stringify({})],
    ["short password", JSON.stringify({ password: "short" })],
    ["malformed JSON", '{"password":'],
  ])("does not distinguish %s during login", async (_name, body) => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
    });
    const handler = createApiHandler({ dataDir, auth });

    const response = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body,
    });

    expect(response.status).toBe(401);
    expect(responseJson(response)).toEqual({
      error: "Invalid administrator password",
    });
  });

  it("returns a distinguishable cooldown response after five failed logins", async () => {
    const dataDir = await createTemporaryDirectory();
    const clock = createClock();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(handler, {
        method: "POST",
        url: "/api/auth/login",
        body: JSON.stringify({ password: "wrong password" }),
      });
      if (attempt < 4) {
        expect(response.status).toBe(401);
      } else {
        expect(response.status).toBe(429);
        expect(responseJson(response)).toEqual({
          error: "Too many failed login attempts",
          retryAfterMs: 30_000,
        });
        expect(response.headers["Retry-After"]).toBe("30");
      }
    }

    const blockedResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    expect(blockedResponse.status).toBe(429);

    clock.advance(30_000);
    const recoveredResponse = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });
    expect(recoveredResponse.status).toBe(200);
  });

  it.each([
    {
      name: "environment credentials",
      environment: { username: " environment-user ", token: " env-token " },
      saved: { username: "saved-user", token: "saved-token" },
      expected: {
        username: "",
        hasToken: true,
        source: "environment",
        canEdit: false,
      },
    },
    {
      name: "saved credentials",
      environment: null,
      saved: { username: " saved-user ", token: " saved-token " },
      expected: {
        username: "saved-user",
        hasToken: true,
        source: "saved",
        canEdit: true,
      },
    },
    {
      name: "absent credentials",
      environment: null,
      saved: null,
      expected: {
        username: "",
        hasToken: false,
        source: "none",
        canEdit: true,
      },
    },
    {
      name: "malformed saved credentials",
      environment: null,
      saved: "{not json",
      expected: {
        username: "",
        hasToken: false,
        source: "none",
        canEdit: true,
      },
    },
    {
      name: "partial saved credentials",
      environment: null,
      saved: { username: "saved-user", token: " " },
      expected: {
        username: "",
        hasToken: false,
        source: "none",
        canEdit: true,
      },
    },
  ])("redacts $name", async ({ environment, saved, expected }) => {
    const dataDir = await createTemporaryDirectory();
    if (saved !== null) {
      await writeFile(
        path.join(dataDir, "discogsConfig.json"),
        typeof saved === "string" ? saved : JSON.stringify(saved),
      );
    }
    const handler = createApiHandler({
      dataDir,
      auth: createAuthService({
        credential: createPasswordVerifier(ADMIN_PASSWORD),
        randomBytes: () => Buffer.from("discogs-config-session"),
      }),
      discogsEnvironment: environment,
    });
    const cookie = await loginCookie(handler);

    const response = await request(handler, {
      url: "/api/discogs-config",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual(expected);
    if (environment) {
      expect(response.body).not.toContain("environment-user");
    }
    expect(response.body).not.toContain("env-token");
    expect(response.body).not.toContain("saved-token");
  });

  it("saves a complete trimmed Discogs credential without rewriting an existing file on read", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    const original = '{"username":"legacy","token":"legacy-token"}';
    await writeFile(configPath, original);
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    await request(handler, {
      url: "/api/discogs-config",
      headers: { cookie },
    });
    expect(await readFile(configPath, "utf8")).toBe(original);

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body: JSON.stringify({
        username: " new-user ",
        token: " new-token ",
      }),
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });
    expect(
      JSON.parse(await readFile(configPath, "utf8")),
    ).toEqual({ username: "new-user", token: "new-token" });
  });

  it("preserves a saved Discogs token when an authenticated replacement leaves it blank", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    await writeFile(
      configPath,
      JSON.stringify({ username: "old-user", token: "existing-token" }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body: JSON.stringify({
        username: "new-user",
        token: " ",
      }),
    });
    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });
    expect(config).toEqual({
      username: "new-user",
      token: "existing-token",
    });
  });

  it("requires a token for first-time Discogs setup", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body: JSON.stringify({
        username: "new-user",
        token: "",
      }),
    });

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({
      error: "username and token must be non-empty strings",
    });
    await expect(readFile(configPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes saved Discogs credentials through the authenticated DELETE endpoint", async () => {
    const dataDir = await createTemporaryDirectory();
    await writeFile(
      path.join(dataDir, "discogsConfig.json"),
      JSON.stringify({ username: "saved-user", token: "saved-token" }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const deleteResponse = await request(handler, {
      method: "DELETE",
      url: "/api/discogs-config",
      headers: { cookie },
    });
    const readResponse = await request(handler, {
      url: "/api/discogs-config",
      headers: { cookie },
    });

    expect(deleteResponse.status).toBe(200);
    expect(responseJson(deleteResponse)).toEqual({ ok: true });
    expect(responseJson(readResponse)).toEqual({
      username: "",
      hasToken: false,
      source: "none",
      canEdit: true,
    });
    expect(deleteResponse.body).not.toContain("saved-token");
  });

  it("replaces malformed saved Discogs credentials with a valid pair", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    await writeFile(configPath, "{not json");
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body: JSON.stringify({
        username: "recovered-user",
        token: "recovered-token",
      }),
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      username: "recovered-user",
      token: "recovered-token",
    });
  });

  it("rejects saved credential changes while environment credentials are active", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    const original = '{"username":"legacy","token":"legacy-token"}\n';
    await writeFile(configPath, original);
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-environment-token",
      },
    });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body: JSON.stringify({
        username: "replacement-user",
        token: "replacement-token",
      }),
    });

    expect(response.status).toBe(409);
    expect(responseJson(response)).toEqual({
      error: "Discogs credentials are managed by the environment",
    });
    expect(response.body).not.toContain("sentinel-environment-token");
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("rejects saved credential removal while environment credentials are active", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    const original = '{"username":"legacy","token":"legacy-token"}\n';
    await writeFile(configPath, original);
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-environment-token",
      },
    });

    const response = await request(handler, {
      method: "DELETE",
      url: "/api/discogs-config",
      headers: { cookie },
    });

    expect(response.status).toBe(409);
    expect(responseJson(response)).toEqual({
      error: "Discogs credentials are managed by the environment",
    });
    expect(response.body).not.toContain("sentinel-environment-token");
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it.each([
    ["malformed JSON", '{"username":', "Malformed JSON body"],
    [
      "an empty username",
      JSON.stringify({ username: " ", token: "token" }),
      "username and token must be non-empty strings",
    ],
    [
      "an empty token",
      JSON.stringify({ username: "user", token: " " }),
      "username and token must be non-empty strings",
    ],
  ])("rejects %s when saving Discogs credentials", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
      headers: { cookie },
      body,
    });

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it.each([
    {
      name: "collection",
      requestUrl:
        "/api/discogs/collection?username=browser-user&page=2&per_page=250",
      expectedUrl:
        "https://api.discogs.com/users/environment%20user/collection/folders/0/releases?page=2&per_page=100",
    },
    {
      name: "search",
      requestUrl:
        "/api/discogs/search?artist=Miles%20Davis&title=Kind%20of%20Blue",
      expectedUrl:
        "https://api.discogs.com/database/search?artist=Miles+Davis&release_title=Kind+of+Blue&type=release&per_page=5",
    },
    {
      name: "release",
      requestUrl: "/api/discogs/release?id=release%2F123",
      expectedUrl: "https://api.discogs.com/releases/release%2F123",
    },
  ])(
    "proxies an encoded Discogs $name request with server authorization",
    async ({ requestUrl, expectedUrl }) => {
      const dataDir = await createTemporaryDirectory();
      const fetch = vi.fn().mockResolvedValue(
        createFetchResponse({
          status: 200,
          text: async () => '{"result":"ok"}',
        }),
      );
      const { handler, cookie } = await createAuthenticatedHandler({
        dataDir,
        fetch,
        discogsEnvironment: {
          username: "environment user",
          token: "sentinel-discogs-token",
        },
      });

      const response = await request(handler, {
        url: requestUrl,
        headers: { cookie },
      });

      expect(fetch).toHaveBeenCalledWith(expectedUrl, {
        headers: {
          Authorization: "Discogs token=sentinel-discogs-token",
          "User-Agent": "VinylInventory/1.0",
          Accept: "application/vnd.discogs.v2.discogs+json",
        },
      });
      expect(fetch.mock.calls[0][0]).not.toContain("sentinel-discogs-token");
      expect(response.status).toBe(200);
      expect(response.body).toBe('{"result":"ok"}');
      expect(response.body).not.toContain("sentinel-discogs-token");
    },
  );

  it("uses saved Discogs credentials for proxy requests when no environment pair exists", async () => {
    const dataDir = await createTemporaryDirectory();
    await writeFile(
      path.join(dataDir, "discogsConfig.json"),
      JSON.stringify({ username: "saved user", token: "saved-token" }),
    );
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        status: 200,
        text: async () => "{}",
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
    });

    await request(handler, {
      url: "/api/discogs/collection?page=1&per_page=50",
      headers: { cookie },
    });

    expect(fetch.mock.calls[0][0]).toContain("/users/saved%20user/");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Discogs token=saved-token",
    );
  });

  it("marks the administrator cookie Secure when the request uses HTTPS", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      randomBytes: () => Buffer.from("first-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });

    const response = await request(handler, {
      method: "POST",
      url: "/api/auth/login",
      socket: { encrypted: true },
      body: JSON.stringify({ password: "correct horse battery staple" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers["Set-Cookie"]).toContain("; Secure");
  });

  it.each([
    ["/api/discogs/collection", null],
    ["/api/discogs/search?artist=A&title=B", "{not json"],
    [
      "/api/discogs/release?id=123",
      JSON.stringify({ username: "partial-user" }),
    ],
  ])(
    "returns 401 when a Discogs request has no complete credential: %s",
    async (url, saved) => {
      const dataDir = await createTemporaryDirectory();
      if (saved !== null) {
        await writeFile(path.join(dataDir, "discogsConfig.json"), saved);
      }
      const fetch = vi.fn();
      const { handler, cookie } = await createAuthenticatedHandler({
        dataDir,
        fetch,
      });

      const response = await request(handler, {
        url,
        headers: { cookie },
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(response.status).toBe(401);
      expect(responseJson(response)).toEqual({
        error: "Discogs credentials are required",
      });
    },
  );

  it.each([
    "/api/discogs/collection?token=browser-token",
    "/api/discogs/search?artist=A&token=browser-token",
    "/api/discogs/release?id=123&token=browser-token",
  ])("rejects browser-provided Discogs tokens: %s", async (url) => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn();
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url,
      headers: { cookie },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({
      error: "Discogs token parameters are not accepted",
    });
    expect(response.body).not.toContain("browser-token");
    expect(response.body).not.toContain("sentinel-discogs-token");
  });

  it("rejects a Discogs release request without an id before checking credentials", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn();
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
    });

    const response = await request(handler, {
      url: "/api/discogs/release",
      headers: { cookie },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error: "id is required" });
  });

  it("redacts the server token if a successful Discogs response echoes it", async () => {
    const dataDir = await createTemporaryDirectory();
    const sentinel = 'sentinel-"discogs\\token';
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        status: 200,
        text: async () => JSON.stringify({ unexpected: sentinel }),
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: sentinel,
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/release?id=123",
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ unexpected: "[REDACTED]" });
    expect(response.body).not.toContain(sentinel);
  });

  it.each([
    ["page with trailing text", "page=2junk"],
    ["zero page", "page=0"],
    ["negative page", "page=-1"],
    ["zero page size", "per_page=0"],
    ["negative page size", "per_page=-1"],
  ])("rejects an invalid Discogs collection %s", async (_name, query) => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn();
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: `/api/discogs/collection?${query}`,
      headers: { cookie },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({
      error: "page and per_page must be positive integers",
    });
  });

  it("returns 502 for malformed JSON from Discogs", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        status: 200,
        text: async () => "{not json",
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/search?artist=A&title=B",
      headers: { cookie },
    });

    expect(response.status).toBe(502);
    expect(responseJson(response)).toEqual({
      error: "Invalid JSON from Discogs",
    });
  });

  it("preserves a meaningful Discogs upstream status", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        ok: false,
        status: 429,
        text: async () => '{"message":"rate limited"}',
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/search?artist=A&title=B",
      headers: { cookie },
    });

    expect(response.status).toBe(429);
    expect(responseJson(response)).toEqual({
      error: "Discogs request failed with status 429",
    });
    expect(response.body).not.toContain("sentinel-discogs-token");
  });

  it("maps a Discogs upstream 401 to a distinct upstream-authentication error", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        ok: false,
        status: 401,
        text: async () => '{"message":"invalid token"}',
      }),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/search?artist=A&title=B",
      headers: { cookie },
    });

    expect(response.status).toBe(502);
    expect(responseJson(response)).toEqual({
      error: "Discogs credentials were rejected by the upstream service",
    });
    expect(response.body).not.toContain("sentinel-discogs-token");
  });

  it("does not expose Discogs authorization in errors or logs", async () => {
    const dataDir = await createTemporaryDirectory();
    const sentinel = "sentinel-discogs-token";
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new Error(`failed with Authorization: Discogs token=${sentinel}`),
      );
    const logSpies = ["error", "warn", "log"].map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const { handler, cookie } = await createAuthenticatedHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: sentinel,
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/release?id=123",
      headers: { cookie },
    });

    expect(response.status).toBe(502);
    expect(responseJson(response)).toEqual({
      error: "Discogs request failed",
    });
    expect(response.body).not.toContain(sentinel);
    expect(JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls))).not.toContain(
      sentinel,
    );
  });

  it("serves the records collection using the browser response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(createRequest({ url: "/api/records" }), response, () => {
      throw new Error("unexpected next");
    });

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(responseJson(response)).toEqual({ records: [] });
  });

  it("replaces records and returns the existing save response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier(ADMIN_PASSWORD),
      randomBytes: () => Buffer.from("records-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const records = [{ id: "record-1", title: "Kind of Blue" }];
    const response = createResponse();
    const cookie = await loginCookie(handler);

    await handler(
      createRequest({
        method: "POST",
        url: "/api/records",
        body: JSON.stringify({ records }),
        headers: {
          cookie,
          host: "localhost",
          origin: "http://localhost",
        },
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });

    const readResponse = createResponse();
    await handler(createRequest({ url: "/api/records" }), readResponse, () => {
      throw new Error("unexpected next");
    });
    expect(responseJson(readResponse)).toEqual({ records });
  });

  it.each([
    ["malformed JSON", '{"records":', "Malformed JSON body"],
    [
      "an invalid top-level shape",
      JSON.stringify({ records: { id: "not-an-array" } }),
      "records must be an array",
    ],
  ])("rejects %s for records", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/records",
        body,
        headers: {
          cookie,
          host: "localhost",
          origin: "http://localhost",
        },
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it("rejects unsupported methods for records with an explicit JSON response", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "PATCH", url: "/api/records" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST");
    expect(responseJson(response)).toEqual({ error: "Method not allowed" });
  });

  it("returns a JSON storage failure for records", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const dataDir = path.join(parentDirectory, "data");
    await writeFile(dataDir, "not a directory");
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(createRequest({ url: "/api/records" }), response, () => {
      throw new Error("unexpected next");
    });

    expect(response.status).toBe(500);
    expect(responseJson(response).error).toMatch(/already exists|not a directory/);
  });

  it("serves genre options from the seeded JSON resource", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ url: "/api/genre-options?source=browser" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({
      genres: GENRES,
      subGenres: SUB_GENRES,
    });
  });

  it("replaces genre options and returns the existing save response shape", async () => {
    const dataDir = await createTemporaryDirectory();
    const auth = createAuthService({
      credential: createPasswordVerifier(ADMIN_PASSWORD),
      randomBytes: () => Buffer.from("genre-session-randomness"),
    });
    const handler = createApiHandler({ dataDir, auth });
    const genreOptions = {
      genres: ["Jazz"],
      subGenres: ["Modal"],
    };
    const response = createResponse();
    const cookie = await loginCookie(handler);

    await handler(
      createRequest({
        method: "POST",
        url: "/api/genre-options",
        body: JSON.stringify(genreOptions),
        headers: {
          cookie,
          host: "localhost",
          origin: "http://localhost",
        },
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual({ ok: true });

    const readResponse = createResponse();
    await handler(
      createRequest({ url: "/api/genre-options" }),
      readResponse,
      () => {
        throw new Error("unexpected next");
      },
    );
    expect(responseJson(readResponse)).toEqual(genreOptions);
  });

  it.each([
    ["malformed JSON", '{"genres":', "Malformed JSON body"],
    [
      "an invalid top-level shape",
      JSON.stringify({ genres: ["Jazz"], subGenres: "not-an-array" }),
      "genres and subGenres must both be arrays",
    ],
  ])("rejects %s for genre options", async (_name, body, error) => {
    const dataDir = await createTemporaryDirectory();
    const { handler, cookie } = await createAuthenticatedHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/genre-options",
        body,
        headers: {
          cookie,
          host: "localhost",
          origin: "http://localhost",
        },
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error });
  });

  it("rejects unsupported methods for genre options with an explicit JSON response", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "DELETE", url: "/api/genre-options" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST");
    expect(responseJson(response)).toEqual({ error: "Method not allowed" });
  });

  it("returns a JSON storage failure for genre options", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const dataDir = path.join(parentDirectory, "data");
    await writeFile(dataDir, "not a directory");
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ url: "/api/genre-options" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(500);
    expect(responseJson(response).error).toMatch(/already exists|not a directory/);
  });

  it("builds and validates the iTunes search request for GET", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        json: async () => ({ resultCount: 0, results: [] }),
      }),
    );
    const handler = createApiHandler({ dataDir, fetch });
    const response = createResponse();

    await handler(
      createRequest({
        url: "/api.php?type=request&query=Miles%20Davis%20Kind%20of%20Blue&entity=album&country=us",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://itunes.apple.com/search?term=Miles+Davis+Kind+of+Blue&country=us&entity=album&limit=25",
      { headers: { Accept: "application/json" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(responseJson(response)).toEqual({
      url: "https://itunes.apple.com/search?term=Miles+Davis+Kind+of+Blue&country=us&entity=album&limit=25",
    });
  });

  it("builds the iTunes lookup request for an id search", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        json: async () => ({ resultCount: 0, results: [] }),
      }),
    );
    const handler = createApiHandler({ dataDir, fetch });
    const response = createResponse();

    await handler(
      createRequest({
        url: "/api.php?type=request&query=123%20456&entity=id&country=ca",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://itunes.apple.com/lookup?id=123+456&country=ca&limit=25",
      { headers: { Accept: "application/json" } },
    );
    expect(responseJson(response)).toEqual({
      url: "https://itunes.apple.com/lookup?id=123+456&country=ca&limit=25",
    });
  });

  it("rejects an iTunes search without a term", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn();
    const handler = createApiHandler({ dataDir, fetch });
    const response = createResponse();

    await handler(
      createRequest({
        url: "/api.php?type=request&entity=album&country=us",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error: "missing query" });
  });

  it.each([400, 500])(
    "returns a JSON upstream error for an iTunes HTTP %s response",
    async (status) => {
      const dataDir = await createTemporaryDirectory();
      const fetch = vi.fn().mockResolvedValue(
        createFetchResponse({
          ok: false,
          status,
          json: async () => ({ error: "upstream failure" }),
        }),
      );
      const handler = createApiHandler({ dataDir, fetch });
      const response = createResponse();

      await handler(
        createRequest({
          url: "/api.php?type=request&query=Kind%20of%20Blue&entity=album&country=us",
        }),
        response,
        () => {
          throw new Error("unexpected next");
        },
      );

      expect(response.status).toBe(502);
      expect(responseJson(response)).toEqual({
        error: `iTunes request failed with status ${status}`,
      });
    },
  );

  it("returns a JSON error for invalid iTunes JSON", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockResolvedValue(
      createFetchResponse({
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
    );
    const handler = createApiHandler({ dataDir, fetch });
    const response = createResponse();

    await handler(
      createRequest({
        url: "/api.php?type=request&query=Kind%20of%20Blue&entity=album&country=us",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(502);
    expect(responseJson(response)).toEqual({
      error: "Invalid JSON from iTunes",
    });
  });

  it("returns a JSON error for an iTunes network failure", async () => {
    const dataDir = await createTemporaryDirectory();
    const fetch = vi.fn().mockRejectedValue(new Error("socket closed"));
    const handler = createApiHandler({ dataDir, fetch });
    const response = createResponse();

    await handler(
      createRequest({
        url: "/api.php?type=request&query=Kind%20of%20Blue&entity=album&country=us",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(502);
    expect(responseJson(response)).toEqual({
      error: "iTunes request failed: socket closed",
    });
  });

  it("processes iTunes result data submitted by POST", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();
    const iTunesData = {
      results: [
        {
          artworkUrl100: "https://example.com/100x100bb.jpg",
          collectionName: "Kind of Blue",
          artistName: "Miles Davis",
        },
      ],
    };

    await handler(
      createRequest({
        method: "POST",
        url: "/api.php",
        body: new URLSearchParams({
          type: "data",
          entity: "album",
          json: JSON.stringify(iTunesData),
        }).toString(),
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(responseJson(response)).toEqual([
      {
        url: "https://example.com/600x600bb.jpg",
        hires: "https://is5-ssl.mzstatic.com/100000x100000-999.jpg",
        title: "Kind of Blue (by Miles Davis)",
        artworkUrl100: "https://example.com/100x100bb.jpg",
        collectionName: "Kind of Blue",
        artistName: "Miles Davis",
      },
    ]);
  });

  it("rejects malformed iTunes POST JSON", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api.php",
        body: "type=data&entity=album&json=%7B%22results%22%3A",
      }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(400);
    expect(responseJson(response)).toEqual({ error: "bad json" });
  });

  it("rejects unsupported iTunes methods with an explicit JSON response", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "PATCH", url: "/api.php" }),
      response,
      () => {
        throw new Error("unexpected next");
      },
    );

    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, POST");
    expect(responseJson(response)).toEqual({ error: "Method not allowed" });
  });

  it("passes unrelated paths to the next middleware exactly once", async () => {
    const dataDir = await createTemporaryDirectory();
    const handler = createApiHandler({ dataDir });
    const response = createResponse();
    let nextCalls = 0;

    await handler(createRequest({ url: "/shelves" }), response, () => {
      nextCalls += 1;
    });

    expect(nextCalls).toBe(1);
    expect(response.body).toBeNull();
  });

  it.each(["/api/unknown", "/api.php"])(
    "returns a JSON 404 for unknown owned path %s",
    async (url) => {
      const dataDir = await createTemporaryDirectory();
      const handler = createApiHandler({ dataDir });
      const response = createResponse();
      let nextCalls = 0;

      await handler(createRequest({ url }), response, () => {
        nextCalls += 1;
      });

      expect(nextCalls).toBe(0);
      expect(response.status).toBe(404);
      expect(responseJson(response)).toEqual({ error: "Not found" });
    },
  );
});
