Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 23

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
