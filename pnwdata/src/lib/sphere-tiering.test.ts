import { describe, expect, it } from "vitest";
import { computeSphereTiering } from "./sphere-tiering";

const spheres = [
  { name: "A", alliance_ids: [1, 2] },
  { name: "B", alliance_ids: [3] },
];

describe("computeSphereTiering", () => {
  it("counts nations per sphere and tier, ignoring unassigned alliances", () => {
    const nations = [
      { id: 1, alliance_id: 1, num_cities: 3 },
      { id: 2, alliance_id: 2, num_cities: 5 },
      { id: 3, alliance_id: 3, num_cities: 6 },
      { id: 4, alliance_id: 99, num_cities: 40 },
    ];
    const rows = computeSphereTiering(nations, spheres, 5);
    expect(rows.map((r) => [r.tier, r.counts, r.total])).toEqual([
      ["1-5", [2, 0], 2],
      ["6-10", [0, 1], 1],
    ]);
  });

  it("returns no rows when no nation belongs to a sphere", () => {
    expect(computeSphereTiering([{ id: 1, alliance_id: 99, num_cities: 5 }], spheres, 5)).toEqual([]);
  });
});
