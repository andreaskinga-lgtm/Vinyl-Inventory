# PWA caching and update policy research

## Bottom line recommendations

1. **Prefer a prompted update flow for this app, not silent `autoUpdate`, unless surprise reloads are acceptable.** `vite-plugin-pwa` documents two strategies: “Prompt for update” lets the app show UI and reload when the user accepts, while “Auto update” configures the generated Workbox service worker to call `skipWaiting` and `clientsClaim` so a new worker activates and controls clients as soon as possible. Sources: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html, https://vite-pwa-org.netlify.app/guide/auto-update.html
2. **Serve the HTML/app shell and service-worker entry points with short/no browser caching; serve hashed Vite assets with immutable long caching.** Vite production assets under `assets/` are content-hashed, so they are safe to cache for a year with `immutable`; `index.html`, `manifest.webmanifest`, `sw.js`, `registerSW.js`, and Workbox/precache manifest files should be revalidated so clients discover new builds promptly. Sources: https://vite.dev/guide/assets, https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control, https://expressjs.com/en/4x/api.html#express.static
3. **Do not leave `devOptions.enabled: true` for normal development.** The vite-plugin-pwa development guide says service workers in dev are intended for testing only and require care because they can affect the dev origin; keep it disabled by default and enable only for explicit PWA/SW tests. Source: https://vite-pwa-org.netlify.app/guide/development.html
4. **Explicitly denylist API paths from SPA navigation fallback.** When Workbox is configured with an app-shell `navigateFallback`, use `navigateFallbackDenylist` for `/api/`, `/api.php`, and other non-document endpoints so failed or navigated API URLs are not served `index.html`. Source: https://developer.chrome.com/docs/workbox/modules/workbox-build#type-GenerateSWOptions
5. **For a home-LAN permanently running server, combine prompted updates with periodic `registration.update()` checks.** Browsers check service workers during navigations and may throttle update checks; MDN documents that `ServiceWorkerRegistration.update()` bypasses the browser cache if the previous update check was more than 24 hours ago, so an installed PWA left open can otherwise remain on an old shell until a navigation/update check and activation/reload path occurs. Sources: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update, https://web.dev/service-worker-lifecycle/

## Current repository facts

The current `vite.config.js` uses `VitePWA({ registerType: "autoUpdate", devOptions: { enabled: true }, includeAssets: [...], manifest: ... })` and registers dev-only API middleware for `/api/records`, `/api/genre-options`, `/api.php`, `/api/discogs-config`, and `/api/discogs/collection`.

## 1. What `registerType: "autoUpdate"` does

### Workbox behavior

`vite-plugin-pwa`’s Auto Update strategy states that the generated service worker is configured to update automatically, and with the Workbox `generateSW` strategy this means `workbox.skipWaiting` and `workbox.clientsClaim` are enabled. Source: https://vite-pwa-org.netlify.app/guide/auto-update.html

In Workbox terms, `skipWaiting` causes an installed waiting service worker to activate immediately instead of waiting for old controlled pages to close; `clientsClaim` causes the newly activated service worker to control uncontrolled clients in scope as soon as activation completes. Sources: https://developer.chrome.com/docs/workbox/modules/workbox-core/#the-skipwaiting-wrapper-is-deprecated, https://developer.chrome.com/docs/workbox/modules/workbox-core/#clients-claim

### When updates are detected

Browsers run the service-worker update algorithm when navigating to an in-scope page and at other registration update opportunities; web.dev describes that an update is detected when the browser refetches the service worker and finds it byte-different from the current worker. Source: https://web.dev/service-worker-lifecycle/

Apps can also call `ServiceWorkerRegistration.update()` manually. MDN says `update()` checks the server for an updated service worker and bypasses browser caches if the previous update check happened more than 24 hours ago. Source: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update

`vite-plugin-pwa`’s virtual registration helpers expose update callbacks and an `updateServiceWorker` helper; the docs show using these helpers for prompt and auto-update strategies. Source: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html

### Does the page reload automatically?

