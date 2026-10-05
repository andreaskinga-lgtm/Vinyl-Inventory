import { describe, expect, it } from "vitest";
import { appendSubGenreSelection } from "./subGenrePicker.js";

describe("sub-genre picker selection planning", () => {
  it("appends a created item to the latest selection without dropping intervening choices", () => {
    const latestSelection = ["Dream Pop", "Shoegaze"];

    expect(
      appendSubGenreSelection(latestSelection, "Post-Rock"),
    ).toEqual(["Dream Pop", "Shoegaze", "Post-Rock"]);
  });

  it("does not duplicate a created item already selected while creation was pending", () => {
    expect(
      appendSubGenreSelection(["Dream Pop", "Post-Rock"], "Post-Rock"),
    ).toEqual(["Dream Pop", "Post-Rock"]);
  });
});
