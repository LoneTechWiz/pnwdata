import { describe, expect, it } from "vitest";
import { computeGroupTiering, parseAllianceIds, tierLabel, type TieringNation } from "./tiering";

describe("tierLabel", () => {
  it("groups cities into a bracket of the given size", () => {
    expect(tierLabel(1, 5)).toBe("1-5");
    expect(tierLabel(5, 5)).toBe("1-5");
    expect(tierLabel(6, 5)).toBe("6-10");
    expect(tierLabel(27, 5)).toBe("26-30");
  });

  it("returns the bare number when bucket size is 1", () => {
    expect(tierLabel(5, 1)).toBe("5");
  });
});

describe("parseAllianceIds", () => {
  it("parses comma-separated ids, trimming whitespace", () => {
    expect(parseAllianceIds("123, 456 ,789")).toEqual([123, 456, 789]);
  });

  it("dedupes and drops invalid entries", () => {
    expect(parseAllianceIds("123,123,abc,0,-5,456")).toEqual([123, 456]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseAllianceIds("  ")).toEqual([]);
  });
});

describe("computeGroupTiering", () => {
  const nation = (id: number, alliance_id: number, num_cities: number): TieringNation => ({
    id,
    alliance_id,
    num_cities,
  });

  it("counts nations into group A and group B per tier bracket", () => {
    const nations = [
      nation(1, 100, 3),
      nation(2, 100, 4),
      nation(3, 200, 8),
    ];
    const rows = computeGroupTiering(nations, [100], [200], 5);
    expect(rows).toEqual([
      { tier: "1-5", min: 1, groupA: 2, groupB: 0, total: 2 },
      { tier: "6-10", min: 6, groupA: 0, groupB: 1, total: 1 },
    ]);
  });

  it("fills gap tiers with zero counts", () => {
    const nations = [nation(1, 100, 1), nation(2, 100, 20)];
    const rows = computeGroupTiering(nations, [100], [999], 10);
    expect(rows.map(r => r.tier)).toEqual(["1-10", "11-20"]);
    expect(rows[0].groupA).toBe(1);
    expect(rows[1].groupA).toBe(1);
  });

  it("excludes nations whose alliance is in neither group", () => {
    const nations = [nation(1, 100, 3), nation(2, 300, 3)];
    const rows = computeGroupTiering(nations, [100], [200], 5);
    expect(rows).toEqual([{ tier: "1-5", min: 1, groupA: 1, groupB: 0, total: 1 }]);
  });

  it("supports an alliance appearing in both groups by counting it in both", () => {
    const nations = [nation(1, 100, 3)];
    const rows = computeGroupTiering(nations, [100], [100], 5);
    expect(rows).toEqual([{ tier: "1-5", min: 1, groupA: 1, groupB: 1, total: 1 }]);
  });

  it("returns an empty array when no nations belong to either group", () => {
    expect(computeGroupTiering([], [100], [200], 5)).toEqual([]);
  });
});
