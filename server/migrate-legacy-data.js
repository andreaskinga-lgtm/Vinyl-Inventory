import {
  chmod,
  chown,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";
import { createJsonStore } from "./json-store.js";

const RESOURCES = Object.freeze([
  ["records", "records.json", true],
  ["genreOptions", "genreOptions.json", true],
  ["discogsConfig", "discogsConfig.json", false],
]);
const DEFAULT_GENRE_OPTIONS = Object.freeze({
  genres: GENRES,
  subGenres: SUB_GENRES,
});

function parseJson(contents, filePath) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}`, { cause: error });
  }
}

async function readRegularFile(filePath, { required = false } = {}) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" && !required) {
      return null;
    }
    if (error.code === "ENOENT") {
      throw new Error(`Missing required JSON file ${filePath}`);
    }
    throw error;
  }

  if (!stats.isFile()) {
    if (!required) {
      return null;
    }
    throw new Error(`Required JSON path is not a regular file: ${filePath}`);
  }
  return readFile(filePath, "utf8");
}

async function preflightSource(sourceDir) {
  const resolvedSource = await realpath(sourceDir);
  const resources = new Map();

  for (const [resource, fileName, required] of RESOURCES) {
    const filePath = path.join(resolvedSource, fileName);
    const contents = await readRegularFile(filePath, { required });
    if (contents === null) {
      continue;
    }

    const backupPath = `${filePath}.bak`;
    const backupContents = await readRegularFile(backupPath);
    resources.set(resource, {
      fileName,
      value: parseJson(contents, filePath),
      backupValue:
        backupContents === null ? null : parseJson(backupContents, backupPath),
    });
  }

  return resources;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeFileIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export function resolveWithinTarget(targetDir, fileName) {
  const resolvedPath = path.resolve(targetDir, fileName);
  const relativePath = path.relative(targetDir, resolvedPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Migration path escapes target directory: ${fileName}`);
  }
  return resolvedPath;
}

async function targetIsPristine(targetDir) {
  const entries = await readdir(targetDir);
  if (entries.some((entry) => entry.endsWith(".bak") || entry.includes("history"))) {
    return false;
  }

  for (const fileName of ["records.json", "genreOptions.json"]) {
    const filePath = resolveWithinTarget(targetDir, fileName);
    if (!(await pathExists(filePath))) {
      return false;
    }
    const stats = await lstat(filePath);
    if (!stats.isFile()) {
      return false;
    }
  }

  const records = parseJson(
    await readFile(resolveWithinTarget(targetDir, "records.json"), "utf8"),
    resolveWithinTarget(targetDir, "records.json"),
  );
  const genreOptions = parseJson(
    await readFile(resolveWithinTarget(targetDir, "genreOptions.json"), "utf8"),
    resolveWithinTarget(targetDir, "genreOptions.json"),
  );
  return (
    valuesEqual(records, []) &&
    valuesEqual(genreOptions, DEFAULT_GENRE_OPTIONS) &&
    !(await pathExists(resolveWithinTarget(targetDir, "discogsConfig.json")))
  );
}

async function resolveNodeOwner() {
  const passwd = await readFile("/etc/passwd", "utf8");
  const nodeEntry = passwd
    .split("\n")
    .find((line) => line.startsWith("node:"));
  if (!nodeEntry) {
    throw new Error("The image's node user was not found in /etc/passwd");
  }
  const fields = nodeEntry.split(":");
  return { uid: Number(fields[2]), gid: Number(fields[3]) };
}

async function installBackup({ targetDir, fileName, value, owner }) {
  const backupPath = resolveWithinTarget(targetDir, `${fileName}.bak`);
  const temporaryPath = resolveWithinTarget(
    targetDir,
    `.${fileName}.${process.pid}.migration-backup.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o640,
  });
  try {
    await chown(temporaryPath, owner.uid, owner.gid);
    await rename(temporaryPath, backupPath);
  } finally {
    await removeFileIfPresent(temporaryPath);
  }
}

async function secureTransferredFiles(targetDir, owner) {
  for (const [, fileName] of RESOURCES) {
    for (const candidate of [fileName, `${fileName}.bak`]) {
      const filePath = resolveWithinTarget(targetDir, candidate);
      if (!(await pathExists(filePath))) {
        continue;
      }
      const stats = await lstat(filePath);
      if (!stats.isFile()) {
        throw new Error(`Target migration path is not a regular file: ${filePath}`);
      }
      await chown(filePath, owner.uid, owner.gid);
      await chmod(filePath, 0o640);
    }
  }
}

export async function migrateLegacyData({
  sourceDir,
  targetDir,
  overwrite = false,
  owner,
  log = console.log,
  hooks = {},
}) {
  if (!sourceDir || !targetDir) {
    throw new Error("Both sourceDir and targetDir are required");
  }

  const resources = await preflightSource(sourceDir);
  const targetOwner = owner ?? (await resolveNodeOwner());
  await mkdir(targetDir, { recursive: true });
  const resolvedTarget = await realpath(targetDir);
  const entries = await readdir(resolvedTarget);
  const store = createJsonStore({ dataDir: resolvedTarget });

  if (entries.length === 0) {
    await store.initialize();
    await secureTransferredFiles(resolvedTarget, targetOwner);
  }

  if (!overwrite && !(await targetIsPristine(resolvedTarget))) {
    throw new Error(
      "Target is not pristine; rerun with --overwrite only after confirming the target backup",
    );
  }

  if (resources.has("discogsConfig")) {
    log(
      "Migrating discogsConfig.json; the target volume and its backups contain saved credentials.",
    );
  }

  for (const [resource, fileName] of RESOURCES) {
    const source = resources.get(resource);
    if (!source) {
      continue;
    }
    await hooks.beforeResourceWrite?.(resource);
    await store[`write${resource[0].toUpperCase()}${resource.slice(1)}`](
      source.value,
    );

    if (!overwrite && source.backupValue !== null) {
      await installBackup({
        targetDir: resolvedTarget,
        fileName,
        value: source.backupValue,
        owner: targetOwner,
      });
    }
    await secureTransferredFiles(resolvedTarget, targetOwner);
  }

  log(`Migration completed into ${resolvedTarget}`);
}

function parseArguments(argv) {
  const options = { overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--overwrite") {
      options.overwrite = true;
    } else if (argument === "--source" || argument === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      options[argument === "--source" ? "sourceDir" : "targetDir"] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.sourceDir || !options.targetDir) {
    throw new Error(
      "Usage: node server/migrate-legacy-data.js --source /legacy --target /data [--overwrite]",
    );
  }
  return options;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  migrateLegacyData(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
