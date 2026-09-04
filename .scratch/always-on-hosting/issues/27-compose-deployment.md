Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 26

# Add the Docker Compose deployment

## Goal

Define the one-service, named-volume LAN deployment without mixing in image publishing or
operator documentation.

Before editing, read **Container and Compose deployment** in
[`Always-on LAN hosting`](../spec.md) and
[`The Compose file and how the box is addressed`](07-compose-and-addressing.md).

## Files

- Add root `compose.yaml`.
- Add a narrowly scoped port-override example under `deploy/compose/`.
- Add `deploy/compose/compose.candidate.yaml`, setting
  `image: ${VINYL_IMAGE:?set VINYL_IMAGE}`, for pre-release testing while root `compose.yaml`
  remains pinned to `v1.0.0`.

## Steps

1. Define one `app` service with the exact image name and first-release `v1.0.0` pin.
2. Set `init: true`, `restart: unless-stopped`, `80:8080`, `NODE_ENV=production`, and
   `DATA_DIR=/data`.
3. Mount named volume `vinyl-inventory-data` at `/data`.
4. Interpolate optional Discogs variables from the environment without embedding secrets.
5. Add this Node-based healthcheck, because the slim image does not contain curl or wget:
   `CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]`.
6. Keep bridge networking and add no CPU/memory limit, mDNS sidecar, privileged user, or extra
   capability.

## Completion criteria

- `docker compose config` resolves with and without optional Discogs variables.
- Tag the local image as `vinyl-inventory:local`, set `VINYL_IMAGE=vinyl-inventory:local`, and
  use the candidate override for the pre-release Compose smoke test. It becomes healthy and
  serves the app on the configured host port.
- Recreating the container preserves the named-volume collection.
- The override moves only the host port and leaves container port 8080 unchanged.
