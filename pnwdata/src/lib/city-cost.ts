/**
 * City purchase cost maths (formula in effect since the March 2025 city cost change).
 * Pure, so it is safe to import from client code.
 */

/** Manifest Destiny's base discount; Government Support Agency (+50%) and Bureau of Domestic Affairs (+25%) boost it. */
export const MANIFEST_DESTINY_DISCOUNT = 0.05;
export const GOVERNMENT_SUPPORT_AGENCY_BOOST = 0.5;
export const BUREAU_OF_DOMESTIC_AFFAIRS_BOOST = 0.25;

export interface CityCostModifiers {
  manifestDestiny: boolean;
  governmentSupportAgency: boolean;
  bureauOfDomesticAffairs: boolean;
  /** Cash discount left over from the refund for the retired Urban Planning projects (the API's `cities_discount`). */
  citiesDiscount: number;
}

export const MAX_TARGET_CITIES = 500;

/**
 * Cost of buying city number `cityToBuy` before discounts. `cityAverage` is the game's average city
 * count (the API's `game_info.city_average`), which makes cities cheaper for nations below it.
 */
export function baseCityCost(cityToBuy: number, cityAverage: number): number {
  const x = cityToBuy - cityAverage / 4;
  return Math.max(100_000 * x ** 3 + 150_000 * x + 75_000, cityToBuy ** 2 * 100_000);
}

/** Percentage discount from the domestic policy (0 when it isn't Manifest Destiny). */
export function policyDiscount(mods: CityCostModifiers): number {
  if (!mods.manifestDestiny) return 0;
  return MANIFEST_DESTINY_DISCOUNT
    * (1 + (mods.governmentSupportAgency ? GOVERNMENT_SUPPORT_AGENCY_BOOST : 0)
      + (mods.bureauOfDomesticAffairs ? BUREAU_OF_DOMESTIC_AFFAIRS_BOOST : 0));
}

export interface CityCostRow {
  /** The city number being bought. */
  city: number;
  cost: number;
}

export interface CityCostResult {
  rows: CityCostRow[];
  total: number;
}

const toCents = (n: number) => Math.round(n * 100) / 100;

/**
 * Cost of buying every city from the nation's next one up to and including `targetCities`.
 * Manifest Destiny's percentage comes off first, then any leftover refund discount is used up
 * city by city (a city never costs less than $1).
 */
export function costToReach(
  currentCities: number,
  targetCities: number,
  cityAverage: number,
  mods: CityCostModifiers,
): CityCostResult {
  const rows: CityCostRow[] = [];
  let total = 0;
  let discountLeft = Math.max(0, mods.citiesDiscount);
  const policy = policyDiscount(mods);
  for (let city = currentCities + 1; city <= targetCities; city++) {
    const price = Math.max(1, baseCityCost(city, cityAverage) * (1 - policy));
    const used = Math.min(discountLeft, price - 1);
    discountLeft -= used;
    const cost = toCents(price - used);
    rows.push({ city, cost });
    total += cost;
  }
  return { rows, total: toCents(total) };
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
