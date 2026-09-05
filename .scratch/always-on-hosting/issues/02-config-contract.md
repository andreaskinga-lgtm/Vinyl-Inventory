Type: grilling
Status: resolved
Blocked by:

# The runtime configuration contract

## Question

What is the full env-var surface of the deployed server, and what are the defaults?

At minimum: `PORT`, `DATA_DIR`, `DISCOGS_TOKEN`, `DISCOGS_USER`, `NODE_ENV`. Open sub-questions:
what port number is the default (and why that one); is `DATA_DIR` absolute or relative; does the
server fail fast on bad config or fall back; is there a `.env.example`; and does anything need
to reach the *client* bundle (Vite `VITE_*` vars are baked at build time, which conflicts with a
prebuilt GHCR image — so client-visible config must be runtime-fetched or must not exist).

That last point is the sharp one: any config the browser needs cannot be a build-time env var
if we ship prebuilt images.

## Answer

The extracted server has a server-only, runtime configuration contract:

- `PORT` is an optional integer listener port, defaulting to `8080`. Compose will publish host
  port 80 to it, so guests use a URL with no port.
- `DATA_DIR` is optional and defaults to `data` relative to the server working directory. An
  explicit relative value is normalized from that directory; an absolute value is accepted and
  is the documented systemd choice. Compose explicitly sets `/data`.
- `DISCOGS_USER` and `DISCOGS_TOKEN` are optional server-only values. Their precedence and the
  UI's saved-credential behavior remain the decision owned by **Discogs credentials on a
  guest-accessible LAN**.
- `NODE_ENV` follows the conventional Node value (`development`, `test`, or `production`); it is
  not browser configuration and does not need a deployment-specific default beyond production in
  the container.

`PORT` must be a valid port number and `DATA_DIR` must be creatable and writable before the
server listens. Invalid configuration fails startup with a precise error; it never falls back to
another port or storage location. Missing data files are handled by the separate **Data
directory: seeding, atomic writes, backup and restore** decision.

Track `.env.example` with the non-secret defaults/placeholders (`PORT`, `DATA_DIR`,
`DISCOGS_USER`, an empty `DISCOGS_TOKEN`); a real `.env` stays ignored. No setting is exposed as
`VITE_*` or otherwise injected into the compiled browser bundle: browser API calls remain
same-origin and relative, while a future share URL derives from `window.location.origin`.
