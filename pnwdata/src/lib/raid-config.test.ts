import { describe, expect, it } from "vitest";
import { validateRaidFinderConfig } from "./raid-config";

describe("raid finder config", () => {
  it("accepts whole days within the supported range", () => {
    expect(validateRaidFinderConfig({ min_inactive_days: 7 })).toEqual({ min_inactive_days: 7 });
  });

  it("rejects fractional and out-of-range values", () => {
    expect(validateRaidFinderConfig({ min_inactive_days: 0 })).toBeNull();
    expect(validateRaidFinderConfig({ min_inactive_days: 1.5 })).toBeNull();
    expect(validateRaidFinderConfig({ min_inactive_days: 366 })).toBeNull();
  });
});
