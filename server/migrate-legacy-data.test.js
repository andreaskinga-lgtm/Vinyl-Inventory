import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import {
  migrateLegacyData,
  resolveWithinTarget,
} from "./migrate-legacy-data.js";

const temporaryDirectories = [];
const defaults = { genres: GENRES, subGenres: SUB_GENRES };
const owner = { uid: process.getuid(), gid: process.getgid() };

async function createTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vinyl-migration-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createSource(records = [{ id: 1, artist: "Miles Davis" }]) {
  const sourceDir = await createTemporaryDirectory();
  await writeJson(path.join(sourceDir, "records.json"), records);
  await writeJson(path.join(sourceDir, "genreOptions.json"), {
    genres: ["Jazz"],
    subGenres: ["Modal"],
  });
  return sourceDir;
}

async function createPristineTarget() {
  const targetDir = await createTemporaryDirectory();
  await writeJson(path.join(targetDir, "records.json"), []);
  await writeJson(path.join(targetDir, "genreOptions.json"), defaults);
  return targetDir;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("legacy migration preflight", () => {
  it.each([
    ["missing required files", async (sourceDir) => {
      await rm(path.join(sourceDir, "records.json"));
    }],
    ["malformed required JSON", async (sourceDir) => {
      await writeFile(path.join(sourceDir, "records.json"), "{");
    }],
    ["malformed optional credentials", async (sourceDir) => {
      await writeFile(path.join(sourceDir, "discogsConfig.json"), "{");
    }],
  ])("refuses %s before mutating the target", async (_name, arrange) => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();
    await arrange(sourceDir);

    await expect(
      migrateLegacyData({ sourceDir, targetDir, owner }),
    ).rejects.toThrow();
    await expect(readdir(targetDir)).resolves.toEqual([]);
  });

  it("does not print credential values during preflight or migration", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();
    const log = vi.fn();
    await writeJson(path.join(sourceDir, "discogsConfig.json"), {
      username: "private-user",
      token: "private-token",
    });

    await migrateLegacyData({ sourceDir, targetDir, owner, log });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("discogsConfig.json"),
    );
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-user");
    expect(log.mock.calls.flat().join(" ")).not.toContain("private-token");
  });

  it("preserves validated credential files verbatim", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();
    const credentialContents = '{"username":"private-user","token":"private-token"}';
    const backupContents = '{\n\t"username": "older",\n\t"token": "older-token"\n}';
    await writeFile(
      path.join(sourceDir, "discogsConfig.json"),
      credentialContents,
    );
    await writeFile(
      path.join(sourceDir, "discogsConfig.json.bak"),
      backupContents,
    );

    await migrateLegacyData({ sourceDir, targetDir, owner, log: vi.fn() });

    await expect(
      readFile(path.join(targetDir, "discogsConfig.json"), "utf8"),
    ).resolves.toBe(credentialContents);
    await expect(
      readFile(path.join(targetDir, "discogsConfig.json.bak"), "utf8"),
    ).resolves.toBe(backupContents);
  });
});

