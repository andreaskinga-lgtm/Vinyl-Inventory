Status: resolved
Kind: implementation
Blocked by: 05, 07

# Add client navigation, authentication state, and the Settings page

## Goal

Introduce `/`, `/browse`, and protected `/settings` without a routing dependency, then build the
general Settings shell and its independent sections.

Read **Visitor navigation**, **Collection menu**, and **Settings page** in
[`the feature spec`](../spec.md).

## Files

- Update `src/App.jsx` and `src/App.css`.
- Update `src/components/ListeningRoom.jsx` and its CSS.
- Add co-located Settings and sign-in components/CSS under `src/components/`.

## Steps

1. Add a small History API view layer for `/`, `/browse`, and `/settings`, including `popstate`
   handling and direct-load normalization.
2. Drive lifted navigation, visitor-display, administrator, and Settings state through one pure
   transition function (or equivalent centralized pure transition layer) so path/context,
   authentication, Edit Mode, pending intent, and dirty state cannot drift independently.
3. Load authenticated state from `/api/auth/session`; keep the browser's last-known Admin Session
   state separate from Edit Mode and from server-authoritative expiry.
4. Replace the hardcoded client password prompt with the server sign-in flow.
5. Preserve initiating intent as a tagged pending action: generic sign-in stays in View Mode, Edit
   mode resumes editing, and Settings resumes `/settings`.
6. Update the collection menu to show **Home Screen**, Edit/View mode, Settings, and Sign out
   according to the spec.
7. Build the validated Variant A Settings shell: a persistent section index on tablet/desktop,
   three top tabs on narrow screens, and one focused editor. Show each section's clean, dirty,
   saving, success, validation-error, or server-error state in the index and editor.
8. Implement Settings cancel/origin return and dirty navigation warnings for in-app navigation,
   Back, refresh, and close. Name affected sections and use **Keep editing** / **Discard and
   leave**.
9. Keep the Wi-Fi password prefilled but masked; provide reveal, security-dependent fields, and
   confirmed removal at the bottom of the section.
10. Keep copy concise: one **Settings** title, no internal layout label or section numbers, no
    save-scope explainer, and plain **Save** buttons.
11. Use **Sign in to open Settings** initially and **Sign in again to finish saving** when an
    expired session interrupts a retained section save.

## Completion criteria

- Direct `/settings` challenges and resumes; cancel without an origin returns to `/browse`.
- Signing in alone does not enable Edit Mode.
- Edit Mode cannot be enabled without a confirmed Admin Session.
- Each Settings section saves independently, disables duplicate saves, and surfaces server
  errors.
- Tablet/desktop and narrow-screen layouts preserve the selected section-index structure and
  concise copy.
- No React Router or component-level test framework is added.
- Manual navigation/auth checks, targeted tests, `npm run lint`, and `npm run build` pass.

## Comments

- **Implementation:** Wired the History API views for `/`, `/browse`, and protected `/settings`
  through the pure client transition seam. Replaced the legacy client password prompt with
  server session loading, sign-in/logout, intent-aware authentication, Edit Mode gating, safe
  Home Screen handoff, and session-expiry recovery for Settings saves/removals. Added the
  Variant A Settings shell with independent Visitor Display, Wi-Fi, and Discogs editors,
  per-section status/error handling, masked Wi-Fi credentials, confirmed removals, responsive
  index/tabs, and dirty navigation protection for in-app navigation, Back, refresh, and close.
  Ticket 09 Sync changes and ticket 10 full visitor handoff/timeout remain intentionally out of
  scope.
- **Validation:** `npx vitest run src/utils/appTransition.test.js` (14 passed), `npm test`
  (246 Vitest tests and 5 backup tests passed), `npm run lint`, `npm run build`, and
  `git diff --check` passed. Manual Playwright checks covered direct Settings challenge/cancel,
  authenticated Edit Mode, Settings save, dirty Cancel, and browser Back warning.