`skipWaiting`/`clientsClaim` activate and claim quickly, but they do **not by themselves reload the already open page**. web.dev emphasizes that pages already loaded keep their current JavaScript and DOM until reloaded, even if a new service worker takes control. Source: https://web.dev/service-worker-lifecycle/

The vite-plugin-pwa auto-update guide’s client helper can reload when an update is ready, but if the app does not import/use the virtual registration helper or show reload UI, an already open tab may keep running the old JS bundle until a user reloads or the app explicitly reloads. Source: https://vite-pwa-org.netlify.app/guide/auto-update.html

### How long can a stale shell persist?

An open browser tab or installed standalone PWA can keep its old in-memory document and JS indefinitely if it is never reloaded. A new service worker may activate and control future fetches, but the current page’s loaded JS remains old until reload. Source: https://web.dev/service-worker-lifecycle/

If the PWA is closed and reopened, or if the app calls `registration.update()` periodically and then reloads after an accepted update, the stale period can be shortened to the polling interval plus install/activation time. MDN provides the manual update API; vite-plugin-pwa provides registration helpers for update UI. Sources: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update, https://vite-pwa-org.netlify.app/guide/prompt-for-update.html

## 2. Cache headers for Express static hosting

### Recommended headers

Use these defaults for a same-origin Express production server:

| File | Recommended `Cache-Control` | Reason |
| --- | --- | --- |
| `index.html` | `no-cache` or `max-age=0, must-revalidate` | The shell points at the current hashed assets; clients should revalidate on each load. Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control |
| `assets/*` hashed files | `public, max-age=31536000, immutable` | Vite emits content-hashed production assets, so old URLs remain valid and new builds use new URLs. Sources: https://vite.dev/guide/assets, https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control |
| `manifest.webmanifest` | `no-cache` or short `max-age` | Manifest updates affect install metadata/icons/start URL and should be revalidated. Source: https://developer.mozilla.org/en-US/docs/Web/Manifest |
| `sw.js` | `no-cache` or `max-age=0, must-revalidate` | Browsers perform their own service-worker script update checks, but short caching avoids intermediary/browser surprises. Sources: https://web.dev/service-worker-lifecycle/, https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update |
| `registerSW.js` | `no-cache` or `max-age=0, must-revalidate` | It participates in registration/update behavior and should track the current build. Source: https://vite-pwa-org.netlify.app/guide/register-service-worker |
| Workbox/precache manifest files such as `workbox-*.js` or `precache-manifest.*.js` if emitted | `no-cache` for manifest-like revision files; long-cache only if filename is content-hashed and never referenced by stable URL | Workbox detects changed precache revisions from the generated manifest; stale manifests delay updates. Source: https://developer.chrome.com/docs/workbox/modules/workbox-precaching |

### What browsers/Workbox override

The browser updates a service worker by fetching the service-worker script and comparing it byte-for-byte with the installed worker; if different, the new install flow starts. Source: https://web.dev/service-worker-lifecycle/

`ServiceWorkerRegistration.update()` bypasses browser caches when the previous update check was more than 24 hours ago. Source: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update

The service-worker registration option `updateViaCache` controls whether the HTTP cache is consulted for the main service-worker script and its imported scripts; MDN documents values `imports`, `all`, and `none`. Source: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache

### Express example

Express `express.static(root, options)` accepts `maxAge`, `etag`, `immutable`, and `setHeaders`; `setHeaders(res, path, stat)` can set per-file headers. Source: https://expressjs.com/en/4x/api.html#express.static

```js
import express from "express";
import path from "node:path";

const app = express();
const dist = path.resolve("dist");

app.use(
  express.static(dist, {
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
      const normalized = filePath.replaceAll(path.sep, "/");

      if (normalized.includes("/assets/")) {
        res.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
        return;
      }

      if (
        normalized.endsWith("/index.html") ||
        normalized.endsWith("/manifest.webmanifest") ||
        normalized.endsWith("/sw.js") ||
        normalized.endsWith("/registerSW.js") ||
        /\/workbox-.*\.js$/.test(normalized) ||
        /\/precache-manifest\..*\.js$/.test(normalized)
      ) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);
```

