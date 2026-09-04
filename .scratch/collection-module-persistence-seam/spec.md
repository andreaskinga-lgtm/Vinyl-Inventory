Status: needs-triage

# Deepen the Collection into a module, and give its persistence a real seam

> **Handoff note.** This is an architecture candidate, not a spec. It came out of an
> `/improve-codebase-architecture` review on 2026-09-04 and has **not** been through a
> grilling session yet. Start a fresh session on this file, run `/grilling` against the
> open questions below, then rewrite this file as a proper `spec.md`.
>
> Vocabulary is from the `codebase-design` skill: **module**, **interface**,
> **implementation**, **depth**, **seam**, **adapter**, **leverage**, **locality**.
> Domain vocabulary is from `CONTEXT.md`: **Record**, **Pressing**, **Claimed / Unclaimed**.
>
> Sibling candidate: `.scratch/sync-plan-module/spec.md` — that one owns _building_ a sync
> plan; this one owns _applying_ it. They meet at `onImport`. This ticket is workable on its
> own, but is cleaner if the sibling lands first.

## Files

- `src/App.jsx` (381 lines) — lines 32–155 are the whole of this ticket
- `vite.config.js` — `recordsApiPlugin` (lines 30–88), `genreOptionsApiPlugin` (90–147)
- `src/data/records.js` — `sampleRecords`, `generateId()`
- `data/records.json`, `data/genreOptions.json`

## Problem

`App.jsx` is simultaneously the render root, the collection store, the enrichment engine and
the persistence adapter. There is no **Collection** module, so there is no interface to test
through — and `Record` is the central term in `CONTEXT.md`.

### The half of Discogs sync that actually writes is untested

`findMatches` decides _what should happen_ and is well tested. `handleDiscogsImport`
(`App.jsx:83–105`) decides _what actually happens_ and is tested by nothing:

```js
function handleDiscogsImport(newRecs, updates, deletions = []) {
  const incomingGenres = newRecs.map((r) => r.genre).filter(Boolean);
  const incomingSubGenres = newRecs.flatMap((r) => r.subGenres ?? []);
  for (const g of incomingGenres) handleAddGenre(g);
  for (const sg of incomingSubGenres) handleAddSubGenre(sg);

  const deletionSet = new Set(deletions);
  setRecords((prev) => {
    const enriched = prev
      .filter((r) => !deletionSet.has(r.id))
      .map((r) => {
        const update = updates.find((u) => u.existingId === r.id);
        return update ? { ...r, ...update.fields } : r;
      });
    const created = newRecs.map((r) => ({ id: generateId(), ...r }));
    return [...created, ...enriched];
  });

  setShowDiscogsImport(false);
}
```

Deletion, enrichment merge, id minting, genre absorption and modal dismissal in one
function, reachable only by driving the UI.

### Persistence has no seam, and production silently discards everything

Four hardwired `fetch` calls (`App.jsx:34, 49, 68, 115`). Per `AGENTS.md` there is **no
production backend** — `vite build` emits a static SPA with PWA support, and the
`/api/*` endpoints only exist as Vite dev middleware. In the built app the initial GET falls
through to the `catch`, the collection is seeded with `sampleRecords`, and every subsequent
save POSTs into nothing. The deployed PWA cannot persist an edit.

### Hazard — a transient GET failure overwrites the collection with sample data

```js
// App.jsx:57–62
.catch((e) => {
  setRecords(sampleRecords);
  setLoading(false);
  initialized.current = true;   // guard lifted
});
```

The `[records]` save effect (`:66–74`) runs on the very next commit and sees
`initialized.current === true`, so it POSTs `sampleRecords` over `data/records.json`. One
network blip on load replaces the real collection with the seed data. The `useRef` guard
exists precisely to prevent this and does not, because it is lifted in the same tick as the
fallback write.

The success path has the same shape, benignly: every load is immediately echoed back as a
redundant POST.

### Genre options write once per genre, from inside a state updater

`saveGenreOptions` is called _inside_ the `setGenres` / `setSubGenres` updaters
(`App.jsx:127, 138, 150`) over a stale closure of the sibling list. Because
`handleDiscogsImport` calls `handleAddGenre` in a loop, a sync that introduces five genres
fires five racing POSTs, each from an impure updater that React double-invokes under
StrictMode.

## Proposed deepening

**A Collection module** owning record mutation:

```
add(collection, fields) -> collection
edit(collection, id, fields) -> collection
remove(collection, id) -> collection
applySyncPlan(collection, { toImport, updates, deletions }) -> { collection, newGenres, newSubGenres }
```

Pure, no React, no `fetch`. `applySyncPlan` _returns_ the genre/sub-genre vocabulary the
import introduced rather than firing side effects mid-update, which lets the caller persist
options once.

**A storage seam** beneath it, satisfied by three adapters:

| Adapter        | Used in                  |
| -------------- | ------------------------ |
| HTTP           | `npm run dev` (existing) |
| `localStorage` | the built PWA            |
| in-memory      | tests                    |

Three adapters, so the seam is real rather than hypothetical. The load/save lifecycle
(including the `initialized` guard) moves behind it, where the ordering bug can be fixed
once and asserted.

`App.jsx` is left with render and view state: search, sort, edit mode, the parallax effect,
the password prompt.

## Wins

- **Locality**: every write to the collection concentrates in one module.
- **Leverage**: one interface serves `handleAdd`, `handleEdit`, `handleDelete`,
  `handleDiscogsImport` and the tests.
- The apply half of Discogs sync becomes testable without a DOM.
- The built PWA can persist for the first time.
- The seed-overwrite hazard gets one place to be fixed and asserted.

## Open questions for the grilling session

1. **Does production persistence actually matter?** If the built app is only ever a
   read-only shelf browser, the `localStorage` adapter is dead weight and the seam drops to
   two adapters. What is the deployment story?
2. **Adapter selection.** Build-time (`import.meta.env`) or runtime probe of `/api/records`?
   A probe means the same build works in both places; build-time is simpler.
3. **Whole-array writes.** Both the current API and any adapter replace the entire records
   array on every keystroke-free change. Keep that, or is per-record write worth the
   interface cost?
4. **Where does the `initialized` guard belong?** Inside the storage module (load and save
   are one lifecycle), or does the module expose `load()` / `save()` and let the caller
   sequence them?
5. **Genre options: same module or its own?** `applySyncPlan` returning new vocabulary
   implies the caller owns genre options. Candidate 3 in the review proposed a separate
   GenreOptions module with an `absorb(records)` interface. One module or two?
6. **Does `generateId()` move here?** `Date.now() + Math.random()` returns a float and is
   called from `handleAdd` and `handleDiscogsImport`. Related to candidate 5 (a Record
   module) — pull it in or leave it?
7. **Ordering with the sibling ticket.** `applySyncPlan` takes exactly what
   `describePlan(plan)` emits. Land the Sync Plan module first so the shape is settled, or
   land this first so the sync apply gets tests sooner?

## Out of scope

- Adding a real production backend.
- Changing the shape of `data/records.json`.
- Component-level or DOM tests.
- The parallax, password-prompt, search and sort code in `App.jsx` — it stays.
