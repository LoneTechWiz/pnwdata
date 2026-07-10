export interface TieringNation {
  id: number;
  alliance_id: number;
  num_cities: number;
}

export interface GroupTieringRow {
  tier: string;
  min: number;
  groupA: number;
  groupB: number;
  total: number;
}

function tierMin(numCities: number, bucketSize: number): number {
  return Math.floor((numCities - 1) / bucketSize) * bucketSize + 1;
}

export function tierLabel(numCities: number, bucketSize: number): string {
  const min = tierMin(numCities, bucketSize);
  if (bucketSize === 1) return String(min);
  return `${min}-${min + bucketSize - 1}`;
}

export function parseAllianceIds(input: string): number[] {
  const seen = new Set<number>();
  for (const part of input.split(",")) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0) seen.add(id);
  }
  return [...seen];
}

export function computeGroupTiering(
  nations: TieringNation[],
  groupAIds: number[],
  groupBIds: number[],
  bucketSize: number
): GroupTieringRow[] {
  const aSet = new Set(groupAIds);
  const bSet = new Set(groupBIds);
  const relevant = nations.filter(n => aSet.has(n.alliance_id) || bSet.has(n.alliance_id));
  if (relevant.length === 0) return [];

  const maxCities = Math.max(...relevant.map(n => n.num_cities));
  const rowByMin = new Map<number, GroupTieringRow>();
  for (let min = 1; min <= maxCities; min += bucketSize) {
    rowByMin.set(min, { tier: tierLabel(min, bucketSize), min, groupA: 0, groupB: 0, total: 0 });
  }

  for (const n of relevant) {
    const row = rowByMin.get(tierMin(n.num_cities, bucketSize));
    if (!row) continue;
    if (aSet.has(n.alliance_id)) row.groupA += 1;
    if (bSet.has(n.alliance_id)) row.groupB += 1;
    row.total += 1;
  }

  return [...rowByMin.values()].sort((a, b) => a.min - b.min);
}