Serve API routes before the static fallback:

```js
app.get("/api/records", recordsHandler);
app.post("/api/records", recordsPostHandler);
app.get("/api/genre-options", genreOptionsHandler);
app.post("/api/genre-options", genreOptionsPostHandler);
app.all("/api.php", itunesProxyHandler);
app.get("/api/discogs-config", discogsConfigHandler);
app.get("/api/discogs/collection", discogsCollectionHandler);

app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(dist, "index.html"));
});
```

Express documents that middleware order matters because requests pass through matching middleware in registration order. Source: https://expressjs.com/en/guide/using-middleware.html

## 3. `devOptions.enabled: true`

`vite-plugin-pwa` documents dev service-worker support as a development/testing mode, not the normal default. Source: https://vite-pwa-org.netlify.app/guide/development.html

Leaving `devOptions.enabled: true` can register a service worker on the Vite dev origin. Because service-worker registrations are origin/scope based, a dev worker can continue affecting later visits to the same dev origin until unregistered. MDN documents that service workers are registered for an origin and scope. Source: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

Recommendation: set `devOptions.enabled: false` or omit `devOptions` for day-to-day development; enable it only in a dedicated PWA test run/profile, and unregister old dev workers from browser DevTools when debugging caching issues. Source: https://vite-pwa-org.netlify.app/guide/development.html

## 4. Same-origin SPA fallback and `/api/*` failure modes

Workbox `generateSW` supports `navigateFallback` for app-shell routing and `navigateFallbackDenylist` to exclude URL patterns from that fallback. Source: https://developer.chrome.com/docs/workbox/modules/workbox-build#type-GenerateSWOptions

Failure mode: if a user or script makes a navigation-mode request to `/api/records`, `/api/genre-options`, `/api.php`, `/api/discogs-config`, or `/api/discogs/collection`, an over-broad app-shell fallback can return cached `index.html` instead of JSON. Source for the denylist mechanism: https://developer.chrome.com/docs/workbox/modules/workbox-build#type-GenerateSWOptions

Failure mode: runtime caching rules that match same-origin paths too broadly can cache API JSON accidentally. Workbox routing docs say routes match requests and methods according to registered match callbacks; route order and specificity therefore matter. Source: https://developer.chrome.com/docs/workbox/modules/workbox-routing

Recommended VitePWA/Workbox shape if navigation fallback is enabled:

```js
VitePWA({
  registerType: "prompt",
  workbox: {
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [
      /^\/api(?:\/|$)/,
      /^\/api\.php$/,
    ],
  },
});
```

Also keep Express API middleware before static/fallback middleware, so the server never returns `index.html` for real API requests. Source: https://expressjs.com/en/guide/using-middleware.html

## 5. Prompted reload vs silent auto-update

vite-plugin-pwa documents “Prompt for update” and “Auto update” as separate update strategies. Prompted update is intended to show UI when a new service worker is waiting, then call the update helper to activate/reload when the user accepts; auto-update activates immediately. Sources: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html, https://vite-pwa-org.netlify.app/guide/auto-update.html

For an inventory app used by guests on phones, prompted update is safer because it avoids surprise reloads while someone is editing or browsing. The prompt can be low-friction: “A new version is available. Reload now?” and call the vite-plugin-pwa update helper if accepted. Source for the helper strategy: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html

Silent auto-update is reasonable only if the app can tolerate the current page being controlled by a newer worker and possibly being reloaded by the registration helper without user context loss. Source: https://vite-pwa-org.netlify.app/guide/auto-update.html

## Could not verify

I could not verify from primary docs that vite-plugin-pwa itself performs a built-in periodic update check at a specific interval for `registerType: "autoUpdate"` without application code. The primary docs verify the registration/update strategies and expose update helpers, while MDN verifies the browser `registration.update()` behavior.
