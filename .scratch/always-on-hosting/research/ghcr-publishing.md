# GHCR multi-arch publishing research

**Verified:** 2026-09-04. **Scope:** GitHub Actions publishing of a
`linux/amd64,linux/arm64` image to GitHub Container Registry (`ghcr.io`), and
what a stranger has to do to pull it onto a Raspberry Pi 3 running 64-bit Pi OS.

Prior decisions taken as given (from `docker-pi.md`): Node 22 LTS base,
platforms `linux/amd64,linux/arm64` only (no `arm/v7`), multi-stage build,
non-root, `restart: unless-stopped`, and **Pi-3 on-device builds are not
viable** — so the CI-published image is load-bearing, not a convenience.

**Repo fact verified locally:** `.github/` contains only
`copilot-instructions.md`. There is no `.github/workflows/` directory and no
`Dockerfile`. Everything below is greenfield.

## Bottom line

1. **Workflow:** single `ubuntu-24.04` job, `setup-qemu-action@v4` →
   `setup-buildx-action@v4` → `login-action@v4` (ghcr.io, `github.actor` +
   `secrets.GITHUB_TOKEN`) → `metadata-action@v6` → `build-push-action@v7` with
   `platforms: linux/amd64,linux/arm64`. Job permissions: **`contents: read`
   plus `packages: write`** — nothing more, unless you add attestations.
2. **Build time:** GitHub-hosted **`ubuntu-24.04-arm` is a standard runner and
   is free and unlimited on public repositories**. So the "expensive" option is
   free here. Still start with the single QEMU job (simplest, one artifact,
   one manifest) plus `cache-from/to: type=gha`; move to a native two-runner
   digest+merge matrix only if the emulated arm64 leg becomes annoying.
3. **Tags:** publish `latest` + semver from `v*` git tags, **and** `main` +
   `sha-<short>` from default-branch pushes. Compose file that ships in the
   README pins `:latest`. Recommended.
4. **Visibility (the load-bearing one):** first publish is **private by
   default**. You must flip it to Public once, by hand, in the package's
   settings. After that, `docker pull` works with **no GitHub account and no
   `docker login`** — verified empirically against a live public GHCR image.
5. **Rate limits:** GitHub publishes **no numeric GHCR pull limit** and GHCR
   returned **no `RateLimit-*` headers** in a live check. Contrast Docker Hub:
   100 pulls/6h per IPv4 (anonymous). Do not write "unlimited" in the README —
   write "no login required".

---

## 1. The idiomatic multi-arch publish workflow

### Current action versions

Checked against each action's latest GitHub release on 2026-09-04:

| Action | Latest release | Use |
| --- | --- | --- |
| `actions/checkout` | `v7.0.1` (2026-07-20) | `@v7` |
| `docker/setup-qemu-action` | `v4.3.0` (2026-09-01) | `@v4` |
| `docker/setup-buildx-action` | `v4.3.0` (2026-08-19) | `@v4` |
| `docker/login-action` | `v4.6.0` (2026-07-29) | `@v4` |
| `docker/build-push-action` | `v7.3.0` (2026-07-01) | `@v7` |
| `docker/metadata-action` | `v6.2.0` (2026-07-02) | `@v6` |

Docker's own current multi-platform Actions page uses exactly `login-action@v4`,
`setup-qemu-action@v4`, `setup-buildx-action@v4`, `build-push-action@v7`.
Source: <https://docs.docker.com/build/ci/github-actions/multi-platform/>

**Caveat worth flagging:** GitHub's own "Publishing Docker images" tutorial is
*behind* on `actions/checkout` — it still shows `actions/checkout@v6` while the
action's latest release is `v7.0.1`. Either works; `v7` is current.
Source: <https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images>

### The `permissions:` block

Minimum for build-and-push to GHCR:

```yaml
permissions:
  contents: read    # actions/checkout
  packages: write   # GITHUB_TOKEN pushes to ghcr.io
```

