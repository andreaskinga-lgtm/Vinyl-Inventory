Status: ready-for-agent
Kind: implementation
Blocked by: 05, 08

# Make collection writes server-first and recover from expired sessions

## Goal

Prevent the browser from presenting rejected authenticated mutations as saved collection state.

Read **Reliable authenticated writes** in
[`the feature spec`](../spec.md).

## Files

- Update `src/App.jsx`.
- Update record/genre forms and modals only where saving/error contracts require it.
- Add or extend pure helpers/tests when computing next collection state benefits from isolation.

## Steps

1. Remove the records auto-save effect and its initialization guard.
2. For add, edit, delete, import, and genre-option changes, compute the complete next payload,
   await the authorized server save, then commit App state.
3. Disable duplicate submissions and show saving/failure state through existing form surfaces.
4. Centralize protected fetch handling so `401` clears the browser's last-known Admin Session
   state and Edit Mode; do not use a client timer to predict server expiry.
5. Preserve pending form values and the exact intended payload as a tagged pending action where
   practical.
6. Re-open sign-in with a session-expired explanation and resume only that tagged action after
   successful authentication.
7. Never silently retry a non-idempotent write without the captured intended payload.
8. Confirm authenticated server requests reset session activity; local typing alone does not.

## Completion criteria

- Failed/unauthorized writes leave committed App state equal to server state.
- Expiry during record editing, Settings, genre editing, and Discogs import has explicit UI
  behavior and no success-shaped fallback.
- Re-authentication resumes supported actions without automatically enabling Edit Mode unless
  Edit Mode was the initiating intent.
- Existing successful editing/import behavior remains intact.
- Targeted tests, `npm run lint`, and `npm run build` pass.
