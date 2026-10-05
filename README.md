# Vinyl Inventory

A personal vinyl record collection manager built as a single-page React app. Catalogue your records with cover art, genres, and physical storage locations, then search and sort your collection across devices. It was mainly built as a solution to let houseguests browse your collection easily from their phone, not as a serious collection tracker.

This has also been a project to experiment with AI assisted code writing, so a lot of what you see here was built just prompting Claude for solutions. I've reviewed the code to make sure there isn't anything aggregiously awful, but for the most part have let the AI do its thing and gone in and tweaked details afterwards.

It is currently very much in a pre-alpha state, with a lot of rough edges. No database solution (just writing, reading and storing data as JSON), a crappy AI Generated background image, and I'm currently just running it locally in dev mode on a PI 3.

## Features

- **Add, edit, and delete records** — each record stores artist, title, year, genre, sub-genres, location, cover art URL, and up to two vinyl image URLs
- **Search** — live full-text filtering across title, artist, genre, sub-genres, and location
- **Sort** — by artist, year, or genre (artist sorting strips leading "The"/"A")
- **Random Flip** - flip through a randomized list of records based on your existing filters
- **Cover art search** — ported from https://github.com/bendodson/itunes-artwork-finder. Look up artwork via the iTunes Search API, with a country selector for region-specific results. Currently doesn't work very well for me (only has about a 40% hit rate from my testing) so I added a secondary button that opens a more accurate website and prefills the search query
- **Genre & sub-genre management** — user-configurable lists with inline add/delete
- **Detail view** — click a card to see an image carousel (cover + vinyl images)
- **Home Screen and visitor handoff** — shared displays open at `/`, where visitors can browse
  on the display or generate a QR code for `/browse` on their phone. An optional Visitor Wi-Fi
  QR code can help a phone join the configured network.
- **Administrator sessions** — public browsing and Discogs metadata remain available, while
  collection changes, Settings, and Discogs sync require a server-validated Admin Session. Configure
  `ADMIN_PASSWORD` in the deployment environment; the Settings page never changes it.
- **Collection Display timeout** — shared-display browsing and phone handoff return to the Home
  Screen after the configured 1–30 minute idle timeout. Direct `/browse` phone sessions do not
  use this timeout.
- **PWA** — installable as a Progressive Web App with service-worker caching. Installed clients
  start at `/` and therefore open the visitor Home Screen; PWA installation does not keep a
  tablet awake.
- **Discogs collection sync** — sync your entire Discogs collection to either import new records
  or enrich existing records. Configure a saved username/token pair in Settings, or provide an
  environment-managed pair for a read-only credential source.
- **Discogs tracklist** — Display the tracklist for your records via Discogs API

## Tech Stack

| Layer   | Technology                           |
| ------- | ------------------------------------ |
| UI      | React 19                             |
| Build   | Vite 7                               |
| Styling | Plain CSS (co-located per component) |
| PWA     | vite-plugin-pwa                      |

No router, no CSS framework, no external state library. All app state lives in `App.jsx` via `useState`/`useCallback`.

## Run it on your LAN

Vinyl Inventory is a trusted-LAN service. It has real server-validated authorization for
administrator actions, but the supported deployment is plain HTTP and is not safe for hostile
networks or internet exposure. Do not use port forwarding, a public reverse proxy, a tunnel, or
a public hostname.

You need Docker Compose and a 64-bit `linux/amd64` or `linux/arm64` host, including a Raspberry
Pi 3 with 64-bit Raspberry Pi OS.

Create a deployment directory:

```sh
mkdir vinyl-inventory && cd vinyl-inventory
```

Download the pinned release file:

```sh
curl -fsSLO https://raw.githubusercontent.com/andreaskinga-lgtm/Vinyl-Inventory/v1.2.0/compose.yaml
```

Before starting, create a mode-0600 `.env` with a unique administrator password of at least
10 characters. The value is compared exactly, including whitespace:

```sh
umask 077
touch .env
chmod 600 .env
IFS= read -r -s ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
node <<'NODE'
const fs = require("node:fs");
const path = ".env";
const contents = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const lines = contents ? contents.split(/\r?\n/) : [];
if (lines.at(-1) === "") lines.pop();
const replacement = `ADMIN_PASSWORD=${JSON.stringify(process.env.ADMIN_PASSWORD)}`;
const index = lines.findIndex((line) => /^ADMIN_PASSWORD=/.test(line));
if (index === -1) lines.push(replacement);
else lines[index] = replacement;
fs.writeFileSync(path, `${lines.join("\n")}\n`);
NODE
unset ADMIN_PASSWORD
chmod 600 .env
```

This updates only `ADMIN_PASSWORD` and preserves any other keys already in `.env`.

Start it:

```sh
docker compose up -d
```

Verify it:

```sh
curl --fail --silent --show-error http://localhost/health
```

Reserve the host's IP address in the router so the guest URL does not change. Open the
LAN-reachable `http://<reserved-ip>/` on the shared tablet and on other devices on the same
non-isolated LAN. Do not use `localhost` on the tablet: the phone QR would point at the phone
itself instead of the collection host.

