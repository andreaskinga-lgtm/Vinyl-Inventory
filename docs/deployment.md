# Deploying Vinyl Inventory

## 1. Requirements

Vinyl Inventory is a trusted-LAN service, not an internet service. It has no real authentication
or authorization, so do not expose it through port forwarding, a public reverse proxy, or a
public hostname. Use Docker Compose and Git on a 64-bit `linux/amd64` or `linux/arm64` host. A
Raspberry Pi 3 must run 64-bit Raspberry Pi OS; building images on the Pi is not a supported
installation path.

The checked-in deployment pin is `ghcr.io/andreaskinga-lgtm/vinyl-inventory:v1.0.0`. Public GHCR
availability remains unverified until a maintainer makes the package public and verifies an
unauthenticated arm64 pull from a clean machine. Do not assume unlimited GHCR pulls.

## 2. Choose an address

Reserve the host's IP address in the router's DHCP settings. Guests should use
`http://<reserved-ip>`; this is the reliable address. `http://vinyl.local` is only best effort:
install and configure Avahi on the **host** if the local network and client devices support mDNS.
The container does not advertise mDNS.

Compose publishes host port 80 to the application's port 8080. If port 80 is already occupied,
use the supplied override from the deployment directory:

```sh
docker compose -f compose.yaml -f deploy/compose/port-override.yaml up -d
curl --fail --silent --show-error http://localhost:8080/health
```

The override changes only the host port; guests must then use `http://<reserved-ip>:8080`.

## 3. Docker Compose install

Clone the pinned release so the Compose file, port override, backup scripts, and migration tool
are all available locally, then start it:

```sh
git clone --branch v1.0.0 --depth 1 \
  https://github.com/andreaskinga-lgtm/Vinyl-Inventory.git vinyl-inventory
cd vinyl-inventory
docker compose up -d
curl --fail --silent --show-error http://localhost/health
curl --fail --silent --show-error http://localhost/api/records
```

`app` restarts unless stopped and Compose uses the named `vinyl-inventory-data` volume. Enable
Docker itself at boot using the host operating system's normal Docker-service setup, then reboot
or restart Docker and confirm the service returns:

```sh
docker compose ps
curl --fail --silent --show-error http://localhost/health
```

## 4. Configuration and Discogs credentials

Compose sets `NODE_ENV=production` and `DATA_DIR=/data`. Optional `DISCOGS_USER` and
`DISCOGS_TOKEN` are interpolated from a `.env` file in the Compose directory. They must be a
complete pair; partial environment credentials prevent startup. Keep `.env` secret:

```sh
umask 077
printf '%s\n' 'DISCOGS_USER=your-discogs-username' 'DISCOGS_TOKEN=your-token' > .env
chmod 600 .env
docker compose up -d
curl --fail --silent --show-error http://localhost/api/discogs-config
```

`PORT` defaults to `8080` and accepts integers from 1 through 65535. `DATA_DIR` defaults to
`data`, and relative values resolve from the server working directory. `NODE_ENV` accepts only
`development`, `test`, or `production`. In Compose, do not override `DATA_DIR=/data`.

An environment credential pair is authoritative and read-only in the app. Without it, the UI can
save a complete credential pair in `discogsConfig.json` as a trusted-LAN fallback. That file is
in the data volume and is a secret. The API exposes an effective username, `hasToken`, and source
(`environment`, `saved`, or `none`), never the token.

## 5. First-run data

On first start, the application creates `/data`, `records.json` as an empty array, and
`genreOptions.json` from its shipped defaults. It does not create `discogsConfig.json` until you
explicitly save credentials. The `node` user owns the container data directory and can initialize
a fresh `vinyl-inventory-data` volume.

Confirm the new collection is readable before adding records:

```sh
curl --fail --silent --show-error http://localhost/health
curl --fail --silent --show-error http://localhost/api/records
```

## 6. Existing-Pi migration

Stop every writer to the old project-local `data/` directory and archive it before migration.
Only `records.json`, `genreOptions.json`, optional `discogsConfig.json`, and their matching
`.bak` files transfer. Temporary files, unrelated files, symlinks, and OS metadata do not.
The migration parses the required files and syntax-checks saved credentials without printing them.

From a source checkout, set the operator-specific values and run the migration. Before public
release availability is verified, authenticate to GHCR with a least-privilege `read:packages`
token and use the published candidate image. Remove the Docker credential after testing.

