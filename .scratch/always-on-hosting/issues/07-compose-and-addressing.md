Type: grilling
Status: resolved
Blocked by: 05, 06

# The Compose file and how the box is addressed

## Question

Settle the deployment unit and the URL guests type or scan.

Compose: services, ports, volume mounts, restart policy, `network_mode` (bridge with published
ports vs host, given the mDNS findings), healthcheck or not, resource limits on a Pi 3.

Addressing: is the supported story a DHCP-reserved static IP, an mDNS `.local` name, or both
with one documented as best-effort? What does the README tell a stranger whose router does none
of it? Does the port appear in the URL guests see, or do we bind 80 (which needs privileged
ports / `NET_BIND_SERVICE` on a rootless setup)?

That last one matters: `http://192.168.1.42` is scannable and memorable; `:5173` is neither.

## Answer

Compose runs one unprivileged application service in bridge networking and maps host port 80 to
the server's container port 8080 (`80:8080`). This keeps guest and QR URLs free of a port
suffix. The app remains non-root; Docker owns the host-port mapping. The deployment instructions
include a Compose override for hosts where port 80 is already occupied.

The documented, reliable guest address is the Pi's DHCP-reserved IP:
`http://<reserved-ip>`. `http://vinyl.local` is a best-effort convenience advertised by Avahi on
the host, not by the container. Setup must tell installers to use a network that can reach the
Pi and to diagnose guest-Wi-Fi client isolation when either address is unreachable.

The service uses `restart: unless-stopped` and `init: true`, and exposes a lightweight,
unauthenticated `/health` endpoint for Compose's healthcheck. The initial Compose specification
does not set CPU or memory limits; Pi 3 serving headroom remains a separate measurement before
limits can be justified.
