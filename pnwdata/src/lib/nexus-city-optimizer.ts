import {
  baseDisease,
  cityPopulation,
  commerceIncome,
  hospitalsToZeroDisease,
  radiationFoodMultiplier,
  specializationMultiplier,
} from "@/lib/pnw-formulas";

export type PowerType = "coal" | "oil" | "nuclear" | "wind";

export interface NexusOptimizerProjects {
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

export interface NexusOptimizerInput {
  infrastructure: number;
  land: number;
  prices: Record<string, number>;
  projects: NexusOptimizerProjects;
  radiationPenalty: number;
  gameDate: string | null;
  ageMultiplier: number;
  domesticPolicy: string;
  continent: string;
  cityCount: number;
  minimumMilitary: Record<string, number>;
}

export interface NexusBuildEntry {
  category: "commerce" | "manufacturing" | "resource" | "civil";
  name: string;
  count: number;
  dailyRevenue: number;
  dailyCost: number;
}

export interface NexusImprovementOption {
  name: string;
  category: string;
  profitPerSlot: number;
  revenuePerSlot: number;
  costPerSlot: number;
  detail: string;
}

export interface NexusOptimizerResult {
  totalSlots: number;
  powerSlots: number;
  powerBuild: Record<PowerType, number>;
  powerDescription: string;
  powerFuelDescription: string;
  milSlots: number;
  civilSlots: number;
  availableSlots: number;
  usedSlots: number;
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
  hospitals: number;
  policeStations: number;
  totalPollution: number;
  pollutionDisease: number;
  correctedDiseasePct: number;
  crimePct: number;
  effectivePopMod: number;
  population: number;
  netProfit: number;
  unfilledSlots: number;
  build: NexusBuildEntry[];
  improvementOptions: NexusImprovementOption[];
  counts: Record<string, number>;
}

export interface TargetCityLike {
  infrastructure?: number;
  land?: number;
  [key: string]: number | string | boolean | undefined;
}

export interface NexusTargetProfile {
  targetInfrastructure: number;
  availableSlots: number;
  citiesBelowTarget: number;
  infrastructureShortfall: number;
  landUsed: number;
}

type Resource = "money" | "coal" | "oil" | "uranium" | "iron" | "bauxite" | "lead" | "gasoline" | "munitions" | "steel" | "aluminum" | "food";
type ResourceVector = Record<Resource, number>;
type Counts = Record<string, number>;

interface SearchState {
  build: Counts;
  slots: number;
  pollution: number;
  commerce: number;
  vector: ResourceVector;
  value: number;
}

interface CivilChoice {
  contribution: number;
  slots: number;
  pollution: number;
  hospitals: number;
  policeStations: number;
  population: number;
  disease: number;
  crime: number;
  commerce: number;
  income: number;
}

const RESOURCES: Resource[] = [
  "money", "coal", "oil", "uranium", "iron", "bauxite", "lead",
  "gasoline", "munitions", "steel", "aluminum", "food",
];

const POWER_FIELDS: PowerType[] = ["coal", "oil", "nuclear", "wind"];

const RESOURCE_FIELDS = [
  "coal_mine", "iron_mine", "steel_mill",
  "oil_well", "oil_refinery",
  "uranium_mine",
  "lead_mine", "munitions_factory",
  "bauxite_mine", "aluminum_refinery",
  "farm",
] as const;

const SUPPORT_FIELDS = [
  "recycling_center", "subway", "supermarket", "bank", "shopping_mall", "stadium",
] as const;

const BUILD_ORDER = [
  "coal_power", "oil_power", "nuclear_power", "wind_power",
  ...RESOURCE_FIELDS,
  ...SUPPORT_FIELDS,
  "hospital", "police_station", "barracks", "factory", "hangar", "drydock",
] as const;

const FIELD_LABELS: Record<string, string> = {
  coal_mine: "Coal Mine",
  oil_well: "Oil Well",
  uranium_mine: "Uranium Mine",
  lead_mine: "Lead Mine",
  iron_mine: "Iron Mine",
  bauxite_mine: "Bauxite Mine",
  farm: "Farm",
  oil_refinery: "Oil Refinery",
  aluminum_refinery: "Aluminum Refinery",
  munitions_factory: "Munitions Factory",
  steel_mill: "Steel Mill",
  recycling_center: "Recycling Center",
  subway: "Subway",
  supermarket: "Supermarket",
  bank: "Bank",
  shopping_mall: "Shopping Mall",
  stadium: "Stadium",
  hospital: "Hospital",
  police_station: "Police Station",
};

export const NEXUS_POWER_TYPES: Record<PowerType, { name: string; capacity: number; upkeep: number }> = {
  coal: { name: "Coal Power Plant", capacity: 500, upkeep: 1_200 },
  oil: { name: "Oil Power Plant", capacity: 500, upkeep: 1_800 },
  nuclear: { name: "Nuclear Power Plant", capacity: 2_000, upkeep: 10_500 },
  wind: { name: "Wind Power Plant", capacity: 250, upkeep: 500 },
};

export const NEXUS_COMMERCE_IMPROVEMENTS = [
  { key: "stadium", name: "Stadium", commerce: 10, upkeep: 12_150, baseCap: 3 },
  { key: "shopping_mall", name: "Shopping Mall", commerce: 8, upkeep: 5_400, baseCap: 4 },
  { key: "subway", name: "Subway", commerce: 8, upkeep: 3_250, baseCap: 1 },
  { key: "bank", name: "Bank", commerce: 6, upkeep: 1_800, baseCap: 5 },
  { key: "supermarket", name: "Supermarket", commerce: 4, upkeep: 600, baseCap: 4 },
] as const;

const FIELD_ALIASES: Record<string, string[]> = {
  coal_power: ["coal_power", "coalpower"],
  oil_power: ["oil_power", "oilpower"],
  nuclear_power: ["nuclear_power", "nuclearpower"],
  wind_power: ["wind_power", "windpower"],
  coal_mine: ["coal_mine", "coalmine"],
  oil_well: ["oil_well", "oilwell"],
  uranium_mine: ["uranium_mine", "uramine"],
  lead_mine: ["lead_mine", "leadmine"],
  iron_mine: ["iron_mine", "ironmine"],
  bauxite_mine: ["bauxite_mine", "bauxitemine"],
  oil_refinery: ["oil_refinery", "gasrefinery"],
  aluminum_refinery: ["aluminum_refinery", "aluminumrefinery"],
  munitions_factory: ["munitions_factory", "munitionsfactory"],
  steel_mill: ["steel_mill", "steelmill"],
  police_station: ["police_station", "policestation"],
  shopping_mall: ["shopping_mall", "mall"],
  recycling_center: ["recycling_center"],
  farm: ["farm"], supermarket: ["supermarket"], bank: ["bank"], stadium: ["stadium"],
  subway: ["subway"], hospital: ["hospital"], barracks: ["barracks"],
  factory: ["factory"], hangar: ["hangar"], drydock: ["drydock"],
};

function emptyVector(): ResourceVector {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, 0])) as ResourceVector;
}

