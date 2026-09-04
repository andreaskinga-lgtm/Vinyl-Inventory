Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 23

# Implement prompted PWA updates

## Goal

Replace silent automatic service-worker updates with a user-controlled reload prompt and a
15-minute update check.

Before editing, read **Production web serving and PWA behavior** in
[`Always-on LAN hosting`](../spec.md) and
[`PWA staleness policy and cache-header rules`](11-pwa-policy.md).

## Steps

1. Change Vite PWA registration from `autoUpdate` to the plugin's prompted-update integration.
2. Add one small React component for **New version available - Reload**.
3. Trigger `updateServiceWorker(true)` only from that action.
4. Register a 15-minute `registration.update()` interval and clear it on cleanup.
5. Keep `devOptions.enabled` false by default and provide one explicit opt-in test mode.
6. Denylist `/api/*` and `/api.php` from navigation fallback.
7. Remove the tracked generated `dev-dist/` artifacts and add `dev-dist/` to `.gitignore`; future
   service-worker test output is disposable build output.

## Completion criteria

- A waiting worker never reloads the page before user action.
- Accepting the prompt activates the waiting worker and reloads once.
- Normal `npm run dev` leaves no service worker registered.
- A production smoke test demonstrates the prompt by serving two successive builds.
- API requests return API responses while the PWA is installed.
- `npm run lint` and `npm run build` pass.