The first run creates an empty collection and shipped genre defaults. It does not create
`siteSettings.json` or `discogsConfig.json` until an administrator saves those settings. If
`ADMIN_PASSWORD` is omitted or empty, the service still starts in public read-only mode; sign-in
reports that administrator access is not configured rather than treating the collection as
broken. To change the password, edit `.env` and run `docker compose up -d` so Compose recreates
the container. A restart invalidates all in-memory Admin Sessions.

On a tablet, open `/` in the browser, use Add to Home Screen/install when available, and launch
the installed app in standalone/full-screen mode. Configure the tablet OS to use a long or
disabled screen timeout while it is the Collection Display; the app cannot guarantee Screen
Wake Lock over an HTTP LAN deployment.

If a phone joins the Visitor Wi-Fi but cannot open the reserved IP, check the router's guest
client-isolation/AP-isolation setting. Some guest networks permit internet access while blocking
device-to-device traffic; move the phone to a non-isolated LAN/SSID or adjust the router policy.

See [`docs/deployment.md`](docs/deployment.md) for password/restart details, addressing,
tablet setup, backup and secret handling, migration, updates, systemd, Pi notes, PWA behavior,
and troubleshooting.

> **Release availability:** the Compose file is pinned to `v1.2.0`. Before relying on the public
> download and image pull, a maintainer must make the GHCR package public and verify an
> unauthenticated arm64 pull from a clean machine. Until then, use a maintainer-provided image
> candidate rather than assuming the public image is available.

## Development

```sh
npm ci
npm run dev
```

Normal development does not register a service worker. Use `npm run dev:pwa-test` only when
testing service-worker behavior locally.

## Scripts

| Command           | Description                    |
| ----------------- | ------------------------------ |
| `npm run dev`     | Dev server with API middleware |
| `npm run dev:pwa-test` | Dev server with service-worker test mode |
| `npm run build`   | Build the production SPA       |
| `npm start`       | Serve the built app and API    |
| `npm run preview` | Preview the production build   |
| `npm run lint`    | Run ESLint                     |
| `npm test`        | Run Vitest and backup/restore tests |

## Data & API

During development, Vite middleware serves the shared API handler. The production server
mounted by `npm start` uses the same handler:

| Endpoint | Access | Backing data/upstream | Purpose |
| --- | --- | --- | --- |
| `GET /health` | Public | None | Process/storage health check |
| `GET /api/records` | Public | `data/records.json` | Record collection |
| `POST /api/records` | Admin Session | `data/records.json` | Replace the collection |
| `GET /api/genre-options` | Public | `data/genreOptions.json` | Genre and sub-genre lists |
| `POST /api/genre-options` | Admin Session | `data/genreOptions.json` | Replace genre lists |
| `GET /api/visitor-settings` | Public | Projected `siteSettings.json` | Timeout and visitor Wi-Fi handoff data |
| `GET /api/site-settings` | Admin Session | `data/siteSettings.json` | Full editable Site Settings |
| `PUT /api/site-settings/visitor-display` | Admin Session | `data/siteSettings.json` | Save the 1–30 minute display timeout |
| `PUT/DELETE /api/site-settings/wifi` | Admin Session | `data/siteSettings.json` | Save/remove Visitor Wi-Fi settings |
| `GET /api/auth/session` | Public | In-memory session | Report configured/authenticated state |
| `POST /api/auth/login` | Public | `ADMIN_PASSWORD` | Start a browser-session Admin Session |
| `POST /api/auth/logout` | Public | In-memory session | End the current Admin Session |
| `GET/POST/DELETE /api/discogs-config` | Admin Session | `data/discogsConfig.json` or environment | Read status, save, or remove saved Discogs credentials; secrets are never returned |
| `GET /api/discogs/collection` | Admin Session | Discogs API (proxied) | Fetch the administrator's collection |
| `GET /api/discogs/search` | Public | Discogs API (proxied) | Search Discogs releases |
| `GET /api/discogs/release` | Public | Discogs API (proxied) | Fetch release details |
| `GET/POST /api.php` | Public | iTunes Search API (proxied) | Cover-art search |

Public visitor projection intentionally includes the configured Wi-Fi password because it is
used for the visitor QR and manual fallback. Treat `siteSettings.json`, `discogsConfig.json`,
the whole data volume, and every backup archive as secrets. Collection and Settings mutations
are server-first and commit browser state only after an authorized response succeeds.

Run `npm run build` before `npm start`. The server initializes `DATA_DIR` with the collection
and genre files on first startup, serves `/health`, and serves the built SPA with its API.
Installed PWA clients start at `/`, the Home Screen; direct `/browse` remains a phone-browsing
path and is not subject to Collection Display timeout.

## Project Structure

```
src/
  App.jsx              — all state, handlers, and top-level render
  components/          — UI components, each with a co-located .css file
  data/                — static seed data and fallback genre options
data/
  records.json         — server-persisted record collection
  genreOptions.json    — server-persisted genre lists
```
