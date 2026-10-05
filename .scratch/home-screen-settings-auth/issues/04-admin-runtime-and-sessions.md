Status: resolved
Kind: implementation
Blocked by: 02, 03

# Add administrator runtime configuration and in-memory sessions

## Goal

Create the server-side authentication primitive without changing endpoint authorization yet.

Read **Administrator threat model** in
[`Home Screen, visitor Wi-Fi handoff, Settings, and administrator security`](../spec.md).

## Files

- Update `server/config.js` and `server/config.test.js`.
- Add a focused server authentication/session module and tests.
- Update `.env.example`, `compose.yaml`, and server adapter dependency wiring as needed.

## Steps

1. Parse optional `ADMIN_PASSWORD` exactly as supplied and reject configured values shorter than
   10 characters. Return only a verifier/credential boundary that cannot be serialized into a
   public response or accidentally logged.
2. Keep server startup successful when the password is absent; represent administrator access as
   unconfigured.
3. Implement timing-safe password verification using a fixed-length digest.
4. Implement opaque random in-memory sessions with an injected clock/random source for tests.
5. Expire sessions after 30 minutes without a successfully authenticated server request.
6. Support multiple sessions, explicit revocation, process-local restart semantics, and a
   server-wide failed-login window: five failures in five minutes trigger a 30-second cooldown.
7. Define the browser-session cookie attributes: `HttpOnly`, `SameSite=Strict`, `Path=/`, no
   persistent expiry, and `Secure` only when served over HTTPS.

## Completion criteria

- Tests cover absent/valid/too-short passwords without exposing password values.
- Tests cover session creation, lookup/activity reset, idle expiry boundaries, revocation,
  multiple sessions, and cooldown recovery with no real-time sleeps.
- No built-in development password or persisted session file exists.
- Targeted tests and `npm run lint` pass.

## Comments

- **Implementation:** Added exact, optional `ADMIN_PASSWORD` configuration behind a frozen
  verifier boundary, rejecting non-empty values shorter than 10 characters while treating the
  empty Compose default as unconfigured. Added an in-memory auth service with fixed-length
  SHA-256/timing-safe verification, opaque random sessions, injected clock/random sources,
  30-minute idle expiry, revocation, process-local restart semantics, and server-wide
  five-failure/30-second cooldown handling. Added browser-session cookie serializers with the
  required `HttpOnly`, `SameSite=Strict`, `Path=/`, and conditional `Secure` attributes.
- **Deployment wiring:** Added `ADMIN_PASSWORD` to `.env.example` and `compose.yaml`; no
  password or session state is persisted.
- **Validation:** `npx vitest run server/config.test.js server/auth.test.js` (34 passed),
  `npm test` (169 Vitest tests and 5 backup tests passed), `npm run lint`, `npm run build`, and
  `git diff --check` passed.
