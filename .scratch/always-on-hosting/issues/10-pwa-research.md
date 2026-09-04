Type: research
Status: resolved
Blocked by:

# Research: vite-plugin-pwa autoUpdate and cache headers behind a Node server

## Question

Config today (`vite.config.js` 521–530): `registerType: "autoUpdate"`, `devOptions.enabled: true`,
precached icons. Once this is a long-lived service that gets updated, guests' installed PWAs can
hold a stale shell.

Surface:
1. What `autoUpdate` actually does in workbox terms — when is a new SW detected, does it reload
   the page, and how long can a stale shell persist on an open tab?
2. What cache headers a Node/Express static server *should* send for `index.html`, the hashed
   `assets/*`, `manifest.webmanifest` and `sw.js`, and which of those workbox/the browser
   override anyway.
3. Whether `devOptions.enabled: true` causes problems (stale SW during dev, SW registered
   against the dev origin) and what the recommended dev setting is.
4. Known failure modes of `navigateFallback`/precache when the same origin also serves `/api/*`.

Write findings to `.scratch/always-on-hosting/research/pwa-caching.md` with citations, then link
it from the Answer here.

## Answer

Research written to [`research/pwa-caching.md`](../research/pwa-caching.md).

Bottom line: prefer a prompted update flow over silent `autoUpdate` for this home-LAN PWA, unless
surprise reloads are acceptable. Serve hashed Vite `assets/*` with one-year immutable caching, but
revalidate `index.html`, `manifest.webmanifest`, `sw.js`, `registerSW.js`, and manifest-like Workbox
files. Disable `devOptions.enabled` for normal development and enable only for explicit SW testing.
If app-shell fallback is used, denylist `/api/`, `/api.php`, and Discogs endpoints so API requests
cannot be served cached `index.html`. Add periodic update checks plus user-facing reload UI to reduce
stale installed-PWA shells.
