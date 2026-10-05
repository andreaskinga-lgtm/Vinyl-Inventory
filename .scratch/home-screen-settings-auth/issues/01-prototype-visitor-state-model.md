Status: resolved
Kind: prototype
Blocked by:

# Prototype the visitor, admin, and navigation state model

## Question

Does the proposed state model keep Home Screen, Collection Display browsing, direct phone
browsing, Admin Session, Edit Mode, Settings intent, display timeout, and session expiry distinct
under awkward transition sequences?

Read the full
[`Home Screen, visitor Wi-Fi handoff, Settings, and administrator security`](../spec.md) before
building the prototype.

## Artifact

Create one clearly throwaway, self-contained HTML file next to the application entry point:

`src/HomeScreenState.prototype.html`

It must open by double-click with no server, package install, persistence, or build command. Put
the state machine/reducer in one pure inline module that does not reference the DOM.

## Scenarios

The page must show the complete relevant state after every action and provide both free-play
buttons and guided walkthrough tabs for:

1. Browse on this device, interact, then return Home after display inactivity.
2. Open on my phone while already connected and reach the `/browse` QR.
3. Open on my phone while disconnected, scan Wi-Fi, manually continue, then reach `/browse`.
4. Use Open on my phone when Wi-Fi is unconfigured and skip directly to the collection QR.
5. Select Edit Mode while signed out, authenticate, and resume Edit Mode.
6. Sign in generically and remain in View Mode.
7. Select Settings while signed out, authenticate, edit a dirty section, and handle navigation.
8. Let the Admin Session expire with unsaved input, re-authenticate, and resume the action.
9. Select Home Screen while authenticated/editing and prove that it signs out and exits Edit
   Mode.
10. Load `/browse` directly and prove display timeout cannot send the phone back Home.

Illegal transitions must be visible rather than silently accepted.

## Completion criteria

- A non-developer can drive every scenario and understand the displayed state without reading
  source code.
- The issue receives a `## Comments` entry stating the verdict, any changed transition rules, and
  which reducer/state-machine shape should inform implementation.
- Capture the prototype on a throwaway branch as a primary source and add the branch pointer to
  the issue.
- Remove the HTML shell from the implementation branch after the decisions are folded into the
  spec/tickets.
- Do not add tests, production abstractions, persistence, or network calls.

## Comments

- **Verdict:** The proposed model holds under all ten walkthroughs when navigation context,
  display timing, browser-known authentication, Edit Mode, pending intent, and Settings dirtiness
  remain separate state axes. The standalone artifact also makes illegal transitions visible,
  including both display countdown and timeout attempts from direct `/browse`.
- **Changed transition rules:** Display timeout is now explicitly the same safe public reset as
  selecting **Home Screen**: it returns to `/`, exits Edit Mode, ends the Admin Session, and clears
  transient visitor and administrator intent. Server session expiry is not predicted by the
  browser; the browser retains its last-known signed-in state until a protected request returns
  `401`, then preserves the exact pending draft/action for re-authentication.
- **Implementation shape:** Use one pure transition function over lifted App state with
  orthogonal navigation, visitor-display, administrator, and Settings slices. Represent
  authentication resumption as a tagged pending intent rather than coupled booleans.
- **Primary source:** `prototype/home-screen-visitor-state-model` at commit `159f608`
  (`src/HomeScreenState.prototype.html`). The HTML shell was removed from the implementation
  branch after these decisions were folded into the spec and downstream tickets.
