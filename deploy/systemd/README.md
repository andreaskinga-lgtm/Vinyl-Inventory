# No-Docker systemd fallback

This fallback runs the source checkout as the non-login `vinyl-inventory` user. It deliberately
keeps the application on port `8080`; port 80, reverse proxying, and TLS are advanced,
operator-owned options outside this unit.

## Initial install

Run these commands on a Debian-family host with Node 22 and Git installed. The release tag is
explicit so the checkout and the installed dependencies come from the same release.

```sh
set -eu

RELEASE_TAG=v1.0.0
APP_DIR=/opt/vinyl-inventory
DATA_DIR=/var/lib/vinyl-inventory
SERVICE=vinyl-inventory

sudo useradd --system --user-group --no-create-home \
  --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE"
sudo install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$DATA_DIR"
sudo install -d -o root -g root -m 0755 /opt
sudo git clone --branch "$RELEASE_TAG" --depth 1 \
  https://github.com/andreaskinga-lgtm/Vinyl-Inventory.git "$APP_DIR"
sudo chown -R "${SERVICE}:${SERVICE}" "$APP_DIR"

sudo install -o root -g root -m 0600 \
  "$APP_DIR/deploy/systemd/vinyl-inventory.env.example" \
  /etc/vinyl-inventory.env
sudoedit /etc/vinyl-inventory.env

sudo -u "$SERVICE" -- sh -c \
  'cd /opt/vinyl-inventory && npm ci && npm run build && npm prune --omit=dev'
sudo install -o root -g root -m 0644 \
  "$APP_DIR/deploy/systemd/vinyl-inventory.service" \
  /etc/systemd/system/vinyl-inventory.service
sudo systemctl daemon-reload
sudo systemctl enable --now vinyl-inventory.service
```

The environment file must remain root-owned with mode `0600`. The service can write its
persisted JSON and temporary files only under `/var/lib/vinyl-inventory`; its output is in the
system journal.

Verify the first start and collection response:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/health
printf '\n'
curl --fail --silent --show-error http://127.0.0.1:8080/api/records |
  node -e 'let body = ""; process.stdin.on("data", chunk => { body += chunk; }).on("end", () => { const records = JSON.parse(body); if (!Array.isArray(records)) process.exit(1); console.log(`Collection records: ${records.length}`); });'
sudo systemctl is-active --quiet vinyl-inventory.service
sudo journalctl -u vinyl-inventory.service -n 50 --no-pager
```

## Backup-first update

Set `RELEASE_TAG` to the exact release being installed; do not use a moving branch or alias.
The archive is created outside the data directory and may contain Discogs credentials, so retain
it as a secret.

```sh
set -eu

RELEASE_TAG=v1.0.0
BACKUP_DIR=/var/backups/vinyl-inventory
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

sudo install -d -o root -g root -m 0700 "$BACKUP_DIR"
sudo tar --create --gzip \
  --file="$BACKUP_DIR/vinyl-inventory-$STAMP.tar.gz" \
  --directory=/var/lib vinyl-inventory

sudo systemctl stop vinyl-inventory.service
sudo -u vinyl-inventory -- git -C /opt/vinyl-inventory fetch --tags --force
sudo -u vinyl-inventory -- git -C /opt/vinyl-inventory checkout --detach "$RELEASE_TAG"
sudo -u vinyl-inventory -- sh -c \
  'cd /opt/vinyl-inventory && npm ci && npm run build && npm prune --omit=dev'
sudo install -o root -g root -m 0644 \
  /opt/vinyl-inventory/deploy/systemd/vinyl-inventory.service \
  /etc/systemd/system/vinyl-inventory.service
sudo systemctl daemon-reload
sudo systemctl restart vinyl-inventory.service
```

Repeat the health, collection, active-service, and journal checks above after every update. To
roll back, stop the unit, check out the previous explicit release tag, repeat `npm ci`, `npm run
build`, and `npm prune --omit=dev`, then restart and verify again. Restore the dated archive only
when the collection itself needs recovery.
