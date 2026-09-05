import querystring from "node:querystring";

import { createJsonStore } from "./json-store.js";

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json",
});
const ITUNES_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
});
const ITUNES_FETCH_OPTIONS = Object.freeze({
  headers: Object.freeze({
    Accept: "application/json",
  }),
});
const DISCOGS_ACCEPT = "application/vnd.discogs.v2.discogs+json";

class ApiRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiRequestError";
  }
}

class ItunesUpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = "ItunesUpstreamError";
  }
}

class DiscogsUpstreamError extends Error {
  constructor(message = "Discogs request failed") {
    super(message);
    this.name = "DiscogsUpstreamError";
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

function discogsCredentialFrom(value) {
  if (
    !isObject(value) ||
    typeof value.username !== "string" ||
    typeof value.token !== "string"
  ) {
    return null;
  }

  const username = value.username.trim();
  const token = value.token.trim();
  return username && token ? { username, token } : null;
}

function discogsCredentialFromBody(body) {
  const credential = discogsCredentialFrom(body);
  if (!credential) {
    throw new ApiRequestError(
      "username and token must be non-empty strings",
    );
  }
  return credential;
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

function isMalformedStoredJson(error) {
  return error instanceof Error && error.cause instanceof SyntaxError;
}

async function resolveDiscogsCredential(store, discogsEnvironment) {
  const environmentCredential = discogsCredentialFrom(discogsEnvironment);
  if (environmentCredential) {
    return { ...environmentCredential, source: "environment" };
  }

  let savedConfig;
  try {
    savedConfig = await store.readDiscogsConfig();
  } catch (error) {
    if (!isMalformedStoredJson(error)) {
      throw error;
    }
    return null;
  }

  const savedCredential = discogsCredentialFrom(savedConfig);
  return savedCredential
    ? { ...savedCredential, source: "saved" }
    : null;
}

async function handleDiscogsConfig(
  req,
  res,
  store,
  discogsEnvironment,
) {
  if (req.method === "GET") {
    const credential = await resolveDiscogsCredential(
      store,
      discogsEnvironment,
    );
    sendJson(res, 200, {
      username: credential?.username ?? "",
      hasToken: credential !== null,
      source: credential?.source ?? "none",
      canEdit: credential?.source !== "environment",
    });
    return;
  }

  if (req.method === "POST") {
    if (discogsCredentialFrom(discogsEnvironment)) {
      sendJson(res, 409, {
        error: "Discogs credentials are managed by the environment",
      });
      return;
    }

    const credential = discogsCredentialFromBody(await readJsonBody(req));
    await store.writeDiscogsConfig(credential);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
}

function discogsHeaders(token) {
  return {
    Authorization: `Discogs token=${token}`,
    "User-Agent": "VinylInventory/1.0",
    Accept: DISCOGS_ACCEPT,
  };
}

function discogsReleaseId(url) {
  const id = url.searchParams.get("id") ?? "";
  if (!id) {
    throw new ApiRequestError("id is required");
  }
  return id;
}

function discogsPagination(searchParams) {
  const readPositiveInteger = (name, defaultValue) => {
    const value = searchParams.get(name);
    if (value === null) {
      return defaultValue;
    }
    if (!/^[1-9]\d*$/.test(value)) {
      throw new ApiRequestError(
        "page and per_page must be positive integers",
      );
    }

    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new ApiRequestError(
        "page and per_page must be positive integers",
      );
    }
    return number;
  };

  return {
    page: readPositiveInteger("page", 1),
    perPage: Math.min(readPositiveInteger("per_page", 100), 100),
  };
}

function discogsUrl(pathname, url, credential, releaseId) {
  if (pathname === "/api/discogs/collection") {
    const { page, perPage } = discogsPagination(url.searchParams);
    return (
      `https://api.discogs.com/users/${encodeURIComponent(credential.username)}` +
      `/collection/folders/0/releases?page=${page}&per_page=${perPage}`
    );
  }

  if (pathname === "/api/discogs/search") {
    const params = new URLSearchParams({
      artist: url.searchParams.get("artist") ?? "",
      release_title: url.searchParams.get("title") ?? "",
      type: "release",
      per_page: "5",
    });
    return `https://api.discogs.com/database/search?${params}`;
  }

  return `https://api.discogs.com/releases/${encodeURIComponent(releaseId)}`;
}

function redactDiscogsToken(value, token) {
  if (typeof value === "string") {
    return value.split(token).join("[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiscogsToken(item, token));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactDiscogsToken(key, token),
        redactDiscogsToken(item, token),
      ]),
    );
  }
  return value;
}

async function handleDiscogsProxy(
  req,
  res,
  store,
  fetchImpl,
  discogsEnvironment,
  pathname,
) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  if (requestUrl.searchParams.has("token")) {
    throw new ApiRequestError(
      "Discogs token parameters are not accepted",
    );
  }
  const releaseId =
    pathname === "/api/discogs/release"
      ? discogsReleaseId(requestUrl)
      : null;

  const credential = await resolveDiscogsCredential(
    store,
    discogsEnvironment,
  );
  if (!credential) {
    sendJson(res, 401, { error: "Discogs credentials are required" });
    return;
  }

  const url = discogsUrl(
    pathname,
    requestUrl,
    credential,
    releaseId,
  );
  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(url, {
      headers: discogsHeaders(credential.token),
    });
  } catch {
    throw new DiscogsUpstreamError();
  }

  const status = Number(upstreamResponse?.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new DiscogsUpstreamError();
  }

  const ok = upstreamResponse?.ok ?? (status >= 200 && status < 300);
  if (!ok) {
    sendJson(res, status, {
      error: `Discogs request failed with status ${status}`,
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await upstreamResponse.text());
  } catch {
    throw new DiscogsUpstreamError("Invalid JSON from Discogs");
  }
  sendJson(
    res,
    status,
    redactDiscogsToken(payload, credential.token),
  );
}

