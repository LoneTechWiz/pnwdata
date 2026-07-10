import { describe, expect, it } from "vitest";
import type { Nation } from "@/lib/pnw";
import { applyFilter, defaultOp, FIELD_MAP, opsForField } from "./fieldDefs";

function nation(overrides: Partial<Nation> = {}): Nation {
  return {
    id: 1,
    nation_name: "Testland",
    leader_name: "Leader",
    discord: "",
    score: 1000,
    num_cities: 5,
    color: "blue",
    last_active: "2026-01-01",
    soldiers: 100,
    tanks: 10,
    aircraft: 2,
    ships: 1,
    missiles: 0,
    nukes: 0,
    vacation_mode_turns: 0,
    beige_turns: 0,
    alliance_position: "MEMBER",
    war_policy: "ATTRITION",
    domestic_policy: "MANIFEST_DESTINY",
    offensive_wars_count: 1,
    defensive_wars_count: 0,
    ...overrides,
  };
}

describe("applyFilter", () => {
  it("passes when filter value is empty", () => {
    expect(applyFilter(nation(), { id: "1", field: "score", op: ">=", value: "   " })).toBe(true);
  });

  it("filters numeric fields", () => {
    const n = nation({ score: 1500 });
    expect(applyFilter(n, { id: "1", field: "score", op: ">=", value: "1000" })).toBe(true);
    expect(applyFilter(n, { id: "1", field: "score", op: "<", value: "1000" })).toBe(false);
  });

  it("filters string fields case-insensitively", () => {
    const n = nation({ nation_name: "Alpha Republic" });
    expect(applyFilter(n, { id: "1", field: "nation_name", op: "contains", value: "alpha" })).toBe(true);
    expect(applyFilter(n, { id: "1", field: "nation_name", op: "starts with", value: "beta" })).toBe(false);
  });

  it("filters enum fields", () => {
    const n = nation({ alliance_position: "HEIR" });
    expect(applyFilter(n, { id: "1", field: "alliance_position", op: "=", value: "HEIR" })).toBe(true);
    expect(applyFilter(n, { id: "1", field: "alliance_position", op: "!=", value: "MEMBER" })).toBe(true);
  });
});

describe("defaultOp", () => {
  it("uses >= for numbers and contains for strings", () => {
    expect(defaultOp(FIELD_MAP.score)).toBe(">=");
    expect(defaultOp(FIELD_MAP.nation_name)).toBe("contains");
  });
});

describe("opsForField", () => {
  it("returns appropriate operators per type", () => {
    expect(opsForField(FIELD_MAP.score)).toContain(">=");
    expect(opsForField(FIELD_MAP.alliance_position)).toEqual(["=", "!="]);
    expect(opsForField(FIELD_MAP.nation_name)).toContain("contains");
  });
});