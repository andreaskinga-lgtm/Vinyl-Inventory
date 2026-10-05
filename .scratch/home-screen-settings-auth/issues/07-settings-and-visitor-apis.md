Status: resolved
Kind: implementation
Blocked by: none

# Implement Site Settings and public visitor APIs

## Goal

Expose authenticated section-specific Settings operations and the deliberately narrow public
visitor projection.

Read **Site Settings endpoints**, **Public visitor projection**, and **Discogs** in
[`the feature spec`](../spec.md).

## Files

- Update `server/api-handler.js` and `server/api-handler.test.js`.
- Update `server/json-store.js` only through the seam established by issue 06.

## Steps

1. Add authenticated `GET /api/site-settings`.
2. Add authenticated `PUT /api/site-settings/visitor-display`.
3. Add authenticated `PUT` and `DELETE /api/site-settings/wifi`.
4. Add public `GET /api/visitor-settings` returning only timeout and Wi-Fi handoff data.
5. Generate the public `qrPayload` server-side from validated stored settings; never serialize
   the full settings document as a shortcut.
6. Add authenticated `DELETE /api/discogs-config`.
7. Allow blank token on an authenticated Discogs save only when preserving an existing saved
   token; continue requiring a complete credential for first setup.
8. Preserve environment-authoritative Discogs behavior and reject its mutations with `409`.

## Completion criteria

- API tests cover defaults, each section write, Wi-Fi removal, validation errors, authorization,
  and public projection shape.
- Tests prove future/unrelated Site Settings keys cannot leak through the visitor endpoint.
- Discogs tests cover blank-token preservation, first-setup rejection, saved removal, and
  immutable environment credentials.
- All writes use the existing atomic store.
- Targeted tests and `npm run lint` pass.

## Comments

- **Implementation:** Added authenticated Site Settings reads and section-specific Visitor
  Display/Wi-Fi writes and removal, public visitor projection with server-generated QR payload,
  saved Discogs removal, blank-token preservation, first-setup validation, and immutable
  environment-managed credentials.
- **Validation:** `npx vitest run server/api-handler.test.js` (102 passed), `npm test` (232
  Vitest tests and 5 backup tests passed), `npm run lint`, `npm run build`, and `git diff --check`
  passed.
