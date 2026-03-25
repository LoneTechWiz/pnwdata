import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import db from "@/lib/db";
import { getSession } from "@/lib/session";
import type { AiPick, AiTargetsResponse } from "@/lib/aiTargets";

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
  query($id:[Int]) { nations(id:$id) { data { nation_name score leader_name } } }
`;
const OFFENSIVE_WARS_QUERY = `
  query($attid:[Int]) { wars(attid:$attid, active:true) { data { def_id } } }
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
const BEIGE_WARS_QUERY = `
  query($ids:[Int], $after:DateTime, $page:Int) { wars(or_id:$ids, active:false, after:$after, first:500, page:$page) { data {
    date att_id def_id winner_id
    attacks {
      money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
      lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
    }
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

type Prices = {
  coal: number; oil: number; uranium: number; iron: number; bauxite: number;
  lead: number; gasoline: number; munitions: number; steel: number; aluminum: number; food: number;
};

type LootAttack = {
  money_looted: number; coal_looted: number; oil_looted: number; uranium_looted: number;
  iron_looted: number; bauxite_looted: number; lead_looted: number; gasoline_looted: number;
  munitions_looted: number; steel_looted: number; aluminum_looted: number; food_looted: number;
};

type BeigeWar = {
  date: string; att_id: string; def_id: string; winner_id: string; attacks: LootAttack[];
};

interface TargetData {
  nation_id: number;
  nation_name: string;
  alliance_name: string;
  avg_infra: number;
  soldiers: number;
  tanks: number;
  aircraft: number;
  ships: number;
  defensive_wars_count: number;
  beige_avg: number | null;
  beige_count: number | null;
}

export async function GET(request: NextRequest) {
  if (!process.env.PNW_API_KEY) {
    return NextResponse.json({ error: "PNW_API_KEY is not configured" }, { status: 500 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let nationId: number;
  const nationIdParam = request.nextUrl.searchParams.get("nation_id");
  if (nationIdParam) {
    const parsed = Number(nationIdParam);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Invalid nation_id" }, { status: 400 });
    }
    nationId = parsed;
  } else {
    const nationRow = db.prepare(`
      SELECT id FROM nations WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
      UNION
      SELECT id FROM applicants WHERE LOWER(json_extract(data, '$.discord')) = LOWER(?)
      LIMIT 1
    `).get(session.username, session.username) as { id: number } | undefined;

    if (!nationRow) {
      return NextResponse.json(
        { error: "Your Discord username isn't linked to a PnW nation. Make sure your in-game Discord field matches your Discord username." },
        { status: 404 }
      );
    }
    nationId = nationRow.id;
  }

  let enemyAllianceIds: number[];
  try {
    const config = JSON.parse(readFileSync(join(process.cwd(), "data", "war-config.json"), "utf-8"));
    if (!Array.isArray(config.enemy_alliance_ids) || config.enemy_alliance_ids.length === 0) {
      return NextResponse.json({ error: "No enemy alliances configured" }, { status: 500 });
    }
    enemyAllianceIds = config.enemy_alliance_ids.map(Number);
  } catch {
    return NextResponse.json({ error: "war-config.json not found or invalid" }, { status: 500 });
  }

  const discordRow = db.prepare(`
    SELECT json_extract(data, '$.discord') as discord FROM nations WHERE id = ?
    UNION
    SELECT json_extract(data, '$.discord') as discord FROM applicants WHERE id = ?
    LIMIT 1
  `).get(nationId, nationId) as { discord: string | null } | undefined;
  const nationDiscord = discordRow?.discord ?? null;

  let yourScore: number;
  let yourNationName: string;
  let yourLeaderName: string;
  let atWarWith: Set<number>;
  try {
    const [nationData, warsData] = await Promise.all([
      gql<{ nations: { data: { nation_name: string; score: number; leader_name: string }[] } }>(NATION_SCORE_QUERY, { id: [nationId] }),
      gql<{ wars: { data: { def_id: number }[] } }>(OFFENSIVE_WARS_QUERY, { attid: [nationId] }),
    ]);
    if (!nationData.nations.data[0]) {
      return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
    }
    yourScore = nationData.nations.data[0].score;
    yourNationName = nationData.nations.data[0].nation_name;
    yourLeaderName = nationData.nations.data[0].leader_name;
    atWarWith = new Set(warsData.wars.data.map(w => Number(w.def_id)));
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const nationInfo: import("@/lib/aiTargets").NationInfo = {
    nation_id: nationId,
    nation_name: yourNationName,
    leader_name: yourLeaderName,
    discord: nationDiscord,
  };

  const minScore = Math.floor(yourScore * 0.75);
  const maxScore = Math.ceil(yourScore * 4 / 3);

  const memberResults = await Promise.allSettled(
    enemyAllianceIds.map(id =>
      gql<{ nations: { data: EnemyNation[] } }>(ENEMY_MEMBERS_QUERY, { alliance_id: [id] })
    )
  );
  if (memberResults.every(r => r.status === "rejected")) {
    return NextResponse.json({ error: "PnW API error: all alliance queries failed" }, { status: 502 });
  }
  const allEnemyNations = memberResults
    .filter((r): r is PromiseFulfilledResult<{ nations: { data: EnemyNation[] } }> => r.status === "fulfilled")
    .flatMap(r => r.value.nations.data);

  const filtered = allEnemyNations
    .filter(n => n.score >= minScore && n.score <= maxScore)
    .filter(n => !atWarWith.has(Number(n.id)))
    .filter(n => n.defensive_wars_count < 3)
    .filter(n => n.vacation_mode_turns === 0)
    .filter(n => n.beige_turns === 0);

  let prices: Prices | null = null;
  try {
    const row = db.prepare("SELECT data FROM trade_prices WHERE id = 1").get() as { data: string } | undefined;
    if (row) prices = JSON.parse(row.data) as Prices;
  } catch { /* use null */ }

  function attackLootValue(attacks: LootAttack[]): number {
    return attacks.reduce((sum, a) => {
      const rv = !prices ? 0
        : a.coal_looted * prices.coal + a.oil_looted * prices.oil + a.uranium_looted * prices.uranium
        + a.iron_looted * prices.iron + a.bauxite_looted * prices.bauxite + a.lead_looted * prices.lead
        + a.gasoline_looted * prices.gasoline + a.munitions_looted * prices.munitions
        + a.steel_looted * prices.steel + a.aluminum_looted * prices.aluminum + a.food_looted * prices.food;
      return sum + a.money_looted + rv;
    }, 0);
  }

  const targetIds = filtered.map(n => Number(n.id));
  const targetIdSet = new Set(targetIds);
  const beigeMap = new Map<number, { loot: number; date: string; allLoots: number[] }>();

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
      if (w.date > existing.date) { existing.loot = loot; existing.date = w.date; }
    }
  }

  if (targetIds.length > 0) {
    try {
      const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const after = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 00:00:00`;
      for (let page = 1; ; page++) {
        if (page > 20) break;
        const beigeData = await gql<{ wars: { data: BeigeWar[] } }>(BEIGE_WARS_QUERY, { ids: targetIds, after, page });
        for (const w of beigeData.wars.data) recordIfLoss(w);
        if (beigeData.wars.data.length < 500) break;
      }
    } catch (e) {
      console.error("[AiTargets] Beige loot query failed:", e instanceof Error ? e.message : e);
    }
  }

  const targets: TargetData[] = filtered.map(n => {
    const beige = beigeMap.get(Number(n.id));
    return {
      nation_id: Number(n.id),
      nation_name: n.nation_name,
      alliance_name: n.alliance?.name ?? "Unknown",
      avg_infra: n.cities.length > 0
        ? Math.round(n.cities.reduce((s, c) => s + c.infrastructure, 0) / n.cities.length)
        : 0,
      soldiers: n.soldiers,
      tanks: n.tanks,
      aircraft: n.aircraft,
      ships: n.ships,
      defensive_wars_count: n.defensive_wars_count,
      beige_avg: beige ? Math.round(beige.allLoots.reduce((s, v) => s + v, 0) / beige.allLoots.length) : null,
      beige_count: beige?.allLoots.length ?? null,
    };
  });

  const targetMap = new Map<number, TargetData>(targets.map(t => [t.nation_id, t]));

  if (targets.length === 0) {
    return NextResponse.json({
      damage_picks: [],
      loot_picks: [],
      summary: "No valid targets found in your score range.",
      target_count: 0,
      nation_info: nationInfo,
    } satisfies AiTargetsResponse);
  }

  const N = Math.min(5, targets.length);
  const prompt = [
    `Here are ${targets.length} attackable enemy nations:`,
    JSON.stringify(targets.map(t => ({
      id: t.nation_id,
      nation_name: t.nation_name,
      alliance_name: t.alliance_name,
      avg_infra: t.avg_infra,
      soldiers: t.soldiers,
      tanks: t.tanks,
      aircraft: t.aircraft,
      ships: t.ships,
      defensive_wars_count: t.defensive_wars_count,
      beige_avg: t.beige_avg,
      beige_count: t.beige_count,
    }))),
    `Pick the ${N} best targets for (1) maximum infrastructure damage — favour high avg_infra and low military units, and (2) maximum loot — favour high beige_avg and low military resistance. Return JSON with keys "damage_picks", "loot_picks" (each an array of ${N} objects with "nation_id" and a one-sentence "reason"), and a "summary" string with overall strategic context.`,
  ].join("\n\n");

  let ollamaContent: string;
  try {
    const ollamaRes = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.5:397b-cloud",
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "You are a war strategy advisor for the online game Politics and War. Analyze the provided list of attackable enemy nations and return JSON only — no other text." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!ollamaRes.ok) throw new Error(`Ollama HTTP ${ollamaRes.status}`);
    const ollamaJson = await ollamaRes.json();
    ollamaContent = ollamaJson?.message?.content ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork = msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("Ollama HTTP") || msg.includes("operation was aborted") || (err instanceof DOMException && err.name === "TimeoutError");
    return NextResponse.json(
      { error: isNetwork ? "AI service unavailable — is Ollama running?" : `AI error: ${msg}` },
      { status: 502 }
    );
  }

  if (ollamaContent.trimStart().startsWith("<think>")) {
    ollamaContent = ollamaContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  let aiResult: { damage_picks: { nation_id: number; reason: string }[]; loot_picks: { nation_id: number; reason: string }[]; summary: string };
  try {
    aiResult = JSON.parse(ollamaContent);
    if (!Array.isArray(aiResult.damage_picks) || !Array.isArray(aiResult.loot_picks)) {
      throw new Error("Missing picks arrays");
    }
  } catch {
    return NextResponse.json(
      { error: "AI returned an unexpected response — try again" },
      { status: 502 }
    );
  }

  function enrichPicks(picks: { nation_id: number; reason: string }[]): AiPick[] {
    return picks
      .map(p => {
        const t = targetMap.get(Number(p.nation_id));
        if (!t) return null;
        return { ...t, reason: p.reason };
      })
      .filter((p): p is AiPick => p !== null);
  }

  return NextResponse.json({
    damage_picks: enrichPicks(aiResult.damage_picks),
    loot_picks: enrichPicks(aiResult.loot_picks),
    summary: aiResult.summary ?? "",
    target_count: targets.length,
    nation_info: nationInfo,
  } satisfies AiTargetsResponse);
}
