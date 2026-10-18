import { describe, expect, it } from "vitest";
import { baseCityCost, costToReach, parseNationIds, policyDiscount, type CityCostModifiers } from "./city-cost";

const none: CityCostModifiers = {
  manifestDestiny: false, governmentSupportAgency: false, bureauOfDomesticAffairs: false, citiesDiscount: 0,
};
const AVERAGE = 43.6452;

describe("city cost", () => {
  it("matches a real in-game price: city 47 with Manifest Destiny, GSA and the Bureau", () => {
    const mods = { ...none, manifestDestiny: true, governmentSupportAgency: true, bureauOfDomesticAffairs: true };
    expect(policyDiscount(mods)).toBeCloseTo(0.0875, 10);
    expect(costToReach(46, 47, AVERAGE, mods).total).toBe(4_293_914_664.08);
  });

  it("scales Manifest Destiny with the projects that boost it, and only when the policy is active", () => {
    expect(policyDiscount({ ...none, manifestDestiny: true })).toBeCloseTo(0.05, 10);
    expect(policyDiscount({ ...none, manifestDestiny: true, governmentSupportAgency: true })).toBeCloseTo(0.075, 10);
    expect(policyDiscount({ ...none, governmentSupportAgency: true, bureauOfDomesticAffairs: true })).toBe(0);
  });

  it("falls back to the city-squared floor for far-below-average costs", () => {
    expect(baseCityCost(10, 100)).toBe(10 ** 2 * 100_000);
  });

  it("spends a leftover refund discount across cities and never goes below $1", () => {
    const first = costToReach(46, 47, AVERAGE, none).total;
    const result = costToReach(46, 48, AVERAGE, { ...none, citiesDiscount: first + 1000 });
    expect(result.rows[0].cost).toBe(1);
    expect(result.rows[1].cost).toBeCloseTo(baseCityCost(48, AVERAGE) - 1001, 1);
  });

  it("lists every city up to the target and is empty when already there", () => {
    expect(costToReach(44, 47, AVERAGE, none).rows.map((r) => r.city)).toEqual([45, 46, 47]);
    expect(costToReach(5, 5, AVERAGE, none)).toEqual({ rows: [], total: 0 });
    expect(costToReach(8, 5, AVERAGE, none)).toEqual({ rows: [], total: 0 });
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
