Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 21, 24, 25, 27, 28, 29, 33, 35, 36

# Write the README quickstart and deployment guide

## Goal

Turn the tested deployment artifacts and runbook fragments into the approved stranger-readable
documentation without changing implementation behavior.

Before editing, copy the exact ten logical lines and 13-section outline from
[`Always-on LAN hosting`](../spec.md). Read each linked implementation ticket only when its
section is reached; its commands and filenames are the source of truth.

## Files

- Update `README.md`.
- Add `docs/deployment.md`.

## Steps

1. Replace the obsolete static-production warning with the ten-line **Run it on your LAN**
   quickstart verbatim in meaning and order.
2. Keep contributor setup separate from operator setup.
3. Write all 13 deployment-guide sections in the specified order.
4. Use copy-paste commands from the completed Compose, systemd, backup/restore, and migration
   artifacts; do not invent parallel command variants.
5. State the LAN-only boundary, credential/backup secrecy, 64-bit requirement, and unverified
   GHCR availability wherever the operator encounters those branches.

## Completion criteria

- Every environment variable, path, service name, volume, port, image tag, and health URL matches
  checked-in artifacts.
- Backup, restore, migration, update, rollback, systemd, port-conflict, mDNS, and client-isolation
  paths each end with an observable verification step.
- A reader does not need prior repository context to choose Docker or systemd and reach a working
  health check.
- The text does not claim unlimited GHCR pulls, real authentication, internet safety, or a public
  image before the release ticket verifies it.
