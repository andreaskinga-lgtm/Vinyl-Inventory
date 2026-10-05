import { describe, expect, it } from "vitest";
import { isAdministratorSessionError } from "./apiErrors.js";

describe("administrator API error classification", () => {
  it("recognizes the server's administrator-session 401", () => {
    expect(
      isAdministratorSessionError(401, {
        error: "Administrator authentication required",
      }),
    ).toBe(true);
  });

  it("does not treat Discogs credential failures as expired sessions", () => {
    expect(
      isAdministratorSessionError(401, {
        error: "Discogs credentials are required",
      }),
    ).toBe(false);
    expect(
      isAdministratorSessionError(502, {
        error: "Discogs credentials were rejected by the upstream service",
      }),
    ).toBe(false);
  });
});