GitHub's tutorial example shows four permissions —
`packages: write`, `contents: read`, `attestations: write`, `id-token: write` —
but the last two exist only because that example ends with an
`actions/attest@v4` step that pushes a provenance attestation to the registry.
Without that step they are not needed.
Source: <https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images>

GitHub documents that a workflow may use `GITHUB_TOKEN` to "publish packages
associated with the workflow repository", and that this is the recommended
alternative to a PAT.
Source: <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>

### Complete workflow

```yaml
name: Publish container image

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  # metadata-action lowercases the image name, which matters here:
  # the repo is "Vinyl-Inventory" but the image must be "vinyl-inventory".
  IMAGE_NAME: ${{ github.repository }}

jobs:
  publish:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v4
        with:
          platforms: arm64

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Image metadata
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,format=short

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          annotations: ${{ steps.meta.outputs.annotations }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Notes on why each piece is there:

- QEMU must come **before** Buildx; it is what registers the `arm64` emulation
  handlers. `setup-buildx-action` then creates a `docker-container` builder,
  which is the driver that supports multi-platform output and cache export.
  Sources: <https://github.com/docker/setup-qemu-action>,
  <https://github.com/docker/setup-buildx-action>
- `labels` carries `org.opencontainers.image.source`, which is how GitHub links
  the package to this repo. GitHub explicitly recommends this label to "ensure
  your `GITHUB_TOKEN` has appropriate permissions when using a GitHub Actions
  workflow", and warns that `GITHUB_TOKEN` **will not** have permission to push
  if a package already exists in the same namespace but is not connected to the
  repository.
  Source: <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>
- Before production, consider replacing the `@vN` tags with reviewed commit
  SHAs — GitHub's own example carries the comment "GitHub recommends pinning
  actions to a commit SHA."

---

## 2. Build time: QEMU vs native arm64 runners

### GitHub-hosted arm64 runners — availability and cost (verified 2026-09-04)

The GitHub-hosted runners reference lists, under **Standard runners for public
repositories**, a Linux **arm64** row: `ubuntu-24.04-arm`, `ubuntu-22.04-arm`
(both GA) and `ubuntu-26.04-arm` (public preview), at **4 vCPU / 16 GB RAM /
14 GB SSD** — the same spec as the x64 `ubuntu-latest` row. The page states
plainly: *"Use of the standard GitHub-hosted runners is free and unlimited on
public repositories."*
Source: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>

So for `andreaskinga-lgtm/Vinyl-Inventory` (public), native arm64 CI costs
**nothing**. This materially changes the calculus vs. a couple of years ago.

### The four options

| Option | Cost (public repo) | Complexity | Notes |
| --- | --- | --- | --- |
| Single x64 job + QEMU | Free | Lowest — one job, one manifest | Docker warns emulation is "significantly" slower and that building multiple platforms on one runner "can significantly extend build times". |
| Native matrix: `ubuntu-24.04` + `ubuntu-24.04-arm`, digest + merge-manifest | Free | Highest — 2 build jobs + prepare/merge job, digest artifacts | No emulation at all. Docker documents this as the underlying pattern. |
| `docker/github-builder` reusable workflow | Free | Medium — one `uses:` block | With `distribute: true` (the default) it splits one platform per runner and merges; the default mapping sends Linux Arm to `ubuntu-24.04-arm` and everything else to `ubuntu-24.04`. |
| Cross-compilation | Free | Needs an architecture-aware Dockerfile | Requires `BUILDPLATFORM`/`TARGETPLATFORM`/`TARGETARCH` plumbing; not a drop-in. |

Sources: <https://docs.docker.com/build/ci/github-actions/multi-platform/>,
<https://docs.docker.com/build/building/multi-platform/>,
<https://docs.docker.com/build/ci/github-actions/multi-platform/github-builder/build/>

### Cache

`type=gha` is Docker's recommended in-Actions cache backend; it requires a
non-default Buildx driver, which `setup-buildx-action`'s default
`docker-container` driver satisfies. `mode=max` exports intermediate layers too.
Cache is scoped by branch access, and heavy cache traffic can be throttled by
the GitHub cache API.
Sources: <https://docs.docker.com/build/cache/backends/gha/>,
<https://docs.docker.com/build/ci/github-actions/cache/>

### Recommendation

**Start with the single QEMU job + `type=gha` cache.** Rationale specific to
this app: the build is `npm ci` + `vite build` with **no native addons**. In a
well-ordered multi-stage Dockerfile the emulated arm64 leg is mostly npm
install and a JS bundler run — real CPU work, so it will be slower, but it is
minutes, not the hour-scale pain you get with C/C++ toolchains. Against that,
the single-job form is one file, one manifest, no digest artifacts, and no
merge job to get wrong.

**Switch to the native matrix (or, easier, `docker/github-builder`) if and only
if** the arm64 leg becomes the thing you wait on. Since native arm64 runners
are free for this repo, that switch has no budget consequence — it is purely a
workflow-complexity trade. Do not reach for cross-compilation; there is nothing
to cross-compile.

**Not verified:** I could not find a Docker- or GitHub-published numeric
slowdown multiplier for QEMU. Docker's statements are qualitative
("significantly"). Measure the first real run rather than trusting an estimate.

---

## 3. Tagging strategy

`metadata-action`'s documented semver behaviour: a `v1.2.3` git tag with
`pattern={{version}}` / `pattern={{major}}.{{minor}}` produces `1.2.3`, `1.2`,
and — for non-prerelease tags — `latest`. It also lowercases image names, which
this repo needs (`Vinyl-Inventory` → `vinyl-inventory`).
Source: <https://github.com/docker/metadata-action>

| Trigger | Tags produced | What a `docker compose pull` does |
| --- | --- | --- |
| push to `main` | `main`, `sha-abc1234` | `:main` moves to every green main build. Continuous, not a release promise. |
| git tag `v1.2.3` | `1.2.3`, `1.2`, `latest`, `sha-abc1234` | `:latest` moves only when you cut a release. `:1.2.3` never moves. |
| digest in compose | n/a | `@sha256:…` is byte-exact forever; strongest pin, worst ergonomics. |

`docker compose pull` re-resolves the tag written in the compose file; it does
not rewrite that tag. So the compose file *is* the update policy.
Source: <https://docs.docker.com/reference/cli/docker/compose/pull/>

### Recommendation

**Publish both, ship `latest`.** Emit `main`/`sha-*` on default-branch pushes
(useful for your own Pi and for debugging), and `latest` + semver on `v*` tags.
The compose file in the README pins:

```yaml
image: ghcr.io/andreaskinga-lgtm/vinyl-inventory:latest
```

Reasoning for the target audience: the promise is "someone else runs this on
their own Pi and it keeps working." `docker compose pull && docker compose up -d`
then means "get the newest release I deliberately cut," which is the right
default for a non-expert operator. `:main` would hand them every mid-refactor
commit; a pinned `:1.2.3` would silently strand them on an old version forever
with no signal. Document the `:1.2.3` and `@sha256:` forms in the README as the
opt-out for anyone who wants deliberate upgrades.

---

## 4. GHCR package visibility — what a stranger has to do

**This is the load-bearing question, and the answer is: nothing, once you flip
one switch.**

### Anonymous pull is genuinely supported

GitHub states it in two places:

> "In most registries, to pull a package, you must authenticate with a personal
> access token or `GITHUB_TOKEN`, regardless of whether the package is public or
> private. **However, in the Container registry, public packages allow anonymous
> access and can be pulled without authentication or signing in via the CLI.**"
>
> — <https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility>

> "You can also access public container images anonymously."
>
> — <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>

**Empirically verified on 2026-09-04** against a live public GHCR image, from a
machine with no GHCR credentials:

```
$ curl -s "https://ghcr.io/token?scope=repository:home-assistant/home-assistant:pull&service=ghcr.io"
{"token":"djE6aG9tZS1hc3Npc3RhbnQv..."}      # issued with NO credentials

