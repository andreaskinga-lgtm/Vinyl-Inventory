Status: ready-for-agent
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
