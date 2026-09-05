import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApiHandler } from "./api-handler.js";

const SERVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST_DIRECTORY = path.resolve(SERVER_DIRECTORY, "../dist");
const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "no-cache";

function relativeDistPath(distDirectory, filePath) {
  return path.relative(distDirectory, filePath).split(path.sep).join("/");
}

function isMetadataPath(relativePath) {
  return (
    relativePath === "index.html" ||
    relativePath === "sw.js" ||
    relativePath === "registerSW.js" ||
    relativePath === "manifest.webmanifest" ||
    /^workbox-.*\.js$/.test(relativePath) ||
    /^precache-manifest\..*\.js$/.test(relativePath)
  );
}

function setStaticCacheHeaders(distDirectory) {
  return (res, filePath) => {
    const relativePath = relativeDistPath(distDirectory, filePath);

    if (relativePath.startsWith("assets/")) {
      res.setHeader("Cache-Control", IMMUTABLE_CACHE_CONTROL);
      return;
    }

    if (isMetadataPath(relativePath)) {
      res.setHeader("Cache-Control", REVALIDATE_CACHE_CONTROL);
    }
  };
}

function isApiPath(pathname) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/api.php" ||
    pathname.startsWith("/api.php/")
  );
}

function isNavigationRequest(req, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const accept = req.headers.accept ?? "";
  const acceptsHtml =
    accept.includes("text/html") || accept.includes("application/xhtml+xml");
  return acceptsHtml && path.posix.extname(pathname) === "";
}

function requestPath(req) {
  return new URL(req.originalUrl ?? req.url ?? "/", "http://localhost")
    .pathname;
}

function sendJsonError(res, status, error) {
  res.status(status).json({ error });
}

export function createApp({ config, fetch: fetchImpl = globalThis.fetch }) {
  const distDirectory = config.distDir ?? DEFAULT_DIST_DIRECTORY;
  const app = express();

  app.use(
    createApiHandler({
      dataDir: config.dataDir,
      fetch: fetchImpl,
      discogsEnvironment: config.discogsEnvironment,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    express.static(distDirectory, {
      etag: true,
      setHeaders: setStaticCacheHeaders(distDirectory),
    }),
  );

  app.use((req, res, next) => {
    const pathname = requestPath(req);

    if (isApiPath(pathname)) {
      sendJsonError(res, 404, "Not found");
      return;
    }

    if (!isNavigationRequest(req, pathname)) {
      next();
      return;
    }

    res.setHeader("Cache-Control", REVALIDATE_CACHE_CONTROL);
    res.sendFile(path.join(distDirectory, "index.html"), (error) => {
      if (error) {
        next(error);
      }
    });
  });

  app.use((_req, res) => {
    sendJsonError(res, 404, "Not found");
  });

  app.use((error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    sendJsonError(res, 500, "Internal server error");
  });

  return app;
}
