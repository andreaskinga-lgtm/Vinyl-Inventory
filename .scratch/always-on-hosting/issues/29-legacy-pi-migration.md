Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-sol
Blocked by: 20, 27

# Implement and validate legacy Pi data migration

## Goal

Turn the approved cutover into one coherent, fail-closed migration utility and runbook fragment.

Before editing, read **Backup, restore, and legacy migration** in
[`Always-on LAN hosting`](../spec.md) and the full answer in
[`Migrating the existing Pi collection into the named volume`](15-existing-pi-data-migration.md).
Keep preflight, allowlisting, copy, ownership, verification, and rollback together: splitting a
destructive migration across agents would weaken its fail-closed boundary.

## Files

- Add `server/migrate-legacy-data.js` with explicit source and target arguments.
- Add focused tests using temporary source and target directories.
- Add a copy-paste `docker compose run --rm --user root` runbook fragment.

## Completion criteria

- Preflight completes before target mutation, parses required records/genres, and syntax-checks
  optional credentials without printing values.
- The transfer allowlist contains only recognized primaries and matching `.bak` files; temporary,
  unrelated, symlinked, and OS metadata entries do not transfer.
- Target writes cannot escape the resolved `/data` directory.
- A target is pristine only when records are exactly empty, genres equal the shipped defaults,
  saved credentials are absent, and no backup/history files exist. Refuse any other target unless
  the operator supplies explicit `--overwrite`.
- With `--overwrite`, write every resource through `server/json-store.js` so the pre-migration
  target remains in its `.bak`; never copy directly over a primary.
- Final files are owned by the image's `node` user and readable by the normal `app` service.
- Tests cover malformed JSON, missing required files, partial copy failure, credentials,
  backups, unrelated files, pristine reruns, refusal of used targets, and explicit overwrite.
- The runbook leaves legacy data untouched, retains a failed target volume, and gives exact
  health/count/Pressing/credential-source checks and rollback steps.
- Pre-release commands use `compose.yaml` plus `deploy/compose/compose.candidate.yaml` with an
  explicit `VINYL_IMAGE`; they never try to pull the not-yet-published `v1.0.0` pin.