function addVector(left: ResourceVector, right: ResourceVector): ResourceVector {
  const result = { ...left };
  for (const resource of RESOURCES) result[resource] += right[resource];
  return result;
}

function convertedValue(vector: ResourceVector, prices: Record<string, number>): number {
  return RESOURCES.reduce(
    (total, resource) => total + vector[resource] * (resource === "money" ? 1 : (prices[resource] ?? 0)),
    0,
  );
}

function buildKey(build: Counts): string {
  return BUILD_ORDER.map((field) => `${field}:${String(build[field] ?? 0).padStart(2, "0")}`).join("|");
}

function mergeState(left: SearchState, right: SearchState, prices: Record<string, number>): SearchState {
  const vector = addVector(left.vector, right.vector);
  return {
    build: { ...left.build, ...right.build },
    slots: left.slots + right.slots,
    pollution: left.pollution + right.pollution,
    commerce: left.commerce + right.commerce,
    vector,
    value: convertedValue(vector, prices),
  };
}

function isDirectlyBetter(candidate: SearchState, current: SearchState): boolean {
  if (Math.abs(candidate.value - current.value) > 0.000001) return candidate.value > current.value;
  if (Math.abs(candidate.vector.money - current.vector.money) > 0.000001) {
    return candidate.vector.money > current.vector.money;
  }
  return buildKey(candidate.build) < buildKey(current.build);
}

function improvementCap(field: string, projects: NexusOptimizerProjects): number {
  switch (field) {
    case "coal_mine": case "oil_well": case "lead_mine": case "iron_mine": case "bauxite_mine": return 10;
    case "uranium_mine": return 5;
    case "farm": return 20;
    case "oil_refinery": case "aluminum_refinery": case "munitions_factory": case "steel_mill": return 5;
    case "subway": return 1;
    case "supermarket": return 4;
    case "bank": return projects.internationalTradeCenter ? 6 : 5;
    case "shopping_mall": return projects.telecommunicationsSatellite ? 5 : 4;
    case "stadium": return 3;
    case "police_station": return 5;
    case "hospital": return projects.clinicalResearchCenter ? 6 : 5;
    case "recycling_center": return projects.recyclingInitiative ? 4 : 3;
    case "barracks": case "factory": case "hangar": return 5;
    case "drydock": return 3;
    default: return 0;
  }
}

function isFieldAllowed(field: string, continent: string): boolean {
  const code = continent.toUpperCase();
  switch (field) {
    case "coal_mine": return ["NA", "EU", "AU", "AN"].includes(code);
    case "oil_well": return ["SA", "AF", "AS", "AN"].includes(code);
    case "uranium_mine": return ["NA", "AF", "AS", "AN"].includes(code);
    case "lead_mine": return ["SA", "EU", "AU"].includes(code);
    case "iron_mine": return ["NA", "EU", "AS"].includes(code);
    case "bauxite_mine": return ["SA", "AF", "AU"].includes(code);
    default: return true;
  }
}

