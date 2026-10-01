import { describe, expect, it } from "vitest";
import {
  attackLootValue,
  avgInfraPerCity,
  beigeAverage,
  recordBeigeLoss,
  warTargetScoreRange,
  type LootAttack,
} from "./war-targets";

const prices = {
  coal: 1,
  oil: 2,
  uranium: 3,
  iron: 4,
  bauxite: 5,
  lead: 6,
  gasoline: 7,
  munitions: 8,
  steel: 9,
  aluminum: 10,
  food: 11,
};

const emptyAttack = (): LootAttack => ({
  money_looted: 0,
  coal_looted: 0,
  oil_looted: 0,
  uranium_looted: 0,
  iron_looted: 0,
  bauxite_looted: 0,
  lead_looted: 0,
  gasoline_looted: 0,
  munitions_looted: 0,
  steel_looted: 0,
  aluminum_looted: 0,
  food_looted: 0,
});

describe("warTargetScoreRange", () => {
  it("computes 75% floor and 4/3 ceiling", () => {
    expect(warTargetScoreRange(1000)).toEqual({ minScore: 750, maxScore: 1334 });
  });
});

describe("attackLootValue", () => {
  it("sums money only when prices are null", () => {
    const attacks = [{ ...emptyAttack(), money_looted: 100 }];
    expect(attackLootValue(attacks, null)).toBe(100);
  });

  it("values resources using trade prices", () => {
    const attacks = [{ ...emptyAttack(), money_looted: 10, coal_looted: 2 }];
    expect(attackLootValue(attacks, prices)).toBe(12);
  });
});

describe("avgInfraPerCity", () => {
  it("returns 0 for no cities", () => {
    expect(avgInfraPerCity([])).toBe(0);
  });

  it("rounds average infrastructure", () => {
    expect(avgInfraPerCity([{ infrastructure: 100 }, { infrastructure: 200 }])).toBe(150);
  });
});

describe("recordBeigeLoss", () => {
  it("records loot when defender loses", () => {
    const map = new Map();
    const targets = new Set([200]);
    recordBeigeLoss(
      map,
      {
        date: "2026-01-01",
        att_id: 100,
        def_id: 200,
        winner_id: 100,
        attacks: [{ ...emptyAttack(), money_looted: 50 }],
      },
      targets,
      null
    );
    expect(map.get(200)).toEqual({ loot: 50, date: "2026-01-01", allLoots: [50] });
  });

  it("ignores wars where target won (did not beige)", () => {
    const map = new Map();
    recordBeigeLoss(
      map,
      {
        date: "2026-01-01",
        att_id: 200,
        def_id: 300,
        winner_id: 200,
        attacks: [{ ...emptyAttack(), money_looted: 50 }],
      },
      new Set([200]),
      null
    );
    expect(map.size).toBe(0);
  });

  it("keeps most recent loss loot on map", () => {
    const map = new Map();
    const targets = new Set([200]);
    recordBeigeLoss(
      map,
      { date: "2026-01-01", att_id: 100, def_id: 200, winner_id: 100, attacks: [{ ...emptyAttack(), money_looted: 10 }] },
      targets,
      null
    );
    recordBeigeLoss(
      map,
      { date: "2026-02-01", att_id: 100, def_id: 200, winner_id: 100, attacks: [{ ...emptyAttack(), money_looted: 99 }] },
      targets,
      null
    );
    expect(map.get(200)?.loot).toBe(99);
    expect(map.get(200)?.allLoots).toEqual([10, 99]);
  });
});

describe("beigeAverage", () => {
  it("rounds mean loot", () => {
    expect(beigeAverage([10, 20, 31])).toBe(20);
  });
});