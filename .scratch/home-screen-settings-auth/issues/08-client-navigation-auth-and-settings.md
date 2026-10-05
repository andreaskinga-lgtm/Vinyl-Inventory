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
7. Build Settings sections for Visitor Display, Wi-Fi, and Discogs with independent Save actions,
   validation/error/success states, and per-section dirty tracking.
8. Implement Settings cancel/origin return and dirty navigation warnings for in-app navigation,
   Back, refresh, and close.
9. Keep the Wi-Fi password prefilled but masked; provide reveal, security-dependent fields, and
   confirmed removal.

## Completion criteria

- Direct `/settings` challenges and resumes; cancel without an origin returns to `/browse`.
- Signing in alone does not enable Edit Mode.
- Edit Mode cannot be enabled without a confirmed Admin Session.
- Each Settings section saves independently, disables duplicate saves, and surfaces server
  errors.
- No React Router or component-level test framework is added.
- Manual navigation/auth checks, targeted tests, `npm run lint`, and `npm run build` pass.
