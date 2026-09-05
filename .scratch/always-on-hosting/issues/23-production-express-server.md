Status: resolved
Kind: implementation
Model: gpt-5.6-luna
Blocked by:

# Add the production Express server

## Goal

Serve health, the shared API, Vite build output, cache headers, and SPA navigation from one
production Node process.

Before editing, read **Runtime architecture** and **Production web serving and PWA behavior** in
[`Always-on LAN hosting`](../spec.md).

## Files

- Add `server/app.js` exporting `createApp({ config, fetch })`.
- Add `server/index.js` as the process entry point.
- Add focused server tests and add `express` to `dependencies`, not `devDependencies`.
- Add an `npm start` script that runs `node server/index.js`.

## Middleware order

1. Shared API handler.
2. `GET /health`.
3. Static `dist/` assets with path-specific cache headers.
4. Non-API navigation fallback to `dist/index.html`.
5. Explicit JSON 404/error handling where applicable.

`createApp({ config, fetch })` passes `config.dataDir` and
`config.discogsEnvironment` into `createApiHandler`; neither the app nor handler rereads the
environment.

## Completion criteria

- Startup verifies configuration and storage before listening and exits non-zero with a precise
  error on failure.
- `/health` exposes no collection or configuration data.
- Tests prove immutable headers for hashed assets and revalidation for every metadata path named
  in the spec.
- Tests prove unknown API routes never receive HTML and valid client-side navigation does.
- A built app is usable through `npm start` with Vite stopped.
- Targeted tests, `npm run lint`, and `npm run build` pass.
