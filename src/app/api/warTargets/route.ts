import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

const PNW_API = "https://api.politicsandwar.com/graphql";

async function gql<T>(query: string, variables?: Record<string, unknown>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error("PnW API rate limited (429) — try again in a moment");
    }
    if (!res.ok) throw new Error(`PnW API HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data as T;
  }
  throw new Error("PnW API request failed after retries");
}

const NATION_SCORE_QUERY = `
  query($id:[Int]) { nations(id:$id) { data { score leader_name discord } } }
`;

const OFFENSIVE_WARS_QUERY = `
  query($attid:[Int]) { wars(attid:$attid, active:true) { data { def_id } } }
`;

const BEIGE_WARS_QUERY = `
  query($ids:[Int], $after:DateTime, $page:Int) { wars(or_id:$ids, active:false, after:$after, first:500, page:$page) { data {
    date att_id def_id winner_id
    attacks {
      money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
      lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
    }
  } } }
`;

const ENEMY_MEMBERS_QUERY = `
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name score num_cities
    alliance { name }
    cities { infrastructure }
    soldiers tanks aircraft ships
    offensive_wars_count defensive_wars_count vacation_mode_turns beige_turns
  } } }
`;

interface EnemyNation {
  id: number;
  nation_name: string;
  leader_name: string;
  score: number;
  num_cities: number;
  alliance: { name: string } | null;
  cities: { infrastructure: number }[];
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  offensive_wars_count: number;
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
}

export interface WarTarget {
  id: number;
  nation_name: string;
  leader_name: string;
  alliance_name: string;
  score: number;
  num_cities: number;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  offensive_wars_count: number;
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
  beige_loot: number | null;
  beige_date: string | null;
  beige_avg: number | null;
  beige_count: number | null;
}

export interface WarTargetsResponse {
  targets: WarTarget[];
  yourScore: number;
  minScore: number;
  maxScore: number;
  yourLeader: string;
  yourDiscord: string | null;
  nationInAlliance: boolean;
}

export async function GET(request: NextRequest) {
  if (!process.env.PNW_API_KEY) {
    return NextResponse.json({ error: "PNW_API_KEY is not configured" }, { status: 500 });
  }

  // 1. Validate nationId
  const nationIdStr = request.nextUrl.searchParams.get("nationId");
  const nationId = Number(nationIdStr);
  if (!nationIdStr || !Number.isInteger(nationId) || nationId <= 0) {
    return NextResponse.json({ error: "nationId must be a positive integer" }, { status: 400 });
  }

  // 2. Read and validate config
  let rawIds: unknown;
  try {
    const configPath = join(process.cwd(), "data", "war-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as { enemy_alliance_ids: unknown };
    rawIds = config.enemy_alliance_ids;
  } catch {
    return NextResponse.json(
      { error: "data/war-config.json not found or invalid JSON — ask an admin to check it" },
      { status: 500 }
    );
  }

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json(
      { error: "war-config.json: enemy_alliance_ids must be a non-empty array — ask an admin to add alliance IDs" },
      { status: 500 }
    );
  }
  const enemyAllianceIds = rawIds.map(Number);
  if (enemyAllianceIds.some(id => !Number.isFinite(id) || id <= 0)) {
    return NextResponse.json(
      { error: "war-config.json: all enemy_alliance_ids must be positive integers" },
      { status: 500 }
    );
  }

  // 3. Fetch your nation score + active wars first, then alliance members in parallel
  let nationData: { nations: { data: { score: number; leader_name: string; discord: string | null }[] } };
  let warsData: { wars: { data: { def_id: number }[] } };
  try {
    [nationData, warsData] = await Promise.all([
      gql<{ nations: { data: { score: number; leader_name: string; discord: string | null }[] } }>(NATION_SCORE_QUERY, { id: [nationId] }),
      gql<{ wars: { data: { def_id: number }[] } }>(OFFENSIVE_WARS_QUERY, { attid: [nationId] }),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const yourNation = nationData.nations.data[0];
  if (yourNation == null) {
    return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
  }
  const yourScore = yourNation.score;
  const yourLeader = yourNation.leader_name;
  const yourDiscord = yourNation.discord ?? null;

  const minScore = Math.floor(yourScore * 0.75);
  const maxScore = Math.ceil(yourScore * 4 / 3);
  const atWarWith = new Set(warsData.wars.data.map(w => Number(w.def_id)));

  // Fetch alliance members with allSettled so a single 503 doesn't kill the whole request
  const memberResults = await Promise.allSettled(
    enemyAllianceIds.map(id =>
      gql<{ nations: { data: EnemyNation[] } }>(ENEMY_MEMBERS_QUERY, { alliance_id: [id] })
    )
  );
  const failedCount = memberResults.filter(r => r.status === "rejected").length;
  if (failedCount === memberResults.length) {
    return NextResponse.json({ error: "PnW API error: all alliance queries failed" }, { status: 502 });
  }
  const allEnemyNations = memberResults
    .filter((r): r is PromiseFulfilledResult<{ nations: { data: EnemyNation[] } }> => r.status === "fulfilled")
    .flatMap(r => r.value.nations.data);

  const filteredNations = allEnemyNations
    .filter(n => n.score >= minScore && n.score <= maxScore)
    .filter(n => !atWarWith.has(Number(n.id)))
    .filter(n => n.defensive_wars_count < 3)
    .filter(n => n.vacation_mode_turns === 0)
    .filter(n => n.beige_turns === 0);

  // Load trade prices from local DB for resource valuation
  type Prices = { coal: number; oil: number; uranium: number; iron: number; bauxite: number; lead: number; gasoline: number; munitions: number; steel: number; aluminum: number; food: number };
  let prices: Prices | null = null;
  try {
    const row = db.prepare("SELECT data FROM trade_prices WHERE id = 1").get() as { data: string } | undefined;
    if (row) prices = JSON.parse(row.data) as Prices;
  } catch { /* no prices available */ }

  type LootAttack = { money_looted: number; coal_looted: number; oil_looted: number; uranium_looted: number; iron_looted: number; bauxite_looted: number; lead_looted: number; gasoline_looted: number; munitions_looted: number; steel_looted: number; aluminum_looted: number; food_looted: number };

  function attackLootValue(attacks: LootAttack[]): number {
    const p = prices;
    return attacks.reduce((sum, a) => {
      const resourceValue = !p ? 0
        : a.coal_looted * p.coal + a.oil_looted * p.oil + a.uranium_looted * p.uranium
        + a.iron_looted * p.iron + a.bauxite_looted * p.bauxite + a.lead_looted * p.lead
        + a.gasoline_looted * p.gasoline + a.munitions_looted * p.munitions
        + a.steel_looted * p.steel + a.aluminum_looted * p.aluminum + a.food_looted * p.food;
      return sum + a.money_looted + resourceValue;
    }, 0);
  }

  // Fetch beige loot: paginate through all completed wars involving target nations,
  // recording the most recent war each target LOST (beiged as either attacker or defender).
  const targetIds = filteredNations.map(n => Number(n.id));
  const targetIdSet = new Set(targetIds);
  const beigeMap = new Map<number, { loot: number; date: string; allLoots: number[] }>();

  type BeigeWar = { date: string; att_id: string; def_id: string; winner_id: string; attacks: LootAttack[] };

  function recordIfLoss(w: BeigeWar) {
    if (w.winner_id === "0") return;
    const loserId = w.winner_id === w.att_id ? Number(w.def_id) : Number(w.att_id);
    if (!targetIdSet.has(loserId)) return;
    const loot = attackLootValue(w.attacks);
    const existing = beigeMap.get(loserId);
    if (!existing) {
      beigeMap.set(loserId, { loot, date: w.date, allLoots: [loot] });
    } else {
      existing.allLoots.push(loot);
      if (w.date > existing.date) {
        existing.loot = loot;
        existing.date = w.date;
      }
    }
  }

  if (targetIds.length > 0) {
    try {
      const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const after = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 00:00:00`;
      for (let page = 1; ; page++) {
        const beigeData = await gql<{ wars: { data: BeigeWar[] } }>(
          BEIGE_WARS_QUERY, { ids: targetIds, after, page }
        );
        const wars = beigeData.wars.data;
        for (const w of wars) recordIfLoss(w);
        if (wars.length < 500) break;
      }
    } catch (e) {
      console.error("[WarTargets] Beige loot query failed:", e instanceof Error ? e.message : e);
    }
  }

  const targets: WarTarget[] = filteredNations
    .map(n => {
      const beige = beigeMap.get(Number(n.id));
      return {
        id: n.id,
        nation_name: n.nation_name,
        leader_name: n.leader_name,
        alliance_name: n.alliance?.name ?? "Unknown",
        score: n.score,
        num_cities: n.num_cities,
        avg_infra: n.cities.length > 0
          ? Math.round(n.cities.reduce((s, c) => s + c.infrastructure, 0) / n.cities.length)
          : 0,
        soldiers: n.soldiers,
        tanks: n.tanks,
        aircraft: n.aircraft,
        ships: n.ships,
        offensive_wars_count: n.offensive_wars_count,
        defensive_wars_count: n.defensive_wars_count,
        vacation_mode_turns: n.vacation_mode_turns,
        beige_turns: n.beige_turns,
        beige_loot: beige?.loot ?? null,
        beige_date: beige?.date ?? null,
        beige_avg: beige ? Math.round(beige.allLoots.reduce((s, v) => s + v, 0) / beige.allLoots.length) : null,
        beige_count: beige?.allLoots.length ?? null,
      };
    })
    .sort((a, b) => b.avg_infra - a.avg_infra);

  const allianceRow = db.prepare(`
    SELECT id FROM nations WHERE id = ?
    UNION
    SELECT id FROM applicants WHERE id = ?
    LIMIT 1
  `).get(nationId, nationId) as { id: number } | undefined;

  const response: WarTargetsResponse = {
    targets, yourScore, minScore, maxScore, yourLeader, yourDiscord,
    nationInAlliance: !!allianceRow,
  };
  return NextResponse.json(response);
}
