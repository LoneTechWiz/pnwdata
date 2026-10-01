import { describe, expect, it, vi } from "vitest";

const mainNation = { id: 1, nation_name: "Home Nation" };
const mainWar = { id: 100, nation_name: "shared" };
const mainRec = { id: 200, amount: 1 };
const mainMeta = { id: 9000, name: "Main Alliance" };

const offshoreAlliances = [{ alliance_id: 14242, alliance_name: "Infinity" }];
const offshoreNationRow = { alliance_id: 14242, data: JSON.stringify({ id: 2, nation_name: "Offshore Nation" }) };
const offshoreWarRow = { data: JSON.stringify({ id: 101, nation_name: "offshore-only" }) };
const sharedWarRow = { data: JSON.stringify(mainWar) }; // same id as a main war, should de-dupe
const offshoreRecRow = { alliance_id: 14242, data: JSON.stringify({ id: 201, amount: 2 }) };

vi.mock("./db", () => ({
  default: {
    prepare: (sql: string) => ({
      all: () => {
        if (sql.includes("FROM offshore_alliances")) return offshoreAlliances;
        if (sql.includes("FROM offshore_nations")) return [offshoreNationRow];
        if (sql.includes("FROM offshore_wars")) return [offshoreWarRow, sharedWarRow];
        if (sql.includes("FROM offshore_bankrecs")) return [offshoreRecRow];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    }),
  },
  readJsonRows: vi.fn((table: string) => {
    if (table === "nations") return [mainNation];
    if (table === "wars") return [mainWar];
    if (table === "bankrecs") return [mainRec];
    return [];
  }),
  readJsonSingleton: vi.fn(() => mainMeta),
}));

const { readAllNations, readAllWars, readAllBankrecs } = await import("./merged-data");

describe("readAllNations", () => {
  it("tags main-alliance and offshore nations with their alliance, and includes both", () => {
    const result = readAllNations();
    expect(result).toEqual([
      { ...mainNation, alliance_id: 9000, alliance_name: "Main Alliance" },
      { id: 2, nation_name: "Offshore Nation", alliance_id: 14242, alliance_name: "Infinity" },
    ]);
  });
});

describe("readAllWars", () => {
  it("merges offshore wars and de-duplicates by war id", () => {
    const result = readAllWars();
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.id).sort()).toEqual([100, 101]);
  });
});

describe("readAllBankrecs", () => {
  it("tags main-alliance and offshore bank records with their alliance", () => {
    const result = readAllBankrecs();
    expect(result).toEqual([
      { ...mainRec, alliance_id: 9000, alliance_name: "Main Alliance" },
      { id: 201, amount: 2, alliance_id: 14242, alliance_name: "Infinity" },
    ]);
  });
});
