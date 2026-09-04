# Map: Always-on hosting

Label: `wayfinder:map`

## Destination

A **spec** (plus a README/docs outline) that anyone can implement to run Vinyl Inventory as a
permanently-on LAN service: a real Node server that serves the production build and the API,
packaged as a portable multi-arch container, with instructions clear enough that a stranger
reading the README gets it running on their own hardware. Planning only — the map resolves
decisions; the build is a follow-on effort.

## Notes

- **Domain**: home-lab deployment of a React/Vite SPA whose entire API currently exists only as
  dev-time Vite middleware (`vite.config.js`, 5 plugins, lines 34–564). `npm run build` today
  produces a static SPA with **no backend**, which is why `npm run dev` on the Pi is the only
  thing that works.
- **Skills every session should consult**: `grilling` and `domain-modeling` by default;
  `codebase-design` for the handler-seam ticket; `research` for the research tickets;
  `prototype` for the prototype tickets.
- **Standing preferences** (settled while charting, 2026-09-04):
  - Express for the extracted server; handlers shared between dev and prod so they can't drift.
  - Docker Compose is the documented happy path; bare-Node/systemd is the fallback.
  - Multi-arch images published to GHCR; local `--build` is the fallback.
  - LAN-only. Remote access, TLS and real auth are out of scope.
  - Storage stays JSON files in a mounted volume. SQLite is a separate effort.
  - Env-var config (`PORT`, `DATA_DIR`, `DISCOGS_*`). The edit-mode password stays a hardcoded
    client-side safeguard — it is not, and is not becoming, access control.
  - First run shows an **empty** collection (genre options seeded from the static fallbacks).
    Note `data/` is gitignored, so a fresh install has no seed files at all.
  - README gets a short quickstart; `docs/deployment.md` holds the detail.
- **Tracker note**: this repo uses the local-markdown tracker, so research findings are written
  to `.scratch/always-on-hosting/research/<name>.md` on the current branch rather than a
  throwaway `research/<name>` git branch.

## Decisions so far

<!-- one line per resolved ticket: gist + link -->

- [Where the dev/prod seam sits in the API layer](issues/01-handler-seam.md): one shared
  Node-style `createApiHandler({ dataDir, fetch, discogsEnvironment })` owns every API route;
  Vite and Express only mount its returned middleware, while `server/config.js` resolves and
  injects runtime config.
- [The runtime configuration contract](issues/02-config-contract.md): server-only runtime env
  (`PORT=8080`, working-directory-relative `DATA_DIR`, optional Discogs values), normalized
  paths and fail-fast validation; a tracked `.env.example`, with no browser-visible `VITE_*`
  configuration.
- [Data directory: seeding, atomic writes, backup and restore](issues/03-data-directory.md):
  empty records plus seeded genre options on first run; every JSON write is atomic with one
  prior-version backup; Compose uses a named volume with manual, whole-volume archives and
  opt-in scheduling guidance.
- [Research: vite-plugin-pwa autoUpdate and cache headers behind a Node server](issues/10-pwa-research.md):
  hashed `assets/*` immutable for a year, everything else (`index.html`, `sw.js`, `registerSW.js`,
  `manifest.webmanifest`) revalidated; `devOptions.enabled` off by default; `/api/*` must be
  denylisted from the navigate fallback — and a *prompted* update reads better than silent
  `autoUpdate` here, which cuts against the charting bias.
- [Research: containers on a Raspberry Pi, and mDNS from inside one](issues/05-docker-pi-research.md):
  target Node 22 LTS on `linux/amd64,linux/arm64` (a Pi 3 runs 64-bit Pi OS, so armv7 is opt-in
  legacy only); multi-stage build, non-root `node`, Docker init, `restart: unless-stopped` with
  `docker.service` enabled; **the container should not own mDNS** — publish the port and let the
  host's Avahi advertise, with a reserved IP as fallback; on-device Pi 3 builds are not a viable
  happy path, so CI-published images are load-bearing.
- [Research: publishing multi-arch images to GHCR from GitHub Actions](issues/08-ghcr-research.md):
  no blocker and zero cost — `contents: read` + `packages: write`, QEMU build with `type=gha`
  cache (free native `ubuntu-24.04-arm` runners as an escape hatch), publish `main`/`sha-*` plus
  `latest`+semver and pin `:latest` in compose. Anonymous pull is verified working, **but** the
  first publish is private and visibility is a UI-only checkbox with no REST endpoint — so
  "flip to Public, then verify a credential-free pull from a clean machine" is a load-bearing
  release step, not a runbook footnote. GHCR pull limits are undocumented, so the README must
  not claim "unlimited".
- [Discogs credentials on a guest-accessible LAN](issues/04-discogs-credentials.md): a complete
  environment pair is authoritative and read-only; an explicit saved-pair flow is a
  trusted-LAN fallback, never token-in-URL transport, with safe migration of existing config.
- [The Compose file and how the box is addressed](issues/07-compose-and-addressing.md): one
  unprivileged bridge-mode service maps host `80` to container `8080`; a DHCP-reserved IP is
  guaranteed, host-advertised `vinyl.local` is best-effort, and `/health` plus
  `restart: unless-stopped` provides liveness without premature resource limits.
- [Release, versioning and the update flow](issues/09-release-and-updates.md): stable releases
  start at `v1.0.0`, publish immutable SemVer images pinned by Compose, require manual
  backup-first updates, and permit additive-only JSON changes.
- [In-app share / QR view](issues/12-share-qr-view.md): a header-triggered modal renders a QR
  for the browser's current origin, with a concise no-sign-in invitation; no canonical URL or
  dedicated guest view.
- [PWA staleness policy and cache-header rules](issues/11-pwa-policy.md): guests choose a
  prompted reload after 15-minute update checks; entry and worker metadata revalidate while
  hashed assets stay immutable, and normal development leaves the service worker off.
- [CI scope and the handler test boundary](issues/13-ci-and-tests.md): Node 22 CI runs lint and
  Vitest on PRs and `main`; direct handler and atomic-write regression tests gate versioned
  GHCR releases.
- [Migrating the existing Pi collection into the named volume](issues/15-existing-pi-data-migration.md):
  an explicit, preflighted one-shot root copy transfers recognized JSON and recovery files into
  the `app` service's owned volume; the untouched legacy directory enables verification and
  non-destructive rollback.
- [Assemble the deployment spec and the docs outline](issues/14-spec-assembly.md): the
  implementation-ready spec, model-routed dependency waves, pinned-release quickstart,
  operator guide outline, systemd fallback, and Pi 3 release gate now form the complete handoff.

## Not yet specified

None. The route to the destination is fully specified.

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->

- [Confirm the router's addressing options](issues/06-router-facts.md): router-specific
  discovery validates an individual installation, but cannot decide portable setup guidance.
- **Remote/internet access** (Tailscale, Cloudflare Tunnel, DDNS, TLS). Guests are physically
  in the house; LAN-only is the destination.
- **Real authentication or authorization.** The edit-mode password stays a cosmetic safeguard.
- **Migrating storage to SQLite or a database.** JSON files stay.
- **Sample/demo data seeding.** Ruled out at chart time in favour of an empty first run.
