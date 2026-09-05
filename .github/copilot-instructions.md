# Vinyl Inventory — Project Guidelines

## Architecture

React 19 SPA built with Vite. No routing — single page with lifted state in `App.jsx`.

- **Components**: `src/components/` — PascalCase `.jsx` files, each with a co-located plain CSS file
- **Data files**: `src/data/` — static defaults and seed data; `data/` — server-persisted JSON
- **Scripts**: `scripts/` — standalone `.mjs` utilities for batch cover-art fetching (run outside the app)

### Data Flow

```
JSON files (data/) ──GET──▶ App state (useState) ──props──▶ Components
Components ──callbacks──▶ App handlers ──setState──▶ re-render + auto-POST
```

State changes to `records` auto-save via `POST /api/records`. A `useRef` guard (`initialized.current`) prevents saving during the initial load.

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
npm test         # Vitest (vitest run) — covers the pure modules in src/utils/
```

Vitest is intentionally scoped to pure modules only (`discogsMapper.js`, `syncPlan.js`) — there is deliberately no component-level or DOM test setup.

## Conventions

- **CSS**: Plain CSS with co-located files per component. No CSS Modules or Tailwind. Use `background-color` (not shorthand `background`) on elements that inherit a global `background-image` (e.g., `<select>` arrow).
- **State**: All app state lives in `App.jsx` via `useState`/`useCallback`. No Context, Redux, or Zustand.
- **Props**: Callbacks drilled from App → forms → picker components (e.g., `onAddSubGenre`, `onDeleteSubGenre`).
- **Genre/SubGenre options**: Persisted to `data/genreOptions.json`; static fallbacks in `src/data/genreOptions.js`.
- **IDs**: Generated via `Date.now() + Math.random()` in `generateId()`.
- **Edit mode**: Gated by a client-side password prompt — cosmetic UX only, not access control.
