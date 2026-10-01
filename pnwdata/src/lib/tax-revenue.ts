import db, { readJsonSingleton } from "./db";

export const RESOURCE_KEYS = ["coal", "oil", "uranium", "iron", "bauxite", "lead", "gasoline", "munitions", "steel", "aluminum", "food"] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export interface RawTaxBracket {
  id: string | number;
  bracket_name: string;
  tax_rate: number;
  resource_tax_rate: number;
}

export interface RawTaxRecord {
  id: string | number;
  date: string;
  sender_id: string | number;
  tax_id: string | number;
  money: number;
  sender?: { nation_name: string } | null;
  [resource: string]: unknown;
}

export interface TaxBracketConfig {
  allianceId: number;
  allianceName: string;
  bracketId: number;
  bracketName: string;
  nominalMoneyRate: number;
  nominalResourceRate: number;
  realMoneyRate: number;
  realResourceRate: number;
  updatedAt: number;
}

interface TaxBracketConfigRow {
  alliance_id: number;
  bracket_id: number;
  bracket_name: string;
  nominal_money_rate: number;
  nominal_resource_rate: number;
  real_money_rate: number;
  real_resource_rate: number;
  updated_at: number;
}

export interface BracketRevenue {
  allianceId: number;
  allianceName: string;
  bracketId: number;
  bracketName: string;
  nominalMoneyRate: number;
  nominalResourceRate: number;
  realMoneyRate: number;
  realResourceRate: number;
  actualMoney: number;
  realMoney: number;
  safekeptMoney: number;
  actualResources: Record<ResourceKey, number>;
  realResources: Record<ResourceKey, number>;
  recordCount: number;
}

function emptyResourceTotals(): Record<ResourceKey, number> {
  return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])) as Record<ResourceKey, number>;
}

function allianceNames(): Map<number, string> {
  const names = new Map<number, string>();
  const main = readJsonSingleton<{ id: number; name: string }>("alliance_meta");
  if (main) names.set(main.id, main.name);
  const offshore = db.prepare("SELECT alliance_id, alliance_name FROM offshore_alliances").all() as Array<{ alliance_id: number; alliance_name: string }>;
  for (const row of offshore) names.set(row.alliance_id, row.alliance_name);
  return names;
}

/** Upserts bracket definitions synced from P&W. Preserves any admin-configured real rate already on file. */
export function upsertTaxBrackets(allianceId: number, brackets: RawTaxBracket[], now: number): void {
  const insert = db.prepare(`
    INSERT INTO tax_bracket_config
      (alliance_id, bracket_id, bracket_name, nominal_money_rate, nominal_resource_rate, real_money_rate, real_resource_rate, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(alliance_id, bracket_id) DO UPDATE SET
      bracket_name = excluded.bracket_name,
      nominal_money_rate = excluded.nominal_money_rate,
      nominal_resource_rate = excluded.nominal_resource_rate
  `);
  db.transaction(() => {
    for (const bracket of brackets) {
      const moneyRate = Number(bracket.tax_rate) || 0;
      const resourceRate = Number(bracket.resource_tax_rate) || 0;
      insert.run(allianceId, Number(bracket.id), bracket.bracket_name, moneyRate, resourceRate, moneyRate, resourceRate, now);
    }
  })();
}

export function replaceTaxRecords(table: "tax_records" | "offshore_tax_records", allianceId: number | null, records: RawTaxRecord[], now: number): void {
  if (table === "tax_records") {
    const insert = db.prepare("INSERT OR REPLACE INTO tax_records (id, data, updated_at) VALUES (?, ?, ?)");
    db.transaction(() => {
      for (const record of records) insert.run(Number(record.id), JSON.stringify(record), now);
    })();
  } else {
    const insert = db.prepare("INSERT OR REPLACE INTO offshore_tax_records (alliance_id, id, data, updated_at) VALUES (?, ?, ?, ?)");
    db.transaction(() => {
      for (const record of records) insert.run(allianceId, Number(record.id), JSON.stringify(record), now);
    })();
  }
}

export function readTaxBracketConfigs(): TaxBracketConfig[] {
  const names = allianceNames();
  const rows = db.prepare("SELECT * FROM tax_bracket_config ORDER BY alliance_id, bracket_id").all() as TaxBracketConfigRow[];
  return rows.map((row) => ({
    allianceId: row.alliance_id,
    allianceName: names.get(row.alliance_id) ?? `Alliance #${row.alliance_id}`,
    bracketId: row.bracket_id,
    bracketName: row.bracket_name,
    nominalMoneyRate: row.nominal_money_rate,
    nominalResourceRate: row.nominal_resource_rate,
    realMoneyRate: row.real_money_rate,
    realResourceRate: row.real_resource_rate,
    updatedAt: row.updated_at,
  }));
}

