import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-app-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createDistDirectory(parentDirectory) {
  const distDirectory = path.join(parentDirectory, "dist");
  await mkdir(path.join(distDirectory, "assets"), { recursive: true });
  await writeFile(
    path.join(distDirectory, "index.html"),
    "<!doctype html><html><body>Vinyl app</body></html>",
  );
  await writeFile(path.join(distDirectory, "assets", "index-abc123.js"), "asset");
  await writeFile(path.join(distDirectory, "sw.js"), "service worker");
  await writeFile(path.join(distDirectory, "registerSW.js"), "register");
  await writeFile(
    path.join(distDirectory, "manifest.webmanifest"),
    '{"name":"Vinyl"}',
  );
  await writeFile(path.join(distDirectory, "workbox-abc123.js"), "workbox");
  await writeFile(
    path.join(distDirectory, "precache-manifest.abc123.js"),
    "precache",
  );
  return distDirectory;
}

async function withServer(app, callback) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createConfig(dataDir, distDir, overrides = {}) {
  return {
    dataDir,
    distDir,
    discogsEnvironment: null,
    ...overrides,
  };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("createApp", () => {
  it("serves health without exposing collection or configuration data", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory, {
        discogsEnvironment: {
          username: "environment-user",
          token: "secret-token",
        },
      }),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ ok: true });
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(body).not.toContain("secret-token");
    });
  });

  it("passes the injected API configuration to the shared handler", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const dataDirectory = path.join(directory, "data");
    const app = createApp({
      config: createConfig(dataDirectory, distDirectory, {
        discogsEnvironment: {
          username: "environment-user",
          token: "secret-token",
        },
      }),
    });

    await withServer(app, async (baseUrl) => {
      const recordsResponse = await fetch(`${baseUrl}/api/records`);
      expect(recordsResponse.status).toBe(200);
      expect(await recordsResponse.json()).toEqual({ records: [] });

      const configResponse = await fetch(`${baseUrl}/api/discogs-config`);
      expect(configResponse.status).toBe(200);
      expect(await configResponse.json()).toEqual({
        username: "environment-user",
        hasToken: true,
        source: "environment",
        canEdit: false,
      });
      expect(
        await readFile(path.join(dataDirectory, "records.json"), "utf8"),
      ).toContain("[]");
    });
  });

  it("uses immutable caching for hashed assets", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/index-abc123.js`);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable",
      );
    });
  });

  it.each([
    "index.html",
    "sw.js",
    "registerSW.js",
    "manifest.webmanifest",
    "workbox-abc123.js",
    "precache-manifest.abc123.js",
  ])("revalidates metadata path %s", async (fileName) => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/${fileName}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
    });
  });

  it("serves valid client-side navigation from the app shell", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/shelves/jazz`, {
        headers: { Accept: "text/html" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toContain("Vinyl app");
    });
  });

  it("never serves HTML for unknown API routes", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/unknown-route`);

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toEqual({ error: "Not found" });
    });
  });

  it("returns JSON for missing static resources instead of the app shell", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/missing.js`);

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(await response.json()).toEqual({ error: "Not found" });
    });
  });

  it("requires an HTML navigation request for the app-shell fallback", async () => {
    const directory = await createTemporaryDirectory();
    const distDirectory = await createDistDirectory(directory);
    const app = createApp({
      config: createConfig(path.join(directory, "data"), distDirectory),
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/missing-route`);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    });
  });
});
