import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  createAuthService,
  createPasswordVerifier,
  serializeSessionCookie,
} from "./auth.js";

function createClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance(milliseconds) {
      current += milliseconds;
    },
  };
}

function createRandomBytes(values) {
  const remaining = [...values];
  return (size) => {
    const next = remaining.shift();
    if (!next) {
      throw new Error(`No random value available for ${size} bytes`);
    }
    return next;
  };
}

describe("createAuthService", () => {
  it("creates opaque sessions, refreshes activity on authenticated lookup, and expires idle sessions at the boundary", () => {
    const clock = createClock();
    const randomBytes = createRandomBytes([
      Buffer.from("first-session-randomness"),
    ]);
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes,
    });

    const { token } = auth.login("correct horse battery staple");

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("correct horse battery staple");
    expect(auth.authenticateSession(token)).toBe(true);

    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS - 1);
    expect(auth.authenticateSession(token)).toBe(true);

    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS - 1);
    expect(auth.authenticateSession(token)).toBe(true);

    clock.advance(1);
    expect(auth.authenticateSession(token)).toBe(true);

    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS);
    expect(auth.authenticateSession(token)).toBe(false);
  });

  it("supports multiple sessions and explicit revocation without persistence", () => {
    const clock = createClock();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: createRandomBytes([
        Buffer.from("first-session-randomness"),
        Buffer.from("second-session-randomness"),
      ]),
    });

    const first = auth.login("correct horse battery staple").token;
    const second = auth.login("correct horse battery staple").token;

    expect(first).not.toBe(second);
    expect(auth.authenticateSession(first)).toBe(true);
    expect(auth.authenticateSession(second)).toBe(true);

    expect(auth.revokeSession(first)).toBe(true);
    expect(auth.authenticateSession(first)).toBe(false);
    expect(auth.authenticateSession(second)).toBe(true);

    const restarted = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: createRandomBytes([
        Buffer.from("restarted-session-randomness"),
      ]),
    });
    expect(restarted.authenticateSession(second)).toBe(false);
  });

  it("evicts expired sessions before creating a new session", () => {
    const clock = createClock();
    const tokenBytes = Buffer.from("reusable-session-randomness");
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: createRandomBytes([tokenBytes, tokenBytes]),
    });

    const first = auth.login("correct horse battery staple");
    expect(first.authenticated).toBe(true);

    clock.advance(ADMIN_SESSION_IDLE_TIMEOUT_MS);

    const second = auth.login("correct horse battery staple");
    expect(second.authenticated).toBe(true);
    expect(second.token).toBe(first.token);
  });

  it("recovers after the fifth failed login starts a 30-second cooldown", () => {
    const clock = createClock();
    const auth = createAuthService({
      credential: createPasswordVerifier("correct horse battery staple"),
      clock: clock.now,
      randomBytes: createRandomBytes([Buffer.from("session-randomness")]),
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(auth.login("wrong password").reason).toBe("invalid");
    }
    expect(auth.login("wrong password").reason).toBe("cooldown");
    expect(auth.login("correct horse battery staple").reason).toBe("cooldown");

    clock.advance(30_000);
    expect(auth.login("correct horse battery staple").authenticated).toBe(true);
  });

  it("uses browser-session cookie attributes without persistent expiry", () => {
    const cookie = serializeSessionCookie("opaque-token", { secure: false });
    const secureCookie = serializeSessionCookie("opaque-token", {
      secure: true,
    });

    expect(cookie).toBe(
      `${ADMIN_SESSION_COOKIE_NAME}=opaque-token; HttpOnly; SameSite=Strict; Path=/`,
    );
    expect(secureCookie).toContain("; Secure");
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });
});