```sh
export LEGACY_DATA_DIR=/absolute/path/to/Vinyl-Inventory/data
export GHCR_USERNAME=your-github-username
export GHCR_READ_PACKAGES_TOKEN=your-read-packages-token
printf '%s' "$GHCR_READ_PACKAGES_TOKEN" |
  docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin
export VINYL_IMAGE=ghcr.io/andreaskinga-lgtm/vinyl-inventory:sha-bb1fb8c
export LEGACY_START_COMMAND='sudo systemctl start your-legacy-vinyl-service'
export LEGACY_ARCHIVE="$HOME/vinyl-legacy-$(date +%Y%m%d-%H%M%S).tar.gz"
test -d "$LEGACY_DATA_DIR"

sudo systemctl stop your-legacy-vinyl-service
tar -C "$(dirname "$LEGACY_DATA_DIR")" -czf "$LEGACY_ARCHIVE" "$(basename "$LEGACY_DATA_DIR")"
tar -tzf "$LEGACY_ARCHIVE" >/dev/null
tar -tzf "$LEGACY_ARCHIVE" | grep -Fqx "$(basename "$LEGACY_DATA_DIR")/records.json"
tar -tzf "$LEGACY_ARCHIVE" | grep -Fqx "$(basename "$LEGACY_DATA_DIR")/genreOptions.json"

docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml \
  run --rm --user root --no-deps \
  --volume "$LEGACY_DATA_DIR:/legacy:ro" \
  app node server/migrate-legacy-data.js --source /legacy --target /data
docker logout ghcr.io
```

The target must be a pristine first-run volume. A used target requires an explicit, separately
considered `--overwrite`, which retains the previous primary as its `.bak`. Start the candidate,
then verify health, the expected record count, two known independent pressings, and the expected
credential source:

```sh
export EXPECTED_RECORD_COUNT=123
export PRESSING_ONE_ID='replace-with-first-record-id'
export PRESSING_TWO_ID='replace-with-second-record-id'
export EXPECTED_DISCOGS_SOURCE=saved

docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml up -d
curl --fail --silent --show-error http://127.0.0.1/health
curl --fail --silent --show-error http://127.0.0.1/api/records | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const records = JSON.parse(input);
  const first = records.find(record => String(record.id) === process.env.PRESSING_ONE_ID);
  const second = records.find(record => String(record.id) === process.env.PRESSING_TWO_ID);
  if (records.length !== Number(process.env.EXPECTED_RECORD_COUNT)) process.exit(1);
  if (!first || !second || first.id === second.id) process.exit(1);
  if (first.artist !== second.artist || first.title !== second.title) process.exit(1);
  console.log(`Verified ${records.length} records and two independent pressings.`);
});'
curl --fail --silent --show-error http://127.0.0.1/api/discogs-config | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk).on("end", () => {
  const config = JSON.parse(input);
  if (config.source !== process.env.EXPECTED_DISCOGS_SOURCE) process.exit(1);
  console.log(`Verified Discogs credential source: ${config.source}`);
});'
docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml exec \
  app node -e "Promise.all(['records.json','genreOptions.json'].map(async name => {
    await import('node:fs/promises').then(fs => fs.access('/data/' + name, fs.constants.R_OK));
  })).catch(() => process.exit(1))"
```

If any check fails, keep the failed volume, stop Compose without `-v`, and restart the untouched
legacy service:

```sh
docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml down
sh -c "$LEGACY_START_COMMAND"
```

## 7. Backup and restore

Run these commands from the directory containing `compose.yaml`. Archives contain the complete
`vinyl-inventory-data` volume and may contain `discogsConfig.json`; treat each archive as a
secret, retain multiple dated copies, and copy them to encrypted off-Pi storage.

```sh
install -d -m 0700 "$HOME/vinyl-inventory-backups"
./deploy/backup/backup-volume.sh "$HOME/vinyl-inventory-backups"
```

The backup script stops `app` before reading the volume, validates the archive, and restarts only
if it stopped the service. Its last line is the archive's absolute path. Verify that archive by
listing it, then store it off-device:

```sh
tar -tzf /absolute/path/reported/by-the-script.tar.gz >/dev/null
```

Restore is destructive. Record the current count, restore one selected whole-volume archive, and
verify the health endpoint and restored count:

```sh
curl --fail --silent --show-error http://localhost/api/records |
  node -e 'let body="";process.stdin.on("data",c=>body+=c).on("end",()=>console.log(JSON.parse(body).length))'
ARCHIVE="$HOME/vinyl-inventory-backups/vinyl-inventory-data-YYYYMMDDTHHMMSSZ.tar.gz"
./deploy/backup/restore-volume.sh "$ARCHIVE" "$HOME/vinyl-inventory-backups"
curl --fail --silent --show-error http://localhost/health
curl --fail --silent --show-error http://localhost/api/records |
  node -e 'let body="";process.stdin.on("data",c=>body+=c).on("end",()=>console.log(JSON.parse(body).length))'
```

The restore script saves a `pre-restore` archive and attempts to preserve a failed state. Confirm
the count and a known record in the UI. To roll back, restore the reported `pre-restore` archive.
The supplied systemd backup service and timer are optional examples: edit their explicit backup
destination, create it with mode `0700`, copy both units to `/etc/systemd/system/`, then run
`sudo systemctl daemon-reload` and `sudo systemctl enable --now vinyl-inventory-backup.timer`.
They install no scheduler and delete no archives.

