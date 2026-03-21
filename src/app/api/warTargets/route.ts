import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PNW_API = "https://api.politicsandwar.com/graphql";

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PNW_API}?api_key=${process.env.PNW_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PnW API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}

const NATION_SCORE_QUERY = `
  query($id:[Int]) { nations(id:$id) { data { score } } }
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
    defensive_wars_count vacation_mode_turns beige_turns
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
  defensive_wars_count: number;
  vacation_mode_turns: number;
  beige_turns: number;
}

export interface WarTargetsResponse {
  targets: WarTarget[];
  yourScore: number;
  minScore: number;
  maxScore: number;
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
  if (rawIds.length > 25) {
    return NextResponse.json(
      { error: "war-config.json: too many enemy_alliance_ids (max 25)" },
      { status: 400 }
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
  let nationData: { nations: { data: { score: number }[] } };
  let warsData: { wars: { data: { def_id: number }[] } };
  try {
    [nationData, warsData] = await Promise.all([
      gql<{ nations: { data: { score: number }[] } }>(NATION_SCORE_QUERY, { id: [nationId] }),
      gql<{ wars: { data: { def_id: number }[] } }>(OFFENSIVE_WARS_QUERY, { attid: [nationId] }),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const yourScore = nationData.nations.data[0]?.score;
  if (yourScore == null) {
    return NextResponse.json({ error: `Nation #${nationId} not found` }, { status: 404 });
  }

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

  const targets: WarTarget[] = allEnemyNations
    .filter(n => n.score >= minScore && n.score <= maxScore)
    .filter(n => !atWarWith.has(Number(n.id)))
    .filter(n => n.defensive_wars_count < 3)
    .filter(n => n.vacation_mode_turns === 0)
    .filter(n => n.beige_turns === 0)
    .map(n => ({
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
      defensive_wars_count: n.defensive_wars_count,
      vacation_mode_turns: n.vacation_mode_turns,
      beige_turns: n.beige_turns,
    }))
    .sort((a, b) => b.avg_infra - a.avg_infra);

  const response: WarTargetsResponse = { targets, yourScore, minScore, maxScore };
  return NextResponse.json(response);
}
