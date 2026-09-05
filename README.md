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
- **Edit mode** — gated behind a client-side password prompt. This isn't intended for actual security as it is hardcoded to "EditRecords" - it only exists to give a more user friendly viewing layout for most users and prevent any accidental edits
- **PWA** — installable as a Progressive Web App with service worker caching
- **Discogs collection sync** — sync your entire Discogs collection to either import new records or enrich your existing ones by connecting with your username and personal access token.
- **Discogs tracklist** — Display the tracklist for your records via Discogs API

## Tech Stack

| Layer   | Technology                           |
| ------- | ------------------------------------ |
| UI      | React 19                             |
| Build   | Vite 7                               |
| Styling | Plain CSS (co-located per component) |
| PWA     | vite-plugin-pwa                      |

No router, no CSS framework, no external state library. All app state lives in `App.jsx` via `useState`/`useCallback`.

## Getting Started

```sh
npm install
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

## Data & API

During development, Vite middleware serves the shared API handler. The production server
mounted by `npm start` uses the same handler:

| Endpoint                       | Backing File                | Purpose                                  |
| ------------------------------ | --------------------------- | ---------------------------------------- |
| `GET/POST /api/records`        | `data/records.json`         | Record collection                        |
| `GET/POST /api/genre-options`  | `data/genreOptions.json`    | Genre & sub-genre lists                  |
| `GET/POST /api.php`            | iTunes Search API (proxied) | Cover art search                         |
| `GET/POST /api/discogs-config` | `data/discogsConfig.json`   | Save/load Discogs username & token       |
| `GET /api/discogs/collection`  | Discogs API (proxied)       | Fetch user's Discogs collection          |
| `GET /api/discogs/search`      | Discogs API (proxied)       | Search Discogs releases by artist/title  |
| `GET /api/discogs/release`     | Discogs API (proxied)       | Fetch full details for a Discogs release |

State changes auto-save via POST requests. A `useRef` guard prevents saving during the initial data load.

Run `npm run build` before `npm start`. The server initializes `DATA_DIR` with the collection
and genre files on first startup, serves `/health`, and serves the built SPA with its API.

## Migrating legacy Pi data to Compose

Stop every process that can write the legacy `data/` directory, then set these values. Use the
candidate override until the first release image is published; do not pull the `v1.0.0` pin.
`LEGACY_START_COMMAND` must be the command that restarts the old service if rollback is needed.

```sh
export LEGACY_DATA_DIR=/absolute/path/to/Vinyl-Inventory/data
export VINYL_IMAGE=vinyl-inventory:local
export LEGACY_START_COMMAND='sudo systemctl start your-legacy-vinyl-service'
test -d "$LEGACY_DATA_DIR"

sudo systemctl stop your-legacy-vinyl-service
tar -C "$(dirname "$LEGACY_DATA_DIR")" \
  -czf "$HOME/vinyl-legacy-$(date +%Y%m%d-%H%M%S).tar.gz" \
  "$(basename "$LEGACY_DATA_DIR")"

docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml \
  run --rm --user root --no-deps \
  --mount "type=bind,src=$LEGACY_DATA_DIR,dst=/legacy,readonly" \
  app node server/migrate-legacy-data.js --source /legacy --target /data
```

The migration parses both required files and syntax-checks saved Discogs credentials before it
changes the volume. It transfers only recognized JSON files and matching backups, leaves the
legacy directory untouched, and refuses a used target. After separately backing up a used target,
an intentional replacement may append `--overwrite`; this preserves each pre-migration primary
as its `.bak` instead of replacing that recovery copy with a legacy backup.

Start and verify the candidate with operator-known values. The two pressing IDs must identify
separate owned copies of the same artist and title. The credential source is `environment`,
`saved`, or `none`.

```sh
export EXPECTED_RECORD_COUNT=123
export PRESSING_ONE_ID='replace-with-first-record-id'
export PRESSING_TWO_ID='replace-with-second-record-id'
export EXPECTED_DISCOGS_SOURCE=saved

docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml up -d
curl --fail --silent --show-error http://127.0.0.1/health
curl --fail --silent --show-error http://127.0.0.1/api/records | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const records = JSON.parse(input);
  const first = records.find(record => String(record.id) === process.env.PRESSING_ONE_ID);
  const second = records.find(record => String(record.id) === process.env.PRESSING_TWO_ID);
  if (records.length !== Number(process.env.EXPECTED_RECORD_COUNT)) process.exit(1);
  if (!first || !second || first.id === second.id) process.exit(1);
  if (first.artist !== second.artist || first.title !== second.title) process.exit(1);
  console.log(`Verified ${records.length} records and two independent pressings.`);
});'
curl --fail --silent --show-error http://127.0.0.1/api/discogs-config | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const config = JSON.parse(input);
  if (config.source !== process.env.EXPECTED_DISCOGS_SOURCE) process.exit(1);
  console.log(`Verified Discogs credential source: ${config.source}`);
});'
docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml exec \
  app node -e "Promise.all(['records.json','genreOptions.json'].map(async name => {
    await import('node:fs/promises').then(fs => fs.access('/data/' + name, fs.constants.R_OK));
  })).catch(() => process.exit(1))"
```

If any check fails, retain the failed named volume for inspection and roll back without `-v`:

```sh
docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml down
sh -c "$LEGACY_START_COMMAND"
```

Do not remove the legacy directory until its separate archive and the migrated collection have
both been verified.

## PWA update smoke test

To verify a production update on one browser origin, serve build A with `npm run build &&
PORT=8080 npm start`, open the site in Chrome, and install or launch the PWA. Stop that server,
build and serve build B from the next app revision on the same port, then return to the still-open
PWA. Within the update check window, it must show **New version available - Reload** without
reloading first. Select the action once and confirm the new shell loads after one reload.

While the PWA remains installed, open its DevTools console and run
`await fetch("/api/records?smoke=1").then(async (response) => ({ status: response.status,
contentType: response.headers.get("content-type"), body: await response.text() }))`. It must return
status `200`, an `application/json` content type, and a JSON body rather than the app shell. The
same request from `curl http://127.0.0.1:8080/api/records` is also useful for checking the server
directly. This smoke test must reuse the same browser profile and origin for both builds; clearing
site data would remove the waiting-worker scenario.

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
