import { tierLabel, tierMin, type TieringNation } from "./tiering";
import type { SphereConfig } from "./alliance-spheres";

export interface SphereTieringRow {
  tier: string;
  min: number;
  /** Nation count per sphere, in the same order as the configured spheres. */
  counts: number[];
  total: number;
}

/** Counts each sphere's nations per city-count tier. Alliances outside every sphere are ignored. */
export function computeSphereTiering(
  nations: TieringNation[],
  spheres: SphereConfig[],
  bucketSize: number,
): SphereTieringRow[] {
  const sphereByAlliance = new Map<number, number>();
  spheres.forEach((sphere, index) => {
    for (const id of sphere.alliance_ids) sphereByAlliance.set(id, index);
  });
  const relevant = nations.filter((n) => sphereByAlliance.has(n.alliance_id));
  if (relevant.length === 0) return [];

  const maxCities = Math.max(...relevant.map((n) => n.num_cities));
  const rowByMin = new Map<number, SphereTieringRow>();
  for (let min = 1; min <= maxCities; min += bucketSize) {
    rowByMin.set(min, { tier: tierLabel(min, bucketSize), min, counts: spheres.map(() => 0), total: 0 });
  }
  for (const n of relevant) {
    const row = rowByMin.get(tierMin(n.num_cities, bucketSize));
    if (!row) continue;
    row.counts[sphereByAlliance.get(n.alliance_id)!] += 1;
    row.total += 1;
  }
  return [...rowByMin.values()].sort((a, b) => a.min - b.min);
}
