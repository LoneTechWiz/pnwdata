import { describe, expect, it } from "vitest";
import { parseNumberList, STAGNANT_DEFAULTS, validateStagnantConfig } from "./stagnant-config";

describe("validateStagnantConfig", () => {
  it("accepts the built-in defaults", () => {
    expect(validateStagnantConfig(STAGNANT_DEFAULTS)).toEqual({ config: STAGNANT_DEFAULTS });
  });

  it("treats blank or null city limits as no limit", () => {
    const result = validateStagnantConfig({ ...STAGNANT_DEFAULTS, min_cities: "", max_cities: null });
    expect(result).toEqual({ config: { ...STAGNANT_DEFAULTS, min_cities: null, max_cities: null } });
  });

  it("sorts and de-duplicates the lists", () => {
    const result = validateStagnantConfig({ ...STAGNANT_DEFAULTS, tax_ids: [30, 10, 30], excluded_cities: [25, 22, 25] });
    expect(result).toMatchObject({ config: { tax_ids: [10, 30], excluded_cities: [22, 25] } });
  });

  it("rejects min cities above max cities", () => {
    expect(validateStagnantConfig({ ...STAGNANT_DEFAULTS, min_cities: 40, max_cities: 20 })).toHaveProperty("error");
  });

  it.each([
    { min_turns: -1 },
    { min_turns: 1.5 },
    { min_turns: "abc" },
    { min_cities: 1.5 },
    { max_cities: -3 },
    { tax_ids: [0] },
    { tax_ids: "72" },
    { excluded_cities: [-1] },
  ])("rejects invalid input %j", (override) => {
    expect(validateStagnantConfig({ ...STAGNANT_DEFAULTS, ...override })).toHaveProperty("error");
  });

  it("rejects non-objects", () => {
    expect(validateStagnantConfig(null)).toHaveProperty("error");
    expect(validateStagnantConfig("x")).toHaveProperty("error");
  });
});

describe("parseNumberList", () => {
  it("splits on commas and whitespace", () => {
    expect(parseNumberList("72, 27151  28508,30000")).toEqual([72, 27151, 28508, 30000]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseNumberList("  ")).toEqual([]);
  });

  it("returns null when a token is not a whole number", () => {
    expect(parseNumberList("72, abc")).toBeNull();
    expect(parseNumberList("1.5")).toBeNull();
  });
});
