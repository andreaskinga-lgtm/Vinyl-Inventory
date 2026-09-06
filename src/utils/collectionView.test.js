import { describe, expect, it } from "vitest";
import { filterRecords, sortRecords } from "./collectionView.js";

const records = [
  {
    id: 1,
    artist: "The Cure",
    title: "Disintegration",
    year: 1989,
    genre: "Rock",
    subGenres: ["Gothic Rock"],
    location: "Shelf A",
  },
  {
    id: 2,
    artist: "A Tribe Called Quest",
    title: "Midnight Marauders",
    year: 1993,
    genre: "Hip-Hop",
    subGenres: ["Jazz Rap"],
    location: "Shelf B",
  },
  {
    id: 3,
    artist: "Björk",
    title: "Post",
    year: 1995,
    genre: "Electronic",
    subGenres: ["Art Pop"],
    location: "Shelf C",
  },
];

describe("filterRecords", () => {
  it.each([
    ["disintegration", 1],
    ["tribe", 2],
    ["electronic", 3],
    ["jazz rap", 2],
    ["shelf c", 3],
  ])("matches %s across collection metadata", (query, expectedId) => {
    expect(filterRecords(records, query).map((record) => record.id)).toEqual([
      expectedId,
    ]);
  });
});

describe("sortRecords", () => {
  it("ignores leading articles when sorting artists", () => {
    expect(
      sortRecords(records, "artist-asc").map((record) => record.artist),
    ).toEqual(["Björk", "The Cure", "A Tribe Called Quest"]);
  });

  it("sorts years newest first without mutating the source", () => {
    const source = [...records];

    expect(sortRecords(records, "year-desc").map((record) => record.year)).toEqual(
      [1995, 1993, 1989],
    );
    expect(records).toEqual(source);
  });
});
