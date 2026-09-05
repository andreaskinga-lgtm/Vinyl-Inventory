Status: ready-for-agent

# Discogs sync: support multiple pressings of the same album

## Problem Statement

A user acquired a duplicate copy of an album — a different pressing with different cover art — and added it to their collection alongside their existing copy. When running a Discogs sync afterward, the sync gets confused: instead of recognizing the new pressing as a distinct item and adding it alongside the existing one, it repeatedly swaps the Discogs link (`discogsId`) between the two records on every sync. Neither record ends up reliably linked to its own correct release, and the two pressings can never both be enriched/tracked correctly at the same time.

## Solution

Discogs sync will treat records that already have a confirmed Discogs link as permanently bound to that specific release, and will never reassign that link to a different incoming release just because the artist/title happen to match. When a synced release can't be confidently matched to an existing record because all same-title candidates are already linked elsewhere, it will be offered as a new record to add — so a second (or third) pressing joins the collection alongside the original, each with its own independent Discogs link. When there's genuine ambiguity (more than one existing, unlinked record shares the same artist/title), the sync will not guess — it will leave the user to resolve it manually using the existing manual-match picker, which will gain a safeguard against accidentally reassigning a record that's already linked to a different release.

## User Stories

1. As a collector who owns two different pressings of the same album, I want each pressing to be tracked as a separate record in my collection, so that I can record their individually distinct cover art, condition, and other details.
2. As a collector syncing with Discogs, I want a record that's already linked to a specific Discogs release to stay linked to that release, so that repeated syncs don't silently reassign my data to the wrong release.
3. As a collector who just added a second pressing of an album I already own, I want the next Discogs sync to recognize it as a new item to add, so that it appears alongside my existing copy instead of overwriting its Discogs link.
4. As a collector reviewing a sync, I want a newly-found release that looks similar to an existing pressing to be flagged with a hint (e.g., showing the existing pressing's cover/details), so that I understand why it showed up as "new" and don't mistake it for an unrelated duplicate entry or a bug.
5. As a collector with two existing, unlinked records that share the same artist/title (e.g., entered manually before ever syncing), I want the sync to avoid guessing which one a newly-found release belongs to, so that my data doesn't get linked to the wrong physical copy.
6. As a collector facing that ambiguous case, I want to be able to manually pick which of my existing records the new release should link to, using the existing manual-match picker, so that I retain control over the correct pairing.
7. As a collector using the manual-match picker, I want to be warned before I reassign a record that's already linked to a different Discogs release, so that I don't accidentally break an existing correct link.
8. As a collector who receives that warning, I want to be able to confirm and proceed anyway, so that I can still fix a genuinely bad link by hand without needing to edit raw data.
9. As a collector, I want a Discogs release whose ID no longer appears anywhere in my fetched Discogs collection to remain eligible for the existing "delete unmatched" cleanup flow, so that removed releases are still handled the same way as before, per pressing.
10. As a maintainer of this codebase, I want the core matching decision (claimed vs. unclaimed, new vs. ambiguous) to live in a single, pure, testable function, so that this logic can be verified without needing to drive the UI or mock network calls.

## Implementation Decisions

- **Terminology** (recorded in `CONTEXT.md`): a **pressing** is two or more local records that share the same artist + title but represent different physical items owned (different edition/version/cover). Pressings are always independent records — never merged or nested. A record is **claimed** once its `discogsId` is set (bound to that specific release) and **unclaimed** while `discogsId` is `null`.
- **Matching invariant**: `discogsId` equality remains the primary match. The existing artist+title fallback match is retained, but is now scoped to only consider **unclaimed** existing records (`discogsId == null`) as candidates — a claimed record is never a fallback-match candidate for a *different* incoming `discogsId`, even if its own linked release has disappeared from the fetched Discogs collection.
- **Fallback outcomes**:
  - Zero unclaimed candidates share the artist+title → the incoming release is classified as a **new record** (same bucket/flow as any unrelated new release), enabling it to be added alongside existing pressings.
  - Exactly one unclaimed candidate shares the artist+title → auto-match proceeds as today (existing enrichment/field-update behavior unchanged).
  - More than one unclaimed candidate shares the artist+title → the incoming release is classified into a new **ambiguous** bucket rather than auto-matched or silently treated as new; it requires manual resolution via the existing manual-match picker and must not disappear or get silently imported.
- **Module boundary**: `findMatches` in `src/utils/discogsMapper.js` is extended to compute and return this three-way classification (`newRecords`, `matchedRecords`, and a new `ambiguousRecords`) instead of two-way. `isMatch`/internal helpers are updated accordingly to take claimed state into account. No new files/modules are introduced; this stays a pure function with no DOM/network dependency.
- **UI wiring in `DiscogsImport.jsx`**:
  - Records in the new `ambiguousRecords` bucket are surfaced in the review phase in a way that makes clear they need manual resolution (reusing the existing manual-match picker UI/flow already used for unmatched "new" records), rather than being silently added or dropped.
  - New records that share a normalized artist+title with an existing (claimed) record get a non-blocking inline hint (e.g., "similar to existing pressing" plus the existing record's cover thumbnail/title) so the user understands why what looks like a duplicate appeared as "new." This is informational only and does not change selection/import behavior.
  - The manual-match picker gains a confirmation step: attempting to link a "new"/ambiguous release to an existing record that already has a *different*, non-null `discogsId` shows a warning (e.g., "This copy is already linked to a different release — reassign anyway?"); the user must confirm before the reassignment proceeds. Declining leaves the existing link untouched and the release unmatched.
  - The existing "unmatched existing / delete unmatched" derivation (records whose linked `discogsId` no longer appears in the fetched collection) is unaffected by this change and continues to operate per-record, so it works the same way for each pressing independently.
- **No schema changes**: the local record shape (`data/records.json`) is unchanged — pressings are just ordinary records that happen to share artist+title; no new fields are introduced to track "pressing groups."

## Testing Decisions

- Good tests here exercise `findMatches`'s observable input/output contract only — given arrays of mapped Discogs records and existing local records, assert which bucket (`newRecords` / `matchedRecords` / `ambiguousRecords`) each ends up in and what `fieldsToUpdate` is computed — not internal helper call counts or implementation details of `isMatch`.
- Primary module under test: `src/utils/discogsMapper.js` (specifically `findMatches`, and `isMatch`/`computeFieldsToUpdate` insofar as they affect `findMatches`'s output). This is the single seam for this feature, chosen because it's already a pure, exported, framework-free function with no DOM or network dependency — the highest and only seam needed.
- Key cases to cover: single claimed record + non-matching incoming ID → release goes to new; single unclaimed record sharing artist+title → auto-matched (existing behavior, regression check); two unclaimed records sharing artist+title → both go to ambiguous, neither auto-matched; a claimed record whose own linked release is absent from the fetched collection is unaffected by matching for a *different* incoming release with the same artist+title (still goes to new/ambiguous per the unclaimed-candidate count, and remains separately eligible for the pre-existing "unmatched/delete" derivation).
- Prior art: none — this repository has no test runner configured (per `AGENTS.md`, "No test runner is configured"). Introducing a minimal runner (e.g., Vitest) to execute these assertions against the pure function is treated as part of this feature's implementation, scoped narrowly to this one seam; it should not be used as justification to add broader test infrastructure or component-level tests in this pass.
- The UI wiring in `DiscogsImport.jsx` (hint rendering, confirmation dialog, ambiguous-bucket display) is not covered by automated tests in this spec and should be manually verified.

## Out of Scope

- Any UI/component-level automated tests (e.g., testing `DiscogsImport.jsx` rendering or interactions directly).
- Preventing duplicate `discogsId`s from being introduced by any path other than the manual-match picker (e.g., no new validation is added elsewhere in the app).
- Any concept of grouping/linking pressings of the same album together in the data model (e.g., a shared "album group" id) — pressings remain independent, unrelated records that merely happen to share artist+title.
- Changes to the "delete unmatched" cleanup flow's logic beyond confirming it continues to work per-record.
- Broader test infrastructure or conventions beyond the minimal runner needed to exercise `findMatches`.

## Further Notes

- This spec was produced following a grilling session (see prior conversation) that resolved the domain model and matching semantics; those decisions are also recorded in `CONTEXT.md` (new "Pressing" / "Claimed / Unclaimed" terms) and `docs/adr/0001-discogs-sync-claimed-record-matching.md`.
- The root cause of the reported bug is in `findMatches`'s reliance on `existingRecords.find(isMatch)`, which both (a) allows a claimed record to be re-claimed by a different incoming `discogsId` via the artist+title fallback, and (b) picks an arbitrary first candidate when more than one existing record matches — this spec's matching invariant closes both gaps at once.
