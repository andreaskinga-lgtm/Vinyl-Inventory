import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vinyl-backup-"));
  temporaryDirectories.push(root);
  const binDir = path.join(root, "bin");
  const volumeDir = path.join(root, "volumes", "vinyl-inventory-data");
  const backupDir = path.join(root, "backup destination");
  const stateFile = path.join(root, "app-state");
  const logFile = path.join(root, "docker.log");
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(volumeDir, { recursive: true }),
    mkdir(backupDir, { recursive: true }),
    writeFile(stateFile, "running"),
    writeFile(logFile, ""),
  ]);

  const fakeDocker = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const root = process.env.FAKE_DOCKER_ROOT;
const stateFile = path.join(root, "app-state");
appendFileSync(path.join(root, "docker.log"), args.join(" ") + "\\n");
const fail = (message) => { console.error(message); process.exit(1); };
const volumePath = (name) => path.join(root, "volumes", name);

if (args[0] === "inspect") {
  if (args.includes("{{.State.Status}}")) {
    const state = readFileSync(stateFile, "utf8");
    console.log(state === "stopped" ? "exited" : state);
  } else if (args.includes("{{.Config.Image}}")) {
    console.log("vinyl-inventory:test");
  } else {
    fail("unsupported inspect format");
  }
} else if (args[0] === "volume" && args[1] === "inspect") {
  if (!existsSync(volumePath(args.at(-1)))) fail("missing volume");
  console.log(volumePath(args.at(-1)));
} else if (args[0] === "volume" && args[1] === "create") {
  mkdirSync(volumePath(args.at(-1)), { recursive: true });
  console.log(args.at(-1));
} else if (args[0] === "volume" && args[1] === "rm") {
  rmSync(volumePath(args.at(-1)), { recursive: true, force: true });
} else if (args.includes("compose")) {
  if (args.includes("ps")) {
    console.log("app-container");
  } else if (args.includes("stop")) {
    writeFileSync(stateFile, "stopped");
  } else if (args.includes("start")) {
    writeFileSync(stateFile, "running");
  } else {
    fail("unsupported compose command");
  }
} else if (args[0] === "run") {
  const mounts = new Map();
  const environment = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--volume") {
      const [source, target] = args[++index].split(":");
      mounts.set(target, source.includes("/") ? source : volumePath(source));
    } else if (args[index] === "--env") {
      const [name, ...value] = args[++index].split("=");
      environment.set(name, value.join("="));
    }
  }
  const operation = environment.get("VINYL_ARCHIVE_OPERATION");
  let result;
  if (operation === "create") {
    const archive = path.join(mounts.get("/archives"), environment.get("VINYL_ARCHIVE_NAME"));
    result = spawnSync("tar", ["-C", mounts.get("/source"), "-czf", archive, "."]);
  } else if (operation === "extract") {
    const archive = path.join(mounts.get("/archives"), environment.get("VINYL_ARCHIVE_NAME"));
    result = spawnSync("tar", ["-C", mounts.get("/target"), "-xzf", archive]);
  } else if (operation === "replace") {
    rmSync(mounts.get("/target"), { recursive: true, force: true });
    mkdirSync(mounts.get("/target"), { recursive: true });
    result = spawnSync("tar", ["-C", mounts.get("/source"), "-cf", "-", "."])
    if (result.status === 0) {
      result = spawnSync("tar", ["-C", mounts.get("/target"), "-xf", "-"], {
        input: result.stdout,
      });
    }
  } else if (operation === "validate") {
    for (const name of ["records.json", "genreOptions.json"]) {
      JSON.parse(readFileSync(path.join(mounts.get("/data"), name), "utf8"));
    }
    result = { status: 0 };
  } else {
    fail("unsupported archive operation");
  }
  if (result.status !== 0) fail(result.stderr.toString());
} else {
  fail("unsupported docker command");
}
`;
  const dockerPath = path.join(binDir, "docker");
  await writeFile(dockerPath, fakeDocker);
  await chmod(dockerPath, 0o755);

  return {
    backupDir,
    logFile,
    stateFile,
    volumeDir,
    environment: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_DOCKER_ROOT: root,
    },
  };
}

async function writeFixture(volumeDir, suffix) {
  const files = {
    "records.json": `[{"id":1,"title":"Kind of Blue ${suffix}"}]\n`,
    "genreOptions.json": `{"genres":["Jazz ${suffix}"],"subGenres":[]}\n`,
    "discogsConfig.json": `{"username":"collector","token":"secret-${suffix}"}\n`,
    "records.json.bak": `[{"id":0,"title":"Earlier ${suffix}"}]\n`,
  };
  await Promise.all(
    Object.entries(files).map(([name, contents]) =>
      writeFile(path.join(volumeDir, name), contents),
    ),
  );
  return files;
}

async function readFixture(volumeDir) {
  const names = (await readdir(volumeDir)).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(path.join(volumeDir, name), "utf8")]),
    ),
  );
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("whole-volume backup and restore", () => {
  it("restores records, genres, credentials, and backups byte-for-byte", async () => {
    const harness = await createHarness();
    const original = await writeFixture(harness.volumeDir, "original");

    const backup = await execFileAsync(
      path.join(repositoryRoot, "deploy/backup/backup-volume.sh"),
      [harness.backupDir],
      { cwd: repositoryRoot, env: harness.environment },
    );
    const archive = backup.stdout.trim().split("\n").at(-1);

    await rm(harness.volumeDir, { recursive: true });
    await mkdir(harness.volumeDir);
    await writeFixture(harness.volumeDir, "replacement");

    await execFileAsync(
      path.join(repositoryRoot, "deploy/backup/restore-volume.sh"),
      [archive, harness.backupDir],
      { cwd: repositoryRoot, env: harness.environment },
    );

    assert.deepEqual(await readFixture(harness.volumeDir), original);
    assert.equal(await readFile(harness.stateFile, "utf8"), "running");
    const backupNames = await readdir(harness.backupDir);
    assert.ok(backupNames.includes(path.basename(archive)));
    assert.ok(
      backupNames.some((name) =>
        /^vinyl-inventory-data-pre-restore-.*\.tar\.gz$/.test(name),
      ),
    );
    const lifecycle = await readFile(harness.logFile, "utf8");
    assert.match(lifecycle, /compose/);
    assert.match(lifecycle, /stop app/);
    assert.match(lifecycle, /start --wait app/);
  });

  it("rejects an invalid archive before stopping the writer", async () => {
    const harness = await createHarness();
    const invalidArchive = path.join(harness.backupDir, "invalid.tar.gz");
    await writeFile(invalidArchive, "not an archive");

    await assert.rejects(
      execFileAsync(
        path.join(repositoryRoot, "deploy/backup/restore-volume.sh"),
        [invalidArchive, harness.backupDir],
        { cwd: repositoryRoot, env: harness.environment },
      ),
    );

    assert.equal(await readFile(harness.stateFile, "utf8"), "running");
    const lifecycle = await readFile(harness.logFile, "utf8");
    assert.doesNotMatch(lifecycle, /stop app/);
  });

  it("does not start an app that was stopped before backup", async () => {
    const harness = await createHarness();
    await writeFixture(harness.volumeDir, "stopped");
    await writeFile(harness.stateFile, "stopped");

    await execFileAsync(
      path.join(repositoryRoot, "deploy/backup/backup-volume.sh"),
      [harness.backupDir],
      { cwd: repositoryRoot, env: harness.environment },
    );

    assert.equal(await readFile(harness.stateFile, "utf8"), "stopped");
    const lifecycle = await readFile(harness.logFile, "utf8");
    assert.doesNotMatch(lifecycle, /start --wait app/);
  });

  it("stops a restarting writer before creating a backup", async () => {
    const harness = await createHarness();
    await writeFixture(harness.volumeDir, "restarting");
    await writeFile(harness.stateFile, "restarting");

    await execFileAsync(
      path.join(repositoryRoot, "deploy/backup/backup-volume.sh"),
      [harness.backupDir],
      { cwd: repositoryRoot, env: harness.environment },
    );

    assert.equal(await readFile(harness.stateFile, "utf8"), "running");
    const lifecycle = await readFile(harness.logFile, "utf8");
    assert.match(lifecycle, /stop app/);
  });

  it("rejects malformed persisted JSON before replacing the current volume", async () => {
    const harness = await createHarness();
    await writeFixture(harness.volumeDir, "invalid");
    await writeFile(path.join(harness.volumeDir, "records.json"), "{");
    const backup = await execFileAsync(
      path.join(repositoryRoot, "deploy/backup/backup-volume.sh"),
      [harness.backupDir],
      { cwd: repositoryRoot, env: harness.environment },
    );
    const archive = backup.stdout.trim().split("\n").at(-1);
    await writeFixture(harness.volumeDir, "current");
    await writeFile(harness.logFile, "");

    await assert.rejects(
      execFileAsync(
        path.join(repositoryRoot, "deploy/backup/restore-volume.sh"),
        [archive, harness.backupDir],
        { cwd: repositoryRoot, env: harness.environment },
      ),
    );

    assert.match(
      await readFile(path.join(harness.volumeDir, "records.json"), "utf8"),
      /current/,
    );
    assert.doesNotMatch(await readFile(harness.logFile, "utf8"), /stop app/);
  });
});
