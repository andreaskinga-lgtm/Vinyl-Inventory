import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import { createApiHandler } from "./api-handler.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-api-handler-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRequest({ method = "GET", url, body = "" }) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;

  queueMicrotask(() => {
    if (method === "POST") {
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

function createFetchResponse({ ok = true, status = 200, json, text }) {
  return {
    ok,
    status,
    json,
    text,
  };
}

async function request(handler, options) {
  const response = createResponse();
  await handler(createRequest(options), response, () => {
    throw new Error("unexpected next");
  });
  return response;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("createApiHandler", () => {
  it.each([
    {
      name: "environment credentials",
      environment: { username: " environment-user ", token: " env-token " },
      saved: { username: "saved-user", token: "saved-token" },
      expected: {
        username: "environment-user",
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
      discogsEnvironment: environment,
    });

    const response = await request(handler, {
      url: "/api/discogs-config",
    });

    expect(response.status).toBe(200);
    expect(responseJson(response)).toEqual(expected);
    expect(response.body).not.toContain("env-token");
    expect(response.body).not.toContain("saved-token");
  });

  it("saves a complete trimmed Discogs credential without rewriting an existing file on read", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    const original = '{"username":"legacy","token":"legacy-token"}';
    await writeFile(configPath, original);
    const handler = createApiHandler({ dataDir });

    await request(handler, { url: "/api/discogs-config" });
    expect(await readFile(configPath, "utf8")).toBe(original);

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
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

  it("replaces malformed saved Discogs credentials with a valid pair", async () => {
    const dataDir = await createTemporaryDirectory();
    const configPath = path.join(dataDir, "discogsConfig.json");
    await writeFile(configPath, "{not json");
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
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
    const handler = createApiHandler({
      dataDir,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-environment-token",
      },
    });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
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
    const handler = createApiHandler({ dataDir });

    const response = await request(handler, {
      method: "POST",
      url: "/api/discogs-config",
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
      const handler = createApiHandler({
        dataDir,
        fetch,
        discogsEnvironment: {
          username: "environment user",
          token: "sentinel-discogs-token",
        },
      });

      const response = await request(handler, { url: requestUrl });

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
    const handler = createApiHandler({ dataDir, fetch });

    await request(handler, {
      url: "/api/discogs/collection?page=1&per_page=50",
    });

    expect(fetch.mock.calls[0][0]).toContain("/users/saved%20user/");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Discogs token=saved-token",
    );
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
      const handler = createApiHandler({ dataDir, fetch });

      const response = await request(handler, { url });

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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, { url });

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
    const handler = createApiHandler({ dataDir, fetch });

    const response = await request(handler, {
      url: "/api/discogs/release",
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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: sentinel,
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/release?id=123",
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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: `/api/discogs/collection?${query}`,
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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/search?artist=A&title=B",
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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: "sentinel-discogs-token",
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/search?artist=A&title=B",
    });

    expect(response.status).toBe(429);
    expect(responseJson(response)).toEqual({
      error: "Discogs request failed with status 429",
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
    const handler = createApiHandler({
      dataDir,
      fetch,
      discogsEnvironment: {
        username: "environment-user",
        token: sentinel,
      },
    });

    const response = await request(handler, {
      url: "/api/discogs/release?id=123",
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
    const handler = createApiHandler({ dataDir });
    const records = [{ id: "record-1", title: "Kind of Blue" }];
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/records",
        body: JSON.stringify({ records }),
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
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "POST", url: "/api/records", body }),
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
    const handler = createApiHandler({ dataDir });
    const genreOptions = {
      genres: ["Jazz"],
      subGenres: ["Modal"],
    };
    const response = createResponse();

    await handler(
      createRequest({
        method: "POST",
        url: "/api/genre-options",
        body: JSON.stringify(genreOptions),
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
    const handler = createApiHandler({ dataDir });
    const response = createResponse();

    await handler(
      createRequest({ method: "POST", url: "/api/genre-options", body }),
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
