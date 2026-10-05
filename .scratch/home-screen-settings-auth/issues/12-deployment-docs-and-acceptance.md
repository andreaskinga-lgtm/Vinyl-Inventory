Status: resolved
Kind: implementation
Blocked by: 09, 10, 11

# Update deployment guidance and complete feature acceptance

## Goal

Make the new security boundary, secret storage, tablet operation, and upgrade steps accurate and
verify the complete flow before release.

Read **Deployment and documentation**, **Testing**, and **Out of scope** in
[`the feature spec`](../spec.md).

## Files

- Update `README.md`, `docs/deployment.md`, `.env.example`, `compose.yaml`, and relevant agent
  guidance.
- Update API/architecture documentation that still describes edit mode as cosmetic-only.
- Update release or migration notes used by this repository.

## Steps

1. Document `ADMIN_PASSWORD`, the 10-character minimum, read-only unconfigured mode, restart
   behavior, and the trusted-LAN HTTP limitation.
2. Replace claims that the app has no authorization while preserving warnings against public
   exposure.
3. Document that Site Settings and backups contain the Wi-Fi passphrase.
4. Document tablet setup: LAN-reachable `/`, standalone/full-screen operation, and OS-level
   screen-awake settings.
5. Add guest-network client-isolation troubleshooting and explain why joining Wi-Fi may still not
   permit access to the collection host.
6. Update API tables for auth, Site Settings, visitor projection, and Discogs removal.
7. Execute every manual acceptance scenario listed in the feature spec on representative tablet,
   iOS, and Android devices where available.
8. Run the complete automated validation suite and resolve regressions caused by this effort.

## Completion criteria

- Upgrade instructions prevent an operator from mistaking missing `ADMIN_PASSWORD` for a broken
  collection.
- Documentation never claims HTTPS, internet safety, Wake Lock, or account security that the app
  does not provide.
- Manual acceptance results are appended under `## Comments` in this issue.
- `npm test`, `npm run lint`, and `npm run build` pass.

## Comments

### 2026-10-05 — deployment documentation and acceptance

Implemented the deployment/documentation work without changing or reverting the resolved
feature tickets:

- Documented `ADMIN_PASSWORD` setup, the 10-character minimum, exact comparison, read-only
  behavior when omitted, restart/session invalidation behavior, and the trusted-LAN HTTP threat
  model.
- Documented that `siteSettings.json`, migration archives, and whole-volume backups may contain
  the Visitor Wi-Fi passphrase and must be treated as secrets.
- Documented LAN-reachable `/`, tablet standalone/full-screen setup, OS screen-awake settings,
  PWA start-at-`/` behavior, first-run behavior, and guest client-isolation troubleshooting.
- Updated README/API/feature/deployment/systemd/backup/Pi guidance and removed stale
  cosmetic-only authorization wording.
- Fixed the production Docker image omission for `src/utils/wifiPayload.js`.
- Extended legacy migration and backup validation to carry forward and round-trip
  `siteSettings.json`, including Wi-Fi credentials, without logging the passphrase.

Automated and deployment validation:

- `npx vitest run server/migrate-legacy-data.test.js`: **PASS**, 15 tests.
- `npm run test:backup`: **PASS**, 5 tests.
- `npm test`: **PASS**, 14 Vitest files / 265 tests plus all 5 backup tests.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS**. Only the existing Browserslist freshness warning was emitted.
- `git diff --check`: **PASS**.
- `docker build -t vinyl-inventory-acceptance:issue12 .`: **PASS**.
- `docker compose config --quiet`: **PASS**.
- Docker production smoke test: **PASS** for `/health`, `/`, `/browse`, `/settings`,
  public visitor settings, authenticated Site Settings read/write, and runtime Wi-Fi payload
  loading.

Headless acceptance on the production server:

- **PASS**: `/`, `/browse`, and `/settings` route behavior; direct `/browse` bypasses Home.
- **PASS**: Edit Mode and Settings authentication intent resumption.
- **PASS**: Settings save persistence, dirty-navigation Keep editing/Discard and leave
  warnings, and exact draft/save resumption after a forced session expiry.
- **PASS**: unconfigured, saved-credential, and environment-managed Discogs states; saved and
  environment tokens remained hidden, and no external Discogs fetch was required.
- **PASS**: Home phone handoff, hidden/revealed Wi-Fi password fallback, Wi-Fi and collection
  QR payload DOM checks, safe Home Screen handoff, and Admin Session revocation.
- **PASS**: Collection Display timeout using the configured one-minute setting and direct
  `/browse` immunity after virtual time advancement.
- **PASS**: browser Back/refresh behavior and first-run startup without `siteSettings.json`.

Environment-limited manual follow-ups (not performed or claimed):

- Scan both QR codes with representative physical iOS and Android phones.
- Verify actual tablet browser/PWA standalone or full-screen installation and OS-level
  screen-awake/Auto-Lock behavior on the deployed hardware.

These follow-ups remain operator/device checks because no representative physical iOS/Android
phones or deployed tablet were available. All automatable acceptance and required repository
validation passed; there are no remaining implementation blockers.
