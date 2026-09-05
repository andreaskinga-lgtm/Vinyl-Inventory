import { describe, it, expect } from "vitest";
import { beginSync, reducer, describePlan } from "./syncPlan";

/** Builds a minimal Discogs-mapped record (output of mapDiscogsRelease). */
function discogsRecord(overrides = {}) {
  return {
    artist: "Radiohead",
    title: "OK Computer",
    year: 1997,
    genre: "Rock",
    subGenres: ["Alternative Rock"],
    location: "",
    coverUrl: "https://example.com/new-cover.jpg",
    vinylUrl: "",
    vinylUrl2: "",
    discogsId: 111,
    ...overrides,
  };
}

/** Builds a minimal local collection record. */
function localRecord(overrides = {}) {
  return {
    id: "local-1",
    artist: "Radiohead",
    title: "OK Computer",
    year: null,
    genre: "",
    subGenres: [],
    location: "",
    coverUrl: "",
    vinylUrl: "",
    vinylUrl2: "",
    discogsId: null,
    ...overrides,
  };
}

/** Applies a sequence of intents to a plan. */
function run(plan, ...intents) {
  return intents.reduce(reducer, plan);
}

describe("beginSync", () => {
  it("selects new releases by default and never selects ambiguous ones", () => {
    const incomingNew = discogsRecord({
      artist: "Boards of Canada",
      title: "Geogaddi",
      discogsId: 111,
    });
    const incomingAmbiguous = discogsRecord({ discogsId: 222 });
    const view = describePlan(
      beginSync(
        [incomingNew, incomingAmbiguous],
        [
          localRecord({ id: "a" }),
          localRecord({ id: "b" }),
        ],
      ),
    );

    expect(view.newEntries.map((e) => e.discogs)).toEqual([incomingNew]);
    expect(view.newEntries[0].selected).toBe(true);
    expect(view.ambiguousEntries.map((e) => e.discogs)).toEqual([
      incomingAmbiguous,
    ]);
    expect(view.ambiguousEntries[0].selected).toBe(false);
    expect(view.toImport).toEqual([incomingNew]);
  });

  it("mints a stable opaque key per entry even when discogsId is missing", () => {
    const a = discogsRecord({ title: "Kid A", discogsId: null });
    const b = discogsRecord({ title: "Amnesiac", discogsId: null });
    const plan = beginSync([a, b], []);
    const keys = plan.pending.map((p) => p.key);

    expect(new Set(keys).size).toBe(2);

    // Removing the first entry must not re-point the second entry's key.
    const after = run(plan, {
      type: "matchManually",
      releaseKey: keys[0],
      recordId: "nope",
    });
    const remaining = describePlan(
      run(plan, { type: "toggleImport", releaseKey: keys[0] }),
    );
    expect(after.pending.map((p) => p.key)).toEqual(keys);
    expect(remaining.newEntries[1].key).toBe(keys[1]);
  });

  it("flags an existing claimed pressing of the same album on a new release", () => {
    const claimed = localRecord({ id: "claimed", discogsId: 999 });
    const view = describePlan(
      beginSync([discogsRecord({ discogsId: 111 })], [claimed]),
    );

    expect(view.newEntries).toHaveLength(1);
    expect(view.newEntries[0].claimedSibling).toBe(claimed);
  });
});

describe("import selection", () => {
  it("toggles a single release", () => {
    const plan = beginSync([discogsRecord()], []);
    const key = plan.pending[0].key;
    const off = describePlan(run(plan, { type: "toggleImport", releaseKey: key }));

    expect(off.toImport).toEqual([]);
    expect(off.counts.imports).toBe(0);
    expect(off.allNewChecked).toBe(false);
  });

  it("toggles all releases in one bucket without touching the other", () => {
    const incomingNew = discogsRecord({ title: "Geogaddi", discogsId: 111 });
    const incomingAmbiguous = discogsRecord({ discogsId: 222 });
    const plan = beginSync(
      [incomingNew, incomingAmbiguous],
      [localRecord({ id: "a" }), localRecord({ id: "b" })],
    );

    const view = describePlan(
      run(plan, { type: "toggleAllImports", bucket: "ambiguous", on: true }),
    );

    expect(view.allNewChecked).toBe(true);
    expect(view.allAmbiguousChecked).toBe(true);
    expect(view.toImport).toEqual([incomingNew, incomingAmbiguous]);

    const noneNew = describePlan(
      run(plan, { type: "toggleAllImports", bucket: "new", on: false }),
    );
    expect(noneNew.toImport).toEqual([]);
  });
});

