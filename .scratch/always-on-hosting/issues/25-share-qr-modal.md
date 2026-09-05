Status: ready-for-human
Kind: implementation
Model: gpt-5.6-luna
Blocked by:

# Add the share collection QR modal

## Goal

Add the approved, tightly scoped guest-sharing interaction.

Before editing, read **Production web serving and PWA behavior** in
[`Always-on LAN hosting`](../spec.md) and
[`In-app share / QR view`](12-share-qr-view.md).

## Steps

1. Add `qrcode.react` to production `dependencies`.
2. Add a header-level **Share collection** action.
3. Add a co-located React modal and plain CSS following existing modal/focus patterns.
4. Render a scannable SVG QR for `window.location.origin` using `qrcode.react`; also display the
   exact origin as selectable text.
5. Include a concise invitation to browse and **No app or sign-in needed.**
6. Support Escape, close-button, backdrop close, initial focus, focus return, and an accessible
   dialog label.

## Completion criteria

- Inspecting the rendered QR input proves it receives the exact current origin, and opening
  through different local hostnames changes both the QR input and displayed text.
- The keyboard interaction has no focus loss and the modal is usable at the narrowest existing
  mobile breakpoint.
- No route, canonical URL setting, or guest-specific view is added.
- `npm run lint` and `npm run build` pass.
- Physical-phone scanning is deferred to **Run Raspberry Pi 3 release acceptance**.

## Comments

- Implemented in commit `967471e` with a header-level **Share collection** action, an SVG QR modal using the runtime origin, selectable address text, responsive styling, and keyboard focus management.
- Reviewed against `origin/discogs-improvements`: Standards found no issues and Spec found no issues.