function buildingUpkeep(field: string, projects: NexusOptimizerProjects): number {
  const base: Record<string, number> = {
    coal_mine: 400, oil_well: 600, uranium_mine: 5_000, lead_mine: 1_500,
    iron_mine: 1_600, bauxite_mine: 1_600, farm: 300, oil_refinery: 4_000,
    steel_mill: 4_000, aluminum_refinery: 2_500, munitions_factory: 3_500,
    subway: 3_250, shopping_mall: 5_400, stadium: 12_150, bank: 1_800,
    supermarket: 600, police_station: 750, hospital: 1_000, recycling_center: 2_500,
  };
  const economic = RESOURCE_FIELDS.includes(field as typeof RESOURCE_FIELDS[number]);
  return (base[field] ?? 0) * (projects.greenTechnologies && economic ? 0.9 : 1);
}

function pollutionContribution(field: string, count: number, projects: NexusOptimizerProjects): number {
  const perBuilding: Record<string, number> = {
    coal_power: 8, oil_power: 6, nuclear_power: 0, wind_power: 0,
    coal_mine: 12, oil_well: 12, lead_mine: 12, iron_mine: 12, bauxite_mine: 12,
    uranium_mine: 20, farm: projects.greenTechnologies ? 1 : 2,
    oil_refinery: projects.greenTechnologies ? 24 : 32,
    munitions_factory: projects.greenTechnologies ? 24 : 32,
    steel_mill: projects.greenTechnologies ? 30 : 40,
    aluminum_refinery: projects.greenTechnologies ? 30 : 40,
    subway: projects.greenTechnologies ? -70 : -45,
    shopping_mall: 2, stadium: 5, police_station: 1, hospital: 4,
    recycling_center: projects.recyclingInitiative ? -75 : -70,
  };
  return (perBuilding[field] ?? 0) * count;
}

function commerceContribution(field: string, count: number): number {
  if (field === "subway" || field === "shopping_mall") return 8 * count;
  if (field === "stadium") return 10 * count;
  if (field === "bank") return 6 * count;
  if (field === "supermarket") return 4 * count;
  return 0;
}

function seasonMultiplier(gameDate: string | null, continent: string): number {
  if (!gameDate) return 1;
  const month = new Date(gameDate).getUTCMonth() + 1;
  const code = continent.toUpperCase();
  if ([12, 1, 2].includes(month)) {
    if (["NA", "EU", "AS"].includes(code)) return 0.8;
    if (code === "AN") return 0.5;
    return 1.2;
  }
  if ([6, 7, 8].includes(month)) {
    if (["NA", "EU", "AS"].includes(code)) return 1.2;
    if (code === "AN") return 0.5;
    return 0.8;
  }
  return 1;
}

function foodProduction(input: NexusOptimizerInput, count: number): number {
  let radiation = radiationFoodMultiplier(input.radiationPenalty * 10);
  if (input.projects.falloutShelter) radiation = 0.15 + 0.85 * radiation;
  const base = (input.land / (input.projects.massIrrigation ? 400 : 500))
    * 12
    * seasonMultiplier(input.gameDate, input.continent)
    * (input.continent.toUpperCase() === "AN" ? 0.5 : 1)
    * radiation;
  return base * specializationMultiplier(count, 20) * count;
}

function productionVector(field: string, count: number, input: NexusOptimizerInput): ResourceVector {
  const vector = emptyVector();
  if (count <= 0) return vector;
  vector.money -= buildingUpkeep(field, input.projects) * count;
  const spec = specializationMultiplier(count, improvementCap(field, input.projects));
  switch (field) {
    case "coal_mine": vector.coal += 3 * count * spec; break;
    case "oil_well": vector.oil += 3 * count * spec; break;
    case "uranium_mine": vector.uranium += 3 * count * spec * (input.projects.uraniumEnrichment ? 2 : 1); break;
    case "lead_mine": vector.lead += 3 * count * spec; break;
    case "iron_mine": vector.iron += 3 * count * spec; break;
    case "bauxite_mine": vector.bauxite += 3 * count * spec; break;
    case "farm": vector.food += foodProduction(input, count); break;
    case "oil_refinery": {
      const boost = input.projects.emergencyGasolineReserve ? 2 : 1;
      vector.gasoline += 6 * count * spec * boost;
      vector.oil -= 3 * count * spec * boost;
      break;
    }
    case "munitions_factory":
      vector.munitions += 18 * count * spec * (input.projects.armsStockpile ? 1.2 : 1);
      vector.lead -= 6 * count * spec;
      break;
    case "steel_mill": {
      const boost = input.projects.ironWorks ? 1.36 : 1;
      vector.steel += 9 * count * spec * boost;
      vector.iron -= 3 * count * spec * boost;
      vector.coal -= 3 * count * spec * boost;
      break;
    }
    case "aluminum_refinery": {
      const boost = input.projects.bauxiteWorks ? 1.36 : 1;
      vector.aluminum += 9 * count * spec * boost;
      vector.bauxite -= 3 * count * spec * boost;
      break;
    }
  }
  return vector;
}

