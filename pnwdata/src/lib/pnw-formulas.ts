export interface PopulationInputs {
  infrastructure: number;
  land: number;
  pollution: number;
  hospitals: number;
  policeStations: number;
  commerce: number;
  ageMultiplier?: number;
  clinicalResearchCenter?: boolean;
  specializedPoliceTraining?: boolean;
}

/** City build slots from infrastructure. */
export function slotsFromInfra(infrastructure: number): number {
  return Math.floor(infrastructure / 50);
}

/**
 * Disease before hospitals, expressed in percentage points.
 * Population density uses base population, not displayed population.
 */
export function baseDisease(
  infrastructure: number,
  land: number,
  pollution = 0,
): number {
  const basePopulation = infrastructure * 100;
  const density = basePopulation / (land + 0.001);
  return (((density ** 2) * 0.01 - 25) / 100)
    + infrastructure / 1000
    + pollution * 0.05;
}

/** Disease after hospitals, expressed in percentage points. */
export function diseaseAfterHospitals(
  infrastructure: number,
  land: number,
  pollution: number,
  hospitals: number,
  clinicalResearchCenter = false,
): number {
  const reduction = clinicalResearchCenter ? 3.5 : 2.5;
  return baseDisease(infrastructure, land, pollution) - hospitals * reduction;
}

/** Hospitals needed to bring disease to 0 for a given city configuration. */
export function hospitalsToZeroDisease(
  infrastructure: number,
  land: number,
  pollution = 0,
  clinicalResearchCenter = false,
): number {
  const reduction = clinicalResearchCenter ? 3.5 : 2.5;
  return Math.max(0, Math.ceil(baseDisease(infrastructure, land, pollution) / reduction));
}

/** Crime before the game clamps it to 0-100, expressed in percentage points. */
export function crimeRate(
  infrastructure: number,
  commerce: number,
  policeStations: number,
  specializedPoliceTraining = false,
): number {
  const policeReduction = specializedPoliceTraining ? 3.5 : 2.5;
  return (((103 - commerce) ** 2) + infrastructure * 100) / 111_111
    - policeStations * policeReduction;
}

/** Population bonus for city age. City age is measured in real-world days. */
export function cityAgeMultiplier(cityDate: string | Date, now = new Date()): number {
  const created = cityDate instanceof Date ? cityDate : new Date(`${cityDate}T00:00:00Z`);
  const days = Math.max(1, (now.getTime() - created.getTime()) / 86_400_000);
  return 1 + Math.log(days) / 15;
}

export function averageCityAgeMultiplier(
  cityDates: Array<string | Date>,
  now = new Date(),
): number {
  if (cityDates.length === 0) return 1;
  return cityDates.reduce((sum, date) => sum + cityAgeMultiplier(date, now), 0) / cityDates.length;
}

/** Population after disease, crime, and the age bonus. */
export function cityPopulation(inputs: PopulationInputs): {
  population: number;
  disease: number;
  crime: number;
} {
  const basePopulation = inputs.infrastructure * 100;
  const disease = diseaseAfterHospitals(
    inputs.infrastructure,
    inputs.land,
    inputs.pollution,
    inputs.hospitals,
    inputs.clinicalResearchCenter,
  );
  const crime = crimeRate(
    inputs.infrastructure,
    inputs.commerce,
    inputs.policeStations,
    inputs.specializedPoliceTraining,
  );
  const effectiveDisease = Math.min(100, Math.max(0, disease));
  const effectiveCrime = Math.min(100, Math.max(0, crime));
  const diseaseDeaths = (effectiveDisease / 100) * basePopulation;
  const crimeDeaths = Math.max((effectiveCrime / 10) * basePopulation - 25, 0);
  const population = Math.max(10, basePopulation - diseaseDeaths - crimeDeaths)
    * (inputs.ageMultiplier ?? 1);

  return { population, disease, crime };
}

/** Daily city income. The underlying P&W formula is already per day. */
export function commerceIncome(
  population: number,
  commerce: number,
  grossIncomeMultiplier = 1,
): number {
  const averageIncome = (commerce / 50) * 0.725 + 0.725;
  return averageIncome * population * grossIncomeMultiplier;
}

export function openMarketsMultiplier(
  hasGovernmentSupportAgency: boolean,
  hasBureauOfDomesticAffairs: boolean,
): number {
  if (hasGovernmentSupportAgency && hasBureauOfDomesticAffairs) return 1.0175;
  if (hasGovernmentSupportAgency) return 1.015;
  return 1.01;
}

/** P&W production specialization reaches +50% at the improvement cap. */
export function specializationMultiplier(count: number, max: number): number {
  if (count <= 1 || max <= 1) return 1;
  return 1 + (0.5 * (count - 1)) / (max - 1);
}

export function seasonalFoodMultiplier(gameDate?: string | null): number {
  if (!gameDate) return 1;
  const month = new Date(gameDate).getUTCMonth();
  if (month === 11 || month <= 1) return 0.8;
  if (month >= 5 && month <= 7) return 1.2;
  return 1;
}

/** Radiation index is the combined global + continent index, in Roentgens. */
export function radiationFoodMultiplier(
  radiationIndex: number,
  hasFalloutShelter = false,
): number {
  const minimum = hasFalloutShelter ? 0.15 : 0;
  return Math.max(minimum, 1 - radiationIndex / 1000);
}

export function dailyFoodProduction(
  farms: number,
  land: number,
  hasMassIrrigation: boolean,
  seasonMultiplier: number,
  radiationMultiplier: number,
): number {
  if (farms <= 0) return 0;
  const perFarmPerTurn = land / (hasMassIrrigation ? 400 : 500);
  return farms
    * perFarmPerTurn
    * specializationMultiplier(farms, 20)
    * 12
    * seasonMultiplier
    * radiationMultiplier;
}

/** Civilian food consumption per day. Military food upkeep is intentionally separate. */
export function dailyCivilianFoodUsage(population: number): number {
  return population / 500;
}

/** Nuclear fuel usage scales with powered infrastructure, not plant count. */
export function dailyNuclearUraniumUsage(infrastructure: number): number {
  return (infrastructure / 1000) * 3;
}
