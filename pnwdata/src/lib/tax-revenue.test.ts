import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
testDb.exec(`
  CREATE TABLE tax_bracket_config (
    alliance_id INTEGER NOT NULL,
    bracket_id INTEGER NOT NULL,
    bracket_name TEXT NOT NULL,
    nominal_money_rate INTEGER NOT NULL,
    nominal_resource_rate INTEGER NOT NULL,
    real_money_rate INTEGER NOT NULL,
    real_resource_rate INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, bracket_id)
  );
  CREATE TABLE offshore_alliances (alliance_id INTEGER PRIMARY KEY, alliance_name TEXT);
  CREATE TABLE tax_records (id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE offshore_tax_records (
    alliance_id INTEGER NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (alliance_id, id)
  );
`);

vi.mock("./db", () => ({
  default: testDb,
  readJsonSingleton: vi.fn(() => ({ id: 9000, name: "Main Alliance" })),
}));

const { upsertTaxBrackets, readTaxBracketConfigs, writeTaxBracketRealRates, replaceTaxRecords, readTaxRevenueSummary } = await import("./tax-revenue");

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec("DELETE FROM tax_bracket_config; DELETE FROM tax_records; DELETE FROM offshore_tax_records; DELETE FROM offshore_alliances;");
});

describe("upsertTaxBrackets", () => {
  it("defaults the real rate to the nominal rate on first sync", () => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);

    const [config] = readTaxBracketConfigs();
    expect(config).toMatchObject({
      bracketName: "DirectDeposit100100",
      nominalMoneyRate: 100,
      nominalResourceRate: 100,
      realMoneyRate: 100,
      realResourceRate: 100,
    });
  });

  it("preserves an admin-configured real rate across re-syncs, but still updates the name/nominal rate", () => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    writeTaxBracketRealRates(9000, 30076, 20, 20);

    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100 (renamed)", tax_rate: 100, resource_tax_rate: 100 }], 2000);

    const [config] = readTaxBracketConfigs();
    expect(config).toMatchObject({
      bracketName: "DirectDeposit100100 (renamed)",
      realMoneyRate: 20,
      realResourceRate: 20,
    });
  });
});

describe("writeTaxBracketRealRates", () => {
  beforeEach(() => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
  });

  it("rejects a real rate above the nominal rate", () => {
    expect(() => writeTaxBracketRealRates(9000, 30076, 101, 0)).toThrow(/between 0 and 100/);
  });

  it("rejects a negative real rate", () => {
    expect(() => writeTaxBracketRealRates(9000, 30076, -1, 0)).toThrow(/between 0 and 100/);
  });

  it("rejects an unknown bracket", () => {
    expect(() => writeTaxBracketRealRates(9000, 99999, 10, 10)).toThrow("Unknown tax bracket");
  });
});

describe("readTaxRevenueSummary", () => {
  it("computes real revenue and the safekept remainder from the configured real rate", () => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    writeTaxBracketRealRates(9000, 30076, 20, 20);

    replaceTaxRecords("tax_records", null, [
      { id: 1, date: "2026-01-01", sender_id: 1, tax_id: 30076, money: 1000, steel: 10 },
    ], 1000);

    const { brackets: [bracket] } = readTaxRevenueSummary();
    expect(bracket.actualMoney).toBe(1000);
    expect(bracket.realMoney).toBe(200);
    expect(bracket.safekeptMoney).toBe(800);
    expect(bracket.realResources.steel).toBe(2);
    expect(bracket.actualResources.steel).toBe(10);
  });

  it("tags offshore alliance tax records with their own alliance", () => {
    testDb.prepare("INSERT INTO offshore_alliances (alliance_id, alliance_name) VALUES (?, ?)").run(14242, "Infinity");
    upsertTaxBrackets(14242, [{ id: 777, bracket_name: "Commie", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    replaceTaxRecords("offshore_tax_records", 14242, [
      { id: 2, date: "2026-01-01", sender_id: 2, tax_id: 777, money: 500 },
    ], 1000);

    const { brackets: [bracket] } = readTaxRevenueSummary();
    expect(bracket.allianceId).toBe(14242);
    expect(bracket.allianceName).toBe("Infinity");
    expect(bracket.actualMoney).toBe(500);
    expect(bracket.realMoney).toBe(500); // real rate defaults to nominal (100) until configured
  });
});

describe("readTaxRevenueSummary time windows", () => {
  const NOW = Date.parse("2026-10-01T12:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    writeTaxBracketRealRates(9000, 30076, 20, 20);
  });

  it("sums only records within the last 24 hours for last24h", () => {
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), sender_id: 1, tax_id: 30076, money: 1000 }, // 2h ago
      { id: 2, date: new Date(NOW - 2 * DAY_MS).toISOString(), sender_id: 2, tax_id: 30076, money: 5000 }, // 2d ago, outside 24h
    ], 1000);

    const { last24h } = readTaxRevenueSummary(NOW);
    expect(last24h.actualMoney).toBe(1000);
    expect(last24h.realMoney).toBe(200);
    expect(last24h.safekeptMoney).toBe(800);
  });

  it("averages the last 30 days of collection across 30 days for dailyAverage30d", () => {
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: new Date(NOW - 10 * DAY_MS).toISOString(), sender_id: 1, tax_id: 30076, money: 3000 },
      { id: 2, date: new Date(NOW - 40 * DAY_MS).toISOString(), sender_id: 2, tax_id: 30076, money: 999999 }, // outside 30d window
    ], 1000);

    const { dailyAverage30d } = readTaxRevenueSummary(NOW);
    expect(dailyAverage30d.actualMoney).toBeCloseTo(100); // 3000 / 30
    expect(dailyAverage30d.realMoney).toBeCloseTo(20); // 600 / 30
  });
});
