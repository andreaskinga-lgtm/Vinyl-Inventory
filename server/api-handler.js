import querystring from "node:querystring";

import {
  ADMIN_SESSION_COOKIE_NAME,
  createAuthService,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "./auth.js";
import { createJsonStore } from "./json-store.js";
import {
  buildWifiQrPayload,
  normalizeWifiSettings,
  WifiSettingsValidationError,
} from "../src/utils/wifiPayload.js";

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

function cookieValue(req, name) {
  const header = req.headers?.cookie ?? req.headers?.Cookie ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function isSecureRequest(req) {
  return (
    req.secure === true ||
    req.protocol === "https" ||
    req.socket?.encrypted === true
  );
}

function requestOrigin(req) {
  const protocol = isSecureRequest(req) ? "https" : "http";
  const host = req.headers?.host ?? "localhost";
  return `${protocol}://${host}`;
}

function isSameOriginRequest(req) {
  const origin = req.headers?.origin ?? req.headers?.Origin;
  const referer = req.headers?.referer ?? req.headers?.Referer;
  const suppliedOrigin = origin || referer;

  if (!suppliedOrigin) {
    return false;
  }

  try {
    const actualOrigin = new URL(suppliedOrigin).origin;
    return actualOrigin === new URL(requestOrigin(req)).origin;
  } catch {
    return false;
  }
}

function requireAdminSession(
  req,
  res,
  sessionService,
  { stateChanging = false } = {},
) {
  const authenticated = sessionService.authenticateSession(
    cookieValue(req, ADMIN_SESSION_COOKIE_NAME),
  );
  if (!authenticated) {
    sendJson(res, 401, {
      error: "Administrator authentication required",
    });
    return false;
  }

  if (stateChanging && !isSameOriginRequest(req)) {
    sendJson(res, 403, { error: "Forbidden" });
    return false;
  }

  return true;
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

function visitorDisplayFromBody(body) {
  const section =
    isObject(body) && isObject(body.visitorDisplay)
      ? body.visitorDisplay
      : body;
  if (!isObject(section)) {
    throw new ApiRequestError("visitorDisplay must be an object");
  }

  const { idleTimeoutMinutes } = section;
  if (
    !Number.isInteger(idleTimeoutMinutes) ||
    idleTimeoutMinutes < 1 ||
    idleTimeoutMinutes > 30
  ) {
    throw new ApiRequestError(
      "visitorDisplay.idleTimeoutMinutes must be a whole number from 1 through 30",
    );
  }

  return { idleTimeoutMinutes };
}

function wifiFromBody(body) {
  const section =
    isObject(body) && isObject(body.wifi) ? body.wifi : body;
  try {
    const normalized = normalizeWifiSettings(section);
    return {
      security: normalized.security,
      ssid: normalized.ssid,
      password: normalized.password,
      hidden: normalized.hidden,
    };
  } catch (error) {
    if (error instanceof WifiSettingsValidationError) {
      throw new ApiRequestError(error.message);
    }
    throw error;
  }
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

function discogsCredentialForSaveBody(body) {
  if (
    !isObject(body) ||
    typeof body.username !== "string" ||
    typeof body.token !== "string"
  ) {
    throw new ApiRequestError(
      "username and token must be non-empty strings",
    );
  }

  const username = body.username.trim();
  const token = body.token.trim();
  if (!username) {
    throw new ApiRequestError(
      "username and token must be non-empty strings",
    );
  }
  return { username, token };
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

async function handleSiteSettings(req, res, store) {
  if (req.method === "GET") {
    sendJson(res, 200, await store.readSiteSettings());
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
}

async function handleVisitorDisplaySettings(req, res, store) {
  if (req.method !== "PUT") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "PUT" });
    return;
  }

  const visitorDisplay = visitorDisplayFromBody(await readJsonBody(req));
  await store.updateSiteSettings((settings) => ({
    ...settings,
    visitorDisplay,
  }));
  sendJson(res, 200, { ok: true });
}

async function handleWifiSettings(req, res, store) {
  if (req.method !== "PUT") {
    sendJson(
      res,
      405,
      { error: "Method not allowed" },
      { Allow: "PUT, DELETE" },
    );
    return;
  }

  const wifi = wifiFromBody(await readJsonBody(req));
  await store.updateSiteSettings((settings) => ({
    ...settings,
    wifi,
  }));
  sendJson(res, 200, { ok: true });
}

async function handleWifiSettingsDelete(req, res, store) {
  if (req.method !== "DELETE") {
    sendJson(res, 405, { error: "Method not allowed" }, { Allow: "DELETE" });
    return;
  }

  await store.updateSiteSettings((settings) => ({
    ...settings,
    wifi: null,
  }));
  sendJson(res, 200, { ok: true });
}

async function handleVisitorSettings(req, res, store) {
  if (req.method === "GET") {
    const settings = await store.readSiteSettings();
    const wifi = settings.wifi
      ? {
          ssid: settings.wifi.ssid,
          password: settings.wifi.password,
          security: settings.wifi.security,
          hidden: settings.wifi.hidden,
          qrPayload: buildWifiQrPayload(settings.wifi),
        }
      : null;
    sendJson(res, 200, {
      idleTimeoutMinutes: settings.visitorDisplay.idleTimeoutMinutes,
      wifi,
    });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
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
      username:
        credential?.source === "saved" ? credential.username : "",
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

    const submitted = discogsCredentialForSaveBody(
      await readJsonBody(req),
    );
    let credential = submitted;
    if (!submitted.token) {
      const savedCredential = await resolveDiscogsCredential(store, null);
      if (!savedCredential || savedCredential.source !== "saved") {
        throw new ApiRequestError(
          "username and token must be non-empty strings",
        );
      }
      credential = {
        username: submitted.username,
        token: savedCredential.token,
      };
    }
    await store.writeDiscogsConfig(credential);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "DELETE") {
    if (discogsCredentialFrom(discogsEnvironment)) {
      sendJson(res, 409, {
        error: "Discogs credentials are managed by the environment",
      });
      return;
    }

    await store.writeDiscogsConfig(null);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(
    res,
    405,
    { error: "Method not allowed" },
    { Allow: "GET, POST, DELETE" },
  );
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
    if (status === 401) {
      throw new DiscogsUpstreamError(
        "Discogs credentials were rejected by the upstream service",
      );
    }
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
  auth,
  authService,
  adminCredential,
}) {
  const store = createJsonStore({ dataDir });
  const sessionService =
    auth ??
    authService ??
    createAuthService({ credential: adminCredential });

  return async function apiHandler(req, res, next) {
    const pathname = requestPath(req);

    if (!pathname.startsWith("/api/") && pathname !== "/api.php") {
      next();
      return;
    }

    if (pathname === "/api/auth/session") {
      if (req.method !== "GET") {
        sendJson(
          res,
          405,
          { error: "Method not allowed" },
          { Allow: "GET" },
        );
        return;
      }

      sendJson(res, 200, {
        configured: sessionService.configured,
        authenticated: sessionService.authenticateSession(
          cookieValue(req, ADMIN_SESSION_COOKIE_NAME),
        ),
      });
      return;
    }

    if (pathname === "/api/auth/login") {
      if (req.method !== "POST") {
        sendJson(
          res,
          405,
          { error: "Method not allowed" },
          { Allow: "POST" },
        );
        return;
      }

      let password;
      try {
        const body = await readJsonBody(req);
        password = body?.password;
      } catch {
        password = undefined;
      }
      const result = sessionService.login(password);
      if (result.authenticated) {
        sendJson(
          res,
          200,
          { authenticated: true },
          {
            "Set-Cookie": serializeSessionCookie(result.token, {
              secure: isSecureRequest(req),
            }),
          },
        );
        return;
      }
      if (result.reason === "invalid") {
        sendJson(res, 401, {
          error: "Invalid administrator password",
        });
        return;
      }
      if (result.reason === "unconfigured") {
        sendJson(res, 409, {
          error: "Administrator access is not configured",
        });
        return;
      }
      if (result.reason === "cooldown") {
        const retryAfterMs = Math.max(0, result.retryAfterMs ?? 0);
        sendJson(
          res,
          429,
          {
            error: "Too many failed login attempts",
            retryAfterMs,
          },
          { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        );
        return;
      }
    }

    if (pathname === "/api/auth/logout") {
      if (req.method !== "POST") {
        sendJson(
          res,
          405,
          { error: "Method not allowed" },
          { Allow: "POST" },
        );
        return;
      }

      const token = cookieValue(req, ADMIN_SESSION_COOKIE_NAME);
      if (sessionService.authenticateSession(token)) {
        if (!isSameOriginRequest(req)) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        sessionService.revokeSession(token);
      }
      sendJson(
        res,
        200,
        { authenticated: false },
        {
          "Set-Cookie": serializeClearedSessionCookie({
            secure: isSecureRequest(req),
          }),
        },
      );
      return;
    }

    if (pathname === "/api/records") {
      if (
        req.method === "POST" &&
        !requireAdminSession(req, res, sessionService, {
          stateChanging: true,
        })
      ) {
        return;
      }
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
      if (
        req.method === "POST" &&
        !requireAdminSession(req, res, sessionService, {
          stateChanging: true,
        })
      ) {
        return;
      }
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

    if (pathname === "/api/site-settings") {
      if (
        req.method === "GET" &&
        !requireAdminSession(req, res, sessionService)
      ) {
        return;
      }
      try {
        await handleSiteSettings(req, res, store);
      } catch (error) {
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api/site-settings/visitor-display") {
      if (
        req.method === "PUT" &&
        !requireAdminSession(req, res, sessionService, {
          stateChanging: true,
        })
      ) {
        return;
      }
      try {
        await handleVisitorDisplaySettings(req, res, store);
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api/site-settings/wifi") {
      if (
        (req.method === "PUT" || req.method === "DELETE") &&
        !requireAdminSession(req, res, sessionService, {
          stateChanging: true,
        })
      ) {
        return;
      }
      try {
        if (req.method === "DELETE") {
          await handleWifiSettingsDelete(req, res, store);
        } else {
          await handleWifiSettings(req, res, store);
        }
      } catch (error) {
        if (error instanceof ApiRequestError) {
          sendJson(res, 400, { error: error.message });
          return;
        }
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api/visitor-settings") {
      try {
        await handleVisitorSettings(req, res, store);
      } catch (error) {
        sendJson(res, 500, { error: storageErrorMessage(error) });
      }
      return;
    }

    if (pathname === "/api/discogs-config") {
      if (
        (req.method === "GET" ||
          req.method === "POST" ||
          req.method === "DELETE") &&
        !requireAdminSession(req, res, sessionService, {
          stateChanging: req.method !== "GET",
        })
      ) {
        return;
      }
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
      if (
        pathname === "/api/discogs/collection" &&
        req.method === "GET" &&
        !requireAdminSession(req, res, sessionService)
      ) {
        return;
      }
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
