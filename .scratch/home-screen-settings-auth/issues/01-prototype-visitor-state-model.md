Status: ready-for-human
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

- Prototype ready for human review in `src/HomeScreenState.prototype.html`.
- Primary-source branch: `prototype/home-screen-visitor-state-model` at commit `2bb8a55`.
- No verdict or production transition-rule changes have been selected yet. Record those here only
  after review.
