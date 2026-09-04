Status: ready-for-agent

# Always-on LAN hosting

## Outcome

Vinyl Inventory runs continuously as a LAN-only service from one Node 22 process. The process
serves the Vite production build and the same API implementation used during development. A
stranger can install a pinned multi-architecture image with Docker Compose, preserve the
collection in a named volume, and operate it using the README quickstart plus
`docs/deployment.md`.

The first stable release is `v1.0.0`. It supports `linux/amd64` and `linux/arm64`, including a
1 GB Raspberry Pi 3 running 64-bit Raspberry Pi OS once the release acceptance check below
passes.

## Scope boundaries

- The service is for a trusted LAN. Remote access, TLS, and real authentication or authorization
  are not part of this effort.
- The hardcoded edit-mode password remains a cosmetic safeguard only.
- Persisted state remains JSON in a mounted directory. A database migration is separate work.
- A fresh installation starts with an empty collection and the shipped genre defaults.
- Docker Compose is the happy path. A source checkout managed by systemd is the fallback.
- Releases publish prebuilt images. Building on a Raspberry Pi 3 is not a supported install path.

## Runtime architecture

Add a `server/` layer with these responsibilities:

| Module | Responsibility |
| --- | --- |
| `server/config.js` | Read and validate runtime environment, normalize `DATA_DIR`, and return immutable configuration. |
| `server/json-store.js` | Initialize, read, validate, back up, and atomically replace persisted JSON files. |
| `server/api-handler.js` | Export `createApiHandler({ dataDir, fetch, discogsEnvironment })` and own all API routing, validation, credential selection, external requests, and responses. |
| `server/app.js` | Build the Express app, mount the shared API handler first, then health, static files, and the SPA fallback. |
| `server/index.js` | Resolve configuration, verify storage, start listening, and report startup failures. |

`createApiHandler({ dataDir, fetch, discogsEnvironment = null })` returns Node-style middleware
`(req, res, next)`. It does not read environment variables, choose a working directory, or
depend on Express-specific request extensions. Vite installs one `apiPlugin` that creates and
mounts this exact handler with `server.middlewares.use(...)`; the five current endpoint-specific
plugins are removed. Express mounts the same handler before static serving. Both adapters pass
the nullable, already-validated `discogsEnvironment` returned by `loadConfig`.

The browser keeps same-origin relative URLs. Preserve the current request and response contracts
for:

- `GET/POST /api/records`
- `GET/POST /api/genre-options`
- `GET/POST /api.php`
- `GET/POST /api/discogs-config`, except for the credential changes below
- `GET /api/discogs/collection`
- `GET /api/discogs/search`
- `GET /api/discogs/release`

Unsupported methods and invalid input return explicit JSON errors with appropriate 4xx status
codes. Unexpected storage and upstream failures return explicit 5xx errors. Requests outside the
owned API paths call `next()` so the hosting adapter can handle them.

`GET /health` is unauthenticated, does not read or expose collection data, and returns a small
success response only after startup configuration and storage checks have completed.

## Runtime configuration

All deployment configuration is server-side and read at process startup:

| Variable | Required | Default | Rules |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | Integer from 1 through 65535. |
| `DATA_DIR` | No | `data` | Absolute values are accepted; relative values resolve from the server working directory. The directory must be creatable and writable before listening. |
| `DISCOGS_USER` | No | empty | Must be supplied together with `DISCOGS_TOKEN`. |
| `DISCOGS_TOKEN` | No | empty | Must be supplied together with `DISCOGS_USER`; never exposed to the browser or logs. |
| `NODE_ENV` | No | Node convention | The container sets `production`; accepted values are `development`, `test`, and `production`. |

Invalid ports, invalid `NODE_ENV`, partial Discogs environment credentials, and unusable storage
fail startup with a precise error. There is no fallback to another port or directory. Track a
non-secret `.env.example`; keep `.env` ignored. Do not add `VITE_*` deployment configuration.

## Persisted data

On first startup, create `DATA_DIR`, initialize `records.json` to `[]`, and initialize
`genreOptions.json` from the shipped static fallback. Do not create `discogsConfig.json` until
credentials are explicitly saved.

All three JSON resources use one store and one write protocol:

1. Validate and serialize the complete next value.
2. Write a uniquely named temporary file in the target directory.
3. `fsync` the temporary file.
4. If a valid primary exists, atomically replace its single `.bak` sibling with that prior value.
5. Atomically rename the temporary file over the primary.
6. `fsync` the containing directory.

A failed write must leave the last valid primary readable. Temporary files are not accepted as
data on startup. Keep only the current value and one prior-version `.bak`; long-term retention is
the operator's whole-volume backup responsibility.

