/** City purchase cost maths. Pure, so it is safe to import from client code. */

/** Flat per-city discounts from the city cost projects; they stack with each other. */
export const URBAN_PLANNING_DISCOUNT = 50_000_000;
export const ADVANCED_URBAN_PLANNING_DISCOUNT = 100_000_000;
export const METROPOLITAN_PLANNING_DISCOUNT = 150_000_000;

/** Manifest Destiny's percentage discount, and its larger value with the Government Support Agency. */
export const MANIFEST_DESTINY_DISCOUNT = 0.05;
export const MANIFEST_DESTINY_GSA_DISCOUNT = 0.075;

export interface CityCostModifiers {
  urbanPlanning: boolean;
  advancedUrbanPlanning: boolean;
  metropolitanPlanning: boolean;
  manifestDestiny: boolean;
  governmentSupportAgency: boolean;
}

export const MAX_TARGET_CITIES = 500;

/** Cost of the next city before any discounts, given how many cities the nation has now. */
export function baseCityCost(currentCities: number): number {
  return 50_000 * (currentCities - 1) ** 3 + 150_000 * currentCities + 75_000;
}

/** Total flat discount per city from the nation's projects. */
export function flatDiscount(mods: CityCostModifiers): number {
  return (mods.urbanPlanning ? URBAN_PLANNING_DISCOUNT : 0)
    + (mods.advancedUrbanPlanning ? ADVANCED_URBAN_PLANNING_DISCOUNT : 0)
    + (mods.metropolitanPlanning ? METROPOLITAN_PLANNING_DISCOUNT : 0);
}

/** Percentage discount from the domestic policy (0 when it isn't Manifest Destiny). */
export function policyDiscount(mods: CityCostModifiers): number {
  if (!mods.manifestDestiny) return 0;
  return mods.governmentSupportAgency ? MANIFEST_DESTINY_GSA_DISCOUNT : MANIFEST_DESTINY_DISCOUNT;
}

/**
 * Cost of buying one city when the nation currently has `currentCities`.
 * Projects discount first (never below $1), then Manifest Destiny takes its percentage off the result.
 */
export function cityPurchaseCost(currentCities: number, mods: CityCostModifiers): number {
  const afterProjects = Math.max(1, baseCityCost(currentCities) - flatDiscount(mods));
  return Math.max(1, Math.round(afterProjects * (1 - policyDiscount(mods))));
}

export interface CityCostRow {
  /** The city number being bought (current cities + 1 up to the target). */
  city: number;
  cost: number;
}

export interface CityCostResult {
  rows: CityCostRow[];
  total: number;
}

/** Cost of buying every city from the nation's next one up to and including `targetCities`. */
export function costToReach(currentCities: number, targetCities: number, mods: CityCostModifiers): CityCostResult {
  const rows: CityCostRow[] = [];
  let total = 0;
  for (let owned = currentCities; owned < targetCities; owned++) {
    const cost = cityPurchaseCost(owned, mods);
    rows.push({ city: owned + 1, cost });
    total += cost;
  }
  return { rows, total };
}

/** Pulls nation IDs out of free text (commas, spaces, new lines or pasted `id=123` links), without repeats. */
export function parseNationIds(input: string): number[] {
  const ids = new Set<number>();
  for (const match of input.matchAll(/\d+/g)) {
    const id = Number(match[0]);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}