describe("legacy migration transfer", () => {
  it("transfers only recognized files and matching backups", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();
    await writeJson(path.join(sourceDir, "records.json.bak"), [{ id: "old" }]);
    await writeJson(path.join(sourceDir, "discogsConfig.json"), {
      username: "collector",
      token: "secret",
    });
    await writeJson(path.join(sourceDir, "discogsConfig.json.bak"), {
      username: "older",
      token: "older-secret",
    });
    await writeFile(path.join(sourceDir, ".DS_Store"), "metadata");
    await writeFile(path.join(sourceDir, "notes.txt"), "unrelated");
    await writeFile(path.join(sourceDir, ".records.json.tmp"), "temporary");
    await symlink(
      path.join(sourceDir, "records.json"),
      path.join(sourceDir, "genreOptions.json.bak"),
    );

    await migrateLegacyData({ sourceDir, targetDir, owner });

    expect((await readdir(targetDir)).sort()).toEqual([
      "discogsConfig.json",
      "discogsConfig.json.bak",
      "genreOptions.json",
      "records.json",
      "records.json.bak",
    ]);
    await expect(
      readJson(path.join(targetDir, "records.json.bak")),
    ).resolves.toEqual([{ id: "old" }]);
    await expect(
      readJson(path.join(targetDir, "discogsConfig.json")),
    ).resolves.toEqual({
      username: "collector",
      token: "secret",
    });
    expect(
      (await lstat(path.join(targetDir, "records.json"))).isSymbolicLink(),
    ).toBe(false);
  });

  it("transfers a recognized optional backup without its primary", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();
    await writeJson(path.join(sourceDir, "discogsConfig.json.bak"), {
      username: "former-collector",
      token: "former-secret",
    });

    await migrateLegacyData({ sourceDir, targetDir, owner, log: vi.fn() });

    await expect(
      access(path.join(targetDir, "discogsConfig.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readJson(path.join(targetDir, "discogsConfig.json.bak")),
    ).resolves.toEqual({
      username: "former-collector",
      token: "former-secret",
    });
  });

  it("rejects target paths that escape the resolved target directory", () => {
    expect(() => resolveWithinTarget("/data", "../etc/passwd")).toThrow(
      "escapes target directory",
    );
  });

  it("refuses a rerun after a pristine target has received legacy data", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();

    await migrateLegacyData({ sourceDir, targetDir, owner });

    await expect(
      migrateLegacyData({ sourceDir, targetDir, owner }),
    ).rejects.toThrow("Target is not pristine");
  });

  it("refuses a used target without overwrite", async () => {
    const sourceDir = await createSource();
    const targetDir = await createPristineTarget();
    await writeJson(path.join(targetDir, "records.json"), [{ id: "current" }]);

    await expect(
      migrateLegacyData({ sourceDir, targetDir, owner }),
    ).rejects.toThrow("Target is not pristine");
    await expect(
      readJson(path.join(targetDir, "records.json")),
    ).resolves.toEqual([{ id: "current" }]);
  });

  it("uses JSON store writes on overwrite and preserves prior primaries", async () => {
    const sourceDir = await createSource([{ id: "legacy" }]);
    const targetDir = await createPristineTarget();
    await writeJson(path.join(targetDir, "records.json"), [{ id: "current" }]);
    await writeJson(path.join(targetDir, "genreOptions.json"), {
      genres: ["Current"],
      subGenres: [],
    });

    await migrateLegacyData({
      sourceDir,
      targetDir,
      owner,
      overwrite: true,
    });

    await expect(
      readJson(path.join(targetDir, "records.json")),
    ).resolves.toEqual([{ id: "legacy" }]);
    await expect(
      readJson(path.join(targetDir, "records.json.bak")),
    ).resolves.toEqual([{ id: "current" }]);
    await expect(
      readJson(path.join(targetDir, "genreOptions.json.bak")),
    ).resolves.toEqual({ genres: ["Current"], subGenres: [] });
  });

  it("surfaces a partial failure while retaining recoverable target state", async () => {
    const sourceDir = await createSource([{ id: "legacy" }]);
    const targetDir = await createPristineTarget();
    const failure = new Error("injected copy failure");

    await expect(
      migrateLegacyData({
        sourceDir,
        targetDir,
        owner,
        overwrite: true,
        hooks: {
          beforeResourceWrite(resource) {
            if (resource === "genreOptions") {
              throw failure;
            }
          },
        },
      }),
    ).rejects.toBe(failure);

    await expect(
      readJson(path.join(targetDir, "records.json")),
    ).resolves.toEqual([{ id: "legacy" }]);
    await expect(
      readJson(path.join(targetDir, "records.json.bak")),
    ).resolves.toEqual([]);
    await expect(
      readJson(path.join(targetDir, "genreOptions.json")),
    ).resolves.toEqual(defaults);
  });

  it("leaves migrated files readable by the configured owner", async () => {
    const sourceDir = await createSource();
    const targetDir = await createTemporaryDirectory();

    await migrateLegacyData({ sourceDir, targetDir, owner });

    await expect(
      access(path.join(targetDir, "records.json")),
    ).resolves.toBeUndefined();
    expect(
      (await lstat(path.join(targetDir, "records.json"))).mode & 0o400,
    ).toBe(0o400);
  });
});