function dailyFoodConsumption(infrastructure: number, ageMultiplier: number): number {
  const basePopulation = infrastructure * 100;
  return (basePopulation ** 2) / 125_000_000
    + ((basePopulation * ageMultiplier) - basePopulation) / 850;
}

function powerSignatures(infrastructure: number, slotLimit: number): Array<Record<PowerType, number>> {
  if (infrastructure <= 0) return [{ coal: 0, oil: 0, nuclear: 0, wind: 0 }];
  const signatures: Array<Record<PowerType, number>> = [];
  const maximums = {
    nuclear: Math.min(slotLimit, Math.ceil(infrastructure / 2_000)),
    coal: Math.min(slotLimit, Math.ceil(infrastructure / 500)),
    oil: Math.min(slotLimit, Math.ceil(infrastructure / 500)),
    wind: Math.min(slotLimit, Math.ceil(infrastructure / 250)),
  };
  for (let nuclear = 0; nuclear <= maximums.nuclear; nuclear++) {
    for (let coal = 0; coal <= maximums.coal; coal++) {
      for (let oil = 0; oil <= maximums.oil; oil++) {
        for (let wind = 0; wind <= maximums.wind; wind++) {
          const slots = nuclear + coal + oil + wind;
          if (slots <= 0 || slots > slotLimit) continue;
          const capacity = nuclear * 2_000 + (coal + oil) * 500 + wind * 250;
          if (capacity < infrastructure) continue;
          if ((nuclear > 0 && capacity - 2_000 >= infrastructure)
            || (coal > 0 && capacity - 500 >= infrastructure)
            || (oil > 0 && capacity - 500 >= infrastructure)
            || (wind > 0 && capacity - 250 >= infrastructure)) continue;
          signatures.push({ coal, oil, nuclear, wind });
        }
      }
    }
  }
  return signatures;
}

function powerVector(signature: Record<PowerType, number>, infrastructure: number): ResourceVector {
  const vector = emptyVector();
  let remaining = infrastructure;
  for (const type of POWER_FIELDS) {
    for (let index = 0; index < signature[type]; index++) {
      const plant = NEXUS_POWER_TYPES[type];
      vector.money -= plant.upkeep;
      if (type === "coal" || type === "oil") {
        const levels = remaining < 100 ? 1 : Math.ceil(Math.min(remaining, 500) / 100);
        vector[type] -= levels * 1.2;
      } else if (type === "nuclear") {
        const levels = remaining < 1_000 ? 1 : Math.ceil(Math.min(remaining, 2_000) / 1_000);
        vector.uranium -= levels * 3;
      }
      remaining -= plant.capacity;
    }
  }
  return vector;
}

function fenwickMaximum(tree: number[], index: number): number {
  let maximum = Number.NEGATIVE_INFINITY;
  while (index > 0) {
    maximum = Math.max(maximum, tree[index] ?? Number.NEGATIVE_INFINITY);
    index -= index & -index;
  }
  return maximum;
}

function fenwickUpdate(tree: number[], index: number, size: number, value: number): void {
  while (index <= size) {
    tree[index] = Math.max(tree[index] ?? Number.NEGATIVE_INFINITY, value);
    index += index & -index;
  }
}

function pruneEconomicStates(states: SearchState[]): SearchState[] {
  const bestByPoint = new Map<string, SearchState>();
  for (const state of states) {
    const key = `${state.slots}|${state.pollution}`;
    const current = bestByPoint.get(key);
    if (!current || isDirectlyBetter(state, current)) bestByPoint.set(key, state);
  }
  const points = [...bestByPoint.values()].sort((a, b) => a.slots - b.slots || a.pollution - b.pollution);
  const pollutionValues = [...new Set(points.map((state) => state.pollution))].sort((a, b) => a - b);
  const indexes = new Map(pollutionValues.map((pollution, index) => [pollution, index + 1]));
  const tree: number[] = [];
  const frontier: SearchState[] = [];
  for (const candidate of points) {
    const pollutionIndex = indexes.get(candidate.pollution)!;
    if (fenwickMaximum(tree, pollutionIndex) >= candidate.value - 0.000001) continue;
    frontier.push(candidate);
    fenwickUpdate(tree, pollutionIndex, pollutionValues.length, candidate.value);
  }
  return frontier;
}

