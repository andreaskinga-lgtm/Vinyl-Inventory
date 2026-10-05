Status: ready-for-agent
Kind: implementation
Blocked by: 07, 08

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
9. Ensure **Home Screen** exits Edit Mode, signs out, clears transient dialogs/state, and returns
   to `/`.

## Completion criteria

- QR-only behavior works when Wi-Fi is absent, with no visitor-visible setup hint.
- Representative iOS and Android devices can scan WPA/open/hidden Wi-Fi payloads and `/browse`.
- Collection Display browsing resets after the configured timeout; direct phone browsing does
  not.
- Home, Back, refresh, Start over, copy/reveal, and safe sign-out behavior are manually verified.
- The Home Screen is usable at tablet dimensions and remains accessible by keyboard/screen reader.
- `npm run lint` and `npm run build` pass.
