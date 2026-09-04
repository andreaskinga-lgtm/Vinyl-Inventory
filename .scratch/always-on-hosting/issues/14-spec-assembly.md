Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 07, 09, 11, 12, 13, 15

# Assemble the deployment spec and the docs outline

## Question

The destination. With every decision resolved, write
`.scratch/always-on-hosting/spec.md` as an implementable spec, plus the outline of the README
quickstart and `docs/deployment.md`.

Decide as part of it: how the implementation is sliced into issues under
`.scratch/always-on-hosting/issues/` for the follow-on build effort, and in what order; what the
README quickstart's ten lines actually say; and what `docs/deployment.md`'s section list is
(volumes, env vars, backups, updates, systemd fallback, Pi notes, troubleshooting).

Sanity check before closing: could a stranger who has never seen this repo follow it end to end?

## Answer

The implementable destination is
[`Always-on LAN hosting`](../spec.md). It fixes the shared Node/Express runtime, storage and
credential contracts, production/PWA behavior, container and systemd deployment paths, operator
procedures, release gates, and Raspberry Pi 3 acceptance target in one handoff.

The follow-on build is split into twenty-one dependency-ordered implementation issues, beginning
with [`Implement the runtime configuration module`](16-runtime-config.md) and
[`Implement power-loss-safe JSON storage`](17-durable-json-store.md), and ending with
[`Publish and verify v1.0.0`](34-first-release.md). Each ticket records its recommended model;
focused tickets target Luna, while indivisible durability, security, migration, release-workflow,
hardware, and public-release boundaries name stronger or human-operated execution.

The README quickstart is fixed at ten logical lines and optimizes for a stranger downloading a
pinned public release rather than cloning or building. The deployment guide uses the approved
13-section operator journey. The source-based systemd fallback and Pi 3 release acceptance target
resolve the map's final two fog items; no planning decision remains before implementation.
