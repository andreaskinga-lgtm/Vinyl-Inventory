Status: resolved
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 16, 17

# Build the handler shell and migrate records and genres

## Goal

Create the shared middleware seam and move the two local JSON APIs into it without changing their
browser contract.

Before editing, read **Runtime architecture** in
[`Always-on LAN hosting`](../spec.md) and the full answer in
[`Where the dev/prod seam sits in the API layer`](01-handler-seam.md).

## Files

- Add `server/api-handler.js`.
- Add `server/api-handler.test.js`.
- Leave `vite.config.js` using its old plugins until **Replace the five Vite API plugins with one
  adapter**.

## Steps

1. Export `createApiHandler({ dataDir, fetch, discogsEnvironment = null })`, returning
   `(req, res, next)`. Preserve the injected credential slot even though this ticket does not use
   it yet.
2. Add route matching and shared JSON-body/JSON-response helpers without Express request
   extensions.
3. Implement `GET/POST /api/records` and `GET/POST /api/genre-options` through
   `createJsonStore({ dataDir })`.
4. Preserve the current successful payload shapes. Reject malformed JSON, invalid top-level
   shapes, and unsupported methods with explicit JSON 4xx responses.
5. Call `next()` only for paths outside `/api/*` and `/api.php`; unknown owned API paths return a
   JSON `404`.

## Completion criteria

- Direct middleware tests use lightweight fake Node request/response objects and a temporary data
  directory.
- Every route has success, malformed-body, invalid-shape, unsupported-method, and storage-failure
  coverage.
- Tests prove an unrelated path calls `next()` exactly once and an unknown API path does not.
- Existing Vite behavior still works because this ticket does not remove its adapters.
- Targeted tests and `npm run lint` pass.