Compose mounts the named volume `vinyl-inventory-data` at `/data` and sets `DATA_DIR=/data`.
The image creates `/data` with ownership that permits its non-root `node` process to initialize
and update a fresh volume.

## Discogs credential contract

A Discogs Credential is one complete username/token pair:

- A complete environment pair is authoritative. Saved credentials are ignored and
  `canEdit` is false.
- With no environment pair, a complete `discogsConfig.json` pair is the trusted-LAN fallback.
- Missing, malformed, or partial saved credentials mean unconfigured; the rest of the service
  still starts.

`GET /api/discogs-config` returns only:

```json
{
  "username": "non-secret effective username or empty string",
  "hasToken": true,
  "source": "environment",
  "canEdit": false
}
```

`source` is `environment`, `saved`, or `none`. The token is never returned. When environment
credentials are active, `POST /api/discogs-config` returns `409` without changing the file.
Otherwise POST accepts only a complete, trimmed pair and persists it atomically.

Discogs proxy endpoints use the server-resolved credential exclusively. Remove token query
parameters from browser requests. Unconfigured Discogs operations return `401` with a clear
configuration-required error. The UI presents an explicit **Save credentials** action only when
`canEdit` is true and identifies environment-managed credentials as read-only.

## Production web serving and PWA behavior

Express serves `dist/` after the API and health handlers. Unknown non-API navigation requests
fall back to `index.html`; unknown API requests never do.

Use these production response policies:

