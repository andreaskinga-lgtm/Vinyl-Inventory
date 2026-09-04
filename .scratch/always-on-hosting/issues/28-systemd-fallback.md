Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 16, 23

# Add the no-Docker systemd fallback

## Goal

Provide exact source-install artifacts for operators who cannot use Docker, without adding a
reverse proxy or privileged-port mechanism.

Before editing, read **No-Docker systemd fallback** in
[`Always-on LAN hosting`](../spec.md).

## Files

- Add `deploy/systemd/vinyl-inventory.service`.
- Add `deploy/systemd/vinyl-inventory.env.example`.
- Add a concise installation/update fragment for later inclusion by the documentation ticket.

## Steps

1. Use non-login user `vinyl-inventory`, checkout `/opt/vinyl-inventory`, data
   `/var/lib/vinyl-inventory`, and root-owned mode-0600 `/etc/vinyl-inventory.env`.
2. Set the unit's `WorkingDirectory`, `EnvironmentFile`, exact Node entry point,
   `Restart=on-failure`, and journald-compatible output.
3. Bind to 8080 by default.
4. Specify install/update commands as `npm ci`, `npm run build`, and
   `npm prune --omit=dev`, with backup before stop/update/restart.

## Completion criteria

- `systemd-analyze verify` accepts the unit.
- The service writes only its data directory and exposes logs through `journalctl`.
- The update fragment uses an explicit release tag and includes health and collection checks.
- Port 80, reverse proxying, and TLS remain clearly operator-owned advanced options.
- Host installation and reboot verification are deferred to
  **Verify the systemd fallback on Linux**.
