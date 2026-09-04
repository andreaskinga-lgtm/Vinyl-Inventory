Type: grilling
Status: resolved
Blocked by: 01, 10

# PWA staleness policy and cache-header rules

## Question

Given the research, decide the actual policy: which cache headers the Express static handler
sends for which paths; whether `devOptions.enabled` stays true; whether guests get a visible
"new version, reload" prompt or a silent auto-reload; and what the acceptable staleness window
is for a phone that installed the PWA weeks ago.

Bias from charting: keep `autoUpdate`, `index.html` no-cache, hashed assets immutable — but
confirm that against the findings rather than assuming it.

## Answer

Use a **prompted** service-worker update flow. The app checks for an update every 15 minutes;
when a new worker is waiting, it presents a "New version available — Reload" action. It never
reloads a guest's open app automatically, so that app may remain on its current shell until the
guest accepts the prompt or reopens it.

The production Express static handler must send:

- `Cache-Control: public, max-age=31536000, immutable` for hashed `assets/*`.
- `Cache-Control: no-cache` for `index.html`, `sw.js`, `registerSW.js`,
  `manifest.webmanifest`, and generated Workbox manifest-like files, so each use revalidates.

Normal `npm run dev` does not register a service worker. Service-worker registration is enabled
only through an explicit test mode. Any app-shell `navigateFallback` excludes `/api/*`,
`/api.php`, and Discogs API endpoints so they can never receive cached `index.html`.

This decision is based on [the PWA caching research](../research/pwa-caching.md).
