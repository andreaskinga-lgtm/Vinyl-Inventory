# Vinyl Inventory

A personal vinyl record collection tracker. Each collection entry can be independently linked to a Discogs release for enrichment (cover art, genre, styles, year) and re-sync.

## Language

**Record**:
One entry in the local collection (`data/records.json`), representing a single physical item you own. Has its own `id`, artist, title, and optional `discogsId` link.

**Pressing**:
Two or more records that share the same artist + title but are different physical items you own — e.g. a reissue, a different edition, or a different version with distinct cover art. Each pressing is its own independent record with its own Discogs link; they are never merged or nested.
_Avoid_: Duplicate, copy, variant

**Claimed / Unclaimed**:
The link state of a record with respect to Discogs sync. A record is _claimed_ once its `discogsId` is set — it is bound to that specific Discogs release and must never be silently reassigned to a different release by automatic (artist+title fallback) matching during sync. A record with `discogsId == null` is _unclaimed_ and eligible for fallback matching.
_Avoid_: Linked/unlinked (used loosely elsewhere for other things), matched/unmatched (used for the sync review UI state, a different concept)

**Discogs Credential**:
A complete Discogs username and personal access token pair that the service uses for Discogs requests. An environment-provided pair is authoritative; a saved pair is a trusted-LAN fallback.
_Avoid_: API key, login

**Visitor**:
A person invited to browse the collection without administrative access.
_Avoid_: Guest user, public user

**Collection Display**:
A shared tablet or similar device that visitors can use to browse the collection or open it on their own device.
_Avoid_: Admin device, kiosk

**Home Screen**:
The collection display's default visitor screen, offering a choice between browsing on that display and opening the collection on another device.
_Avoid_: Welcome screen, share modal, landing page

**Administrator**:
The collection owner or another trusted person authenticated to change collection data and site settings.
_Avoid_: Editor, edit-mode user

**Admin Session**:
An authenticated browser session that permits administrative actions without itself enabling record editing.
_Avoid_: Edit mode, login mode

**Edit Mode**:
A deliberate interface state, available only during an admin session, that exposes controls for changing the collection.
_Avoid_: Admin mode, authenticated mode

**Visitor Wi-Fi Network**:
The single wireless network an administrator chooses to share with visitors so they can reach the collection site.
_Avoid_: Primary network, configured Wi-Fi

**Site Setting**:
An administrator-managed value that controls the collection site's behavior or visitor experience.
_Avoid_: Config value, preference
