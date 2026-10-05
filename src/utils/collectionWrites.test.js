import { describe, expect, it } from "vitest";
import {
  addRecord,
  applyDiscogsImport,
  deleteRecord,
  editRecord,
  addGenre,
  addSubGenre,
  deleteSubGenre,
  getCollectionWriteSuccessCleanup,
} from "./collectionWrites.js";

describe("collection write planning", () => {
  const records = [
    { id: "existing", artist: "The Cure", title: "Disintegration" },
  ];

  it("plans an add with the captured id before the request is sent", () => {
    expect(
      addRecord(records, { artist: "Björk", title: "Debut" }, "new-record"),
    ).toEqual([
      { id: "new-record", artist: "Björk", title: "Debut" },
      { id: "existing", artist: "The Cure", title: "Disintegration" },
    ]);
    expect(records).toEqual([
      { id: "existing", artist: "The Cure", title: "Disintegration" },
    ]);
  });

  it("plans edits and deletes without changing the source collection", () => {
    const edited = editRecord(records, "existing", { year: 1989 });
    expect(edited).toEqual([
      {
        id: "existing",
        artist: "The Cure",
        title: "Disintegration",
        year: 1989,
      },
    ]);
    expect(deleteRecord(edited, "existing")).toEqual([]);
    expect(records).toEqual([
      { id: "existing", artist: "The Cure", title: "Disintegration" },
    ]);
  });

  it("plans an import as one complete next collection payload", () => {
    const next = applyDiscogsImport(
      records,
      [
        {
          artist: "Björk",
          title: "Post",
          discogsId: 2,
        },
      ],
      [
        {
          existingId: "existing",
          fields: { discogsId: 1, year: 1989 },
        },
      ],
      [],
      () => "imported-record",
    );

    expect(next).toEqual([
      {
        id: "imported-record",
        artist: "Björk",
        title: "Post",
        discogsId: 2,
      },
      {
        id: "existing",
        artist: "The Cure",
        title: "Disintegration",
        discogsId: 1,
        year: 1989,
      },
    ]);
  });

  it("plans sorted, duplicate-free genre option changes", () => {
    expect(addGenre(["Rock", "Jazz"], "Ambient")).toEqual([
      "Ambient",
      "Jazz",
      "Rock",
    ]);
    expect(addGenre(["Rock"], "Rock")).toEqual(["Rock"]);
    expect(addSubGenre(["Dream Pop"], "Shoegaze")).toEqual([
      "Dream Pop",
      "Shoegaze",
    ]);
    expect(deleteSubGenre(["Dream Pop", "Shoegaze"], "Dream Pop")).toEqual([
      "Shoegaze",
    ]);
  });

  it.each([
    [{ type: "records-save", completion: "add-record" }, "close-add-record"],
    [{ type: "records-save", completion: "edit-record" }, "close-edit-record"],
    [{ type: "records-save", completion: "delete-record" }, "close-edit-record"],
    [
      { type: "records-save", completion: "discogs-import" },
      "close-discogs-import",
    ],
    [
      { type: "genre-options-save", completion: "genre-options" },
      "keep-open",
    ],
  ])("describes the success cleanup for %j", (action, cleanup) => {
    expect(getCollectionWriteSuccessCleanup(action)).toBe(cleanup);
  });
});
