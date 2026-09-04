Type: research
Status: resolved
Blocked by:

# Research: containers on a Raspberry Pi, and mDNS from inside one

## Question

Surface the facts the Compose/networking decision waits on:

1. What base image suits a Node 20/22 Express app targeting a **Raspberry Pi 3** as well as
   amd64 hosts? Is the Pi 3 arm64-capable in practice (64-bit OS availability), or does armv7
   have to be supported too — and does that change the buildx platform list?
2. Multi-stage build: build `dist/` in a builder stage, ship only runtime deps. What does the
   idiomatic Node multi-stage Dockerfile look like in 2026, and what are the gotchas
   (`npm ci --omit=dev`, non-root user, signal handling / PID 1, `--init`)?
3. **mDNS**: can a container advertise `vinyl.local` reliably? Compare `network_mode: host`
   (Linux-only, breaks Docker Desktop) vs an avahi sidecar vs publishing nothing and relying on
   the host's own avahi. What are the concrete failure modes on Raspberry Pi OS?
4. Restart policies and boot ordering: `restart: unless-stopped` vs `always`, and how Docker's
   own service start-on-boot is enabled on Raspberry Pi OS.

Write findings to `.scratch/always-on-hosting/research/docker-pi.md` with citations, then link
it from the Answer here.


## Answer

Findings are in [research/docker-pi.md](../research/docker-pi.md).

- Recommend Node 22 LTS initially: Node 20 is EOL, and Node 22 keeps a practical path for optional `linux/arm/v7`.
- Prefer `linux/amd64,linux/arm64`; add `linux/arm/v7` only for existing 32-bit Pi OS installs, because Node now treats armv7 as Experimental.
- Raspberry Pi 3 can run 64-bit Raspberry Pi OS, so arm64 is the preferred Pi target.
- Use a multi-stage Dockerfile with `npm ci`, `vite build`, `npm ci --omit=dev`, non-root `node`, `.dockerignore`, and Compose/Docker init.
- Do not make the app container responsible for mDNS; publish the HTTP port and let host Avahi advertise the Pi hostname, with reserved IP fallback.
- Use `restart: unless-stopped` and enable `docker.service`/`containerd.service` under systemd.
- Build images off-device/CI; Pi 3 runtime is plausible, but 512 MB/1 GB on-device builds are not a reliable happy path.
