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
  /** Dollar value of this record's resources, priced at the market rate current when it was synced. Absent on records stored before this field existed. */
  resource_value_usd?: number;
  [resource: string]: unknown;
}

interface TradePriceSnapshot {
  coal: number; oil: number; uranium: number; iron: number; bauxite: number; lead: number;
  gasoline: number; munitions: number; steel: number; aluminum: number; food: number;
}

function computeResourceValueUsd(record: RawTaxRecord, prices: TradePriceSnapshot): number {
  let total = 0;
  for (const key of RESOURCE_KEYS) {
    const amount = Number(record[key]) || 0;
    total += amount * (prices[key] ?? 0);
  }
  return total;
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
  /** Resource amounts priced in USD at the market rate current when each record was synced. */
  actualResourceValueUsd: number;
  realResourceValueUsd: number;
  safekeptResourceValueUsd: number;
  /** Money + resource value combined. */
  actualTotalUsd: number;
  realTotalUsd: number;
  safekeptTotalUsd: number;
  recordCount: number;
  actualMoney24h: number;
  realMoney24h: number;
  safekeptMoney24h: number;
  actualResourceValueUsd24h: number;
  realResourceValueUsd24h: number;
  safekeptResourceValueUsd24h: number;
  actualTotalUsd24h: number;
  realTotalUsd24h: number;
  safekeptTotalUsd24h: number;
  recordCount24h: number;
}

export interface TaxMoneyTotals {
  actualMoney: number;
  realMoney: number;
  safekeptMoney: number;
  actualResourceValueUsd: number;
  realResourceValueUsd: number;
  safekeptResourceValueUsd: number;
  actualTotalUsd: number;
  realTotalUsd: number;
  safekeptTotalUsd: number;
}

