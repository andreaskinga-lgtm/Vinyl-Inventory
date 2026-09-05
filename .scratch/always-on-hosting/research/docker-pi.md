# Docker + Raspberry Pi research

## Bottom line

- Target **Node 22 LTS** for the first production container: Node 20 reached end-of-life on 2026-04-30, while Node 22 remains maintained until 2027-04-30; Node 24 is also LTS, but current Node docs classify GNU/Linux `armv7` as Experimental, so Node 22 is the safer bridge if 32-bit Pi OS compatibility is required. Sources: <https://github.com/nodejs/Release/blob/main/schedule.json>, <https://github.com/nodejs/node/blob/main/BUILDING.md>
- Prefer a multi-arch image for `linux/amd64,linux/arm64`; add `linux/arm/v7` only if supporting existing 32-bit Raspberry Pi OS installs is a requirement. Raspberry Pi documents 64-bit OS support for Raspberry Pi 3-class hardware, and Node classifies GNU/Linux `arm64` as Tier 1. Sources: <https://www.raspberrypi.com/documentation/computers/os.html>, <https://github.com/nodejs/node/blob/main/BUILDING.md>, <https://docs.docker.com/build/building/multi-platform/>
- Use a multi-stage Dockerfile: install dev deps and run `vite build` in the builder, install only production deps in a runtime/deps stage with `npm ci --omit=dev`, copy only `dist/`, server files, and production `node_modules`, run as the image's non-root `node` user, and use Docker/Compose init support rather than relying on Node as PID 1. Sources: <https://docs.docker.com/build/building/multi-stage/>, <https://docs.npmjs.com/cli/v11/commands/npm-ci>, <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>
- Do **not** depend on a container to own `vinyl.local`. Run Avahi/mDNS on the Raspberry Pi host, publish the container's HTTP port to the host, and document the Pi's reserved IP address as the fallback for networks or Android/browser combinations where `.local` does not resolve. Sources: <https://docs.docker.com/engine/network/port-publishing/>, <https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in>, <https://www.rfc-editor.org/rfc/rfc6762.html>, <https://developer.apple.com/bonjour/>, <https://developer.android.com/develop/connectivity/wifi/use-nsd>
- Use Compose `restart: unless-stopped` and make sure Docker itself is enabled under systemd on Raspberry Pi OS. Sources: <https://docs.docker.com/engine/containers/start-containers-automatically/>, <https://docs.docker.com/engine/install/linux-postinstall/>
- Build images off-device or in CI. A Pi 3's 1 GB RAM is fine for a small static+Express runtime but is a poor default build machine for Vite/npm/multi-arch Docker work. Pi 3 Model A+ is only 512 MB. Sources: <https://www.raspberrypi.com/products/raspberry-pi-3-model-b/>, <https://www.raspberrypi.com/products/raspberry-pi-3-model-b-plus/>, <https://www.raspberrypi.com/products/raspberry-pi-3-model-a-plus/>

## 1. Base image, Pi 3 architecture, and buildx platforms

Raspberry Pi's OS documentation lists Raspberry Pi 3 among models supported by Raspberry Pi OS 64-bit, so a Pi 3 can practically be an `arm64` target when it is installed with a 64-bit OS. Source: <https://www.raspberrypi.com/documentation/computers/os.html>

The preferred Docker platform set for new installs is therefore:

```sh
docker buildx build --platform linux/amd64,linux/arm64 ...
```

Docker documents multi-platform builds as a single image reference backed by a manifest list, where the engine pulls the matching platform image automatically. Source: <https://docs.docker.com/build/building/multi-platform/>

If the project wants to support people who already run 32-bit Raspberry Pi OS on a Pi 3, add `linux/arm/v7`:

```sh
docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 ...
```

That `arm/v7` target should be treated as compatibility-only. Node's current supported-platforms table classifies GNU/Linux `arm64` as Tier 1, but GNU/Linux `armv7` as Experimental, and Node explicitly says production applications should run only on Tier 1 or Tier 2 platforms. Source: <https://github.com/nodejs/node/blob/main/BUILDING.md>

