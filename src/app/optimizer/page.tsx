"use client";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMembers, fetchBknetMembers, fetchTradePrices, fetchGameInfo, TradePrice, GameInfo } from "@/lib/pnw";
import {
  averageCityAgeMultiplier,
  baseDisease,
  cityPopulation,
  commerceIncome,
  dailyCivilianFoodUsage,
  dailyFoodProduction,
  dailyNuclearUraniumUsage,
  hospitalsToZeroDisease,
  openMarketsMultiplier,
  radiationFoodMultiplier,
  seasonalFoodMultiplier,
  specializationMultiplier,
} from "@/lib/pnw-formulas";
import { AppShell } from "@/components/AppShell";
import { Search, ChevronDown, ChevronUp, Zap, TrendingUp } from "lucide-react";

// ── Power plant definitions ──────────────────────────────────────────────────

const POWER_TYPES = {
  coal:    { name: "Coal",    infraPerPlant: 500,  dailyCost: 1200,  fuel: "coal"    as const, fuelPerDay: 1.2 },
  oil:     { name: "Oil",     infraPerPlant: 500,  dailyCost: 1800,  fuel: "oil"     as const, fuelPerDay: 1.2 },
  wind:    { name: "Wind",    infraPerPlant: 250,  dailyCost: 500,   fuel: null,               fuelPerDay: 0   },
  // Nuclear fuel scales with infrastructure and is handled by dailyNuclearUraniumUsage().
  nuclear: { name: "Nuclear", infraPerPlant: 2000, dailyCost: 10500, fuel: "uranium" as const, fuelPerDay: 0 },
} as const;
type PowerType = keyof typeof POWER_TYPES;

// ── Commerce improvements ────────────────────────────────────────────────────

interface CommerceImp { name: string; pct: number; dailyCost: number; max: number }
const COMMERCE_IMPS: CommerceImp[] = [
  { name: "Stadium",       pct: 12, dailyCost: 12150, max: 3 },
  { name: "Shopping Mall", pct: 9,  dailyCost: 5400,  max: 5 },
  { name: "Subway",        pct: 8,  dailyCost: 3250,  max: 1 },
  { name: "Bank",          pct: 5,  dailyCost: 1800,  max: 6 },
  { name: "Supermarket",   pct: 3,  dailyCost: 600,   max: 6 },
];

// ── Manufacturing improvements ───────────────────────────────────────────────

interface ManufImp { name: string; output: number; produces: string; inputs: Record<string, number>; dailyCost: number; max: number }
const MANUF_IMPS: ManufImp[] = [
  { name: "Steel Mill",          output: 9,  produces: "steel",     inputs: { iron: 3, coal: 3 }, dailyCost: 4000, max: 5 },
  { name: "Aluminum Refinery",   output: 9,  produces: "aluminum",  inputs: { bauxite: 3 },        dailyCost: 2500, max: 5 },
  { name: "Munitions Factory",   output: 18, produces: "munitions", inputs: { lead: 6 },           dailyCost: 4000, max: 5 },
  { name: "Oil Refinery",        output: 6,  produces: "gasoline",  inputs: { oil: 3 },            dailyCost: 4000, max: 5 },
];

// ── Military buildings ───────────────────────────────────────────────────────

interface ExtraBuilding { key: string; name: string; max: number; dailyCost: number }
const MIL_BUILDINGS: ExtraBuilding[] = [
  { key: "barracks",  name: "Barracks",      max: 5, dailyCost: 3000 },
  { key: "factories", name: "War Factories", max: 5, dailyCost: 3000 },
  { key: "hangars",   name: "Hangars",       max: 5, dailyCost: 1000 },
  { key: "dockyards", name: "Dockyards",     max: 3, dailyCost: 2500 },
];

// ── Civil buildings ──────────────────────────────────────────────────────────

const CIVIL_BUILDINGS: ExtraBuilding[] = [
  { key: "hospitals",         name: "Hospitals",         max: 5, dailyCost: 1000 },
  { key: "subway",            name: "Subway",            max: 1, dailyCost: 3250 },
  { key: "police_stations",   name: "Police Stations",   max: 5, dailyCost: 750  },
  { key: "recycling_centers", name: "Recycling Centers", max: 3, dailyCost: 2500 },
];

// ── Raw resource improvements ────────────────────────────────────────────────

interface ResourceImp { name: string; amount: number; produces: string; dailyCost: number; max: number }
const RESOURCE_IMPS: ResourceImp[] = [
  { name: "Coal Mine",    amount: 3, produces: "coal",    dailyCost: 400,  max: 10 },
  { name: "Oil Well",     amount: 3, produces: "oil",     dailyCost: 600,  max: 10 },
  { name: "Iron Mine",    amount: 3, produces: "iron",    dailyCost: 1600, max: 10 },
  { name: "Lead Mine",    amount: 3, produces: "lead",    dailyCost: 1600, max: 10 },
  { name: "Bauxite Mine", amount: 3, produces: "bauxite", dailyCost: 1600, max: 10 },
  { name: "Uranium Mine", amount: 3, produces: "uranium", dailyCost: 5000, max: 5  },
];

// ── Resource prices ──────────────────────────────────────────────────────────

const FALLBACK_PRICES: Record<string, number> = {
  coal: 3500, oil: 4000, uranium: 25000, iron: 4500, bauxite: 4000,
  lead: 4000, gasoline: 4000, munitions: 2500, steel: 5000, aluminum: 3500, food: 150,
};

function tradePriceToMap(tp: TradePrice): Record<string, number> {
  return {
    coal: tp.coal, oil: tp.oil, uranium: tp.uranium, iron: tp.iron,
    bauxite: tp.bauxite, lead: tp.lead, gasoline: tp.gasoline,
    munitions: tp.munitions, steel: tp.steel, aluminum: tp.aluminum, food: tp.food,
  };
}

const RESOURCE_LABELS: Record<string, string> = {
  coal: "Coal", oil: "Oil", uranium: "Uranium", iron: "Iron", bauxite: "Bauxite",
  lead: "Lead", gasoline: "Gasoline", munitions: "Munitions", steel: "Steel", aluminum: "Aluminum", food: "Food",
};

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000)     return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)         return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ── Core computation ─────────────────────────────────────────────────────────

function computePowerSlots(infra: number, powerType: PowerType): number {
  return Math.ceil(infra / POWER_TYPES[powerType].infraPerPlant);
}

function computePowerDailyCost(
  infra: number,
  powerType: PowerType,
  prices: Record<string, number>,
  upkeepMultiplier = 1,
): number {
  const pw = POWER_TYPES[powerType];
  const plants = computePowerSlots(infra, powerType);
  const fuelCost = powerType === "nuclear"
    ? dailyNuclearUraniumUsage(infra) * prices.uranium
    : pw.fuel ? pw.fuelPerDay * plants * prices[pw.fuel] : 0;
  return plants * pw.dailyCost * upkeepMultiplier + fuelCost;
}

