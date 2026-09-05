Status: done

# Discogs sync can delete both pressings of an ambiguously-matched album

> Split out of `.scratch/sync-plan-module/spec.md` during a grilling session on
> 2026-09-04. That ticket relocates the seam this bug lives behind; this one stops the
> data loss now, on a small reviewable diff, so the deepening starts from a green
> baseline. Ship this first.

## Files

- `src/utils/discogsMapper.js` — `findMatches` (the classification)
- `src/utils/discogsMapper.test.js` — the only tests in the repo
- `src/components/DiscogsImport.jsx` — `unmatchedExisting` (`:452`), `toggleEnableDeleteUnmatched` (`:393`)

## The bug

Ticking **"Also delete records not found in Discogs"** can destroy local records that the
sync is _simultaneously_ offering for manual matching.

`findMatches` classifies an incoming release as **ambiguous** when two or more unclaimed
local records share its artist+title — ADR-0001's "never guess" rule. But it pushes only
the _Discogs_ record into `ambiguousRecords` (`discogsMapper.js:161`) and **discards the
`fallbackCandidates` array entirely**. The local records involved are never recorded
anywhere.

The deletion set is then derived in render, independently of the classification:

```js
// DiscogsImport.jsx:451-456
const matchedExistingIds = new Set(matchedRecords.map((m) => m.existing.id));
const unmatchedExisting = existingRecords.filter(
  (e) =>
    !matchedExistingIds.has(e.id) &&
    (!e.discogsId || !fetchedDiscogsIds.has(e.discogsId)),
);
```

Take two **unclaimed** pressings of the same album and one incoming release. Neither local
record is in `matchedExistingIds`, and both have `discogsId == null` — so **both land in
"Not on Discogs"**. `toggleEnableDeleteUnmatched` (`:393-398`) then pre-checks every one of
them:

```js
new Set(unmatchedList.map((r) => r.id));
```

The user sees the same album offered for manual matching _and_ queued for deletion. One
click deletes both pressings.

This is invisible to the test suite because the deletion set is computed outside the module
that owns the classification. Note that the modal **cannot** fix this on its own: the
information it needs was thrown away upstream.

## Fix

### 1. `findMatches` keeps its candidates

Each entry in `ambiguousRecords` carries the ids of the unclaimed local records that made
it ambiguous:

```js
ambiguousRecords.push({
  discogs,
  candidateIds: fallbackCandidates.map((c) => c.id),
});
```

Adjust the existing ambiguous-path test and any `ambiguousRecords` consumers in
`DiscogsImport.jsx` to the new entry shape.

> Deliberately forward-compatible: `.scratch/sync-plan-module/` keeps `candidateIds`
> verbatim. Do **not** fix this by re-deriving title keys inside the modal — that would
> implement the classification a third time and make the root cause worse.

### 2. Exclude candidates from the deletion set

```js
const ambiguousCandidateIds = new Set(
  ambiguousRecords.flatMap((a) => a.candidateIds),
);
const unmatchedExisting = existingRecords.filter(
  (e) =>
    !matchedExistingIds.has(e.id) &&
    !ambiguousCandidateIds.has(e.id) &&
    (!e.discogsId || !fetchedDiscogsIds.has(e.discogsId)),
);
```

### 3. Deletions default to unchecked

`toggleEnableDeleteUnmatched` currently pre-checks every unmatched record, so enabling the
option one-click-arms an irreversible mass delete over records the user may have added by
hand. That default is what made this bug destructive rather than merely wrong.

Enabling the option now selects **nothing**; the user opts in per record, or uses the
existing select-all control once.

## Tests

Add to the existing `describe("findMatches")` block in `discogsMapper.test.js`, in the same
style (plain `expect`, the local `discogsRecord` / `localRecord` factories, no mocks):

- an ambiguous classification reports both unclaimed local records in `candidateIds`
- a record that is auto-matched, or claimed by a different release, does not appear in any
  `candidateIds`

The deletion-set derivation itself stays untested here — it lives in the component, which
has no test setup. `.scratch/sync-plan-module/` moves it somewhere testable.

## Out of scope

- ADR-0001's matching semantics. Which records are ambiguous does not change; only whether
  the classification's own evidence survives the return statement.
- The `selectedNew` key-namespace bug (counts and the select-all checkbox drift after a
  manual match). It is cosmetic — `handleSync` filters by raw key, so no wrong record is
  ever imported — and patching it in place means writing key reconciliation that
  `.scratch/sync-plan-module/` immediately deletes.
- Any restructuring of `DiscogsImport.jsx`.
