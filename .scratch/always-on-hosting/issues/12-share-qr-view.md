Type: prototype
Status: resolved
Blocked by: 07

# In-app share / QR view

## Question

The whole point of the effort: a friend arrives, scans something, browses the collection.

Prototype what that looks like. Open sub-questions: does the app render its own QR (needs a QR
dependency — evaluate size) or does the README just say "make one"? Does the QR encode a
runtime-detected `window.location.origin`, or a configured canonical URL (the two differ when
Andrea opens it on the Pi itself)? Where does it live in the UI — a header button, a modal, a
dedicated screen shown on a display near the turntable? Does the guest view need any framing
text, or is it just the code?

Rough is fine. This is the one item on the map that touches app UI rather than deployment, so
keep the scope tight enough that it doesn't turn into a feature effort.

## Answer

Use a header-level **Share collection** action that opens a modal. The app renders
the QR code itself, rather than asking an owner to make one elsewhere. Its value is
the current `window.location.origin`, so it reflects whichever supported LAN address
the owner used to reach the collection.

The modal frames the code with a short invitation to browse the shelves and the
reassurance, "No app or sign-in needed." There is no configured canonical URL and
no dedicated guest-view feature in this effort.

The evaluated alternatives are preserved on the throwaway
[`prototype/share-qr-view`](../../../tree/prototype/share-qr-view) branch
([`234b422`](../../../commit/234b422)); it provides modal, host-display, and
floating-card variants at `/?prototype=share-qr&variant=a|b|c`. Its QR graphic is
an intentionally non-scannable visual placeholder, not implementation code.
