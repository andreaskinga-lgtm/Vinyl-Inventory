Status: resolved
Kind: implementation
Model: gpt-5.6-luna (human-operated)
Blocked by: 28

# Verify the systemd fallback on Linux

## Goal

Exercise the checked-in unit and source-install fragment on a clean 64-bit Debian-family host.

This is human-operated because the implementation session may not have a systemd boot environment.
Luna is sufficient to guide the fixed checklist and record evidence.

## Checklist

1. Use a disposable 64-bit Raspberry Pi OS or Debian VM with Node 22.
2. Follow the source-install fragment exactly, including user, ownership, data path, and protected
   environment file.
3. Run `systemd-analyze verify`, enable and start the service, and verify `/health`.
4. Reboot the host and confirm the service returns without an interactive login.
5. Add a record, perform the documented backup-first update against an explicit tag, and verify
   the record and journald logs afterward.

## Completion criteria

- Append host/OS/Node identifiers, commands, health results, reboot result, ownership checks, and
  update result under `## Results`.
- The process runs as `vinyl-inventory`, writes only `/var/lib/vinyl-inventory`, and reads secrets
  from root-owned mode-0600 `/etc/vinyl-inventory.env`.
- Any failure creates a focused remediation ticket and blocks operator documentation and release.