function storageErrorMessage(error) {
  return error instanceof Error ? error.message : "Storage failure";
}

function itunesErrorMessage(error) {
  return error instanceof Error ? error.message : "iTunes request failed";
}

function itunesUrl({ query, entity, country }) {
  const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
  if (entity === "id" || entity === "idAlbum") {
    return (
      "https://itunes.apple.com/lookup?id=" +
      encodedQuery +
      "&country=" +
      country +
      "&limit=25"
    );
  }

  return (
    "https://itunes.apple.com/search?term=" +
    encodedQuery +
    "&country=" +
    country +
    "&entity=" +
    entity +
    "&limit=25"
  );
}

async function fetchAndValidateItunesResponse(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, ITUNES_FETCH_OPTIONS);
  } catch (error) {
    throw new ItunesUpstreamError(
      `iTunes request failed: ${itunesErrorMessage(error)}`,
    );
  }

  const status = Number(response?.status);
  const ok =
    response?.ok ?? (Number.isInteger(status) && status >= 200 && status < 300);
  if (!ok) {
    throw new ItunesUpstreamError(
      `iTunes request failed with status ${Number.isInteger(status) ? status : "unknown"}`,
    );
  }

  try {
    const payload = await response.json();
    if (!isObject(payload)) {
      throw new SyntaxError("iTunes response must be an object");
    }
  } catch {
    throw new ItunesUpstreamError("Invalid JSON from iTunes");
  }
}

function processItunesResults(post) {
  let json;
  try {
    json = JSON.parse(typeof post.json === "string" ? post.json : "");
  } catch {
    throw new ApiRequestError("bad json");
  }

  if (!isObject(json)) {
    throw new ApiRequestError("bad json");
  }

  const entity =
    typeof post.entity === "string" && post.entity
      ? post.entity
      : "tvSeason";
  const output = [];

  for (const result of Array.isArray(json.results) ? json.results : []) {
    if (!isObject(result)) continue;

    if (
      post.entity === "id" &&
      result.kind !== "feature-movie" &&
      result.wrapperType !== "collection"
    ) {
      continue;
    }
    if (post.entity === "idAlbum" && result.collectionType !== "Album") {
      continue;
    }

    const data = {};
    data.url = (result.artworkUrl100 || "").replace("100x100", "600x600");

    let hires = (result.artworkUrl100 || "").replace(
      "100x100bb",
      "100000x100000-999",
    );
    try {
      const parsed = new URL(hires);
      hires = "https://is5-ssl.mzstatic.com" + parsed.pathname;
    } catch {
      // Keep the original artwork URL when it is not an absolute URL.
    }
    data.hires = hires;
    data.title =
      entity === "movie" ? result.trackName : result.collectionName;

    if (post.entity === "album") {
      const parts = hires.split("/image/thumb/");
      if (parts.length === 2) {
        const segs = parts[1].split("/");
        segs.pop();
        data.uncompressed =
          "https://a5.mzstatic.com/us/r1000/0/" + segs.join("/");
      }
    }

    switch (entity) {
      case "album":
        data.title =
          result.collectionName + " (by " + result.artistName + ")";
        break;
    }

    if (data.title) {
      data.artworkUrl100 = result.artworkUrl100;
      data.collectionName = result.collectionName;
      data.artistName = result.artistName;
      output.push(data);
    }
  }

  return output;
}

async function handleItunes(req, res, fetchImpl) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(
      res,
      405,
      { error: "Method not allowed" },
      { ...ITUNES_HEADERS, Allow: "GET, POST" },
    );
    return true;
  }

  if (req.method === "GET") {
    const params = Object.fromEntries(
      new URL(req.url ?? "/", "http://localhost").searchParams,
    );
    if (params.type !== "request") {
      return false;
    }

    if (!params.query) {
      throw new ApiRequestError("missing query");
    }

    const url = itunesUrl({
      query: params.query,
      entity: params.entity,
      country: params.country,
    });
    // Validate the upstream response while preserving the legacy URL payload;
    // the browser uses that URL for its JSONP request before POST processing.
    await fetchAndValidateItunesResponse(url, fetchImpl);
    sendJson(res, 200, { url }, ITUNES_HEADERS);
    return true;
  }

  const post = querystring.parse(await readRequestBody(req));
  if (post.type !== "data") {
    return false;
  }

  sendJson(res, 200, processItunesResults(post), ITUNES_HEADERS);
  return true;
}

export function createApiHandler({
  dataDir,
  fetch: fetchImpl = globalThis.fetch,
  discogsEnvironment = null,
}) {
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

    if (pathname === "/api/discogs-config") {
      try {
        await handleDiscogsConfig(
          req,
          res,
          store,
          discogsEnvironment,
        );
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (
      pathname === "/api/discogs/collection" ||
      pathname === "/api/discogs/search" ||
      pathname === "/api/discogs/release"
    ) {
      try {
        await handleDiscogsProxy(
          req,
          res,
          store,
          fetchImpl,
          discogsEnvironment,
          pathname,
        );
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        if (error instanceof DiscogsUpstreamError) {
          sendJson(res, 502, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api.php") {
      try {
        const handled = await handleItunes(req, res, fetchImpl);
        if (!handled) {
          sendJson(res, 404, { error: "Not found" }, ITUNES_HEADERS);
        }
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message }, ITUNES_HEADERS);
          return;
        }
        if (error instanceof ItunesUpstreamError) {
          sendJson(res, 502, { error: error.message }, ITUNES_HEADERS);
          return;
        }
        sendJson(res, 500, { error: itunesErrorMessage(error) }, ITUNES_HEADERS);
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  };
}
