Status: resolved
Kind: implementation
Blocked by: none

# Make Settings the sole Discogs credential editor

## Goal

Remove duplicate credential management from Sync while preserving all existing Discogs source
and import behavior.

Read **Discogs** and **Discogs Sync behavior** in
[`the feature spec`](../spec.md).

## Files

- Update `src/components/DiscogsImport.jsx` and its CSS.
- Update the Settings components added by issue 08.
- Update `src/App.jsx` request/state wiring.

## Steps

1. Remove username/token editing controls and save callbacks from `DiscogsImport`.
2. When credentials are absent, show a configuration-required state that navigates to
   `/settings#discogs`.
3. Preserve enough return intent for the administrator to resume Sync after configuring
   credentials.
4. In Settings, prefill username, show token presence/source, and keep the token field blank.
5. Treat a blank token as unchanged only when a saved token exists.
6. Lead the section with explicit saved, environment-managed, or unconfigured source/status.
   Saved credentials indicate that a token is on file and that blank keeps it unchanged.
7. Replace the editor with read-only readiness for environment-managed credentials without
   returning credential values.
8. Add confirmed removal for saved credentials only at the bottom of the section, separated from
   Save, with copy explaining that Sync becomes unavailable.
9. Keep all collection fetch, matching, review, import, and deletion behavior unchanged.

## Completion criteria

- There is exactly one Discogs credential editor: Settings.
- Missing credentials send the administrator to the focused Discogs section and can return to
  Sync.
- Saved, environment, absent, replace-token, preserve-token, and remove states are manually
  verified.
- No token appears in client logs, API responses, or prefilled fields.
- Targeted tests, `npm run lint`, and `npm run build` pass.

## Comments

- **Implementation:** Removed all Discogs credential inputs and save handling from Sync. Sync now
  reports environment-managed, saved, or configuration-required readiness; the missing state opens
  `/settings#discogs` with a tagged Sync return intent. Added hash-aware Settings navigation and
  return handling so saved, removed, or newly configured credentials can resume Sync, including
  Collection Display launches. Settings remains the sole editor with blank token fields, explicit
  source/status copy, environment read-only readiness, blank-token preservation, and confirmed
  saved-credential removal. Discogs fetch `401` responses now use the existing session-expiry
  challenge.
- **Validation:** Added pure transition tests for focused Discogs Settings navigation, Sync return
  intent, hash synchronization, direct hash loads, and Collection Display return behavior. Focused
  tests passed (43 tests); full `npm test` passed (250 Vitest tests and 5 backup tests), `npm run
  lint`, `npm run build`, and `git diff --check` passed. Manual Playwright checks covered direct
  focused Settings challenge, unconfigured-to-Settings return, saved credentials, token replacement,
  blank-token preservation, removal, environment-managed read-only status, Sync readiness, and
  token secrecy.
