Status: ready-for-agent
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
2. Load authenticated state from `/api/auth/session`; keep Admin Session state separate from Edit
   Mode.
3. Replace the hardcoded client password prompt with the server sign-in flow.
4. Preserve initiating intent: generic sign-in stays in View Mode, Edit mode resumes editing, and
   Settings resumes `/settings`.
5. Update the collection menu to show **Home Screen**, Edit/View mode, Settings, and Sign out
   according to the spec.
6. Build Settings sections for Visitor Display, Wi-Fi, and Discogs with independent Save actions,
   validation/error/success states, and per-section dirty tracking.
7. Implement Settings cancel/origin return and dirty navigation warnings for in-app navigation,
   Back, refresh, and close.
8. Keep the Wi-Fi password prefilled but masked; provide reveal, security-dependent fields, and
   confirmed removal.

## Completion criteria

- Direct `/settings` challenges and resumes; cancel without an origin returns to `/browse`.
- Signing in alone does not enable Edit Mode.
- Edit Mode cannot be enabled without a confirmed Admin Session.
- Each Settings section saves independently, disables duplicate saves, and surfaces server
  errors.
- No React Router or component-level test framework is added.
- Manual navigation/auth checks, targeted tests, `npm run lint`, and `npm run build` pass.
