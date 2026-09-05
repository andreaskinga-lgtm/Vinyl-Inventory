import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "./index.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-server-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("startServer", () => {
  it("initializes storage before listening", async () => {
    const directory = await createTemporaryDirectory();
    const dataDir = path.join(directory, "data");
    const server = await startServer({
      config: {
        port: 0,
        dataDir,
        distDir: path.join(directory, "dist"),
        discogsEnvironment: null,
      },
    });

    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);

      expect(response.status).toBe(200);
      await expect(readFile(path.join(dataDir, "records.json"), "utf8")).resolves.toContain(
        "[]",
      );
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fails before listening when the data directory is unusable", async () => {
    const directory = await createTemporaryDirectory();
    const dataDir = path.join(directory, "data");
    await writeFile(dataDir, "not a directory");

    await expect(
      startServer({
        config: {
          port: 0,
          dataDir,
          distDir: path.join(directory, "dist"),
          discogsEnvironment: null,
        },
      }),
    ).rejects.toThrow(/not a directory|ENOTDIR|EEXIST/);
  });
});
