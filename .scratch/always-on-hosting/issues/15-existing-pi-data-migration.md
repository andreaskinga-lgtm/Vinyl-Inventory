Type: grilling
Status: resolved
Blocked by: 03, 04, 07

# Migrating the existing Pi collection into the named volume

## Question

The deployed service changes its persisted-data location from the current project-local `data/`
directory to the Compose-owned `vinyl-inventory-data` volume at `/data`. Decide the exact,
stranger-safe migration procedure for an existing Pi: the pre-migration backup, service stop
order, which files are copied (including the existing Discogs configuration), ownership checks
for the non-root container, verification before retiring the old directory, and rollback if the
new container fails to load the collection.

The decision must respect the credential precedence and saved-credentials behavior settled in
**Discogs credentials on a guest-accessible LAN**, and the final Compose service name/volume
details settled in **The Compose file and how the box is addressed**.

## Answer

Migration is an explicit, administrator-run cutover; no application startup logic discovers or
copies a legacy directory. Before it begins, the operator stops every process that can write the
old project-local `data/` directory and creates a dated backup of that directory. The legacy
directory remains untouched throughout migration and is retained after verification.

The deployment guide first runs a source-only preflight, before changing the named volume. It
parses the required `records.json` and `genreOptions.json` files, and stops on malformed JSON.
It syntax-checks any optional `discogsConfig.json` without reading its values into output. The
transfer set is deliberately closed: copy those three recognized primary files when present and
their matching `.bak` recovery files when present; exclude temporary files, unrelated files, and
OS metadata such as `.DS_Store`. Copying `discogsConfig.json` is permitted only in this explicit
administrator action, with a warning that the target volume and volume backups now contain the
saved credential. It is copied verbatim after the syntax check, so normal server-side credential
precedence continues to determine whether it is effective.

The Compose service key is `app`; it uses the `vinyl-inventory-data` named volume mounted at
`/data`. The guide uses a one-time `docker compose run --rm --user root` invocation of that
service's image, with the old directory bind-mounted read-only at `/legacy`. That command copies
the validated transfer set into `/data` and assigns ownership to the image's named `node` user.
The normal long-running `app` service remains unprivileged; there is no persistent root helper
or host-path access to the Docker-managed volume.

Success requires starting Compose and confirming `/health`, the expected record count and a few
known independent pressings, and the expected Discogs credential source (`environment`, `saved`,
or `none`). If any check fails, rollback stops Compose and restarts the legacy service against
the unchanged project-local directory. The copied named volume is retained for inspection rather
than deleted. The old directory may be retired only after a separately verified backup and an
explicit operator decision.