Node's release schedule records Node 20 EOL as 2026-04-30, Node 22 EOL as 2027-04-30, and Node 24 EOL as 2028-04-30. Source: <https://github.com/nodejs/Release/blob/main/schedule.json>

The official Node Docker image repository keeps architecture availability by version and variant in `versions.json`; verify the exact tag during implementation because architecture support can vary by major and distro variant. Source: <https://github.com/nodejs/docker-node/blob/main/versions.json>

Recommendation: use a Debian slim official Node image such as `node:22-bookworm-slim` while `linux/arm/v7` is supported, or move to the current LTS slim tag when dropping armv7. Source for official image best practices and variants: <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>

## 2. Idiomatic Node multi-stage Dockerfile in 2026

Docker's multi-stage build docs recommend using separate `FROM` stages and copying only selected artifacts into the final image, which keeps build tools and intermediate files out of runtime images. Source: <https://docs.docker.com/build/building/multi-stage/>

`npm ci` is the lockfile-driven clean install command intended for reproducible automated installs, and `--omit=dev` prevents development dependencies from being installed on disk. Source: <https://docs.npmjs.com/cli/v11/commands/npm-ci>

The official Node image best-practices guide recommends setting `NODE_ENV=production`, using the bundled unprivileged `node` user, and invoking `node` directly rather than using `npm` as the container command. Source: <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>

A suitable future Dockerfile shape for this repo, once the Express server exists, is:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=production-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
```

Node is not designed to run as PID 1 without help for signal handling and child-process reaping; the Node Docker best-practices guide documents Docker's `--init` flag for this. Source: <https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>

In Compose, prefer:

```yaml
services:
  app:
    init: true
```

Compose service `init: true` runs an init process as PID 1 inside the container. Source: <https://docs.docker.com/reference/compose-file/services/#init>

Use a `.dockerignore` because Docker excludes matching files from the build context before sending that context to the builder. Source: <https://docs.docker.com/build/building/context/#dockerignore-files>

Recommended starting point:

```dockerignore
node_modules
dist
.git
.scratch
coverage
.env
.env.*
!.env.example
npm-debug.log*
```

## 3. mDNS and `.local` from containers

mDNS uses the `.local.` namespace with UDP multicast on port 5353 to IPv4 `224.0.0.251` and IPv6 `ff02::fb`, so it is link-local and sensitive to Wi-Fi isolation, VLAN boundaries, multicast filtering, and router/AP behavior. Source: <https://www.rfc-editor.org/rfc/rfc6762.html>

The most reliable LAN design is: host Avahi publishes the Pi's LAN hostname/address; Docker publishes the app port from a normal bridge-networked container; clients use `http://vinyl.local` or the reserved Pi IP. Docker's port-publishing docs state that publishing a port forwards traffic from the host port to the container port. Source: <https://docs.docker.com/engine/network/port-publishing/>

Avahi's daemon configuration controls the advertised hostname and host-name publication, and Avahi warns against running multiple mDNS stacks on the same host. Source: <https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in>

`network_mode: host` is usually the wrong default. Docker documents that host-networked containers share the host network namespace, do not get their own IP address, and ignore `-p`/published port mappings. Source: <https://docs.docker.com/engine/network/drivers/host/>

Docker Desktop's host networking is an opt-in feature with documented limitations and is not equivalent to native Linux behavior; therefore it should not be the portability baseline for Mac/Windows development. Source: <https://docs.docker.com/engine/network/drivers/host/>

An Avahi sidecar is possible on native Linux only if it is deliberately configured for the host network/D-Bus/multicast environment, but it can conflict with the host's Avahi daemon or advertise an address that clients cannot use. The conflict risk is grounded in Avahi's warning about multiple mDNS stacks; the exact sidecar address behavior was **not verified from an official Docker guarantee** and must be tested on the target Pi/router. Source: <https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in>