describe("manual matching", () => {
  it("keeps counts and select-all correct after a manual match (regression: bug 1)", () => {
    // Two new releases; one is manually matched to an unrelated local record.
    // The resolved release must leave the import selection entirely.
    const incomingA = discogsRecord({ title: "Kid A", discogsId: 111 });
    const incomingB = discogsRecord({ title: "Amnesiac", discogsId: 222 });
    const target = localRecord({ id: "target", title: "Kid A" });
    const plan = beginSync([incomingA, incomingB], [target]);

    // "Kid A" auto-matches `target`; only "Amnesiac" is new.
    expect(plan.pending).toHaveLength(1);

    const unrelated = localRecord({ id: "unrelated", title: "Something Else" });
    const plan2 = beginSync(
      [incomingA, incomingB],
      [target, unrelated],
    );
    const amnesiacKey = plan2.pending.find(
      (p) => p.discogs.title === "Amnesiac",
    ).key;

    const after = describePlan(
      run(plan2, {
        type: "matchManually",
        releaseKey: amnesiacKey,
        recordId: "unrelated",
      }),
    );

    expect(after.newEntries).toEqual([]);
    expect(after.counts.imports).toBe(0);
    expect(after.toImport).toEqual([]);
    expect(after.allNewChecked).toBe(false);
    expect(after.matches.map((m) => m.existingId).sort()).toEqual([
      "target",
      "unrelated",
    ]);
    expect(after.counts.updates).toBe(2);
  });

  it("resolves an ambiguous release and drops it from the ambiguous bucket", () => {
    const incoming = discogsRecord({ discogsId: 111 });
    const a = localRecord({ id: "a" });
    const b = localRecord({ id: "b" });
    const plan = beginSync([incoming], [a, b]);
    const key = plan.pending[0].key;

    const after = describePlan(
      run(plan, { type: "matchManually", releaseKey: key, recordId: "b" }),
    );

    expect(after.ambiguousEntries).toEqual([]);
    expect(after.matches).toHaveLength(1);
    expect(after.matches[0].existing).toBe(b);
    expect(after.updates).toEqual([
      {
        existingId: "b",
        fields: {
          discogsId: 111,
          coverUrl: incoming.coverUrl,
          genre: incoming.genre,
          subGenres: incoming.subGenres,
          year: incoming.year,
        },
      },
    ]);
  });

  it("ignores a manual match against an unknown release or record", () => {
    const plan = beginSync([discogsRecord()], [localRecord()]);

    expect(
      reducer(plan, {
        type: "matchManually",
        releaseKey: "nope",
        recordId: "local-1",
      }),
    ).toBe(plan);
    expect(
      reducer(plan, {
        type: "matchManually",
        releaseKey: plan.pending[0]?.key ?? "r0",
        recordId: "nope",
      }),
    ).toBe(plan);
  });
});

