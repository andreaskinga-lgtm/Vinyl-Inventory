Type: prototype
Status: resolved
Blocked by:

# Where the dev/prod seam sits in the API layer

## Question

`vite.config.js` holds five plugins (`recordsApiPlugin`, `genreOptionsApiPlugin`,
`itunesApiPlugin`, `discogsConfigApiPlugin`, `discogsApiPlugin`, lines 34–564) that only exist
in dev. Production needs the same behaviour from an Express server that also serves `dist/`.

What is the module layout and interface of the extracted handler layer, such that the dev
plugins and the prod server are provably running the _same_ code? Specifically: what does a
handler module export, where does path routing live, how is `DATA_DIR` injected rather than
hardcoded, and how thin can the Vite plugins become?

Make it concrete: stub `server/` (bootstrap, handlers, config) and rewrite one plugin
(`recordsApiPlugin`) as a wrapper over the shared handler, so the seam can be reacted to before
the other four follow.

Consult the `codebase-design` skill (module, interface, depth, seam, adapter). Note the sibling
architecture candidate `.scratch/collection-module-persistence-seam/spec.md`, which owns the
client side of the same boundary — check they meet cleanly rather than fighting.

## Answer

Use one deep `server/api-handler.js` module with the small interface
`createApiHandler({ dataDir, fetch, discogsEnvironment = null }) -> (req, res, next)`. It owns all `/api/*` and
`/api.php` method/path routing, request parsing and validation, JSON-file access, outbound
iTunes/Discogs calls, and HTTP responses. `dataDir` is resolved once by
`server/config.js` and injected by the caller; handlers never inspect environment variables or
assume a working-directory path. `discogsEnvironment` is the nullable, already-validated
credential pair from `server/config.js`; passing it explicitly preserves the environment-free
handler seam. The later configuration ticket owns the exact configuration shape and validation
rules.

The handler speaks Node's request/response middleware convention, which both adapters support:
`server/app.js` mounts it into Express before the static-file and SPA-fallback handlers, while
one Vite `apiPlugin` mounts that exact returned function with
`server.middlewares.use(apiHandler)`. The five per-endpoint Vite plugins disappear. This is a
real seam with two adapters, not duplicated route logic: development and production execute the
same handler implementation for every API request.

The client keeps its existing HTTP contract (`/api/records`, `/api/genre-options`,
`/api/discogs-*`, `/api.php`), so this meets the Collection candidate cleanly without adopting
its proposed browser `localStorage` persistence adapter; that candidate's stated production
assumption is superseded by this map's real server destination.

The approved interactive prototype is preserved on branch `prototype/handler-seam` at
`15fe60b`: `server/handler-seam.prototype.html`.