## 8. Updates and rollback

Back up first. The public GHCR release remains unverified until a maintainer makes the package
public and verifies an unauthenticated arm64 pull from a clean machine. Do not run this public
release procedure, or assume unlimited GHCR pulls, until that check passes. Maintainers testing
the private candidate must authenticate with a least-privilege `read:packages` token, use
`VINYL_IMAGE=ghcr.io/andreaskinga-lgtm/vinyl-inventory:sha-bb1fb8c` with
`deploy/compose/compose.candidate.yaml`, and remove the credential after testing.

Once public release availability is verified, choose an explicit release tag, replace the image
tag in `compose.yaml`, then pull, start, and verify:

```sh
./deploy/backup/backup-volume.sh "$HOME/vinyl-inventory-backups"
docker compose pull
docker compose up -d
curl --fail --silent --show-error http://localhost/health
curl --fail --silent --show-error http://localhost/api/records
```

Persisted JSON changes are additive and backward-compatible. To roll back the image, restore the
previous explicit `vX.Y.Z` tag in `compose.yaml`, run the same `pull`, `up -d`, health, and
collection checks. Restore the backup only when collection data also needs recovery.

## 9. No-Docker systemd fallback

This fallback needs a Debian-family 64-bit host with Node 22 and Git. It runs on port 8080, as
the non-login `vinyl-inventory` user, from `/opt/vinyl-inventory`, with data at
`/var/lib/vinyl-inventory`. Its root-owned, mode-0600 secret file is
`/etc/vinyl-inventory.env`. Follow the exact [systemd installation guide](../deploy/systemd/README.md).

After installation, verify the service and its collection:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/health
curl --fail --silent --show-error http://127.0.0.1:8080/api/records
sudo systemctl is-active --quiet vinyl-inventory.service
sudo journalctl -u vinyl-inventory.service -n 50 --no-pager
```

Use the guide's backup-first update procedure with an explicit release tag. It runs `npm ci`,
`npm run build`, and `npm prune --omit=dev` before restarting. Port 80, reverse proxying, and TLS
are advanced, operator-owned choices; do not grant this fallback a privileged port by default.

## 10. Raspberry Pi notes

Use 64-bit Raspberry Pi OS on a Pi 3 and pull prebuilt arm64 images; do not build on-device.
There are no CPU or memory limits in Compose until measurements justify them. Host Avahi may
advertise `vinyl.local`, but clients and networks vary, so use the DHCP-reserved IP as the
reliable guest URL.

The Pi 3 acceptance ticket is marked resolved, but it does not yet record its required hardware,
OS, image, and 30-minute five-client evidence. Do not make a stronger performance claim until
that evidence is recorded. After any deployment, verify the running service directly:

```sh
docker compose ps
curl --fail --silent --show-error http://localhost/health
```

## 11. PWA and update behavior

Guests can install the app as a PWA. Production clients check for a new service worker every
15 minutes. A waiting worker shows **New version available - Reload** and updates only when the
user chooses Reload or later reopens the app; it never forces a reload.

Clients can remain on an old shell until they accept the update. API requests stay outside the
service worker navigation fallback. Verify a deployed client can still receive API JSON:

```sh
curl --fail --silent --show-error http://localhost/api/records
```

## 12. Troubleshooting

If `/health` fails, inspect the container and logs, then retry the health check:

```sh
docker compose ps
docker compose logs app
curl --fail --silent --show-error http://localhost/health
```

For a port conflict, use the port override in section 2. For a host firewall, allow the selected
LAN TCP port only, then verify from another LAN device. Guest Wi-Fi often enables client
isolation; move the guest to a non-isolated LAN/SSID and open `http://<reserved-ip>`. If
`vinyl.local` fails, use the reserved IP and check Avahi and client mDNS support. If an image
will not run, confirm the host is 64-bit amd64 or arm64 and that the published manifest includes
that architecture.

Storage permission or malformed-JSON startup failures are deliberate fail-closed errors. Inspect
the data directory or mounted volume, retain the primary and `.bak` files, and restore a known
good whole-volume archive rather than editing credentials or collection JSON blindly. For
Discogs, call `/api/discogs-config`: `environment` means `.env` is authoritative, `saved` means
the volume fallback is active, and `none` means configure a complete pair. Verify after each
change:

```sh
curl --fail --silent --show-error http://localhost/api/discogs-config
```

## 13. Security boundaries

This application is LAN-only. The edit-mode password is cosmetic, not access control. Do not
expose it to the internet, even through TLS, a reverse proxy, a tunnel, or port forwarding.

Discogs tokens must never appear in browser URLs, logs, shell history, screenshots, or support
requests. Treat `.env`, `discogsConfig.json`, the entire data volume, and every backup archive as
secrets. Use restrictive file permissions and encrypted off-device backup storage. Real
authentication, authorization, TLS termination, remote access, and internet-safe operation are
not supported by this deployment.
