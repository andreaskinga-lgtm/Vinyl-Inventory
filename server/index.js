import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createJsonStore } from "./json-store.js";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function startServer({ config, fetch = globalThis.fetch } = {}) {
  const resolvedConfig = config ?? loadConfig();
  const store = createJsonStore({ dataDir: resolvedConfig.dataDir });
  await store.initialize();
  await store.verifyWritable();

  const app = createApp({ config: resolvedConfig, fetch });
  const server = app.listen(resolvedConfig.port);

  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  } catch (error) {
    server.close();
    throw error;
  }

  return server;
}

export async function main() {
  try {
    const server = await startServer();
    const address = server.address();
    const port =
      typeof address === "object" && address !== null
        ? address.port
        : "unknown";
    console.log(`Vinyl Inventory listening on port ${port}`);
    return server;
  } catch (error) {
    console.error(`Vinyl Inventory startup failed: ${errorMessage(error)}`);
    process.exitCode = 1;
    return null;
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint &&
  path.resolve(entryPoint) === fileURLToPath(import.meta.url)
) {
  await main();
}
