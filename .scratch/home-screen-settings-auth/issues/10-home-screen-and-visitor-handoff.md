Status: resolved
Kind: implementation

# Build the Home Screen and visitor device handoff

## Goal

Replace the Share modal with the default visitor-operated Home Screen, conditional Wi-Fi flow,
and distinct Collection Display browsing mode.

Read **Home Screen**, **Phone handoff**, and **Display reset** in
[`the feature spec`](../spec.md).

## Files

- Replace or repurpose `src/components/ShareCollectionModal.jsx` and its CSS.
- Add co-located Home Screen/display components and CSS as appropriate.
- Update `src/App.jsx`, `src/components/ListeningRoom.jsx`, and PWA-facing copy.

## Validated UI direction

- Implement the selected Variant C image-first Collection Display direction from
  `prototype/home-screen-handoff-ui` at commit `00206d0`.
- Reuse the collection browser's near-black/amber visual language, typography, album-art motifs,
  hairline panels, and floating pill controls. Keep the Home Screen entirely visitor-facing.
- Make **Browse on this device** the dominant amber action and **Open on my phone** the secondary
  dark action.
- Replace Home immediately with the existing collection UI when entering Collection Display mode
  at `/`; do not append it below Home and do not navigate the shared display to `/browse`.
- Present the entire phone handoff in a fixed centered modal over a dimmed/blurred Home Screen.
  Reset document scroll on handoff open, Collection Display entry, and Start over. If needed,
  scroll inside the modal rather than the page behind it.

## Steps

1. Render the Home Screen at `/` with **Browse on this device** and **Open on my phone**.
2. Keep tablet browsing as ephemeral state at `/`; refresh and Back return to Home.
3. Keep direct `/browse` as ordinary phone browsing with no display timeout.
4. Fetch `/api/visitor-settings` and implement the configured/unconfigured phone flows.
5. Encode the current LAN origin plus `/browse` in the collection QR.
6. Show SSID, masked/revealable/copyable password fallback, Wi-Fi QR, manual continue, and Start
   over according to the state machine.
7. Apply the configured idle timeout to Home handoff steps and Collection Display browsing only.
8. Reset on broad visitor activity and show the final 10-second countdown.
9. On timeout expiry, perform the same safe public reset as **Home Screen**: exit Edit Mode, sign
   out, clear transient dialogs and pending administrator intent, and return to `/`.
10. Ensure selecting **Home Screen** performs that safe public reset immediately.

## Completion criteria

- QR-only behavior works when Wi-Fi is absent, with no visitor-visible setup hint.
- Representative iOS and Android devices can scan WPA/open/hidden Wi-Fi payloads and `/browse`.
- Collection Display browsing resets after the configured timeout; direct phone browsing does
  not and cannot dispatch a timeout transition that navigates Home.
- Home, Back, refresh, Start over, copy/reveal, and safe sign-out behavior are manually verified.
- The Home Screen is usable at tablet dimensions and remains accessible by keyboard/screen reader.
- Modal dialog semantics include accessible naming, initial focus, focus containment/restoration,
  Escape support, and visible focus. Touch targets are at least 44 by 44 CSS pixels and primary
  actions are at least 52 pixels high.
- QR codes target 280 CSS pixels with a white quiet zone and remain at least 220 pixels wide in
  supported narrow-phone layouts. Password copy is disabled until reveal and reports success or
  unavailability explicitly.
- `npm run lint` and `npm run build` pass.

## Comments

- Implemented the validated image-first Home Screen with album-art motifs, visitor-only language,
  ephemeral Collection Display browsing at `/`, and direct `/browse` phone browsing.
- Replaced the old Share modal with an accessible fixed handoff dialog. Configured Wi-Fi asks the
  SSID connection question, supports WPA/open/hidden Wi-Fi QR payloads, masked/revealable/copyable
  passwords, explicit copy feedback, manual continuation, collection QR generation, Start over,
  Escape, focus containment/restoration, internal modal scrolling, and document-scroll locking.
  Unconfigured Wi-Fi goes directly to the collection QR without setup messaging.
- Added pure transition and timer utilities. The configured 1–30 minute timer covers only Home
  handoff and Collection Display browsing, resets on visitor activity, shows the final ten-second
  countdown, and safely returns Home on expiry while clearing visitor/admin transient state and
  ending the Admin Session. Direct `/browse` cannot dispatch a timeout transition.
- Validation: focused transition/timer/Wi-Fi tests passed (31 tests); full `npm test` passed
  (257 Vitest tests plus 5 backup tests); `npm run lint`, `npm run build`, and `git diff --check`
  passed.
- Headless browser checks covered configured and unconfigured handoff, QR labels/URLs, modal
  scroll locking, initial focus and restoration, Escape, password reveal/copy gating, Start over,
  Collection Display entry, Back/refresh reset, final countdown/expiry, and direct `/browse`
  timeout immunity.
- Physical iOS/Android camera scanning and full-screen tablet operation were not available in
  this environment; QR payloads and rendered codes are covered by the existing utility/server
  validation and browser smoke checks.
