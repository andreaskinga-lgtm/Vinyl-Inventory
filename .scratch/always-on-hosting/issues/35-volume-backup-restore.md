Status: resolved
Kind: implementation
Model: gpt-5.6-sol
Blocked by: 27

# Implement and verify volume backup and restore

## Goal

Own the complete, data-loss-sensitive backup/restore path so the documentation ticket consumes
tested commands rather than inventing them.

Before editing, read **Backup, restore, and legacy migration** in
[`Always-on LAN hosting`](../spec.md) and
[`Data directory: seeding, atomic writes, backup and restore`](03-data-directory.md).
Keep stopped-volume archive, destructive restore, verification, and rollback together under Sol.

## Files

- Add executable backup and restore scripts under `deploy/backup/`.
- Add an optional systemd service/timer example that invokes backup only; do not install or enable
  it automatically.
- Add a runbook fragment consumed by **Write the README quickstart and deployment guide**.

## Completion criteria

- Backup stops or confirms the `app` writer is stopped, archives the whole named volume to a
  timestamped destination outside that volume, and restarts only when it stopped the service.
- Restore refuses a missing/invalid archive, stops the writer, creates a pre-restore archive of
  the current volume, restores one whole archive, and preserves the failed/current state for
  rollback.
- Paths and archive names are safely quoted; credentials are never printed; the fragment labels
  archives as secrets and recommends off-Pi retention.
- An automated fixture round trip proves records, genres, credentials, and `.bak` files restore
  byte-for-byte.
- A Compose round trip ends with `/health` success and the original record count.
- The optional timer has explicit destination configuration and retention guidance but performs
  no implicit deletion.

## Comments

- Added fail-closed whole-volume backup and restore commands, including writer-state handling,
  staged archive validation, pre-restore and failed-state archives, and conditional restart.
- Added a standalone automated fixture that restores records, genres, credentials, and `.bak`
  files byte-for-byte, plus invalid-archive and restarting-writer coverage.
- Ran a real local-image Compose round trip: `/health` returned `{"ok":true}` and the restored
  API record count matched the original count of 2.
- Added an optional hardened systemd backup timer example and a runbook fragment with secret,
  off-Pi retention, verification, and rollback guidance. The timer deletes nothing.
- Final Standards and Spec reviews reported no significant issues.
