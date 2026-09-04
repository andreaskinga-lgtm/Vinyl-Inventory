Type: grilling
Status: resolved
Blocked by:

# Discogs credentials on a guest-accessible LAN

## Question

`discogsConfigApiPlugin` persists a Discogs username and personal access token to
`data/discogsConfig.json`, and `GET /api/discogs-config` currently hands it back. Once the app
is permanently on the LAN, any house guest's phone can hit that endpoint.

Decide: does `GET /api/discogs-config` return a presence boolean instead of the token; does the
env var (`DISCOGS_TOKEN`) take precedence over the file or the other way round; does the UI
save-credentials flow survive at all; and what happens to a token already sitting in the file on
Andrea's Pi when the new precedence rules land.

Constraint from charting: real auth is out of scope, and the edit-mode password stays as-is.
So the answer has to work with an unauthenticated LAN, not wish the problem away.

## Answer

Discogs credentials are a complete username/token pair with two mutually exclusive sources:

- A non-empty `DISCOGS_USER` or `DISCOGS_TOKEN` requires the other value too. The server
  fails fast on a partial environment pair. A complete environment pair is authoritative and
  the saved file is ignored.
- With no environment pair, a complete `discogsConfig.json` pair is a supported
  trusted-LAN fallback. Missing, malformed, or incomplete saved config is treated as
  unconfigured: the collection service still starts, and Discogs operations report that
  credentials are required.

`GET /api/discogs-config` must never expose a token. It returns the effective `username`,
`hasToken`, a non-secret `source` (`environment`, `saved`, or `none`), and `canEdit`.
Environment-managed credentials set `canEdit: false`; direct `POST` attempts return `409` and
make no file change. When the fallback is active, POST accepts and persists a complete trimmed
pair.

The production UI keeps editable fallback credentials only when no environment pair is active,
but replaces the current `Remember` behavior with an explicit **Save credentials** action.
Imports use the server-held resolved pair exclusively: the `?token=` request parameter is
removed, so a token cannot reach URLs, browser history, or request logs. An install without a
configured pair remains fully browseable and receives a clear `401` configuration-required
response from Discogs endpoints.

Existing Pi `discogsConfig.json` files are preserved unchanged as the fallback; migration never
copies or deletes a secret automatically. The deployment guide offers an optional manual move to
`.env`, followed by removal of the saved config from the mounted volume for operators who want
the environment-managed posture. The fallback is documented as suitable only for a trusted LAN:
devices with access can use the proxy under the saved token and replace it, and volume backups
include it.
