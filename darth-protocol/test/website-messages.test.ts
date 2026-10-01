import assert from "node:assert/strict";
import { test } from "node:test";
import type { StockpileAlert, WarTarget } from "../src/pnwdata.js";
import { formatStockpileAlert, sortWarTargets } from "../src/website-messages.js";

function alert(overrides: Partial<StockpileAlert> = {}): StockpileAlert {
  return {
    id: 1,
    nation_id: 10,
    nation_name: "Fixture Nation",
    discord_username: "fixture",
    discord_id: "20",
    resource: "money",
    amount: 3_500_000,
    num_cities: 2,
    threshold: 1_000_000,
    created_at: 1,
    ...overrides,
  };
}

function target(id: number, avgInfra: number, soldiers: number, beigeAverage: number | null): WarTarget {
  return {
    id,
    nation_name: `Nation ${id}`,
    leader_name: `Leader ${id}`,
    alliance_name: "Fixture Alliance",
    score: 1_000,
    num_cities: 10,
    avg_infra: avgInfra,
    soldiers,
    aircraft: 100,
    defensive_wars_count: 0,
    beige_avg: beigeAverage,
  };
}

test("stockpile messages preserve flat uranium limits and per-city resource limits", () => {
  const message = formatStockpileAlert([
    alert(),
    alert({ id: 2, resource: "steel", amount: 5_000, threshold: 2_000 }),
    alert({ id: 3, resource: "uranium", amount: 3_000, threshold: 2_500 }),
  ]);
  assert.match(message, /Cash.*limit \$2,000,000.*\$1,500,000 over/);
  assert.match(message, /Steel.*limit 4,000.*1,000 over/);
  assert.match(message, /Uranium.*limit 2,500.*500 over/);
});

test("website targets retain the legacy ranking choices", () => {
  const targets = [target(1, 2_000, 100_000, 1_000), target(2, 3_000, 200_000, null), target(3, 1_000, 50_000, 5_000)];
  assert.deepEqual(sortWarTargets(targets, "infra").map((value) => value.id), [2, 1, 3]);
  assert.deepEqual(sortWarTargets(targets, "soldiers").map((value) => value.id), [3, 1, 2]);
  assert.deepEqual(sortWarTargets(targets, "loot").map((value) => value.id), [3, 1, 2]);
});