function pruneSupportStates(states: SearchState[]): SearchState[] {
  states.sort((left, right) => left.slots - right.slots
    || right.commerce - left.commerce
    || left.pollution - right.pollution
    || right.value - left.value
    || buildKey(left.build).localeCompare(buildKey(right.build)));
  const pollutionValues = [...new Set(states.map((state) => state.pollution))].sort((a, b) => a - b);
  const indexes = new Map(pollutionValues.map((pollution, index) => [pollution, index + 1]));
  const maxCommerce = Math.max(0, ...states.map((state) => state.commerce));
  const trees: number[][] = Array.from({ length: maxCommerce + 1 }, () => []);
  const frontier: SearchState[] = [];
  for (const candidate of states) {
    const pollutionIndex = indexes.get(candidate.pollution)!;
    let dominated = false;
    for (let commerce = candidate.commerce; commerce <= maxCommerce; commerce++) {
      if (fenwickMaximum(trees[commerce], pollutionIndex) >= candidate.value - 0.000001) {
        dominated = true;
        break;
      }
    }
    if (dominated) continue;
    frontier.push(candidate);
    fenwickUpdate(trees[candidate.commerce], pollutionIndex, pollutionValues.length, candidate.value);
  }
  return frontier;
}

function combineOptions(
  states: SearchState[],
  options: SearchState[],
  slotLimit: number,
  prices: Record<string, number>,
  maximumCommerce?: number,
): SearchState[] {
  const best = new Map<string, SearchState>();
  for (const state of states) {
    for (const option of options) {
      if (state.slots + option.slots > slotLimit) continue;
      const candidate = mergeState(state, option, prices);
      if (maximumCommerce !== undefined) candidate.commerce = Math.min(maximumCommerce, candidate.commerce);
      const key = maximumCommerce === undefined
        ? `${candidate.slots}|${candidate.pollution}`
        : `${candidate.slots}|${candidate.pollution}|${candidate.commerce}`;
      const current = best.get(key);
      if (!current || isDirectlyBetter(candidate, current)) best.set(key, candidate);
    }
  }
  return [...best.values()];
}

function projectCommerce(projects: NexusOptimizerProjects): number {
  return (projects.specializedPoliceTraining ? 4 : 0)
    + (projects.internationalTradeCenter ? 1 : 0)
    + (projects.internationalTradeCenter && projects.telecommunicationsSatellite ? 2 : 0);
}

function maximumCommerce(projects: NexusOptimizerProjects): number {
  return projects.internationalTradeCenter
    ? (projects.telecommunicationsSatellite ? 125 : 115)
    : 100;
}

function incomeMultiplier(input: NexusOptimizerInput): number {
  const newPlayerBonus = 1 + Math.max(1 - ((Math.max(1, input.cityCount) - 1) * 0.05), 0);
  let policy = 1;
  if (input.domesticPolicy === "OPEN_MARKETS") {
    policy += 0.01;
    if (input.projects.governmentSupportAgency) policy += 0.005;
    if (input.projects.bureauOfDomesticAffairs) policy += 0.0025;
  }
  return newPlayerBonus * policy;
}

function civilChoice(
  input: NexusOptimizerInput,
  basePollution: number,
  baseCommerce: number,
  capacity: number,
): CivilChoice {
  const hospitalCap = improvementCap("hospital", input.projects);
  const policeCap = improvementCap("police_station", input.projects);
  const commerce = Math.min(maximumCommerce(input.projects), baseCommerce + projectCommerce(input.projects));
  let best: CivilChoice | null = null;
  for (let hospitals = 0; hospitals <= hospitalCap; hospitals++) {
    for (let policeStations = 0; policeStations <= policeCap; policeStations++) {
      const slots = hospitals + policeStations;
      if (slots > capacity) continue;
      const pollution = Math.max(0, basePollution
        + pollutionContribution("hospital", hospitals, input.projects)
        + pollutionContribution("police_station", policeStations, input.projects));
      const metrics = cityPopulation({
        infrastructure: input.infrastructure,
        land: input.land,
        pollution,
        hospitals,
        policeStations,
        commerce,
        ageMultiplier: input.ageMultiplier,
        clinicalResearchCenter: input.projects.clinicalResearchCenter,
        specializedPoliceTraining: input.projects.specializedPoliceTraining,
      });
      const income = commerceIncome(metrics.population, commerce, incomeMultiplier(input));
      const contribution = income - hospitals * 1_000 - policeStations * 750;
      const candidate: CivilChoice = {
        contribution, slots, pollution, hospitals, policeStations,
        population: metrics.population, disease: Math.max(0, metrics.disease),
        crime: Math.max(0, metrics.crime), commerce, income,
      };
      if (!best
        || candidate.contribution > best.contribution + 0.000001
        || (Math.abs(candidate.contribution - best.contribution) <= 0.000001
          && (candidate.slots < best.slots
            || (candidate.slots === best.slots && (candidate.pollution < best.pollution
              || (candidate.pollution === best.pollution
                && `${candidate.hospitals}:${candidate.policeStations}` < `${best.hospitals}:${best.policeStations}`)))))) {
        best = candidate;
      }
    }
  }
  return best!;
}