Concrete Raspberry Pi OS failure modes to test:

1. `avahi-daemon` is not installed, disabled, or stopped, so no `.local` hostname is published. Avahi publishes host names only when its daemon is running/configured to do so. Source: <https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in>
2. Another device already owns `vinyl.local`, causing a hostname collision or renamed host. `.local` names are local multicast names and conflict handling is part of mDNS behavior. Source: <https://www.rfc-editor.org/rfc/rfc6762.html>
3. Guest Wi-Fi/client isolation/VLAN/multicast filtering blocks mDNS even though direct IP HTTP still works, because mDNS is link-local multicast. Source: <https://www.rfc-editor.org/rfc/rfc6762.html>
4. Another host process already listens on port 80, so Docker cannot publish `80:3000`; Docker port publishing binds host ports. Source: <https://docs.docker.com/engine/network/port-publishing/>
5. Host Avahi plus container Avahi creates multiple mDNS responders on one host, which Avahi warns against. Source: <https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in>

Apple documents Bonjour as its local-network discovery/resolution technology, so iOS/Safari is the most likely mobile path for `.local` to work. Source: <https://developer.apple.com/bonjour/>

Android documents DNS-SD support through `NsdManager`, but that verifies Android API capability, not guaranteed browser address-bar resolution for every Android device/browser. Source: <https://developer.android.com/develop/connectivity/wifi/use-nsd>

Could not verify from a primary Android browser source that all common Android browsers resolve `http://vinyl.local` uniformly; treat the reserved IP address and QR-code fallback as required acceptance criteria.

## 4. Restart policies and boot on Raspberry Pi OS

Docker's restart policy docs define `always` as restarting a container regardless of exit status and restarting it after daemon restart even if it was manually stopped before the daemon restart. Source: <https://docs.docker.com/engine/containers/start-containers-automatically/>

The same Docker docs define `unless-stopped` as similar to `always` except that a manually stopped container is not restarted after Docker daemon restart. Source: <https://docs.docker.com/engine/containers/start-containers-automatically/>

For a household appliance where a human may intentionally stop the service for maintenance, `restart: unless-stopped` is the better default:

```yaml
services:
  app:
    restart: unless-stopped
```

Docker also documents that restart policies only take effect after a container has run successfully for at least 10 seconds, and recommends not combining Docker restart policies with another process manager for the same container. Source: <https://docs.docker.com/engine/containers/start-containers-automatically/>

Docker's Linux post-install docs describe enabling Docker and containerd with systemd so Docker starts on boot:

```sh
sudo systemctl enable docker.service
sudo systemctl enable containerd.service
```

Source: <https://docs.docker.com/engine/install/linux-postinstall/>

## 5. Pi 3 RAM and build viability

Raspberry Pi documents the Raspberry Pi 3 Model B and 3 Model B+ as 1 GB RAM devices, while Raspberry Pi 3 Model A+ has 512 MB RAM. Sources: <https://www.raspberrypi.com/products/raspberry-pi-3-model-b/>, <https://www.raspberrypi.com/products/raspberry-pi-3-model-b-plus/>, <https://www.raspberrypi.com/products/raspberry-pi-3-model-a-plus/>

A static Vite bundle plus a small Express process should be a lightweight runtime workload relative to a 1 GB Pi 3, but the exact memory budget for this app was **not verified** because the production Express server/image does not yet exist.

Building is a different problem: `npm ci`, Vite production builds, Docker BuildKit, QEMU emulation, and multi-platform manifest creation are much more memory- and CPU-intensive than serving static files. Docker documents multi-platform builds and emulation support, but does not claim that a 1 GB Pi 3 is an appropriate builder. Source: <https://docs.docker.com/build/building/multi-platform/>

Recommendation: build and publish images from CI or a developer machine with Buildx, then run `docker compose pull && docker compose up -d` on the Pi. On-device builds may work for small changes with swap, but successful builds on 512 MB/1 GB Pi 3 hardware were **not verified** and should not be the documented happy path.
