Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 19, 20

# Replace the five Vite API plugins with one adapter

## Goal

Make development execute the completed shared API handler and delete the duplicate endpoint
implementations from `vite.config.js`.

Before editing, read **Runtime architecture** in
[`Always-on LAN hosting`](../spec.md). All API behavior must already exist in
`server/api-handler.js`; this ticket is wiring and deletion, not another migration.

## Steps

1. Replace the five endpoint-specific plugin factories with one `apiPlugin`.
2. In `configureServer`, load development configuration once and mount the exact middleware
   returned by
   `createApiHandler({ dataDir, fetch, discogsEnvironment: config.discogsEnvironment })`.
3. Preserve the remaining React and PWA Vite configuration.
4. Delete endpoint parsing, file access, credential, and upstream-fetch code from
   `vite.config.js`.

## Completion criteria

- `vite.config.js` contains one `configureServer` API mount and no API route string other than
  adapter-level configuration.
- Starting Vite with a temporary `DATA_DIR` serves records, genre, iTunes, and Discogs config
  through the shared handler; an unconfigured Discogs proxy request returns the handler's `401`
  configuration-required JSON through the Vite mount without reaching the network.
- Handler tests remain the only source of route behavior; no adapter-level duplicate logic or
  test fixtures are introduced.
- `npm run lint`, `npm test`, and `npm run build` pass.
