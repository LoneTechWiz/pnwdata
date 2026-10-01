import { NextRequest, NextResponse } from "next/server";
import db, { readJsonRows, readJsonSingleton } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hasAccess, readRoleConfig } from "@/lib/role-config";
import { readRaidFinderConfig } from "@/lib/raid-config";
import {
  bankFlowSince,
  estimateLikelyLoot,
  estimateRevenueSince,
  inactiveDays,
  isEligibleRaidTarget,
  RAID_LOOTABLE_SHARE,
  type BeigeEvent,
  type IncomeSnapshot,
} from "@/lib/raid-finder";
import type { RaidNation } from "@/lib/raid-sync";
import {
  fetchRaidRequesterContext,
  type RaidRequesterNation,
  type RaidRequesterWar,
} from "@/lib/raid-requester";
import type { Alliance, BankRec, War } from "@/lib/pnw";
import { avgInfraPerCity, warTargetScoreRange, type TradePrices } from "@/lib/war-targets";

export const dynamic = "force-dynamic";

interface StoredRow { data: string }

export interface RaidTargetResult {
  id: number;
  nationName: string;
  leaderName: string;
  allianceName: string;
  score: number;
  cities: number;
  averageInfrastructure: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensiveWars: number;
  lastActive: string;
  inactiveDays: number;
  lastBeigeAt: string | null;
  beigeCount: number;
  lastNationLoot: number | null;
  averageNationLoot: number | null;
  lastAllianceLoot: number | null;
  averageAllianceLoot: number | null;
  revenueSinceBeige: number | null;
  revenueBasis: "observed" | "recent-rate" | "lifetime-rate" | "unavailable";
  bankNetSinceBeige: number;
  bankRecordCount: number;
  estimatedNationLoot: number | null;
  estimatedAllianceLoot: number | null;
  estimatedTotalLoot: number | null;
  confidence: "high" | "medium" | "low";
}

async function canView(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const roleConfig = await readRoleConfig();
  return session.isEmperor || hasAccess(roleConfig, "/raid-finder", session.roleIds);
}

function readRequester(nationId: number): RaidRequesterNation | null {
  const row = db.prepare(`
    SELECT data FROM nations WHERE id = ?
    UNION ALL SELECT data FROM applicants WHERE id = ?
    UNION ALL SELECT data FROM raid_nations WHERE id = ?
    LIMIT 1
  `).get(nationId, nationId, nationId) as StoredRow | undefined;
  return row ? JSON.parse(row.data) as RaidRequesterNation : null;
}

