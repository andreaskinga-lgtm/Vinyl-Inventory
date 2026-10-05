import {
  createHash,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

export const ADMIN_SESSION_COOKIE_NAME = "vinyl_admin_session";
export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_COOLDOWN_MS = 30 * 1000;

const PASSWORD_DIGEST_BYTES = 32;
const SESSION_TOKEN_BYTES = 32;

function passwordDigest(password) {
  return createHash("sha256").update(password, "utf8").digest();
}

export function createPasswordVerifier(password) {
  const configured = password !== undefined;

  if (configured && typeof password !== "string") {
    throw new Error("Invalid ADMIN_PASSWORD: expected a string value");
  }

  if (configured && password.length < 10) {
    throw new Error(
      "Invalid ADMIN_PASSWORD: expected at least 10 characters",
    );
  }

  const expectedDigest = configured
    ? passwordDigest(password)
    : Buffer.alloc(PASSWORD_DIGEST_BYTES);

  return Object.freeze({
    configured,
    verify(candidate) {
      const candidateDigest = passwordDigest(
        typeof candidate === "string" ? candidate : "",
      );
      return (
        configured && timingSafeEqual(expectedDigest, candidateDigest)
      );
    },
  });
}

function sessionToken(randomBytes) {
  const value = randomBytes(SESSION_TOKEN_BYTES);

  if (typeof value === "string") {
    if (value.length === 0) {
      throw new Error("Session random source returned an empty token");
    }
    return value;
  }

  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new Error("Session random source must return bytes or a token");
  }

  return Buffer.from(value).toString("base64url");
}

export function createAuthService({
  credential,
  passwordVerifier,
  clock,
  now,
  randomBytes,
  random,
} = {}) {
  const verifier =
    credential ?? passwordVerifier ?? createPasswordVerifier(undefined);
  const readClock = clock ?? now ?? (() => Date.now());
  const readRandomBytes =
    randomBytes ?? random ?? nodeRandomBytes;
  const sessions = new Map();
  let failedLoginTimes = [];
  let cooldownUntil = 0;

  function currentTime() {
    const value = readClock();
    if (!Number.isFinite(value)) {
      throw new Error("Auth clock must return a finite number");
    }
    return value;
  }

  function purgeExpiredSessions(at) {
    for (const [token, session] of sessions) {
      if (at - session.lastActivity >= ADMIN_SESSION_IDLE_TIMEOUT_MS) {
        sessions.delete(token);
      }
    }
  }

  function createSession(at = currentTime()) {
    purgeExpiredSessions(at);
    let token;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      token = sessionToken(readRandomBytes);
      if (!sessions.has(token)) {
        sessions.set(token, { lastActivity: at });
        return token;
      }
    }

    throw new Error("Unable to create a unique administrator session");
  }

  function authenticateSession(token) {
    if (typeof token !== "string" || token.length === 0) {
      return false;
    }

    const current = currentTime();
    purgeExpiredSessions(current);
    const session = sessions.get(token);
    if (!session) {
      return false;
    }

    if (current - session.lastActivity >= ADMIN_SESSION_IDLE_TIMEOUT_MS) {
      sessions.delete(token);
      return false;
    }

    session.lastActivity = current;
    return true;
  }

  function revokeSession(token) {
    return sessions.delete(token);
  }

  function login(password) {
    const current = currentTime();
    purgeExpiredSessions(current);

    failedLoginTimes = failedLoginTimes.filter(
      (failedAt) => current - failedAt < LOGIN_FAILURE_WINDOW_MS,
    );

    if (!verifier.configured) {
      return { authenticated: false, reason: "unconfigured" };
    }

    if (current < cooldownUntil) {
      return {
        authenticated: false,
        reason: "cooldown",
        retryAfterMs: cooldownUntil - current,
      };
    }

    if (verifier.verify(password)) {
      failedLoginTimes = [];
      cooldownUntil = 0;
      return {
        authenticated: true,
        token: createSession(current),
      };
    }

    failedLoginTimes.push(current);
    if (failedLoginTimes.length >= LOGIN_FAILURE_LIMIT) {
      cooldownUntil = current + LOGIN_COOLDOWN_MS;
      return {
        authenticated: false,
        reason: "cooldown",
        retryAfterMs: LOGIN_COOLDOWN_MS,
      };
    }

    return { authenticated: false, reason: "invalid" };
  }

  return Object.freeze({
    configured: verifier.configured,
    login,
    authenticateSession,
    revokeSession,
  });
}

export function serializeSessionCookie(token, { secure = false } = {}) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Session cookie requires a token");
  }

  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function serializeClearedSessionCookie({ secure = false } = {}) {
  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
