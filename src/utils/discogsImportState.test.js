import { describe, expect, it } from "vitest";
import { canDismissDiscogsImport } from "./discogsImportState.js";

describe("Discogs import modal state", () => {
  it("allows dismissal only when fetching and saving are idle", () => {
    expect(canDismissDiscogsImport()).toBe(true);
    expect(canDismissDiscogsImport({ loading: true })).toBe(false);
    expect(canDismissDiscogsImport({ syncing: true })).toBe(false);
    expect(
      canDismissDiscogsImport({ loading: true, syncing: true }),
    ).toBe(false);
  });
});