export function writeTaxBracketRealRates(allianceId: number, bracketId: number, realMoneyRate: number, realResourceRate: number): void {
  const row = db.prepare("SELECT nominal_money_rate, nominal_resource_rate FROM tax_bracket_config WHERE alliance_id = ? AND bracket_id = ?")
    .get(allianceId, bracketId) as { nominal_money_rate: number; nominal_resource_rate: number } | undefined;
  if (!row) throw new Error("Unknown tax bracket");
  if (!Number.isInteger(realMoneyRate) || realMoneyRate < 0 || realMoneyRate > row.nominal_money_rate) {
    throw new Error(`Real money rate must be a whole number between 0 and ${row.nominal_money_rate}`);
  }
  if (!Number.isInteger(realResourceRate) || realResourceRate < 0 || realResourceRate > row.nominal_resource_rate) {
    throw new Error(`Real resource rate must be a whole number between 0 and ${row.nominal_resource_rate}`);
  }
  db.prepare(`
    UPDATE tax_bracket_config SET real_money_rate = ?, real_resource_rate = ?, updated_at = ?
    WHERE alliance_id = ? AND bracket_id = ?
  `).run(realMoneyRate, realResourceRate, Date.now(), allianceId, bracketId);
}

export function readTaxRevenueSummary(): BracketRevenue[] {
  const configs = readTaxBracketConfigs();
  const configByKey = new Map(configs.map((config) => [`${config.allianceId}:${config.bracketId}`, config]));
  const results = new Map<string, BracketRevenue>();

  function ensure(allianceId: number, bracketId: number): BracketRevenue {
    const key = `${allianceId}:${bracketId}`;
    let entry = results.get(key);
    if (!entry) {
      const config = configByKey.get(key);
      entry = {
        allianceId,
        allianceName: config?.allianceName ?? `Alliance #${allianceId}`,
        bracketId,
        bracketName: config?.bracketName ?? `Bracket #${bracketId}`,
        nominalMoneyRate: config?.nominalMoneyRate ?? 0,
        nominalResourceRate: config?.nominalResourceRate ?? 0,
        realMoneyRate: config?.realMoneyRate ?? 0,
        realResourceRate: config?.realResourceRate ?? 0,
        actualMoney: 0,
        realMoney: 0,
        safekeptMoney: 0,
        actualResources: emptyResourceTotals(),
        realResources: emptyResourceTotals(),
        recordCount: 0,
      };
      results.set(key, entry);
    }
    return entry;
  }

  function apply(allianceId: number, record: RawTaxRecord): void {
    const bracketId = Number(record.tax_id);
    if (!bracketId) return;
    const entry = ensure(allianceId, bracketId);
    const moneyRatio = entry.nominalMoneyRate > 0 ? entry.realMoneyRate / entry.nominalMoneyRate : 0;
    const resourceRatio = entry.nominalResourceRate > 0 ? entry.realResourceRate / entry.nominalResourceRate : 0;

    const money = Number(record.money) || 0;
    entry.actualMoney += money;
    entry.realMoney += money * moneyRatio;

    for (const key of RESOURCE_KEYS) {
      const value = Number(record[key]) || 0;
      entry.actualResources[key] += value;
      entry.realResources[key] += value * resourceRatio;
    }
    entry.recordCount += 1;
  }

  const mainMeta = readJsonSingleton<{ id: number }>("alliance_meta");
  if (mainMeta) {
    const mainRows = db.prepare("SELECT data FROM tax_records").all() as Array<{ data: string }>;
    for (const row of mainRows) apply(mainMeta.id, JSON.parse(row.data));
  }

  const offshoreRows = db.prepare("SELECT alliance_id, data FROM offshore_tax_records").all() as Array<{ alliance_id: number; data: string }>;
  for (const row of offshoreRows) apply(row.alliance_id, JSON.parse(row.data));

  for (const entry of results.values()) entry.safekeptMoney = entry.actualMoney - entry.realMoney;

  return [...results.values()].sort((a, b) => b.actualMoney - a.actualMoney);
}