function maximumCivilContribution(input: NexusOptimizerInput, baseCommerce: number): number {
  const commerce = Math.min(maximumCommerce(input.projects), baseCommerce + projectCommerce(input.projects));
  return commerceIncome(input.infrastructure * 100 * input.ageMultiplier, commerce, incomeMultiplier(input));
}

function minimumMilitaryBuild(input: NexusOptimizerInput): Counts {
  return {
    barracks: Math.min(improvementCap("barracks", input.projects), Math.max(0, input.minimumMilitary.barracks ?? 0)),
    factory: Math.min(improvementCap("factory", input.projects), Math.max(0, input.minimumMilitary.factories ?? input.minimumMilitary.factory ?? 0)),
    hangar: Math.min(improvementCap("hangar", input.projects), Math.max(0, input.minimumMilitary.hangars ?? input.minimumMilitary.hangar ?? 0)),
    drydock: Math.min(improvementCap("drydock", input.projects), Math.max(0, input.minimumMilitary.dockyards ?? input.minimumMilitary.drydock ?? 0)),
  };
}

function supportOption(field: string, count: number, input: NexusOptimizerInput): SearchState {
  const vector = emptyVector();
  vector.money = -buildingUpkeep(field, input.projects) * count;
  return {
    build: { [field]: count }, slots: count,
    pollution: pollutionContribution(field, count, input.projects),
    commerce: commerceContribution(field, count), vector,
    value: convertedValue(vector, input.prices),
  };
}

function productionOption(field: string, count: number, input: NexusOptimizerInput): SearchState {
  const vector = productionVector(field, count, input);
  return {
    build: { [field]: count }, slots: count,
    pollution: pollutionContribution(field, count, input.projects), commerce: 0,
    vector, value: convertedValue(vector, input.prices),
  };
}

function describePower(build: Record<PowerType, number>): string {
  return POWER_FIELDS.filter((type) => build[type] > 0)
    .map((type) => `${build[type]} × ${NEXUS_POWER_TYPES[type].name}`)
    .join(", ");
}

function describeFuel(vector: ResourceVector): string {
  return (["coal", "oil", "uranium"] as const)
    .filter((resource) => vector[resource] < 0)
    .map((resource) => `${Math.abs(vector[resource]).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${resource}/day`)
    .join(" + ") || "no fuel";
}

function buildEntries(
  input: NexusOptimizerInput,
  build: Counts,
  population: number,
): { entries: NexusBuildEntry[]; productionRevenue: number; productionCost: number; foodProduced: number; commerceCost: number; civilCost: number } {
  const entries: NexusBuildEntry[] = [];
  let productionRevenue = 0;
  let productionCost = 0;
  let foodProduced = 0;
  for (const field of RESOURCE_FIELDS) {
    const count = build[field] ?? 0;
    if (count <= 0) continue;
    const vector = productionVector(field, count, input);
    const revenue = RESOURCES.reduce((sum, resource) => sum + Math.max(0, vector[resource]) * (resource === "money" ? 1 : (input.prices[resource] ?? 0)), 0);
    const cost = RESOURCES.reduce((sum, resource) => sum + Math.max(0, -vector[resource]) * (resource === "money" ? 1 : (input.prices[resource] ?? 0)), 0);
    productionRevenue += revenue;
    productionCost += cost;
    if (field === "farm") foodProduced = vector.food;
    entries.push({
      category: ["oil_refinery", "aluminum_refinery", "munitions_factory", "steel_mill"].includes(field) ? "manufacturing" : "resource",
      name: FIELD_LABELS[field], count, dailyRevenue: revenue, dailyCost: cost,
    });
  }
  let representedCommerce = projectCommerce(input.projects);
  let commerceCost = 0;
  let civilCost = 0;
  for (const field of [...SUPPORT_FIELDS, "hospital", "police_station"] as const) {
    const count = build[field] ?? 0;
    if (count <= 0) continue;
    const cost = buildingUpkeep(field, input.projects) * count;
    const rawContribution = commerceContribution(field, count);
    const effectiveContribution = Math.max(0, Math.min(maximumCommerce(input.projects), representedCommerce + rawContribution) - representedCommerce);
    const revenue = effectiveContribution * (0.725 / 50) * population * incomeMultiplier(input);
    representedCommerce += rawContribution;
    const isCivil = ["recycling_center", "subway", "hospital", "police_station"].includes(field);
    if (isCivil) civilCost += cost;
    else commerceCost += cost;
    entries.push({ category: isCivil ? "civil" : "commerce", name: FIELD_LABELS[field], count, dailyRevenue: revenue, dailyCost: cost });
  }
  return { entries, productionRevenue, productionCost, foodProduced, commerceCost, civilCost };
}

