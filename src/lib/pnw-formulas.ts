/** Disease rate (0–1) before hospitals: max(0, (infra/100)^2 * 0.1 + infra/100 - 25) / 100 */
export function baseDisease(infra: number): number {
  return Math.max(0, (Math.pow(infra / 100, 2) * 0.1 + infra / 100 - 25) / 100);
}

/** Disease rate after hospitals (each hospital removes 2.5 percentage points). */
export function diseaseAfterHospitals(infra: number, hospitals: number): number {
  return Math.max(0, baseDisease(infra) - hospitals * 2.5);
}

/** Hospitals needed to bring disease to 0. */
export function hospitalsToZeroDisease(infra: number): number {
  return Math.ceil(baseDisease(infra) / 2.5);
}

/** City build slots from infrastructure. */
export function slotsFromInfra(infra: number): number {
  return Math.floor(infra / 50);
}