export interface TaxRevenueOverview {
  brackets: BracketRevenue[];
  last24h: TaxMoneyTotals;
  dailyAverage30d: TaxMoneyTotals;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyMoneyTotals(): TaxMoneyTotals {
  return {
    actualMoney: 0, realMoney: 0, safekeptMoney: 0,
    actualResourceValueUsd: 0, realResourceValueUsd: 0, safekeptResourceValueUsd: 0,
    actualTotalUsd: 0, realTotalUsd: 0, safekeptTotalUsd: 0,
  };
}

/** Fills in the derived safekept/total fields of a TaxMoneyTotals from its accumulated actual/real figures. */
function finalizeTotals(totals: TaxMoneyTotals): void {
  totals.safekeptMoney = totals.actualMoney - totals.realMoney;
  totals.safekeptResourceValueUsd = totals.actualResourceValueUsd - totals.realResourceValueUsd;
  totals.actualTotalUsd = totals.actualMoney + totals.actualResourceValueUsd;
  totals.realTotalUsd = totals.realMoney + totals.realResourceValueUsd;
  totals.safekeptTotalUsd = totals.actualTotalUsd - totals.realTotalUsd;
}

function divideTotals(totals: TaxMoneyTotals, divisor: number): TaxMoneyTotals {
  return {
    actualMoney: totals.actualMoney / divisor,
    realMoney: totals.realMoney / divisor,
    safekeptMoney: totals.safekeptMoney / divisor,
    actualResourceValueUsd: totals.actualResourceValueUsd / divisor,
    realResourceValueUsd: totals.realResourceValueUsd / divisor,
    safekeptResourceValueUsd: totals.safekeptResourceValueUsd / divisor,
    actualTotalUsd: totals.actualTotalUsd / divisor,
    realTotalUsd: totals.realTotalUsd / divisor,
    safekeptTotalUsd: totals.safekeptTotalUsd / divisor,
  };
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

/** Stamps each record with its resource dollar value at the market price current right now (i.e. as of this sync), before it's persisted. */
function withResourceValue(records: RawTaxRecord[]): RawTaxRecord[] {
  const prices = readJsonSingleton<TradePriceSnapshot>("trade_prices");
  if (!prices) return records;
  return records.map((record) => ({ ...record, resource_value_usd: computeResourceValueUsd(record, prices) }));
}

export function replaceTaxRecords(table: "tax_records" | "offshore_tax_records", allianceId: number | null, records: RawTaxRecord[], now: number): void {
  const stamped = withResourceValue(records);
  if (table === "tax_records") {
    const insert = db.prepare("INSERT OR REPLACE INTO tax_records (id, data, updated_at) VALUES (?, ?, ?)");
    db.transaction(() => {
      for (const record of stamped) insert.run(Number(record.id), JSON.stringify(record), now);
    })();
  } else {
    const insert = db.prepare("INSERT OR REPLACE INTO offshore_tax_records (alliance_id, id, data, updated_at) VALUES (?, ?, ?, ?)");
    db.transaction(() => {
      for (const record of stamped) insert.run(allianceId, Number(record.id), JSON.stringify(record), now);
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

export function readTaxRevenueSummary(now: number = Date.now()): TaxRevenueOverview {
  const configs = readTaxBracketConfigs();
  const configByKey = new Map(configs.map((config) => [`${config.allianceId}:${config.bracketId}`, config]));
  const results = new Map<string, BracketRevenue>();
  const last24h = emptyMoneyTotals();
  const last30d = emptyMoneyTotals();
  const since24h = now - DAY_MS;
  const since30d = now - 30 * DAY_MS;

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
        actualResourceValueUsd: 0,
        realResourceValueUsd: 0,
        safekeptResourceValueUsd: 0,
        actualTotalUsd: 0,
        realTotalUsd: 0,
        safekeptTotalUsd: 0,
        recordCount: 0,
        actualMoney24h: 0,
        realMoney24h: 0,
        safekeptMoney24h: 0,
        actualResourceValueUsd24h: 0,
        realResourceValueUsd24h: 0,
        safekeptResourceValueUsd24h: 0,
        actualTotalUsd24h: 0,
        realTotalUsd24h: 0,
        safekeptTotalUsd24h: 0,
        recordCount24h: 0,
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
    const realMoney = money * moneyRatio;
    const actualResVal = Number(record.resource_value_usd) || 0;
    const realResVal = actualResVal * resourceRatio;
    entry.actualMoney += money;
    entry.realMoney += realMoney;
    entry.actualResourceValueUsd += actualResVal;
    entry.realResourceValueUsd += realResVal;

    for (const key of RESOURCE_KEYS) {
      const value = Number(record[key]) || 0;
      entry.actualResources[key] += value;
      entry.realResources[key] += value * resourceRatio;
    }
    entry.recordCount += 1;

    const recordTime = Date.parse(record.date);
    if (Number.isFinite(recordTime) && recordTime >= since30d) {
      last30d.actualMoney += money;
      last30d.realMoney += realMoney;
      last30d.actualResourceValueUsd += actualResVal;
      last30d.realResourceValueUsd += realResVal;
      if (recordTime >= since24h) {
        last24h.actualMoney += money;
        last24h.realMoney += realMoney;
        last24h.actualResourceValueUsd += actualResVal;
        last24h.realResourceValueUsd += realResVal;
        entry.actualMoney24h += money;
        entry.realMoney24h += realMoney;
        entry.actualResourceValueUsd24h += actualResVal;
        entry.realResourceValueUsd24h += realResVal;
        entry.recordCount24h += 1;
      }
    }
  }

  const mainMeta = readJsonSingleton<{ id: number }>("alliance_meta");
  if (mainMeta) {
    const mainRows = db.prepare("SELECT data FROM tax_records").all() as Array<{ data: string }>;
    for (const row of mainRows) apply(mainMeta.id, JSON.parse(row.data));
  }

  const offshoreRows = db.prepare("SELECT alliance_id, data FROM offshore_tax_records").all() as Array<{ alliance_id: number; data: string }>;
  for (const row of offshoreRows) apply(row.alliance_id, JSON.parse(row.data));

  for (const entry of results.values()) {
    entry.safekeptMoney = entry.actualMoney - entry.realMoney;
    entry.safekeptResourceValueUsd = entry.actualResourceValueUsd - entry.realResourceValueUsd;
    entry.actualTotalUsd = entry.actualMoney + entry.actualResourceValueUsd;
    entry.realTotalUsd = entry.realMoney + entry.realResourceValueUsd;
    entry.safekeptTotalUsd = entry.actualTotalUsd - entry.realTotalUsd;

    entry.safekeptMoney24h = entry.actualMoney24h - entry.realMoney24h;
    entry.safekeptResourceValueUsd24h = entry.actualResourceValueUsd24h - entry.realResourceValueUsd24h;
    entry.actualTotalUsd24h = entry.actualMoney24h + entry.actualResourceValueUsd24h;
    entry.realTotalUsd24h = entry.realMoney24h + entry.realResourceValueUsd24h;
    entry.safekeptTotalUsd24h = entry.actualTotalUsd24h - entry.realTotalUsd24h;
  }
  finalizeTotals(last24h);
  finalizeTotals(last30d);

  return {
    brackets: [...results.values()].sort((a, b) => b.actualTotalUsd24h - a.actualTotalUsd24h),
    last24h,
    dailyAverage30d: divideTotals(last30d, 30),
  };
}

export interface TaxRecordDetail {
  allianceId: number;
  allianceName: string;
  bracketId: number;
  bracketName: string;
  date: string;
  senderId: number;
  senderName: string;
  actualMoney: number;
  realMoney: number;
  safekeptMoney: number;
  actualResourceValueUsd: number;
  realResourceValueUsd: number;
  safekeptResourceValueUsd: number;
  actualTotalUsd: number;
  realTotalUsd: number;
  safekeptTotalUsd: number;
  resources: Record<ResourceKey, number>;
}

/** Individual tax transactions (one row per nation per payment), scoped to the last `windowMs` (default 24h). */
export function readTaxRecordDetails(windowMs: number = DAY_MS, now: number = Date.now()): TaxRecordDetail[] {
  const configs = readTaxBracketConfigs();
  const configByKey = new Map(configs.map((config) => [`${config.allianceId}:${config.bracketId}`, config]));
  const names = allianceNames();
  const since = now - windowMs;
  const details: TaxRecordDetail[] = [];

  function process(allianceId: number, record: RawTaxRecord): void {
    const recordTime = Date.parse(record.date);
    if (!Number.isFinite(recordTime) || recordTime < since) return;
    const bracketId = Number(record.tax_id);
    if (!bracketId) return;

    const config = configByKey.get(`${allianceId}:${bracketId}`);
    const moneyRatio = config && config.nominalMoneyRate > 0 ? config.realMoneyRate / config.nominalMoneyRate : 0;
    const resourceRatio = config && config.nominalResourceRate > 0 ? config.realResourceRate / config.nominalResourceRate : 0;

    const money = Number(record.money) || 0;
    const realMoney = money * moneyRatio;
    const actualResVal = Number(record.resource_value_usd) || 0;
    const realResVal = actualResVal * resourceRatio;
    const resources = Object.fromEntries(
      RESOURCE_KEYS.map((key) => [key, Number(record[key]) || 0]),
    ) as Record<ResourceKey, number>;

    details.push({
      allianceId,
      allianceName: config?.allianceName ?? names.get(allianceId) ?? `Alliance #${allianceId}`,
      bracketId,
      bracketName: config?.bracketName ?? `Bracket #${bracketId}`,
      date: record.date,
      senderId: Number(record.sender_id),
      senderName: record.sender?.nation_name ?? `Nation #${record.sender_id}`,
      actualMoney: money,
      realMoney,
      safekeptMoney: money - realMoney,
      actualResourceValueUsd: actualResVal,
      realResourceValueUsd: realResVal,
      safekeptResourceValueUsd: actualResVal - realResVal,
      actualTotalUsd: money + actualResVal,
      realTotalUsd: realMoney + realResVal,
      safekeptTotalUsd: (money + actualResVal) - (realMoney + realResVal),
      resources,
    });
  }

  const mainMeta = readJsonSingleton<{ id: number }>("alliance_meta");
  if (mainMeta) {
    const mainRows = db.prepare("SELECT data FROM tax_records").all() as Array<{ data: string }>;
    for (const row of mainRows) process(mainMeta.id, JSON.parse(row.data));
  }

  const offshoreRows = db.prepare("SELECT alliance_id, data FROM offshore_tax_records").all() as Array<{ alliance_id: number; data: string }>;
  for (const row of offshoreRows) process(row.alliance_id, JSON.parse(row.data));

  return details.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
