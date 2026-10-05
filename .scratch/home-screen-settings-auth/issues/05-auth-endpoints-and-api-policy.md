Status: resolved
Kind: implementation
Blocked by: none

# Add authentication endpoints and enforce the API authorization policy

## Goal

Expose sign-in/session/sign-out contracts and make server authorization, not UI visibility, the
source of truth for administrative operations.

Read **Authentication endpoints** and **Authorization policy** in
[`the feature spec`](../spec.md).

## Files

- Update `server/api-handler.js` and `server/api-handler.test.js`.
- Update `server/app.js`, `vite.config.js`, and their tests only as required to inject the shared
  session service and request security context.

## Steps

1. Add `GET /api/auth/session`, `POST /api/auth/login`, and `POST /api/auth/logout`.
2. Return a clear unconfigured response when `ADMIN_PASSWORD` is absent without taking public
   reads offline.
3. Set and clear the opaque session cookie according to the runtime/session contract.
4. Require a valid Admin Session for records/genre mutations, Discogs credential operations, and
   Discogs proxy requests.
5. Keep records, genre options, health, and the later visitor projection public for GET.
6. Reject authenticated state-changing cross-origin requests; same-origin browser requests and
   non-browser tests must have explicit, testable rules.
7. Standardize JSON `401`, `403`, `409`, and cooldown responses so the client can distinguish
   sign-in, authorization, and resource-state failures.

## Completion criteria

- Middleware tests cover configured/unconfigured login, wrong password, cooldown, cookie
  attributes, session status, logout, expiry, and same-origin enforcement.
- Every existing protected endpoint has unauthenticated rejection coverage and authenticated
  success regression coverage.
- Public collection reads remain unchanged.
- Vite and Express use the same authentication/session instance per running server.
- Targeted tests and `npm run lint` pass.

## Comments

- **Implementation:** Added shared login/session/logout API contracts with opaque browser-session
  cookies, HTTPS-only `Secure`, revocation, idle expiry, failed-login cooldown responses, and
  configured/unconfigured administrator handling. Protected record, genre, Discogs credential,
  and Discogs proxy operations behind the injected in-memory Admin Session; public collection
  reads remain available. Authenticated state-changing requests enforce matching `Origin` or
  `Referer` metadata while origin-less non-browser requests remain explicitly supported.
- **Adapter wiring:** Express and Vite each create one runtime authentication service and inject
  it into the shared API handler; Express also accepts an injected service for integration tests.
- **Validation:** `npx vitest run server/api-handler.test.js server/app.test.js server/auth.test.js`
  (97 passed), `npm test` (209 Vitest tests and 5 backup tests passed), `npm run lint`,
  `npm run build`, and `git diff --check` passed.
