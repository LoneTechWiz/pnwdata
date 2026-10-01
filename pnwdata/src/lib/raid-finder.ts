import type { BankRec, Nation } from "./pnw";
import type { TradePrices } from "./war-targets";

export const RAID_LOOTABLE_SHARE = 0.1;

export interface IncomeSnapshot {
  grossNationalIncome: number;
  capturedAt: number;
}

export interface RevenueEstimate {
  value: number | null;
  basis: "observed" | "recent-rate" | "lifetime-rate" | "unavailable";
}

export interface BeigeEvent {
  beigeDate: number;
  lootValue: number;
}

export interface BankFlow {
  netValue: number;
  recordCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function inactiveDays(lastActive: string, now = Date.now()): number {
  const value = Date.parse(lastActive);
  return Number.isFinite(value) ? Math.max(0, (now - value) / DAY_MS) : 0;
}

export function estimateRevenueSince(
  currentGni: number,
  nationCreatedAt: string,
  since: number | null,
  snapshots: IncomeSnapshot[],
  now = Date.now(),
): RevenueEstimate {
  if (since == null || !Number.isFinite(currentGni) || currentGni < 0) {
    return { value: null, basis: "unavailable" };
  }

  const ordered = [...snapshots].sort((a, b) => a.capturedAt - b.capturedAt);
  const baseline = ordered.filter((snapshot) => snapshot.capturedAt <= since).at(-1);
  if (baseline) {
    return {
      value: Math.max(0, currentGni - baseline.grossNationalIncome),
      basis: "observed",
    };
  }

  if (ordered.length >= 2) {
    const first = ordered[0];
    const last = ordered.at(-1)!;
    const elapsed = last.capturedAt - first.capturedAt;
    if (elapsed > 0) {
      const dailyRate = Math.max(0, last.grossNationalIncome - first.grossNationalIncome) / (elapsed / DAY_MS);
      return {
        value: dailyRate * Math.max(0, now - since) / DAY_MS,
        basis: "recent-rate",
      };
    }
  }

  const createdAt = Date.parse(nationCreatedAt);
  if (Number.isFinite(createdAt) && createdAt < now) {
    const lifetimeDays = Math.max(1, (now - createdAt) / DAY_MS);
    const lifetimeDailyRate = currentGni / lifetimeDays;
    return {
      value: lifetimeDailyRate * Math.max(0, now - since) / DAY_MS,
      basis: "lifetime-rate",
    };
  }

  return { value: null, basis: "unavailable" };
}

function recordValue(record: BankRec, prices: TradePrices | null): number {
  const money = Number(record.money) || 0;
  if (!prices) return money;
  return money
    + (Number(record.coal) || 0) * prices.coal
    + (Number(record.oil) || 0) * prices.oil
    + (Number(record.uranium) || 0) * prices.uranium
    + (Number(record.iron) || 0) * prices.iron
    + (Number(record.bauxite) || 0) * prices.bauxite
    + (Number(record.lead) || 0) * prices.lead
    + (Number(record.gasoline) || 0) * prices.gasoline
    + (Number(record.munitions) || 0) * prices.munitions
    + (Number(record.steel) || 0) * prices.steel
    + (Number(record.aluminum) || 0) * prices.aluminum
    + (Number(record.food) || 0) * prices.food;
}

export function bankFlowSince(
  nationId: number,
  since: number | null,
  records: BankRec[],
  prices: TradePrices | null,
): BankFlow {
  if (since == null) return { netValue: 0, recordCount: 0 };
  let netValue = 0;
  let recordCount = 0;
  for (const record of records) {
    const timestamp = Date.parse(record.date);
    if (!Number.isFinite(timestamp) || timestamp < since) continue;
    const sent = Number(record.sender_type) === 1 && Number(record.sender_id) === nationId;
    const received = Number(record.receiver_type) === 1 && Number(record.receiver_id) === nationId;
    if (!sent && !received) continue;
    const value = recordValue(record, prices);
    if (received) netValue += value;
    if (sent) netValue -= value;
    recordCount += 1;
  }
  return { netValue, recordCount };
}

export function estimateLikelyLoot(
  events: BeigeEvent[],
  revenueSinceBeige: number | null,
  bankNetSinceBeige: number,
): number | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => b.beigeDate - a.beigeDate);
  const average = ordered.reduce((sum, event) => sum + event.lootValue, 0) / ordered.length;
  const historicalBase = ordered[0].lootValue * 0.7 + average * 0.3;
  const postBeigeGrowth = Math.max(0, (revenueSinceBeige ?? 0) + bankNetSinceBeige);
  return Math.round(historicalBase + postBeigeGrowth * RAID_LOOTABLE_SHARE);
}

export function isEligibleRaidTarget(
  nation: Pick<Nation, "id" | "score" | "last_active" | "vacation_mode_turns" | "beige_turns" | "defensive_wars_count">,
  options: {
    requesterId: number;
    minScore: number;
    maxScore: number;
    minInactiveDays: number;
    excludedAllianceIds: Set<number>;
    allianceId: number;
    atWarWith: Set<number>;
    now?: number;
  },
): boolean {
  return nation.id !== options.requesterId
    && nation.score >= options.minScore
    && nation.score <= options.maxScore
    && nation.vacation_mode_turns === 0
    && nation.beige_turns === 0
    && nation.defensive_wars_count < 3
    && inactiveDays(nation.last_active, options.now) >= options.minInactiveDays
    && !options.excludedAllianceIds.has(options.allianceId)
    && !options.atWarWith.has(nation.id);
}