export { hospitalsToZeroDisease };

export interface OptimizerProjects {
  massIrrigation: boolean;
  uraniumEnrichment: boolean;
  ironWorks: boolean;
  bauxiteWorks: boolean;
  armsStockpile: boolean;
  emergencyGasolineReserve: boolean;
  greenTechnologies: boolean;
  clinicalResearchCenter: boolean;
  specializedPoliceTraining: boolean;
  recyclingInitiative: boolean;
  falloutShelter: boolean;
  internationalTradeCenter: boolean;
  telecommunicationsSatellite: boolean;
  governmentSupportAgency: boolean;
  bureauOfDomesticAffairs: boolean;
}

const DEFAULT_PROJECTS: OptimizerProjects = {
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

const PROJECT_OPTIONS: Array<{ key: keyof OptimizerProjects; label: string }> = [
  { key: "massIrrigation", label: "Mass Irrigation" },
  { key: "uraniumEnrichment", label: "Uranium Enrichment" },
  { key: "ironWorks", label: "Iron Works" },
  { key: "bauxiteWorks", label: "Bauxite Works" },
  { key: "armsStockpile", label: "Arms Stockpile" },
  { key: "emergencyGasolineReserve", label: "Emergency Gasoline Reserve" },
  { key: "greenTechnologies", label: "Green Technologies" },
  { key: "clinicalResearchCenter", label: "Clinical Research Center" },
  { key: "specializedPoliceTraining", label: "Specialized Police Training" },
  { key: "recyclingInitiative", label: "Recycling Initiative" },
  { key: "falloutShelter", label: "Fallout Shelter" },
  { key: "internationalTradeCenter", label: "International Trade Center" },
  { key: "telecommunicationsSatellite", label: "Telecommunications Satellite" },
  { key: "governmentSupportAgency", label: "Government Support Agency" },
  { key: "bureauOfDomesticAffairs", label: "Bureau of Domestic Affairs" },
];

interface BuildEntry {
  category: "power" | "commerce" | "manufacturing" | "resource" | "civil";
  name: string;
  count: number;
  dailyRevenue: number;
  dailyCost: number;
}

interface OptimizerResult {
  totalSlots: number;
  powerSlots: number;
  milSlots: number;
  civilSlots: number;
  availableSlots: number;
  commercePct: number;
  dailyCommerce: number;
  dailyCommerceNoDiseaseReduction: number;
  dailyProduction: number;
  dailyFoodProduced: number;
  dailyFoodConsumed: number;
  dailyFoodConsumptionCost: number;
  dailyPowerCost: number;
  dailyCommerceCost: number;
  dailyProductionCost: number;
  dailyMilCost: number;
  dailyCivilCost: number;
  baseDiseasePct: number;
  finalDiseasePct: number;
  popMod: number;
  hospitalsNeeded: number;
  // Pollution & crime
  totalPollution: number;
  pollutionDisease: number;
  correctedDiseasePct: number;
  crimePct: number;
  effectivePopMod: number;
  population: number;
  netProfit: number;
  unfilledSlots: number;
  build: BuildEntry[];
  improvementOptions: ImprovementOption[];
}

interface ImprovementOption {
  name: string;
  category: string;
  profitPerSlot: number;
  revenuePerSlot: number;
  costPerSlot: number;
  detail: string;
}

interface ProductionState {
  slots: number;
  pollution: number;
  revenue: number;
  cost: number;
  foodProduced: number;
  entries: BuildEntry[];
}

interface CommerceState {
  slots: number;
  commerce: number;
  cost: number;
  counts: Record<string, number>;
}

function productionEntry(
  name: string,
  count: number,
  land: number,
  prices: Record<string, number>,
  projects: OptimizerProjects,
  seasonMultiplier: number,
  radiationMultiplier: number,
): ProductionState {
  if (count === 0) {
    return { slots: 0, pollution: 0, revenue: 0, cost: 0, foodProduced: 0, entries: [] };
  }

  if (name === "Farm") {
    const foodProduced = dailyFoodProduction(
      count,
      land,
      projects.massIrrigation,
      seasonMultiplier,
      radiationMultiplier,
    );
    const upkeep = count * 300 * (projects.greenTechnologies ? 0.9 : 1);
    return {
      slots: count,
      pollution: count * (projects.greenTechnologies ? 1 : 2),
      revenue: foodProduced * prices.food,
      cost: upkeep,
      foodProduced,
      entries: [{ category: "resource", name, count, dailyRevenue: foodProduced * prices.food, dailyCost: upkeep }],
    };
  }

  const manufacturing = MANUF_IMPS.find((item) => item.name === name);
  if (manufacturing) {
    const specialization = specializationMultiplier(count, manufacturing.max);
    let outputMultiplier = 1;
    let inputMultiplier = 1;
    if (name === "Steel Mill" && projects.ironWorks) outputMultiplier = inputMultiplier = 1.36;
    if (name === "Aluminum Refinery" && projects.bauxiteWorks) outputMultiplier = inputMultiplier = 1.36;
    if (name === "Munitions Factory" && projects.armsStockpile) outputMultiplier = 1.2;
    if (name === "Oil Refinery" && projects.emergencyGasolineReserve) outputMultiplier = inputMultiplier = 2;

    const output = manufacturing.output * count * specialization * outputMultiplier;
    const revenue = output * prices[manufacturing.produces];
    const inputCost = Object.entries(manufacturing.inputs).reduce(
      (sum, [resource, amount]) => sum + amount * count * specialization * inputMultiplier * prices[resource],
      0,
    );
    const upkeep = manufacturing.dailyCost * count * (projects.greenTechnologies ? 0.9 : 1);
    const cost = inputCost + upkeep;
    return {
      slots: count,
      pollution: count * (projects.greenTechnologies ? 30 : 40),
      revenue,
      cost,
      foodProduced: 0,
      entries: [{ category: "manufacturing", name, count, dailyRevenue: revenue, dailyCost: cost }],
    };
  }

  const resource = RESOURCE_IMPS.find((item) => item.name === name);
  if (!resource) throw new Error(`Unknown production improvement: ${name}`);
  const specialization = specializationMultiplier(count, resource.max);
  const projectMultiplier = name === "Uranium Mine" && projects.uraniumEnrichment ? 2 : 1;
  const output = resource.amount * count * specialization * projectMultiplier;
  const revenue = output * prices[resource.produces];
  const upkeep = resource.dailyCost * count * (projects.greenTechnologies ? 0.9 : 1);
  return {
    slots: count,
    pollution: count * 12,
    revenue,
    cost: upkeep,
    foodProduced: 0,
    entries: [{ category: "resource", name, count, dailyRevenue: revenue, dailyCost: upkeep }],
  };
}

function buildProductionStates(
  maxSlots: number,
  land: number,
  prices: Record<string, number>,
  projects: OptimizerProjects,
  seasonMultiplier: number,
  radiationMultiplier: number,
): Map<number, ProductionState[]> {
  const groups = [
    ...MANUF_IMPS.map((item) => ({ name: item.name, max: item.max })),
    ...RESOURCE_IMPS.map((item) => ({ name: item.name, max: item.max })),
    { name: "Farm", max: 20 },
  ];
  let states = new Map<string, ProductionState>();
  states.set("0|0", { slots: 0, pollution: 0, revenue: 0, cost: 0, foodProduced: 0, entries: [] });

  for (const group of groups) {
    const next = new Map<string, ProductionState>();
    for (const state of states.values()) {
      const maxCount = Math.min(group.max, maxSlots - state.slots);
      for (let count = 0; count <= maxCount; count++) {
        const option = productionEntry(
          group.name,
          count,
          land,
          prices,
          projects,
          seasonMultiplier,
          radiationMultiplier,
        );
        const combined: ProductionState = {
          slots: state.slots + option.slots,
          pollution: state.pollution + option.pollution,
          revenue: state.revenue + option.revenue,
          cost: state.cost + option.cost,
          foodProduced: state.foodProduced + option.foodProduced,
          entries: option.entries.length > 0 ? [...state.entries, ...option.entries] : state.entries,
        };
        const key = `${combined.slots}|${combined.pollution}`;
        const existing = next.get(key);
        if (!existing || combined.revenue - combined.cost > existing.revenue - existing.cost) {
          next.set(key, combined);
        }
      }
    }
    states = next;
  }

  const bySlots = new Map<number, ProductionState[]>();
  for (const state of states.values()) {
    const list = bySlots.get(state.slots) ?? [];
    list.push(state);
    bySlots.set(state.slots, list);
  }
  return bySlots;
}

function buildCommerceStates(
  maxSlots: number,
  baseCommerce: number,
  maxCommerce: number,
  projects: OptimizerProjects,
  upkeepMultiplier: number,
): CommerceState[] {
  const mallMax = projects.telecommunicationsSatellite ? 5 : 4;
  const bankMax = projects.internationalTradeCenter ? 6 : 5;
  const best = new Map<string, CommerceState>();

  for (let stadium = 0; stadium <= 3; stadium++) {
    for (let mall = 0; mall <= mallMax; mall++) {
      for (let bank = 0; bank <= bankMax; bank++) {
        for (let supermarket = 0; supermarket <= 6; supermarket++) {
          const slots = stadium + mall + bank + supermarket;
          if (slots > maxSlots) continue;
          const rawCommerce = baseCommerce + stadium * 12 + mall * 9 + bank * 5 + supermarket * 3;
          const commerce = Math.min(maxCommerce, rawCommerce);
          const cost = (stadium * 12_150 + mall * 5_400 + bank * 1_800 + supermarket * 600)
            * upkeepMultiplier;
          const state: CommerceState = {
            slots,
            commerce,
            cost,
            counts: { Stadium: stadium, "Shopping Mall": mall, Bank: bank, Supermarket: supermarket },
          };
          const key = `${slots}|${commerce}`;
          const existing = best.get(key);
          if (!existing || state.cost < existing.cost) best.set(key, state);
        }
      }
    }
  }
  return [...best.values()];
}

export function computeOptimalBuild(
  infra: number,
  land: number,
  prices: Record<string, number>,
  maxCommerce: number,
  projects: OptimizerProjects,
  radiationPenalty: number,
  gameDate: string | null,
  ageMultiplier: number,
  domesticPolicy: string,
  milCounts: Record<string, number>,
  civilCounts: Record<string, number>,
): OptimizerResult {
  const powerType: PowerType = "nuclear";
  const improvementUpkeepMultiplier = projects.greenTechnologies ? 0.9 : 1;
  const totalSlots = Math.floor(infra / 50);
  const powerSlots = computePowerSlots(infra, powerType);
  const powerDailyCost = computePowerDailyCost(infra, powerType, prices, improvementUpkeepMultiplier);
  const milSlots = MIL_BUILDINGS.reduce((s, b) => s + (milCounts[b.key] ?? 0), 0);
  const dailyMilCost = MIL_BUILDINGS.reduce((s, b) => s + (milCounts[b.key] ?? 0) * b.dailyCost, 0)
    * improvementUpkeepMultiplier;
  const civilSlots = CIVIL_BUILDINGS.reduce((s, b) => s + (civilCounts[b.key] ?? 0), 0);
  const dailyCivilCost = CIVIL_BUILDINGS.reduce((s, b) => s + (civilCounts[b.key] ?? 0) * b.dailyCost, 0)
    * improvementUpkeepMultiplier;
  const availableSlots = Math.max(0, totalSlots - powerSlots - milSlots - civilSlots);
  const hospitals = civilCounts.hospitals ?? 0;
  const policeStations = civilCounts.police_stations ?? 0;
  const subwayManual = Math.min(civilCounts.subway ?? 0, 1);
  const projectCommerce = (projects.internationalTradeCenter ? 1 : 0)
    + (projects.telecommunicationsSatellite ? 2 : 0)
    + (projects.specializedPoliceTraining ? 4 : 0);
  const baseCommerce = subwayManual * 8 + projectCommerce;
  const seasonMultiplier = seasonalFoodMultiplier(gameDate);
  const radiationMultiplier = radiationFoodMultiplier(radiationPenalty * 10, projects.falloutShelter);
  const productionStates = buildProductionStates(
    availableSlots,
    land,
    prices,
    projects,
    seasonMultiplier,
    radiationMultiplier,
  );
  const commerceStates = buildCommerceStates(
    availableSlots,
    baseCommerce,
    maxCommerce,
    projects,
    improvementUpkeepMultiplier,
  );
  const grossIncomeMultiplier = domesticPolicy === "OPEN_MARKETS"
    ? openMarketsMultiplier(projects.governmentSupportAgency, projects.bureauOfDomesticAffairs)
    : 1;

  const recyclingPollution = projects.recyclingInitiative ? -75 : -70;
  const subwayPollution = projects.greenTechnologies ? -75 : -45;
  const fixedPollution = hospitals * 4
    + policeStations
    + (civilCounts.recycling_centers ?? 0) * recyclingPollution
    + subwayManual * subwayPollution;
  const fixedCost = powerDailyCost + dailyMilCost + dailyCivilCost;

  let best: {
    commerce: CommerceState;
    production: ProductionState;
    totalPollution: number;
    population: number;
    disease: number;
    crime: number;
    dailyCommerce: number;
    foodConsumed: number;
    netProfit: number;
  } | null = null;

  for (const commerce of commerceStates) {
    const productionSlotCount = availableSlots - commerce.slots;
    const candidates = productionStates.get(productionSlotCount) ?? [];
    for (const production of candidates) {
      const totalPollution = fixedPollution + production.pollution;
      const populationResult = cityPopulation({
        infrastructure: infra,
        land,
        pollution: totalPollution,
        hospitals,
        policeStations,
        commerce: commerce.commerce,
        ageMultiplier,
        clinicalResearchCenter: projects.clinicalResearchCenter,
        specializedPoliceTraining: projects.specializedPoliceTraining,
      });
      const dailyCommerce = commerceIncome(
        populationResult.population,
        commerce.commerce,
        grossIncomeMultiplier,
      );
      const foodConsumed = dailyCivilianFoodUsage(populationResult.population);
      const netProfit = dailyCommerce
        + production.revenue
        - production.cost
        - commerce.cost
        - fixedCost
        - foodConsumed * prices.food;
      if (!best || netProfit > best.netProfit) {
        best = {
          commerce,
          production,
          totalPollution,
          population: populationResult.population,
          disease: populationResult.disease,
          crime: populationResult.crime,
          dailyCommerce,
          foodConsumed,
          netProfit,
        };
      }
    }
  }

  if (!best) {
    const emptyCommerce: CommerceState = { slots: 0, commerce: baseCommerce, cost: 0, counts: {} };
    const emptyProduction: ProductionState = { slots: 0, pollution: 0, revenue: 0, cost: 0, foodProduced: 0, entries: [] };
    const populationResult = cityPopulation({
      infrastructure: infra,
      land,
      pollution: fixedPollution,
      hospitals,
      policeStations,
      commerce: baseCommerce,
      ageMultiplier,
      clinicalResearchCenter: projects.clinicalResearchCenter,
      specializedPoliceTraining: projects.specializedPoliceTraining,
    });
    const dailyCommerce = commerceIncome(populationResult.population, baseCommerce, grossIncomeMultiplier);
    const foodConsumed = dailyCivilianFoodUsage(populationResult.population);
    best = {
      commerce: emptyCommerce,
      production: emptyProduction,
      totalPollution: fixedPollution,
      population: populationResult.population,
      disease: populationResult.disease,
      crime: populationResult.crime,
      dailyCommerce,
      foodConsumed,
      netProfit: dailyCommerce - fixedCost - foodConsumed * prices.food,
    };
  }

  const commerceEntries: BuildEntry[] = [];
  let representedCommerce = baseCommerce;
  for (const ci of COMMERCE_IMPS.filter((item) => item.name !== "Subway")) {
    const count = best.commerce.counts[ci.name] ?? 0;
    if (count === 0) continue;
    const effectiveCommerce = Math.max(0, Math.min(maxCommerce, representedCommerce + ci.pct * count) - representedCommerce);
    const revenue = (effectiveCommerce / 50) * 0.725 * best.population * grossIncomeMultiplier;
    commerceEntries.push({
      category: "commerce",
      name: ci.name,
      count,
      dailyRevenue: revenue,
      dailyCost: ci.dailyCost * count * improvementUpkeepMultiplier,
    });
    representedCommerce += ci.pct * count;
  }
  const build = [...commerceEntries, ...best.production.entries];

  const improvementOptions: ImprovementOption[] = [];
  for (const item of [...MANUF_IMPS, ...RESOURCE_IMPS]) {
    const state = productionEntry(
      item.name,
      item.max,
      land,
      prices,
      projects,
      seasonMultiplier,
      radiationMultiplier,
    );
    improvementOptions.push({
      name: item.name,
      category: MANUF_IMPS.some((candidate) => candidate.name === item.name) ? "Manufacturing" : "Raw Resource",
      revenuePerSlot: state.revenue / item.max,
      costPerSlot: state.cost / item.max,
      profitPerSlot: (state.revenue - state.cost) / item.max,
      detail: `Average at ${item.max}/city with specialization`,
    });
  }
  const farmState = productionEntry(
    "Farm",
    20,
    land,
    prices,
    projects,
    seasonMultiplier,
    radiationMultiplier,
  );
  improvementOptions.push({
    name: "Farm",
    category: "Raw Resource",
    revenuePerSlot: farmState.revenue / 20,
    costPerSlot: farmState.cost / 20,
    profitPerSlot: (farmState.revenue - farmState.cost) / 20,
    detail: `${fmtNum(farmState.foodProduced / 20)} food/farm avg (${fmtNum(farmState.foodProduced)} total at 20)`,
  });
  improvementOptions.sort((a, b) => b.profitPerSlot - a.profitPerSlot);

  const baseDiseasePct = baseDisease(infra, land, 0);
  const pollutionDisease = best.totalPollution * 0.05;
  const correctedDiseasePct = Math.max(0, best.disease);
  const crimePct = Math.max(0, best.crime);
  const hospitalsNeeded = hospitalsToZeroDisease(
    infra,
    land,
    best.totalPollution,
    projects.clinicalResearchCenter,
  );
  const dailyFoodConsumptionCost = best.foodConsumed * prices.food;

  return {
    totalSlots,
    powerSlots,
    milSlots,
    civilSlots,
    availableSlots,
    commercePct: best.commerce.commerce,
    dailyCommerce: best.dailyCommerce,
    dailyCommerceNoDiseaseReduction: best.dailyCommerce,
    dailyProduction: best.production.revenue,
    dailyFoodProduced: best.production.foodProduced,
    dailyFoodConsumed: best.foodConsumed,
    dailyFoodConsumptionCost,
    dailyPowerCost: powerDailyCost,
    dailyCommerceCost: best.commerce.cost,
    dailyProductionCost: best.production.cost,
    dailyMilCost,
    dailyCivilCost,
    baseDiseasePct,
    finalDiseasePct: correctedDiseasePct,
    popMod: best.population / (infra * 100),
    hospitalsNeeded,
    totalPollution: best.totalPollution,
    pollutionDisease,
    correctedDiseasePct,
    crimePct,
    effectivePopMod: best.population / (infra * 100),
    population: best.population,
    netProfit: best.netProfit,
    unfilledSlots: Math.max(0, availableSlots - best.commerce.slots - best.production.slots),
    build,
    improvementOptions,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

const inputCls = "bg-[#1e2540] border border-[#2a3150] rounded-lg text-sm text-white px-3 py-1.5 focus:outline-none focus:border-blue-500 w-full placeholder-slate-600";

function PriceRow({ resource, prices, onChange }: { resource: string; prices: Record<string, number>; onChange: (r: string, v: number) => void; }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400 w-20 shrink-0 capitalize">{RESOURCE_LABELS[resource] ?? resource}</span>
      <input
        type="number" min={0} value={prices[resource] ?? 0}
        onChange={e => onChange(resource, parseFloat(e.target.value) || 0)}
        className="bg-[#1e2540] border border-[#2a3150] rounded text-xs text-white px-2 py-1 w-28 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

export default function OptimizerPage() {
  const [nationId, setNationId] = useState("");
  const [infra, setInfra] = useState("");
  const [land, setLand] = useState("");
  const [maxCommerce, setMaxCommerce] = useState(100);
  const [projects, setProjects] = useState<OptimizerProjects>(DEFAULT_PROJECTS);
  const [radiationPenalty, setRadiationPenalty] = useState(0);
  const [ageMultiplier, setAgeMultiplier] = useState(1);
  const [domesticPolicy, setDomesticPolicy] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>(FALLBACK_PRICES);
  const [pricesOverridden, setPricesOverridden] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [lookupMsg, setLookupMsg] = useState("");
  const [milCounts, setMilCounts] = useState<Record<string, number>>({ barracks: 0, factories: 0, hangars: 0, dockyards: 0 });
  const [civilCounts, setCivilCounts] = useState<Record<string, number>>({ hospitals: 0, subway: 0, police_stations: 0, recycling_centers: 0 });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members"], queryFn: fetchMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: bknetMembers = [] } = useQuery({
    queryKey: ["bknet_members"], queryFn: fetchBknetMembers,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: tradePrices } = useQuery({
    queryKey: ["trade_prices"], queryFn: fetchTradePrices,
    refetchInterval: 10 * 60 * 1000,
  });
  const { data: gameInfo } = useQuery<GameInfo | null>({
    queryKey: ["game_info"], queryFn: fetchGameInfo,
    refetchInterval: 10 * 60 * 1000,
  });

  const effectivePrices = useMemo(
    () => pricesOverridden ? prices : tradePrices ? tradePriceToMap(tradePrices) : FALLBACK_PRICES,
    [pricesOverridden, prices, tradePrices],
  );

  const result = useMemo<OptimizerResult | null>(() => {
    const i = parseFloat(infra) || 0;
    const l = parseFloat(land) || 0;
    if (i < 100) return null;
    return computeOptimalBuild(
      i,
      l,
      effectivePrices,
      maxCommerce,
      projects,
      radiationPenalty,
      gameInfo?.game_date ?? null,
      ageMultiplier,
      domesticPolicy,
      milCounts,
      civilCounts,
    );
  }, [infra, land, effectivePrices, maxCommerce, projects, radiationPenalty, gameInfo?.game_date, ageMultiplier, domesticPolicy, milCounts, civilCounts]);

  function lookupNation() {
    const id = nationId.trim();
    if (!id) return;
    const member = members.find(m => String(m.id) === id);
    if (!member) {
      setLookupMsg("Nation not found in alliance DB. Enter infra and land manually.");
      return;
    }
    const cities = member.cities ?? [];
    if (cities.length === 0) {
      setLookupMsg(`Found ${member.nation_name} — no city data yet. Enter infra and land manually.`);
      return;
    }
    const avgInfra = Math.round(cities.reduce((s, c) => s + (c.infrastructure ?? 0), 0) / cities.length);
    const avgLand  = Math.round(cities.reduce((s, c) => s + (c.land ?? 0), 0) / cities.length);
    setInfra(avgInfra.toString());
    setLand(avgLand.toString());
    setDomesticPolicy(member.domestic_policy ?? "");

    const cityDates = cities
      .map((city) => city.date)
      .filter((date): date is string => Boolean(date));
    setAgeMultiplier(averageCityAgeMultiplier(cityDates));

    // Auto-fill buildings from first city (if building data is present)
    const firstCity = cities[0];
    if (firstCity.factory !== undefined) {
      setMilCounts({
        barracks:  firstCity.barracks ?? 0,
        factories: firstCity.factory  ?? 0,
        hangars:   firstCity.hangar   ?? 0,
        dockyards: firstCity.drydock  ?? 0,
      });
      setCivilCounts({
        hospitals:         firstCity.hospital        ?? 0,
        subway:            firstCity.subway          ?? 0,
        police_stations:   firstCity.policestation   ?? 0,
        recycling_centers: firstCity.recycling_center ?? 0,
      });
    }

    // BK Net exposes the full project set; P&W fields cover the core fallback set.
    const bknet = bknetMembers.find(m => String(m.nation.id) === id);
    const proj = bknet?.nation.projects ?? {};
    const loadedProjects: OptimizerProjects = {
      massIrrigation: !!(member.mass_irrigation ?? proj.mass_irrigation),
      uraniumEnrichment: !!(member.uranium_enrichment_program ?? proj.uranium_enrichment_program),
      ironWorks: !!proj.iron_works,
      bauxiteWorks: !!proj.bauxite_works,
      armsStockpile: !!proj.arms_stockpile,
      emergencyGasolineReserve: !!proj.emergency_gasoline_reserve,
      greenTechnologies: !!proj.green_technologies,
      clinicalResearchCenter: !!proj.clinical_research_center,
      specializedPoliceTraining: !!proj.specialized_police_training_program,
      recyclingInitiative: !!proj.recycling_initiative,
      falloutShelter: !!proj.fallout_shelter,
      internationalTradeCenter: !!(member.international_trade_center ?? proj.international_trade_center),
      telecommunicationsSatellite: !!(member.telecommunications_satellite ?? proj.telecommunications_satellite),
      governmentSupportAgency: !!proj.government_support_agency,
      bureauOfDomesticAffairs: !!proj.bureau_of_domestic_affairs,
    };
    setProjects(loadedProjects);
    setMaxCommerce(loadedProjects.telecommunicationsSatellite ? 125 : loadedProjects.internationalTradeCenter ? 115 : 100);

    // Auto-set radiation penalty from game radiation data + nation's continent
    if (gameInfo?.radiation && member.continent) {
      const CONTINENT_KEY: Record<string, keyof typeof gameInfo.radiation> = {
        na: "north_america", sa: "south_america", eu: "europe",
        af: "africa", as: "asia", au: "australia",
      };
      const key = CONTINENT_KEY[member.continent];
      if (key) {
        const penalty = (gameInfo.radiation.global + gameInfo.radiation[key]) / 10;
        setRadiationPenalty(Math.round(penalty * 10) / 10);
      }
    }

    setLookupMsg(`Loaded ${member.nation_name} — ${cities.length} cities, avg ${avgInfra} infra, avg ${avgLand} land.`);
  }

  const infraNum = parseFloat(infra) || 0;
  const categoryColors: Record<string, string> = {
    power: "text-yellow-400",
    commerce: "text-blue-400",
    manufacturing: "text-purple-400",
    resource: "text-green-400",
    civil: "text-teal-400",
  };
  const categoryBg: Record<string, string> = {
    power: "bg-yellow-900/30 border-yellow-700/30",
    commerce: "bg-blue-900/30 border-blue-700/30",
    manufacturing: "bg-purple-900/30 border-purple-700/30",
    resource: "bg-green-900/30 border-green-700/30",
    civil: "bg-teal-900/30 border-teal-700/30",
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white">City Build Optimizer</h2>
          <p className="text-slate-400 text-sm">
            Enter a nation ID to auto-fill their average infra & land, then see the most profitable improvement build.
          </p>
        </div>

        {/* Inputs */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-300">Nation & City Stats</h3>

          {/* Nation lookup */}
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1 w-52">
              <label className="text-xs text-slate-400">Nation ID</label>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text" placeholder="e.g. 123456"
                  value={nationId} onChange={e => setNationId(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && lookupNation()}
                  className="bg-[#1e2540] border border-[#2a3150] rounded-lg text-sm text-white pl-8 pr-3 py-1.5 focus:outline-none focus:border-blue-500 w-full placeholder-slate-600"
                />
              </div>
            </div>
            <button
              onClick={lookupNation}
              disabled={isLoading}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {isLoading ? "Loading…" : "Look up"}
            </button>
            {lookupMsg && <p className="text-xs text-slate-400 self-end pb-1.5">{lookupMsg}</p>}
          </div>

          {/* Infra / Land */}
          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Avg Infra / City</label>
              <input type="number" min={0} placeholder="e.g. 2500" value={infra} onChange={e => setInfra(e.target.value)} className={inputCls} style={{ width: 140 }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Avg Land / City</label>
              <input type="number" min={0} placeholder="e.g. 5000" value={land} onChange={e => setLand(e.target.value)} className={inputCls} style={{ width: 140 }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">City Age Bonus %</label>
              <input
                type="number"
                min={0}
                step={0.1}
                value={Math.round((ageMultiplier - 1) * 1000) / 10}
                onChange={e => setAgeMultiplier(1 + Math.max(0, Number(e.target.value)) / 100)}
                className={inputCls}
                style={{ width: 140 }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Domestic Policy</label>
              <select
                value={domesticPolicy}
                onChange={e => setDomesticPolicy(e.target.value)}
                className={inputCls}
                style={{ width: 160 }}
              >
                <option value="">Other</option>
                <option value="OPEN_MARKETS">Open Markets</option>
              </select>
            </div>
          </div>

          {/* Projects */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Profitability Projects</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
              {PROJECT_OPTIONS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={projects[key]}
                    onChange={e => setProjects(current => ({ ...current, [key]: e.target.checked }))}
                    className="accent-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-4 flex-wrap mt-2">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">Max Commerce %</label>
                <select
                  value={maxCommerce}
                  onChange={e => setMaxCommerce(Number(e.target.value))}
                  className="bg-[#1e2540] border border-[#2a3150] rounded text-xs text-slate-200 px-2 py-1 focus:outline-none focus:border-blue-500"
                >
                  <option value={100}>100% (base)</option>
                  <option value={115}>115% (ITC)</option>
                  <option value={125}>125% (ITC + Telecom Sat)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">
                  Radiation Penalty %
                  {gameInfo?.radiation && (
                    <span className="text-slate-600 ml-1" title={`Global: ${gameInfo.radiation.global.toFixed(1)} | NA: ${gameInfo.radiation.north_america.toFixed(1)} | SA: ${gameInfo.radiation.south_america.toFixed(1)} | EU: ${gameInfo.radiation.europe.toFixed(1)} | AF: ${gameInfo.radiation.africa.toFixed(1)} | AS: ${gameInfo.radiation.asia.toFixed(1)} | AU: ${gameInfo.radiation.australia.toFixed(1)}`}>ⓘ</span>
                  )}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={radiationPenalty}
                  onChange={e => setRadiationPenalty(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                  style={{ width: 70 }}
                  className={inputCls}
                />
              </div>
              {gameInfo?.game_date && (
                <span className="text-xs text-slate-500 self-center">
                  Game date {new Date(gameInfo.game_date).toLocaleDateString()} · food {seasonalFoodMultiplier(gameInfo.game_date) === 0.8 ? "winter −20%" : seasonalFoodMultiplier(gameInfo.game_date) === 1.2 ? "summer +20%" : "normal season"}
                </span>
              )}
            </div>
          </div>

          {/* Military buildings */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400">Military Buildings <span className="text-slate-600">(consume slots, no income)</span></label>
            <div className="flex flex-wrap gap-3">
              {MIL_BUILDINGS.map(b => (
                <div key={b.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">{b.name} <span className="text-slate-600">(max {b.max})</span></span>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setMilCounts(p => ({ ...p, [b.key]: Math.max(0, (p[b.key] ?? 0) - 1) }))}
                    >−</button>
                    <input
                      type="number" min={0} max={b.max}
                      value={milCounts[b.key] ?? 0}
                      onChange={e => setMilCounts(p => ({ ...p, [b.key]: Math.min(b.max, Math.max(0, Number(e.target.value))) }))}
                      className="w-12 text-center bg-[#0f1117] border border-[#2a3150] rounded text-white text-sm font-bold py-0.5 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setMilCounts(p => ({ ...p, [b.key]: Math.min(b.max, (p[b.key] ?? 0) + 1) }))}
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Civil buildings */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400">
              Civil Buildings
              <span className="text-slate-600"> — Subway adds 8% commerce &amp; reduces pollution. Hospitals eliminate disease for full population.</span>
            </label>
            <div className="flex flex-wrap gap-3">
              {CIVIL_BUILDINGS.map(b => {
                const max = b.key === "hospitals" && projects.clinicalResearchCenter ? 6
                  : b.key === "recycling_centers" && projects.recyclingInitiative ? 4
                  : b.max;
                return (
                <div key={b.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">{b.name} <span className="text-slate-600">(max {max})</span></span>
                  <div className="flex items-center gap-1">
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setCivilCounts(p => ({ ...p, [b.key]: Math.max(0, (p[b.key] ?? 0) - 1) }))}
                    >−</button>
                    <input
                      type="number" min={0} max={max}
                      value={civilCounts[b.key] ?? 0}
                      onChange={e => setCivilCounts(p => ({ ...p, [b.key]: Math.min(max, Math.max(0, Number(e.target.value))) }))}
                      className="w-12 text-center bg-[#0f1117] border border-[#2a3150] rounded text-white text-sm font-bold py-0.5 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      className="w-7 h-7 rounded bg-[#1e2540] text-slate-300 hover:bg-[#2a3150] font-bold text-sm flex items-center justify-center"
                      onClick={() => setCivilCounts(p => ({ ...p, [b.key]: Math.min(max, (p[b.key] ?? 0) + 1) }))}
                    >+</button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Resource prices (collapsible) */}
        <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
          <button
            onClick={() => setPricesOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-[#1a2035] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span>Resource Prices</span>
              <span className={`text-xs font-normal ${pricesOverridden ? "text-yellow-400" : tradePrices ? "text-green-400" : "text-slate-500"}`}>
                {pricesOverridden ? "manual override" : tradePrices ? `live — ${new Date(tradePrices.date).toLocaleDateString()}` : "using fallback defaults"}
              </span>
            </div>
            {pricesOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {pricesOpen && (
            <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 border-t border-[#2a3150] pt-3">
              {Object.keys(FALLBACK_PRICES).map(r => (
                <PriceRow key={r} resource={r} prices={effectivePrices}
                  onChange={(res, v) => { setPrices({ ...effectivePrices, [res]: v }); setPricesOverridden(true); }}
                />
              ))}
              {pricesOverridden && (
                <button
                  onClick={() => setPricesOverridden(false)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors col-span-full text-left mt-1"
                >
                  ↺ Reset to live prices
                </button>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        {!result && (
          <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-12 text-center text-slate-500 text-sm">
            {"Enter at least 100 infra above to see the optimal city build."}
          </div>
        )}

        {result && (
          <>
            {/* Slot breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Total Slots", value: result.totalSlots, sub: `floor(${infraNum}/50)`, color: "text-slate-300" },
                { label: "Power Slots", value: result.powerSlots, sub: "Nuclear plants", color: "text-yellow-400" },
                { label: "Military Slots", value: result.milSlots, sub: result.milSlots > 0 ? `${fmtMoney(result.dailyMilCost)}/day` : "none set", color: "text-red-400" },
                { label: "Civil Slots", value: result.civilSlots, sub: result.civilSlots > 0 ? `${fmtMoney(result.dailyCivilCost)}/day` : "none set", color: "text-teal-400" },
                { label: "Economic Slots", value: result.availableSlots, sub: result.unfilledSlots ? `${result.unfilledSlots} unfilled` : "all allocated", color: "text-blue-400" },
                { label: "Max Commerce", value: `${maxCommerce}%`, sub: result.commercePct >= maxCommerce ? "cap reached" : `${result.commercePct}% reached`, color: "text-green-400" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4">
                  <p className="text-xs text-slate-400 mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Disease, pollution & crime info */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 text-sm grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-slate-300 font-semibold mb-1">Disease Rate</p>
                <p className="text-xs text-slate-400">
                  Base (density + infra): <span className={result.baseDiseasePct > 0 ? "text-red-400" : "text-green-400"}>{result.baseDiseasePct.toFixed(2)}%</span>
                </p>
                {result.pollutionDisease > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Pollution ({result.totalPollution > 0 ? `+${result.totalPollution}` : result.totalPollution}): <span className="text-orange-400">+{result.pollutionDisease.toFixed(2)}%</span>
                  </p>
                )}
                {result.totalPollution < 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Pollution ({result.totalPollution}): <span className="text-green-400">{result.pollutionDisease.toFixed(2)}%</span>
                  </p>
                )}
                {(civilCounts.hospitals ?? 0) > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Hospitals (×{civilCounts.hospitals}): <span className="text-green-400">−{((civilCounts.hospitals ?? 0) * (projects.clinicalResearchCenter ? 3.5 : 2.5)).toFixed(1)}%</span>
                  </p>
                )}
                <p className="text-xs font-medium mt-1">
                  Final disease: <span className={result.correctedDiseasePct > 0 ? "text-yellow-400" : "text-green-400"}>{result.correctedDiseasePct.toFixed(2)}%</span>
                  {result.correctedDiseasePct > 0 && result.baseDiseasePct > 0 && (
                    <span className="text-slate-500 font-normal"> ({result.hospitalsNeeded}h to zero)</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-slate-300 font-semibold mb-1">Crime Rate</p>
                <p className="text-xs text-slate-400">
                  Commerce: <span className="text-green-400">{result.commercePct.toFixed(0)}%</span>
                </p>
                {(civilCounts.police_stations ?? 0) > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Police (×{civilCounts.police_stations}): <span className="text-green-400">−{((civilCounts.police_stations ?? 0) * (projects.specializedPoliceTraining ? 3.5 : 2.5)).toFixed(1)}%</span>
                  </p>
                )}
                <p className="text-xs font-medium mt-1">
                  Final crime: <span className={result.crimePct > 10 ? "text-yellow-400" : result.crimePct > 0 ? "text-orange-400" : "text-green-400"}>{result.crimePct.toFixed(2)}%</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5 italic">((103 − commerce)² + population) / 111111 − police</p>
              </div>
              <div>
                <p className="text-slate-300 font-semibold mb-1">Effective Population</p>
                <p className="text-xs text-slate-400">Base: {Math.round(infraNum * 100).toLocaleString()}</p>
                {result.correctedDiseasePct > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">Disease −{result.correctedDiseasePct.toFixed(2)}%: <span className="text-red-400">−{Math.round(infraNum * 100 * result.correctedDiseasePct / 100).toLocaleString()}</span></p>
                )}
                {result.crimePct > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">Crime −{result.crimePct.toFixed(2)}%: <span className="text-red-400">−{Math.round(infraNum * 100 * (1 - result.correctedDiseasePct / 100) * result.crimePct / 100).toLocaleString()}</span></p>
                )}
                <p className="text-xs font-medium mt-1">
                  Effective: <span className="text-slate-300">{Math.round(result.population).toLocaleString()}</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Age bonus: +{((ageMultiplier - 1) * 100).toFixed(1)}%</p>
                <p className="text-xs text-slate-400 mt-1">Commerce: <span className="text-blue-300 font-medium">{fmtMoney(result.dailyCommerce)}/day</span></p>
              </div>
            </div>

            {/* Power cost info */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl p-4 text-sm">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} className="text-yellow-400" />
                <span className="text-slate-300 font-semibold">Power Plant Cost</span>
              </div>
              <p className="text-slate-400 text-xs">
                {result.powerSlots} × Nuclear Power Plant — {fmtMoney(POWER_TYPES.nuclear.dailyCost)}/day operating each + {fmtNum(dailyNuclearUraniumUsage(infraNum))} uranium/day for {fmtNum(infraNum, 0)} infrastructure
              </p>
              <p className="text-yellow-400 font-medium mt-1">{fmtMoney(result.dailyPowerCost)}/day total</p>
            </div>

            {/* Recommended build */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a3150] flex items-center gap-2">
                <TrendingUp size={14} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-300">Recommended Build — Per City</h3>
              </div>
              <div className="divide-y divide-[#1e2540]">
                {/* Power row */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${categoryBg.power}`}>
                      <span className={categoryColors.power}>Power</span>
                    </span>
                    <span className="text-sm text-white">{result.powerSlots} × Nuclear Power Plant</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Cost</p>
                    <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyPowerCost)}/day</p>
                  </div>
                </div>

                {/* Military buildings row */}
                {result.milSlots > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded border mr-2 bg-red-900/30 border-red-700/30">
                        <span className="text-red-400">Military</span>
                      </span>
                      <span className="text-sm text-white">
                        {MIL_BUILDINGS.filter(b => (milCounts[b.key] ?? 0) > 0)
                          .map(b => `${milCounts[b.key]} × ${b.name}`)
                          .join(", ")}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{result.milSlots} slots</p>
                      <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyMilCost)}/day</p>
                    </div>
                  </div>
                )}

                {/* Civil buildings row */}
                {result.civilSlots > 0 && (
                  <div className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded border mr-2 bg-teal-900/30 border-teal-700/30">
                        <span className="text-teal-400">Civil</span>
                      </span>
                      <span className="text-sm text-white">
                        {CIVIL_BUILDINGS.filter(b => (civilCounts[b.key] ?? 0) > 0)
                          .map(b => b.key === "subway"
                            ? `${civilCounts[b.key]} × ${b.name} (+${(civilCounts[b.key] ?? 0) * 8}% commerce)`
                            : `${civilCounts[b.key]} × ${b.name}`)
                          .join(", ")}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">{result.civilSlots} slots</p>
                      <p className="text-red-400 text-sm font-medium">−{fmtMoney(result.dailyCivilCost)}/day</p>
                    </div>
                  </div>
                )}

                {/* Build entries */}
                {result.build.map((entry, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${categoryBg[entry.category]}`}>
                        <span className={categoryColors[entry.category]}>{entry.category.charAt(0).toUpperCase() + entry.category.slice(1)}</span>
                      </span>
                      <span className="text-sm text-white">{entry.count} × {entry.name}</span>
                    </div>
                    <div className="text-right text-xs space-y-0.5">
                      <p className="text-slate-400">Revenue: <span className="text-green-400">{fmtMoney(entry.dailyRevenue)}/day</span></p>
                      <p className="text-slate-400">Cost: <span className="text-red-400">{fmtMoney(entry.dailyCost)}/day</span></p>
                      <p className="text-slate-400">Net: <span className={entry.dailyRevenue - entry.dailyCost >= 0 ? "text-blue-300 font-medium" : "text-red-400"}>
                        {fmtMoney(entry.dailyRevenue - entry.dailyCost)}/day
                      </span></p>
                    </div>
                  </div>
                ))}

                {/* Summary */}
                <div className="px-4 py-3 bg-[#1a2035]">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="space-y-1 text-xs text-slate-400">
                      <p>Commerce income: <span className="text-blue-300">{fmtMoney(result.dailyCommerce)}/day</span></p>
                      <p>Production revenue: <span className="text-green-300">{fmtMoney(result.dailyProduction)}/day</span></p>
                      {result.dailyFoodProduced > 0 && <p className="text-slate-500">Food: {fmtNum(result.dailyFoodProduced)} produced − {fmtNum(result.dailyFoodConsumed)} consumed</p>}
                      <p>Total costs: <span className="text-red-300">{fmtMoney(result.dailyPowerCost + result.dailyCommerceCost + result.dailyProductionCost + result.dailyMilCost + result.dailyCivilCost + result.dailyFoodConsumptionCost)}/day</span></p>
                      {result.dailyMilCost > 0 && <p className="text-slate-500">incl. {fmtMoney(result.dailyMilCost)}/day military upkeep</p>}
                      {result.dailyCivilCost > 0 && <p className="text-slate-500">incl. {fmtMoney(result.dailyCivilCost)}/day civil upkeep</p>}
                      <p className="text-slate-500">Excludes unit upkeep and color bloc bonus.</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Estimated Net Profit / City</p>
                      <p className={`text-2xl font-bold ${result.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {fmtMoney(result.netProfit)}/day
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Improvement comparison table */}
            <div className="bg-[#161b2e] border border-[#2a3150] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a3150]">
                <h3 className="text-sm font-semibold text-slate-300">Improvement Profitability — Per Slot Per Day</h3>
                <p className="text-xs text-slate-500 mt-0.5">Manufacturing assumes buying inputs from market. Sorted by net profit.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-[#2a3150]">
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Improvement</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Category</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-slate-400">Detail</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-green-400">Revenue/Slot</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-red-400">Cost/Slot</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-blue-400">Profit/Slot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Commerce improvements */}
                    {COMMERCE_IMPS.map(ci => {
                      const policyMultiplier = domesticPolicy === "OPEN_MARKETS"
                        ? openMarketsMultiplier(projects.governmentSupportAgency, projects.bureauOfDomesticAffairs)
                        : 1;
                      const revenue = ci.pct * (0.725 / 50) * result.population * policyMultiplier;
                      const profit = revenue - ci.dailyCost;
                      return (
                        <tr key={ci.name} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                          <td className="px-4 py-2 text-white">{ci.name}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs bg-blue-900/30 text-blue-400 border border-blue-700/30 px-1.5 py-0.5 rounded">Commerce</span>
                          </td>
                          <td className="px-4 py-2 text-right text-slate-400 text-xs">+{ci.pct}% commerce (max {ci.max}/city)</td>
                          <td className="px-4 py-2 text-right text-green-400">{fmtMoney(revenue)}</td>
                          <td className="px-4 py-2 text-right text-red-400">{fmtMoney(ci.dailyCost)}</td>
                          <td className={`px-4 py-2 text-right font-medium ${profit >= 0 ? "text-blue-300" : "text-red-400"}`}>{fmtMoney(profit)}</td>
                        </tr>
                      );
                    })}
                    {/* Manufacturing, resource & civil options */}
                    {result.improvementOptions.map((opt, i) => (
                      <tr key={`${opt.name}-${i}`} className="border-b border-[#1e2540] hover:bg-[#1a2035]">
                        <td className="px-4 py-2 text-white">{opt.name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${
                            opt.category === "Manufacturing" ? "bg-purple-900/30 text-purple-400 border-purple-700/30"
                            : opt.category === "Civil" ? "bg-teal-900/30 text-teal-400 border-teal-700/30"
                            : "bg-green-900/30 text-green-400 border-green-700/30"
                          }`}>
                            {opt.category}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-slate-400 text-xs">{opt.detail}</td>
                        <td className="px-4 py-2 text-right text-green-400">{fmtMoney(opt.revenuePerSlot)}</td>
                        <td className="px-4 py-2 text-right text-red-400">{fmtMoney(opt.costPerSlot)}</td>
                        <td className={`px-4 py-2 text-right font-medium ${opt.profitPerSlot >= 0 ? "text-blue-300" : "text-red-400"}`}>{fmtMoney(opt.profitPerSlot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Commerce income formula: <code>((commerce/50)×0.725 + 0.725) × effective population</code> per day. The search values resource output at current market prices and accounts for specialization, project modifiers, pollution, city age, food consumption, season, and radiation.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
