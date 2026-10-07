import { NextResponse } from "next/server";
import { gql } from "@/lib/sync";
import { buildAllianceGroups, countMembers, type AllianceGroup, type RawAlliance } from "@/lib/alliance-rankings";

export const dynamic = "force-dynamic";

const CACHE_MS = 10 * 60 * 1000;

const ALLIANCES_QUERY = `
  query($page:Int) { alliances(first:100, page:$page, orderBy:[{column:SCORE, order:DESC}, {column:ID, order:ASC}]) {
    paginatorInfo { hasMorePages total }
    data { id name acronym score rank nations { alliance_position } treaties { treaty_type approved alliance1_id alliance2_id } }
  } }
`;

interface AlliancesPage {
  alliances: {
    paginatorInfo: { hasMorePages: boolean; total: number };
    data: Array<Omit<RawAlliance, "nation_count"> & { nations: Array<{ alliance_position: string }> }>;
  };
}

interface Rankings {
  fetchedAt: number;
  groups: AllianceGroup[];
}

let cached: Rankings | null = null;
let inFlight: Promise<Rankings> | null = null;

async function fetchPage(page: number): Promise<AlliancesPage> {
  try {
    return await gql<AlliancesPage>(ALLIANCES_QUERY, { page });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("429")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return gql<AlliancesPage>(ALLIANCES_QUERY, { page });
  }
}

async function fetchAllAlliances(): Promise<{ alliances: Map<number, RawAlliance>; total: number }> {
  const alliances = new Map<number, RawAlliance>();
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const result = await fetchPage(page);
    total = result.alliances.paginatorInfo.total;
    for (const { nations, ...alliance } of result.alliances.data) {
      alliances.set(Number(alliance.id), { ...alliance, nation_count: countMembers(nations) });
    }
    if (!result.alliances.paginatorInfo.hasMorePages) break;
  }
  return { alliances, total };
}

async function loadRankings(): Promise<Rankings> {
  // Alliances can shift between pages while we read them, repeating some and skipping others,
  // so retry once if the unique count doesn't match what the API says exists.
  let result = await fetchAllAlliances();
  if (result.alliances.size !== result.total) result = await fetchAllAlliances();
  return { fetchedAt: Date.now(), groups: buildAllianceGroups([...result.alliances.values()], 20) };
}

export async function GET() {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return NextResponse.json(cached);

  inFlight ??= loadRankings().finally(() => { inFlight = null; });
  try {
    cached = await inFlight;
    return NextResponse.json(cached);
  } catch (error) {
    // Serve the last good result rather than failing the page on a transient API error.
    if (cached) return NextResponse.json(cached);
    const message = error instanceof Error ? error.message : "Failed to load alliance rankings";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
