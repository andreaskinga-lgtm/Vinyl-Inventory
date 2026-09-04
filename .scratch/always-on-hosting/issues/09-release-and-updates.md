Type: grilling
Status: resolved
Blocked by: 07, 08

# Release, versioning and the update flow

## Question

`package.json` says `"version": "0.0.0"` and the README calls the project pre-alpha.

Decide: does the project start versioning for real (semver git tags driving image tags), or ship
rolling `latest` off `main`? What image tags exist and which one does the published
`docker-compose.yml` pin? What is the documented update procedure for a user
(`docker compose pull && up -d`? Watchtower? manual?) and for Andrea on the Pi? What happens to
the JSON data across an upgrade that changes its shape — is there any migration story, or is
"the shape is additive, don't break it" the whole policy?

## Answer

The deployable release line starts at `v1.0.0`. A pushed SemVer Git tag is the release trigger:
the package version, tag, and immutable deployed image use that same version. A stable release
publishes `vX.Y.Z` and `sha-<short-commit>` images; it also moves the convenience aliases
`latest`, `vX`, and `vX.Y`. The documented Compose image always pins the exact `vX.Y.Z` tag,
never a moving alias or `main`.

Updates are administrator-initiated, not managed by Watchtower. The deployment guide instructs
the administrator to select a release, create a timestamped archive of the whole named volume,
change the pinned image tag, run `docker compose pull` and `docker compose up -d`, then verify
`/health` and that the collection loads. Rollback means repinning the previous immutable tag and
restarting; restore the archive only if collection data needs recovery.

Persisted JSON changes must remain additive and backward-compatible. A release that needs a
breaking data-shape change is blocked on a separately designed versioned migration. Before
README installation instructions can promise a public image, the initial GHCR package must be
made public and pass a credential-free arm64 pull. CI and release gating remain for
[CI scope and the handler test boundary](13-ci-and-tests.md), which is still blocked on
[Where the dev/prod seam sits in the API layer](01-handler-seam.md).
