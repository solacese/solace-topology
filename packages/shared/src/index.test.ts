import { describe, expect, it } from "vitest";
import { matchesAnyPattern, wildcardToRegExp } from "./index.js";

describe("topic and catalog pattern helpers", () => {
  it("matches Solace topic wildcards", () => {
    expect(wildcardToRegExp("vehicle/+/telemetry").test("vehicle/A123/telemetry")).toBe(true);
    expect(wildcardToRegExp("plant/>").test("plant/a/quality/inspection")).toBe(true);
  });

  it("matches shell-style client wildcards", () => {
    expect(matchesAnyPattern("paint-shop-a", ["paint-shop-*"])).toBe(true);
    expect(matchesAnyPattern("finance-invoice-2", ["crm-*"])).toBe(false);
  });
});
