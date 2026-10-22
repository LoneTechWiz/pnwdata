/**
 * Infrastructure rebuild maths and the tier settings that drive it.
 * Pure, so it is safe to import from client code.
 */

export interface RebuildTier {
  /** Inclusive lower bound of the city range. */
  min_cities: number;
  /** Inclusive upper bound; null means no upper bound. */
  max_cities: number | null;
  start_infra: number;
  target_infra: number;
}

export interface RebuildConfig {
  /** Always the four tiers below 20, 20-29, 30-39 and 40+ cities, in that order. */
  tiers: RebuildTier[];
}

export const REBUILD_TIER_RANGES: ReadonlyArray<{ min_cities: number; max_cities: number | null; label: string }> = [
  { min_cities: 0, max_cities: 19, label: "Below 20 cities" },
  { min_cities: 20, max_cities: 29, label: "20-29 cities" },
  { min_cities: 30, max_cities: 39, label: "30-39 cities" },
  { min_cities: 40, max_cities: null, label: "40+ cities" },
];

export const REBUILD_DEFAULTS: RebuildConfig = {
  tiers: REBUILD_TIER_RANGES.map(({ min_cities, max_cities }) => ({ min_cities, max_cities, start_infra: 0, target_infra: 1500 })),
};

export const MAX_INFRA = 10_000;

/** Infrastructure discounts, as listed by the game's infra calculator: all additive; the Urbanization policy is boosted by the Government Support Agency and Bureau of Domestic Affairs. */
export const INFRA_PROJECT_DISCOUNT = 0.05;
export const URBANIZATION_DISCOUNT = 0.05;
export const GOVERNMENT_SUPPORT_AGENCY_BOOST = 0.5;
export const BUREAU_OF_DOMESTIC_AFFAIRS_BOOST = 0.25;

export interface InfraDiscountSource {
  center_for_civil_engineering?: boolean;
  advanced_engineering_corps?: boolean;
  government_support_agency?: boolean;
  bureau_of_domestic_affairs?: boolean;
  domestic_policy?: string;
}

/** Total fraction taken off infra purchases for a nation (0.1 = 10% off). */
export function infraDiscount(nation: InfraDiscountSource): number {
  const policy = nation.domestic_policy === "URBANIZATION"
    ? URBANIZATION_DISCOUNT
      * (1 + (nation.government_support_agency ? GOVERNMENT_SUPPORT_AGENCY_BOOST : 0)
        + (nation.bureau_of_domestic_affairs ? BUREAU_OF_DOMESTIC_AFFAIRS_BOOST : 0))
    : 0;
  return (nation.center_for_civil_engineering ? INFRA_PROJECT_DISCOUNT : 0)
    + (nation.advanced_engineering_corps ? INFRA_PROJECT_DISCOUNT : 0)
    + policy;
}

/** Price of one infrastructure point at the given level, before discounts (the game rounds it to the cent). */
export function infraUnitCost(level: number): number {
  return Math.round((300 + Math.abs(level - 10) ** 2.2 / 710) * 100) / 100;
}

const INFRA_BLOCK = 100;

/**
 * Undiscounted cost of raising one city from `from` to `to` infrastructure (0 when `to` is not above `from`).
 * Matches the game's infra calculator: the purchase is split into blocks of 100 points, with any
 * leftover block first, and each block costs its size times the unit price at the level it starts from.
 */
export function baseInfraCost(from: number, to: number): number {
  const start = Math.max(0, from);
  if (to <= start) return 0;
  const leftover = (to - start) % INFRA_BLOCK;
  let total = 0;
  let level = start;
  if (leftover > 0) {
    total += leftover * infraUnitCost(level);
    level += leftover;
  }
  for (; level < to; level += INFRA_BLOCK) total += INFRA_BLOCK * infraUnitCost(level);
  return total;
}

export function tierFor(config: RebuildConfig, cities: number): RebuildTier {
  return config.tiers.find((t) => cities >= t.min_cities && (t.max_cities === null || cities <= t.max_cities))
    ?? config.tiers[config.tiers.length - 1];
}

export interface RebuildEstimate {
  tier: RebuildTier;
  discount: number;
  /** Cost per city after discounts. */
  perCity: number;
  total: number;
}

export function estimateRebuild(config: RebuildConfig, nation: InfraDiscountSource & { num_cities: number }): RebuildEstimate {
  const tier = tierFor(config, nation.num_cities);
  const discount = Math.min(infraDiscount(nation), 1);
  const perCity = baseInfraCost(tier.start_infra, tier.target_infra) * (1 - discount);
  return { tier, discount, perCity, total: perCity * nation.num_cities };
}

function wholeInfra(value: unknown): number | null {
  const n = Number(value);
  return value !== "" && value !== null && Number.isInteger(n) && n >= 0 && n <= MAX_INFRA ? n : null;
}

/** Returns a clean config, or an error message describing the first problem. */
export function validateRebuildConfig(value: unknown): { config: RebuildConfig } | { error: string } {
  const raw = value && typeof value === "object" ? (value as { tiers?: unknown }).tiers : null;
  if (!Array.isArray(raw) || raw.length !== REBUILD_TIER_RANGES.length) return { error: "Invalid configuration" };
  const tiers: RebuildTier[] = [];
  for (const [i, range] of REBUILD_TIER_RANGES.entries()) {
    const item = (raw[i] ?? {}) as Record<string, unknown>;
    const start = wholeInfra(item.start_infra);
    const target = wholeInfra(item.target_infra);
    if (start === null) return { error: `${range.label}: starting infra must be a whole number from 0 to ${MAX_INFRA}` };
    if (target === null) return { error: `${range.label}: target infra must be a whole number from 0 to ${MAX_INFRA}` };
    if (target < start) return { error: `${range.label}: target infra can't be below the starting infra` };
    tiers.push({ min_cities: range.min_cities, max_cities: range.max_cities, start_infra: start, target_infra: target });
  }
  return { config: { tiers } };
}
