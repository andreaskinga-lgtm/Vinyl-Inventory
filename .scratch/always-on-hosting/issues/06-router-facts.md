Type: task
Status: resolved
Blocked by:

# Task (HITL): confirm the router's addressing options

## Question

The addressing decision needs facts only Andrea can get, from the actual home router.

Checklist to hand over:
1. Does the router's admin UI offer **DHCP reservation** (sometimes "static lease", "address
   reservation")? Record where in the UI, and reserve an address for the Pi.
2. Record the Pi's MAC address and the reserved IP.
3. Does the router serve a **local DNS name** for LAN clients (e.g. `pi.lan`, `pi.home`)? Some
   do, many don't.
4. Does `ping vinyl.local` / `ping raspberrypi.local` currently resolve from an iPhone and from
   an Android phone on the same wifi? (Android's mDNS support is the usual failure.)
5. Is there a guest wifi network, and can devices on it reach the main LAN?

Answer records the reserved IP, whether mDNS works per-platform, and whether guest wifi is
isolated — all of which the QR/share view and the Compose networking mode depend on.

## Answer

Ruled out of this map. The destination is portable instructions for a stranger's hardware, so
Andrea's router model, assigned IP, local DNS behavior, and guest-network topology cannot decide
the specification. The deployment guidance must instead describe generic choices: reserve a DHCP
address where the router supports it, offer a host-advertised `.local` name only as best effort,
and publish the reserved IP (with port) as the universal fallback. Checking these facts becomes
an installation-time validation step, not a prerequisite to the design.