describe("reassignment guard", () => {
  function claimedSetup() {
    const incoming = discogsRecord({ title: "Geogaddi", discogsId: 111 });
    const claimed = localRecord({
      id: "claimed",
      title: "Geogaddi",
      discogsId: 999,
    });
    const plan = beginSync([incoming], [claimed]);
    return { plan, key: plan.pending[0].key };
  }

  it("does not apply a match to a record claimed by a different release until confirmed", () => {
    const { plan, key } = claimedSetup();
    const pending = reducer(plan, {
      type: "matchManually",
      releaseKey: key,
      recordId: "claimed",
    });
    const view = describePlan(pending);

    expect(view.pendingReassign.releaseKey).toBe(key);
    expect(view.pendingReassign.existingRecord.id).toBe("claimed");
    expect(view.matches).toEqual([]);
    expect(view.newEntries).toHaveLength(1);
  });

  it("applies the match on confirmReassignment", () => {
    const { plan, key } = claimedSetup();
    const view = describePlan(
      run(
        plan,
        { type: "matchManually", releaseKey: key, recordId: "claimed" },
        { type: "confirmReassignment" },
      ),
    );

    expect(view.pendingReassign).toBe(null);
    expect(view.newEntries).toEqual([]);
    expect(view.updates[0].existingId).toBe("claimed");
    expect(view.updates[0].fields.discogsId).toBe(111);
  });

  it("leaves the plan untouched on cancelReassignment", () => {
    const { plan, key } = claimedSetup();
    const view = describePlan(
      run(
        plan,
        { type: "matchManually", releaseKey: key, recordId: "claimed" },
        { type: "cancelReassignment" },
      ),
    );

    expect(view.pendingReassign).toBe(null);
    expect(view.matches).toEqual([]);
    expect(view.newEntries).toHaveLength(1);
  });

  it("treats confirmReassignment with nothing pending as a no-op", () => {
    const { plan } = claimedSetup();
    expect(reducer(plan, { type: "confirmReassignment" })).toBe(plan);
    expect(reducer(plan, { type: "cancelReassignment" })).toBe(plan);
  });

  it("does not require confirmation for an unclaimed record", () => {
    const incoming = discogsRecord({ title: "Geogaddi", discogsId: 111 });
    const unclaimed = localRecord({ id: "unclaimed", title: "Something Else" });
    const plan = beginSync([incoming], [unclaimed]);
    const view = describePlan(
      run(plan, {
        type: "matchManually",
        releaseKey: plan.pending[0].key,
        recordId: "unclaimed",
      }),
    );

    expect(view.pendingReassign).toBe(null);
    expect(view.matches).toHaveLength(1);
  });
});

describe("field toggles", () => {
  it("proposes only fields the existing record is missing (fill-blanks-only)", () => {
    const incoming = discogsRecord({
      discogsId: 111,
      coverUrl: "https://example.com/new-cover.jpg",
      genre: "Electronic",
      subGenres: ["IDM"],
      year: 1997,
    });
    const existing = localRecord({
      id: "existing-1",
      genre: "Rock",
      year: 1995,
      coverUrl: "",
      subGenres: [],
    });
    const view = describePlan(beginSync([incoming], [existing]));

    expect(Object.keys(view.matches[0].fields).sort()).toEqual([
      "coverUrl",
      "subGenres",
    ]);
    expect(view.updates[0].fields).toEqual({
      discogsId: 111,
      coverUrl: incoming.coverUrl,
      subGenres: ["IDM"],
    });
  });

  it("drops a field from the update when its toggle is turned off, keeping discogsId", () => {
    const incoming = discogsRecord({ discogsId: 111 });
    const plan = beginSync([incoming], [localRecord({ id: "existing-1" })]);
    const view = describePlan(
      run(plan, {
        type: "setFieldEnabled",
        recordId: "existing-1",
        field: "genre",
        on: false,
      }),
    );

    expect(view.updates[0].fields.genre).toBeUndefined();
    expect(view.updates[0].fields.discogsId).toBe(111);
    // The toggle is still shown, just off.
    expect(view.matches[0].fields.genre).toBe(false);
  });

  it("removes a disabled match from the updates", () => {
    const plan = beginSync([discogsRecord()], [localRecord({ id: "e1" })]);
    const view = describePlan(
      run(plan, { type: "setMatchEnabled", recordId: "e1", on: false }),
    );

    expect(view.updates).toEqual([]);
    expect(view.counts.updates).toBe(0);
    expect(view.allMatchesEnabled).toBe(false);
  });
});

