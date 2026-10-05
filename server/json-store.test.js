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

  it("returns Site Settings defaults without creating the optional file", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    const store = createJsonStore({ dataDir });

    await expect(store.readSiteSettings()).resolves.toEqual({
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 3,
      },
      wifi: null,
    });
    await expect(access(siteSettingsPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
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
  it("verifies that the initialized data directory is writable", async () => {
    const dataDir = await createTemporaryDirectory();
    const store = createJsonStore({ dataDir });

    await expect(store.verifyWritable()).resolves.toBeUndefined();
    await expect(readdir(dataDir)).resolves.toEqual(
      ["genreOptions.json", "records.json"].sort(),
    );
  });

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

  it("creates Site Settings only on first write and reads the saved document back", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    const store = createJsonStore({ dataDir });
    const siteSettings = {
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 12,
      },
      wifi: null,
    };

    await expect(access(siteSettingsPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await store.writeSiteSettings(siteSettings);

    await expect(readJson(siteSettingsPath)).resolves.toEqual(siteSettings);
    await expect(store.readSiteSettings()).resolves.toEqual(siteSettings);
  });

  it("reads a validated configured Wi-Fi section without dropping unrelated settings", async () => {
    const dataDir = await createTemporaryDirectory();
    const store = createJsonStore({ dataDir });
    const siteSettings = {
      schemaVersion: 1,
      visitorDisplay: {
        idleTimeoutMinutes: 7,
      },
      wifi: {
        security: "wpa",
        ssid: "Café network",
        password: "0123456789abcdef".repeat(4),
        hidden: true,
      },
      futureSetting: "must remain private",
    };

    await store.writeSiteSettings(siteSettings);

    await expect(store.readSiteSettings()).resolves.toEqual(siteSettings);
  });

  it("rejects an unsupported stored Site Settings document instead of using defaults", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    await writeFile(
      siteSettingsPath,
      JSON.stringify({
        schemaVersion: 2,
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
      }),
    );
    const store = createJsonStore({ dataDir });

    await expect(store.readSiteSettings()).rejects.toThrow(
      `Invalid Site Settings in ${siteSettingsPath}`,
    );
  });

  it("rejects malformed optional Site Settings JSON instead of using defaults", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    await writeFile(siteSettingsPath, "{not json");
    const store = createJsonStore({ dataDir });

    await expect(store.readSiteSettings()).rejects.toThrow(
      `Invalid JSON in ${siteSettingsPath}`,
    );
  });

  it("rejects a stored Visitor Display timeout outside the supported whole-minute range", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    await writeFile(
      siteSettingsPath,
      JSON.stringify({
        schemaVersion: 1,
        visitorDisplay: { idleTimeoutMinutes: 0 },
        wifi: null,
      }),
    );
    const store = createJsonStore({ dataDir });

    await expect(store.readSiteSettings()).rejects.toThrow(
      `Invalid Site Settings in ${siteSettingsPath}`,
    );
  });

  it("rejects a stored Wi-Fi section that violates its security rules", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    await writeFile(
      siteSettingsPath,
      JSON.stringify({
        schemaVersion: 1,
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: {
          security: "wep",
          ssid: "Legacy network",
          password: "password",
          hidden: false,
        },
      }),
    );
    const store = createJsonStore({ dataDir });

    await expect(store.readSiteSettings()).rejects.toThrow(
      `Invalid Site Settings in ${siteSettingsPath}`,
    );
  });

  it("rejects invalid Site Settings writes without creating or replacing the file", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    const store = createJsonStore({ dataDir });

    await expect(
      store.writeSiteSettings({
        schemaVersion: 1,
        visitorDisplay: { idleTimeoutMinutes: 31 },
        wifi: null,
      }),
    ).rejects.toThrow(`Invalid Site Settings in ${siteSettingsPath}`);
    await expect(access(siteSettingsPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains the previous valid Site Settings document as the backup", async () => {
    const dataDir = await createTemporaryDirectory();
    const siteSettingsPath = path.join(dataDir, "siteSettings.json");
    const store = createJsonStore({ dataDir });
    const settings = (idleTimeoutMinutes) => ({
      schemaVersion: 1,
      visitorDisplay: { idleTimeoutMinutes },
      wifi: null,
    });

    await store.writeSiteSettings(settings(3));
    await store.writeSiteSettings(settings(4));
    await store.writeSiteSettings(settings(5));

    await expect(readJson(siteSettingsPath)).resolves.toEqual(settings(5));
    await expect(readJson(`${siteSettingsPath}.bak`)).resolves.toEqual(
      settings(4),
    );
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

  it("serializes queued Site Settings writes and leaves the newest document readable", async () => {
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
      if (blockWrites && filePath.endsWith("siteSettings.json")) {
        writes.push(value);
        if (writes.length === 1) {
          signalFirstWriteStarted();
          await firstWriteBlocked;
        }
      }
      await atomicWriteJson({ filePath, value });
    });
    const store = createJsonStore({ dataDir, writeJson });
    await store.initialize();
    writeJson.mockClear();
    blockWrites = true;

    const olderSettings = {
      schemaVersion: 1,
      visitorDisplay: { idleTimeoutMinutes: 4 },
      wifi: null,
    };
    const newerSettings = {
      schemaVersion: 1,
      visitorDisplay: { idleTimeoutMinutes: 5 },
      wifi: null,
    };
    const olderWrite = store.writeSiteSettings(olderSettings);
    await firstWriteStarted;
    const newerWrite = store.writeSiteSettings(newerSettings);

    await Promise.resolve();
    expect(writes).toEqual([olderSettings]);
    releaseFirstWrite();
    await Promise.all([olderWrite, newerWrite]);

    expect(writes).toEqual([olderSettings, newerSettings]);
    await expect(store.readSiteSettings()).resolves.toEqual(newerSettings);
  });

  it("serializes Site Settings read-modify-write updates against the latest document", async () => {
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
      if (blockWrites && filePath.endsWith("siteSettings.json")) {
        writes.push(value);
        if (writes.length === 1) {
          signalFirstWriteStarted();
          await firstWriteBlocked;
        }
      }
      await atomicWriteJson({ filePath, value });
    });
    const store = createJsonStore({ dataDir, writeJson });
    const initialSettings = {
      schemaVersion: 1,
      visitorDisplay: { idleTimeoutMinutes: 3 },
      wifi: null,
    };
    await store.writeSiteSettings(initialSettings);
    writeJson.mockClear();
    blockWrites = true;

    const displayUpdate = store.updateSiteSettings((settings) => ({
      ...settings,
      visitorDisplay: { idleTimeoutMinutes: 9 },
    }));
    await firstWriteStarted;
    const wifiUpdate = store.updateSiteSettings((settings) => ({
      ...settings,
      wifi: {
        security: "open",
        ssid: "Visitor network",
        password: "",
        hidden: false,
      },
    }));

    await Promise.resolve();
    expect(writes).toHaveLength(1);
    releaseFirstWrite();
    await Promise.all([displayUpdate, wifiUpdate]);

    expect(writes).toEqual([
      {
        schemaVersion: 1,
        visitorDisplay: { idleTimeoutMinutes: 9 },
        wifi: null,
      },
      {
        schemaVersion: 1,
        visitorDisplay: { idleTimeoutMinutes: 9 },
        wifi: {
          security: "open",
          ssid: "Visitor network",
          password: "",
          hidden: false,
        },
      },
    ]);
    await expect(store.readSiteSettings()).resolves.toEqual(writes[1]);
  });
});

describe("atomicWriteJson", () => {
  it("atomically writes already-validated serialized JSON verbatim", async () => {
    const dataDir = await createTemporaryDirectory();
    const filePath = path.join(dataDir, "discogsConfig.json");
    const serializedValue = '{"username":"collector","token":"secret"}';

    await atomicWriteJson({
      filePath,
      value: { username: "collector", token: "secret" },
      serializedValue,
    });

    await expect(readFile(filePath, "utf8")).resolves.toBe(serializedValue);
  });

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
