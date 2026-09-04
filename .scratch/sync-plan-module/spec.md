Status: done
Blocked by: .scratch/discogs-deletion-data-loss/spec.md

# Deepen the Discogs sync review into a Sync Plan module

> Came out of an `/improve-codebase-architecture` review on 2026-09-04 and was settled by a
> `/grilling` session the same day. Vocabulary is from the `codebase-design` skill
> (**module**, **interface**, **implementation**, **depth**, **seam**, **adapter**,
> **leverage**, **locality**); domain vocabulary is from `CONTEXT.md` (**Record**,
> **Pressing**, **Claimed / Unclaimed**).
>
> Sibling: `.scratch/collection-module-persistence-seam/spec.md` owns _applying_ a sync
> plan; this owns _building_ it. They meet at `onImport`, which does not move in this pass.

## Files

- `src/components/DiscogsImport.jsx` (1177 lines)
- `src/utils/discogsMapper.js` (166 lines)
- `src/utils/discogsMapper.test.js` (140 lines) — currently the only tests in the repo
- `src/App.jsx:83` — `handleDiscogsImport`, the consumer of the plan

## Problem

The Discogs sync review is one concept — _what this sync will do to the collection_ —
spread across 14 `useState` atoms in `DiscogsImport.jsx` (lines 66–90, out of 21 in the
module) plus several values derived inline during render.

The classification step was correctly extracted into a deep, pure module: `findMatches` in
`discogsMapper.js`. It is the only thing in the repo with tests, and ADR-0001's
claimed-record invariant lives there.

But the extraction stopped at classification. Everything after the initial partition —
manual matching, reassignment confirmation, per-field toggles, selection sets, the deletion
set — sits in the modal with no interface, and therefore no tests. There is no DOM test
setup and the project has deliberately chosen not to add one, so this state is
**structurally untestable where it currently lives**.

This is the "pure function extracted for testability, but the real bugs hide in how it's
called" shape. Two live bugs confirm it.

### Live bug 1 — key namespaces drift apart

`selectedNew` is populated with **raw** keys (`:210`, via `newRecordKey(record, index)` →
`"111"`). The manual-match picker is keyed with **namespaced** keys (`pickerKey("new", ...)`
→ `"new:111"`). When a manual match resolves, `handleManualMatch` removes the record from
`newRecords` but deletes the _namespaced_ key from the _raw_-keyed set:

```js
// DiscogsImport.jsx:373 (and :365 for selectedAmbiguous)
setSelectedNew((prev) => {
  const next = new Set(prev);
  next.delete(key); // key is "new:111"; the set holds "111"
  return next;
});
```

The delete is a no-op and the stale key survives, so `importCount` (`:458`) over-counts and
`allNewChecked` (`:463`) spuriously unchecks itself. Scope check: `handleSync` (`:417`)
filters `newRecords` by raw key, so **no wrong record is ever imported** — this is a label
and checkbox bug, not an import bug.

### Live bug 2 — the deletion set drifts from the classification

Unclaimed pressings involved in an ambiguous match land in "Not on Discogs" and are queued
for deletion, because `findMatches` discards its `fallbackCandidates` and the deletion set
is derived independently of the classification.

**Fixed ahead of this ticket** by `.scratch/discogs-deletion-data-loss/spec.md`, which is a
prerequisite. This ticket must not regress it — it inherits `candidateIds` and the
unchecked-by-default deletion set, and closes the underlying drift by construction.

### Secondary smell

`newRecordKey` falls back to `` `idx-${index}` `` when `discogsId` is null. Indices shift
whenever a record leaves `newRecords`, so those keys silently re-point at different records.

## Design

One **Sync Plan module** at `src/utils/syncPlan.js`, owning the whole review as a single
value behind a small interface. Follows the established location for pure modules; not
worth inventing a directory convention for the second one.

### Shape: a pure reducer

```
beginSync(mappedReleases, existingRecords) -> plan
reducer(plan, intent) -> plan
describePlan(plan) -> { toImport, updates, deletions, counts, summary }
```

Intents:

```
{ type: "toggleImport", releaseKey }
{ type: "toggleAllImports", bucket, on }
{ type: "matchManually", releaseKey, recordId }
{ type: "confirmReassignment" }
{ type: "cancelReassignment" }
{ type: "setFieldEnabled", recordId, field, on }
{ type: "setDeletionsEnabled", on }
{ type: "toggleDeletion", recordId }
```

A plain reducer, driven by `useReducer`, is the flattest testable surface — a test is
`reducer(reducer(beginSync(...), a), b)` with no object identity to reason about — and it
matches the repo's existing style (`discogsMapper.js` is plain pure functions; there are no
classes anywhere).

### The plan snapshots the collection

`beginSync` takes `existingRecords` once and keeps it. The sync review is a review of _one
moment_ of the collection: if `records` changed mid-review the classification behind it
would already be stale, so re-reading per call creates an incoherence rather than fixing
one. It also keeps every intent a function of `(plan, intent)` alone, which is what makes
the reducer readable at call sites inside a 1000-line render.

### Keys are minted once, opaquely

