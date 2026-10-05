Status: resolved
Kind: prototype
Blocked by: 01

# Prototype Home Screen and phone-handoff designs

## Question

What visual structure makes the shared-device choice and conditional Wi-Fi-to-collection handoff
obvious to a walk-up visitor without making the Home Screen feel like an administrator tool?

Read **Home Screen**, **Phone handoff**, and **Display reset** in
[`the feature spec`](../spec.md), plus the state-model verdict from issue 01.

## Artifact

Build a throwaway, development-only UI prototype inside the current React app at:

`/?prototype=home&variant=A`

Provide three radically different variants (`A`, `B`, and `C`) selected through the URL and a
fixed bottom-center prototype switcher. Left/right buttons and keyboard arrows cycle variants
without intercepting input controls. The switcher must be impossible to render in production.

Use in-memory fixtures only. Do not call real APIs, persist settings, or reuse prototype code as
production code.

## Required states in every variant

- Home Screen with **Browse on this device** and **Open on my phone**.
- Connected-to-SSID Yes/No question.
- Wi-Fi QR step with SSID, masked/revealed password, copy action, and manual continue.
- Collection `/browse` QR step.
- Wi-Fi-unconfigured direct collection QR behavior.
- Start over and final 10-second reset countdown.
- Tablet landscape/portrait and narrow-phone responsive layouts.

The variants must disagree structurally: information hierarchy, step presentation, and primary
affordances should differ, not just colors or spacing.

## Completion criteria

- The issue receives a `## Comments` entry naming the selected direction and any elements combined
  from other variants.
- Accessibility, touch-target, QR-size, and copy/reveal decisions are recorded with the verdict.
- Capture all variants on a throwaway branch and add the branch pointer to the issue.
- Fold the winning decisions into the spec and implementation tickets, then remove variants and
  the switcher from the implementation branch.
- Do not add tests or production error handling.

## Comments

- **Verdict:** Select Variant C, the image-first Collection Display direction, with no structural elements
  imported from Variants A or B. Keep it grounded in the existing collection browser: near-black
  background, restrained amber accent, Avenir-style typography, compact uppercase labels,
  hairline panel borders, square album-art motifs, and floating pill controls.
- **Home Screen:** Present **Browse on this device** as the dominant amber action and **Open on my
  phone** as the secondary dark action. The screen remains a visitor-facing collection entrance
  with no Settings, authentication, or administrator language.
- **Handoff presentation:** Open the connected-to-SSID question and every later phone-handoff
  step in a fixed, centered modal over a dimmed/blurred Home Screen. Do not append handoff content
  below the Home Screen or require page scrolling to discover it. Reset document scroll when
  opening the modal, entering Collection Display mode, or starting over; use internal modal
  scrolling only when a narrow viewport cannot fit the step.
- **Collection Display transition:** **Browse on this device** immediately replaces the Home
  Screen with the existing collection UI in Collection Display mode at `/`. It does not scroll to
  appended content and does not navigate to the phone-only `/browse` path.
- **Accessibility and touch:** Production modals use dialog semantics, an accessible title,
  initial focus, focus containment/restoration, Escape support, and the visible **Start over**
  action. Keep all controls at least 44 by 44 CSS pixels and primary visitor actions at least 52
  pixels high. Preserve visible keyboard focus and do not rely on color alone for step or copy
  status.
- **QR and credential fallback:** Target a 280 CSS-pixel QR with a white quiet zone, scaling to
  available width but not below 220 pixels in supported phone layouts. Keep the password masked by
  default; **Show password** reveals it and enables **Copy password**. Copy feedback must explicitly
  report success or unavailability.
- **Responsive behavior:** Tablet landscape and portrait retain the image-first composition.
  Narrow phones stack the two Home actions and use a viewport-contained modal; the fixed
  prototype switcher is not part of production.
- **Primary source:** `prototype/home-screen-handoff-ui` at commit `00206d0`
  (`src/prototypes/home-screen/`). The prototype route and switcher were removed from the
  implementation branch after these decisions were folded into the spec and implementation
  ticket.
- **Validation:** All required configured/unconfigured handoff paths, password reveal/copy,
  Start over, countdown, variant keyboard switching, tablet/phone layouts, and Collection Display
  transitions were exercised with zero API requests. `npm run lint` and the production build
  passed before capture.
