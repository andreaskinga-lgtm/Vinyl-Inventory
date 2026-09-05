import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GENRES, SUB_GENRES } from "../src/data/genreOptions.js";

const RESOURCE_FILES = Object.freeze({
  records: "records.json",
  genreOptions: "genreOptions.json",
  discogsConfig: "discogsConfig.json",
});

function backupPathFor(filePath) {
  return `${filePath}.bak`;
}

function invalidJsonError(filePath, cause) {
  return new Error(
    `Invalid JSON in ${filePath}; a backup may be available at ${backupPathFor(filePath)}`,
    { cause },
  );
}

function missingRequiredJsonError(filePath) {
  return new Error(
    `Missing required JSON file ${filePath}; a backup may be available at ${backupPathFor(filePath)}`,
  );
}

function parseJson(contents, filePath) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw invalidJsonError(filePath, error);
  }
}

async function readExistingFile(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeAndSync(filePath, contents) {
  const handle = await open(filePath, "wx");
  try {
    await writeFile(handle, contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeTemporaryFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function serializeJson(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError("JSON value must be serializable");
  }
  return `${serialized}\n`;
}

export async function atomicWriteJson({
  filePath,
  value,
  serializedValue,
  hooks = {},
}) {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const operationId = `${process.pid}-${randomUUID()}`;
  const primaryTemporaryPath = path.join(
    directory,
    `.${baseName}.${operationId}.tmp`,
  );
  const backupTemporaryPath = path.join(
    directory,
    `.${baseName}.${operationId}.bak.tmp`,
  );
  const backupPath = backupPathFor(filePath);
  const serialized =
    serializedValue === undefined ? serializeJson(value) : serializedValue;
  if (serializedValue !== undefined) {
    parseJson(serializedValue, filePath);
  }

  await mkdir(directory, { recursive: true });

  try {
    await writeAndSync(primaryTemporaryPath, serialized);

    const priorContents = await readExistingFile(filePath);
    if (priorContents !== null) {
      let priorIsValid = true;
      try {
        parseJson(priorContents, filePath);
      } catch (error) {
        if (!(error.cause instanceof SyntaxError)) {
          throw error;
        }
        priorIsValid = false;
      }

      if (priorIsValid) {
        await writeAndSync(backupTemporaryPath, priorContents);
        await hooks.beforeBackupReplacement?.();
        await rename(backupTemporaryPath, backupPath);
      }
    }

    await hooks.beforePrimaryReplacement?.();
    await rename(primaryTemporaryPath, filePath);
    await hooks.afterPrimaryReplacement?.();

    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    await removeTemporaryFile(primaryTemporaryPath);
    await removeTemporaryFile(backupTemporaryPath);
  }
}

export function createJsonStore({
  dataDir,
  writeJson = atomicWriteJson,
}) {
  const resourcePath = (resource) =>
    path.join(dataDir, RESOURCE_FILES[resource]);
  const writeQueues = new Map();
  let initialization;

  async function inspectRequiredResource(resource) {
    const filePath = resourcePath(resource);
    const contents = await readExistingFile(filePath);
    if (contents !== null) {
      parseJson(contents, filePath);
      return true;
    }

    const backupContents = await readExistingFile(backupPathFor(filePath));
    if (backupContents !== null) {
      throw missingRequiredJsonError(filePath);
    }

    return false;
  }

  function initialize() {
    initialization ??= (async () => {
      await mkdir(dataDir, { recursive: true });
      const recordsExist = await inspectRequiredResource("records");
      const genreOptionsExist =
        await inspectRequiredResource("genreOptions");

      if (!recordsExist) {
        await writeJson({ filePath: resourcePath("records"), value: [] });
      }
      if (!genreOptionsExist) {
        await writeJson({
          filePath: resourcePath("genreOptions"),
          value: { genres: GENRES, subGenres: SUB_GENRES },
        });
      }
    })();

    return initialization;
  }

  async function readResource(resource, { optional = false } = {}) {
    await initialize();
    const queuedWrite = writeQueues.get(resource);
    if (queuedWrite) {
      await queuedWrite;
    }

    const filePath = resourcePath(resource);
    const contents = await readExistingFile(filePath);
    if (contents === null) {
      if (optional) {
        return null;
      }
      throw missingRequiredJsonError(filePath);
    }
    return parseJson(contents, filePath);
  }

  function writeResource(resource, value, { serializedValue } = {}) {
    const priorWrite = writeQueues.get(resource) ?? Promise.resolve();
    const currentWrite = priorWrite
      .catch(() => {})
      .then(async () => {
        await initialize();
        await writeJson({
          filePath: resourcePath(resource),
          value,
          serializedValue,
        });
      });
    writeQueues.set(resource, currentWrite);

    const clearQueue = () => {
      if (writeQueues.get(resource) === currentWrite) {
        writeQueues.delete(resource);
      }
    };
    currentWrite.then(clearQueue, clearQueue);
    return currentWrite;
  }

  async function verifyWritable() {
    await initialize();
    const verificationPath = path.join(
      dataDir,
      `.${process.pid}-${randomUUID()}.write-test`,
    );

    try {
      await writeAndSync(verificationPath, "");
    } catch (error) {
      throw new Error(`Data directory is not writable: ${dataDir}`, {
        cause: error,
      });
    } finally {
      await removeTemporaryFile(verificationPath);
    }
  }

  return Object.freeze({
    initialize,
    verifyWritable,
    readRecords: () => readResource("records"),
    writeRecords: (records) => writeResource("records", records),
    readGenreOptions: () => readResource("genreOptions"),
    writeGenreOptions: (genreOptions) =>
      writeResource("genreOptions", genreOptions),
    readDiscogsConfig: () =>
      readResource("discogsConfig", { optional: true }),
    writeDiscogsConfig: (discogsConfig, options) =>
      writeResource("discogsConfig", discogsConfig, options),
  });
}
