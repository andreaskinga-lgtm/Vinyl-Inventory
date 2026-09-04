Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-sol
Blocked by: 16, 17, 18

# Implement the server-side Discogs credential boundary

## Goal

Move Discogs configuration and proxy routes into the shared handler while making the server the
only holder and selector of Discogs tokens.

Before editing, read **Discogs credential contract** in
[`Always-on LAN hosting`](../spec.md) and the full answer in
[`Discogs credentials on a guest-accessible LAN`](04-discogs-credentials.md). Inspect all
current Discogs branches in `vite.config.js`. Keep this as one Sol ticket: credential precedence,
redaction, saved configuration, and proxy authorization form one security boundary.

## Steps

1. Resolve one effective Discogs Credential per request from the handler's injected
   `discogsEnvironment` first, otherwise a complete saved pair, otherwise none. The handler never
   reads `process.env`.
2. Implement `GET/POST /api/discogs-config` with the exact redacted response and `409`
   environment-managed behavior in the spec.
3. Migrate collection, search, and release proxy routes to the shared handler.
4. Build Discogs authorization only on the server. Reject browser token parameters rather than
   honoring them.
5. Return `401` when credentials are required, preserve meaningful upstream status, and ensure
   errors never include tokens or authorization headers.

## Completion criteria

- A table-driven suite covers environment, saved, absent, malformed, and partial credentials.
- Response-body, error-body, request-URL, and captured-log assertions prove a sentinel token never
  leaves the server.
- POST under environment credentials leaves the saved file byte-for-byte unchanged.
- Proxy tests assert encoded paths/query parameters and authorization headers using injected
  fetch only.
- Existing saved credential files remain readable without automatic rewrite.
- Targeted tests and `npm run lint` pass.
