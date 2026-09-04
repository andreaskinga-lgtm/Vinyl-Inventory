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
