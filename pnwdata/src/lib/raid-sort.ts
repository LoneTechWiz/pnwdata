export const RAID_SORT_OPTIONS = [
  { value: "estimatedNationLoot", label: "Nation loot" },
  { value: "estimatedAllianceLoot", label: "Alliance loot" },
  { value: "inactiveDays", label: "Inactive days" },
  { value: "nationName", label: "Nation name" },
  { value: "score", label: "Score" },
  { value: "cities", label: "Cities" },
  { value: "revenueSinceBeige", label: "Revenue since beige" },
  { value: "bankNetSinceBeige", label: "Visible bank net" },
  { value: "aircraft", label: "Aircraft" },
  { value: "defensiveWars", label: "Defensive slots" },
] as const;

export type RaidSortKey = (typeof RAID_SORT_OPTIONS)[number]["value"];
export type RaidSortDirection = "asc" | "desc";

export interface RaidSortableTarget {
  id: number;
  nationName: string;
  estimatedNationLoot: number | null;
  estimatedAllianceLoot: number | null;
  inactiveDays: number;
  score: number;
  cities: number;
  revenueSinceBeige: number | null;
  bankNetSinceBeige: number;
  aircraft: number;
  defensiveWars: number;
}

function compareValues(
  left: number | string | null,
  right: number | string | null,
  direction: RaidSortDirection,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const result = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right, undefined, { sensitivity: "base" })
    : Number(left) - Number(right);
  return direction === "asc" ? result : -result;
}

export function sortRaidTargets<T extends RaidSortableTarget>(
  targets: T[],
  key: RaidSortKey,
  direction: RaidSortDirection,
): T[] {
  return [...targets].sort((left, right) =>
    compareValues(left[key], right[key], direction)
    || right.inactiveDays - left.inactiveDays
    || left.id - right.id
  );
}
