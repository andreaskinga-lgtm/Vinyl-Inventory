Status: resolved
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 18

# Move the iTunes proxy into the shared handler

## Goal

Move only `/api.php` from `itunesApiPlugin` into `createApiHandler`, preserving its current
browser-facing search contract.

Before editing, inspect both `/api.php` branches in `vite.config.js`; they are the behavioral
source of truth. Read **Runtime architecture** in
[`Always-on LAN hosting`](../spec.md) for the target seam.

## Steps

1. Reproduce the current GET and POST input normalization inside `server/api-handler.js`.
2. Build the upstream iTunes request from validated fields and the injected `fetch`.
3. Preserve successful response shape and content type.
4. Return explicit JSON errors for malformed input, unsupported methods, upstream non-success,
   invalid upstream JSON, and network failure.
5. Keep all route logic in the shared handler; do not edit the Vite plugin yet.

## Completion criteria

- Tests assert the exact injected-fetch URL and options for representative GET and POST requests.
- Tests cover missing search terms, malformed JSON, unsupported methods, upstream 4xx/5xx,
  invalid JSON, and thrown network errors.
- No test reaches the network.
- The existing Vite development path remains operational until the adapter ticket removes it.
- Targeted tests and `npm run lint` pass.
