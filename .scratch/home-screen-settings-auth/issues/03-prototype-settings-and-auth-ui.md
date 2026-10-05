Status: resolved
Kind: prototype
Blocked by: 01

# Prototype Settings and administrator-authentication designs

## Question

What Settings layout makes three independently saved sections, authentication state, dirty
changes, secret fields, environment-managed Discogs credentials, and destructive removal actions
understandable without turning a small hobby app into a dense control panel?

Read **Collection menu**, **Settings page**, and **Reliable authenticated writes** in
[`the feature spec`](../spec.md), plus the state-model verdict from issue 01.

## Artifact

Build a throwaway, development-only UI prototype inside the current React app at:

`/?prototype=settings&variant=A`

Provide three radically different variants (`A`, `B`, and `C`) selected through the URL and the
same fixed prototype switcher contract as issue 02. The switcher must be unavailable in
production.

Use in-memory fixtures only. Simulate saves, validation, expiry, and source changes without
calling real APIs or writing files.

## Required states in every variant

- Signed-out Settings navigation and sign-in challenge.
- Authenticated Settings with Visitor display, Wi-Fi, and Discogs sections.
- Per-section clean, dirty, saving, success, validation-error, and server-error states.
- Wi-Fi WPA/open/hidden controls, masked/revealed passphrase, and confirmed removal.
- Saved Discogs credential with blank-means-unchanged token behavior.
- Environment-managed read-only Discogs state.
- Session-expired save followed by re-authentication and action resumption.
- Unsaved-navigation warning and return-to-origin behavior.

The variants must disagree structurally: for example, one may use a section index, one a linear
document, and one task-focused panels. Do not produce three card grids with different styling.

## Completion criteria

- The issue receives a `## Comments` entry naming the selected layout and explaining how
  independent saves, dirty state, and credential source are communicated.
- Menu wording, sign-in wording, destructive-action placement, and mobile behavior are recorded.
- Capture all variants on a throwaway branch and add the branch pointer to the issue.
- Fold the winning decisions into the spec and implementation tickets, then remove variants and
  the switcher from the implementation branch.
- Do not add tests, persistence, or real credential handling.

## Comments

- **Verdict:** Select Variant A: a persistent section index with one focused editor. Keep the
  structure, but use the refined concise copy: one visible **Settings** title, no internal
  **Section index** label, no section numbers, no explanation that sections save independently,
  and plain **Save** buttons.
- **Independent saves and dirty state:** Each index row shows the section's state while the
  focused editor repeats it beside **Discard** and **Save**. States remain explicit: saved,
  dirty, saving, success, validation error, and server error. There is no page-wide Save.
- **Credential source:** The Discogs section leads with saved, environment-managed, or
  unconfigured source/status. A saved token is never shown; a blank token keeps it unchanged.
  Environment-managed credentials replace the editor with read-only readiness.
- **Wording:** The collection menu item is **Settings**. Initial authentication says **Sign in
  to open Settings**; an expired save says **Sign in again to finish saving** and resumes the
  retained action. Dirty navigation names affected sections and offers **Keep editing** or
  **Discard and leave**.
- **Destructive actions:** Put Wi-Fi and saved-Discogs removal at the bottom of their owning
  sections, separated from ordinary fields and followed by explicit confirmation.
- **Mobile behavior:** Collapse the section index into three top tabs, keep one editor visible,
  stack section actions, and keep dialogs viewport-contained. The prototype-state panel starts
  collapsed and stays clear of form actions on narrow screens.
- **Primary source:** `prototype/settings-auth-ui` at commit `c942440`
  (`src/prototypes/settings/`). The prototype route and switcher are absent from the
  implementation branch.
- **Validation:** Authentication, exact-draft save resumption, save/error states, removals,
  dirty navigation, Discogs sources, desktop/mobile concise copy, and plain Save behavior were
  exercised with zero API requests. `npm run lint`, `npm run build`, and production gating
  passed.
