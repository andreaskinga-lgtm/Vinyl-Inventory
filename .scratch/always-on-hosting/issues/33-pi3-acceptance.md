Status: ready-for-human
Kind: implementation
Model: gpt-5.6-luna (human-operated)
Blocked by: 24, 25, 27, 31

# Run Raspberry Pi 3 release acceptance

## Goal

Run the published arm64 candidate on the physical 1 GB Raspberry Pi 3 and produce the evidence
needed to keep or revise the support claim.

Before starting, read **Raspberry Pi 3 release acceptance** in
[`Always-on LAN hosting`](../spec.md). This is a human-operated ticket because the model cannot
stand in for access to the Pi, router, and five client sessions; Luna is sufficient to guide the
fixed checklist and record results.

## Checklist

1. Confirm 64-bit Raspberry Pi OS, available disk, Docker boot enablement, and the exact candidate
   SHA tag from **Add the multi-architecture GHCR release workflow**. Because the package remains
   private until the public-release ticket, log in with a least-privilege `read:packages` PAT for
   this pull and remove the credential after the run.
2. Back up existing data and start the SHA candidate with
   `VINYL_IMAGE=ghcr.io/andreaskinga-lgtm/vinyl-inventory:sha-<commit> docker compose -f compose.yaml -f deploy/compose/compose.candidate.yaml up -d`.
3. Confirm the pulled manifest is arm64 and the container remains non-root and healthy.
4. Run five concurrent clients for 30 minutes through initial load, search, record details, cover
   requests, and API reads.
5. Observe container restarts, OOM events, CPU, memory, and representative response latency.
6. Scan the in-app share QR from a physical phone and exercise the prompted PWA update with two
   candidate builds.
7. Restart the service and verify collection data remains intact.

## Completion criteria

- Append exact hardware/OS/image identifiers, commands, observations, and pass/fail result to this
  ticket under `## Results`.
- Passing means no OOM, process restart, corrupt write, or visibly unresponsive collection/API
  use during the run.
- A failure either creates a focused remediation ticket or updates the spec and the inputs to
  **Write the README quickstart and deployment guide** so unsupported claims never enter the
  operator documentation.
