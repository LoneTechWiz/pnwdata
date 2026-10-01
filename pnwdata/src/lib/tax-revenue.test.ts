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

let tradePrices: Record<string, number> | null = { steel: 2, coal: 3 };

vi.mock("./db", () => ({
  default: testDb,
  readJsonSingleton: vi.fn((key: string) => {
    if (key === "trade_prices") return tradePrices;
    return { id: 9000, name: "Main Alliance" };
  }),
}));

const {
  upsertTaxBrackets, readTaxBracketConfigs, writeTaxBracketRealRates, replaceTaxRecords,
  readTaxRevenueSummary, readTaxRecordDetails,
} = await import("./tax-revenue");

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec("DELETE FROM tax_bracket_config; DELETE FROM tax_records; DELETE FROM offshore_tax_records; DELETE FROM offshore_alliances;");
  tradePrices = { steel: 2, coal: 3 };
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

  it("scopes each bracket's own actual/real/safekept/recordCount to the last 24 hours", () => {
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), sender_id: 1, tax_id: 30076, money: 1000 }, // within 24h
      { id: 2, date: new Date(NOW - 2 * DAY_MS).toISOString(), sender_id: 2, tax_id: 30076, money: 5000 }, // outside 24h, still all-time
    ], 1000);

    const { brackets: [bracket] } = readTaxRevenueSummary(NOW);
    expect(bracket.actualMoney).toBe(6000); // all-time unaffected
    expect(bracket.actualMoney24h).toBe(1000);
    expect(bracket.realMoney24h).toBe(200);
    expect(bracket.safekeptMoney24h).toBe(800);
    expect(bracket.recordCount24h).toBe(1);
    expect(bracket.recordCount).toBe(2);
  });
});

describe("resource value priced at sync time", () => {
  const NOW = Date.parse("2026-10-01T12:00:00Z");

  beforeEach(() => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    writeTaxBracketRealRates(9000, 30076, 20, 20);
  });

  it("stamps resource_value_usd using the trade price current when the record is stored", () => {
    tradePrices = { steel: 5 };
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: "2026-01-01", sender_id: 1, tax_id: 30076, money: 0, steel: 10 },
    ], 1000);

    const row = testDb.prepare("SELECT data FROM tax_records WHERE id = 1").get() as { data: string };
    expect(JSON.parse(row.data).resource_value_usd).toBe(50); // 10 steel * $5
  });

  it("does not recompute resource_value_usd against a later (different) trade price", () => {
    tradePrices = { steel: 5 };
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: "2026-01-01", sender_id: 1, tax_id: 30076, money: 0, steel: 10 },
    ], 1000);

    tradePrices = { steel: 999 }; // price moves after the record was synced
    const { brackets: [bracket] } = readTaxRevenueSummary(NOW);
    expect(bracket.actualResourceValueUsd).toBe(50); // still priced at the original $5
  });

  it("folds resource value into real/safekept figures using the bracket's resource ratio", () => {
    tradePrices = { steel: 10 };
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: new Date(NOW - 60 * 60 * 1000).toISOString(), sender_id: 1, tax_id: 30076, money: 1000, steel: 10 },
    ], 1000);

    const { brackets: [bracket], last24h } = readTaxRevenueSummary(NOW);
    expect(bracket.actualResourceValueUsd).toBe(100); // 10 steel * $10
    expect(bracket.realResourceValueUsd).toBe(20); // 20% real resource rate
    expect(bracket.safekeptResourceValueUsd).toBe(80);
    expect(bracket.actualTotalUsd).toBe(1100); // 1000 money + 100 resource value
    expect(bracket.realTotalUsd).toBe(220); // 200 real money + 20 real resource value
    expect(bracket.actualTotalUsd24h).toBe(1100);
    expect(last24h.actualTotalUsd).toBe(1100);
    expect(last24h.realTotalUsd).toBe(220);
  });
});

describe("readTaxRecordDetails", () => {
  const NOW = Date.parse("2026-10-01T12:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    upsertTaxBrackets(9000, [{ id: 30076, bracket_name: "DirectDeposit100100", tax_rate: 100, resource_tax_rate: 100 }], 1000);
    writeTaxBracketRealRates(9000, 30076, 20, 20);
  });

  it("returns one row per nation payment within the window, with real/safekept split and sender name", () => {
    tradePrices = { steel: 10 };
    replaceTaxRecords("tax_records", null, [
      {
        id: 1, date: new Date(NOW - 60 * 60 * 1000).toISOString(), sender_id: 526341, tax_id: 30076,
        money: 1000, steel: 10, sender: { nation_name: "Ironwood" },
      },
      { id: 2, date: new Date(NOW - 2 * DAY_MS).toISOString(), sender_id: 2, tax_id: 30076, money: 5000 }, // outside 24h window
    ], 1000);

    const details = readTaxRecordDetails(DAY_MS, NOW);
    expect(details).toHaveLength(1);
    const [row] = details;
    expect(row.senderId).toBe(526341);
    expect(row.senderName).toBe("Ironwood");
    expect(row.allianceName).toBe("Main Alliance");
    expect(row.bracketName).toBe("DirectDeposit100100");
    expect(row.actualMoney).toBe(1000);
    expect(row.realMoney).toBe(200);
    expect(row.actualResourceValueUsd).toBe(100);
    expect(row.realResourceValueUsd).toBe(20);
    expect(row.actualTotalUsd).toBe(1100);
    expect(row.resources.steel).toBe(10);
  });

  it("falls back to a placeholder sender name when P&W didn't include one", () => {
    replaceTaxRecords("tax_records", null, [
      { id: 1, date: new Date(NOW - 60 * 60 * 1000).toISOString(), sender_id: 777, tax_id: 30076, money: 100 },
    ], 1000);

    const [row] = readTaxRecordDetails(DAY_MS, NOW);
    expect(row.senderName).toBe("Nation #777");
  });
});
