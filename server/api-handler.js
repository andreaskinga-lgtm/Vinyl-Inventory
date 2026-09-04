import { createJsonStore } from "./json-store.js";

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
});

class ApiRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...headers });
  res.end(JSON.stringify(payload));
}

function requestPath(req) {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolveOnce(body));
    req.on("error", rejectOnce);
  });
}

async function readJsonBody(req) {
  const body = await readRequestBody(req);

  try {
    return JSON.parse(body);
  } catch {
    throw new ApiRequestError("Malformed JSON body");
  }
}

function recordsFromBody(body) {
  if (!isObject(body) || !Array.isArray(body.records)) {
    throw new ApiRequestError("records must be an array");
  }

  return body.records;
}

function genreOptionsFromBody(body) {
  if (
    !isObject(body) ||
    !Array.isArray(body.genres) ||
    !Array.isArray(body.subGenres)
  ) {
    throw new ApiRequestError(
      "genres and subGenres must both be arrays",
    );
  }

  return {
    genres: body.genres,
    subGenres: body.subGenres,
  };
}

function assertStoredRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error("Invalid records data");
  }
}

function assertStoredGenreOptions(genreOptions) {
  if (
    !isObject(genreOptions) ||
    !Array.isArray(genreOptions.genres) ||
    !Array.isArray(genreOptions.subGenres)
  ) {
    throw new Error("Invalid genre options data");
  }
}

async function handleRecords(req, res, store) {
  if (req.method === "GET") {
    const records = await store.readRecords();
    assertStoredRecords(records);
    sendJson(res, 200, { records });
    return;
  }

  if (req.method === "POST") {
    const records = recordsFromBody(await readJsonBody(req));
    await store.writeRecords(records);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
}

async function handleGenreOptions(req, res, store) {
  if (req.method === "GET") {
    const genreOptions = await store.readGenreOptions();
    assertStoredGenreOptions(genreOptions);
    sendJson(res, 200, genreOptions);
    return;
  }

  if (req.method === "POST") {
    const genreOptions = genreOptionsFromBody(await readJsonBody(req));
    await store.writeGenreOptions(genreOptions);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
}

function storageErrorMessage(error) {
  return error instanceof Error ? error.message : "Storage failure";
}

export function createApiHandler({
  dataDir,
  fetch,
  discogsEnvironment = null,
}) {
  void fetch;
  void discogsEnvironment;

  const store = createJsonStore({ dataDir });

  return async function apiHandler(req, res, next) {
    const pathname = requestPath(req);

    if (!pathname.startsWith("/api/") && pathname !== "/api.php") {
      next();
      return;
    }

    if (pathname === "/api/records") {
      try {
        await handleRecords(req, res, store);
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api/genre-options") {
      try {
        await handleGenreOptions(req, res, store);
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  };
}
