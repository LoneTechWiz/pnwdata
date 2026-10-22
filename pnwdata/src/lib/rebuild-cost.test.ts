import { describe, expect, it } from "vitest";
import {
  REBUILD_DEFAULTS, baseInfraCost, estimateRebuild, infraDiscount, tierFor, validateRebuildConfig,
} from "./rebuild-cost";

describe("rebuild cost", () => {
  it("matches prices from the game's infra calculator (politicsandwar.com/tools/infra)", () => {
    expect(baseInfraCost(0, 10)).toBeCloseTo(3002.2, 1);
    expect(baseInfraCost(0, 100)).toBeCloseTo(30022, 1);
    expect(baseInfraCost(5, 25)).toBeCloseTo(6001, 1);
    expect(baseInfraCost(500, 1000)).toBeCloseTo(1_457_963, -1);
    expect(baseInfraCost(1000, 2000)).toBeCloseTo(13_462_782, -1);
    // Not a multiple of 100 apart: the leftover block is bought first.
    expect(baseInfraCost(55, 333)).toBeCloseTo(110_109.58, -1);
    expect(baseInfraCost(1234, 1777)).toBeCloseTo(7_133_066.29, -1);
  });

  it("is 0 when the target isn't above the start", () => {
    expect(baseInfraCost(500, 500)).toBe(0);
    expect(baseInfraCost(800, 500)).toBe(0);
  });

  it("stacks project and policy discounts, boosting the policy only", () => {
    expect(infraDiscount({})).toBe(0);
    expect(infraDiscount({ center_for_civil_engineering: true, advanced_engineering_corps: true })).toBeCloseTo(0.1, 10);
    expect(infraDiscount({ domestic_policy: "URBANIZATION", government_support_agency: true, bureau_of_domestic_affairs: true }))
      .toBeCloseTo(0.0875, 10);
    expect(infraDiscount({ domestic_policy: "MANIFEST_DESTINY", government_support_agency: true })).toBe(0);
  });

  it("picks the tier by city count and multiplies per-city cost by cities", () => {
    expect(tierFor(REBUILD_DEFAULTS, 19).min_cities).toBe(0);
    expect(tierFor(REBUILD_DEFAULTS, 20).min_cities).toBe(20);
    expect(tierFor(REBUILD_DEFAULTS, 39).min_cities).toBe(30);
    expect(tierFor(REBUILD_DEFAULTS, 55).min_cities).toBe(40);
    const config = validateRebuildConfig({
      tiers: [{ start_infra: 0, target_infra: 10 }, { start_infra: 0, target_infra: 20 }, { start_infra: 0, target_infra: 10 }, { start_infra: 0, target_infra: 10 }],
    });
    if (!("config" in config)) throw new Error(config.error);
    const estimate = estimateRebuild(config.config, { num_cities: 5, center_for_civil_engineering: true });
    expect(estimate.perCity).toBeCloseTo(3002.2 * 0.95, 6);
    expect(estimate.total).toBeCloseTo(3002.2 * 0.95 * 5, 6);
  });

  it("rejects bad config", () => {
    expect(validateRebuildConfig(null)).toHaveProperty("error");
    expect(validateRebuildConfig({ tiers: [] })).toHaveProperty("error");
    const bad = { tiers: REBUILD_DEFAULTS.tiers.map((t, i) => (i === 1 ? { ...t, start_infra: 2000 } : t)) };
    expect(validateRebuildConfig(bad)).toEqual({ error: "20-29 cities: target infra can't be below the starting infra" });
  });
});
