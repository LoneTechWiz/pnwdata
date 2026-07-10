import { describe, expect, it } from "vitest";
import {
  baseDisease,
  diseaseAfterHospitals,
  hospitalsToZeroDisease,
  slotsFromInfra,
} from "./pnw-formulas";

describe("baseDisease", () => {
  it("returns 0 for low infrastructure", () => {
    expect(baseDisease(100)).toBe(0);
  });

  it("increases with high infrastructure", () => {
    expect(baseDisease(5000)).toBeGreaterThan(0);
  });
});

describe("hospitalsToZeroDisease", () => {
  it("returns 0 when base disease is already 0", () => {
    expect(hospitalsToZeroDisease(100)).toBe(0);
  });

  it("returns positive hospital count for high infra", () => {
    expect(hospitalsToZeroDisease(5000)).toBeGreaterThan(0);
  });
});

describe("diseaseAfterHospitals", () => {
  it("reduces disease with hospitals", () => {
    const infra = 5000;
    expect(diseaseAfterHospitals(infra, hospitalsToZeroDisease(infra))).toBe(0);
  });
});

describe("slotsFromInfra", () => {
  it("floors infra divided by 50", () => {
    expect(slotsFromInfra(0)).toBe(0);
    expect(slotsFromInfra(49)).toBe(0);
    expect(slotsFromInfra(50)).toBe(1);
    expect(slotsFromInfra(1250)).toBe(25);
  });
});