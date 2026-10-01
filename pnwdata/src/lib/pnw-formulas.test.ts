import { describe, expect, it } from "vitest";
import {
  averageCityAgeMultiplier,
  baseDisease,
  cityPopulation,
  commerceIncome,
  crimeRate,
  dailyFoodProduction,
  dailyNuclearUraniumUsage,
  openMarketsMultiplier,
  radiationFoodMultiplier,
  seasonalFoodMultiplier,
  slotsFromInfra,
  specializationMultiplier,
} from "./pnw-formulas";

describe("city health and population formulas", () => {
  it("matches nation 526341's disease and crime inputs", () => {
    const infrastructure = 3000;
    const land = 7326.6087;
    const disease = baseDisease(infrastructure, land, 25) - 3.5;
    const crime = crimeRate(infrastructure, 125, 1, true);

    expect(disease).toBeCloseTo(0.66766, 4);
    expect(crime).toBeCloseTo(-0.79564, 4);
  });

  it("applies disease, crime, and city age to population", () => {
    const result = cityPopulation({
      infrastructure: 3000,
      land: 7326.6087,
      pollution: 25,
      hospitals: 1,
      policeStations: 1,
      commerce: 125,
      clinicalResearchCenter: true,
      specializedPoliceTraining: true,
      ageMultiplier: 1.45205,
    });

    expect(result.population).toBeCloseTo(19_904_503 / 46, -1);
  });
});

describe("income formulas", () => {
  it("treats city income as daily rather than multiplying by 12", () => {
    const income = commerceIncome(19_904_503 / 46, 125, 1.0175);
    expect(income).toBeCloseTo(1_117_208, -1);
  });

  it("applies Open Markets project boosts", () => {
    expect(openMarketsMultiplier(false, false)).toBe(1.01);
    expect(openMarketsMultiplier(true, false)).toBe(1.015);
    expect(openMarketsMultiplier(true, true)).toBe(1.0175);
  });
});

describe("production formulas", () => {
  it("applies specialization at the improvement cap", () => {
    expect(specializationMultiplier(5, 5)).toBe(1.5);
    expect(specializationMultiplier(20, 20)).toBe(1.5);
  });

  it("applies winter and radiation to farm output", () => {
    const food = dailyFoodProduction(20, 7326.6087, true, 0.8, 1 - 269.04 / 1000);
    expect(food).toBeCloseTo(3_856.3, 0);
  });

  it("derives season and radiation multipliers", () => {
    expect(seasonalFoodMultiplier("2126-01-10T00:00:00Z")).toBe(0.8);
    expect(seasonalFoodMultiplier("2126-07-10T00:00:00Z")).toBe(1.2);
    expect(radiationFoodMultiplier(269.04)).toBeCloseTo(0.73096, 5);
  });

  it("scales nuclear fuel with infrastructure", () => {
    expect(dailyNuclearUraniumUsage(3000)).toBe(9);
  });
});

describe("city metadata helpers", () => {
  it("averages city age bonuses", () => {
    const average = averageCityAgeMultiplier(
      ["2023-02-25", "2025-12-21"],
      new Date("2026-07-11T00:00:00Z"),
    );
    expect(average).toBeGreaterThan(1.3);
    expect(average).toBeLessThan(1.5);
  });

  it("floors infrastructure into slots", () => {
    expect(slotsFromInfra(49)).toBe(0);
    expect(slotsFromInfra(50)).toBe(1);
    expect(slotsFromInfra(3000)).toBe(60);
  });
});
