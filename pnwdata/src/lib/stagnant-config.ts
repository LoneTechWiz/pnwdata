/** Default filters for the Stagnant Cities page. Safe to import from client code. */
export interface StagnantCitiesConfig {
  min_turns: number;
  /** null means no limit. */
  min_cities: number | null;
  max_cities: number | null;
  tax_ids: number[];
  /** City counts left out of the list even when they fall inside the min/max range. */
  excluded_cities: number[];
}

export const STAGNANT_DEFAULTS: StagnantCitiesConfig = {
  min_turns: 120,
  min_cities: 20,
  max_cities: 39,
  tax_ids: [72, 27151, 28508, 29989, 29990, 30037, 30065, 30066, 30076],
  excluded_cities: [],
};

const MAX_TURNS = 100_000;
const MAX_CITIES = 1_000;
const MAX_LIST = 200;

function wholeNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function wholeNumberList(value: unknown, min: number, max: number): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_LIST) return null;
  const numbers = value.map((item) => wholeNumber(item, min, max));
  if (numbers.some((n) => n === null)) return null;
  return [...new Set(numbers as number[])].sort((a, b) => a - b);
}

function optionalCityLimit(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const n = wholeNumber(value, 0, MAX_CITIES);
  return n === null ? undefined : n;
}

/** Returns a clean config, or an error message describing the first problem. */
export function validateStagnantConfig(value: unknown): { config: StagnantCitiesConfig } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Invalid configuration" };
  const raw = value as Record<string, unknown>;

  const minTurns = wholeNumber(raw.min_turns, 0, MAX_TURNS);
  if (minTurns === null) return { error: `Minimum turns must be a whole number from 0 to ${MAX_TURNS}` };

  const minCities = optionalCityLimit(raw.min_cities);
  const maxCities = optionalCityLimit(raw.max_cities);
  if (minCities === undefined) return { error: `Minimum cities must be blank or a whole number from 0 to ${MAX_CITIES}` };
  if (maxCities === undefined) return { error: `Maximum cities must be blank or a whole number from 0 to ${MAX_CITIES}` };
  if (minCities !== null && maxCities !== null && minCities > maxCities) {
    return { error: "Minimum cities can't be greater than maximum cities" };
  }

  const taxIds = wholeNumberList(raw.tax_ids, 1, Number.MAX_SAFE_INTEGER);
  if (!taxIds) return { error: `Tax IDs must be a list of up to ${MAX_LIST} positive whole numbers` };

  const excluded = wholeNumberList(raw.excluded_cities, 0, MAX_CITIES);
  if (!excluded) return { error: `Excluded cities must be a list of up to ${MAX_LIST} whole numbers from 0 to ${MAX_CITIES}` };

  return {
    config: { min_turns: minTurns, min_cities: minCities, max_cities: maxCities, tax_ids: taxIds, excluded_cities: excluded },
  };
}

/** Parses "72, 27151 28508" style input into numbers; returns null if any token isn't a whole number. */
export function parseNumberList(text: string): number[] | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const numbers = tokens.map(Number);
  return numbers.every((n) => Number.isInteger(n)) ? numbers : null;
}
