import { describe, expect, it } from "vitest";
import {
  computeNexusOptimalBuild,
  recoverNexusTargetProfile,
  type NexusOptimizerInput,
  type NexusOptimizerProjects,
} from "@/lib/nexus-city-optimizer";

const projects: NexusOptimizerProjects = {
  massIrrigation: false,
  uraniumEnrichment: false,
  ironWorks: false,
  bauxiteWorks: false,
  armsStockpile: false,
  emergencyGasolineReserve: false,
  greenTechnologies: false,
  clinicalResearchCenter: false,
  specializedPoliceTraining: false,
  recyclingInitiative: false,
  falloutShelter: false,
  internationalTradeCenter: false,
  telecommunicationsSatellite: false,
  governmentSupportAgency: false,
  bureauOfDomesticAffairs: false,
};

const prices = {
  coal: 3_500, oil: 4_000, uranium: 2_500, iron: 4_500, bauxite: 4_000,
  lead: 4_000, gasoline: 4_000, munitions: 2_500, steel: 5_000,
  aluminum: 3_500, food: 150,
};

function optimize(overrides: Partial<NexusOptimizerInput> = {}) {
  return computeNexusOptimalBuild({
    infrastructure: 1_000,
    land: 1_000,
    prices,
    projects,
    radiationPenalty: 0,
    gameDate: "2126-09-21T00:00:00Z",
    ageMultiplier: 1.25,
    domesticPolicy: "MANIFEST_DESTINY",
    continent: "NA",
    cityCount: 20,
    minimumMilitary: { barracks: 0, factories: 0, hangars: 0, dockyards: 0 },
    ...overrides,
  });
}

describe("Nexus city optimizer", () => {
  it("chooses power by total operating value instead of forcing nuclear", () => {
    const result = optimize({ infrastructure: 100 });

    expect(result).not.toBeNull();
    expect(result!.powerBuild).toEqual({ coal: 0, oil: 0, nuclear: 0, wind: 1 });
  });

  it("respects continent restrictions on raw resources", () => {
    const market = { ...prices, coal: 100_000 };
    const northAmerica = optimize({ prices: market, continent: "NA" });
    const southAmerica = optimize({ prices: market, continent: "SA" });

    expect(northAmerica!.counts.coal_mine).toBeGreaterThan(0);
    expect(southAmerica!.counts.coal_mine ?? 0).toBe(0);
  });

  it("selects hospitals and police as part of the profit search", () => {
    const result = optimize({ infrastructure: 3_000, land: 500 });

    expect(result).not.toBeNull();
    expect(result!.hospitals).toBeGreaterThan(0);
    expect(result!.civilSlots).toBeGreaterThanOrEqual(result!.hospitals + result!.policeStations);
  });

  it("preserves the requested minimum military build", () => {
    const result = optimize({
      infrastructure: 2_000,
      minimumMilitary: { barracks: 2, factories: 3, hangars: 4, dockyards: 1 },
    });

    expect(result!.counts).toMatchObject({ barracks: 2, factory: 3, hangar: 4, drydock: 1 });
    expect(result!.milSlots).toBe(10);
    expect(result!.usedSlots).toBeLessThanOrEqual(result!.totalSlots);
  });

  it("is deterministic for identical inputs", () => {
    const first = optimize({ infrastructure: 2_000 });
    const second = optimize({ infrastructure: 2_000 });

    expect(first!.counts).toEqual(second!.counts);
    expect(first!.netProfit).toBeCloseTo(second!.netProfit, 6);
  });
});

describe("Nexus target recovery", () => {
  it("uses the highest recovered city, floors slots, and selects median land", () => {
    const target = recoverNexusTargetProfile([
      { infrastructure: 1_000, coal_mine: 10, farm: 20, land: 900 },
      { infrastructure: 1_250, land: 1_100 },
    ]);

    expect(target).toEqual({
      targetInfrastructure: 1_500,
      availableSlots: 30,
      citiesBelowTarget: 2,
      infrastructureShortfall: 750,
      landUsed: 900,
    });
  });
});
