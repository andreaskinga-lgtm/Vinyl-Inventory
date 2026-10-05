Status: resolved
Kind: implementation
Blocked by: 02, 03

# Add the Site Settings model and Wi-Fi QR payload utility

## Goal

Create the persistence and pure validation seams for Visitor Display and Visitor Wi-Fi settings.

Read **Site Settings document** and **Public visitor projection** in
[`the feature spec`](../spec.md).

## Files

- Update `server/json-store.js` and `server/json-store.test.js`.
- Add a pure Site Settings validation/normalization module and tests.
- Add a pure Wi-Fi QR payload utility under `src/utils/` with Vitest coverage.

## Steps

1. Add optional `siteSettings.json` to the atomic JSON store without creating it on first startup.
2. Define schema version 1 defaults: three-minute Visitor Display timeout and no Wi-Fi network.
3. Validate stored documents explicitly; malformed or unsupported data must not silently reset.
4. Validate timeout as a whole minute from 1 through 30.
5. Validate Wi-Fi security (`wpa` or `open`), UTF-8 SSID byte length, WPA passphrase/key rules,
   and hidden-network state.
6. Generate standard Wi-Fi QR payloads for WPA-family, open, and hidden networks.
7. Escape every reserved QR field character, including backslash, semicolon, comma, colon, and
   quotation mark.

## Completion criteria

- Store tests cover missing defaults, first write, readback, queued writes, backup behavior, and
  invalid stored settings.
- Pure tests cover Unicode byte limits, WPA/open/hidden payloads, 64-hex keys, and reserved
  characters.
- The modules have no React, DOM, request, or environment dependency.
- Targeted tests and `npm run lint` pass.

## Comments

- **Implementation:** Added validated schema-version 1 Site Settings defaults and optional
  atomic JSON-store persistence, including queued writes, explicit invalid-storage errors, and
  backup retention. Added pure Wi-Fi validation and QR payload generation for WPA, open, hidden,
  Unicode SSIDs, 64-hex keys, and reserved-character escaping.
- **Validation:** `npx vitest run server/json-store.test.js src/utils/wifiPayload.test.js`,
  `npm test` (185 Vitest tests and 5 backup tests), `npm run lint`, `npm run build`, and
  `git diff --check` all passed.
