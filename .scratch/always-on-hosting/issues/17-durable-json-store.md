Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-sol
Blocked by:

# Implement power-loss-safe JSON storage

## Goal

Implement first-run initialization and the atomic current-plus-backup write invariant for every
persisted JSON resource.

Before editing, read **Persisted data** in
[`Always-on LAN hosting`](../spec.md) and the full answer in
[`Data directory: seeding, atomic writes, backup and restore`](03-data-directory.md).
Keep this as one Sol ticket: splitting initialization, backup replacement, and atomic replacement
would let separate implementations violate their shared crash-safety invariant.

## Files

- Add `server/json-store.js`.
- Add `server/json-store.test.js`.
- Reuse `src/data/genreOptions.js` as the only genre-default source.
- Use the Node/Vitest ESLint configuration established by
  **Implement the runtime configuration module**; do not edit `eslint.config.js` in this ticket.

## Required interface

Export `createJsonStore({ dataDir })`. Its returned object must initialize the directory and
provide read/write operations for `records.json`, `genreOptions.json`, and optional
`discogsConfig.json`; callers never construct file paths themselves. Keep the atomic write
primitive separately exportable for fault-injection tests.

## Completion criteria

- First run creates `records.json` as `[]` and `genreOptions.json` from the shipped defaults, but
  does not create `discogsConfig.json`.
- Each successful replacement writes and syncs a unique sibling temporary file, atomically
  replaces the single `.bak` with the prior valid primary, atomically replaces the primary, and
  syncs the directory.
- Invalid existing required JSON fails explicitly and points to the available `.bak`; startup
  never silently restores or accepts a temporary file.
- Tests inject failures before backup replacement, before primary replacement, and after primary
  replacement. Every case asserts exactly which valid primary and backup remain.
- Parallel writes to one resource are serialized so older requests cannot overwrite newer ones.
- Tests use temporary directories and verify cleanup.
- `npm test -- server/json-store.test.js` and `npm run lint` pass.
