import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import { atomicWriteJson, createJsonStore } from "./json-store.js";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-json-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function expectOnlyPrimaryAndBackup(dataDir) {
  expect((await readdir(dataDir)).sort()).toEqual([
    "records.json",
    "records.json.bak",
  ]);
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

describe("createJsonStore initialization", () => {
  it("creates only the required resources from their shipped defaults", async () => {
    const parentDirectory = await createTemporaryDirectory();
    const dataDir = path.join(parentDirectory, "data");
    const store = createJsonStore({ dataDir });

    await store.initialize();

    await expect(readJson(path.join(dataDir, "records.json"))).resolves.toEqual(
      [],
    );
    await expect(
      readJson(path.join(dataDir, "genreOptions.json")),
    ).resolves.toEqual({
      genres: GENRES,
      subGenres: SUB_GENRES,
    });
    await expect(
      access(path.join(dataDir, "discogsConfig.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails explicitly when required JSON is invalid and identifies its backup", async () => {
    const dataDir = await createTemporaryDirectory();
    const primaryPath = path.join(dataDir, "records.json");
    const backupPath = `${primaryPath}.bak`;
    await writeFile(primaryPath, "not json");
    await writeFile(backupPath, "[]");

    await expect(createJsonStore({ dataDir }).initialize()).rejects.toThrow(
      `Invalid JSON in ${primaryPath}; a backup may be available at ${backupPath}`,
    );
    await expect(readFile(primaryPath, "utf8")).resolves.toBe("not json");
  });

  it("does not restore backups or accept temporary files as primaries", async () => {
    const dataDir = await createTemporaryDirectory();
    const primaryPath = path.join(dataDir, "records.json");
    await writeFile(`${primaryPath}.bak`, '[{"source":"backup"}]');
    await writeFile(`${primaryPath}.temporary`, '[{"source":"temporary"}]');

    await expect(createJsonStore({ dataDir }).initialize()).rejects.toThrow(
      `Missing required JSON file ${primaryPath}; a backup may be available at ${primaryPath}.bak`,
    );
    await expect(access(primaryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("createJsonStore resources", () => {
  it("reads and writes each resource without exposing paths to callers", async () => {
    const dataDir = await createTemporaryDirectory();
    const store = createJsonStore({ dataDir });
    const records = [{ id: 1, title: "Kind of Blue" }];
    const genreOptions = { genres: ["Jazz"], subGenres: ["Modal"] };
    const discogsConfig = { username: "collector", token: "secret" };

    await store.writeRecords(records);
    await store.writeGenreOptions(genreOptions);
    await expect(store.readDiscogsConfig()).resolves.toBeNull();
    await store.writeDiscogsConfig(discogsConfig);

    await expect(store.readRecords()).resolves.toEqual(records);
    await expect(store.readGenreOptions()).resolves.toEqual(genreOptions);
    await expect(store.readDiscogsConfig()).resolves.toEqual(discogsConfig);
  });

  it("serializes parallel writes to the same resource in request order", async () => {
    const dataDir = await createTemporaryDirectory();
    let releaseFirstWrite;
    const firstWriteBlocked = new Promise((resolve) => {
      releaseFirstWrite = resolve;
    });
    let signalFirstWriteStarted;
    const firstWriteStarted = new Promise((resolve) => {
      signalFirstWriteStarted = resolve;
    });
    const writes = [];
    let blockWrites = false;
    const writeJson = vi.fn(async ({ filePath, value }) => {
      if (blockWrites) {
        writes.push(value);
      }
      if (blockWrites && writes.length === 1) {
        signalFirstWriteStarted();
        await firstWriteBlocked;
      }
      await atomicWriteJson({ filePath, value });
    });
    const store = createJsonStore({ dataDir, writeJson });
    await store.initialize();
    writeJson.mockClear();
    blockWrites = true;

    const olderWrite = store.writeRecords([{ id: "older" }]);
    await firstWriteStarted;
    const newerWrite = store.writeRecords([{ id: "newer" }]);

    await Promise.resolve();
    expect(writeJson).toHaveBeenCalledTimes(1);
    releaseFirstWrite();
    await Promise.all([olderWrite, newerWrite]);

    expect(writes).toEqual([[{ id: "older" }], [{ id: "newer" }]]);
    await expect(store.readRecords()).resolves.toEqual([{ id: "newer" }]);
  });
});

describe("atomicWriteJson", () => {
  it("retains the previous primary as the single backup", async () => {
    const dataDir = await createTemporaryDirectory();
    const filePath = path.join(dataDir, "records.json");

    await atomicWriteJson({ filePath, value: [{ version: 1 }] });
    await atomicWriteJson({ filePath, value: [{ version: 2 }] });
    await atomicWriteJson({ filePath, value: [{ version: 3 }] });

    await expect(readJson(filePath)).resolves.toEqual([{ version: 3 }]);
    await expect(readJson(`${filePath}.bak`)).resolves.toEqual([
      { version: 2 },
    ]);
    await expectOnlyPrimaryAndBackup(dataDir);
  });

  it.each([
    [
      "before backup replacement",
      "beforeBackupReplacement",
      [{ version: 2 }],
      [{ version: 1 }],
    ],
    [
      "before primary replacement",
      "beforePrimaryReplacement",
      [{ version: 2 }],
      [{ version: 2 }],
    ],
    [
      "after primary replacement",
      "afterPrimaryReplacement",
      [{ version: 3 }],
      [{ version: 2 }],
    ],
  ])(
    "preserves valid primary and backup state after failure %s",
    async (_name, hookName, expectedPrimary, expectedBackup) => {
      const dataDir = await createTemporaryDirectory();
      const filePath = path.join(dataDir, "records.json");
      await atomicWriteJson({ filePath, value: [{ version: 1 }] });
      await atomicWriteJson({ filePath, value: [{ version: 2 }] });
      const injectedFailure = new Error(`injected ${hookName}`);

      await expect(
        atomicWriteJson({
          filePath,
          value: [{ version: 3 }],
          hooks: {
            [hookName]() {
              throw injectedFailure;
            },
          },
        }),
      ).rejects.toBe(injectedFailure);

      await expect(readJson(filePath)).resolves.toEqual(expectedPrimary);
      await expect(readJson(`${filePath}.bak`)).resolves.toEqual(
        expectedBackup,
      );
      await expectOnlyPrimaryAndBackup(dataDir);
    },
  );
});