`beginSync` assigns an opaque monotonic key (`"r0"`, `"r1"`, …) to each entry and stores it
on the entry. Stable by construction whether or not `discogsId` is present; a single
namespace, so the raw/namespaced split behind bug 1 cannot recur; and not coupled to
Discogs' identity scheme, which matters because `discogsId` is also a domain field the user
can see. **Never derive a key from an index at read time.**

### `pendingReassign` lives in the plan

It is not a UI affordance, it is a **guard on a state transition** — "reassigning a claimed
record requires confirmation" is ADR-0001 territory and belongs under test. `matchManually`
either returns the next plan or a plan with `pendingReassign` set; `confirmReassignment`
applies it.

Genuine view state stays in the modal: `matchingKey`, `manualMatchSearch`, `pickerAnchorY`,
`expandedMatch`, plus all connect-phase state.

### Derived values are derived

`describePlan` is pure and called on each render, wrapped in a single `useMemo` on the plan
reference. Nothing derived is stored in the plan: keeping derived values in sync on every
intent is the exact failure mode (14 hand-synchronised atoms) this ticket exists to kill.
Recomputing over a few hundred records is free.

### The connect phase stays in the modal

There is already a clean split at `handleFetch:195`: everything above produces
`allReleases` from the network, everything below is a pure function of
`(allReleases, existingRecords)` followed by seven setters. `beginSync(mapped,
existingRecords)` slots in at line 196 and those seven setters collapse into one.

Extracting a `discogsClient` module (token, paging, throttle, progress) is a real
improvement but a _different_ deepening with a different motivation, and bundling it
doubles the diff on the file most in need of careful review. Deferred. Putting the fetch
_inside_ the plan module is ruled out — it would make the plan impure and untestable.

### `titleKey` absorbs the duplication

`findClaimedSibling` (`DiscogsImport.jsx:43`) inlines
`normalizeStr(artist) + "\x00" + normalizeStr(title)`, as does the module-private
`isFallbackMatch` (`discogsMapper.js:69`) — four sites in total, plus the `"\x00"`
empty-key sentinel. `normalizeStr` is already shared; the missing piece is a
`titleKey(record)` helper. `findClaimedSibling` is classification and moves into the plan
module anyway, so the duplication disappears as a side effect. **Do not change what the key
means** — that is ADR-0001 semantics.

### Fill-blanks-only is preserved

`computeFieldsToUpdate` proposes a field only when the existing record's value is absent,
which is why defaulting every field toggle to _on_ is safe: a sync fills blanks and never
overwrites. `discogsId` is always applied regardless of toggles. This invariant is
currently enforced only by the shape of an untested helper — carry it forward unchanged and
assert it in a test.

### `findMatches` becomes an internal seam

Still pure, still tested where it lives, but no longer the external seam and no longer the
only thing under test. `discogsMapper.test.js` stays untouched and passing.

`describePlan`'s output is exactly the `(toImport, updates, deletions)` triple `onImport`
already takes, so the seam with `App.jsx` does not move.

## Tests

`src/utils/syncPlan.test.js`, same style as `discogsMapper.test.js` (Vitest
`describe`/`it`, local factories, plain `expect`, no mocks).

Non-negotiable:

1. **Both live bugs as regressions** — counts and select-all stay correct after a manual
   match; an ambiguous candidate never appears in the deletion set. This is the whole
   justification for the ticket.
2. **`describePlan`'s triple matches what `handleDiscogsImport` consumes** — `toImport` as
   records without ids, `updates` as `[{ existingId, fields }]` with `discogsId` always
   present, `deletions` as an id array, empty when disabled. If this drifts, the refactor
   silently breaks import.

Also cover: each intent's transition; the reassignment guard, including
`confirmReassignment` with no `pendingReassign` being a no-op; fill-blanks-only.

Anything beyond this list is optional.

## Wins

- **Locality**: sync bugs concentrate in one module instead of 14 state atoms.
- **Leverage**: one interface serves the renderer and the tests.
- **Testability**: transitions become testable with no DOM setup, honouring the existing
  "no component tests" decision rather than fighting it.
- Interface shrinks; the implementation absorbs the hand-synchronised state.

## Test budget

`AGENTS.md` scopes Vitest to `findMatches`. That decision reads as "pure modules yes, DOM
no", not "exactly one file", so widening it to a second pure module is a natural extension
and **needs no ADR**. Amend the sentence to say Vitest covers pure modules only
(`discogsMapper.js`, `syncPlan.js`) and that there is deliberately no component or DOM test
setup. An ADR would be warranted only for component tests — that is the actual reversal.

## Relationship to ADR-0001

No conflict. ADR-0001 fixes the _semantics_ of claimed-record matching; this relocates the
**seam** those semantics live behind and gives the invariant one testable home that also
covers the deletion path the ADR never addressed. Do not re-litigate the matching rules.

## Out of scope

- Changing ADR-0001's matching semantics.
- Component-level or DOM tests for `DiscogsImport.jsx`.
- Applying the plan to the collection — see the sibling candidate.
- Extracting a `discogsClient` / connect-phase module.
- Letting the user overwrite an already-populated field from Discogs. A genuine feature
  request, but it changes what a sync means; its own ticket.
- Any change to `data/records.json`'s shape.