function improvementOptions(input: NexusOptimizerInput): NexusImprovementOption[] {
  const options: NexusImprovementOption[] = [];
  for (const field of RESOURCE_FIELDS) {
    if (!isFieldAllowed(field, input.continent)) continue;
    const count = improvementCap(field, input.projects);
    const vector = productionVector(field, count, input);
    const revenue = RESOURCES.reduce((sum, resource) => sum + Math.max(0, vector[resource]) * (resource === "money" ? 1 : (input.prices[resource] ?? 0)), 0);
    const cost = RESOURCES.reduce((sum, resource) => sum + Math.max(0, -vector[resource]) * (resource === "money" ? 1 : (input.prices[resource] ?? 0)), 0);
    options.push({
      name: FIELD_LABELS[field],
      category: ["oil_refinery", "aluminum_refinery", "munitions_factory", "steel_mill"].includes(field) ? "Manufacturing" : "Raw Resource",
      revenuePerSlot: revenue / count,
      costPerSlot: cost / count,
      profitPerSlot: (revenue - cost) / count,
      detail: field === "farm" ? `${(vector.food / count).toFixed(1)} food/farm avg` : `Average at ${count}/city with specialization`,
    });
  }
  return options.sort((left, right) => right.profitPerSlot - left.profitPerSlot);
}

export function computeNexusOptimalBuild(input: NexusOptimizerInput): NexusOptimizerResult | null {
  const totalSlots = Math.floor(input.infrastructure / 50);
  const military = minimumMilitaryBuild(input);
  const milSlots = Object.values(military).reduce((sum, count) => sum + count, 0);
  if (input.infrastructure <= 0 || input.infrastructure > 4_000 || milSlots > totalSlots) return null;
  const slotLimit = totalSlots;
  const foodConsumed = dailyFoodConsumption(input.infrastructure, input.ageMultiplier);
  let resourceStates: SearchState[] = powerSignatures(input.infrastructure, totalSlots - milSlots).map((power) => {
    const vector = powerVector(power, input.infrastructure);
    vector.food -= foodConsumed;
    const build: Counts = {
      ...military,
      coal_power: power.coal, oil_power: power.oil,
      nuclear_power: power.nuclear, wind_power: power.wind,
    };
    return {
      build, slots: milSlots + Object.values(power).reduce((sum, count) => sum + count, 0),
      pollution: pollutionContribution("coal_power", power.coal, input.projects)
        + pollutionContribution("oil_power", power.oil, input.projects),
      commerce: 0, vector, value: convertedValue(vector, input.prices),
    };
  });
  if (resourceStates.length === 0) return null;

  for (const field of RESOURCE_FIELDS) {
    const cap = isFieldAllowed(field, input.continent)
      ? Math.min(improvementCap(field, input.projects), totalSlots - milSlots)
      : 0;
    const options = Array.from({ length: cap + 1 }, (_, count) => productionOption(field, count, input));
    resourceStates = pruneEconomicStates(combineOptions(resourceStates, options, slotLimit, input.prices));
  }

  let supportStates: SearchState[] = [{
    build: {}, slots: 0, pollution: 0, commerce: 0,
    vector: emptyVector(), value: 0,
  }];
  const commerceCap = maximumCommerce(input.projects);
  for (const field of SUPPORT_FIELDS) {
    const cap = Math.min(improvementCap(field, input.projects), totalSlots);
    const options = Array.from({ length: cap + 1 }, (_, count) => supportOption(field, count, input));
    supportStates = pruneSupportStates(combineOptions(supportStates, options, slotLimit, input.prices, commerceCap));
  }

  resourceStates.sort((left, right) => right.value - left.value || right.vector.money - left.vector.money || buildKey(left.build).localeCompare(buildKey(right.build)));
  supportStates.sort((left, right) => right.value - left.value || right.vector.money - left.vector.money || buildKey(left.build).localeCompare(buildKey(right.build)));
  const civilCache = new Map<string, CivilChoice>();
  let best: { resource: SearchState; support: SearchState; civil: CivilChoice; score: number; money: number; usedSlots: number; key: string } | null = null;

  for (const resource of resourceStates) {
    for (const support of supportStates) {
      const baseSlots = resource.slots + support.slots;
      if (baseSlots > slotLimit) continue;
      if (best && resource.value + support.value + maximumCivilContribution(input, support.commerce) < best.score - 0.000001) continue;
      const capacity = Math.min(
        improvementCap("hospital", input.projects) + improvementCap("police_station", input.projects),
        slotLimit - baseSlots,
      );
      const cacheKey = `${resource.pollution + support.pollution}|${support.commerce}|${capacity}`;
      let civil = civilCache.get(cacheKey);
      if (!civil) {
        civil = civilChoice(input, resource.pollution + support.pollution, support.commerce, capacity);
        civilCache.set(cacheKey, civil);
      }
      const score = resource.value + support.value + civil.contribution;
      const money = resource.vector.money + support.vector.money + civil.contribution;
      const usedSlots = baseSlots + civil.slots;
      const combinedBuild = {
        ...resource.build, ...support.build,
        hospital: civil.hospitals, police_station: civil.policeStations,
      };
      const key = buildKey(combinedBuild);
      const better = !best
        || score > best.score + 0.000001
        || (Math.abs(score - best.score) <= 0.000001 && (money > best.money + 0.000001
          || (Math.abs(money - best.money) <= 0.000001 && (usedSlots < best.usedSlots
            || (usedSlots === best.usedSlots && (civil.pollution < best.civil.pollution
              || (civil.pollution === best.civil.pollution && key < best.key)))))));
      if (better) best = { resource, support, civil, score, money, usedSlots, key };
    }
  }
  if (!best) return null;

  const counts: Counts = {
    ...best.resource.build, ...best.support.build,
    hospital: best.civil.hospitals, police_station: best.civil.policeStations,
  };
  const powerBuild: Record<PowerType, number> = {
    coal: counts.coal_power ?? 0, oil: counts.oil_power ?? 0,
    nuclear: counts.nuclear_power ?? 0, wind: counts.wind_power ?? 0,
  };
  const chosenPowerVector = powerVector(powerBuild, input.infrastructure);
  const entries = buildEntries(input, counts, best.civil.population);
  const dailyPowerCost = -convertedValue(chosenPowerVector, input.prices);
  const dailyFoodConsumptionCost = foodConsumed * (input.prices.food ?? 0);
  const powerSlots = Object.values(powerBuild).reduce((sum, count) => sum + count, 0);
  const civilSlots = (counts.recycling_center ?? 0) + (counts.subway ?? 0)
    + best.civil.hospitals + best.civil.policeStations;
  const availableSlots = totalSlots - powerSlots - milSlots;
  const netProfit = best.civil.income + entries.productionRevenue
    - entries.productionCost - entries.commerceCost - entries.civilCost
    - dailyPowerCost - dailyFoodConsumptionCost;

  return {
    totalSlots, powerSlots, powerBuild,
    powerDescription: describePower(powerBuild),
    powerFuelDescription: describeFuel(chosenPowerVector),
    milSlots, civilSlots, availableSlots, usedSlots: best.usedSlots,
    commercePct: best.civil.commerce,
    dailyCommerce: best.civil.income,
    dailyCommerceNoDiseaseReduction: best.civil.income,
    dailyProduction: entries.productionRevenue,
    dailyFoodProduced: entries.foodProduced,
    dailyFoodConsumed: foodConsumed,
    dailyFoodConsumptionCost,
    dailyPowerCost,
    dailyCommerceCost: entries.commerceCost,
    dailyProductionCost: entries.productionCost,
    dailyMilCost: 0,
    dailyCivilCost: entries.civilCost,
    baseDiseasePct: baseDisease(input.infrastructure, input.land, 0),
    finalDiseasePct: best.civil.disease,
    popMod: best.civil.population / (input.infrastructure * 100),
    hospitalsNeeded: hospitalsToZeroDisease(input.infrastructure, input.land, best.civil.pollution, input.projects.clinicalResearchCenter),
    hospitals: best.civil.hospitals,
    policeStations: best.civil.policeStations,
    totalPollution: best.civil.pollution,
    pollutionDisease: best.civil.pollution * 0.05,
    correctedDiseasePct: best.civil.disease,
    crimePct: best.civil.crime,
    effectivePopMod: best.civil.population / (input.infrastructure * 100),
    population: best.civil.population,
    netProfit,
    unfilledSlots: Math.max(0, totalSlots - best.usedSlots),
    build: entries.entries,
    improvementOptions: improvementOptions(input),
    counts,
  };
}

