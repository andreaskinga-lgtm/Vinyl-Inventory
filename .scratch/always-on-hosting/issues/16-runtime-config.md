Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by:

# Implement the runtime configuration module

## Goal

Create the single environment-to-configuration boundary used by Vite, tests, systemd, and the
production server.

Before editing, read **Runtime configuration** and **Discogs credential contract** in
[`Always-on LAN hosting`](../spec.md). This ticket owns environment parsing only; storage checks
belong to **Implement power-loss-safe JSON storage**, and credential selection belongs to
**Implement the server-side Discogs credential boundary**.

## Files

- Add `server/config.js`.
- Add `server/config.test.js`.
- Add `.env.example`; confirm the real `.env` remains ignored.
- Update `eslint.config.js`; this ticket alone owns the lint baseline needed by later server
  tickets.

## Steps

1. Export `loadConfig({ env = process.env, cwd = process.cwd() } = {})`.
2. Return `port`, absolute `dataDir`, `nodeEnv`, and either a complete
   `discogsEnvironment` `{ username, token }` or `null`.
3. Default `PORT` to `8080`, `DATA_DIR` to `data` resolved from `cwd`, and absent `NODE_ENV` to
   `development`. Accept only `development`, `test`, or `production`.
4. Trim Discogs values. Reject a partial pair and preserve a complete pair without logging it.
5. Throw errors that name the invalid variable and value class. Do not load `.env` from this
   module; Compose and systemd inject it.
6. Put non-secret defaults and empty Discogs placeholders in `.env.example`.
7. Reshape the flat ESLint config so `js.configs.recommended` covers JavaScript generally, React
   hooks/refresh and browser globals apply only under `src/`, Node globals apply to
   `server/**/*.js`, `scripts/**/*.mjs`, and `vite.config.js`, and Vitest globals apply to
   `**/*.test.js`. Globally ignore `dist` and tracked generated `dev-dist`. Keep `dev-dist`
   tracked until **Implement prompted PWA updates** removes the generated artifacts and ignores
   the directory.

## Completion criteria

- Table-driven tests cover every default, absolute and relative data paths, port boundaries,
  invalid numbers, every `NODE_ENV` value, complete credentials, and both partial-pair cases.
- No test mutates global environment or depends on the current repository path.
- The pre-existing repository reaches a clean `npm run lint` baseline. Later tickets must not
  independently rewrite the ESLint environment split.
- `npm test -- server/config.test.js` and `npm run lint` pass.