export async function GET(request: NextRequest) {
  if (!(await canView())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const nationIdValue = request.nextUrl.searchParams.get("nationId");
  const nationId = Number(nationIdValue);
  if (!nationIdValue || !Number.isInteger(nationId) || nationId <= 0) {
    return NextResponse.json({ error: "nationId must be a positive integer" }, { status: 400 });
  }

  const localRequester = readRequester(nationId);
  let requester = localRequester;
  let requesterWars: RaidRequesterWar[] | null = null;
  try {
    const liveContext = await fetchRaidRequesterContext(nationId);
    requester = liveContext.nation;
    requesterWars = liveContext.activeWars;
  } catch (error) {
    console.error(`[Raid Finder] Live lookup failed for nation ${nationId}:`, error);
    if (!localRequester) {
      return NextResponse.json({
        error: "Politics & War could not be reached to look up that nation. Try again shortly.",
      }, { status: 502 });
    }
  }

  if (!requester) {
    return NextResponse.json({
      error: `Nation #${nationId} was not found in Politics & War.`,
    }, { status: 404 });
  }

  const config = await readRaidFinderConfig();
  const { minScore, maxScore } = warTargetScoreRange(Number(requester.score));
  const alliance = readJsonSingleton<Alliance>("alliance_meta");
  const requesterAllianceId = Number(requester.alliance_id ?? alliance?.id ?? 0);
  const warConfig = await import("@/lib/app-config").then(({ readAppConfig }) =>
    readAppConfig<{ ally_alliance_ids?: number[] }>("war-config")
  );
  const excludedAllianceIds = new Set((warConfig.ally_alliance_ids ?? []).map(Number));
  if (requesterAllianceId) excludedAllianceIds.add(requesterAllianceId);

  const activeWars: Array<Pick<War, "att_id" | "def_id">> = requesterWars ?? readJsonRows<War>("wars");
  const atWarWith = new Set<number>();
  for (const war of activeWars) {
    if (Number(war.att_id) === nationId) atWarWith.add(Number(war.def_id));
    if (Number(war.def_id) === nationId) atWarWith.add(Number(war.att_id));
  }

  const candidates = (db.prepare("SELECT data FROM raid_nations").all() as StoredRow[])
    .map((row) => JSON.parse(row.data) as RaidNation)
    .filter((nation) => isEligibleRaidTarget({
      id: Number(nation.id),
      score: Number(nation.score),
      last_active: nation.last_active,
      vacation_mode_turns: Number(nation.vacation_mode_turns),
      beige_turns: Number(nation.beige_turns),
      defensive_wars_count: Number(nation.defensive_wars_count),
    }, {
      requesterId: nationId,
      minScore,
      maxScore,
      minInactiveDays: config.min_inactive_days,
      excludedAllianceIds,
      allianceId: Number(nation.alliance_id),
      atWarWith,
    }));

  const candidateIds = new Set(candidates.map((candidate) => Number(candidate.id)));
  type SplitBeigeEvent = BeigeEvent & { nationLootValue: number; allianceLootValue: number };
  const beigeByNation = new Map<number, SplitBeigeEvent[]>();
  const beigeRows = db.prepare(`
    SELECT nation_id, beige_date, nation_loot_value, alliance_loot_value
    FROM raid_beige_events
    WHERE nation_loot_value IS NOT NULL AND alliance_loot_value IS NOT NULL
    ORDER BY beige_date ASC
  `).all() as Array<{
    nation_id: number;
    beige_date: number;
    nation_loot_value: number;
    alliance_loot_value: number;
  }>;
  for (const row of beigeRows) {
    if (!candidateIds.has(row.nation_id)) continue;
    const list = beigeByNation.get(row.nation_id) ?? [];
    list.push({
      beigeDate: row.beige_date,
      lootValue: row.nation_loot_value + row.alliance_loot_value,
      nationLootValue: row.nation_loot_value,
      allianceLootValue: row.alliance_loot_value,
    });
    beigeByNation.set(row.nation_id, list);
  }

  const snapshotsByNation = new Map<number, IncomeSnapshot[]>();
  const snapshotRows = db.prepare(`
    SELECT nation_id, gross_national_income, captured_at
    FROM raid_income_snapshots ORDER BY captured_at ASC
  `).all() as Array<{ nation_id: number; gross_national_income: number; captured_at: number }>;
  for (const row of snapshotRows) {
    if (!candidateIds.has(row.nation_id)) continue;
    const list = snapshotsByNation.get(row.nation_id) ?? [];
    list.push({ grossNationalIncome: row.gross_national_income, capturedAt: row.captured_at });
    snapshotsByNation.set(row.nation_id, list);
  }

  const bankRecords = readJsonRows<BankRec>("bankrecs");
  const prices = readJsonSingleton<TradePrices>("trade_prices");
  const now = Date.now();
  const targets: RaidTargetResult[] = candidates.map((nation) => {
    const nationIdValue = Number(nation.id);
    const events = beigeByNation.get(nationIdValue) ?? [];
    const lastBeige = events.at(-1) ?? null;
    const revenue = estimateRevenueSince(
      Number(nation.gross_national_income) || 0,
      nation.date,
      lastBeige?.beigeDate ?? null,
      snapshotsByNation.get(nationIdValue) ?? [],
      now,
    );
    const bankFlow = bankFlowSince(
      nationIdValue,
      lastBeige?.beigeDate ?? null,
      bankRecords,
      prices,
    );
    const nationEvents = events.map((event) => ({ beigeDate: event.beigeDate, lootValue: event.nationLootValue }));
    const allianceEvents = events.map((event) => ({ beigeDate: event.beigeDate, lootValue: event.allianceLootValue }));
    const averageNationLoot = events.length
      ? Math.round(events.reduce((sum, event) => sum + event.nationLootValue, 0) / events.length)
      : null;
    const averageAllianceLoot = events.length
      ? Math.round(events.reduce((sum, event) => sum + event.allianceLootValue, 0) / events.length)
      : null;
    const estimatedNationLoot = estimateLikelyLoot(nationEvents, revenue.value, bankFlow.netValue);
    const estimatedAllianceLoot = estimateLikelyLoot(allianceEvents, null, 0);
    const estimatedTotalLoot = estimatedNationLoot == null && estimatedAllianceLoot == null
      ? null
      : (estimatedNationLoot ?? 0) + (estimatedAllianceLoot ?? 0);
    const confidence: RaidTargetResult["confidence"] = events.length >= 3 && revenue.basis === "observed"
      ? "high"
      : events.length > 0
        ? "medium"
        : "low";
    return {
      id: nationIdValue,
      nationName: nation.nation_name,
      leaderName: nation.leader_name,
      allianceName: nation.alliance?.name ?? "None",
      score: Number(nation.score),
      cities: Number(nation.num_cities),
      averageInfrastructure: avgInfraPerCity(nation.cities ?? []),
      soldiers: Number(nation.soldiers),
      tanks: Number(nation.tanks),
      aircraft: Number(nation.aircraft),
      ships: Number(nation.ships),
      defensiveWars: Number(nation.defensive_wars_count),
      lastActive: nation.last_active,
      inactiveDays: inactiveDays(nation.last_active, now),
      lastBeigeAt: lastBeige ? new Date(lastBeige.beigeDate).toISOString() : null,
      beigeCount: events.length,
      lastNationLoot: lastBeige ? Math.round(lastBeige.nationLootValue) : null,
      averageNationLoot,
      lastAllianceLoot: lastBeige ? Math.round(lastBeige.allianceLootValue) : null,
      averageAllianceLoot,
      revenueSinceBeige: revenue.value == null ? null : Math.round(revenue.value),
      revenueBasis: revenue.basis,
      bankNetSinceBeige: Math.round(bankFlow.netValue),
      bankRecordCount: bankFlow.recordCount,
      estimatedNationLoot,
      estimatedAllianceLoot,
      estimatedTotalLoot,
      confidence,
    };
  }).sort((a, b) => {
    if (a.estimatedNationLoot == null && b.estimatedNationLoot == null) return b.inactiveDays - a.inactiveDays;
    if (a.estimatedNationLoot == null) return 1;
    if (b.estimatedNationLoot == null) return -1;
    return b.estimatedNationLoot - a.estimatedNationLoot || b.inactiveDays - a.inactiveDays;
  });

  const syncStatus = db.prepare("SELECT * FROM raid_sync_status WHERE id = 1").get();
  return NextResponse.json({
    requester: {
      id: nationId,
      nationName: requester.nation_name,
      leaderName: requester.leader_name,
      score: Number(requester.score),
    },
    scoreRange: { min: minScore, max: maxScore },
    minInactiveDays: config.min_inactive_days,
    targets,
    syncStatus,
    methodology: {
      observed: "Nation loot comes from VICTORY attacks and alliance loot from ALLIANCELOOT attacks; bank flow includes only transactions visible to The Empire bank.",
      estimate: `Nation loot is 70% latest plus 30% historical average, then ${RAID_LOOTABLE_SHARE * 100}% of positive post-beige GNI and visible net bank flow. Alliance loot uses its separate 70/30 history without nation revenue.`,
    },
  });
}
