# Volume backup and restore

Run these commands from the directory containing `compose.yaml`. Each archive contains the
entire `vinyl-inventory-data` volume, potentially including `discogsConfig.json`. **Treat every
archive as a secret:** keep its permissions restricted, retain multiple dated copies, and copy
them off the Pi and its SD card.

## Back up

Choose a destination outside the Docker volume. The script stops `app` before reading the
volume, creates and validates a timestamped archive, and restarts `app` only if the script
stopped it.

```sh
install -d -m 0700 "$HOME/vinyl-inventory-backups"
./deploy/backup/backup-volume.sh "$HOME/vinyl-inventory-backups"
```

The final output line is the archive's absolute path. Copy that file to encrypted off-Pi
storage. Decide and perform retention explicitly; the script never deletes an archive.

## Restore

First record the current collection count so it can be compared with the selected archive after
restore:

```sh
curl --fail --silent --show-error http://localhost/api/records |
  node -e 'let body="";process.stdin.on("data",c=>body+=c).on("end",()=>console.log(JSON.parse(body).length))'
```

Restore is destructive. The script validates the selected archive in a staging volume, stops
the writer, creates a timestamped `pre-restore` archive of the current whole volume, replaces
the volume, and waits for `app` to become healthy. If replacement fails, it leaves `app`
stopped, retains the pre-restore archive, and attempts to archive the failed state for diagnosis.

```sh
ARCHIVE="$HOME/vinyl-inventory-backups/vinyl-inventory-data-YYYYMMDDTHHMMSSZ.tar.gz"
./deploy/backup/restore-volume.sh \
  "$ARCHIVE" \
  "$HOME/vinyl-inventory-backups"
curl --fail --silent --show-error http://localhost/health
curl --fail --silent --show-error http://localhost/api/records |
  node -e 'let body="";process.stdin.on("data",c=>body+=c).on("end",()=>console.log(JSON.parse(body).length))'
```

Confirm the restored count and a known record in the UI. To roll back, pass the reported
`pre-restore` archive to the same restore command.

## Optional systemd timer

`vinyl-inventory-backup.service` and `.timer` are examples only; nothing installs or enables
them automatically. Before installing them, edit the service's explicit
`BACKUP_DESTINATION`, ensure that directory exists with mode `0700`, and ensure the service
can access Docker and write there. The example runs explicitly as root because Docker socket
access is root-equivalent; keep the script and checkout root-owned and not writable by other
users. Then copy both files to `/etc/systemd/system/`, run
`systemctl daemon-reload`, and explicitly enable the timer if desired:

```sh
sudo systemctl enable --now vinyl-inventory-backup.timer
```

Review archives regularly, copy retained backups off the Pi, and remove expired archives
manually according to your retention policy. The timer performs no implicit deletion.
