import { describe, expect, it } from "vitest";
import { exceedsStockpileThreshold, stockpileLimit } from "./stockpile";

describe("stockpileLimit", () => {
  it("uses flat threshold for uranium", () => {
    expect(stockpileLimit(500, "uranium", 10)).toBe(500);
  });

  it("multiplies threshold by cities for other resources", () => {
    expect(stockpileLimit(100, "money", 5)).toBe(500);
  });
});

describe("exceedsStockpileThreshold", () => {
  it("returns true when amount is above limit", () => {
    expect(exceedsStockpileThreshold(501, 100, "money", 5)).toBe(true);
  });

  it("returns false when at or below limit", () => {
    expect(exceedsStockpileThreshold(500, 100, "money", 5)).toBe(false);
    expect(exceedsStockpileThreshold(100, 100, "money", 5)).toBe(false);
  });

  it("returns false for non-positive thresholds", () => {
    expect(exceedsStockpileThreshold(9999, 0, "money", 5)).toBe(false);
  });
});