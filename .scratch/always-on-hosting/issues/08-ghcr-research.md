Type: research
Status: resolved
Blocked by:

# Research: publishing multi-arch images to GHCR from GitHub Actions

## Question

This repo has **no** `.github/workflows/` today. Surface the facts the release decision waits on:

1. The current idiomatic multi-arch publish workflow: `docker/setup-qemu-action`,
   `setup-buildx-action`, `login-action` against `ghcr.io` with `GITHUB_TOKEN`, `build-push-action`
   with `platforms:`. What permissions block does the workflow need?
2. **Build time**: emulated arm64 builds under QEMU are notoriously slow. What are the current
   options (GitHub-hosted arm64 runners? cross-compilation? cache mounts / `cache-from: gha`) and
   what do they cost for a public repo?
3. Tagging strategy options: `latest` + semver from git tags via `docker/metadata-action`, vs
   `main` + sha. What does each imply for a user running `docker compose pull`?
4. GHCR package visibility: what does a *stranger* need to do to pull the image — is anonymous
   pull possible, and how is the package made public?
5. Any rate limits or auth friction pulling from GHCR onto a Pi.

Write findings to `.scratch/always-on-hosting/research/ghcr-publishing.md` with citations, then
link it from the Answer here.


## Answer

Findings are in [`research/ghcr-publishing.md`](../research/ghcr-publishing.md).
Use a GitHub Actions workflow with QEMU, Buildx, GHCR login via `GITHUB_TOKEN`,
`docker/metadata-action`, and `docker/build-push-action` publishing
`linux/amd64,linux/arm64` initially; add `linux/arm/v7` only if 32-bit Pi OS is
an explicit support target. Minimal permissions are `contents: read` and
`packages: write`; add `attestations: write` and `id-token: write` only for
artifact attestations/provenance. Public GitHub-hosted Arm64 runners are
available and free/unlimited for public repos, but no standard Armv7 runner was
verified. QEMU is simplest but slower; cache with `type=gha`, then escalate to
native/distributed builds or `imagetools create` if build time matters. GHCR
packages are private on first publish; make the package public explicitly so
strangers can pull anonymously without credentials on home devices.

## Answer (2026-09-04)

Findings: [`../research/ghcr-publishing.md`](../research/ghcr-publishing.md) — full workflow,
citations, and a per-question recommendation.

Gist, question by question:

1. **Workflow.** `contents: read` + `packages: write` is the whole permissions block (GitHub's
   own tutorial only shows four because it adds an attestation step). Verified current majors:
   `actions/checkout@v7`, `docker/setup-qemu-action@v4`, `setup-buildx-action@v4`,
   `login-action@v4`, `build-push-action@v7`, `metadata-action@v6`. A complete, correct
   workflow is in the research file.
2. **Build time is not a design constraint.** `ubuntu-24.04-arm` is now a *standard* runner
   (4 vCPU / 16 GB) and standard runners are free and unlimited on public repos — so native
   arm64 CI costs nothing if we ever need it. Start with the single QEMU job plus
   `cache-from/to: type=gha`; this app is `npm ci` + `vite build` with no native addons.
   The native matrix (build per-arch by digest, then merge the manifest) is a free escape
   hatch, not up-front work. No numeric QEMU slowdown figure could be verified.
3. **Tagging: publish both, pin `latest`.** `metadata-action` emits `main` + `sha-*` on push
   and `latest` + semver on tags. The compose file pins `:latest`, because
   `docker compose pull` just re-resolves whatever tag the file names — so a stranger's
   update story is literally `docker compose pull && docker compose up -d`.
4. **Anonymous pull works — and this is the load-bearing fact.** Verified empirically, not
   just from docs: `ghcr.io/token` issues a bearer token with *no credentials* and the
   manifest returns 200. **But the first publish defaults to private**, and package
   visibility is independent of repo visibility (a package inherits the repo's access
   permissions "but not the visibility"); the `Inherit access from repository` checkbox
   governs collaborator access, not anonymous access. There is **no REST endpoint** to set
   package visibility — it is a UI-only checkbox. So flipping to Public is a manual,
   forgettable, load-bearing release step and must appear in the spec with a
   credential-free pull from a clean machine as its acceptance criterion.
5. **Rate limits.** GitHub publishes **no** numeric GHCR pull limit and the live request
   returned no `RateLimit-*` headers — so the widely-repeated "unlimited pulls" claim is
   *unverifiable from primary sources* and must not go in the README. (Docker Hub, for
   contrast, documents 100 pulls/6h per anonymous IPv4, counted once per architecture.)
   Pi gotchas: confirm the manifest genuinely carries an arm64 entry, and 64-bit Pi OS is a
   hard prerequisite now that `arm/v7` is dropped.

**Sequence this implies for the spec**: Dockerfile → workflow → first publish → flip package
to Public → verify anonymous pull from a clean machine → *then* write the README install
instructions. Writing the README first publishes an untested promise.

Note: a stale earlier draft of the research file existed (framed around `arm/v7`, stale
action versions); it was rewritten rather than patched, to match the amd64+arm64-only
decision from the Docker/Pi research.
