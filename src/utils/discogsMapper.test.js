import { describe, it, expect } from "vitest";
import { findMatches } from "./discogsMapper";

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

describe("findMatches", () => {
  it("routes an incoming release to newRecords when the only existing same-title record is claimed by a different discogsId", () => {
    const existing = localRecord({ id: "existing-1", discogsId: 999 });
    const incoming = discogsRecord({ discogsId: 111 });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existing],
    );

    expect(newRecords).toEqual([incoming]);
    expect(matchedRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([]);
  });

  it("auto-matches an incoming release to a single unclaimed existing record sharing artist+title (regression)", () => {
    const existing = localRecord({ id: "existing-1", discogsId: null });
    const incoming = discogsRecord({ discogsId: 111 });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existing],
    );

    expect(newRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([]);
    expect(matchedRecords).toHaveLength(1);
    expect(matchedRecords[0].existing).toBe(existing);
    expect(matchedRecords[0].discogs).toBe(incoming);
    expect(matchedRecords[0].fieldsToUpdate).toEqual({
      discogsId: 111,
      coverUrl: incoming.coverUrl,
      genre: incoming.genre,
      subGenres: incoming.subGenres,
      year: incoming.year,
    });
  });

  it("classifies an incoming release as ambiguous when two unclaimed existing records share artist+title, matching neither", () => {
    const existingA = localRecord({ id: "existing-a", discogsId: null });
    const existingB = localRecord({ id: "existing-b", discogsId: null });
    const incoming = discogsRecord({ discogsId: 111 });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existingA, existingB],
    );

    expect(newRecords).toEqual([]);
    expect(matchedRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([incoming]);
  });

  it("does not let a claimed record whose own linked release has disappeared act as a fallback candidate for a different incoming release", () => {
    // existing-1 is claimed to a release (discogsId 999) that is no longer in
    // the fetched Discogs collection. A different incoming release (111)
    // shares the same artist+title but must not reclaim existing-1.
    const existing = localRecord({ id: "existing-1", discogsId: 999 });
    const incoming = discogsRecord({ discogsId: 111 });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existing],
    );

    expect(matchedRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([]);
    expect(newRecords).toEqual([incoming]);
  });

  it("skips an incoming release entirely when it is already linked via a matching discogsId", () => {
    const existing = localRecord({ id: "existing-1", discogsId: 111 });
    const incoming = discogsRecord({ discogsId: 111 });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existing],
    );

    expect(newRecords).toEqual([]);
    expect(matchedRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([]);
  });

  it("treats an incoming release with no artist+title overlap as new", () => {
    const existing = localRecord({ id: "existing-1", discogsId: null });
    const incoming = discogsRecord({
      artist: "Boards of Canada",
      title: "Music Has the Right to Children",
      discogsId: 222,
    });

    const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
      [incoming],
      [existing],
    );

    expect(newRecords).toEqual([incoming]);
    expect(matchedRecords).toEqual([]);
    expect(ambiguousRecords).toEqual([]);
  });
});
