Status: ready-for-human
Kind: implementation
Model: gpt-5.6-terra (human-operated)
Blocked by: 21, 24, 25, 27, 28, 29, 30, 31, 32, 33, 35, 36

# Publish and verify v1.0.0

## Goal

Perform the irreversible and account-level steps that turn the tested candidate into the first
documented public release.

Before starting, read **CI, images, releases, and updates** in
[`Always-on LAN hosting`](../spec.md),
[`Release, versioning and the update flow`](09-release-and-updates.md), and the GHCR visibility
findings linked from [`Research: publishing multi-arch images to GHCR from GitHub Actions`](08-ghcr-research.md).
Use Terra for release-integrity review; a human must perform the GHCR visibility change.

## Checklist

1. Confirm every blocker is complete and the Pi acceptance result supports the published claim.
2. Set `package.json` and its lockfile to `1.0.0`; run lint, tests, build, and a clean Compose
   install/backup/update/rollback smoke test.
3. Create and push signed tag `v1.0.0` without rewriting existing history.
4. Wait for the release workflow and verify `v1.0.0` and SHA manifests contain amd64 and arm64.
5. In GitHub's package UI, change the GHCR package visibility to Public.
6. From a clean unauthenticated environment, pull the exact `v1.0.0` arm64 image and run its
   health check.
7. Re-read the README and deployment guide against the public artifact, then publish release
   notes that link backup-first update and rollback instructions.

## Completion criteria

- Package version, Git tag, immutable image tag, Compose pin, and release notes all say `v1.0.0`.
- Anonymous pull and startup succeed without `docker login`.
- The published image digest matches the workflow output and the tested source commit.
- The release is not marked complete until the public pull, health check, and documentation links
  all work from a clean environment.
