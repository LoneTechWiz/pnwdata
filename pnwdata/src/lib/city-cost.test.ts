import { describe, expect, it } from "vitest";
import { baseCityCost, cityPurchaseCost, costToReach, parseNationIds, type CityCostModifiers } from "./city-cost";

const none: CityCostModifiers = {
  urbanPlanning: false, advancedUrbanPlanning: false, metropolitanPlanning: false,
  manifestDestiny: false, governmentSupportAgency: false,
};

describe("city cost", () => {
  it("matches the wiki's base costs for the first new cities", () => {
    expect(baseCityCost(1)).toBe(225_000);
    expect(baseCityCost(2)).toBe(425_000);
  });

  it("applies Manifest Destiny as 5%, or 7.5% with the Government Support Agency", () => {
    expect(cityPurchaseCost(1, { ...none, manifestDestiny: true })).toBe(213_750);
    expect(cityPurchaseCost(2, { ...none, manifestDestiny: true })).toBe(403_750);
    expect(cityPurchaseCost(2, { ...none, manifestDestiny: true, governmentSupportAgency: true })).toBe(393_125);
  });

  it("ignores the Government Support Agency without Manifest Destiny", () => {
    expect(cityPurchaseCost(2, { ...none, governmentSupportAgency: true })).toBe(425_000);
  });

  it("stacks the project discounts and applies Manifest Destiny after them", () => {
    const all = { ...none, urbanPlanning: true, advancedUrbanPlanning: true, metropolitanPlanning: true };
    const base = baseCityCost(30); // 1,215,075,000 + ... well above the $300M total discount
    expect(cityPurchaseCost(30, all)).toBe(base - 300_000_000);
    expect(cityPurchaseCost(30, { ...all, manifestDestiny: true })).toBe(Math.round((base - 300_000_000) * 0.95));
  });

  it("never goes below $1", () => {
    expect(cityPurchaseCost(2, { ...none, urbanPlanning: true })).toBe(1);
  });

  it("sums every city up to the target and is empty when already there", () => {
    const result = costToReach(1, 3, none);
    expect(result.rows).toEqual([{ city: 2, cost: 225_000 }, { city: 3, cost: 425_000 }]);
    expect(result.total).toBe(650_000);
    expect(costToReach(5, 5, none)).toEqual({ rows: [], total: 0 });
    expect(costToReach(8, 5, none)).toEqual({ rows: [], total: 0 });
  });
});

describe("parseNationIds", () => {
  it("accepts commas, spaces, new lines and links, without repeats", () => {
    expect(parseNationIds("12, 34\n56 12 https://politicsandwar.com/nation/id=78")).toEqual([12, 34, 56, 78]);
  });

  it("ignores zero and empty input", () => {
    expect(parseNationIds("0, abc")).toEqual([]);
    expect(parseNationIds("")).toEqual([]);
  });
});
