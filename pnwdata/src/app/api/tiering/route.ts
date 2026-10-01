import { NextRequest, NextResponse } from "next/server";
import { computeGroupTiering, parseAllianceIds, type TieringNation, type GroupTieringRow } from "@/lib/tiering";

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

const ALLIANCE_MEMBERS_QUERY = `
  query($alliance_id:[Int], $page:Int) { nations(alliance_id:$alliance_id, vmode:false, first:500, page:$page) { data { id num_cities alliance_id } } }
`;

export interface GroupTieringResponse {
  rows: GroupTieringRow[];
  groupATotal: number;
  groupBTotal: number;
}

export async function GET(request: NextRequest) {
  if (!process.env.PNW_API_KEY) {
    return NextResponse.json({ error: "PNW_API_KEY is not configured" }, { status: 500 });
  }

  const groupAIds = parseAllianceIds(request.nextUrl.searchParams.get("groupAIds") ?? "");
  const groupBIds = parseAllianceIds(request.nextUrl.searchParams.get("groupBIds") ?? "");
  if (groupAIds.length === 0 && groupBIds.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one alliance ID in Group A or Group B" },
      { status: 400 }
    );
  }

  const bucketSizeParam = Number(request.nextUrl.searchParams.get("bucketSize") ?? "5");
  const bucketSize = [1, 5, 10].includes(bucketSizeParam) ? bucketSizeParam : 5;

  const unionIds = [...new Set([...groupAIds, ...groupBIds])];

  // Fetch all members across every alliance in one paginated query (instead of one
  // request per alliance) — PnW's API rate-limits hard under dozens of concurrent
  // requests, which silently dropped alliances from large coalition comparisons.
  const nations: TieringNation[] = [];
  try {
    for (let page = 1; page <= 40; page++) {
      const data = await gql<{ nations: { data: { id: number; num_cities: number; alliance_id: number }[] } }>(
        ALLIANCE_MEMBERS_QUERY, { alliance_id: unionIds, page }
      );
      const batch = data.nations.data;
      nations.push(...batch.map(n => ({ id: Number(n.id), alliance_id: Number(n.alliance_id), num_cities: n.num_cities })));
      if (batch.length < 500) break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: `PnW API error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const rows = computeGroupTiering(nations, groupAIds, groupBIds, bucketSize);

  const response: GroupTieringResponse = {
    rows,
    groupATotal: rows.reduce((s, r) => s + r.groupA, 0),
    groupBTotal: rows.reduce((s, r) => s + r.groupB, 0),
  };
  return NextResponse.json(response);
}