export function recoverNexusTargetProfile(cities: TargetCityLike[]): NexusTargetProfile {
  if (cities.length === 0) {
    return { targetInfrastructure: 0, availableSlots: 0, citiesBelowTarget: 0, infrastructureShortfall: 0, landUsed: 0 };
  }
  const recovered = cities.map((city) => {
    const improvements = BUILD_ORDER.reduce((sum, field) => {
      const aliases = FIELD_ALIASES[field] ?? [field];
      const value = aliases.map((alias) => Number(city[alias] ?? 0)).find((candidate) => candidate > 0) ?? 0;
      return sum + Math.max(0, value);
    }, 0);
    return Math.max(Number(city.infrastructure ?? 0), improvements * 50);
  });
  const targetInfrastructure = Math.max(0, Math.floor(Math.max(...recovered) / 50) * 50);
  const lands = cities.map((city) => Math.max(0, Number(city.land ?? 0))).sort((a, b) => a - b);
  const landUsed = lands[Math.floor((lands.length - 1) / 2)] ?? 0;
  return {
    targetInfrastructure,
    availableSlots: Math.floor(targetInfrastructure / 50),
    citiesBelowTarget: cities.filter((city) => Number(city.infrastructure ?? 0) < targetInfrastructure).length,
    infrastructureShortfall: cities.reduce((sum, city) => sum + Math.max(0, targetInfrastructure - Number(city.infrastructure ?? 0)), 0),
    landUsed,
  };
}
