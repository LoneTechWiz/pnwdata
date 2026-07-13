import { describe, expect, it } from "vitest";
import { computeOptimalBuild, type OptimizerProjects } from "./page";

const nation526341Projects: OptimizerProjects = {
  massIrrigation: true,
  uraniumEnrichment: true,
  ironWorks: true,
  bauxiteWorks: true,
  armsStockpile: true,
  emergencyGasolineReserve: true,
  greenTechnologies: true,
  clinicalResearchCenter: true,
  specializedPoliceTraining: true,
  recyclingInitiative: true,
  falloutShelter: true,
  internationalTradeCenter: true,
  telecommunicationsSatellite: true,
  governmentSupportAgency: true,
  bureauOfDomesticAffairs: true,
};

const livePrices = {
  coal: 5067,
  oil: 4752,
  uranium: 2513,
  iron: 4668,
  bauxite: 4439,
  lead: 5077,
  gasoline: 3943,
  munitions: 2295,
  steel: 4772,
  aluminum: 3462,
  food: 96,
};

describe("city optimizer", () => {
  it("reproduces the profitable production mix for nation 526341", () => {
    const result = computeOptimalBuild(
      3000,
      7326.6087,
      livePrices,
      125,
      nation526341Projects,
      26.904,
      "2126-01-10T00:00:00Z",
      1.45205,
      "OPEN_MARKETS",
      { barracks: 0, factories: 3, hangars: 5, dockyards: 0 },
      { hospitals: 1, subway: 1, police_stations: 1, recycling_centers: 3 },
    );

    const counts = Object.fromEntries(result.build.map((entry) => [entry.name, entry.count]));
    expect(counts).toMatchObject({
      Stadium: 3,
      "Shopping Mall": 5,
      Bank: 6,
      Farm: 20,
      "Munitions Factory": 5,
      "Aluminum Refinery": 5,
    });
    expect(result.commercePct).toBe(125);
    expect(result.totalPollution).toBe(25);
    expect(result.population).toBeCloseTo(19_904_503 / 46, -2);
    // Revenue screen net income: total daily profit divided across all 46 cities.
    const observedNetProfitPerCity = 70_802_200.48 / 46;
    expect(observedNetProfitPerCity).toBeCloseTo(1_539_178.27, 2);

    // The optimizer excludes unit upkeep and color bonus, so normalize the
    // observed total before comparing the build-only estimate.
    const observedBuildProfit = observedNetProfitPerCity + 3_176_700 / 46 - 2_387_760 / 46;
    expect(Math.abs(result.netProfit - observedBuildProfit) / observedBuildProfit).toBeLessThan(0.01);
    expect(result.netProfit).toBeLessThan(2_000_000);
    expect(result.unfilledSlots).toBe(0);
  });
});
