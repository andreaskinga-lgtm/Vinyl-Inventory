Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-terra
Blocked by: 26, 30

# Add the multi-architecture GHCR release workflow

## Goal

Create one release workflow that can publish testable commit images and immutable SemVer releases
without allowing a release to bypass CI.

Before editing, read **CI, images, releases, and updates** in
[`Always-on LAN hosting`](../spec.md),
[`Research: publishing multi-arch images to GHCR from GitHub Actions`](08-ghcr-research.md), and
its linked research file. Keep workflow orchestration, tag derivation, manifest creation, and
permissions in one Terra ticket because they form one release-integrity boundary.

## Steps

1. Reuse the callable CI workflow before any push.
2. On pushes to `main`, publish `main` and `sha-<short-commit>` candidates.
3. On `vX.Y.Z` tags, first fail unless `package.json` is exactly `X.Y.Z`, then publish
   `vX.Y.Z`, `sha-<short-commit>`, `latest`, `vX`, and `vX.Y`.
4. Use the action majors verified in the research, QEMU, Buildx, GHCR login via
   `GITHUB_TOKEN`, metadata-action, build-push-action, `linux/amd64,linux/arm64`, and
   `type=gha` cache.
5. Grant only `contents: read` and `packages: write`.

## Completion criteria

- Pull-request events cannot push images.
- A main-branch candidate manifest contains both target platforms.
- A mismatched package/tag version fails before image publication.
- Tags are derived by metadata rules rather than hand-built shell string manipulation.
- Workflow logs and metadata contain no repository or personal credential.
- The ticket records the exact candidate SHA tag for Pi acceptance.

