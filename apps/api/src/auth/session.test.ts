import { describe, expect, it } from "vitest";
import { createSessionToken, validateSessionToken } from "./session.js";

describe("session tokens", () => {
  it("validates signed tokens", () => {
    const session = createSessionToken("secret", 60_000);
    expect(validateSessionToken("secret", session.token)).toBe(true);
    expect(validateSessionToken("other-secret", session.token)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const session = createSessionToken("secret", -1);
    expect(validateSessionToken("secret", session.token)).toBe(false);
  });
});
