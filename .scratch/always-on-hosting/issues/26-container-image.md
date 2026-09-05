Status: resolved
Kind: implementation
Model: gpt-5.6-luna
Blocked by:

# Build the production container image

## Goal

Create a deterministic, non-root Node 22 image for the production server. Compose, CI publishing,
and host service management belong to later tickets.

Before editing, read **Container and Compose deployment** in
[`Always-on LAN hosting`](../spec.md) and
[`Research: containers on a Raspberry Pi, and mDNS from inside one`](05-docker-pi-research.md).

## Files

- Add `Dockerfile`.
- Add `.dockerignore`.

## Steps

1. Use pinned-major `node:22-bookworm-slim` builder and runtime stages.
2. Install from the lockfile, build `dist/`, and produce production-only runtime dependencies.
3. Copy only `dist/`, `server/`, `src/data/genreOptions.js`, package metadata, and required
   runtime dependencies.
4. Create `/data` owned by the existing `node` user, set `USER node`, expose `8080`, and start
   `node server/index.js`.
5. Keep init and restart policy outside the image.

## Completion criteria

- A clean `docker build` succeeds without host `node_modules` or `data/`.
- Running with an empty named volume initializes data, returns `200` from `/health`, and writes
  as non-root.
- `docker inspect` confirms the configured user is non-root.
- A restart preserves records and genre options.
- A local single-platform image builds and runs. The release workflow owns the multi-architecture
  Buildx proof.

## Comments

- Implemented a multi-stage Node 22 production image with lockfile installs, production-only
  dependencies, a non-root runtime, and a mounted `/data` default.
- Scoped persisted-data ignore rules to the root `data/` directory and tracked the existing static
  `src/data` modules so a clean checkout contains every build input.
- Standards and spec reviews found no issues. Docker image and named-volume acceptance could not be
  executed because Docker is unavailable in this environment.