$ curl -I -H "Authorization: Bearer $TOKEN" \
    https://ghcr.io/v2/home-assistant/home-assistant/manifests/stable
HTTP/2 200
content-type: application/vnd.oci.image.index.v1+json
docker-content-digest: sha256:372d991e58882a1d8c68c07e9aa3f3b509276e695355f73ccdb03baa70407293
```

An unauthenticated request returns `401` with
`www-authenticate: Bearer realm="https://ghcr.io/token",service="ghcr.io",…` —
that is the normal Docker Registry v2 handshake, and `docker` performs the
anonymous token fetch automatically. So a stranger really does just run:

```sh
docker pull ghcr.io/andreaskinga-lgtm/vinyl-inventory:latest
# or, with the image set in their compose.yaml:
docker compose pull && docker compose up -d
```

No GitHub account. No `docker login`. No PAT on the Pi.

### But: the first publish is PRIVATE

> "When you first publish a package, the default visibility is **private**."
>
> — <https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry>

**This is a manual, one-time, easy-to-forget step.** The README promise is
broken until it is done.

**UI path:** your GitHub profile → **Packages** tab → click the package →
**Package settings** (gear, right-hand side) → **Danger Zone** →
**Change visibility** → **Public**. Note that public visibility for a package
cannot be reverted to private.

**API:** the Packages REST API exposes `visibility` as a **read-only** field on
the package object (`GET /users/{username}/packages/container/{package_name}`
returns `visibility: private|public`). The documented endpoints are list, get,
delete and restore — **there is no documented REST endpoint that sets package
visibility.** Treat this as UI-only; use the API only to *assert* it worked.
Source: <https://docs.github.com/en/rest/packages/packages>

### Visibility vs. repo visibility vs. "Inherit access from repository"

These are three different things and conflating them is the classic failure:

- **Package visibility is independent of repository visibility.** A package
  "can inherit its visibility and access permissions from a repository, or …
  you can set the visibility and permissions of the package separately."
  For GHCR (a granular-permissions registry) the package is scoped to the
  account, not the repo. Critically: *"the package automatically inherits the
  access permissions (**but not the visibility**) of the linked repository."*
  **Making the repo public does not make the package public.**
- **"Inherit access from repository (recommended)"** is a checkbox under
  *Manage access* / *Inherited access* in package settings. It governs **who
  has read/write/admin on the package**, i.e. it mirrors repo collaborators — it
  does **not** govern public/anonymous access. Leave it on.
- Inheritance is only automatic if the repo is linked **before** first publish
  (which pushing from this repo's workflow with `GITHUB_TOKEN`, plus the
  `org.opencontainers.image.source` label, achieves). Connecting a package to a
  repo *after* publishing keeps the package's existing permissions unless you
  explicitly opt in.

Source (all three points):
<https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility>

### Checklist for the SPEC

1. Merge the workflow; let it publish once.
2. Flip the package to **Public** (UI, one time).
3. Verify from a machine with no credentials:
   `docker logout ghcr.io && docker pull ghcr.io/andreaskinga-lgtm/vinyl-inventory:latest`.
4. Confirm `visibility: "public"` via
   `gh api users/andreaskinga-lgtm/packages/container/vinyl-inventory`.
5. Only then write the "just run `docker compose up`" promise into the README.

---

## 5. Rate limits and Pi-specific friction

### GHCR

GitHub's package billing page: *"GitHub Packages usage is **free** for **public
packages**. In addition, data transferred in from any source is free."* And in a
note: *"Container image storage and bandwidth for the Container registry is
currently free. If you use Container registry, you'll be informed at least one
month in advance of any change to this policy."*
Source: <https://docs.github.com/en/billing/concepts/product-billing/github-packages>

On limits: **GitHub does not publish a numeric pull rate limit for GHCR** in
any of the registry, permissions, or billing documentation reviewed here. My
live manifest fetch returned **no `RateLimit-*` headers of any kind**. Plenty of
blog posts assert "unlimited pulls" — that phrasing is *not* in GitHub's docs
and I could not verify it from a primary source.

**Recommended wording for the README/SPEC:** "pulling requires no GitHub
account and no login; GitHub does not document a pull rate limit for public
container images." Do not write "unlimited."

Documented GHCR constraints that do exist affect *publishing*, not Pi pulls
(e.g. maximum layer size and upload timeouts).

### Docker Hub, for contrast

Officially documented and strict — this is the thing GHCR saves you from:

| User type | Pull rate limit per 6 hours |
| --- | --- |
| Unauthenticated | **100 per IPv4 address or IPv6 /64 subnet** |
| Personal (authenticated) | 200 |
| Pro / Team / Business | Unlimited |

Also: *"A pull for a multi-arch image will count as one pull for each different
architecture."*
Source: <https://docs.docker.com/docker-hub/usage/pulls/>

Note this is not purely academic for us: the Pi *also* pulls the `node:22-*`
base layers if anything is built locally, and a household behind one NAT IPv4
shares the 100/6h anonymous bucket. Shipping a prebuilt GHCR image means the Pi
touches Docker Hub **zero** times at runtime.

Separately, GitHub notes that *GitHub-hosted runners are exempt from Docker Hub
rate limits by agreement between GitHub and Docker* — so CI pulling
`node:22-bookworm-slim` is safe, but a self-hosted runner would not be.
Source: <https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images>

### arm64 / Pi gotchas

- **Verify the manifest actually has an arm64 entry** before promising anything.
  `docker buildx imagetools inspect ghcr.io/andreaskinga-lgtm/vinyl-inventory:latest`
  should list `linux/amd64` and `linux/arm64`. A silently-single-arch push is
  the most likely way this breaks in practice; the Pi's error
  (`no matching manifest for linux/arm64/v8`) is at least legible.
- **64-bit OS is a hard prerequisite.** A Pi 3 running 32-bit Raspberry Pi OS
  reports `linux/arm/v7` and will not match an arm64-only manifest. Per
  `docker-pi.md` we are deliberately not shipping `arm/v7`, so the README must
  state "64-bit Raspberry Pi OS required" as a prerequisite, not a footnote.
- **1 GB RAM Pi 3 is fine for pulling**, but layer decompression during
  `docker pull` is the peak-memory moment of the whole install. Keeping the
  runtime image small (slim base, `--omit=dev`, `dist/` only) pays off twice:
  faster CI push and a pull the Pi can actually complete.
- **Not verified:** whether GHCR applies any per-IP throttle to a Pi doing
  repeated pulls. Nothing observed, nothing documented.

---

## What this means for the release decision

- **There is no blocker.** Every piece of the "always-on hosting" story is
  supported by documented, currently-shipping behaviour: multi-arch build in
  free CI, publish to GHCR with the built-in `GITHUB_TOKEN`, anonymous pull on
  someone else's Pi.
- **The one genuinely manual step is package visibility.** It is a single
  checkbox that nobody can automate via the REST API, it defaults the wrong way,
  and the entire README promise depends on it. It must appear in the SPEC as an
  explicit, verified release step — with the credential-free pull test as its
  acceptance criterion — not as a note in a runbook.
- **Cost is genuinely zero** for this public repo: standard runners (x64 *and*
  arm64) are free and unlimited, and public-package storage and bandwidth are
  free.
- **Build-time risk is low enough to defer.** Start with the simple QEMU job.
  Free native arm64 runners exist as an in-pocket escape hatch, so "it's slow"
  is a later, cheap fix rather than an up-front design constraint.
- **Do not over-promise in the README.** Two claims are safe and verified:
  "no login needed" and "one `docker compose pull` to update." Two are not:
  "unlimited pulls" (undocumented) and "works on any Pi" (64-bit OS required).
- **Sequence for the SPEC:** Dockerfile → workflow → first publish → flip to
  Public → verify anonymous pull from a clean machine → *then* write the README
  install instructions. Writing the README first would be publishing a promise
  you haven't tested.
