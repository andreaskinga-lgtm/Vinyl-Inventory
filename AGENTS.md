# Vinyl Inventory — Project Guidelines

## Architecture

React 19 SPA built with Vite. No routing — single page with lifted state in `App.jsx`.

- **Components**: `src/components/` — PascalCase `.jsx` files, each with a co-located plain CSS file
- **Data files**: `src/data/` — static defaults and seed data; `data/` — server-persisted JSON
- **Scripts**: `scripts/` — standalone `.mjs` utilities for batch cover-art fetching (run outside the app)

### Data Flow

```
JSON files (data/) ──GET──▶ App state (useState) ──props──▶ Components
Components ──callbacks──▶ App handlers ──authorized write──▶ commit state + re-render
```

Collection and genre changes use server-first authorized writes: the complete next payload is
sent and confirmed before App state is committed. A rejected write must not look persisted in
the browser.

### API Layer

The shared Node middleware in `server/api-handler.js` owns all REST endpoint behavior for
records, genres, iTunes, and Discogs. Development uses one `apiPlugin` in `vite.config.js` to
mount that handler, while the production Express adapter mounts the same handler before static
serving. `vite build` still produces the static SPA assets, with PWA support via `vite-plugin-pwa`.

## Build

```sh
npm run dev      # Dev server with API middleware
npm run build    # Production build (vite build)
npm run preview  # Preview production build
npm run lint     # ESLint
npm test         # Vitest plus deploy/backup volume tests
```

Vitest covers pure utilities and server/API/storage seams. The repository also runs the
standalone backup/restore test through `npm test`; there is deliberately no component-level or
DOM test setup.

## Conventions

- **CSS**: Plain CSS with co-located files per component. No CSS Modules or Tailwind. Use `background-color` (not shorthand `background`) on elements that inherit a global `background-image` (e.g., `<select>` arrow).
- **State**: All app state lives in `App.jsx` via `useState`/`useCallback`. No Context, Redux, or Zustand.
- **Props**: Callbacks drilled from App → forms → picker components (e.g., `onAddSubGenre`, `onDeleteSubGenre`).
- **Genre/SubGenre options**: Persisted to `data/genreOptions.json`; static fallbacks in `src/data/genreOptions.js`.
- **IDs**: Generated via `Date.now() + Math.random()` in `generateId()`.
- **Edit mode**: An explicit UI state that requires a server-validated Admin Session. The
  deployment credential is `ADMIN_PASSWORD`; browsing remains public, while collection
  mutations, Settings, and Discogs requests are protected. This is trusted-LAN authorization
  over HTTP, not internet-grade security.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
