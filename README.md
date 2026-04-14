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

## Scripts

| Command           | Description                    |
| ----------------- | ------------------------------ |
| `npm run dev`     | Dev server with API middleware |
| `npm run build`   | Production build (static SPA)  |
| `npm run preview` | Preview the production build   |
| `npm run lint`    | Run ESLint                     |

## Data & API

During development, Vite middleware plugins serve a lightweight local API:

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

**Production builds are fully static** — there is no production backend. The JSON files and API middleware are a dev-time convenience only.

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
