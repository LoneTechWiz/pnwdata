import { describe, expect, it } from "vitest";
import { sortRaidTargets, type RaidSortableTarget } from "./raid-sort";

function target(
  id: number,
  nationLoot: number | null,
  allianceLoot: number | null,
): RaidSortableTarget {
  return {
    id,
    nationName: `Nation ${id}`,
    estimatedNationLoot: nationLoot,
    estimatedAllianceLoot: allianceLoot,
    inactiveDays: id,
    score: id * 100,
    cities: id,
    revenueSinceBeige: id * 10,
    bankNetSinceBeige: id * -5,
    aircraft: id * 20,
    defensiveWars: id % 3,
  };
}

describe("sortRaidTargets", () => {
  const targets = [target(1, 500, 50), target(2, 200, 900), target(3, null, null)];

  it("sorts nation and alliance loot independently", () => {
    expect(sortRaidTargets(targets, "estimatedNationLoot", "desc").map(({ id }) => id))
      .toEqual([1, 2, 3]);
    expect(sortRaidTargets(targets, "estimatedAllianceLoot", "desc").map(({ id }) => id))
      .toEqual([2, 1, 3]);
  });

  it("supports ascending and descending order", () => {
    expect(sortRaidTargets(targets, "score", "asc").map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(sortRaidTargets(targets, "score", "desc").map(({ id }) => id)).toEqual([3, 2, 1]);
  });

  it("keeps missing values last in either direction", () => {
    expect(sortRaidTargets(targets, "estimatedNationLoot", "asc").map(({ id }) => id))
      .toEqual([2, 1, 3]);
    expect(sortRaidTargets(targets, "estimatedNationLoot", "desc").map(({ id }) => id))
      .toEqual([1, 2, 3]);
  });
});