describe("deletions", () => {
  it("never offers an ambiguous candidate for deletion (regression: bug 2)", () => {
    const incoming = discogsRecord({ discogsId: 111 });
    const a = localRecord({ id: "a" });
    const b = localRecord({ id: "b" });
    const plan = run(
      beginSync([incoming], [a, b]),
      { type: "setDeletionsEnabled", on: true },
      { type: "toggleAllImports", bucket: "deletions", on: true },
    );
    const view = describePlan(plan);

    expect(view.unmatched).toEqual([]);
    expect(view.deletions).toEqual([]);
  });

  it("offers a record whose linked release is gone from Discogs", () => {
    const stale = localRecord({ id: "stale", title: "Gone", discogsId: 999 });
    const present = localRecord({
      id: "present",
      title: "Still Here",
      discogsId: 111,
    });
    const incoming = discogsRecord({ title: "Still Here", discogsId: 111 });
    const view = describePlan(
      run(
        beginSync([incoming], [stale, present]),
        { type: "setDeletionsEnabled", on: true },
        { type: "toggleDeletion", recordId: "stale" },
      ),
    );

    expect(view.unmatched.map((r) => r.id)).toEqual(["stale"]);
    expect(view.deletions).toEqual(["stale"]);
    expect(view.allDeletionsChecked).toBe(true);
  });

  it("selects nothing when deletions are first enabled, and clears on disable", () => {
    const orphan = localRecord({ id: "orphan", title: "Gone" });
    const plan = beginSync([discogsRecord()], [orphan]);

    const enabled = run(plan, { type: "setDeletionsEnabled", on: true });
    expect(describePlan(enabled).deletions).toEqual([]);

    const disabled = run(
      enabled,
      { type: "toggleDeletion", recordId: "orphan" },
      { type: "setDeletionsEnabled", on: false },
    );
    expect(describePlan(disabled).deletions).toEqual([]);
  });

  it("stops deleting a record once it is manually matched", () => {
    const orphan = localRecord({ id: "orphan", title: "Gone" });
    const incoming = discogsRecord({ title: "Something New", discogsId: 111 });
    const plan = run(
      beginSync([incoming], [orphan]),
      { type: "setDeletionsEnabled", on: true },
      { type: "toggleDeletion", recordId: "orphan" },
    );
    expect(describePlan(plan).deletions).toEqual(["orphan"]);

    const matched = run(plan, {
      type: "matchManually",
      releaseKey: plan.pending[0].key,
      recordId: "orphan",
    });
    expect(describePlan(matched).deletions).toEqual([]);
  });
});

describe("describePlan output contract", () => {
  it("produces the (toImport, updates, deletions) triple handleDiscogsImport consumes", () => {
    const incomingNew = discogsRecord({ title: "Geogaddi", discogsId: 111 });
    const incomingMatched = discogsRecord({ discogsId: 222 });
    const existing = localRecord({ id: "existing-1" });
    const orphan = localRecord({ id: "orphan", title: "Gone" });

    const view = describePlan(
      run(
        beginSync([incomingNew, incomingMatched], [existing, orphan]),
        { type: "setDeletionsEnabled", on: true },
        { type: "toggleDeletion", recordId: "orphan" },
      ),
    );

    // toImport: records without ids, ready for generateId()
    expect(view.toImport).toEqual([incomingNew]);
    expect(view.toImport.every((r) => !("id" in r))).toBe(true);

    // updates: [{ existingId, fields }] with discogsId always present
    expect(view.updates).toEqual([
      {
        existingId: "existing-1",
        fields: {
          discogsId: 222,
          coverUrl: incomingMatched.coverUrl,
          genre: incomingMatched.genre,
          subGenres: incomingMatched.subGenres,
          year: incomingMatched.year,
        },
      },
    ]);

    // deletions: a plain id array
    expect(view.deletions).toEqual(["orphan"]);
    expect(view.counts).toEqual({ imports: 1, updates: 1, deletions: 1 });
    expect(view.summary).toBe(
      "Import 1 new record, update 1 existing record, delete 1 record",
    );
  });

  it("reports no changes when nothing is selected", () => {
    const view = describePlan(
      run(beginSync([discogsRecord({ title: "Geogaddi" })], []), {
        type: "toggleAllImports",
        bucket: "new",
        on: false,
      }),
    );

    expect(view.summary).toBe("No changes selected");
    expect(view.counts).toEqual({ imports: 0, updates: 0, deletions: 0 });
  });

  it("pluralises the summary", () => {
    const view = describePlan(
      beginSync(
        [
          discogsRecord({ title: "Geogaddi", discogsId: 1 }),
          discogsRecord({ title: "Campfire Headphase", discogsId: 2 }),
        ],
        [],
      ),
    );

    expect(view.summary).toBe("Import 2 new records");
  });

  it("excludes already-matched records from the manual-match picker list", () => {
    const matched = localRecord({ id: "existing-1" });
    const other = localRecord({ id: "other", title: "Something Else" });
    const view = describePlan(
      beginSync([discogsRecord({ discogsId: 111 })], [matched, other]),
    );

    expect(view.pickableExisting).toEqual([other]);
  });

  it("reports an empty review when there is nothing to do", () => {
    const view = describePlan(beginSync([], []));
    expect(view.isEmpty).toBe(true);
    expect(view.summary).toBe("No changes selected");
  });
});
