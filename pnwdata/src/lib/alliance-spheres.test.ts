import { describe, expect, it } from "vitest";
import {
  buildSphereStats,
  DEFAULT_SPHERES_CONFIG,
  MAX_SPHERES,
  validateSpheresConfig,
  type SourceAlliance,
} from "./alliance-spheres";

const a = (id: number, score: number, nations: number): SourceAlliance => ({
  id, name: `A${id}`, acronym: null, score, rank: id, nation_count: nations,
});

describe("validateSpheresConfig", () => {
  it("accepts the default config", () => {
    expect(validateSpheresConfig(DEFAULT_SPHERES_CONFIG)).toEqual({ config: DEFAULT_SPHERES_CONFIG });
  });

  it("trims names and removes repeated ids within a sphere", () => {
    const result = validateSpheresConfig({ spheres: [{ name: "  Blue  ", alliance_ids: [1, "2", 1] }] });
    expect(result).toEqual({ config: { spheres: [{ name: "Blue", alliance_ids: [1, 2] }] } });
  });

  it("rejects an alliance in two spheres", () => {
    const result = validateSpheresConfig({
      spheres: [{ name: "Blue", alliance_ids: [1] }, { name: "Red", alliance_ids: [1] }],
    });
    expect(result).toHaveProperty("error");
  });

  it("rejects duplicate names, blank names and bad counts", () => {
    expect(validateSpheresConfig({ spheres: [{ name: "X", alliance_ids: [] }, { name: "x", alliance_ids: [] }] })).toHaveProperty("error");
    expect(validateSpheresConfig({ spheres: [{ name: " ", alliance_ids: [] }] })).toHaveProperty("error");
    expect(validateSpheresConfig({ spheres: [] })).toHaveProperty("error");
    const tooMany = Array.from({ length: MAX_SPHERES + 1 }, (_, i) => ({ name: `S${i}`, alliance_ids: [] }));
    expect(validateSpheresConfig({ spheres: tooMany })).toHaveProperty("error");
  });

  it("rejects invalid alliance ids and non-objects", () => {
    expect(validateSpheresConfig({ spheres: [{ name: "X", alliance_ids: [0] }] })).toHaveProperty("error");
    expect(validateSpheresConfig({ spheres: [{ name: "X", alliance_ids: ["a"] }] })).toHaveProperty("error");
    expect(validateSpheresConfig({ spheres: [{ name: "X" }] })).toHaveProperty("error");
    expect(validateSpheresConfig(null)).toHaveProperty("error");
  });
});

describe("buildSphereStats", () => {
  const source = [a(1, 600, 60), a(2, 300, 30), a(3, 100, 10)];

  it("totals each sphere and its share of world score", () => {
    const [blue, red] = buildSphereStats(
      { spheres: [{ name: "Blue", alliance_ids: [2, 1] }, { name: "Red", alliance_ids: [3] }] },
      source,
    );
    expect(blue.totalScore).toBe(900);
    expect(blue.totalNations).toBe(90);
    expect(blue.shareOfWorld).toBeCloseTo(0.9);
    expect(blue.avgScorePerNation).toBe(10);
    expect(blue.alliances.map((x) => x.id)).toEqual([1, 2]);
    expect(red.totalScore).toBe(100);
  });

  it("reports configured alliances that no longer exist instead of failing", () => {
    const [sphere] = buildSphereStats({ spheres: [{ name: "Blue", alliance_ids: [1, 99] }] }, source);
    expect(sphere.missingIds).toEqual([99]);
    expect(sphere.totalScore).toBe(600);
  });

  it("handles an empty sphere", () => {
    const [sphere] = buildSphereStats({ spheres: [{ name: "Empty", alliance_ids: [] }] }, source);
    expect(sphere).toMatchObject({ totalScore: 0, totalNations: 0, shareOfWorld: 0, avgScorePerNation: 0 });
  });
});