- Hashed `assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
- `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest`, and generated Workbox
  manifest-like files: `Cache-Control: no-cache`.
- The service-worker navigate fallback denies `/api/*`, `/api.php`, and Discogs API paths.

Normal `npm run dev` does not register a service worker. An explicit test mode may enable one.
In production, check for a new service worker every 15 minutes. When one is waiting, show
**New version available - Reload**; update only when the user accepts or later reopens the app.

Add a header-level **Share collection** action. Its modal renders a scannable QR code for
`window.location.origin`, shows the current address in text, invites the guest to browse the
shelves, and says **No app or sign-in needed.** Do not add a canonical URL setting or a separate
guest view.

## Container and Compose deployment

Use a multi-stage Node 22 image:

- The build stage installs the lockfile exactly and runs `npm run build`.
- The runtime stage contains `dist/`, `server/`, `src/data/genreOptions.js`, `package.json`, the
  lockfile, and production dependencies only. The shipped genre module remains the single source
  for browser fallback and server first-run seeding.
- Use a Debian slim Node 22 base for predictable multi-architecture behavior.
- Run as the image's non-root `node` user, expose `8080`, and start `server/index.js`.
- Use Docker/Compose init rather than adding a process supervisor inside the image.

The checked-in `compose.yaml` contains one `app` service:

- image `ghcr.io/andreaskinga-lgtm/vinyl-inventory:v1.0.0` for the first release
- `init: true`
- `restart: unless-stopped`
- host/container port mapping `80:8080`
- named volume `vinyl-inventory-data:/data`
- `NODE_ENV=production` and `DATA_DIR=/data`
- optional `DISCOGS_USER` and `DISCOGS_TOKEN` interpolation from `.env`
- a healthcheck against `http://127.0.0.1:8080/health`
- no CPU or memory limit until measurements justify one

Provide an override example for a host whose port 80 is occupied.

The reliable guest URL is `http://<reserved-ip>`, where the operator reserves the host address
in DHCP. `http://vinyl.local` is best-effort and is advertised by host Avahi, never by the
container. Troubleshooting explicitly covers host firewalls, occupied port 80, mDNS differences,
and guest-Wi-Fi client isolation.

## No-Docker systemd fallback

The fallback installs a source checkout at `/opt/vinyl-inventory`, creates a dedicated non-login
`vinyl-inventory` user, and stores data in `/var/lib/vinyl-inventory`. Secrets live in
root-owned `/etc/vinyl-inventory.env` with mode `0600`.

Using Node 22, installation and updates run:

```sh
npm ci
npm run build
npm prune --omit=dev
```

The unit uses `WorkingDirectory=/opt/vinyl-inventory`,
`EnvironmentFile=/etc/vinyl-inventory.env`,
`ExecStart=/usr/bin/node server/index.js`, `Restart=on-failure`, and journald. `DATA_DIR` is the
absolute `/var/lib/vinyl-inventory`; `PORT` defaults to `8080`. Do not grant privileged port 80
or bundle a reverse proxy into this fallback. Document those as advanced operator-owned options.

The update procedure backs up data first, stops the unit, updates to an explicit release tag,
repeats the install/build/prune commands, restarts, and verifies health and collection data.

## Backup, restore, and legacy migration

The deployment guide provides copy-paste commands that archive the entire stopped
`vinyl-inventory-data` volume to a timestamped file, plus an optional cron/systemd-timer example.
It installs no scheduler. Operators retain multiple archives off the Pi's SD card. Because
archives may contain `discogsConfig.json`, treat them as secrets.

Restore stops the service, archives the current volume, restores one whole selected archive,
starts the service, checks `/health`, and verifies the collection.

Legacy Pi migration is explicit and one-shot:

1. Stop every writer to the old project-local `data/` directory and archive it.
2. Parse required `records.json` and `genreOptions.json`; syntax-check optional
   `discogsConfig.json` without printing values.
3. Transfer only those recognized primary files and matching `.bak` files. Exclude temporary,
   unrelated, and OS metadata files.
4. Run `docker compose run --rm --user root` for `app`, bind-mount the legacy directory
   read-only at `/legacy`, copy into `/data`, and assign ownership to the image's `node` user.
5. Start Compose and verify health, record count, known independent Pressings, and expected
   credential source.
6. On failure, stop Compose and restart the untouched legacy service. Retain the copied volume
   for diagnosis.

Never auto-discover or auto-copy legacy data at application startup.

## CI, images, releases, and updates

`ci.yml` runs `npm run lint` and `npm test` on every pull request and push to `main`, using Node
22. Handler tests use temporary data directories and lightweight fake Node request/response
objects; do not add Supertest or a DOM test stack. Store tests cover successful atomic
replacement, retention of the prior backup, and failure without loss of the last valid data.

A pushed SemVer tag triggers the release workflow. It verifies that the package version and tag
match, reruns the release-gating checks, and uses QEMU, Buildx, GHCR login with `GITHUB_TOKEN`,
Docker metadata, and `build-push-action` with `type=gha` caching. Publish
`linux/amd64,linux/arm64` with immutable `vX.Y.Z` and `sha-<short-commit>` tags and moving
`latest`, `vX`, and `vX.Y` aliases. Workflow permissions are `contents: read` and
`packages: write`.

The checked-in Compose file always pins an exact `vX.Y.Z`. Updates are manual and backup-first:
change the pinned tag, `docker compose pull`, `docker compose up -d`, verify health and the
collection, and repin the prior image to roll back. Persisted JSON changes must remain additive
and backward-compatible; a breaking shape change requires a separately designed versioned
migration.

The first publish is not complete until a maintainer changes the GHCR package visibility to
Public in GitHub's UI and verifies an unauthenticated arm64 pull from a clean machine. Do not
claim that GHCR offers unlimited pulls.

## Raspberry Pi 3 release acceptance

Before `v1.0.0`, run the published arm64 image on a 1 GB Raspberry Pi 3 with 64-bit Raspberry Pi
OS. Exercise five concurrent browsing clients for 30 minutes, including initial load, search,
record details, cover requests, and API reads. Acceptance requires no OOM, process restart,
corrupt write, or visibly unresponsive collection/API use. Record observed CPU, memory, and
latency without inventing permanent hard limits. If it fails, optimize or revise the support
statement before release.

## Implementation sequence

The follow-on files have `Kind: implementation` and no wayfinder `Type:`; they are the build
handoff, not open decision tickets on this completed map. Each file names its required model and
blockers. Run all tickets in a wave in parallel when separate worktrees are available, then
finish the wave before starting the next:

1. **Wave 1 - independent foundations and UI**
   - [Implement the runtime configuration module](issues/16-runtime-config.md)
   - [Implement power-loss-safe JSON storage](issues/17-durable-json-store.md)
   - [Add the share collection QR modal](issues/25-share-qr-modal.md)
2. **Wave 2 - handler foundation and CI**
   - [Build the handler shell and migrate records and genres](issues/18-records-genre-handler.md)
   - [Add the Node 22 CI workflow](issues/30-ci-workflow.md)
3. **Wave 3 - independent API routes**
   - [Move the iTunes proxy into the shared handler](issues/19-itunes-handler.md)
   - [Implement the server-side Discogs credential boundary](issues/20-discogs-server-boundary.md)
4. **Wave 4 - development adapter**
   - [Replace the five Vite API plugins with one adapter](issues/22-vite-api-adapter.md)
5. **Wave 5 - client and production adapters**
   - [Migrate the Discogs client to the server credential contract](issues/21-discogs-client-migration.md)
   - [Add the production Express server](issues/23-production-express-server.md)
6. **Wave 6 - deployment surfaces**
   - [Implement prompted PWA updates](issues/24-pwa-update-flow.md)
   - [Build the production container image](issues/26-container-image.md)
   - [Add the no-Docker systemd fallback](issues/28-systemd-fallback.md)
7. **Wave 7 - operational integration**
   - [Add the Docker Compose deployment](issues/27-compose-deployment.md)
   - [Add the multi-architecture GHCR release workflow](issues/31-ghcr-release-workflow.md)
8. **Wave 8 - migration and hardware acceptance**
   - [Implement and validate legacy Pi data migration](issues/29-legacy-pi-migration.md)
   - [Implement and verify volume backup and restore](issues/35-volume-backup-restore.md)
   - [Run Raspberry Pi 3 release acceptance](issues/33-pi3-acceptance.md)
   - [Verify the systemd fallback on Linux](issues/36-systemd-acceptance.md)
9. **Wave 9 - operator documentation**
   - [Write the README quickstart and deployment guide](issues/32-operator-docs.md)
10. **Wave 10 - public release**
    - [Publish and verify v1.0.0](issues/34-first-release.md)

## README quickstart

Under a **Run it on your LAN** heading, the quickstart is exactly these ten logical lines:

1. Vinyl Inventory runs on a trusted LAN; it has no real authentication and must not be exposed to the internet.
2. You need Docker Compose and a 64-bit AMD64 or ARM64 host, including a Raspberry Pi 3 with 64-bit Raspberry Pi OS.
3. Create a deployment directory: `mkdir vinyl-inventory && cd vinyl-inventory`.
4. Download the pinned release file: `curl -fsSLO https://raw.githubusercontent.com/andreaskinga-lgtm/Vinyl-Inventory/v1.0.0/compose.yaml`.
5. Start it: `docker compose up -d`.
6. Verify it: `curl -f http://localhost/health`.
7. Reserve the host's IP address in your router so the guest URL does not change.
8. Open `http://<reserved-ip>` on another device connected to the same LAN.
9. The first run has an empty collection; enter edit mode to add records and optionally configure Discogs.
10. See [`docs/deployment.md`](docs/deployment.md) for credentials, addressing, backup, migration, updates, systemd, Pi notes, and troubleshooting.

Keep contributor setup (`npm ci`, `npm run dev`) in a separate development section.

## `docs/deployment.md` outline

1. **Requirements** - supported architectures, Docker/Compose, 64-bit Pi OS, and trusted-LAN
   boundary.
2. **Choose an address** - DHCP reservation, best-effort `vinyl.local`, port 80, and override.
3. **Docker Compose install** - pinned file/image, first startup, health verification, and
   boot-time Docker service.
4. **Configuration and Discogs credentials** - every environment variable, precedence,
   `.env` permissions, and saved fallback warning.
5. **First-run data** - empty collection, genre initialization, named volume, and ownership.
6. **Existing-Pi migration** - preflight, closed transfer set, credential warning, copy,
   verification, and rollback.
7. **Backup and restore** - stopped whole-volume archives, off-device retention, secret handling,
   optional scheduling, and full restore.
8. **Updates and rollback** - release selection, backup, pull/up, checks, image rollback, and
   data compatibility.
9. **No-Docker systemd fallback** - user, paths, environment file, build, unit, logs, updates,
   and port behavior.
10. **Raspberry Pi notes** - 64-bit requirement, no on-device builds, Avahi, runtime acceptance,
    and no premature resource limits.
11. **PWA and update behavior** - install, 15-minute checks, reload prompt, and stale-client
    expectations.
12. **Troubleshooting** - health failures, permissions, malformed JSON, occupied ports, client
    isolation, mDNS, image architecture, and credential source.
13. **Security boundaries** - LAN-only posture, cosmetic edit password, token exposure,
    environment/volume/backup secrets, and explicit non-support for internet exposure.

## Completion criteria

- Development and production execute the same API handler implementation.
- A fresh Compose install initializes an empty, writable collection and survives restart.
- All writes are atomic and retain one valid backup.
- No endpoint, browser request, log, or UI response reveals a Discogs token.
- The production app serves correctly at the reserved-IP URL and never routes API requests to
  the SPA fallback.
- A phone can scan the in-app QR, browse without sign-in, and receive a prompted PWA update.
- Backup, restore, migration, update, rollback, systemd, and troubleshooting procedures are
  executable by a reader with no repository context.
- CI passes and the public GHCR manifest contains working amd64 and arm64 images.
- The Pi 3 release acceptance run passes before the README claims support.
