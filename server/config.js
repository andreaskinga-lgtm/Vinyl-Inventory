import path from "node:path";

const DEFAULT_PORT = 8080;
const DEFAULT_DATA_DIR = "data";
const DEFAULT_NODE_ENV = "development";
const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

function readEnvironmentValue(env, name) {
  const value = env[name];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid ${name}: expected a string value`);
  }

  return value;
}

function readPort(env) {
  const value = readEnvironmentValue(env, "PORT");

  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid PORT: expected an integer from 1 through 65535");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid PORT: expected an integer from 1 through 65535");
  }

  return port;
}

function readDataDirectory(env, cwd) {
  const value = readEnvironmentValue(env, "DATA_DIR") ?? DEFAULT_DATA_DIR;

  if (value.length === 0) {
    throw new Error("Invalid DATA_DIR: expected a non-empty path");
  }

  return path.resolve(cwd, value);
}

function readNodeEnvironment(env) {
  const value = readEnvironmentValue(env, "NODE_ENV") ?? DEFAULT_NODE_ENV;

  if (!VALID_NODE_ENVS.has(value)) {
    throw new Error(
      "Invalid NODE_ENV: expected development, test, or production",
    );
  }

  return value;
}

function readDiscogsEnvironment(env) {
  const username = readEnvironmentValue(env, "DISCOGS_USER")?.trim() ?? "";
  const token = readEnvironmentValue(env, "DISCOGS_TOKEN")?.trim() ?? "";

  if (!username && !token) {
    return null;
  }

  if (!username) {
    throw new Error(
      "Invalid DISCOGS_USER: expected a complete credential pair with DISCOGS_TOKEN",
    );
  }

  if (!token) {
    throw new Error(
      "Invalid DISCOGS_TOKEN: expected a complete credential pair with DISCOGS_USER",
    );
  }

  return Object.freeze({ username, token });
}

export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  return Object.freeze({
    port: readPort(env),
    dataDir: readDataDirectory(env, cwd),
    nodeEnv: readNodeEnvironment(env),
    discogsEnvironment: readDiscogsEnvironment(env),
  });
}
