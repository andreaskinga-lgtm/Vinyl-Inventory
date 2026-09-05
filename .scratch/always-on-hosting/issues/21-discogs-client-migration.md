Status: resolved
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 20, 22

# Migrate the Discogs client to the server credential contract

## Goal

Update the React client to consume the redacted credential state and remove every browser-side
token transport.

Before editing, read **Discogs credential contract** in
[`Always-on LAN hosting`](../spec.md), then search `src/` for every Discogs config field and
`token` query parameter before changing code.

## Steps

1. Replace token-bearing client state with `username`, `hasToken`, `source`, and `canEdit`.
2. Remove token query parameters from all Discogs requests.
3. Show an explicit **Save credentials** action only when `canEdit` is true.
4. Present environment-managed credentials as configured and read-only.
5. Surface `401` configuration-required and `409` environment-managed responses with existing UI
   error patterns.

## Completion criteria

- `rg` finds no browser request that serializes a Discogs token into a URL.
- The saved, environment, and unconfigured UI states each have one deterministic render path.
- Existing collection import, search, and release-detail calls use the same-origin proxy without
  credential parameters.
- No component-test framework is added; verify with existing lint/build plus a documented manual
  smoke test for the three credential states.
- `npm run lint` and `npm run build` pass.

## Manual smoke test

With `npm run dev` and a temporary `DATA_DIR`, open **Sync with Discogs** and verify:

1. **Unconfigured:** with no environment pair and no complete saved pair, the modal says
   credentials are not configured, shows editable username/token fields, and shows **Save
   credentials**. Saving a complete pair changes the state to saved without exposing the token.
2. **Saved:** with no environment pair and a complete `discogsConfig.json`, the modal identifies
   saved credentials, shows **Save credentials** for replacement, and fetches the collection
   through `/api/discogs/collection?page=1&per_page=100` without a credential query parameter.
3. **Environment:** with `DISCOGS_USER` and `DISCOGS_TOKEN` set, the modal identifies
   environment-managed credentials, shows the username as read-only, and does not render a
   **Save credentials** action.

Also confirm an unconfigured collection request shows the configuration-required error and a
simulated `409` save response shows the environment-managed error in the existing error panel.

## Comments

- Implemented in commits `d87e181` and `b277054`.
- Credential state is loaded and saved through `App.jsx`; `DiscogsImport` receives only the
  redacted contract fields and callbacks.
- Standards and spec re-reviews found no significant issues.
